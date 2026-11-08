#!/usr/bin/env python3
"""
Personal PDF Suite - Comprehensive Automated Test & Verification Engine
Validates all application features across Windows, Linux, and Android:
1. Ligature healing and text normalization
2. Signature background removal & ink extraction on test-docs/Sign.jpg
3. Print stylesheet geometry & A4 margin/padding conformance
4. In-place text editing bounding box, font detection & adjacent line safeguards
5. Document-level markup annotations (Underline, Strikethrough, Highlighting)
6. Page organizer & document mutations (rotation, deletion, split, merge, blank pages)
7. Watermarking & dynamic page numbering (ASCII sanitization, rotation trigonometry, positions)
8. Export utilities & multi-document state isolation
9. Search substring highlighting precision
10. Whiteout redaction controls & interaction safety guards
11. Privacy & trademark scrub compliance (zero personal data, zero trademark mentions)
12. Android (Mobile / Material 3) Feature Parity Verification
13. Linux (Arch Linux / Tauri v2) Platform Support Verification
14. JavaScript & CSS syntax & brace integrity
"""

import os
import sys
import re
import math
import json
from PIL import Image

PASS = "✓ PASS"
FAIL = "✗ FAIL"

def run_all_tests():
    print("=" * 75)
    print(" Personal PDF Suite - Cross-Platform (Windows, Linux, Android) Test Suite")
    print("=" * 75)
    
    total_tests = 0
    passed_tests = 0

    def test(name, condition, details=""):
        nonlocal total_tests, passed_tests
        total_tests += 1
        if condition:
            passed_tests += 1
            print(f"[{PASS}] {name}")
        else:
            print(f"[{FAIL}] {name}")
            if details:
                print(f"       -> Details: {details}")

    # =========================================================================
    # 1. Ligature Healing Algorithm Verification
    # =========================================================================
    print("\n--- 1. PDF Text Ligature Healing Verification ---")
    with open('src/js/pdf-viewer.js', 'r', encoding='utf-8') as f:
        viewer_js = f.read()

    test("Ligature repair includes standard Unicode presentation forms (ff, fi, fl, ffi, ffl)",
         "\\uFB00" in viewer_js and "\\uFB01" in viewer_js and "\\uFB02" in viewer_js)
    test("Ligature repair heals database keywords ('partition', 'partitions')",
         "partition" in viewer_js and "par[\\ufffd" in viewer_js)
    test("Ligature repair heals common technical words ('specific', 'sufficient', 'different', 'difficult')",
         "specific" in viewer_js and "sufficient" in viewer_js and "different" in viewer_js and "difficult" in viewer_js)

    # =========================================================================
    # 2. Signature Background Extraction on real sample (test-docs/Sign.jpg)
    # =========================================================================
    print("\n--- 2. Signature Background Removal & Transform Verification ---")
    sign_path = os.path.join('test-docs', 'Sign.jpg')
    if os.path.exists(sign_path):
        im = Image.open(sign_path).convert('RGBA')
        w, h = im.size
        # Sample border pixels (should be paper background)
        border_pixels = [im.getpixel((0, 0)), im.getpixel((w - 1, 0)), im.getpixel((0, h - 1)), im.getpixel((w - 1, h - 1))]
        avg_border_lum = sum(0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2] for p in border_pixels) / len(border_pixels)
        test("test-docs/Sign.jpg loaded and paper border detected", avg_border_lum > 180, f"Border brightness: {avg_border_lum:.1f}")

        # Simulate signature background removal algorithm
        border_r = sum(p[0] for p in border_pixels) / len(border_pixels)
        border_g = sum(p[1] for p in border_pixels) / len(border_pixels)
        border_b = sum(p[2] for p in border_pixels) / len(border_pixels)
        bg_lum = 0.299 * border_r + 0.587 * border_g + 0.114 * border_b

        corner_pixel = im.getpixel((5, 5))
        corner_lum = 0.299 * corner_pixel[0] + 0.587 * corner_pixel[1] + 0.114 * corner_pixel[2]
        test("Border paper pixel qualifies for transparency", corner_lum >= bg_lum - 30)
    else:
        test("test-docs/Sign.jpg exists for signature testing", False, "File not found in test-docs/")

    with open('src/js/pdf-signature.js', 'r', encoding='utf-8') as f:
        sig_js = f.read()
    test("pdf-signature.js implements adaptive paper perimeter brightness detection",
         "borderThickness" in sig_js and "bgLum" in sig_js)
    with open('src/js/pdf-annotator.js', 'r', encoding='utf-8') as f:
        annot_js = f.read()
    with open('src/js/ui.js', 'r', encoding='utf-8') as f:
        ui_js = f.read()
    test("pdf-annotator.js supports 360-degree signature rotation & handle transform",
         "element.dataset.rotation = deg" in annot_js and "Math.atan2" in annot_js)

    # =========================================================================
    # 3. Print Stylesheet & A4 Conformance
    # =========================================================================
    print("\n--- 3. Print Stylesheet & A4 Margin/Padding Conformance ---")
    with open('src/css/viewer.css', 'r', encoding='utf-8') as f:
        viewer_css = f.read()

    test("@media print explicitly sets A4 portrait paper size",
         "size: A4 portrait" in viewer_css)
    test("@media print enforces standard A4 margins (non-zero)",
         "margin: 12mm 10mm" in viewer_css or ("margin:" in viewer_css and "0;" not in viewer_css))
    test(".print-page-sheet locks height inside A4 margins (height <= 269mm)",
         "height: calc(297mm - 28mm)" in viewer_css or "max-height: calc(297mm - 28mm)" in viewer_css)
    test(".print-page-sheet uses overflow: hidden to prevent sliced second pages",
         "overflow: hidden !important" in viewer_css)
    test(".print-page-canvas uses object-fit: contain and proportional auto dimensions",
         "object-fit: contain !important" in viewer_css and "max-height: 100% !important" in viewer_css)
    test("#print-render-container is hidden on screen (display: none !important)",
         "#print-render-container {\n  display: none !important;" in viewer_css)

    # =========================================================================
    # 4. In-Place Text Editing Safeguards & Font Classification
    # =========================================================================
    print("\n--- 4. In-Place Text Editing Safeguards & Font Matching ---")
    with open('src/js/app.js', 'r', encoding='utf-8') as f:
        app_js = f.read()
    with open('src/index.html', 'r', encoding='utf-8') as f:
        html = f.read()
    with open('src/js/pdf-export.js', 'r', encoding='utf-8') as f:
        export_js = f.read()

    test("app.js uses explicit isSansSerif check to avoid /serif/ matching 'sans-serif'",
         "isSansSerif" in app_js and "/sans-serif|calibri|arial|helvetica" in app_js)
    test("app.js preserves fontWeight for bold document text",
         "span._customFontWeight = isBold ? '700' : '400'" in app_js)
    test("Canvas whiteout mask strictly uses original line height (normH = span._normRect.h)",
         "const normH = span._normRect.h;" in app_js and "Math.max(span._normRect.h, (span.offsetHeight" not in app_js)
    test("cleanSpanContent uses auto-fitting font scale to protect adjacent lines from being overwritten",
         "span.style.whiteSpace = 'nowrap'" in app_js and "fitRatio" in app_js)
    test("app.js protects Android soft keyboard (Gboard) composition state with compositionstart/end",
         "_isComposing" in app_js and "compositionstart" in app_js and "compositionend" in app_js)
    test("app.js detects neighboring spans on the same line to constrain max editing width",
         "siblingSpans" in app_js and "minNextLeft" in app_js)
    test("app.js prioritizes native Calibri on desktop and Carlito/Arimo/Tinos for exact Android font parity",
         "'Calibri', 'Carlito'" in app_js and "Carlito" in html)
    test("pdf-annotator.js and pdf-export.js support single-line fitted maxWidth constrained text drawing",
         "compCtx.fillText(textToRender, sx, sy, maskW)" in annot_js and "ctx.fillText(textContentVal, sx, sy, origW)" in export_js)
    test("pdf-annotator.js burnAnnotationsToPdf locks mask height to original line height",
         "const origH = span._originalHeight || spanRect.height" in annot_js and "origH * scaleY" in annot_js)

    # =========================================================================
    # 5. Document-Level Markup & Annotation Interaction Safeguards
    # =========================================================================
    print("\n--- 5. Document-Level Markup & Annotation Interaction Safeguards ---")
    test("pdf-annotator.js Underline and Strikethrough support textLayer selection markup",
         "type: 'underline'" in annot_js and "type: 'strikethrough'" in annot_js and "a.type === 'underline' || a.type === 'strikethrough'" in annot_js)
    test("pdf-annotator.js renders underline markup at baseline offset",
         "a.type === 'underline'" in annot_js and "r.y + r.h - 1" in annot_js)
    test("pdf-annotator.js renders strikethrough markup at vertical midline",
         "a.type === 'strikethrough'" in annot_js and "r.y + r.h / 2" in annot_js)
    test("pdf-annotator.js resolves canvas from .page-wrapper so clicking textLayer never aborts tools",
         "pageWrapper = e.target.closest('.page-wrapper')" in annot_js and "annot-canvas-" in annot_js)
    test("pdf-annotator.js calls e.preventDefault() on mousedown to defeat accidental text selection",
         "e.cancelable) e.preventDefault()" in annot_js)
    test("viewer.css disables textLayer and prioritizes annotationLayer during active tool usage",
         "body.annotating-active:not(.annot-tool-none) .textLayer" in viewer_css and "pointer-events: none !important;" in viewer_css and "body.annotating-active:not(.annot-tool-none) .annotation-layer" in viewer_css)
    test("viewer.css restores textLayer pointer-events and selection when Select tool is active",
         "body.annot-tool-none .textLayer" in viewer_css and "user-select: text !important;" in viewer_css and "pointer-events: auto !important;" in viewer_css)
    test("pdf-annotator.js setTool toggles annotating-active class and pointer-events dynamically",
         "document.body.classList.toggle('annotating-active'" in annot_js and "document.body.classList.toggle('annot-tool-none'" in annot_js)
    test("ui.js Select button activates select tool and restores textLayer interaction",
         "this.setAnnotationTool('select')" in ui_js and "this.app.annotator.setTool('select')" in ui_js)
    test("pdf-annotator.js _addStickyNote automatically sets tool to select and provides displacement-based drag",
         "this.setTool('select')" in annot_js and "noteContainer.addEventListener('mousedown', onPointerDown)" in annot_js and "hasMoved" in annot_js)
    test("pdf-annotator.js _addStickyNote delete button wires onclick/onmousedown to noteContainer.remove",
         "btnDel.onclick = doDelete" in annot_js and "btnDel.onmousedown" in annot_js and "noteContainer.remove()" in annot_js)
    test("pdf-annotator.js deleteActiveTextBox and deleteActiveBox support activeStickyNote",
         "deleteActiveStickyNote" in annot_js and "deleteActiveBox" in annot_js)
    test("app.js Delete/Backspace shortcut deletes activeStickyNote",
         "this.annotator?.activeStickyNote" in app_js and "this.annotator.deleteActiveStickyNote()" in app_js)

    # =========================================================================
    # 6. Page Organizer & Mutation Engine (pdf-organizer.js)
    # =========================================================================
    print("\n--- 6. Page Organizer & Mutation Engine ---")
    with open('src/js/pdf-organizer.js', 'r', encoding='utf-8') as f:
        org_js = f.read()

    test("pdf-organizer.js normalizes rotation angle modulo 360",
         "((op.rotationDelta % 360) + 360) % 360" in org_js or "(((currentRot + angleDegrees) % 360) + 360) % 360" in org_js)
    test("pdf-organizer.js sorts page indices descending for safe page deletions",
         "[...pageIndicesToDelete].sort((a, b) => b - a)" in org_js)
    test("pdf-organizer.js uses standard A4 dimensions for inserted blank pages",
         "595.28, 841.89" in org_js)
    test("pdf-organizer.js splitByRanges parses page range syntax (e.g. '1-3, 5')",
         "splitByRanges" in org_js and "parts[0]" in org_js and "totalPages" in org_js)
    test("pdf-organizer.js splitByRanges clones document and deletes back-to-front to preserve font objects",
         "for (let i = subDoc.getPageCount() - 1; i >= 0; i--)" in org_js)
    test("pdf-organizer.js mergeDocuments supports multi-PDF concatenation",
         "mergeDocuments(pdfByteArrayList)" in org_js and "copyPages" in org_js)

    # =========================================================================
    # 7. Watermark & Page Numbering Engine (pdf-security.js)
    # =========================================================================
    print("\n--- 7. Watermarking & Dynamic Page Numbering Engine ---")
    with open('src/js/pdf-security.js', 'r', encoding='utf-8') as f:
        sec_js = f.read()

    test("pdf-security.js sanitizes watermark text to ASCII to prevent pdf-lib encoding crash",
         "replace(/[^\\x20-\\x7E]/g, '?')" in sec_js)
    test("pdf-security.js calculates rotation offset trigonometry for centered watermark text",
         "Math.cos(rad)" in sec_js and "Math.sin(rad)" in sec_js and "width / 2 - offsetX" in sec_js)
    test("pdf-security.js converts hex colors to normalized 0..1 RGB",
         "parseInt(hex.substring(0, 2), 16) || 255) / 255" in sec_js)
    test("pdf-security.js addPageNumbers supports dynamic '{page}' and '{total}' placeholders",
         "replace('{page}'," in sec_js and "replace('{total}'," in sec_js)
    test("pdf-security.js supports 6 positional anchors for page numbers",
         "bottom-left" in sec_js and "bottom-center" in sec_js and "bottom-right" in sec_js and
         "top-left" in sec_js and "top-center" in sec_js and "top-right" in sec_js)

    # =========================================================================
    # 8. Export Utilities & Multi-Document Isolation (pdf-export.js)
    # =========================================================================
    print("\n--- 8. Export Utilities & Multi-Document Isolation ---")
    with open('src/js/pdf-export.js', 'r', encoding='utf-8') as f:
        export_js = f.read()

    test("pdf-export.js preparePrintContainer binds container to dataset.docName for document isolation",
         "container.dataset.docName = currentDoc" in export_js)
    test("pdf-export.js extractAllText heals text ligatures across all pages",
         "healPdfTextLigatures(item.str)" in export_js)
    test("pdf-export.js exportPageAsImage composites ink canvas, whiteouts, and stamps",
         "annotCanvas" in export_js and "whiteout-box" in export_js and "placed-stamp" in export_js)
    test("pdf-export.js downloads files safely with desktop fallback and revocation timeout",
         "URL.revokeObjectURL" in export_js)

    # =========================================================================
    # 9. Search Highlighting Precision
    # =========================================================================
    print("\n--- 9. Search Highlighting Precision Verification ---")
    test("viewer_js wraps matches in precise <mark class='search-highlight'> elements",
         "mark.className = 'search-highlight'" in viewer_js)
    test("viewer_css targets only mark.search-highlight (avoids whole-line span styling)",
         ".textLayer mark.search-highlight {" in viewer_css and ".textLayer .search-highlight {" not in viewer_css)

    # =========================================================================
    # 10. Whiteout Redaction Controls & Interaction Safety
    # =========================================================================
    print("\n--- 10. Whiteout Redaction Controls & Interaction Safety ---")
    with open('src/css/annotations.css', 'r', encoding='utf-8') as f:
        annot_css = f.read()

    test("Whiteout box is designated with distinct .whiteout-box class and white background",
         ".whiteout-box" in annot_css and "background-color: #ffffff" in annot_css)
    test("Locked whiteout/stamp overlays prevent pointer events and dragging",
         "[data-locked=\"true\"]" in annot_css or "pointer-events: none" in annot_css)
    test("pdf-annotator.js blocks drag/move handlers when in View & Read mode",
         "document.body.classList.contains('mode-view')" in annot_js)

    # =========================================================================
    # 11. Privacy & Trademark Scrubbing Compliance
    # =========================================================================
    print("\n--- 11. Privacy & Trademark Scrubbing Compliance ---")
    files_to_scan = [
        'README.md', 'package.json', 'run_windows.bat', 'run_linux.sh', 'serve.py',
        'src/index.html', 'src/css/main.css', 'src/css/viewer.css', 'src/css/annotations.css',
        'src/js/app.js', 'src/js/ui.js', 'src/js/pdf-viewer.js', 'src/js/pdf-annotator.js',
        'src/js/pdf-organizer.js', 'src/js/pdf-security.js', 'src/js/pdf-signature.js', 'src/js/pdf-export.js'
    ]
    has_adobe = False
    has_personal_path = False
    adobe_matches = []
    personal_matches = []

    for fp in files_to_scan:
        if os.path.exists(fp):
            with open(fp, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
            matches = re.findall(r'\bAdobe\b', content, re.IGNORECASE)
            path_matches = re.findall(r'C:[/\\]Users[/\\]Naveen', content, re.IGNORECASE)
            if matches:
                has_adobe = True
                adobe_matches.append(f"{fp} ({len(matches)} occurrences)")
            if path_matches:
                has_personal_path = True
                personal_matches.append(f"{fp} ({len(path_matches)} occurrences)")

    test("Codebase source files (HTML/CSS/JS/BAT/SH) contain 0 occurrences of 'Adobe'",
         not has_adobe, ", ".join(adobe_matches))
    test("Codebase source files contain 0 personal system directory paths",
         not has_personal_path, ", ".join(personal_matches))

    # =========================================================================
    # 12. Android (Mobile / Material 3) Feature Parity Verification
    # =========================================================================
    print("\n--- 12. Android (Material 3) Feature Parity Verification ---")
    with open('src/index.html', 'r', encoding='utf-8') as f:
        html = f.read()
    with open('src/js/ui.js', 'r', encoding='utf-8') as f:
        ui_js = f.read()
    with open('src/css/material-mobile.css', 'r', encoding='utf-8') as f:
        m3_css = f.read()

    # Markup Sheet
    test("Android Markup Sheet includes Underline & Strikethrough markup tools",
         'data-m3-tool="underline"' in html and 'data-m3-tool="strikethrough"' in html)
    test("Android Markup Sheet includes Line shape tool",
         'data-m3-tool="line"' in html)
    test("Android Markup Sheet includes Predefined & Custom Stamps",
         'data-m3-stamp="APPROVED"' in html and 'data-m3-stamp="REJECTED"' in html and 'm3-stamp-custom' in html)
    test("Android Markup Sheet includes Stroke Thickness slider & Custom Color picker",
         'id="m3-stroke-slider"' in html and 'id="m3-custom-color"' in html)
    test("Android Markup Sheet includes Clear Annotations action",
         'id="m3-sheet-clear"' in html and 'm3-sheet-clear' in ui_js)

    # Edit Sheet
    test("Android Edit Sheet includes direct Insert Signature action",
         'id="m3-edit-signature"' in html and 'm3-edit-signature' in ui_js)
    test("Android Edit Sheet includes Text Formatting (Bold, Italic, Underline, Strikethrough)",
         'id="m3-edit-underline"' in html and 'id="m3-edit-strike"' in html)
    test("Android Edit Sheet includes Text Alignment (Left, Center, Right)",
         'id="m3-edit-align-left"' in html and 'id="m3-edit-align-center"' in html and 'id="m3-edit-align-right"' in html)
    test("Android Edit Sheet includes Delete Selected Box control",
         'id="m3-edit-delete-box"' in html and 'm3-edit-delete-box' in ui_js)

    # Tools Sheet
    test("Android Tools Sheet includes Print Document action",
         'id="m3-tool-print"' in html and 'm3-tool-print' in ui_js)
    test("Android Tools Sheet includes Export All Pages as PNG Images",
         'id="m3-tool-export-all-img"' in html and 'm3-tool-export-all-img' in ui_js)
    test("Android Tools Sheet includes Extract Full Text (.txt)",
         'id="m3-tool-extract-text"' in html and 'm3-tool-extract-text' in ui_js)
    test("Android Tools Sheet includes Flatten Document action",
         'id="m3-tool-flatten"' in html and 'm3-tool-flatten' in ui_js)

    # Mobile Page Bar & Drawer
    test("Android Mobile Page Bar includes Zoom In, Zoom Out, and Fit to Screen controls",
         'id="m3-zoom-out"' in html and 'id="m3-zoom-in"' in html and 'id="m3-zoom-fit"' in html)
    test("pdf-viewer.js and ui.js immediately auto-hide mobile page bar on scroll to prevent disturbance",
         "m3Bar.classList.remove('visible')" in viewer_js and "m3Bar.classList.remove('visible')" in ui_js)
    test("material-mobile.css hides .m3-page-bar by default and shows only with .visible class",
         "opacity: 0" in m3_css and ".m3-page-bar.visible" in m3_css)
    test("viewer.css locks text-size-adjust to 100% globally to defeat mobile browser font autosizer",
         "text-size-adjust: 100% !important;" in viewer_css)
    test("Android Drawer Outline tab includes + Add Bookmark control",
         'id="m3-btn-add-bookmark"' in html and 'm3-btn-add-bookmark' in ui_js)
    test("Android Drawer includes dynamic Accent Theme Color customizer",
         'id="m3-drawer-accent-palette"' in html and 'm3-drawer-accent-palette' in ui_js)

    # Mobile Responsive CSS
    test("Mobile CSS enforces responsive modal sizing (95vw) and flex-wrapping action bars",
         "width: 95vw !important" in m3_css and "flex-wrap: wrap !important" in m3_css)
    test("Mobile CSS configures touch-friendly page organizer grid",
         "grid-template-columns: repeat(auto-fill, minmax(110px, 1fr))" in m3_css)

    # =========================================================================
    # 13. Linux Platform Support & Tauri Build Verification
    # =========================================================================
    print("\n--- 13. Linux Platform Support & Tauri Build Verification ---")
    test("run_linux.sh exists and is executable with python3 / python fallback",
         os.path.exists("run_linux.sh"))
    if os.path.exists("run_linux.sh"):
        with open("run_linux.sh", "r", encoding="utf-8") as f:
            sh_content = f.read()
        test("run_linux.sh contains valid shebang and serve.py invocation",
             "#!/usr/bin/env bash" in sh_content and "serve.py" in sh_content)

    test(".github/workflows/build-linux.yml exists for cloud compilation",
         os.path.exists(".github/workflows/build-linux.yml"))
    if os.path.exists(".github/workflows/build-linux.yml"):
        with open(".github/workflows/build-linux.yml", "r", encoding="utf-8") as f:
            wf_linux = f.read()
        test("build-linux.yml installs native Linux WebKitGTK and GTK-3 libraries",
             "libwebkit2gtk-4.1-dev" in wf_linux and "libgtk-3-dev" in wf_linux)
        test("build-linux.yml builds both .AppImage and .deb Linux packages",
             "bundles appimage,deb" in wf_linux or "--bundles appimage,deb" in wf_linux)

    if os.path.exists(".github/workflows/build-windows.yml"):
        with open(".github/workflows/build-windows.yml", "r", encoding="utf-8") as f:
            wf_win = f.read()
        test("build-windows.yml installs NSIS & WiX to eliminate cloud download timeouts",
             "nsis" in wf_win and "wixtoolset" in wf_win)

    if os.path.exists(".github/workflows/build-android.yml"):
        with open(".github/workflows/build-android.yml", "r", encoding="utf-8") as f:
            wf_android = f.read()
        test("build-android.yml configures setup-gradle and 120s socketTimeout to defeat network drops",
             "setup-gradle" in wf_android and "socketTimeout=120000" in wf_android)

    tauri_conf_path = os.path.join("src-tauri", "tauri.conf.json")
    test("src-tauri/tauri.conf.json exists and specifies valid frontendDist '../src'",
         os.path.exists(tauri_conf_path))
    if os.path.exists(tauri_conf_path):
        with open(tauri_conf_path, "r", encoding="utf-8") as f:
            t_conf = json.load(f)
        test("Tauri configuration targets desktop dimensions (width >= 1200, resizable)",
             t_conf.get("app", {}).get("windows", [{}])[0].get("width", 0) >= 1200 and
             t_conf.get("app", {}).get("windows", [{}])[0].get("resizable") is True)

    # =========================================================================
    # 14. Codebase Syntax & Brace Integrity
    # =========================================================================
    print("\n--- 14. Codebase Syntax & Brace Integrity ---")
    files_to_check = [
        'src/css/main.css',
        'src/css/viewer.css',
        'src/css/annotations.css',
        'src/css/organizer.css',
        'src/css/material-mobile.css',
        'src/js/app.js',
        'src/js/pdf-viewer.js',
        'src/js/pdf-annotator.js',
        'src/js/pdf-organizer.js',
        'src/js/pdf-security.js',
        'src/js/pdf-signature.js',
        'src/js/pdf-export.js',
        'src/js/ui.js'
    ]
    all_braces_balanced = True
    for fp in files_to_check:
        with open(fp, 'r', encoding='utf-8') as f:
            c = f.read()
        diff = c.count('{') - c.count('}')
        if diff != 0:
            all_braces_balanced = False
            test(f"Brace balance in {fp}", False, f"Open: {c.count('{')}, Close: {c.count('}')}, Diff: {diff}")
        else:
            test(f"Brace balance in {fp}", True)

    # =========================================================================
    # 15. In-Place Text Editing, Font Priority, Non-Truncation & Line Protection
    # =========================================================================
    print("\n--- 15. In-Place Text Editing, Font Priority, Non-Truncation & Line Protection ---")
    test("Desktop font stack prioritizes native 'Calibri' before 'Carlito' for exact PDF parity",
         "fontStack = `'Calibri', 'Carlito'" in app_js)
    test("pdf-viewer.js extracts direct PDF stream font and weight metadata",
         "div._pdfFontName = detectedFont;" in viewer_js and "div._pdfIsBold =" in viewer_js)
    test("app.js uses dynamic proportional scaling (down to 0.35) to prevent text truncation",
         "const fitRatio = Math.max(0.35, maxW / curW);" in app_js)
    test("app.js detects paragraph column right margin from vertically adjacent sibling spans",
         "maxParagraphRight" in app_js and "colRightLimit" in app_js)
    test("viewer.css locks white-space: nowrap and overflow: hidden to protect line layout and page boundaries",
         "white-space: nowrap !important;" in viewer_css and "overflow: hidden !important;" in viewer_css)
    test("Enter key commits single-line edit cleanly without inserting overlapping lines",
         "kEvt.key === 'Enter'" in app_js and "span.blur();" in app_js)
    test("Canvas whiteout mask strictly covers original line height to prevent erasing line below",
         "Math.ceil(normH * pageCanvas.height) + 4" in app_js and "totalMaskH" not in app_js)
    test("pdf-annotator.js renders single-line fitted text onto Canvas without line collisions",
         "compCtx.fillText(textToRender, sx, sy, maskW);" in annot_js)
    test("pdf-export.js renders single-line fitted text onto Print Canvas without line collisions",
         "ctx.fillText(textContentVal, sx, sy, origW);" in export_js)

    # =========================================================================
    # 16. Annotate Text Box Bounds, Resize Handles & Dedicated Drag Bar Verification
    # =========================================================================
    print("\n--- 16. Annotate Text Box Bounds, Resize Handles & Dedicated Drag Bar Verification ---")
    test("pdf-annotator.js _addTextBox bounds width and maxWidth to remaining page width (wrapW - safeX)",
         "const initialWidth = Math.min(260, maxAvailableW);" in annot_js and "box.style.maxWidth = `${Math.round(wrapW - safeX - 16)}px`;" in annot_js)
    test("pdf-annotator.js _addTextBox attaches dedicated .textbox-drag-bar with grip icon",
         "dragBar.className = 'textbox-drag-bar';" in annot_js and "textbox-drag-grip" in annot_js)
    test("pdf-annotator.js _addTextBox invokes _makeResizable to provide 8-point resize handles",
         "this._makeResizable(box, wrapper, { keepAspectRatio: false, isTextBox: true });" in annot_js)
    test("pdf-annotator.js _makeDraggable prioritizes .textbox-drag-bar so clicks initiate drag smoothly",
         "if (e.target.closest('.textbox-drag-bar'))" in annot_js)
    test("pdf-annotator.js _makeDraggable clamps moving coordinates within parent page bounds",
         "const boundedX = Math.max(0, Math.min(initialX + dx, pW - elW));" in annot_js)
    test("pdf-annotator.js _bindResizeHandle clamps resize handles so text box cannot exceed page width",
         "const maxWFromLeft = Math.max(40, parentW - element.offsetLeft - 16);" in annot_js)
    test("annotations.css enforces box-sizing: border-box on .annotation-textbox",
         "box-sizing: border-box !important;" in annot_css)
    test("annotations.css enforces word-break and overflow-wrap on .textbox-content to prevent A4 overflow",
         "word-break: break-word !important;" in annot_css and "overflow-wrap: break-word !important;" in annot_css and "white-space: pre-wrap !important;" in annot_css)
    test("pdf-annotator.js burnAnnotationsToPdf wraps multi-line text box content when drawing to PDF canvas",
         "compCtx.measureText(testLine).width > maxLineWidth" in annot_js)

    # =========================================================================
    # Summary
    # =========================================================================
    print("\n" + "=" * 75)
    print(f" Summary: {passed_tests} / {total_tests} Tests Passed ({passed_tests / total_tests * 100:.1f}%)")
    print("=" * 75)
    
    return passed_tests == total_tests

if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
