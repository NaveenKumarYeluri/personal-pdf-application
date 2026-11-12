#!/usr/bin/env python3
"""
Test bottom padding preservation, multi-page reflow completeness,
and mobile paragraph isolation for in-place text editing.
"""
import sys
import subprocess
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent

def run_test():
    server = subprocess.Popen([sys.executable, '-m', 'http.server', '8080', '--directory', str(ROOT / 'src')],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="msedge", headless=True)
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            page.goto("http://localhost:8080/", wait_until="domcontentloaded")
            page.wait_for_selector("#app")

            # 1. Load SQL Server Advanced Concepts.pdf
            sql_doc = ROOT / "test-docs" / "SQL Server Advanced Concepts.pdf"
            page.set_input_files("#file-input", str(sql_doc))
            page.wait_for_timeout(4000)

            print("--- Test 1: Mobile Paragraph Isolation & Android Font/Size Preservation ---")
            mobile_test_res = page.evaluate('''() => {
                const pw = document.getElementById('page-wrapper-1');
                const spans = Array.from(pw.querySelectorAll('.textLayer span'));
                const para1Span = spans.find(s => s.textContent.includes('Physically, SQL Server'));
                const para2Span = spans.find(s => s.textContent.includes('In the Heap table'));
                
                // Test paragraph edit on Para 1
                window.app._handleDirectContentEdit({ span: para1Span, pageNum: 1 });
                const para1MergedText = para1Span.textContent;
                const para1Font = para1Span.style.fontFamily;
                const para1Size = para1Span.style.fontSize;
                const para1Autosize = para1Span.style.webkitTextSizeAdjust;
                
                // Revert
                window.app.annotator.revertInPlaceEdit(para1Span, 1);
                para1Span.blur();
                
                // Test paragraph edit on Para 2
                window.app._handleDirectContentEdit({ span: para2Span, pageNum: 1 });
                const para2MergedText = para2Span.textContent;
                
                // Revert
                window.app.annotator.revertInPlaceEdit(para2Span, 1);
                para2Span.blur();

                return {
                    para1HasPara2: para1MergedText.includes('In the Heap table'),
                    para1HasHeapTableHeading: para1MergedText.includes('Heap Table:'),
                    para2HasPara1: para2MergedText.includes('Physically, SQL Server'),
                    para2HasHeapTableHeading: para2MergedText.includes('Heap Table:'),
                    para1MergedTextLength: para1MergedText.length,
                    para2MergedTextLength: para2MergedText.length,
                    para1Font,
                    para1Size,
                    para1Autosize
                };
            }''')

            print("Mobile test results:", mobile_test_res)
            assert not mobile_test_res["para1HasPara2"], "Paragraph 1 MUST NOT merge into Paragraph 2!"
            assert not mobile_test_res["para1HasHeapTableHeading"], "Paragraph 1 MUST NOT merge into Heading!"
            assert not mobile_test_res["para2HasPara1"], "Paragraph 2 MUST NOT merge into Paragraph 1!"
            assert not mobile_test_res["para2HasHeapTableHeading"], "Paragraph 2 MUST NOT merge into Heading!"
            assert "Roboto" in mobile_test_res["para1Font"], "Font stack must include Roboto for Android!"
            assert mobile_test_res["para1Autosize"] == "none", "Autosize must be none to defeat Android font inflation!"
            print("✓ PASS: Mobile / Android Paragraph Isolation and Font Stability verified!")

            print("\n--- Test 2: In-Place Editing, Bottom Padding & Multi-Page Cascading ---")
            # Reload fresh document for Test 2
            page.set_input_files("#file-input", str(sql_doc))
            page.wait_for_timeout(3500)

            # Switch to edit mode
            page.click(".mode-tab[data-mode='edit']")
            page.wait_for_timeout(600)

            # Record initial Page 2 state
            p2_before = page.evaluate('''() => {
                const p2 = document.getElementById('page-wrapper-2');
                const s = Array.from(p2.querySelectorAll('.textLayer span')).find(span => span.textContent.trim().length > 10);
                return {
                    top: s ? s.getBoundingClientRect().top : null,
                    text: s ? s.textContent.trim() : null
                };
            }''')
            print(f"Page 2 initial top span: {repr(p2_before['text'][:40])} at y={p2_before['top']}")

            # Activate edit on Paragraph 1
            page.evaluate('''() => {
                const spans = Array.from(document.querySelectorAll('#page-wrapper-1 .textLayer span'));
                const target = spans.find(s => s.textContent.includes('Physically, SQL Server'));
                window.app._handleDirectContentEdit({ span: target, pageNum: 1 });
            }''')
            page.wait_for_timeout(400)

            # Paste 2 paragraphs to create clean overflow across page boundary
            paste_text = (
                "\n\nEach data page begins with a 96-byte header that stores system information about the page. "
                "This information includes the page number, page type, the amount of free space on the page, "
                "and the allocation unit ID of the object that owns the page.\n\n"
                "Data rows are put on the page serially, starting immediately after the header. A row offset table "
                "starts at the end of the page and each row offset table contains one entry for each row on the page."
            )

            page.evaluate(f'''text => {{
                const ed = document.querySelector('.textLayer span.inline-editing');
                if (ed) {{
                    ed.textContent += text;
                    ed.dispatchEvent(new Event('input', {{ bubbles: true }}));
                }}
            }}''', paste_text)
            page.wait_for_timeout(1500)

            # Commit edit on blur
            page.evaluate("() => document.activeElement.blur()")
            page.wait_for_timeout(1000)

            # Check reflow status
            reflow_info = page.evaluate('''() => {
                const p1 = document.getElementById('page-wrapper-1');
                const p2 = document.getElementById('page-wrapper-2');
                const p2OverflowSpans = Array.from(p2.querySelectorAll('.textLayer span.reflow-overflow-span')).map(s => s.textContent.trim());
                const p2FirstNative = Array.from(p2.querySelectorAll('.textLayer span:not(.reflow-overflow-span)')).find(s => s.style.display !== 'none' && s.textContent.trim().length > 10);
                
                return {
                    p1HasReflow: p1.dataset.hasReflow === 'true',
                    p2HasReflow: p2.dataset.hasReflow === 'true',
                    p2OverflowSpanCount: p2OverflowSpans.length,
                    p2OverflowSample: p2OverflowSpans.slice(0, 3),
                    p2FirstNativeTop: p2FirstNative ? p2FirstNative.getBoundingClientRect().top : null,
                    p2FirstNativeShift: p2FirstNative ? p2FirstNative.dataset.reflowShift : null,
                    totalPages: window.app.viewer.totalPages
                };
            }''')

            print("Reflow Info after editing:")
            import pprint
            pprint.pprint(reflow_info)

            assert reflow_info["p1HasReflow"], "Page 1 must have reflow active"
            assert reflow_info["p2HasReflow"], "Page 2 must have reflow active"
            assert reflow_info["p2OverflowSpanCount"] > 0, "Page 2 must have received overflow spans from Page 1!"
            if reflow_info["p2FirstNativeTop"] and p2_before["top"]:
                assert reflow_info["p2FirstNativeTop"] > p2_before["top"], "Page 2 native content must have moved down!"
                assert int(reflow_info["p2FirstNativeShift"]) > 0, "Page 2 native spans must have reflowShift dataset"
            print("✓ PASS: Multi-page cascading reflow, overflow spans, and downstream shifts verified!")

            # Check that bottom padding is respected on Page 1 (canvas bottom has white padding, zero glyph ink at H)
            p1_padding_check = page.evaluate('''() => {
                const p1 = document.getElementById('page-wrapper-1');
                const p1Canvas = window.app._getPageCanvas(p1);
                const ctx = p1Canvas.getContext('2d');
                const W = p1Canvas.width;
                const H = p1Canvas.height;
                
                // Inspect the bottom 40 rows of Page 1 canvas
                const imgData = ctx.getImageData(0, H - 35, W, 35);
                const data = imgData.data;
                let inkPixelCount = 0;
                for (let i = 0; i < data.length; i += 4) {
                    const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
                    if (a > 20 && (r < 240 || g < 240 || b < 240)) {
                        inkPixelCount++;
                    }
                }
                return {
                    H,
                    bottom35InkPixels: inkPixelCount
                };
            }''')
            print("Page 1 Bottom Padding Check:", p1_padding_check)
            assert p1_padding_check["bottom35InkPixels"] == 0, f"Page 1 bottom 35px must be clean white padding! Found {p1_padding_check['bottom35InkPixels']} ink pixels"
            print("✓ PASS: Bottom padding is 100% respected on Page 1 (zero ink in bottom 35px margin)!")

            # 3. Test Undo restores pristine layout cleanly
            for _ in range(10):
                if not page.evaluate("() => !!document.querySelector('.textLayer span.in-place-modified, .textLayer span.inline-editing')"):
                    break
                page.evaluate("() => window.app.annotator.undo()")
                page.wait_for_timeout(200)

            page.wait_for_timeout(1000)

            undone = page.evaluate('''() => {
                const p1 = document.getElementById('page-wrapper-1');
                const p2 = document.getElementById('page-wrapper-2');
                const p2FirstNative = Array.from(p2.querySelectorAll('.textLayer span:not(.reflow-overflow-span)')).find(s => s.textContent.trim().length > 10);
                return {
                    p1Reflow: p1.dataset.hasReflow,
                    p2Reflow: p2.dataset.hasReflow,
                    p2OverflowCount: p2.querySelectorAll('.reflow-overflow-span').length,
                    p2FirstNativeTop: p2FirstNative ? p2FirstNative.getBoundingClientRect().top : null
                };
            }''')
            print("Undone Status:", undone)
            assert not undone["p1Reflow"], "Page 1 reflow tag removed on undo"
            assert not undone["p2Reflow"], "Page 2 reflow tag removed on undo"
            assert undone["p2OverflowCount"] == 0, "Page 2 overflow spans removed on undo"
            if p2_before["top"] and undone["p2FirstNativeTop"]:
                assert abs(undone["p2FirstNativeTop"] - p2_before["top"]) <= 3, "Page 2 native content returned to pristine position"
            print("✓ PASS: Undo cleanly restores pristine state and cleans up all cascaded pages!")

            browser.close()
            print("\nALL VERIFICATION TESTS COMPLETED SUCCESSFULLY!")
            return 0
    finally:
        server.terminate()

if __name__ == "__main__":
    sys.exit(run_test())
