#!/usr/bin/env python3
"""
Comprehensive Live Feature Test & Validation Suite for Personal PDF Suite.
Runs against the running application at http://localhost:8080/ using Playwright (msedge).
Thoroughly tests every feature, interaction, modal, tool, and edge case.
"""

import sys
import os
import time
import json
import base64
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "test-output"
OUT.mkdir(exist_ok=True)

RESULTS = []
FAILURES = []

def record(feature, ok, details=""):
    RESULTS.append((feature, bool(ok), details))
    status = "✓ PASS" if ok else "✗ FAIL"
    print(f"[{status}] {feature}" + (f" | {details}" if details else ""))
    if not ok:
        FAILURES.append((feature, details))

def run_live_tests():
    print("=" * 80)
    print(" Personal PDF Suite - Live In-Browser Feature Validation")
    print("=" * 80)

    page_errors = []
    console_errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
        page = context.new_page()

        page.on("pageerror", lambda err: page_errors.append(str(err)))
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.on("dialog", lambda dialog: dialog.accept("Page Bookmark"))

        # -------------------------------------------------------------
        # TEST SUITE 1: Application Launch & Sample Document Loading
        # -------------------------------------------------------------
        print("\n--- 1. Document Loading & Initial State ---")
        page.goto("http://localhost:8080/", wait_until="domcontentloaded")
        page.wait_for_selector("#app", timeout=5000)
        record("App loads and renders #app shell", True)

        # Load sample PDF
        page.click("#btn-load-sample")
        page.wait_for_selector(".page-wrapper", timeout=10000)
        page.wait_for_timeout(2000)

        pages = page.evaluate("() => window.app.viewer.totalPages")
        record("Sample PDF loaded with pages", pages >= 2, f"Total pages: {pages}")

        title = page.evaluate("() => window.app.currentDocName")
        record("Document title is set in header", bool(title), title)

        # -------------------------------------------------------------
        # TEST SUITE 2: View & Navigation Controls
        # -------------------------------------------------------------
        print("\n--- 2. View, Navigation & Zoom Controls ---")
        init_page = page.evaluate("() => window.app.viewer.currentPage")
        record("Initial current page is 1", init_page == 1, f"Current: {init_page}")

        # Next page
        page.click("#btn-next-page")
        page.wait_for_timeout(500)
        curr = page.evaluate("() => window.app.viewer.currentPage")
        record("Next page button updates currentPage", curr == 2, f"Page: {curr}")

        # Previous page
        page.click("#btn-prev-page")
        page.wait_for_timeout(500)
        curr = page.evaluate("() => window.app.viewer.currentPage")
        record("Prev page button updates currentPage", curr == 1, f"Page: {curr}")

        # Jump via input
        page.fill("#page-num-input", "2")
        page.press("#page-num-input", "Enter")
        page.wait_for_timeout(500)
        curr = page.evaluate("() => window.app.viewer.currentPage")
        record("Page number input jump navigates to page", curr == 2, f"Page: {curr}")

        # Zoom in and out
        scale_before = page.evaluate("() => window.app.viewer.scale")
        page.click("#btn-zoom-in")
        page.wait_for_timeout(600)
        scale_in = page.evaluate("() => window.app.viewer.scale")
        record("Zoom In button increases scale", scale_in > scale_before, f"{scale_before} -> {scale_in}")

        page.click("#btn-zoom-out")
        page.wait_for_timeout(600)
        scale_out = page.evaluate("() => window.app.viewer.scale")
        record("Zoom Out button decreases scale", scale_out < scale_in, f"{scale_in} -> {scale_out}")

        # Zoom dropdown options
        page.select_option("#zoom-select", "1.00")
        page.wait_for_timeout(600)
        scale_100 = page.evaluate("() => window.app.viewer.scale")
        record("Zoom select 100% applies scale 1.0", abs(scale_100 - 1.0) < 0.01, f"Scale: {scale_100}")

        page.select_option("#zoom-select", "page-fit")
        page.wait_for_timeout(600)
        scale_fit = page.evaluate("() => window.app.viewer.scale")
        record("Zoom select Fit Page updates scale", scale_fit > 0, f"Scale: {scale_fit}")

        # Rotation CW
        rot_before = page.evaluate("() => window.app.viewer.rotation")
        page.click("#btn-rotate-cw")
        page.wait_for_timeout(500)
        rot_after = page.evaluate("() => window.app.viewer.rotation")
        record("Rotate 90° CW button rotates document", rot_after == (rot_before + 90) % 360, f"{rot_before} -> {rot_after}")

        # Rotate back
        page.click("#btn-rotate-cw")
        page.click("#btn-rotate-cw")
        page.click("#btn-rotate-cw")
        page.wait_for_timeout(500)
        record("Document restored to 0° rotation", page.evaluate("() => window.app.viewer.rotation") == 0)

        # Hand / Pan tool vs Select tool
        page.click("#btn-tool-hand")
        page.wait_for_timeout(300)
        hand_active = page.evaluate("() => document.getElementById('btn-tool-hand').classList.contains('active')")
        record("Hand / Pan tool activates", hand_active)

        page.click("#btn-tool-select")
        page.wait_for_timeout(300)
        select_active = page.evaluate("() => document.getElementById('btn-tool-select').classList.contains('active')")
        record("Select tool reactivates", select_active)

        # Theme toggle (Light / Dark)
        page.click("#btn-toggle-theme")
        page.wait_for_timeout(300)
        is_dark = page.evaluate("() => document.body.classList.contains('theme-dark')")
        record("Theme toggle switches to Dark theme", is_dark)

        page.click("#btn-toggle-theme")
        page.wait_for_timeout(300)
        is_light = page.evaluate("() => document.body.classList.contains('theme-light')")
        record("Theme toggle switches back to Light theme", is_light)

        # Accent color palette
        page.click("#btn-accent-palette")
        page.wait_for_timeout(300)
        page.click("#accent-palette-dropdown .accent-swatch[data-color='#2563eb']")
        page.wait_for_timeout(300)
        accent_blue = page.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim()")
        record("Accent color updates to Royal Blue", accent_blue == "#2563eb", f"Color: {accent_blue}")

        page.click("#btn-accent-palette")
        page.wait_for_timeout(300)
        page.click("#accent-palette-dropdown .accent-swatch[data-color='#ea2e3f']")
        page.wait_for_timeout(300)
        accent_red = page.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim()")
        record("Accent color restored to Acrobat Red", accent_red == "#ea2e3f", f"Color: {accent_red}")

        # Search box
        page.fill("#search-input", "PDF")
        page.wait_for_timeout(600)
        count_text = page.locator("#search-count").inner_text()
        record("Search finds occurrences and updates counter", "/" in count_text and not count_text.startswith("0/0"), count_text)

        page.click("#btn-search-next")
        page.wait_for_timeout(300)
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        esc_count = page.locator("#search-count").inner_text()
        record("Escape key clears search query and counter", esc_count == "0/0", esc_count)

        # Sidebar navigation tabs
        page.click(".sidebar-tab[data-tab='outline']")
        page.wait_for_timeout(300)
        outline_visible = page.evaluate("() => document.getElementById('tab-outline').classList.contains('active')")
        record("Sidebar switches to Bookmarks/Outline tab", outline_visible)

        # Add bookmark
        page.click("#btn-add-bookmark")
        page.wait_for_timeout(500)
        bms = page.evaluate("() => window.app.customBookmarks ? window.app.customBookmarks.length : 0")
        record("Add bookmark button creates bookmark", bms >= 1, f"Bookmarks count: {bms}")

        # Switch to Annotations tab
        page.click(".sidebar-tab[data-tab='annotations']")
        page.wait_for_timeout(300)
        annot_visible = page.evaluate("() => document.getElementById('tab-annotations').classList.contains('active')")
        record("Sidebar switches to Annotations tab", annot_visible)

        # Toggle sidebar
        page.click("#btn-toggle-sidebar")
        page.wait_for_timeout(400)
        sb_collapsed = page.evaluate("() => document.getElementById('sidebar').classList.contains('collapsed')")
        record("Toggle sidebar button collapses sidebar", sb_collapsed)

        page.click("#btn-toggle-sidebar")
        page.wait_for_timeout(400)
        sb_expanded = page.evaluate("() => !document.getElementById('sidebar').classList.contains('collapsed')")
        record("Toggle sidebar button expands sidebar", sb_expanded)

        # -------------------------------------------------------------
        # TEST SUITE 3: Annotate Mode (Pen, Highl., Eraser, Shapes, Notes, Text, Stamps)
        # -------------------------------------------------------------
        print("\n--- 3. Annotation & Markup Suite ---")
        page.click(".mode-tab[data-mode='annotate']")
        page.wait_for_timeout(500)
        annot_mode = page.evaluate("() => document.body.classList.contains('mode-annotate')")
        record("Switched to Annotate & Markup mode", annot_mode)

        # Freehand Pen Stroke
        page.click("#tool-pen")
        pw1 = page.locator("#page-wrapper-1")
        c1_box = pw1.bounding_box()
        page.mouse.move(c1_box["x"] + 100, c1_box["y"] + 100)
        page.mouse.down()
        page.mouse.move(c1_box["x"] + 200, c1_box["y"] + 150)
        page.mouse.move(c1_box["x"] + 300, c1_box["y"] + 100)
        page.mouse.up()
        page.wait_for_timeout(500)

        strokes = page.evaluate("() => (window.app.annotator.annotations.get(1) || []).length")
        record("Freehand Pen stroke added to annotations", strokes >= 1, f"Count: {strokes}")

        # Highlighter
        page.click("#tool-highlighter")
        page.mouse.move(c1_box["x"] + 100, c1_box["y"] + 180)
        page.mouse.down()
        page.mouse.move(c1_box["x"] + 300, c1_box["y"] + 180)
        page.mouse.up()
        page.wait_for_timeout(500)
        annots_highl = page.evaluate("() => (window.app.annotator.annotations.get(1) || []).length")
        record("Highlighter stroke added to annotations", annots_highl > strokes, f"Count: {annots_highl}")

        # Shapes: Rectangle, Circle, Line
        page.click("#tool-rect")
        page.mouse.move(c1_box["x"] + 100, c1_box["y"] + 220)
        page.mouse.down()
        page.mouse.move(c1_box["x"] + 250, c1_box["y"] + 300)
        page.mouse.up()
        page.wait_for_timeout(500)

        page.click("#tool-circle")
        page.mouse.move(c1_box["x"] + 300, c1_box["y"] + 220)
        page.mouse.down()
        page.mouse.move(c1_box["x"] + 400, c1_box["y"] + 300)
        page.mouse.up()
        page.wait_for_timeout(500)

        page.click("#tool-line")
        page.mouse.move(c1_box["x"] + 100, c1_box["y"] + 330)
        page.mouse.down()
        page.mouse.move(c1_box["x"] + 350, c1_box["y"] + 330)
        page.mouse.up()
        page.wait_for_timeout(500)

        annots_shapes = page.evaluate("() => (window.app.annotator.annotations.get(1) || []).length")
        record("Rectangle, Circle, and Line shapes added", annots_shapes >= annots_highl + 3, f"Count: {annots_shapes}")

        # Sticky Note
        page.click("#tool-note")
        page.mouse.click(c1_box["x"] + 200, c1_box["y"] + 370)
        page.wait_for_timeout(500)
        notes = page.locator(".sticky-note-marker").count()
        record("Sticky Note created on page", notes >= 1, f"Count: {notes}")

        # Delete sticky note
        page.locator(".btn-delete-note").first.click()
        page.wait_for_timeout(500)
        notes_after = page.locator(".sticky-note-marker").count()
        record("Sticky note deleted cleanly", notes_after == notes - 1)

        # Typewriter Text Box
        page.click("#tool-text")
        page.mouse.click(c1_box["x"] + 150, c1_box["y"] + 420)
        page.wait_for_timeout(500)
        tb = page.locator(".annotation-textbox").first
        record("Typewriter text box placed", tb.count() > 0)

        page.keyboard.type("Automated Verification Note")
        page.wait_for_timeout(300)
        tb_text = tb.locator(".textbox-content").inner_text()
        record("Typed text inside text box", "Automated Verification Note" in tb_text, tb_text)

        # Delete active text box
        page.click("#btn-text-delete")
        page.wait_for_timeout(500)
        tb_count_after = page.locator(".annotation-textbox").count()
        record("Text box deleted via toolbar Del button", tb_count_after == 0)

        # Stamps Studio
        page.select_option("#annot-stamp", "APPROVED")
        page.wait_for_timeout(600)
        stamps = page.locator(".placed-stamp").count()
        record("Predefined 'APPROVED' stamp placed", stamps >= 1, f"Stamps: {stamps}")

        # Adjust stamp properties
        page.select_option("#stamp-opacity", "0.45")
        page.wait_for_timeout(300)
        page.select_option("#stamp-rotation", "15")
        page.wait_for_timeout(300)
        stamp_rot = page.evaluate("() => document.querySelector('.placed-stamp .stamp-badge')?.dataset.rotation")
        record("Stamp rotation updated to 15°", stamp_rot == "15", f"Rot: {stamp_rot}")

        # Delete stamp
        page.click("#btn-stamp-delete")
        page.wait_for_timeout(500)
        stamps_after = page.locator(".placed-stamp").count()
        record("Stamp deleted cleanly", stamps_after == stamps - 1)

        # -------------------------------------------------------------
        # TEST SUITE 4: In-Place Content Editing (Edit Mode)
        # -------------------------------------------------------------
        print("\n--- 4. In-Place Text Editing & Content Modification ---")
        page.click(".mode-tab[data-mode='edit']")
        page.wait_for_timeout(500)
        edit_mode = page.evaluate("() => document.body.classList.contains('mode-edit')")
        record("Switched to Edit & Watermark mode", edit_mode)

        # Click first text span to edit
        first_span = page.locator(".page-wrapper").first.locator(".textLayer span").first
        f_box = first_span.bounding_box()
        page.mouse.click(f_box["x"] + 10, f_box["y"] + f_box["height"] / 2)
        page.wait_for_timeout(400)

        is_editable = first_span.evaluate("s => s.contentEditable === 'true'")
        record("Clicking span activates contenteditable", is_editable)

        # Type new content and commit
        page.keyboard.press("Control+A")
        page.keyboard.type("REVISED TITLE HEADER")
        page.wait_for_timeout(300)
        page.keyboard.press("Enter")
        page.keyboard.type("Second line of edited content")
        page.wait_for_timeout(300)

        # Commit on blur
        page.mouse.click(f_box["x"] + 400, f_box["y"] + 300)
        page.wait_for_timeout(600)

        committed_text = first_span.inner_text()
        record("In-place edit committed with multi-line text", "REVISED TITLE HEADER" in committed_text, committed_text)

        # Check in-place edit list
        in_place_count = page.evaluate("() => window.app.annotator.inPlaceEdits.get(1)?.size || 0")
        record("In-place edit recorded in annotator state", in_place_count >= 1, f"Count: {in_place_count}")

        # Whiteout Block in Edit Mode
        page.click("#btn-edit-whiteout")
        page.wait_for_timeout(500)
        wo_boxes = page.locator(".whiteout-box").count()
        record("Whiteout box placed on document", wo_boxes >= 1, f"Count: {wo_boxes}")

        # Delete whiteout box
        page.keyboard.press("Delete")
        page.wait_for_timeout(300)

        # -------------------------------------------------------------
        # TEST SUITE 5: Fill & Sign (Signature Studio)
        # -------------------------------------------------------------
        print("\n--- 5. Electronic Signature Studio ---")
        page.click(".mode-tab[data-mode='forms']")
        page.wait_for_timeout(500)
        forms_mode = page.evaluate("() => document.body.classList.contains('mode-forms')")
        record("Switched to Fill & Sign mode", forms_mode)

        # Open signature modal
        page.click("#btn-open-signature-tool")
        page.wait_for_selector("#modal-signature.open", timeout=3000)
        record("Signature modal opens", True)

        # Mode 1: Draw signature
        sig_canvas = page.locator("#sig-canvas")
        s_box = sig_canvas.bounding_box()
        page.mouse.move(s_box["x"] + 50, s_box["y"] + 50)
        page.mouse.down()
        page.mouse.move(s_box["x"] + 150, s_box["y"] + 90)
        page.mouse.move(s_box["x"] + 250, s_box["y"] + 50)
        page.mouse.up()
        page.wait_for_timeout(300)

        # Mode 2: Type signature tab
        page.click(".sig-tab[data-sig-mode='type']")
        page.wait_for_timeout(300)
        page.fill("#sig-type-input", "Jane Doe")
        page.wait_for_timeout(300)
        prev_text = page.locator("#sig-type-preview").inner_text()
        record("Type signature preview updates with cursive name", "Jane Doe" in prev_text, prev_text)

        # Mode 3: Upload signature image with paper background removal
        page.click(".sig-tab[data-sig-mode='image']")
        page.wait_for_timeout(300)
        sign_file = ROOT / "test-docs" / "Sign.jpg"
        if sign_file.exists():
            page.set_input_files("#sig-image-file", str(sign_file))
            page.wait_for_timeout(800)
            img_opts_visible = page.is_visible("#sig-image-options")
            record("Upload signature image displays paper removal options", img_opts_visible)

        # Apply signature to document
        page.click("#btn-apply-signature")
        page.wait_for_timeout(800)
        placed_sigs = page.locator(".placed-signature-box").count()
        record("Signature placed onto document page", placed_sigs >= 1, f"Count: {placed_sigs}")

        # Rotate handle on signature
        sig_el = page.locator(".placed-signature-box").first
        record("Signature container has 360° rotation handle", sig_el.locator(".element-rotate-handle").count() > 0)

        # Delete signature
        page.keyboard.press("Delete")
        page.wait_for_timeout(500)
        sigs_after = page.locator(".placed-signature-box").count()
        record("Signature deleted cleanly via Delete shortcut", sigs_after == placed_sigs - 1)

        # -------------------------------------------------------------
        # TEST SUITE 6: Page Organizer & Mutations
        # -------------------------------------------------------------
        print("\n--- 6. Page Organizer & Mutations ---")
        page.click(".mode-tab[data-mode='organize']")
        page.wait_for_timeout(500)
        org_mode = page.evaluate("() => document.body.classList.contains('mode-organize')")
        record("Switched to Organize Pages mode", org_mode)

        # Insert Blank Page
        pages_before = page.evaluate("() => window.app.viewer.totalPages")
        page.click("#btn-org-add-blank")
        page.wait_for_timeout(3000)
        pages_after_blank = page.evaluate("() => window.app.viewer.totalPages")
        record("Insert Blank Page adds page to document", pages_after_blank == pages_before + 1, f"{pages_before} -> {pages_after_blank}")

        # Open Organizer Modal
        page.click("#btn-open-organizer-modal")
        page.wait_for_selector("#modal-organizer.open", timeout=3000)
        page.wait_for_timeout(1000)

        cards = page.locator(".organizer-card").count()
        record("Organizer modal renders page cards", cards == pages_after_blank, f"Cards: {cards}")

        # Rotate page in organizer
        page.locator(".organizer-card").first.click()
        page.click("#btn-org-rotate-right")
        page.wait_for_timeout(300)
        rot_delta = page.locator(".organizer-card").first.evaluate("c => c.dataset.rotationDelta")
        record("Page card rotationDelta updated to 90", rot_delta == "90", f"Delta: {rot_delta}")

        # Close organizer modal
        page.locator("#modal-organizer .modal-close").first.click()
        page.wait_for_timeout(500)
        record("Organizer modal closed", not page.is_visible("#modal-organizer.open"))

        # -------------------------------------------------------------
        # TEST SUITE 7: Document Security, Watermarking, Numbering
        # -------------------------------------------------------------
        print("\n--- 7. Security, Watermarking & Bates Numbering ---")
        page.click(".mode-tab[data-mode='protect']")
        page.wait_for_timeout(500)

        # Open Watermark modal
        page.click(".mode-tab[data-mode='edit']")
        page.wait_for_timeout(300)
        page.click("#btn-open-watermark")
        page.wait_for_selector("#modal-watermark.open", timeout=3000)
        page.fill("#watermark-text", "TEST WATERMARK")
        page.click("#btn-apply-watermark")
        page.wait_for_timeout(3000)
        record("Watermark applied successfully", not page.is_visible("#modal-watermark.open"))

        # Open Bates Numbering modal
        page.click("#btn-open-bates")
        page.wait_for_selector("#modal-bates.open", timeout=3000)
        page.fill("#bates-prefix", "CONF-")
        page.click("#btn-apply-bates")
        page.wait_for_timeout(3000)
        record("Bates numbering applied successfully", not page.is_visible("#modal-bates.open"))

        # -------------------------------------------------------------
        # TEST SUITE 8: Export Capabilities
        # -------------------------------------------------------------
        print("\n--- 8. Export Capabilities ---")
        page.click(".mode-tab[data-mode='export']")
        page.wait_for_timeout(500)
        export_mode = page.evaluate("() => document.body.classList.contains('mode-export')")
        record("Switched to Export mode", export_mode)

        # Export Page as PNG
        page.click("#btn-export-page-img")
        page.wait_for_timeout(3000)
        export_modal_open = page.is_visible("#modal-export-result.open")
        record("Export Page as PNG succeeds and displays result dialog", export_modal_open)
        if export_modal_open:
            page.locator("#modal-export-result .modal-close").first.click()
            page.wait_for_timeout(300)

        # Extract All Text as TXT
        page.click("#btn-export-text")
        page.wait_for_timeout(3000)
        txt_modal_open = page.is_visible("#modal-export-result.open")
        record("Extract All Text succeeds and displays result dialog", txt_modal_open)
        if txt_modal_open:
            page.locator("#modal-export-result .modal-close").first.click()
            page.wait_for_timeout(300)

        # -------------------------------------------------------------
        # TEST SUITE 9: Material 3 Mobile Layout Verification
        # -------------------------------------------------------------
        print("\n--- 9. Material 3 Mobile Layout Verification ---")
        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(600)

        m3_bottom_nav_visible = page.is_visible(".m3-bottom-nav")
        record("Mobile bottom navigation bar is visible on mobile viewport", m3_bottom_nav_visible)

        m3_fab_visible = page.is_visible("#m3-fab")
        record("Floating Action Button (FAB) is visible", m3_fab_visible)

        # Mobile bottom nav tabs
        page.click(".m3-nav-item[data-m3-tab='annotate']")
        page.wait_for_timeout(500)
        sheet_markup_open = page.is_visible("#m3-sheet-markup.open")
        record("Tapping Annotate bottom nav item opens Markup bottom sheet", sheet_markup_open)

        page.click("#m3-close-markup")
        page.wait_for_timeout(500)
        record("Markup bottom sheet closes cleanly", not page.is_visible("#m3-sheet-markup.open"))

        # Mobile Drawer
        page.click("#m3-btn-drawer")
        page.wait_for_timeout(500)
        drawer_open = page.is_visible("#m3-drawer.open")
        record("Hamburger button opens Material 3 Navigation Drawer", drawer_open)

        page.click("#m3-drawer-close")
        page.wait_for_timeout(500)
        record("Navigation Drawer closes cleanly", not page.is_visible("#m3-drawer.open"))

        # Restore desktop viewport
        page.set_viewport_size({"width": 1440, "height": 900})
        page.wait_for_timeout(600)
        record("Restored desktop viewport", True)

        # -------------------------------------------------------------
        # TEST SUITE 10: Real Document Stress Test (SQL Server Advanced Concepts.pdf)
        # -------------------------------------------------------------
        print("\n--- 10. Real Document Stress Test (SQL Server Advanced Concepts.pdf) ---")
        sql_pdf = ROOT / "test-docs" / "SQL Server Advanced Concepts.pdf"
        page.set_input_files("#file-input", str(sql_pdf))
        page.wait_for_selector("#page-wrapper-13 .textLayer span", timeout=25000)
        page.wait_for_timeout(1000)

        sql_pages = page.evaluate("() => window.app.viewer.totalPages")
        record("Large real-world PDF loaded successfully", sql_pages >= 13, f"Pages: {sql_pages}")

        # Search across multi-page document
        page.fill("#search-input", "partition")
        page.wait_for_timeout(1000)
        sql_search_count = page.locator("#search-count").inner_text()
        record("Search finds occurrences across 13+ pages", "/" in sql_search_count and not sql_search_count.startswith("0/0"), sql_search_count)

        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
        esc_sql_count = page.locator("#search-count").inner_text()
        record("Escape key clears search in multi-page document", esc_sql_count == "0/0", esc_sql_count)

        # Burn annotations and check exported PDF size
        burned_bytes = page.evaluate("""async () => {
            const buf = await window.app.annotator.burnAnnotationsToPdf(window.app.currentPdfBytes);
            return buf ? buf.byteLength : 0;
        }""")
        record("burnAnnotationsToPdf generates valid PDF buffer", burned_bytes > 100000, f"Size: {burned_bytes} bytes")

        # Check console and page errors
        print("\n--- Console & Error Log Review ---")
        print(f"Page errors: {len(page_errors)}")
        for err in page_errors:
            print(f"  [ERROR] {err}")
        print(f"Console errors: {len(console_errors)}")
        for err in console_errors:
            print(f"  [CONSOLE] {err}")

        record("Zero unhandled page errors", len(page_errors) == 0, f"Errors: {len(page_errors)}")

        browser.close()

    print("\n" + "=" * 80)
    print(f" Test Summary: {len(RESULTS) - len(FAILURES)} / {len(RESULTS)} Passed")
    if FAILURES:
        print(f" Failed Tests ({len(FAILURES)}):")
        for f, d in FAILURES:
            print(f"   - {f}: {d}")
    print("=" * 80)

    return len(FAILURES) == 0

if __name__ == "__main__":
    success = run_live_tests()
    sys.exit(0 if success else 1)
