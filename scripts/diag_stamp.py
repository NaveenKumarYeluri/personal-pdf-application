#!/usr/bin/env python3
"""Diagnostic: stamp controls (delete, opacity, rotation, resize/font)."""
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

    def place():
        page.select_option("#annot-stamp", "APPROVED")
        page.wait_for_timeout(700)
        return page.locator(".placed-stamp").count()

    print("placed:", place())
    print("activeStamp:", page.evaluate("() => !!window.app.annotator.activeStamp"))
    print("selected stamps:", page.locator(".placed-stamp.element-selected").count())
    print("delete btn display:", page.evaluate("() => getComputedStyle(document.getElementById('btn-stamp-delete')).display"))

    # opacity
    page.select_option("#stamp-opacity", "0.45")
    page.wait_for_timeout(400)
    print("opacity after select:", page.evaluate("() => { const b=document.querySelector('.placed-stamp .stamp-badge'); return {style:b.style.opacity, computed:getComputedStyle(b).opacity, dataset:document.getElementById('stamp-opacity').value}; }"))

    # rotation
    page.select_option("#stamp-rotation", "15")
    page.wait_for_timeout(400)
    print("rotation after select:", page.evaluate("() => { const b=document.querySelector('.placed-stamp .stamp-badge'); return {style:b.style.transform, computed:getComputedStyle(b).transform, dataset:b.dataset.rotation}; }"))

    # font size control
    page.fill("#stamp-font-size", "36")
    page.dispatch_event("#stamp-font-size", "change")
    page.wait_for_timeout(300)
    print("font size after control:", page.evaluate("() => getComputedStyle(document.querySelector('.placed-stamp .stamp-badge')).fontSize"))

    # resize text
    before = page.evaluate("() => { const s=document.querySelector('.placed-stamp'); const b=s.querySelector('.stamp-badge'); return {w:s.offsetWidth,h:s.offsetHeight,fs:getComputedStyle(b).fontSize}; }")
    handle = page.locator(".placed-stamp.element-selected .element-resize-handle.handle-se").first
    if handle.count() == 0:
        handle = page.locator(".placed-stamp .element-resize-handle").last
    hb = handle.bounding_box()
    page.mouse.move(hb["x"] + hb["width"] / 2, hb["y"] + hb["height"] / 2)
    page.mouse.down()
    page.mouse.move(hb["x"] + 160, hb["y"] + 100, steps=8)
    page.mouse.up()
    page.wait_for_timeout(400)
    after = page.evaluate("() => { const s=document.querySelector('.placed-stamp'); const b=s.querySelector('.stamp-badge'); return {w:s.offsetWidth,h:s.offsetHeight,fs:getComputedStyle(b).fontSize}; }")
    print("resize before:", before, "after:", after)

    # delete via toolbar button
    print("handler bound:", page.evaluate("() => typeof document.getElementById('btn-stamp-delete').onclick"))
    page.evaluate("""() => {
      const orig = window.app.annotator.deleteActiveStamp.bind(window.app.annotator);
      window.__delCalls = 0;
      window.app.annotator.deleteActiveStamp = () => { window.__delCalls++; return orig(); };
    }""")
    print("before toolbar delete:", page.evaluate("""() => ({
      active: !!(window.app.annotator.activeStamp),
      selected: document.querySelectorAll('.placed-stamp.element-selected').length,
      stamps: document.querySelectorAll('.placed-stamp').length,
      btn: getComputedStyle(document.getElementById('btn-stamp-delete')).display
    })"""))
    page.click("#btn-stamp-delete")
    page.wait_for_timeout(400)
    print("delete calls:", page.evaluate("() => window.__delCalls"))
    print("status:", page.locator("#status-message").inner_text())
    print("stamps after toolbar delete:", page.locator(".placed-stamp").count())
    print("floating bars after toolbar delete:", page.locator(".element-floating-bar").count())
    print("direct delete works:", page.evaluate("() => { const s=document.querySelector('.placed-stamp'); if(!s) return 'none'; window.app.annotator.activeStamp=s; window.app.annotator._selectElement(s); window.app.annotator.deleteActiveStamp(); return document.querySelectorAll('.placed-stamp').length; }"))

    # delete via in-stamp close, check floating bar visibility
    place()
    print("bars after place:", page.evaluate("() => [...document.querySelectorAll('.element-floating-bar')].map(b => getComputedStyle(b).display)"))
    stamp = page.locator(".placed-stamp").last
    stamp.hover()
    page.wait_for_timeout(200)
    stamp.locator(".textbox-delete-btn").click(force=True)
    page.wait_for_timeout(300)
    print("stamps after close:", page.locator(".placed-stamp").count())
    print("bars after close:", page.evaluate("() => [...document.querySelectorAll('.element-floating-bar')].map(b => getComputedStyle(b).display)"))

    print("errors:", errs)
    b.close()
