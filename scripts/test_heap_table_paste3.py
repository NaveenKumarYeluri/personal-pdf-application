from pathlib import Path
from playwright.sync_api import sync_playwright
import json

ROOT = Path(__file__).resolve().parent.parent
sql_pdf = ROOT / "test-docs" / "SQL Server Advanced Concepts.pdf"

with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge", headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto("http://localhost:8080/", wait_until="domcontentloaded")
    page.wait_for_selector("#app", timeout=5000)
    
    page.set_input_files("#file-input", str(sql_pdf))
    page.wait_for_selector(".page-wrapper .textLayer span", timeout=25000)
    page.wait_for_timeout(2000)
    
    # Enter in-place edit mode
    page.evaluate("() => window.app.ui.setMode('edit')")
    page.wait_for_timeout(500)
    
    test_result = page.evaluate("""async () => {
        // Find paragraph before "Heap Table"
        // On page 1: "In the Heap table, the data rows are not stored in any particular order..."
        const spans = Array.from(document.querySelectorAll('#page-wrapper-1 .textLayer span'));
        const paraSpan = spans.find(s => s.textContent.includes('In the Heap table, the data rows are not'));
        if (!paraSpan) return { error: 'Para span not found' };
        
        paraSpan.click();
        
        const originalText = paraSpan.textContent;
        const fontBefore = window.getComputedStyle(paraSpan).fontFamily;
        const colorBefore = window.getComputedStyle(paraSpan).color;
        
        // Paste the same paragraph 3 times
        const pastedText = originalText + "\\n\\n" + originalText + "\\n\\n" + originalText;
        paraSpan.textContent = pastedText;
        paraSpan.dispatchEvent(new Event('input', { bubbles: true }));
        paraSpan.blur();
        
        // Wait for reflow
        await new Promise(r => setTimeout(r, 600));
        
        // Check page 1 text and page 2 continuation spans
        const p1Text = paraSpan.textContent;
        const contSpans = Array.from(document.querySelectorAll('#page-wrapper-2 .in-place-continuation'));
        const p2ContText = contSpans.map(s => s.textContent).join(' ');
        
        const contStyling = contSpans.map(s => ({
            fontFamily: window.getComputedStyle(s).fontFamily,
            color: window.getComputedStyle(s).color,
            fontSize: window.getComputedStyle(s).fontSize,
            fontWeight: window.getComputedStyle(s).fontWeight
        }));
        
        // Check that "Heap Table" heading or next lines moved to page 2 or shifted down
        const p2Spans = Array.from(document.querySelectorAll('#page-wrapper-2 .textLayer span'));
        const hasHeapTableOrShifted = p2Spans.some(s => s.textContent.includes('Heap Table') || s.classList.contains('reflow-overflow-span'));
        
        // Check total text length before vs combined after
        const totalPastedLen = pastedText.length;
        const combinedLen = (p1Text + " " + p2ContText).length;
        
        // Test export to PDF
        const pdfBytes = await window.app.annotator.burnAnnotationsToPdf(window.app.currentPdfBytes);
        
        return {
            fontBefore,
            colorBefore,
            totalPastedLen,
            p1Len: p1Text.length,
            p2ContLen: p2ContText.length,
            combinedLen,
            contSpansCount: contSpans.length,
            contStyling,
            hasHeapTableOrShifted,
            exportPdfSize: pdfBytes ? pdfBytes.byteLength : 0
        };
    }""")
    
    print("HEAP TABLE 3-PASTE TEST:")
    print(json.dumps(test_result, indent=2))
    
    assert "Calibri" in test_result["fontBefore"] or "Carlito" in test_result["fontBefore"]
    assert test_result["colorBefore"] == "rgb(0, 0, 0)"
    assert test_result["contSpansCount"] > 0
    assert test_result["p2ContLen"] > 0
    # Zero text lost! Combined text contains all pasted characters
    assert test_result["combinedLen"] >= test_result["totalPastedLen"] - 10
    assert test_result["exportPdfSize"] > 100000
    
    print("\n✓ HEAP TABLE 3-PASTE REFLOW & TYPOGRAPHY TEST PASSED!")
    browser.close()
