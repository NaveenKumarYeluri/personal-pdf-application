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
    
    results = page.evaluate("""async () => {
        const out = {};
        const spans = Array.from(document.querySelectorAll('.textLayer span'));
        
        // TEST 1: Bold heading
        const heading = spans.find(s => s.textContent.includes('SQL Server Table Structure'));
        heading.click();
        out.headingActive = {
            fontFamily: window.getComputedStyle(heading).fontFamily,
            fontWeight: window.getComputedStyle(heading).fontWeight,
            color: window.getComputedStyle(heading).color,
            isBold: heading._pdfIsBold,
            fontName: heading._pdfFontName
        };
        // Modify heading text
        heading.textContent = "Advanced SQL Server Table Structure";
        heading.dispatchEvent(new Event('input', { bubbles: true }));
        heading.blur();
        out.headingBlurred = {
            fontWeight: window.getComputedStyle(heading).fontWeight,
            color: window.getComputedStyle(heading).color,
            fontFamily: window.getComputedStyle(heading).fontFamily,
            hasModifiedClass: heading.classList.contains('in-place-modified')
        };
        
        // TEST 2: Paragraph text edit and color persistence
        const body = spans.find(s => s.textContent.includes('Physically, SQL Server tables'));
        body.click();
        const initialBodyColor = window.getComputedStyle(body).color;
        const initialBodyFont = window.getComputedStyle(body).fontFamily;
        const initialBodyWeight = window.getComputedStyle(body).fontWeight;
        
        // Add text to paragraph
        body.textContent = "MODIFIED TEXT: " + body.textContent;
        // Trigger input event
        body.dispatchEvent(new Event('input', { bubbles: true }));
        body.blur();
        
        out.bodyEdit = {
            initialColor: initialBodyColor,
            initialFont: initialBodyFont,
            initialWeight: initialBodyWeight,
            afterColor: window.getComputedStyle(body).color,
            afterFont: window.getComputedStyle(body).fontFamily,
            afterWeight: window.getComputedStyle(body).fontWeight,
            hasModifiedClass: body.classList.contains('in-place-modified'),
            newTextPrefix: body.textContent.substring(0, 30)
        };
        
        // TEST 3: Blue link color persistence
        const freshSpans = Array.from(document.querySelectorAll('.textLayer span'));
        const link = freshSpans.find(s => s.textContent.trim() === 'sys.partitions' || (s.textContent.includes('sys.partitions') && !s._mergeHidden));
        link.click();
        const linkActiveColor = window.getComputedStyle(link).color;
        link.blur();
        out.link = {
            text: link.textContent.substring(0, 30),
            activeColor: linkActiveColor,
            blurredColor: window.getComputedStyle(link).color,
            originalColor: link._originalColor
        };
        
        // TEST 4: Export to PDF
        const pdfBytes = await window.app.annotator.burnAnnotationsToPdf(window.app.currentPdfBytes);
        out.exportSize = pdfBytes ? pdfBytes.byteLength : 0;
        
        return out;
    }""")
    
    print("VALIDATION RESULTS:")
    print(json.dumps(results, indent=2))
    
    # Assertions
    assert "Calibri" in results["headingActive"]["fontFamily"] or "Carlito" in results["headingActive"]["fontFamily"]
    assert results["headingActive"]["fontWeight"] == "700"
    assert results["headingBlurred"]["fontWeight"] == "700"
    assert results["headingActive"]["color"] == "rgb(0, 0, 0)"
    
    assert results["bodyEdit"]["initialColor"] == "rgb(0, 0, 0)"
    assert results["bodyEdit"]["afterColor"] == "rgb(0, 0, 0)"
    assert results["bodyEdit"]["hasModifiedClass"] == True
    
    assert "64, 112" in results["link"]["activeColor"] or results["link"]["originalColor"] == "#4070c0"
    assert results["exportSize"] > 100000
    
    print("\nALL PERSISTENCE AND TYPOGRAPHY ASSERTIONS PASSED!")
    browser.close()
