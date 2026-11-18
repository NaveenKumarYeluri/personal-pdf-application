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
    page.wait_for_selector(".page-wrapper[data-page-number='1'] .textLayer span", timeout=25000)
    page.wait_for_timeout(2000)
    
    page.evaluate("() => window.app.ui.setMode('edit')")
    page.wait_for_timeout(500)
    
    test_results = page.evaluate("""() => {
        const spans = Array.from(document.querySelectorAll('#page-wrapper-1 .textLayer span'));
        
        // 1. Click specifically on bold span "8 KB pages"
        const boldSpan = spans.find(s => s.textContent.trim() === '8 KB pages');
        let boldClickResult = null;
        if (boldSpan) {
            boldSpan.click();
            const strongTag = boldSpan.querySelector('strong');
            boldClickResult = {
                containerWeight: window.getComputedStyle(boldSpan).fontWeight,
                containerStyle: window.getComputedStyle(boldSpan).fontStyle,
                containerColor: window.getComputedStyle(boldSpan).color,
                hasStrongTag: !!strongTag,
                strongText: strongTag ? strongTag.textContent : null,
                strongWeight: strongTag ? window.getComputedStyle(strongTag).fontWeight : null,
                isFullParaBold: window.getComputedStyle(boldSpan).fontWeight === '700' && boldSpan.textContent.length > 50,
                fullTextSample: boldSpan.textContent.substring(0, 80)
            };
            boldSpan.blur();
        }
        
        // 2. Click on heading "Physical Implementation:"
        const headSpan = spans.find(s => s.textContent.includes('Physical Implementation:'));
        let headClickResult = null;
        if (headSpan) {
            headSpan.click();
            headClickResult = {
                text: headSpan.textContent.trim(),
                swallowedNextLine: headSpan.textContent.includes('Physically, SQL Server tables')
            };
            headSpan.blur();
        }
        
        // 3. Click on heading "Heap Table:"
        const heapSpan = spans.find(s => s.textContent.trim() === 'Heap Table:');
        let heapClickResult = null;
        if (heapSpan) {
            heapSpan.click();
            heapClickResult = {
                text: heapSpan.textContent.trim(),
                swallowedNextLine: heapSpan.textContent.includes('When you store data')
            };
            heapSpan.blur();
        }

        // 4. Click on span with sys.partitions (blue link / object)
        const sysSpan = spans.find(s => s.textContent.includes('sys.partitions'));
        let sysClickResult = null;
        if (sysSpan) {
            sysSpan.click();
            const coloredSub = sysSpan.querySelector('span[style*="color"]');
            sysClickResult = {
                containerColor: window.getComputedStyle(sysSpan).color,
                hasColoredSpan: !!coloredSub,
                coloredSpanText: coloredSub ? coloredSub.textContent : null,
                coloredSpanColor: coloredSub ? coloredSub.style.color : null,
                isFullParaColored: window.getComputedStyle(sysSpan).color !== 'rgb(0, 0, 0)' && sysSpan.textContent.length > 50,
                fullTextSample: sysSpan.textContent.substring(0, 80)
            };
            sysSpan.blur();
        }
        
        return {
            boldClickResult,
            headClickResult,
            heapClickResult,
            sysClickResult
        };
    }""")
    
    print("NEW BEHAVIOR TEST RESULTS:")
    print(json.dumps(test_results, indent=2))
        
    browser.close()
