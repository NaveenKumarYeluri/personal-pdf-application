from pathlib import Path
from playwright.sync_api import sync_playwright
import json

ROOT = Path(__file__).resolve().parent.parent
sql_pdf = ROOT / "test-docs" / "SQL Server Advanced Concepts.pdf"

with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge", headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto("http://localhost:8080/", wait_until="domcontentloaded")
    page.set_input_files("#file-input", str(sql_pdf))
    page.wait_for_selector(".page-wrapper[data-page-number='1'] .textLayer span", timeout=25000)
    page.wait_for_timeout(2000)
    
    page.evaluate("() => window.app.ui.setMode('edit')")
    page.wait_for_timeout(500)
    
    toolbar_sync = page.evaluate("""() => {
        const spans = Array.from(document.querySelectorAll('#page-wrapper-1 .textLayer span'));
        const boldSpan = spans.find(s => s.textContent.trim() === '8 KB pages');
        boldSpan.click();
        
        const boldBtn = document.getElementById('btn-edit-bold') || document.getElementById('btn-text-bold');
        const strongTag = boldSpan.querySelector('strong');
        
        // 1. Move selection inside <strong>
        const sel = window.getSelection();
        const r1 = document.createRange();
        r1.setStart(strongTag.firstChild, 2);
        r1.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r1);
        window.app.ui.syncInPlaceSpan(boldSpan);
        const boldActiveInStrong = boldBtn ? boldBtn.classList.contains('active') : null;
        
        // 2. Move selection outside <strong> (in normal text)
        const r2 = document.createRange();
        r2.setStart(boldSpan.firstChild, 2);
        r2.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r2);
        window.app.ui.syncInPlaceSpan(boldSpan);
        const boldActiveInNormal = boldBtn ? boldBtn.classList.contains('active') : null;
        
        return {
            hasStrong: !!strongTag,
            boldActiveInStrong,
            boldActiveInNormal
        };
    }""")
    print("TOOLBAR SYNC TEST RESULTS:")
    print(json.dumps(toolbar_sync, indent=2))
    
    browser.close()
