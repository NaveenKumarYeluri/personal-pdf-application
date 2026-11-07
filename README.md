# Personal PDF Suite (Professional Edition)

A high-performance, private, cross-platform PDF application designed as an open-source, desktop-grade PDF suite.

Engineered specifically for **Windows Desktop**, **Arch Linux**, and **Android (APK)**, with zero local RAM or disk bloat — leveraging **GitHub Actions cloud runners** to compile and package production executables, Linux packages, and APKs.

---

## ✨ Features & Capabilities

### 1. Document Viewing & Reading
- **Continuous Multi-Page Canvas**: High-DPI sub-pixel rendering with crisp vector sharpness powered by Mozilla PDF.js.
- **Dynamic Zoom & Fit Modes**: Fit Page, Fit Width, and granular scaling from 10% to 1000%.
- **Thumbnail Navigation Sidebar**: Live rendered page previews with one-click page jumping.
- **Document Outline & Bookmarks**: Hierarchical Table of Contents navigation and custom bookmark creation.
- **Full-Text Keyword Search**: Real-time exact substring matching with `<mark class="search-highlight">` precision, occurrence counters, and wrap-around jump navigation.
- **Automated Ligature Healing**: Cleans and normalizes PDF typography ligatures (`ff`, `fi`, `fl`, `ffi`, `ffl`) and damaged database terms (`partition`, `specific`, `different`, `difficult`).
- **Professional Themes & Accent Colors**: Light and dark mode support with customizable accent palettes (Crimson, Blue, Emerald, Amber, Slate).

### 2. In-Place Content Editing & Redaction
- **In-Place Text Editing**: Click any line of text on any page to edit document copy directly.
- **Intelligent Font Classification**: Automatic sans-serif / Calibri / Arial / Segoe UI font matching with weight detection (bold / regular).
- **Auto-Fitting Scale Safeguard**: Single-line text scaling (`white-space: nowrap`) prevents word-wrapping breaks or multiline overflow.
- **Adjacent Line Protection**: Canvas whiteout mask strictly locked to single-line original bounding height, preventing accidental erasure of neighboring text lines.
- **Whiteout Redaction Blocks**: Draw or drop whiteout boxes with resize handles, lock/unlock protection, and dedicated removal controls.

### 3. Annotation & Markup Suite
- **Freehand Pen & Highlighter**: Adjustable stroke thickness, opacity, smooth bezier curves, and custom color swatches.
- **Document-Level Text Markup**: Native Underline and Strikethrough markup generated directly from text selection across document pages.
- **Sticky Notes**: Persistent comments with author tags, timestamps, and expandable comment threads.
- **Typewriter Text**: Click anywhere on a document page to insert custom typography with font size and color controls.
- **Geometric Shapes**: Rectangles, circles/ellipses, and lines for callouts and diagrams.
- **Stamps Studio**: Predefined stamps (`APPROVED`, `REJECTED`, `CONFIDENTIAL`, `DRAFT`) and custom stamps with 360° rotation handles, resize anchors, and lock/unlock toggles.

### 4. Forms & Electronic Signatures
- **Signature Creation Modes**:
  - **Draw**: Natural ink drawing via mouse, stylus, or touchscreen.
  - **Type**: Generates elegant cursive signatures using stylized handwriting typography.
  - **Upload with Adaptive Paper Background Removal**: Imports scanned or photographed paper signatures, samples paper perimeter luminance, extracts crisp dark/blue pen ink with antialiased alpha transparency, and eliminates paper discoloration.
- **Interactive Transform Controls**: 360° free rotation with cardinal angle snapping (0°, 90°, 180°, 270°), proportional corner resize handles, and lock/unlock toggles.
- **Form Flattening & Permanent Burn**: Bakes interactive fields, signatures, whiteouts, and annotations into the permanent PDF stream.

### 5. Visual Page Organizer
- **Interactive Page Grid**: Visual modal displaying full-page cards for every sheet in the document.
- **Drag-and-Drop Reordering**: Rearrange pages with visual drop targets.
- **Page Rotation**: Rotate individual pages or all pages 90° CW, 90° CCW, or 180°.
- **Page Deletion & Duplication**: Remove pages safely (descending index execution) or clone key pages.
- **Insert Blank Pages**: Add blank standard A4 pages anywhere in the sequence.
- **Split PDF by Ranges**: Split documents using range syntax (e.g., `1-3, 5, 7-10`) with full preservation of fonts, XObjects, and page resources.
- **Merge Documents**: Concatenate multiple PDF files into a single unified document.

### 6. Document Security & Watermarking
- **Custom Watermarks**: Center-aligned diagonal (45°) or horizontal text with trigonometry offset calculations, ASCII sanitization, adjustable opacity, size, and color.
- **Dynamic Header & Footer Numbering**: 6 positional anchors (`top-left`, `top-center`, `top-right`, `bottom-left`, `bottom-center`, `bottom-right`) with dynamic template placeholders (`Page {page} of {total}`).
- **Document Metadata**: View and update document Title, Author, Subject, and Keywords.

