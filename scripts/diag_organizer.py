#!/usr/bin/env python3
"""Diagnostic: organizer modal opens immediately and thumbnails fill progressively."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge", headless=True)
    page = b.new_page(viewport={"width": 1440, "height": 900})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8080/", wait_until="domcontentloaded")
    page.wait_for_timeout(1500)
    page.evaluate("() => window.app.loadSamplePDF()")
    page.wait_for_timeout(2500)

    # Grow the document so thumbnail rendering has measurable work.
    page.click(".mode-tab[data-mode='organize']")
    page.wait_for_timeout(300)
    page.click("#btn-open-merge")
    page.wait_for_timeout(300)
    page.set_input_files("#merge-files-input", "test-docs/a.pdf")
    page.wait_for_timeout(400)
    page.click("#btn-apply-merge")
    page.wait_for_timeout(4000)
    print("pages:", page.evaluate("() => window.app.viewer.totalPages"))

    page.click(".mode-tab[data-mode='organize']")
    page.wait_for_timeout(300)
    page.evaluate("""() => {
      const modal = document.getElementById('modal-organizer');
      window.__openMs = null;
      window.__t0 = performance.now();
      const obs = new MutationObserver(() => {
        if (modal.classList.contains('open') && window.__openMs === null) {
          window.__openMs = performance.now() - window.__t0;
          obs.disconnect();
        }
      });
      obs.observe(modal, { attributes: true, attributeFilter: ['class'] });
    }""")
    page.click("#btn-open-organizer-modal")
    page.wait_for_selector("#modal-organizer.open", timeout=5000)
    print("modal open time ms:", round(page.evaluate("() => window.__openMs"), 1))

    samples = []
    for _ in range(12):
        samples.append(page.evaluate("""() => ({
          at: Math.round(performance.now() - window.__t0),
          cards: document.querySelectorAll('.organizer-card').length,
          loaded: document.querySelectorAll('.organizer-thumb:not(.organizer-thumb-loading)').length
        })"""))
        page.wait_for_timeout(120)
    print("progressive:", samples)

    page.wait_for_function(
        "() => document.querySelectorAll('.organizer-thumb-loading').length === 0",
        timeout=15000,
    )
    print("all loaded:", page.evaluate("""() => ({
      cards: document.querySelectorAll('.organizer-card').length,
      loading: document.querySelectorAll('.organizer-thumb-loading').length,
      nonEmpty: [...document.querySelectorAll('.organizer-thumb canvas')].filter(c => c.width > 1 && c.height > 1).length
    })"""))
    print("errors:", errs)
    b.close()
