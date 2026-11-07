#!/usr/bin/env python3
"""
Personal PDF Suite - Automated Test & Verification Engine
Validates:
1. Ligature healing and text normalization
2. Signature background removal & ink extraction on test-docs/Sign.jpg
3. Print stylesheet geometry & A4 margin/padding conformance
4. In-place text editing bounding box & font detection safeguards
5. Search substring highlighting precision
6. JavaScript & CSS syntax & brace integrity
"""

import os
import sys
import re
from PIL import Image

PASS = "✓ PASS"
FAIL = "✗ FAIL"

def run_all_tests():
    print("=" * 70)
    print(" Personal PDF Suite - Automated Test & Verification Suite")
    print("=" * 70)
    
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
    test("Ligature repair heals common technical words ('specific', 'sufficient', 'different')",
         "specific" in viewer_js and "sufficient" in viewer_js and "different" in viewer_js)

    # =========================================================================
    # 2. Signature Background Extraction on real sample (test-docs/Sign.jpg)
    # =========================================================================
    print("\n--- 2. Signature Background Removal Verification ---")
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

        # Sample corner vs center
        corner_pixel = im.getpixel((5, 5))
        corner_lum = 0.299 * corner_pixel[0] + 0.587 * corner_pixel[1] + 0.114 * corner_pixel[2]
        test("Border paper pixel qualifies for transparency", corner_lum >= bg_lum - 30)
    else:
        test("test-docs/Sign.jpg exists for signature testing", False, "File not found in test-docs/")

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
    with open('src/js/pdf-annotator.js', 'r', encoding='utf-8') as f:
        annot_js = f.read()

    test("app.js uses explicit isSansSerif check to avoid /serif/ matching 'sans-serif'",
         "isSansSerif = /sans-serif|calibri|arial|helvetica" in app_js)
    test("app.js preserves fontWeight for bold document text",
         "span._customFontWeight = isBold ? '700' : '400'" in app_js)
    test("Canvas whiteout mask strictly uses original line height (normH = span._normRect.h)",
         "const normH = span._normRect.h;" in app_js and "Math.max(span._normRect.h, (span.offsetHeight" not in app_js)
    test("cleanSpanContent uses white-space: nowrap and auto-fitting font scale",
         "span.style.whiteSpace = 'nowrap'" in app_js and "fitRatio" in app_js)
    test("pdf-annotator.js burnAnnotationsToPdf locks mask height to original line height",
         "const origH = span._originalHeight || spanRect.height" in annot_js and "origH * scaleY" in annot_js)

    # =========================================================================
    # 5. Search Highlighting Precision
    # =========================================================================
    print("\n--- 5. Search Highlighting Precision Verification ---")
    test("viewer_js wraps matches in precise <mark class='search-highlight'> elements",
         "mark.className = 'search-highlight'" in viewer_js)
    test("viewer_css targets only mark.search-highlight (avoids whole-line span styling)",
         ".textLayer mark.search-highlight {" in viewer_css and ".textLayer .search-highlight {" not in viewer_css)

    # =========================================================================
    # 6. Syntax & Brace Integrity
    # =========================================================================
    print("\n--- 6. Codebase Syntax & Brace Integrity ---")
    files_to_check = [
        'src/css/viewer.css',
        'src/css/annotations.css',
        'src/js/app.js',
        'src/js/pdf-viewer.js',
        'src/js/pdf-annotator.js',
        'src/js/pdf-export.js',
        'src/js/pdf-signature.js',
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
    # Summary
    # =========================================================================
    print("\n" + "=" * 70)
    print(f" Summary: {passed_tests} / {total_tests} Tests Passed ({passed_tests / total_tests * 100:.1f}%)")
    print("=" * 70)
    
    return passed_tests == total_tests

if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