### 7. Export Utilities & Multi-Document Tabs
- **Native 1:1 Multi-Page A4 Printing**: High-fidelity `@media print` engine with standard portrait margins (`12mm 10mm`), container isolation, and lifecycle handling to prevent zero-byte blank prints.
- **High-Resolution Image Export**: Export any page or all pages to high-resolution PNG or JPEG images.
- **Clean Text Extraction**: Extract cleaned full document text to `.txt` files with automated ligature normalization.
- **Multi-Document Workspace**: Tabbed interface with isolated search counters, outline trees, and document states.

---

## 🚀 Running Locally (Zero-RAM Mode)

To run the application locally on Windows or Linux using standard libraries with **< 30 MB of RAM** and zero local build dependencies:

### On Windows:
1. Double-click:
   ```cmd
   run_windows.bat
   ```
   *Or launch via command line:*
   ```cmd
   python serve.py
   ```

### On Linux (Arch Linux, Ubuntu, Fedora):
1. Run:
   ```bash
   chmod +x run_linux.sh
   ./run_linux.sh
   ```
   *Or launch via command line:*
   ```bash
   python3 serve.py
   ```
2. The application will launch in a clean desktop application window.

---

## 🏗️ Architecture & Shells

- **Core Engine**: Mozilla PDF.js (rendering & text layer) + pdf-lib (document mutation, reordering, splitting, merging, watermarking).
- **Mobile (Android APK)**: Google Material 3 (M3) design with Bottom Navigation, Floating Action Button, Bottom Sheets, and multi-touch pinch-to-zoom (Capacitor).
- **Desktop (Windows & Arch Linux)**: **Tauri v2** (Rust + Native WebView2 / WebKitGTK):
  - Binary size: **~10 MB** (vs 180 MB on Electron).
  - Idle RAM: **< 35 MB** (vs 300 MB on Electron).
  - Instant cold startup.

---

## 🛠️ Building Applications via GitHub Actions

All production builds are compiled in the cloud by **GitHub Actions** (16 GB RAM cloud runners):

### Target 1: Windows Application (Tauri v2)
- Workflow: `.github/workflows/build-windows.yml`
- Output: Lightweight native Windows installer (`.msi`) and standalone executable (`.exe`).
- Download from: GitHub Actions **Artifacts** tab on your repository.

### Target 2: Arch Linux Application (Tauri v2 - WebKitGTK)
- Workflow: `.github/workflows/build-linux.yml`
- Output: Native Arch-compatible `.AppImage` and `.deb`.
- To run on Linux:
  ```bash
  chmod +x personal-pdf-suite_*.AppImage
  ./personal-pdf-suite_*.AppImage
  ```

### Target 3: Android Application (Material 3 APK)
- Workflow: `.github/workflows/build-android.yml`
- Output: Installable Android `.apk` with Material 3 design, bottom sheets, and touch gestures.

---

## 🧪 Automated Testing & Verification Suite

The repository includes a comprehensive automated test harness covering all features:

```bash
# Run the complete feature test suite (80+ cross-platform assertions for Windows, Linux, Android)
python scripts/run_automated_tests.py

# Run multi-document lifecycle & tab isolation verification
python scripts/test_multi_doc_lifecycle.py
```

You can also run in-browser DOM and canvas tests by loading `src/test-runner.html` in any browser.

---

## 📂 Project Structure

```
personal-pdf-application/
├── .github/workflows/
│   ├── build-windows.yml       # Cloud builder for Windows (.exe)
│   ├── build-linux.yml         # Cloud builder for Arch Linux (.AppImage)
│   └── build-android.yml       # Cloud builder for Android APK (.apk)
├── src/
│   ├── index.html              # Main application ribbon & workspace
│   ├── test-runner.html        # In-browser automated test runner
│   ├── css/
│   │   ├── main.css            # Dark/light themes, ribbons, modal dialogs
│   │   ├── viewer.css          # Continuous canvas rendering & print stylesheets
│   │   ├── annotations.css     # Inking, sticky notes, shapes, stamps, whiteouts
│   │   ├── organizer.css       # Visual page grid & reordering
│   │   └── material-mobile.css # Material 3 mobile UI & responsive modal rules
│   ├── js/
│   │   ├── app.js              # Central orchestrator & in-place text editing
│   │   ├── pdf-viewer.js       # Mozilla PDF.js engine & search
│   │   ├── pdf-organizer.js    # pdf-lib page mutation, split, and merge
│   │   ├── pdf-annotator.js    # Inking, drawing, notes, shapes, markup
│   │   ├── pdf-signature.js    # Signature pad & adaptive background removal
│   │   ├── pdf-security.js     # Watermark, page numbers, metadata
│   │   ├── pdf-export.js       # High-res print, image export, text extraction
│   │   └── ui.js               # Ribbons, sidebars, modal & mobile sheet controls
│   └── assets/
│       └── icons/              # Branding and UI icons
├── scripts/
│   ├── run_automated_tests.py  # Comprehensive automated feature test suite (81 tests)
│   └── test_multi_doc_lifecycle.py # Multi-document transition test
├── capacitor.config.json       # Android APK mobile configuration
├── package.json                # Project manifest & dependencies
├── serve.py                    # Zero-RAM local server
├── run_windows.bat             # 1-click Windows runner
├── run_linux.sh                # 1-click Linux runner
└── .gitignore                  # Clean repository filters
```

---

## 🔒 Privacy & Offline Operation

This application does not connect to any third-party cloud service or analytics. All document parsing, rendering, text editing, signing, and saving occur strictly client-side on your device.
