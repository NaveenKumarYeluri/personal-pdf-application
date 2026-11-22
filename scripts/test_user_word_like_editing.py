from pathlib import Path
from playwright.sync_api import sync_playwright
import json
import sys

ROOT = Path(__file__).resolve().parent.parent
sql_pdf = ROOT / "test-docs" / "SQL Server Advanced Concepts.pdf"

def run_test():
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.goto("http://localhost:8080/", wait_until="domcontentloaded")
        page.wait_for_selector("#app", timeout=5000)
        page.set_input_files("#file-input", str(sql_pdf))
        page.wait_for_selector(".page-wrapper[data-page-number='1'] .textLayer span", timeout=25000)
        page.wait_for_timeout(2000)

        # Switch to Edit mode
        page.evaluate("() => window.app.ui.setMode('edit')")
        page.wait_for_timeout(500)

        results = page.evaluate("""async () => {
            // STEP 1: Click paragraph 1 on Page 1
            const p1 = Array.from(document.querySelectorAll('#page-wrapper-1 .textLayer span')).find(s =>
                s.textContent.includes('Physically, SQL Server tables')
            );
            if (!p1) return { error: "Paragraph 1 not found" };

            p1.click();
            const active1 = document.querySelector('.inline-editing');
            const hasStrong = active1.innerHTML.includes('<strong') && active1.innerHTML.includes('8 KB pages');
            const p1Font = window.getComputedStyle(active1).fontFamily;
            const p1Weight = window.getComputedStyle(active1).fontWeight;
            const p1Color = window.getComputedStyle(active1).color;

            // Add single paragraph 3 times (multi-paragraph growth)
            const addedText = "\\n\\nFirst added paragraph with rich detail.\\n\\nSecond added paragraph with more detail.\\n\\nThird added paragraph expanding the content significantly.";
            active1.innerText += addedText;
            active1.dispatchEvent(new Event('input', { bubbles: true }));

            // Wait for reflow
            await new Promise(r => setTimeout(r, 600));

            // STEP 2: Without clicking any menu, immediately click another paragraph on Page 1 ("In the Heap table")
            const p2 = Array.from(document.querySelectorAll('#page-wrapper-1 .textLayer span')).find(s =>
                s.textContent.includes('In the Heap table') || s.textContent.includes('Heap Table')
            );
            if (!p2) return { error: "Paragraph 2 on Page 1 not found" };

            p2.click();
            const active2 = document.querySelector('.inline-editing');
            const p2ClickSuccess = !!active2 && (active2.textContent.includes('Heap') || active2.textContent.includes('data rows'));
            const p1Committed = !p1.classList.contains('inline-editing') && p1.classList.contains('in-place-modified');
            const p1FullText = p1._fullReflowText || p1.innerText || p1.textContent;
            const p1HasAdded = p1FullText.includes('Third added paragraph expanding');

            // STEP 3: Click an overflow paragraph on Page 2
            const pw2 = document.getElementById('page-wrapper-2');
            const overflowSpanP2 = pw2.querySelector('.reflow-overflow-span');
            let p2OverflowClickSuccess = false;
            let overflowSpanSurvivesInput = false;

            if (overflowSpanP2) {
                overflowSpanP2.click();
                const activeOverflow = document.querySelector('.inline-editing');
                const isSame = (activeOverflow === overflowSpanP2);
                p2OverflowClickSuccess = !!activeOverflow;

                // Type in the overflow span and ensure reflow does NOT destroy it
                if (activeOverflow) {
                    activeOverflow.innerText += " (overflow edited live)";
                    activeOverflow.dispatchEvent(new Event('input', { bubbles: true }));
                    await new Promise(r => setTimeout(r, 400));
                    const activeAfterInput = document.querySelector('.inline-editing');
                    overflowSpanSurvivesInput = !!activeAfterInput && activeAfterInput.isConnected;
                    activeOverflow.blur();
                }
            }

            // STEP 4: Check bottom padding limits on Page 1 (check canvas pixels in bottom 35px margin)
            const c1 = document.getElementById('page-canvas-1');
            const ctx1 = c1.getContext('2d');
            const w1 = c1.width;
            const h1 = c1.height;
            const bottomMarginH = Math.round(h1 * 0.035);
            const imgData = ctx1.getImageData(0, h1 - bottomMarginH, w1, bottomMarginH).data;
            let bottomInkPixels = 0;
            for (let i = 0; i < imgData.length; i += 4) {
                const r = imgData[i], g = imgData[i + 1], b = imgData[i + 2], a = imgData[i + 3];
                if (a > 30 && (r < 235 || g < 235 || b < 235)) {
                    bottomInkPixels++;
                }
            }

            // STEP 5: Export PDF and verify integrity
            const exportedBytes = await window.app.annotator.burnAnnotationsToPdf(window.app.currentPdfBytes);

            return {
                hasStrong,
                p1Font,
                p1Weight,
                p1Color,
                p2ClickSuccess,
                p1Committed,
                p1HasAdded,
                hasOverflowOnP2: !!overflowSpanP2,
                p2OverflowClickSuccess,
                overflowSpanSurvivesInput,
                bottomInkPixels,
                exportedPdfSize: exportedBytes ? exportedBytes.byteLength : 0
            };
        }""")

        print("USER WORD-LIKE EDITING VERIFICATION RESULTS:")
        print(json.dumps(results, indent=2))

        assert results["hasStrong"], "Bold inline style must be preserved on paragraph pick!"
        assert results["p2ClickSuccess"], "Subsequent paragraph click MUST succeed immediately without switching menus!"
        assert results["p1Committed"], "Previous paragraph MUST commit cleanly upon clicking another paragraph!"
        assert results["p1HasAdded"], "No text lost: added paragraphs MUST be preserved!"
        assert results["hasOverflowOnP2"], "Content must cascade to Page 2 when overflow occurs!"
        assert results["p2OverflowClickSuccess"], "Overflow span on Page 2 must be clickable and editable!"
        assert results["overflowSpanSurvivesInput"], "Overflow span must survive reflow and maintain active typing!"
        assert results["bottomInkPixels"] == 0, "A4 bottom padding limit must be 100% respected (zero ink in bottom margin)!"
        assert results["exportedPdfSize"] > 500000, "Exported PDF must be valid and non-empty!"

        print("\n🎉 ALL USER REQUIREMENTS VERIFIED AND PASSED!")
        browser.close()

if __name__ == "__main__":
    run_test()
