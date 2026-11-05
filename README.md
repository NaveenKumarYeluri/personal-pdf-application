# Personal PDF Suite (Adobe Acrobat Edition)

A high-performance, cross-platform personal PDF application designed as an open, private alternative to Adobe Acrobat Pro.

Designed specifically for **Windows Desktop**, **Arch Linux**, and **Android (APK)**, with zero local RAM/disk bloat — leveraging **GitHub Actions cloud runners** to compile and package production executables and APKs.

---

## ✨ Features

### 1. Document Viewing & Reading
- **Continuous Multi-Page Canvas**: High-DPI sub-pixel rendering with crisp vector sharpness.
- **Dynamic Zoom**: Fit Page, Fit Width, and custom scaling from 10% to 1000%.
- **Thumbnail Sidebar**: Live rendered page previews with one-click page jumping.
- **Document Outline / Bookmarks**: Nested Table of Contents navigation.
- **Full-Text Keyword Search**: Real-time matching, occurrences counter, and next/previous jump controls.
- **Acrobat Dark & Light Themes**: Comfortable dark mode for reading in low light.

### 2. Annotation & Markup Suite
- **Freehand Pen & Highlighter**: Adjustable stroke thickness, opacity, color palette, and smooth rendering.
- **Sticky Notes**: Add persistent comments with timestamps anywhere on document pages.
- **Typewriter Text**: Click to insert custom typography anywhere on the document.
- **Geometric Shapes**: Rectangles, circles/ellipses, and lines for diagramming and reviews.
- **Predefined & Custom Stamps**: Standard stamps (`APPROVED`, `REJECTED`, `CONFIDENTIAL`, `DRAFT`) with rotation and placement.

### 3. Visual Page Organizer
- **Interactive Page Grid**: Full-screen modal showing cards for every page in the document.
- **Drag-and-Drop Reordering**: Rearrange pages with live visual feedback.
- **Page Rotation**: Rotate individual pages or all pages 90° CW / 90° CCW / 180°.
- **Page Deletion & Duplication**: Remove unwanted pages or duplicate key pages.
- **Insert Blank Pages**: Add blank pages anywhere in the sequence.
- **Combine & Split**: Merge multiple PDFs or extract selected page ranges.

### 4. Forms & Electronic Signatures
- **Signature Creation Studio**:
  - **Draw**: Natural ink drawing via mouse, stylus, or touchscreen.
  - **Type**: Generate elegant cursive signatures using stylized handwriting fonts.
  - **Upload**: Import existing signature images (transparent PNG).
- **Interactive Stamp & Position**: Drag and scale the signature onto any page or form line.
- **Form Flattening**: Lock interactive fields into permanent, tamper-resistant printable documents.

### 5. Document Security & Watermarking
- **Custom Watermarks**: Diagonal or horizontal text with adjustable opacity, font size, and color.
- **Header & Footer Numbering**: Automatic "Page X of Y" numbering across all pages.
- **Permanent Redaction**: Blackout rectangular tool to scrub sensitive details.
- **Password Protection**: Encrypt document to prevent unauthorized opening or printing.

### 6. Export Utilities
- **High-Resolution Page Image Export**: Convert any page into a sharp PNG image.
- **Clean Text Extraction**: Extract clean full text to `.txt` files.
- **Native Print Integration**: High-fidelity margins and color matching.

---

## 🚀 Running Locally on Windows (Zero-RAM Mode)

Because your laptop's storage and RAM are limited, **you do not need to install heavy compilers, Android Studio, or gigabytes of node_modules locally.**

To test and run the full application on Windows using **< 30 MB of RAM**:

1. Double-click:
   ```cmd
   run_windows.bat
   ```
   *Or run via command line:*
   ```cmd
   python serve.py
   ```
2. The application will launch in a clean, native desktop window with full functionality.

---

## 🛠️ Building Applications via GitHub Actions

All heavy compilation and packaging is handled in the cloud by **GitHub Actions** (16 GB RAM cloud runners).

### Target 1: Windows Application (`.exe`)
- Workflow: `.github/workflows/build-windows.yml`
- Output: Standalone portable executable and NSIS installer (`.exe`)
- Download from: GitHub Actions **Artifacts** tab on your repository.

### Target 2: Arch Linux Application (`.AppImage`)
- Workflow: `.github/workflows/build-linux.yml`
- Output: `.AppImage` (runs directly on Arch Linux, Manjaro, EndeavourOS, Fedora, Ubuntu)
- To run on Arch Linux:
  ```bash
  chmod +x Personal-PDF-Suite-*.AppImage
  ./Personal-PDF-Suite-*.AppImage
  ```

### Target 3: Android Application (`.apk`)
- Workflow: `.github/workflows/build-android.yml`
- Output: Installable `.apk` file
- Download directly to your phone/tablet and install with one tap.

---

## 📦 Using GitHub Desktop to Commit & Push

1. Open **GitHub Desktop**.
2. Click **File** > **Add Local Repository...**
3. Select this folder:
   `c:\Users\Naveen\Videos\personal-pdf-application`
4. If prompted to publish to GitHub:
   - Click **Publish repository**.
   - Choose whether you want it private or public.
5. Every time you make changes:
   - Enter a commit summary in GitHub Desktop.
   - Click **Commit to main**.
   - Click **Push origin**.
6. Navigate to your repository on GitHub and click the **Actions** tab to download your freshly compiled **Windows `.exe`**, **Linux `.AppImage`**, or **Android `.apk`**!

---

## 📂 Project Architecture

```
personal-pdf-application/
├── .github/workflows/
│   ├── build-windows.yml       # Cloud builder for Windows (.exe)
│   ├── build-linux.yml         # Cloud builder for Arch Linux (.AppImage)
│   └── build-android.yml       # Cloud builder for Android APK (.apk)
├── src/
│   ├── index.html              # Adobe Acrobat ribbon & workspace
│   ├── css/
│   │   ├── main.css            # Acrobat dark/light themes, buttons, modals
│   │   ├── viewer.css          # Continuous canvas rendering & text layer
│   │   ├── annotations.css     # Inking, sticky notes, shapes, stamps
│   │   └── organizer.css       # Drag-and-drop page grid
│   ├── js/
│   │   ├── app.js              # Central orchestrator & shortcuts
│   │   ├── pdf-viewer.js       # Mozilla PDF.js engine & search
│   │   ├── pdf-organizer.js    # pdf-lib page mutation & reordering
│   │   ├── pdf-annotator.js    # Inking, drawing, notes, shapes
│   │   ├── pdf-signature.js    # Signature pad (draw, type, stamp)
│   │   ├── pdf-security.js     # Watermark, numbers, redaction
│   │   ├── pdf-export.js       # PNG export, text extraction, print
│   │   └── ui.js               # Dynamic ribbons, sidebars, modals
│   └── assets/
│       └── icons/              # App branding and icons
├── electron/
│   ├── main.js                 # Native Windows/Linux desktop shell
│   └── preload.js              # Secure native bridge
├── capacitor.config.json       # Android APK mobile configuration
├── package.json                # CI/CD dependency manifest
├── serve.py                    # Zero-RAM local server
├── run_windows.bat             # 1-click Windows runner
└── .gitignore                  # Clean repository filters
```

---

## 🔒 Privacy & Offline Operation

This application does not connect to any third-party cloud service or analytics. All document parsing, rendering, signing, and saving occur strictly client-side on your device.
