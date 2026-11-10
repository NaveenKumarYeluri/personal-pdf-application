#!/usr/bin/env python3
"""Diagnostic: in-place PDF text editing typography and paragraph growth."""
from playwright.sync_api import sync_playwright

PDF = r"test-docs/SQL Server Advanced Concepts.pdf"

with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge", headless=True)
    page = b.new_page(viewport={"width": 1440, "height": 900})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8080/", wait_until="domcontentloaded")
    page.wait_for_timeout(1500)
    page.set_input_files("#file-input", PDF)
    page.wait_for_timeout(6000)
    print("pages:", page.evaluate("() => window.app.viewer.totalPages"))
    page.click(".mode-tab[data-mode='edit']")
    page.wait_for_timeout(600)

    info = page.evaluate("""() => {
      const spans = [...document.querySelectorAll('#page-wrapper-1 .textLayer span')]
        .filter(s => (s.textContent || '').trim().length > 25);
      const s = spans[0];
      if (!s) return null;
      const r = s.getBoundingClientRect();
      const cs = getComputedStyle(s);
      return {
        text: s.textContent,
        rect: {x: r.x, y: r.y, w: r.width, h: r.height},
        fontSize: cs.fontSize,
        lineHeight: cs.lineHeight,
        fontFamily: cs.fontFamily,
        display: cs.display,
        position: cs.position,
        whiteSpace: cs.whiteSpace,
        transform: cs.transform,
        styleFontSize: s.style.fontSize,
        top: s.offsetTop,
        left: s.offsetLeft,
        width: s.offsetWidth,
        height: s.offsetHeight,
        index: spans.indexOf(s)
      };
    }""")
    print("before:", info)

    # Click the span to start editing.
    page.evaluate("""() => {
      const spans = [...document.querySelectorAll('#page-wrapper-1 .textLayer span')]
        .filter(s => (s.textContent || '').trim().length > 25);
      const s = spans[0];
      s.setAttribute('data-diag-target', '1');
    }""")
    page.click("[data-diag-target='1']")
    page.wait_for_timeout(500)
    print("editing:", page.evaluate("""() => {
      const s = document.querySelector('[data-diag-target="1"]');
      return { cls: s.className, editable: s.contentEditable,
               styleFontSize: s.style.fontSize, maxWidth: s.style.maxWidth,
               width: s.offsetWidth, height: s.offsetHeight,
               rect: (()=>{const r=s.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height};})() };
    }"""))

    page.keyboard.type(" This sentence was added by the user to expand this paragraph and check whether the text wraps and grows naturally.")
    page.wait_for_timeout(700)
    print("after typing:", page.evaluate("""() => {
      const s = document.querySelector('[data-diag-target="1"]');
      const b = s.querySelector('span'); // noop
      const cs = getComputedStyle(s);
      return { text: s.textContent, fontSize: cs.fontSize, styleFontSize: s.style.fontSize,
               maxWidth: s.style.maxWidth, width: s.offsetWidth, height: s.offsetHeight,
               whiteSpace: cs.whiteSpace, overflow: cs.overflow,
               rect: (()=>{const r=s.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height};})() };
    }"""))

    page.screenshot(path="test-output/inplace-typed.png")

    # Try Enter to add a paragraph line.
    page.keyboard.press("Enter")
    page.wait_for_timeout(400)
    print("after Enter:", page.evaluate("""() => {
      const s = document.querySelector('[data-diag-target="1"]');
      const cs = getComputedStyle(s);
      return { text: s.textContent, height: s.offsetHeight, fontSize: cs.fontSize,
               editable: s.contentEditable, cls: s.className };
    }"""))
    page.screenshot(path="test-output/inplace-enter.png")
    print("errors:", errs)
    b.close()
