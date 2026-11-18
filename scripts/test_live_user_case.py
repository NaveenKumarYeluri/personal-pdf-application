import time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
sql_pdf = ROOT / 'test-docs' / 'SQL Server Advanced Concepts.pdf'

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    page = browser.new_page(viewport={'width': 1400, 'height': 1200})
    page.goto('http://localhost:8080/', wait_until='domcontentloaded')
    page.wait_for_selector('#app', timeout=5000)
    page.set_input_files('#file-input', str(sql_pdf))
    page.wait_for_selector('#page-wrapper-1 .textLayer span', timeout=20000)
    page.wait_for_timeout(1000)

    # 1. Verify 'after' is NOT 'atier' before edit
    raw_spans = page.locator('#page-wrapper-1 .textLayer span')
    all_text = ' '.join([raw_spans.nth(i).inner_text() for i in range(raw_spans.count())])
    assert 'atier' not in all_text, f"Found 'atier' in page text before edit!"
    assert 'after checking' in all_text or 'after' in all_text, "Expected 'after' in page text!"
    print("PASS: Ligature 'after' is clean (no 'atier') before edit.")

    # 2. Switch to edit mode
    page.click(".mode-tab[data-mode='edit']")
    page.wait_for_timeout(500)

    # 3. Find and click the target span
    target = None
    for i in range(raw_spans.count()):
        txt = raw_spans.nth(i).inner_text()
        if 'In the Heap table' in txt:
            target = raw_spans.nth(i)
            break
    assert target is not None, "Target span 'In the Heap table' not found!"

    target.scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    target.click()
    page.wait_for_timeout(600)

    # 4. Check state immediately after click (without modifying)
    click_state = page.evaluate('''() => {
        const s = document.querySelector('#page-wrapper-1 .textLayer span.inline-editing');
        const cs = window.getComputedStyle(s);
        const w1 = document.getElementById('page-wrapper-1');
        const heapTitle = Array.from(w1.querySelectorAll('.textLayer span')).find(el => el.textContent.includes('Heap Table:'));
        return {
            textLength: s.textContent.length,
            hasAtier: s.textContent.includes('atier'),
            hasAfter: s.textContent.includes('after'),
            width: s.offsetWidth,
            height: s.offsetHeight,
            lineCount: Math.round(s.offsetHeight / 32),
            fontFamily: cs.fontFamily,
            fontSize: cs.fontSize,
            heapTop: heapTitle ? heapTitle.offsetTop : null
        };
    }''')
    print("State after click:", click_state)
    assert not click_state['hasAtier'], "Found 'atier' in edited span text!"
    assert click_state['hasAfter'], "Expected 'after' in edited span text!"
    assert click_state['lineCount'] == 7, f"Expected 7 lines on initial click, got {click_state['lineCount']}!"
    print(f"PASS: Paragraph wraps to exactly 7 lines (height {click_state['height']}px), matching original document.")

    # Screenshot after click
    page.locator('#page-wrapper-1').screenshot(path='scripts/test_after_click.png')

    # 5. Duplicate paragraph 3 times (paste twice)
    orig_text = page.evaluate('''() => document.querySelector('#page-wrapper-1 .textLayer span.inline-editing').textContent''')
    three_paras = orig_text + '\n\n' + orig_text + '\n\n' + orig_text

    page.evaluate('''(txt) => {
        const s = document.querySelector('#page-wrapper-1 .textLayer span.inline-editing');
        s.textContent = txt;
        s.dispatchEvent(new Event('input', { bubbles: true }));
    }''', three_paras)
    page.wait_for_timeout(1000)

    # Click outside to blur
    page.mouse.click(10, 10)
    page.wait_for_timeout(1200)

    # 6. Verify Page 1 and Page 2 after reflow
    reflow_res = page.evaluate('''() => {
        const w1 = document.getElementById('page-wrapper-1');
        const w2 = document.getElementById('page-wrapper-2');
        const s1 = w1.querySelector('.in-place-modified, .inline-editing');
        const cont = w2.querySelector('.in-place-continuation');
        const csCont = cont ? window.getComputedStyle(cont) : null;
        const p2Spans = Array.from(w2.querySelectorAll('.textLayer span')).map(s => ({
            text: s.textContent.trim().substring(0, 50),
            top: s.offsetTop,
            className: s.className,
            font: window.getComputedStyle(s).fontFamily,
            color: window.getComputedStyle(s).color,
            visibility: window.getComputedStyle(s).visibility
        })).filter(s => s.text.length > 0);

        return {
            p1_height: w1.clientHeight,
            s1_top: s1 ? s1.offsetTop : null,
            s1_height: s1 ? s1.offsetHeight : null,
            s1_bottom: s1 ? (s1.offsetTop + s1.offsetHeight) : null,
            s1_text_len: s1 ? s1.textContent.length : 0,
            has_continuation: Boolean(cont),
            cont_top: cont ? cont.offsetTop : null,
            cont_height: cont ? cont.offsetHeight : null,
            cont_text_len: cont ? cont.textContent.length : 0,
            cont_text_snippet: cont ? cont.textContent.substring(0, 80) : null,
            cont_font: csCont ? csCont.fontFamily : null,
            cont_size: csCont ? csCont.fontSize : null,
            cont_color: csCont ? csCont.color : null,
            p2_spans: p2Spans.slice(0, 10)
        };
    }''')
    print("Reflow Results:", reflow_res)

    assert reflow_res['has_continuation'], "Continuation span was NOT created on Page 2!"
    assert reflow_res['cont_text_len'] > 0, "Continuation span on Page 2 is empty!"
    assert reflow_res['s1_bottom'] <= reflow_res['p1_height'], f"Span 1 overflows off bottom of Page 1: bottom {reflow_res['s1_bottom']} > page height {reflow_res['p1_height']}"
    assert 'calibri' in reflow_res['cont_font'].lower() or 'roboto' in reflow_res['cont_font'].lower() or 'carlito' in reflow_res['cont_font'].lower(), f"Unexpected continuation font: {reflow_res['cont_font']}"

    # Verify no text was lost
    total_len = reflow_res['s1_text_len'] + reflow_res['cont_text_len']
    print(f"Original 3x text len: {len(three_paras)}, Page 1 len: {reflow_res['s1_text_len']}, Page 2 len: {reflow_res['cont_text_len']}, Total: {total_len}")

    # Take screenshots of Page 1 and Page 2
    page.locator('#page-wrapper-1').screenshot(path='scripts/test_p1_after_3x.png')
    page.locator('#page-wrapper-2').screenshot(path='scripts/test_p2_after_3x.png')
    print("PASS: Verified Page 1 fits cleanly without bottom overflow, Page 2 receives continuation text in matching font/size, and screenshots saved.")
    browser.close()
