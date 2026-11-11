#!/usr/bin/env python3
"""UI flow tests for merge, organizer, undo, selection markup, protect, flatten."""
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


def load_sample(page):
    page.goto("http://localhost:8080/", wait_until="domcontentloaded")
    page.wait_for_timeout(1500)
    # Session restore may already be showing a document, hiding the welcome CTA.
    page.evaluate("() => window.app.loadSamplePDF()")
    page.wait_for_timeout(3000)


def main():
    errors = []
    console_errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900}, accept_downloads=True)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        load_sample(page)

        # ---------- Merge flow ----------
        page.click(".mode-tab[data-mode='organize']")
        page.wait_for_timeout(300)
        page.click("#btn-open-merge")
        page.wait_for_timeout(300)
        page.set_input_files("#merge-files-input", str(ROOT / "test-docs" / "a.pdf"))
        page.wait_for_timeout(500)
        rec = page.evaluate("() => window.app.mergeItems.length")
        record("merge modal includes current + added file", rec == 2, rec)
        page.click("#btn-apply-merge")
        page.wait_for_timeout(3500)
        pages = page.evaluate("() => window.app.viewer.totalPages")
        record("merge produces combined document", pages > 2, pages)

        # ---------- Organizer apply: rotate page 1 and delete page 2 ----------
        page.click(".mode-tab[data-mode='organize']")
        page.wait_for_timeout(300)
        page.evaluate("""() => {
          const modal = document.getElementById('modal-organizer');
          window.__organizerOpenMs = null;
          const t0 = performance.now();
          const obs = new MutationObserver(() => {
            if (modal.classList.contains('open') && window.__organizerOpenMs === null) {
              window.__organizerOpenMs = performance.now() - t0;
              obs.disconnect();
            }
          });
          obs.observe(modal, { attributes: true, attributeFilter: ['class'] });
        }""")
        page.click("#btn-open-organizer-modal")
        page.wait_for_selector("#modal-organizer.open", timeout=3000)
        open_ms = page.evaluate("() => window.__organizerOpenMs")
        record("organizer dialog opens immediately", open_ms is not None and open_ms < 500,
               f"{open_ms:.0f} ms" if open_ms is not None else "no open event")
        cards = page.locator(".organizer-card")
        record("organizer grid renders cards", cards.count() > 0, cards.count())
        page.wait_for_function("() => document.querySelectorAll('.organizer-thumb-loading').length === 0", timeout=20000)
        thumbs = page.evaluate("""() => ({
          cards: document.querySelectorAll('.organizer-card').length,
          loaded: document.querySelectorAll('.organizer-thumb:not(.organizer-thumb-loading)').length,
          sized: [...document.querySelectorAll('.organizer-thumb canvas')].filter(c => c.width > 1 && c.height > 1).length
        })""")
        record("organizer thumbnails finish loading progressively",
               thumbs["loaded"] == thumbs["cards"] and thumbs["sized"] == thumbs["cards"], thumbs)
        cards.nth(0).click()
        page.click("#btn-org-rotate-right")
        page.wait_for_timeout(200)
        # deselect rotated card, then delete the last card
        cards.nth(0).click()
        cards.nth(cards.count() - 1).click()
        page.click("#btn-org-delete")
        page.wait_for_timeout(300)
        remaining = page.locator(".organizer-card").count()
        page.click("#btn-org-apply")
        page.wait_for_timeout(4000)
        total = page.evaluate("() => window.app.viewer.totalPages")
        rots = page.evaluate("async () => { const d=window.app.viewer.pdfDoc; const arr=[]; for(let i=1;i<=d.numPages;i++){const p=await d.getPage(i); arr.push(p.rotate);} return arr; }")
        record("organizer apply deletes page", total == remaining, f"{remaining} cards -> {total} pages")
        record("organizer apply persists rotation", any(r % 360 == 90 for r in rots), rots)

        # ---------- Fresh document for annotation flows ----------
        load_sample(page)

        # ---------- Undo/redo deleted stamp ----------
        page.click(".mode-tab[data-mode='annotate']")
        page.wait_for_timeout(300)
        page.select_option("#annot-stamp", "APPROVED")
        page.wait_for_timeout(500)
        n1 = page.locator(".placed-stamp").count()
        page.keyboard.press("Delete")
        page.wait_for_timeout(300)
        n2 = page.locator(".placed-stamp").count()
        page.click("#btn-undo")
        page.wait_for_timeout(400)
        n3 = page.locator(".placed-stamp").count()
        page.click("#btn-redo")
        page.wait_for_timeout(400)
        n4 = page.locator(".placed-stamp").count()
        record("stamp placed", n1 >= 1, n1)
        record("Delete key removes stamp", n2 == n1 - 1, n2)
        record("undo restores deleted stamp", n3 == n1, n3)
        record("redo re-deletes stamp", n4 == n1 - 1, n4)

        # ---------- Stamp customization & deletion ----------
        page.select_option("#annot-stamp", "DRAFT")
        page.wait_for_timeout(700)
        active = page.evaluate("() => !!window.app.annotator.activeStamp")
        record("placing stamp keeps it selected", active, active)

        page.select_option("#stamp-opacity", "0.45")
        page.wait_for_timeout(400)
        opacity = page.evaluate("() => document.querySelector('.placed-stamp .stamp-badge').style.opacity")
        record("stamp opacity applies", opacity == "0.45", opacity)

        page.select_option("#stamp-rotation", "15")
        page.wait_for_timeout(400)
        rotation = page.evaluate("() => document.querySelector('.placed-stamp .stamp-badge').dataset.rotation")
        record("stamp rotation applies", rotation == "15", rotation)

        page.fill("#stamp-font-size", "36")
        page.dispatch_event("#stamp-font-size", "change")
        page.wait_for_timeout(400)
        font_size = page.evaluate("() => getComputedStyle(document.querySelector('.placed-stamp .stamp-badge')).fontSize")
        record("stamp font size increases", font_size == "36px", font_size)

        page.click("#btn-stamp-delete")
        page.wait_for_timeout(400)
        deleted = page.locator(".placed-stamp").count()
        visible_bars = page.evaluate("() => [...document.querySelectorAll('.element-floating-bar')].filter(b => getComputedStyle(b).display !== 'none').length")
        record("Delete Selected Stamp removes the stamp", deleted == 0, deleted)
        record("stamp toolbar hides after deletion", visible_bars == 0, visible_bars)

        page.click("#btn-undo")
        page.wait_for_timeout(500)
        record("undo restores stamp deleted from toolbar", page.locator(".placed-stamp").count() == 1)

        stamp = page.locator(".placed-stamp").last
        stamp.hover()
        page.wait_for_timeout(200)
        stamp.locator(".textbox-delete-btn").click(force=True)
        page.wait_for_timeout(400)
        visible_bars = page.evaluate("() => [...document.querySelectorAll('.element-floating-bar')].filter(b => getComputedStyle(b).display !== 'none').length")
        record("stamp close button removes the stamp", page.locator(".placed-stamp").count() == 0)
        record("stamp toolbar hides immediately after close", visible_bars == 0, visible_bars)
        page.click("#btn-undo")
        page.wait_for_timeout(500)
        record("undo restores stamp deleted from close button", page.locator(".placed-stamp").count() == 1)

        # ---------- Underline selection markup ----------
        page.click("#tool-select")
        page.wait_for_timeout(300)
        prepared = page.evaluate("""() => {
          const span = document.querySelector('.page-wrapper .textLayer span');
          if (!span) return false;
          const range = document.createRange();
          range.selectNodeContents(span);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          return true;
        }""")
        record("text span selectable for markup", prepared, prepared)
        page.click("#btn-text-underline")
        page.wait_for_timeout(600)
        annots = page.evaluate("() => [...(window.app.annotator.annotations.get(1)||[])].map(a=>a.type)")
        record("underline creates annotation", "underline" in annots, annots)

        # ---------- Export composites overlays ----------
        page.select_option("#annot-stamp", "DRAFT")
        page.wait_for_timeout(500)
        page.click("#tool-text")
        wrapper = page.locator(".page-wrapper").first
        wb = wrapper.bounding_box()
        page.mouse.click(wb["x"] + 250, wb["y"] + 400)
        page.wait_for_timeout(300)
        page.keyboard.type("EXPORT-CHECK-42")
        page.click("#tool-select")
        page.wait_for_timeout(300)
        export_ok = page.evaluate("""() => {
          const pages = window.app.viewer.totalPages;
          return window.app.exporter._compositePageCanvas(1, 900, 1200) !== null;
        }""")
        record("export compositor handles page overlays", export_ok, export_ok)

        # Pixel-level export check on a blank page: only overlays can create ink.
        page.evaluate("""async () => {
          const { PDFDocument } = window.PDFLib;
          const doc = await PDFDocument.create();
          doc.addPage([600, 800]);
          const bytes = await doc.save();
          await window.app.loadArrayBuffer(bytes, 'blank-export.pdf');
        }""")
        page.wait_for_timeout(1800)
        page.click(".mode-tab[data-mode='annotate']")
        page.wait_for_timeout(300)
        page.click("#tool-text")
        bw = page.locator(".page-wrapper").first.bounding_box()
        page.mouse.click(bw["x"] + 60, bw["y"] + 80)
        page.wait_for_timeout(300)
        page.keyboard.type("TOPCHECK")
        page.click("#tool-select")
        page.wait_for_timeout(300)
        page.select_option("#annot-stamp", "APPROVED")
        page.wait_for_timeout(500)
        pixel_result = page.evaluate("""() => {
          const wrapper = document.querySelector('.page-wrapper');
          const base = wrapper.querySelector('canvas.pdf-canvas');
          const out = window.app.exporter._compositePageCanvas(1, base.width, base.height);
          if (!out) return { ok: false, reason: 'no canvas' };
          const sx = out.width / wrapper.clientWidth;
          const sy = out.height / wrapper.clientHeight;
          const ctx = out.getContext('2d');

          const scan = (el) => {
            if (!el) return 0;
            const x = Math.max(0, Math.floor(el.offsetLeft * sx));
            const y = Math.max(0, Math.floor(el.offsetTop * sy));
            const w = Math.max(1, Math.ceil(el.offsetWidth * sx));
            const h = Math.max(1, Math.ceil(el.offsetHeight * sy));
            const d = ctx.getImageData(x, y, w, h).data;
            let ink = 0;
            for (let i = 0; i < d.length; i += 4) {
              if (d[i] < 235 || d[i+1] < 235 || d[i+2] < 235) ink++;
            }
            return ink;
          };

          return {
            ok: true,
            textPixels: scan(document.querySelector('.annotation-textbox')),
            stampPixels: scan(document.querySelector('.placed-stamp .stamp-badge')?.closest('.placed-stamp'))
          };
        }""")
        record("export includes text box pixels", pixel_result.get("textPixels", 0) > 10, pixel_result)
        record("export includes stamp pixels", pixel_result.get("stampPixels", 0) > 10, pixel_result)

        # ---------- Sticky notes survive PDF save as real annotations ----------
        page.click("#tool-note")
        page.mouse.click(bw["x"] + 320, bw["y"] + 520)
        page.wait_for_timeout(400)
        page.keyboard.type("NOTE-CHECK-99")
        page.wait_for_timeout(200)
        page.click("#tool-select")
        page.wait_for_timeout(200)
        note_burn = page.evaluate("""async () => {
          const burned = await window.app.annotator.burnAnnotationsToPdf(window.app.currentPdfBytes);
          const doc = await window.PDFLib.PDFDocument.load(burned);
          const annots = doc.getPage(0).node.Annots();
          if (!annots) return [];
          const out = [];
          for (const ref of annots.asArray()) {
            const a = doc.context.lookup(ref);
            const c = a && a.get ? a.get(window.PDFLib.PDFName.of('Contents')) : null;
            if (c) out.push(c.decodeText ? c.decodeText() : String(c));
          }
          return out;
        }""")
        record("sticky note burned as PDF annotation", any("NOTE-CHECK-99" in n for n in note_burn), note_burn)

        # ---------- Protect flow (real AES-256 download) ----------
        page.click(".mode-tab[data-mode='protect']")
        page.wait_for_timeout(300)
        page.click("#btn-open-protect")
        page.wait_for_timeout(300)
        page.fill("#protect-password", "secret123")
        page.fill("#protect-password-confirm", "secret123")
        download_path = None
        try:
            with page.expect_download(timeout=30000) as dl_info:
                page.click("#btn-apply-protect")
            download = dl_info.value
            download_path = OUT / "protected-flow.pdf"
            download.save_as(str(download_path))
        except Exception as e:
            print("protect download error:", e)

        encrypted_ok = False
        decrypt_ok = False
        if download_path and download_path.exists() and download_path.stat().st_size > 0:
            try:
                from pypdf import PdfReader
                reader = PdfReader(str(download_path))
                encrypted_ok = bool(reader.is_encrypted)
                if encrypted_ok:
                    decrypt_ok = bool(reader.decrypt("secret123")) and len(reader.pages) > 0
            except Exception as e:
                print("protect inspection error:", e)
        modal_open = page.locator("#modal-protect").evaluate("el => el.classList.contains('open')")
        record("protect produces encrypted PDF", encrypted_ok, download_path)
        record("encrypted PDF opens with password", decrypt_ok, decrypt_ok)
        record("protect closes modal after save", not modal_open, modal_open)

        # ---------- Flatten form flow ----------
        form_bytes = page.evaluate("""async () => {
          const { PDFDocument } = window.PDFLib;
          const doc = await PDFDocument.create();
          const p = doc.addPage([600, 800]);
          p.drawText('Flatten Me', { x: 50, y: 740, size: 18 });
          const field = doc.getForm().createTextField('full_name');
          field.setText('Test User');
          field.addToPage(p, { x: 50, y: 690, width: 240, height: 26 });
          const bytes = await doc.save();
          await window.app.loadArrayBuffer(bytes, 'form-test.pdf');
          return bytes.length;
        }""")
        page.wait_for_timeout(2500)
        page.click(".mode-tab[data-mode='forms']")
        page.wait_for_timeout(300)
        fields_before = page.evaluate("async () => { const d=await window.PDFLib.PDFDocument.load(window.app.currentPdfBytes); return d.getForm().getFields().length; }")
        page.click("#btn-flatten-form")
        page.wait_for_timeout(2500)
        fields_after = page.evaluate("async () => { const d=await window.PDFLib.PDFDocument.load(window.app.currentPdfBytes); return d.getForm().getFields().length; }")
        status = page.locator("#status-message").inner_text() if page.locator("#status-message").count() else ""
        record("form document has a field", fields_before == 1, fields_before)
        record("flatten removes form fields", fields_after == 0, fields_after)
        record("flatten reports success", "flatten" in status.lower(), status)

        # ---------- Regression: zoom keeps the reading position ----------
        multi_pdf = ROOT / "test-docs" / "SQL Server Advanced Concepts.pdf"
        page.set_input_files("#file-input", str(multi_pdf))
        page.wait_for_function("() => window.app.viewer.totalPages === 13", timeout=40000)
        page.wait_for_timeout(2500)

        def top_page_ratio():
            return page.evaluate("""() => {
              const c = document.getElementById('viewer-container').getBoundingClientRect();
              const w = document.getElementById('page-wrapper-7').getBoundingClientRect();
              return {
                page: window.app.viewer.currentPage,
                ratio: w.height ? (c.top - w.top) / w.height : 0
              };
            }""")

        def check_zoom(label):
            page.evaluate("() => window.app.viewer.goToPage(7)")
            page.wait_for_timeout(900)
            page.evaluate("() => document.getElementById('viewer-container').scrollTop += 300")
            page.wait_for_timeout(350)
            before = top_page_ratio()
            page.evaluate("""() => {
              window.__zoomPages = [];
              const v = window.app.viewer;
              const t0 = performance.now();
              const tick = () => {
                window.__zoomPages.push(v.currentPage);
                if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
            }""")
            page.select_option("#zoom-select", label[1])
            page.wait_for_timeout(3200)
            after = top_page_ratio()
            seen = sorted(set(page.evaluate("() => window.__zoomPages || []")))
            drift = abs(after["ratio"] - before["ratio"])
            page_jump = abs(after["page"] - before["page"])
            # The reported regression was a violent jump to page 1 (or the end).
            no_first_page_flash = not (before["page"] > 3 and 1 in seen)
            ok = drift < 0.05 and page_jump <= 1 and no_first_page_flash
            record(label[0], ok,
                   f"anchor page {before['page']}->{after['page']} ratio drift {drift:.3f} seen {seen}")

        check_zoom(("zoom 75% keeps reading anchor", "0.75"))
        check_zoom(("zoom 100% keeps reading anchor", "1.00"))
        check_zoom(("zoom 200% keeps reading anchor", "2.00"))
        check_zoom(("Fit Page keeps reading anchor", "page-fit"))
        check_zoom(("Auto Fit keeps reading anchor", "auto"))
        check_zoom(("Fit Width keeps reading anchor", "page-width"))

        # ---------- Regression: thumbnails appear immediately, then fill ----------
        thumbs = page.evaluate("""async () => {
          const v = window.app.viewer;
          v.renderThumbnails(); // async; the synchronous skeleton pass runs now
          const immediate = {
            items: document.querySelectorAll('.thumbnail-item').length,
            loading: document.querySelectorAll('.thumbnail-item.thumb-loading').length
          };
          const t0 = performance.now();
          while (performance.now() - t0 < 6000) {
            if (document.querySelectorAll('.thumbnail-item.thumb-loading').length === 0) break;
            await new Promise(r => setTimeout(r, 50));
          }
          return {
            immediate,
            total: v.totalPages,
            remaining: document.querySelectorAll('.thumbnail-item.thumb-loading').length,
            blankCanvases: [...document.querySelectorAll('.thumbnail-item canvas')]
              .filter(c => !c.width || !c.height).length,
            elapsed: Math.round(performance.now() - t0)
          };
        }""")
        record("thumbnail placeholders appear immediately",
               thumbs["immediate"]["items"] == thumbs["total"] and thumbs["immediate"]["loading"] > 0,
               thumbs["immediate"])
        record("all thumbnails fill without blank canvases",
               thumbs["remaining"] == 0 and thumbs["blankCanvases"] == 0, thumbs)

        # ---------- Regression: annotations sidebar lists every marked page ----------
        page.click(".mode-tab[data-mode='annotate']")
        page.wait_for_timeout(400)
        page.evaluate("() => window.app.viewer.goToPage(1)")
        page.wait_for_timeout(700)
        page.evaluate("() => window.app.annotator.setTool('highlighter', { color: '#fbbf24' })")
        hbox = page.locator("#annot-canvas-1").bounding_box()
        page.mouse.move(hbox["x"] + 60, hbox["y"] + 100)
        page.mouse.down()
        page.mouse.move(hbox["x"] + 220, hbox["y"] + 108, steps=8)
        page.mouse.up()
        page.wait_for_timeout(350)

        underlined = page.evaluate("""() => {
          const span = [...document.querySelectorAll('#page-wrapper-2 .textLayer span')]
            .find(s => (s.textContent || '').trim().length > 15);
          if (!span) return false;
          const range = document.createRange();
          range.selectNodeContents(span);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          window.app.annotator.toggleUnderline();
          return true;
        }""")
        page.wait_for_timeout(450)
        page.click(".sidebar-tab[data-tab='annotations']")
        page.wait_for_timeout(500)
        rows = page.evaluate("""() => [...document.querySelectorAll('.annot-list-item')].map(r => ({
          page: Number(r.dataset.page),
          type: r.dataset.type,
          text: (r.innerText || '').replace(/\\s+/g, ' ').trim()
        }))""")
        record("annotations sidebar shows the highlighted page",
               any(r["type"] == "highlight" and r["page"] == 1 for r in rows), rows)
        record("annotations sidebar shows the underlined page",
               underlined and any(r["type"] == "underline" and r["page"] == 2 for r in rows), rows)
        record("annotations sidebar page numbers stay in range",
               bool(rows) and all(1 <= r["page"] <= 13 for r in rows), rows)

        # ---------- Regression: drawing never silently saves or burns ----------
        baseline = page.evaluate("""async () => {
          const bytes = window.app.currentPdfBytes;
          const buf = await crypto.subtle.digest('SHA-256', bytes);
          return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        }""")
        stored_before = page.evaluate("""async () => {
          const d = await window.app.storage.getActiveDocument();
          if (!d || !d.bytes) return null;
          const buf = await crypto.subtle.digest('SHA-256', new Uint8Array(d.bytes));
          return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        }""")

        page.evaluate("() => window.app.annotator.clearAllEdits()")
        page.wait_for_timeout(200)
        for tool, pageno in (("highlighter", 1), ("rectangle", 2)):
            page.evaluate(f"() => window.app.viewer.goToPage({pageno})")
            page.wait_for_timeout(500)
            page.evaluate(f"() => window.app.annotator.setTool('{tool}', {{ color: '#ef4444' }})")
            abox = page.locator(f"#annot-canvas-{pageno}").bounding_box()
            page.mouse.move(abox["x"] + 70, abox["y"] + 110)
            page.mouse.down()
            page.mouse.move(abox["x"] + 230, abox["y"] + 210, steps=8)
            page.mouse.up()
            page.wait_for_timeout(300)

        after_draw = page.evaluate("""async () => {
          const bytes = window.app.currentPdfBytes;
          const buf = await crypto.subtle.digest('SHA-256', bytes);
          return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        }""")
        stored_after = page.evaluate("""async () => {
          const d = await window.app.storage.getActiveDocument();
          if (!d || !d.bytes) return null;
          const buf = await crypto.subtle.digest('SHA-256', new Uint8Array(d.bytes));
          return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        }""")
        live_count = page.evaluate("() => [...window.app.annotator.annotations.values()].reduce((n, a) => n + a.length, 0)")
        record("drawing does not rewrite the working PDF bytes", baseline == after_draw,
               f"{baseline[:12]} -> {after_draw[:12]}")
        record("drawing is not written to the auto-restored session",
               stored_before == stored_after == baseline,
               f"stored {str(stored_before)[:12]} / {str(stored_after)[:12]}")
        record("drawn shapes remain live annotations until Save",
               live_count >= 2, live_count)

        # ---------- Regression: rotation refreshes thumbnail orientation ----------
        portrait = page.evaluate("""() => {
          const c = document.querySelector('#thumb-1 canvas');
          return c ? { w: c.width, h: c.height } : null;
        }""")
        page.click("#btn-rotate-cw")
        try:
            page.wait_for_function("""() => {
              const v = window.app.viewer;
              const c = document.querySelector('#thumb-1 canvas');
              return v.rotation === 90 &&
                document.querySelectorAll('.thumbnail-item.thumb-loading').length === 0 &&
                c && c.width > c.height;
            }""", timeout=20000)
            rotated = page.evaluate("""() => {
              const c = document.querySelector('#thumb-1 canvas');
              return { w: c.width, h: c.height, loading: document.querySelectorAll('.thumbnail-item.thumb-loading').length };
            }""")
        except Exception as e:
            print("rotate thumbnail error:", e)
            rotated = page.evaluate("""() => {
              const c = document.querySelector('#thumb-1 canvas');
              return c ? { w: c.width, h: c.height, loading: document.querySelectorAll('.thumbnail-item.thumb-loading').length } : {};
            }""")
        record("rotating refreshes thumbnails to the new orientation",
               bool(portrait) and portrait["w"] < portrait["h"] and
               rotated.get("w", 0) > rotated.get("h", 0) and rotated.get("loading") == 0,
               f"portrait {portrait} -> {rotated}")

        # ---------- In-place Save (writes back, no duplicate download) ----------
        load_sample(page)
        page.wait_for_timeout(2000)
        page.click(".mode-tab[data-mode='annotate']")
        page.wait_for_timeout(400)

        save_handle = page.evaluate("""async () => {
          window.__written = null;
          window.__downloadCalled = false;
          window.__originalDownload = window.app.exporter.downloadFile.bind(window.app.exporter);
          window.app.exporter.downloadFile = async () => {
            window.__downloadCalled = true;
            return { success: true, destination: 'Downloads folder' };
          };
          const handle = {
            name: 'in-place.pdf',
            createWritable: async () => ({
              write: async (data) => { window.__written = new Uint8Array(data); },
              close: async () => {}
            }),
            queryPermission: async () => 'granted',
            requestPermission: async () => 'granted'
          };
          window.app.currentFileHandle = handle;
          window.app.currentFilePath = null;
          await window.app.saveDocument();
          window.app.exporter.downloadFile = window.__originalDownload;
          const w = window.__written;
          return {
            wrote: Boolean(w),
            size: w ? w.length : 0,
            magic: w ? String.fromCharCode(w[0], w[1], w[2], w[3], w[4]) : '',
            downloaded: window.__downloadCalled,
            keptHandle: window.app.currentFileHandle === handle
          };
        }""")
        record("Save writes back into the opened file",
               save_handle["wrote"] and save_handle["size"] > 1000 and save_handle["magic"] == "%PDF-",
               save_handle)
        record("Save no longer downloads a duplicate copy",
               save_handle["downloaded"] is False, save_handle)
        record("Save keeps the writable handle for later saves",
               save_handle["keptHandle"], save_handle)

        # ---------- Native Tauri Save path ----------
        native_save = page.evaluate("""async () => {
          const calls = [];
          window.__TAURI__ = { core: { invoke: async (cmd, args) => {
            calls.push({ cmd, path: args?.path, bytes: args?.data ? args.data.length : 0 });
            return null;
          } } };
          window.app.currentFileHandle = null;
          window.app.currentFilePath = 'C:/Users/Test/Documents/native-save.pdf';
          await window.app.saveDocument();
          delete window.__TAURI__;
          return { calls, path: window.app.currentFilePath };
        }""")
        native_writes = [c for c in native_save["calls"] if c["cmd"] == "write_pdf_file"]
        record("Tauri Save writes back to the native path",
               len(native_writes) == 1 and native_writes[0]["bytes"] > 1000, native_save)
        record("Tauri Save keeps the native path for later saves",
               native_save["path"] == "C:/Users/Test/Documents/native-save.pdf", native_save.get("path"))

        # ---------- Open picker retains the writable handle ----------
        pdf_b64 = base64.b64encode((ROOT / "test-docs" / "a.pdf").read_bytes()).decode("ascii")
        picker_open = page.evaluate("""async (b64) => {
          window.showOpenFilePicker = async () => [{
            name: 'picked.pdf',
            getFile: async () => {
              const bin = atob(b64);
              const bytes = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
              return new File([bytes], 'picked.pdf', { type: 'application/pdf' });
            }
          }];
          window.app.currentFileHandle = null;
          window.app.currentFilePath = null;
          await window.app.openDocumentPicker();
          const result = {
            name: window.app.currentDocName,
            hasHandle: Boolean(window.app.currentFileHandle),
            pages: window.app.viewer.totalPages
          };
          delete window.showOpenFilePicker;
          return result;
        }""", pdf_b64)
        record("Open picker retains a writable handle",
               picker_open["hasHandle"] and picker_open["name"] == "picked.pdf", picker_open)

        # ---------- Save As switches to the chosen new file ----------
        save_as = page.evaluate("""async () => {
          let written = 0;
          window.showSaveFilePicker = async () => ({
            name: 'renamed.pdf',
            createWritable: async () => ({
              write: async (data) => { written = data.length; },
              close: async () => {},
              abort: async () => {}
            }),
            queryPermission: async () => 'granted',
            requestPermission: async () => 'granted'
          });
          await window.app.saveAsDocument();
          const result = {
            name: window.app.currentDocName,
            written,
            keptHandleName: window.app.currentFileHandle?.name || null
          };
          delete window.showSaveFilePicker;
          return result;
        }""")
        record("Save As switches the document to the chosen new file",
               save_as["name"] == "renamed.pdf" and save_as["written"] > 1000 and
               save_as["keptHandleName"] == "renamed.pdf", save_as)

        # ---------- Platforms without file APIs still download ----------
        fallback_save = page.evaluate("""async () => {
          window.showOpenFilePicker = undefined;
          window.showSaveFilePicker = undefined;
          window.app.currentFileHandle = null;
          window.app.currentFilePath = null;
          let downloaded = false;
          window.app.exporter.downloadFile = async () => {
            downloaded = true;
            return { success: true, destination: 'Downloads folder' };
          };
          await window.app.saveDocument();
          return { downloaded };
        }""")
        record("Save falls back to download when no file API exists",
               fallback_save["downloaded"] is True, fallback_save)

        print("\n--- PAGE ERRORS ---")
        for e in errors:
            print(e)
        print("--- CONSOLE ERRORS ---")
        for e in console_errors[:20]:
            print(e)
        browser.close()

    passed = sum(1 for _, ok, _ in RESULTS if ok)
    print(f"\nSummary: {passed}/{len(RESULTS)} passed | page errors: {len(errors)}")
    return 0 if passed == len(RESULTS) and not errors else 1


if __name__ == "__main__":
    sys.exit(main())
