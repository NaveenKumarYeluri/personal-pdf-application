#!/usr/bin/env python3
"""Interactive regression suite for Personal PDF Suite (headless Edge)."""
import json
import sys
import time
import traceback
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "test-output"
OUT.mkdir(exist_ok=True)

RESULTS = []


def record(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print(("PASS" if ok else "FAIL"), "-", name, ("| " + str(detail)) if detail else "")


def main():
    errors = []
    logs = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900}, accept_downloads=True)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: logs.append((m.type, m.text)))
        page.goto("http://localhost:8080/", wait_until="domcontentloaded")
        page.wait_for_timeout(2000)

        # ---------------- Load sample ----------------
        page.click("#btn-load-sample")
        page.wait_for_timeout(3500)
        record("sample loads 2 pages", page.locator(".page-wrapper").count() == 2,
               page.locator(".page-wrapper").count())

        # ---------------- Page navigation ----------------
        page.click("#btn-next-page")
        page.wait_for_timeout(700)
        record("next page updates indicator", page.input_value("#page-num-input") == "2",
               page.input_value("#page-num-input"))
        page.click("#btn-prev-page")
        page.wait_for_timeout(700)
        record("prev page updates indicator", page.input_value("#page-num-input") == "1",
               page.input_value("#page-num-input"))

        # ---------------- Zoom ----------------
        page.select_option("#zoom-select", "1.00")
        page.wait_for_timeout(900)
        scale = page.evaluate("() => window.app.viewer.scale")
        record("zoom select 100% applies scale", abs(scale - 1.0) < 0.01, scale)
        page.click("#btn-zoom-in")
        page.wait_for_timeout(700)
        scale2 = page.evaluate("() => window.app.viewer.scale")
        record("zoom in increases scale", scale2 > scale, scale2)

        # ---------------- Search ----------------
        page.select_option("#zoom-select", "page-width")
        page.wait_for_timeout(900)
        page.fill("#search-input", "PDF")
        page.wait_for_timeout(900)
        search_count = page.inner_text("#search-count")
        record("search finds matches", search_count not in ("0/0", ""), search_count)
        record("search highlights marks", page.locator("mark.search-highlight").count() > 0,
               page.locator("mark.search-highlight").count())
        page.press("#search-input", "Escape")
        page.wait_for_timeout(300)
        record("escape clears search", page.locator("mark.search-highlight").count() == 0,
               page.locator("mark.search-highlight").count())

        # ---------------- Rotate ----------------
        rot_before = page.evaluate("() => window.app.viewer.rotation")
        page.click("#btn-rotate-cw")
        page.wait_for_timeout(1200)
        rot_after = page.evaluate("() => window.app.viewer.rotation")
        record("rotate clockwise increments rotation", rot_after == (rot_before + 90) % 360,
               f"{rot_before} -> {rot_after}")

        # ---------------- Annotate mode / pen draw ----------------
        page.click(".mode-tab[data-mode='annotate']")
        page.wait_for_timeout(600)
        record("annotate mode activates", "mode-annotate" in page.evaluate("() => document.body.className"))
        page.click("#tool-pen")
        page.wait_for_timeout(200)
        annot_canvas = page.locator(".page-wrapper").first.locator("canvas[id^='annot-canvas-']").first
        box = annot_canvas.bounding_box()
        page.mouse.move(box["x"] + 120, box["y"] + 200)
        page.mouse.down()
        page.mouse.move(box["x"] + 200, box["y"] + 260, steps=8)
        page.mouse.move(box["x"] + 260, box["y"] + 220, steps=8)
        page.mouse.up()
        page.wait_for_timeout(400)
        strokes = page.evaluate("() => (window.app.annotator.annotations.get(1) || []).length")
        record("pen stroke recorded", strokes == 1, strokes)
        record("undo enables after stroke", page.evaluate("() => window.app.annotator.undoStack.length") > 0)
        page.click("#btn-undo")
        page.wait_for_timeout(300)
        record("undo removes stroke", page.evaluate("() => (window.app.annotator.annotations.get(1) || []).length") == 0)
        page.click("#btn-redo")
        page.wait_for_timeout(300)
        record("redo restores stroke", page.evaluate("() => (window.app.annotator.annotations.get(1) || []).length") == 1)

        # ---------------- Sticky note ----------------
        page.click("#tool-note")
        page.wait_for_timeout(200)
        canvas_box = annot_canvas.bounding_box()
        page.mouse.click(canvas_box["x"] + 300, canvas_box["y"] + 300)
        page.wait_for_timeout(500)
        notes = page.locator(".sticky-note-container").count()
        record("sticky note created", notes == 1, notes)
        record("sticky note auto-switches to select tool",
               page.evaluate("() => window.app.annotator.currentTool") == "select",
               page.evaluate("() => window.app.annotator.currentTool"))

        # ---------------- Text box ----------------
        page.click("#tool-text")
        page.wait_for_timeout(200)
        page.mouse.click(canvas_box["x"] + 150, canvas_box["y"] + 400)
        page.wait_for_timeout(500)
        tboxes = page.locator(".annotation-textbox").count()
        record("text box created", tboxes == 1, tboxes)

        # ---------------- Stamp ----------------
        page.select_option("#annot-stamp", "APPROVED")
        page.wait_for_timeout(800)
        stamps = page.locator(".placed-stamp").count()
        record("stamp placed via toolbar", stamps >= 1, stamps)

        # ---------------- Eraser removes stroke ----------------
        page.click("#tool-eraser")
        page.wait_for_timeout(200)
        # erase near the start of the pen stroke
        page.mouse.move(box["x"] + 120, box["y"] + 200)
        page.mouse.down()
        page.mouse.move(box["x"] + 125, box["y"] + 205, steps=3)
        page.mouse.up()
        page.wait_for_timeout(400)
        strokes_after_erase = page.evaluate("() => (window.app.annotator.annotations.get(1) || []).length")
        record("eraser removes pen stroke", strokes_after_erase == 0, strokes_after_erase)

        # ---------------- Organizer ----------------
        page.click(".mode-tab[data-mode='organize']")
        page.wait_for_timeout(500)
        # click organize action to open modal? check ids rendered
        page.screenshot(path=str(OUT / "03-organize.png"), full_page=True)

        # ---------------- Export tools modal ----------------
        page.click(".mode-tab[data-mode='export']")
        page.wait_for_timeout(500)
        page.screenshot(path=str(OUT / "04-export.png"), full_page=True)

        print("\n--- PAGE ERRORS ---")
        for e in errors:
            print(e)
        print("\n--- CONSOLE ERRORS/WARNINGS ---")
        for t, m in logs:
            if t in ("error", "warning"):
                print(f"[{t}] {m}")

        browser.close()

    passed = sum(1 for _, ok, _ in RESULTS if ok)
    print(f"\nSummary: {passed}/{len(RESULTS)} passed")
    print("ERRORS:", len(errors))
    return 0 if passed == len(RESULTS) and not errors else 1


if __name__ == "__main__":
    sys.exit(main())
