import json
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge", headless=True)
    page = b.new_page(viewport={"width": 1440, "height": 900})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8080/", wait_until="domcontentloaded")
    page.wait_for_timeout(1200)
    page.click("#btn-load-sample")
    page.wait_for_timeout(3500)

    # annotate pen
    page.click(".mode-tab[data-mode='annotate']")
    page.wait_for_timeout(400)
    page.click("#tool-pen")
    canvas = page.locator(".page-wrapper").first.locator("canvas[id^='annot-canvas-']").first
    cb = canvas.bounding_box()
    page.mouse.move(cb["x"]+100, cb["y"]+100); page.mouse.down()
    page.mouse.move(cb["x"]+300, cb["y"]+200, steps=10); page.mouse.up()
    page.wait_for_timeout(300)

    # textbox
    page.click("#tool-text")
    page.mouse.click(cb["x"]+100, cb["y"]+300)
    page.wait_for_timeout(300)
    page.keyboard.type("Zoom persistence text")
    page.mouse.click(cb["x"]+700, cb["y"]+700)
    page.wait_for_timeout(300)

    # stamp
    page.select_option("#annot-stamp", "APPROVED")
    page.wait_for_timeout(500)

    # sticky note
    page.click("#tool-note")
    page.mouse.click(cb["x"]+400, cb["y"]+350)
    page.wait_for_timeout(500)

    def state(label):
        s = page.evaluate("""() => {
          const ac = document.getElementById('annot-canvas-1');
          let painted = 0;
          if (ac) {
            const d = ac.getContext('2d').getImageData(0,0,ac.width,ac.height).data;
            for (let i=3;i<d.length;i+=4) if (d[i]>0) { painted++; if (painted>50) break; }
          }
          return {
            textboxes: document.querySelectorAll('.annotation-textbox').length,
            stamps: document.querySelectorAll('.placed-stamp').length,
            notes: document.querySelectorAll('.sticky-note-container').length,
            whiteouts: document.querySelectorAll('.whiteout-box').length,
            strokes: (window.app.annotator.annotations.get(1)||[]).length,
            painted,
            totalPages: window.app.viewer.totalPages,
            scale: window.app.viewer.scale
          };
        }""")
        print(label, json.dumps(s))
        return s

    before = state("BEFORE")
    page.select_option("#zoom-select", "1.50")
    page.wait_for_timeout(2500)
    after_zoom = state("AFTER ZOOM")
    page.click("#btn-rotate-cw")
    page.wait_for_timeout(2500)
    after_rot = state("AFTER ROTATE")
    page.screenshot(path="test-output/11-after-zoom-rotate.png")
    print("errors", errs)
    b.close()
