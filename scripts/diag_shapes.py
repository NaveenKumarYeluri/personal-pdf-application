#!/usr/bin/env python3
"""Diagnostic: can the eraser remove shapes when clicking their outline?"""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge", headless=True)
    page = b.new_page(viewport={"width": 1440, "height": 900})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8080/", wait_until="domcontentloaded")
    page.wait_for_timeout(1500)
    page.evaluate("() => window.app.loadSamplePDF()")
    page.wait_for_timeout(3000)

    page.click(".mode-tab[data-mode='annotate']")
    page.wait_for_timeout(400)
    canvas = page.locator(".page-wrapper").first.locator("canvas[id^='annot-canvas-']").first
    cb = canvas.bounding_box()

    def draw(tool, x1, y1, x2, y2):
        page.click(f"#tool-{tool}")
        page.wait_for_timeout(200)
        page.mouse.move(cb["x"] + x1, cb["y"] + y1)
        page.mouse.down()
        page.mouse.move(cb["x"] + x2, cb["y"] + y2, steps=8)
        page.mouse.up()
        page.wait_for_timeout(250)
        return page.evaluate("() => (window.app.annotator.annotations.get(1)||[]).map(a=>a.type)")

    def erase(x, y):
        page.click("#tool-eraser")
        page.wait_for_timeout(200)
        page.mouse.click(cb["x"] + x, cb["y"] + y)
        page.wait_for_timeout(250)
        return page.evaluate("() => (window.app.annotator.annotations.get(1)||[]).map(a=>a.type)")

    print("rect drawn:", draw("rect", 100, 100, 300, 200))
    print("erase rect top-edge middle:", erase(200, 100))
    print("rect count after edge erase:", page.evaluate("() => (window.app.annotator.annotations.get(1)||[]).length"))

    print("circle drawn:", draw("circle", 100, 300, 300, 400))
    print("erase circle left-edge middle:", erase(100, 350))
    print("circle count after edge erase:", page.evaluate("() => (window.app.annotator.annotations.get(1)||[]).length"))

    print("line drawn:", draw("line", 400, 100, 500, 300))
    print("erase line middle:", erase(450, 200))
    print("line count after edge erase:", page.evaluate("() => (window.app.annotator.annotations.get(1)||[]).length"))

    # Shapes must remain erasable after zooming (coordinates are rescaled).
    page.click("#tool-rect")
    page.wait_for_timeout(200)
    page.mouse.move(cb["x"] + 100, cb["y"] + 450)
    page.mouse.down()
    page.mouse.move(cb["x"] + 250, cb["y"] + 550, steps=6)
    page.mouse.up()
    page.wait_for_timeout(250)
    page.select_option("#zoom-select", "1.50")
    page.wait_for_timeout(1200)
    cb2 = page.locator(".page-wrapper").first.locator("canvas[id^='annot-canvas-']").first.bounding_box()
    scale = cb2["width"] / cb["width"]
    page.click("#tool-eraser")
    page.wait_for_timeout(200)
    page.mouse.click(cb2["x"] + 175, cb2["y"] + 450 * scale)  # top edge midpoint
    page.wait_for_timeout(250)
    print("rect count after zoomed erase:", page.evaluate("() => (window.app.annotator.annotations.get(1)||[]).length"))

    print("errors:", errs)
    b.close()
