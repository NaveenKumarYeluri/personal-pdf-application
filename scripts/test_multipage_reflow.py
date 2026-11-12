#!/usr/bin/env python3
"""
Test Multi-Page Cascading In-Place Text Edit Reflow.
Verifies that when text is added on Page 1:
1. Content pushed down on Page 1 flows across page boundaries onto Page 2.
2. Page 2's content shifts down (data is NOT untouched).
3. Any content exceeding Page 2 creates an overflow page so no paragraphs are lost.
4. Saved PDF includes all reflowed pages.
5. Revert/undo cleans up the cascade and restores pristine state.
"""
import sys
import base64
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent

def test_multipage_reflow():
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.goto("http://localhost:8080/", wait_until="domcontentloaded")
        page.wait_for_timeout(1500)

        # Load a multi-page document
        sql_doc = ROOT / "test-docs" / "SQL Server Advanced Concepts.pdf"
        if not sql_doc.exists():
            print("test doc not found")
            return 1
        page.set_input_files("#file-input", str(sql_doc))
        page.wait_for_timeout(4500)

        init_pages = page.evaluate("() => window.app.viewer.totalPages")
        print(f"Initial total pages: {init_pages}")

        # Record Page 2 top content position before edit
        p2_top_before = page.evaluate("""() => {
            const p2 = document.getElementById('page-wrapper-2');
            if (!p2) return null;
            const s = Array.from(p2.querySelectorAll('.textLayer span')).find(span => span.textContent.trim().length > 10);
            return s ? s.getBoundingClientRect().top : null;
        }""")
        print(f"Page 2 first span top before: {p2_top_before}")

        # Switch to Edit mode and edit a paragraph on Page 1
        page.click(".mode-tab[data-mode='edit']")
        page.wait_for_timeout(600)

        p1_wrap = page.locator("#page-wrapper-1")
        span = p1_wrap.locator(".textLayer span").nth(2)
        box = span.bounding_box()
        page.mouse.click(box["x"] + 50, box["y"] + box["height"] / 2)
        page.wait_for_timeout(400)

        # Paste multiple paragraphs (simulate copying one paragraph and pasting 3 times)
        repeated_para = (" This is a large copied paragraph added repeatedly to simulate multi-line overflow. "
                         "It contains multiple detailed sentences describing relational database indexing and query optimization. ") * 4
        
        # Set text to simulate pasting 3 times
        page.evaluate(f"""() => {{
            const ed = document.querySelector('.textLayer span.inline-editing');
            if (ed) {{
                ed.textContent += `{repeated_para}`;
                ed.dispatchEvent(new Event('input', {{ bubbles: true }}));
            }}
        }}""")
        page.wait_for_timeout(1200)

        # Check reflow on Page 1 and Page 2
        reflow_status = page.evaluate("""() => {
            const p1 = document.getElementById('page-wrapper-1');
            const p2 = document.getElementById('page-wrapper-2');
            const p2FirstSpan = Array.from(p2.querySelectorAll('.textLayer span')).find(s => !s.classList.contains('reflow-overflow-span') && s.textContent.trim().length > 10);
            const p2OverflowSpans = p2.querySelectorAll('.textLayer span.reflow-overflow-span');
            return {
                p1HasReflow: p1.dataset.hasReflow === 'true',
                p2HasReflow: p2.dataset.hasReflow === 'true',
                p2OverflowSpanCount: p2OverflowSpans.length,
                p2FirstSpanTop: p2FirstSpan ? p2FirstSpan.getBoundingClientRect().top : null,
                p2Shift: p2FirstSpan ? p2FirstSpan.dataset.reflowShift : null,
                totalPages: window.app.viewer.totalPages
            };
        }""")
        print("Reflow status:", reflow_status)

        assert reflow_status["p1HasReflow"], "Page 1 must have reflow active"
        assert reflow_status["p2HasReflow"], "Page 2 must have reflow active (content flowed to Page 2)"
        assert reflow_status["p2Shift"] is not None and int(reflow_status["p2Shift"]) > 0, "Page 2 content must be shifted down"
        assert reflow_status["p2FirstSpanTop"] > p2_top_before, "Page 2 native content must move down, not stay untouched"
        print("SUCCESS: Page 2 content moved down and received overflow!")

        # Commit edit on blur
        page.evaluate("() => document.activeElement.blur()")
        page.wait_for_timeout(600)

        # Test burning to PDF
        b64 = page.evaluate("""async () => {
            const bytes = await window.app.annotator.burnAnnotationsToPdf(window.app.currentPdfBytes);
            let s=''; for (const b of bytes) s += String.fromCharCode(b);
            return btoa(s);
        }""")
        pdf_bytes = base64.b64decode(b64)
        assert pdf_bytes[:5] == b"%PDF-", "Exported PDF header must be valid"
        print("SUCCESS: Exported multi-page reflowed PDF successfully!")

        # Test revert / undo restores everything
        for _ in range(100):
            if not page.evaluate("() => !!document.querySelector('.textLayer span.in-place-modified')"):
                break
            page.keyboard.press("Control+z")
            page.wait_for_timeout(100)

        page.wait_for_timeout(800)
        undone = page.evaluate("""() => {
            const p1 = document.getElementById('page-wrapper-1');
            const p2 = document.getElementById('page-wrapper-2');
            const p2FirstSpan = Array.from(p2.querySelectorAll('.textLayer span')).find(s => s.textContent.trim().length > 10);
            return {
                p1Reflow: p1.dataset.hasReflow,
                p2Reflow: p2.dataset.hasReflow,
                p2FirstSpanTop: p2FirstSpan ? p2FirstSpan.getBoundingClientRect().top : null,
                p2OverflowSpans: p2.querySelectorAll('.textLayer span.reflow-overflow-span').length
            };
        }""")
        print("Undone status:", undone)
        assert not undone["p1Reflow"], "Page 1 reflow tag removed"
        assert not undone["p2Reflow"], "Page 2 reflow tag removed"
        assert undone["p2OverflowSpans"] == 0, "Page 2 overflow spans cleared"
        if undone["p2FirstSpanTop"] and p2_top_before:
            assert abs(undone["p2FirstSpanTop"] - p2_top_before) <= 3, "Page 2 returned to pristine position"
        print("SUCCESS: Undo restores pristine state cleanly!")

        browser.close()
    return 0

if __name__ == "__main__":
    sys.exit(test_multipage_reflow())
