import json
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge", headless=True)
    page = b.new_page(viewport={"width": 1440, "height": 900})
    errs=[]
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8080/", wait_until="domcontentloaded")
    page.wait_for_timeout(1200)
    page.click("#btn-load-sample")
    page.wait_for_timeout(3500)
    page.click(".mode-tab[data-mode='edit']")
    page.wait_for_timeout(500)
    info = page.evaluate("""() => {
      const spans=[...document.querySelectorAll('.page-wrapper:first-of-type .textLayer span')];
      return spans.slice(0,8).map(s=>({text:s.textContent, cls:s.className, html:s.outerHTML.slice(0,200), rect:s.getBoundingClientRect().toJSON()}));
    }""")
    print(json.dumps(info, indent=2)[:4000])
    print("body:", page.evaluate("() => document.body.className"))
    print("toolbar:", page.inner_text("#dynamic-mode-tools"))
    page.screenshot(path="test-output/05-edit-mode.png", full_page=False)
    print("errs:", errs)
    b.close()
