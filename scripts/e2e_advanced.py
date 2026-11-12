#!/usr/bin/env python3
"""Advanced feature tests: edit-in-place, export, burn/save, security, organizer."""
import base64
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "test-output"
OUT.mkdir(exist_ok=True)
RESULTS = []


def record(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print(("PASS" if ok else "FAIL"), "-", name, ("| " + str(detail)) if detail else "")


def save_data_url(data_url, path):
    if data_url and "," in data_url:
        Path(path).write_bytes(base64.b64decode(data_url.split(",", 1)[1]))


def main():
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900}, accept_downloads=True)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto("http://localhost:8080/", wait_until="domcontentloaded")
        page.wait_for_timeout(1500)
        page.click("#btn-load-sample")
        page.wait_for_timeout(3500)

        # ---- In-place text edit ----
        page.click(".mode-tab[data-mode='edit']")
        page.wait_for_timeout(500)
        span = page.locator(".page-wrapper").first.locator(".textLayer span").nth(1)
        box = span.bounding_box()
        page.mouse.click(box["x"] + 40, box["y"] + box["height"] / 2)
        page.wait_for_timeout(400)
        editable = span.evaluate("s => s.contentEditable")
        record("in-place edit activates contenteditable", editable == "true", editable)
        before_type = span.evaluate("""s => {
          const cs = getComputedStyle(s);
          const r = s.getBoundingClientRect();
          return { font: cs.fontSize, height: r.height, width: r.width };
        }""")
        page.keyboard.press("Control+A")
        page.keyboard.type("Edited Subtitle Text with extra words that must wrap onto another line")
        page.keyboard.press("Enter")
        page.keyboard.type("SECOND-PARAGRAPH-LINE")
        page.wait_for_timeout(500)
        during = span.evaluate("""s => {
          const cs = getComputedStyle(s);
          const r = s.getBoundingClientRect();
          return { font: cs.fontSize, height: r.height, editable: s.contentEditable,
                   whiteSpace: cs.whiteSpace, text: s.innerText };
        }""")
        txt = during["text"]
        record("in-place edit keeps the PDF font size", during["font"] == before_type["font"],
               f"{before_type['font']} -> {during['font']}")
        record("in-place edit paragraph grows vertically", during["height"] > before_type["height"],
               f"{before_type['height']:.0f} -> {during['height']:.0f}")
        record("Enter inserts a paragraph line break", "\n" in txt and during["editable"] == "true", txt)
        record("edited text contains the typed words", "Edited Subtitle Text" in txt and "SECOND-PARAGRAPH-LINE" in txt, txt)
        page.evaluate("() => document.activeElement.blur()")
        page.wait_for_timeout(400)
        committed = span.evaluate("s => ({ editable: s.contentEditable, cls: s.className })")
        record("in-place edit commits on blur", committed["editable"] == "false" and "in-place-modified" in committed["cls"], committed)
        edit_count = page.evaluate("() => (window.app.annotator.inPlaceEdits.get(1)||new Map()).size")
        record("in-place edit recorded for save", edit_count >= 1, edit_count)
        page.screenshot(path=str(OUT / "06-inplace.png"))

        # ---- Add annotations for export test ----
        page.click(".mode-tab[data-mode='annotate']")
        page.wait_for_timeout(400)
        annot = page.locator(".page-wrapper").first.locator("canvas[id^='annot-canvas-']").first
        cbox = annot.bounding_box()
        page.click("#tool-text")
        page.mouse.click(cbox["x"] + 80, cbox["y"] + 600)
        page.wait_for_timeout(300)
        page.keyboard.type("Visible text box content")
        page.click(".page-wrapper")  # blur
        page.wait_for_timeout(300)

        page.select_option("#annot-stamp", "DRAFT")
        page.wait_for_timeout(600)

        # Whiteout via edit mode
        page.click(".mode-tab[data-mode='edit']")
        page.wait_for_timeout(400)
        page.click("#btn-edit-whiteout")
        page.wait_for_timeout(500)
        record("whiteout box created", page.locator(".whiteout-box").count() >= 1,
               page.locator(".whiteout-box").count())

        # ---- Export page image ----
        page.click(".mode-tab[data-mode='export']")
        page.wait_for_timeout(400)
        data_url = page.evaluate("async () => await window.app.exporter.exportPageAsImage(1)")
        save_data_url(data_url, OUT / "07-export-page.png")
        record("exportPageAsImage returns PNG", bool(data_url and data_url.startswith("data:image/png")),
               (data_url or "")[:30])

        # ---- Burn annotations to PDF ----
        b64 = page.evaluate("""async () => {
            const bytes = await window.app.annotator.burnAnnotationsToPdf(window.app.currentPdfBytes);
            let s=''; for (const b of bytes) s += String.fromCharCode(b);
            return btoa(s);
        }""")
        (OUT / "08-burned.pdf").write_bytes(base64.b64decode(b64))
        record("burnAnnotationsToPdf returns PDF", (OUT / "08-burned.pdf").read_bytes()[:5] == b"%PDF-",
               (OUT / "08-burned.pdf").stat().st_size)

        # ---- Watermark ----
        wm_b64 = page.evaluate("""async () => {
            const bytes = await window.app.security.applyWatermark(window.app.currentPdfBytes, {text:'CONFIDENTIAL WATERMARK', angle:45, opacity:0.3, size:48});
            let s=''; for (const b of bytes) s += String.fromCharCode(b);
            return btoa(s);
        }""")
        (OUT / "09-watermark.pdf").write_bytes(base64.b64decode(wm_b64))
        record("applyWatermark returns PDF", (OUT / "09-watermark.pdf").read_bytes()[:5] == b"%PDF-")

        # ---- Page numbers ----
        pn_b64 = page.evaluate("""async () => {
            const bytes = await window.app.security.addPageNumbers(window.app.currentPdfBytes, {prefix:'DOC', startNumber:5, format:'Page {page} of {total}', position:'bottom-right'});
            let s=''; for (const b of bytes) s += String.fromCharCode(b);
            return btoa(s);
        }""")
        (OUT / "10-pagenums.pdf").write_bytes(base64.b64decode(pn_b64))
        record("addPageNumbers returns PDF", (OUT / "10-pagenums.pdf").read_bytes()[:5] == b"%PDF-")

        # ---- Split ----
        split = page.evaluate("""async () => {
            const parts = await window.app.organizer.splitByRanges(window.app.currentPdfBytes, '1, 2');
            return parts.map(p=>({name:p.name, len:p.bytes.length, head:String.fromCharCode(...p.bytes.slice(0,5))}));
        }""")
        record("splitByRanges creates 2 parts", len(split) == 2, split)

        # ---- Organizer insert blank page off-by-one check ----
        before = page.evaluate("() => window.app.viewer.totalPages")
        page.evaluate("async () => { window.app.viewer.goToPage(1); await window.app.insertBlankPage(); }")
        page.wait_for_timeout(2500)
        after = page.evaluate("() => window.app.viewer.totalPages")
        record("insertBlankPage adds a page", after == before + 1, f"{before}->{after}")

        # ---- Paragraph reflow on a multi-run / tight-leading document ----
        sql_doc = ROOT / "test-docs" / "SQL Server Advanced Concepts.pdf"
        if sql_doc.exists():
            page.set_input_files("#file-input", str(sql_doc))
            page.wait_for_timeout(4500)
            page.click(".mode-tab[data-mode='edit']")
            page.wait_for_timeout(600)

            wrap = page.locator(".page-wrapper").first
            target = wrap.locator(".textLayer span").nth(2)
            tbox = target.bounding_box()
            page.mouse.click(tbox["x"] + 60, tbox["y"] + tbox["height"] / 2)
            page.wait_for_timeout(400)

            merged = page.evaluate("""() => {
              const s = document.querySelector('.textLayer span.inline-editing');
              return { merged: !!s._paragraphMerge,
                       hidden: s._paragraphMerge ? s._paragraphMerge.hidden.length : 0,
                       width: parseFloat(s.style.maxWidth) || 0,
                       pageWidth: s.closest('.page-wrapper').clientWidth };
            }""")
            record("paragraph edit merges the whole paragraph", merged["merged"] and merged["hidden"] >= 5, merged)
            record("paragraph edit stays within the page", 0 < merged["width"] <= merged["pageWidth"], merged)

            def heap_top():
                return page.evaluate("""() => {
                  const w = document.querySelector('.page-wrapper');
                  const heap = Array.from(w.querySelectorAll('.textLayer span')).find(s => s.textContent.startsWith('In the Heap'));
                  return heap ? heap.getBoundingClientRect().top : null;
                }""")

            heap_before = heap_top()
            page.keyboard.type(" Added words force this paragraph to wrap onto many more lines so the following diagram and body text must be pushed down without overlapping any of the old content.")
            page.wait_for_timeout(900)
            during = page.evaluate("""() => {
              const w = document.querySelector('.page-wrapper');
              const ed = w.querySelector('.inline-editing');
              const er = ed.getBoundingClientRect();
              const others = Array.from(w.querySelectorAll('.textLayer span'))
                .filter(s => s !== ed && !s._mergeHidden && s.textContent.trim())
                .map(s => ({ top: s.getBoundingClientRect().top, text: s.textContent.slice(0, 30) }));
              const next = others.filter(o => o.top > er.top - 5).sort((a, b) => a.top - b.top)[0] || null;
              return { edBottom: er.bottom, nextTop: next ? next.top : null, nextText: next ? next.text : '',
                       height: ed.offsetHeight };
            }""")
            heap_during = heap_top()
            record("growing paragraph does not overlap following content",
                   during["nextTop"] is None or during["edBottom"] <= during["nextTop"] + 1, during)
            record("growing paragraph keeps its full text", during["height"] > 120, during["height"])
            record("growing paragraph shifts content below it",
                   heap_before is not None and heap_during is not None and heap_during > heap_before + 20,
                   f"{heap_before} -> {heap_during}")
            page.screenshot(path=str(OUT / "11-paragraph-reflow.png"))

            page.evaluate("() => document.activeElement.blur()")
            page.wait_for_timeout(700)

            b64 = page.evaluate("""async () => {
                const bytes = await window.app.annotator.burnAnnotationsToPdf(window.app.currentPdfBytes);
                let s=''; for (const b of bytes) s += String.fromCharCode(b);
                return btoa(s);
            }""")
            burned = OUT / "12-reflow-burned.pdf"
            burned.write_bytes(base64.b64decode(b64))
            record("reflow burn returns PDF", burned.read_bytes()[:5] == b"%PDF-", burned.stat().st_size)

            try:
                import pymupdf
                doc = pymupdf.open(str(burned))
                pg = doc[0]
                full_page_image = False
                for img in pg.get_images(full=True):
                    for r in pg.get_image_rects(img[0]):
                        if r.width >= pg.rect.width * 0.95 and r.height >= pg.rect.height * 0.95:
                            full_page_image = True
                record("reflowed page saved as full-page raster", full_page_image, str(pg.rect))
                pg.get_pixmap(dpi=110).save(str(OUT / "12-reflow-burned-p1.png"))
                doc.close()
            except ImportError:
                print("SKIP - pymupdf not available for reflow export check")

            # Undo every keystroke: the merged runs must reappear and the page
            # must return to its pristine pixels/positions.
            for _ in range(600):
                if not page.evaluate("() => !!document.querySelector('.textLayer span.in-place-modified')"):
                    break
                page.keyboard.press("Control+z")
            page.wait_for_timeout(800)
            undone = page.evaluate("""() => {
              const w = document.querySelector('.page-wrapper');
              const spans = Array.from(w.querySelectorAll('.textLayer span'));
              const heap = spans.find(s => s.textContent.startsWith('In the Heap'));
              return { modified: !!w.querySelector('.textLayer span.in-place-modified'),
                       mergeHidden: spans.filter(s => s._mergeHidden).length,
                       heapTop: heap ? heap.getBoundingClientRect().top : null };
            }""")
            record("undo restores paragraph runs and reflow",
                   not undone["modified"] and undone["mergeHidden"] == 0 and
                   heap_before is not None and undone["heapTop"] is not None and
                   abs(undone["heapTop"] - heap_before) <= 2, undone)

        print("\n--- PAGE ERRORS ---")
        for e in errors:
            print(e)
        browser.close()

    passed = sum(1 for _, ok, _ in RESULTS if ok)
    print(f"\nSummary: {passed}/{len(RESULTS)} passed | page errors: {len(errors)}")
    return 0 if passed == len(RESULTS) and not errors else 1


if __name__ == "__main__":
    sys.exit(main())
