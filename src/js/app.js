/**
 * Personal PDF Suite - Main Application Controller
 * Professional desktop-grade functionality for Windows, Arch Linux, and Android.
 */

import { PDFViewerEngine, healPdfTextLigatures } from './pdf-viewer.js';
import { PDFOrganizerEngine } from './pdf-organizer.js';
import { PDFAnnotatorEngine } from './pdf-annotator.js';
import { PDFSignatureEngine } from './pdf-signature.js';
import { PDFSecurityEngine } from './pdf-security.js';
import { PDFExportEngine } from './pdf-export.js';
import { ScreenWakeLockManager } from './wake-lock.js';
import { StorageEngine } from './storage.js';
import { UIController } from './ui.js';
import { FileAccessManager, fileNameFromPath } from './file-access.js';

export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

class PersonalPDFApp {
  constructor() {
    this.currentDocName = 'document.pdf';
    this.currentPdfBytes = null;
    // Where the open document lives, so Save can write back to it instead of
    // downloading a second copy. Exactly one of these is set at any time.
    this.currentFilePath = null;      // Tauri desktop: absolute path on disk
    this.currentFileHandle = null;    // Chromium: FileSystemFileHandle
    this.fileAccess = new FileAccessManager();
    this._openPickerInFlight = false;
    this.organizerCards = [];
    // Pristine page-canvas snapshots (keyed by page number) so paragraph
    // reflow can be recomputed after every keystroke without compounding
    // earlier shifts.
    this._pageSnapshots = new Map();
    this._reflowFrame = 0;
    this._lastReflowedMaxPage = 1;
    this.wakeLock = new ScreenWakeLockManager();
    this.storage = new StorageEngine();

    this._initEngines();
    this._bindCoreEvents();
    this._bindOrganizerEvents();
    this._bindWatermarkEvents();
    this._bindProtectEvents();
    this._setupElectronBridge();
    this._setupTauriFileDrop();
    this._initBackButton();
    this._initAppStatePersistence();
    this._restoreSession();

    // Check if running in native desktop shell
    if (window.__TAURI__) {
      console.log('Running in native Tauri v2 desktop shell.');
    }
  }

  _initEngines() {
    const viewerContainer = document.getElementById('viewer-container');
    const pdfViewer = document.getElementById('pdf-viewer');
    const thumbnailsContainer = document.getElementById('thumbnails-container');
    const outlineContainer = document.getElementById('outline-container');

    // 1. Viewer Engine
    this.viewer = new PDFViewerEngine({
      container: viewerContainer,
      pagesContainer: pdfViewer,
      thumbnailsContainer: thumbnailsContainer,
      outlineContainer: outlineContainer,
      onPageChange: (current, total) => this._onPageChange(current, total),
      onDocumentLoaded: (meta) => this._onDocumentLoaded(meta),
      onContentEdited: (editData) => this._handleDirectContentEdit(editData),
      onPageRendered: (pageNum, textLayer, pageWrapper) => {
        // A fresh render invalidates any captured canvas; recapture before
        // restoring edits so reflow (if any) starts from pristine pixels.
        this._pageSnapshots.delete(pageNum);
        if (this.annotator?.inPlaceEdits?.size) {
          this._capturePageSnapshot(pageNum, pageWrapper);
        }
        this._restoreInPlaceEdits(pageNum, textLayer, pageWrapper);
        // Canvas ink is cleared whenever the annotation layer is rebuilt on
        // zoom/rotate, so repaint it from the persistent annotation store.
        if (this.annotator) this.annotator._redrawPageAnnotations(pageNum);
        if (this.annotator?.inPlaceEdits?.size) {
          this._scheduleReflow(1);
        }
      }
    });

    // 2. Organizer Engine
    this.organizer = new PDFOrganizerEngine();

    // 3. Annotator Engine
    this.annotator = new PDFAnnotatorEngine({
      container: viewerContainer,
      onActiveTextBoxChange: (box) => {
        if (this.ui) this.ui.syncActiveTextBox(box);
      },
      onActiveStampChange: (stamp) => {
        if (this.ui) this.ui.syncActiveStamp(stamp);
      }
    });

    // 4. Signature Engine
    this.signature = new PDFSignatureEngine({
      onSignatureReady: (dataUrl) => {
        const target = this.getVisibleCenterTarget();
        this.insertSignatureOnPage(target.pageNum, dataUrl, target.x, target.y);
        this.ui.setStatus('Signature placed. Drag into desired position.');
      }
    });

    // 5. Security & Watermark Engine
    this.security = new PDFSecurityEngine();

    // 6. Exporter Engine
    this.exporter = new PDFExportEngine(this.viewer, this);

    // 7. UI Controller
    this.ui = new UIController(this);
  }

  _bindCoreEvents() {
    // File inputs
    const fileInput = document.getElementById('file-input');
    const btnOpenFile = document.getElementById('btn-open-file');
    const btnWelcomeOpen = document.getElementById('btn-welcome-open');
    const btnLoadSample = document.getElementById('btn-load-sample');
    const btnSavePdf = document.getElementById('btn-save-pdf');
    const btnSaveAsPdf = document.getElementById('btn-save-as-pdf');
    const btnPrint = document.getElementById('btn-print');

    btnOpenFile.onclick = () => this.openDocumentPicker();
    btnWelcomeOpen.onclick = () => this.openDocumentPicker();

    // Tab close
    const btnTabClose = document.getElementById('btn-tab-close');
    if (btnTabClose) {
      btnTabClose.onclick = async (e) => {
        e.stopPropagation();
        this.currentPdfBytes = null;
        this._setSaveTarget(null);
        this.viewer.pdfDoc = null;
        if (this.storage) await this.storage.clearActiveDocument();
        if (this.wakeLock) this.wakeLock.release();
        const pdfViewer = document.getElementById('pdf-viewer');
        if (pdfViewer) {
          pdfViewer.innerHTML = '';
          pdfViewer.style.display = 'none';
        }
        document.getElementById('thumbnails-container').innerHTML = '';
        document.getElementById('outline-container').innerHTML = '';
        const welcomeScreen = document.getElementById('welcome-screen');
        if (welcomeScreen) welcomeScreen.style.display = 'flex';
        document.getElementById('current-doc-name').textContent = 'No document open';
        document.getElementById('page-count').textContent = '0';
        document.getElementById('page-num-input').value = '1';
        this.ui.setStatus('Document closed');
      };
    }

    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (file) this.loadFile(file);
      // Allow picking the same file again (e.g. after it changed on disk).
      e.target.value = '';
    };

    btnLoadSample.onclick = () => this.loadSamplePDF();
    btnSavePdf.onclick = () => this.saveDocument();
    if (btnSaveAsPdf) btnSaveAsPdf.onclick = () => this.saveAsDocument();
    btnPrint.onclick = () => this.exporter.printDocument();

    // Universal print lifecycle hooks (handles Ctrl+P, browser print menu, and button print)
    window.addEventListener('beforeprint', () => {
      if (this.exporter && typeof this.exporter.preparePrintContainer === 'function') {
        this.exporter.preparePrintContainer();
      }
    });
    window.addEventListener('afterprint', () => {
      if (this.exporter && typeof this.exporter.cleanupPrintContainer === 'function') {
        this.exporter.cleanupPrintContainer();
      }
    });

    // Deselect annotations, stamps, images, signatures, and whiteouts when clicking outside
    document.addEventListener('pointerdown', (e) => {
      if (e.target.closest('#dynamic-mode-tools, .annotation-textbox, .textbox-drag-bar, .textbox-content, .sticky-note-container, .sticky-note-marker, .sticky-note-popup, .btn-delete-note, .placed-stamp, .placed-image-box, .placed-signature-box, .whiteout-box, .element-floating-bar, .element-resize-handle, .element-rotate-handle, .element-rotate-line, .textbox-delete-btn')) {
        return;
      }
      if (this.annotator && typeof this.annotator._deselectAllElements === 'function') {
        this.annotator._deselectAllElements();
      }
    });

    // Drag and drop PDF files onto the window
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
          this.loadFile(file);
        }
      }
    });

    // Undo / Redo
    const btnUndo = document.getElementById('btn-undo');
    const btnRedo = document.getElementById('btn-redo');

    if (btnUndo) {
      btnUndo.onclick = () => {
        const ok = this.annotator.undo();
        this.ui.setStatus(ok ? 'Undo action' : 'Nothing to undo');
      };
    }

    if (btnRedo) {
      btnRedo.onclick = () => {
        const ok = this.annotator.redo();
        this.ui.setStatus(ok ? 'Redo action' : 'Nothing to redo');
      };
    }

    // Page navigation
    document.getElementById('btn-prev-page').onclick = () => {
      this.viewer.goToPage(this.viewer.currentPage - 1);
    };
    document.getElementById('btn-next-page').onclick = () => {
      this.viewer.goToPage(this.viewer.currentPage + 1);
    };
    document.getElementById('page-num-input').onchange = (e) => {
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val)) this.viewer.goToPage(val);
    };

    // Zooming
    document.getElementById('btn-zoom-in').onclick = () => {
      this.viewer.setZoom('custom', this.viewer.scale * 1.25);
      this.ui.setZoomStatus(`${Math.round(this.viewer.scale * 100)}%`);
    };
    document.getElementById('btn-zoom-out').onclick = () => {
      this.viewer.setZoom('custom', this.viewer.scale * 0.8);
      this.ui.setZoomStatus(`${Math.round(this.viewer.scale * 100)}%`);
    };
    document.getElementById('zoom-select').onchange = (e) => {
      const mode = e.target.value;
      if (mode === 'auto' || mode === 'page-fit' || mode === 'page-width') {
        this.viewer.setZoom(mode);
      } else {
        this.viewer.setZoom('custom', parseFloat(mode));
      }
      this.ui.setZoomStatus(`${Math.round(this.viewer.scale * 100)}%`);
    };

    // Rotate 90 CW
    document.getElementById('btn-rotate-cw').onclick = () => {
      this.viewer.rotateClockwise();
    };

    // Sidebar Toggle
    const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
    const sidebar = document.getElementById('sidebar');
    if (btnToggleSidebar && sidebar) {
      btnToggleSidebar.onclick = () => {
        sidebar.classList.toggle('collapsed');
        btnToggleSidebar.classList.toggle('active');
        this.ui.setStatus(sidebar.classList.contains('collapsed') ? 'Sidebar hidden' : 'Sidebar visible');
      };
    }

    // Document Properties
    const btnDocProps = document.getElementById('btn-doc-props');
    if (btnDocProps) {
      btnDocProps.onclick = async () => {
        if (!this.currentPdfBytes) {
          alert('Please open a PDF document first.');
          return;
        }
        const meta = await this.security.getMetadata(this.currentPdfBytes);
        document.getElementById('meta-title').value = meta.title;
        document.getElementById('meta-author').value = meta.author;
        document.getElementById('meta-subject').value = meta.subject;
        document.getElementById('meta-keywords').value = meta.keywords;
        document.getElementById('modal-props').classList.add('open');
      };
    }

    const btnApplyProps = document.getElementById('btn-apply-props');
    if (btnApplyProps) {
      btnApplyProps.onclick = async () => {
        if (!this.currentPdfBytes) return;
        const meta = {
          title: document.getElementById('meta-title').value,
          author: document.getElementById('meta-author').value,
          subject: document.getElementById('meta-subject').value,
          keywords: document.getElementById('meta-keywords').value
        };
        this.currentPdfBytes = await this.security.updateMetadata(this.currentPdfBytes, meta);
        document.getElementById('modal-props').classList.remove('open');
        this.ui.setStatus('Document properties updated successfully');
      };
    }

    // Merge Files
    const mergeInput = document.getElementById('merge-files-input');
    const btnTriggerMerge = document.getElementById('btn-trigger-merge-file-picker');
    this.mergeItems = [];

    if (btnTriggerMerge && mergeInput) {
      btnTriggerMerge.onclick = () => mergeInput.click();
    }

    if (mergeInput) {
      mergeInput.onchange = async (e) => {
        for (const file of e.target.files) {
          const buf = await file.arrayBuffer();
          this.mergeItems.push({
            name: file.name,
            bytes: buf,
            size: file.size,
            isCurrent: false
          });
        }
        this._renderMergeList();
        mergeInput.value = '';
      };
    }

    const btnApplyMerge = document.getElementById('btn-apply-merge');
    if (btnApplyMerge) {
      btnApplyMerge.onclick = async () => {
        if (!this.mergeItems || this.mergeItems.length < 2) {
          alert(this.mergeItems && this.mergeItems.length === 1
            ? 'Please add at least 1 more PDF to combine with the current document (minimum 2 PDFs required).'
            : 'Please select at least 2 PDF files to combine.');
          return;
        }
        try {
          this.ui.setStatus(`Combining ${this.mergeItems.length} documents...`);
          const buffers = this.mergeItems.map(item => item.bytes);
          const mergedBytes = await this.organizer.mergeDocuments(buffers);
          await this.loadArrayBuffer(mergedBytes, 'Merged_Document.pdf');
          document.getElementById('modal-merge').classList.remove('open');
          this.ui.setStatus(`Successfully merged ${this.mergeItems.length} PDF documents`);
        } catch (err) {
          console.error('Merge error:', err);
          alert('Could not merge documents: ' + err.message);
          this.ui.setStatus('Merge failed: ' + err.message);
        }
      };
    }

    // Split Files
    const btnApplySplit = document.getElementById('btn-apply-split');
    if (btnApplySplit) {
      btnApplySplit.onclick = async () => {
        if (!this.currentPdfBytes) return;
        const rangeStr = document.getElementById('split-ranges-input').value.trim();
        if (!rangeStr) {
          alert('Please enter page ranges, e.g. 1-2, 3-5');
          return;
        }
        this.ui.setStatus('Splitting document...');
        try {
          const baseName = (this.currentDocName || 'document').replace(/\.pdf$/i, '');
          const basePdfBytes = await this._compositeDocumentAnnotations(this.currentPdfBytes);
          const parts = await this.organizer.splitByRanges(basePdfBytes, rangeStr, baseName);
          document.getElementById('modal-split').classList.remove('open');

          const filesToDownload = parts.map(p => ({
            data: p.bytes,
            fileName: p.name,
            mimeType: 'application/pdf'
          }));

          const res = await this.exporter.downloadFiles(filesToDownload);
          const dest = res?.destination || 'Documents folder & Android Save Sheet';

          this.ui.showExportResultModal({
            title: 'Split PDF Complete',
            message: `Document successfully split into ${parts.length} files.`,
            destination: dest,
            files: res?.files || parts.map(p => ({ name: p.name, size: p.bytes.length }))
          });
          this.ui.showToast(`Split complete: ${parts.length} files generated`, 'success');
          this.ui.setStatus(`Document split into ${parts.length} files`);
        } catch (err) {
          console.error('Split PDF failed:', err);
          this.ui.showToast(`Split PDF failed: ${err.message}`, 'error');
          this.ui.setStatus('Split PDF failed');
        }
      };
    }

    // Bates / Header & Footer
    const btnApplyBates = document.getElementById('btn-apply-bates');
    if (btnApplyBates) {
      btnApplyBates.onclick = async () => {
        if (!this.currentPdfBytes) {
          alert('Please open a PDF document first.');
          return;
        }
        try {
          const prefix = document.getElementById('bates-prefix').value.trim();
          const startNumber = parseInt(document.getElementById('bates-start').value, 10) || 1;
          const format = document.getElementById('bates-format').value;
          const position = document.getElementById('bates-position').value;

          this.ui.setStatus('Applying header/footer page numbers...');
          const basePdfBytes = await this._compositeDocumentAnnotations(this.currentPdfBytes);
          const updated = await this.security.addPageNumbers(basePdfBytes, {
            prefix,
            startNumber,
            format,
            position
          });
          await this.loadArrayBuffer(updated, this.currentDocName);
          document.getElementById('modal-bates').classList.remove('open');
          this.ui.setStatus('Header/Footer numbering applied');
        } catch (err) {
          console.error('Failed to apply page numbers:', err);
          alert('Could not apply page numbers: ' + err.message);
          this.ui.setStatus('Numbering error: ' + err.message);
        }
      };
    }

    // Full-Text Search
    const searchInput = document.getElementById('search-input');
    const searchCount = document.getElementById('search-count');
    const btnSearchPrev = document.getElementById('btn-search-prev');
    const btnSearchNext = document.getElementById('btn-search-next');

    let searchTimeout = null;
    searchInput.oninput = () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(async () => {
        const query = searchInput.value.trim();
        const res = await this.viewer.searchText(query);
        searchCount.textContent = `${res.current}/${res.total}`;
      }, 250);
    };

    const blurSearchInput = () => {
      searchInput.value = '';
      this.viewer.clearSearch();
      searchCount.textContent = '0/0';
      searchInput.blur();
      setTimeout(() => {
        searchInput.blur();
        if (document.activeElement) document.activeElement.blur();
        const container = document.getElementById('viewer-container');
        if (container) container.focus();
        document.body.focus();
      }, 0);
    };

    searchInput.onkeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        blurSearchInput();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          btnSearchPrev.click();
        } else {
          btnSearchNext.click();
        }
      }
    };

    searchInput.onkeyup = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        blurSearchInput();
      }
    };

    btnSearchNext.onclick = () => {
      const res = this.viewer.nextSearchResult();
      if (res) searchCount.textContent = `${res.current}/${res.total}`;
    };

    btnSearchPrev.onclick = () => {
      const res = this.viewer.prevSearchResult();
      if (res) searchCount.textContent = `${res.current}/${res.total}`;
    };

    // Global Keyboard Shortcuts (Desktop suite compatible)
    window.addEventListener('keydown', (e) => {
      if (
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.isContentEditable ||
        e.target.closest('[contenteditable="true"], .annotation-textbox, .textbox-content')
      ) {
        // Allow text editing, arrow key navigation, Backspace, Delete to stay inside the text editor
        return;
      }

      // If active sticky note, text box, stamp, or selected element is active, Delete or Backspace key deletes it
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.annotator?.activeStickyNote) {
          e.preventDefault();
          this.annotator.deleteActiveStickyNote();
          if (this.ui) this.ui.setStatus('Sticky note removed');
          return;
        }
        if (this.annotator?.activeTextBox) {
          e.preventDefault();
          this.annotator.deleteActiveTextBox();
          if (this.ui) this.ui.setStatus('Text box removed');
          return;
        }
        if (this.annotator?.activeStamp) {
          e.preventDefault();
          this.annotator.deleteActiveStamp();
          if (this.ui) this.ui.setStatus('Stamp removed');
          return;
        }
        const selEl = document.querySelector('.element-selected');
        if (selEl) {
          e.preventDefault();
          this.annotator?.deleteElement(selEl);
          if (this.ui) this.ui.setStatus('Element removed');
          return;
        }
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'o' || e.key === 'O') {
          e.preventDefault();
          this.openDocumentPicker();
        } else if (e.key === 'z' || e.key === 'Z') {
          e.preventDefault();
          if (e.shiftKey) {
            this.annotator.redo();
          } else {
            this.annotator.undo();
          }
        } else if (e.key === 'y' || e.key === 'Y') {
          e.preventDefault();
          this.annotator.redo();
        } else if (e.key === 's' || e.key === 'S') {
          e.preventDefault();
          if (e.shiftKey) {
            this.saveAsDocument();
          } else {
            this.saveDocument();
          }
        } else if (e.key === 'p' || e.key === 'P') {
          e.preventDefault();
          this.exporter.printDocument();
        } else if (e.key === 'f' || e.key === 'F') {
          e.preventDefault();
          searchInput.focus();
        } else if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          this.viewer.setZoom('custom', this.viewer.scale * 1.25);
        } else if (e.key === '-') {
          e.preventDefault();
          this.viewer.setZoom('custom', this.viewer.scale * 0.8);
        }
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        this.viewer.goToPage(this.viewer.currentPage + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        this.viewer.goToPage(this.viewer.currentPage - 1);
      }
    });
  }

  _handleDirectContentEdit(editData) {
    const span = editData.span;
    if (!span) return;
    const pageNum = editData.pageNum;
    const pageWrapper = editData.pageWrapper || document.getElementById(`page-wrapper-${pageNum}`);

    // Snapshot the pristine page before any pixel of it is shifted for reflow.
    if (pageWrapper) this._capturePageSnapshot(pageNum, pageWrapper);

    // If already editing this span, re-focus
    if (span.classList.contains('inline-editing')) {
      span.focus();
      return;
    }

    // Save initial text once
    if (span._originalText === undefined) {
      span._originalInlineStyle = span.getAttribute('style') || '';
      const initialStyle = window.getComputedStyle(span);
      const initialFontPx = parseFloat(initialStyle.fontSize) || 16;
      const initialLinePx = parseFloat(initialStyle.lineHeight) || initialFontPx * 1.2;
      span._lineHeightRatio = Math.max(0.9, Math.min(2.5, initialLinePx / initialFontPx));
      const initialColor = initialStyle.color || '';
      span._originalColor = (!initialColor || initialColor === 'transparent' || initialColor === 'rgba(0, 0, 0, 0)')
        ? '#111827'
        : initialColor;

      if (typeof healPdfTextLigatures === 'function') {
        span.textContent = healPdfTextLigatures(span.textContent);
      }
      span._originalText = span.textContent;
      // Use layout (offset) metrics rather than transformed bounding boxes so
      // a re-edited paragraph keeps its pristine position after reflow.
      const wW = pageWrapper.clientWidth || 1;
      const wH = pageWrapper.clientHeight || 1;
      span._normRect = {
        x: Math.max(0, span.offsetLeft / wW),
        y: Math.max(0, span.offsetTop / wH),
        w: Math.min(1, Math.max(0.005, span.offsetWidth / wW)),
        h: Math.min(1, Math.max(0.005, span.offsetHeight / wH))
      };
      span._originalWidth = span.offsetWidth;
      span._originalHeight = span.offsetHeight;

      // Edit the whole paragraph (all runs/lines of the same text block), not
      // just the clicked fragment. Otherwise the rest of the line stays put
      // and the new text is drawn on top of it.
      this._prepareParagraphEdit(span, pageNum, pageWrapper);
    }

    // Resolve native PDF font family and size with cross-platform fallback stack
    const compStyle = window.getComputedStyle(span);
    const existingFont = (span.style.fontFamily || compStyle.fontFamily || '').toLowerCase();
    
    // Check tagged PDF font directly from textLayer span if available
    const directFont = span._pdfFontName || '';
    const isDirectCalibri = /calibri/i.test(directFont);
    const isDirectArial = /arial|helvetica/i.test(directFont);
    const isDirectTimes = /times|cambria|serif/i.test(directFont) && !/sans/i.test(directFont);
    const isDirectMono = /mono|consolas|courier/i.test(directFont);

    // 1. Precise font classification: Avoid false positive where "sans-serif" matched /serif/
    const isSansSerif = isDirectCalibri || isDirectArial || /sans-serif|calibri|arial|helvetica|segoe|roboto|tahoma|verdana|carlito/i.test(existingFont) ||
                        (!/times|georgia|cambria|garamond|serif/i.test(existingFont) && !/mono|courier|consolas/i.test(existingFont));
    const isMonospace = !isSansSerif && (isDirectMono || /mono|courier|consolas|code/i.test(existingFont));
    const isSerif = !isSansSerif && !isMonospace && (isDirectTimes || /(?<!sans-)serif|times|georgia|cambria|garamond/i.test(existingFont));

    const docFonts = Array.from(this.viewer.documentFonts || []);
    const specificDirect = (directFont && !/sans-serif|serif|monospace/i.test(directFont)) ? directFont : null;
    const matchingDocFont = specificDirect || docFonts.find(f => {
      const fl = f.toLowerCase();
      if (isMonospace || isDirectMono) return fl.includes('consolas') || fl.includes('courier') || fl.includes('mono');
      if (isSerif || isDirectTimes) return fl.includes('times') || fl.includes('cambria') || (fl.includes('serif') && !fl.includes('sans'));
      return fl.includes('calibri') || fl.includes('arial') || fl.includes('helvetica') || fl.includes('sans');
    }) || directFont || docFonts[0];

    let fontStack = '';
    if (isMonospace || isDirectMono) {
      fontStack = `'Consolas', 'Cousine', 'Roboto Mono', 'Courier New', 'Liberation Mono', monospace`;
    } else if (isSerif || isDirectTimes) {
      fontStack = `'Cambria', 'Times New Roman', 'Noto Serif', 'Tinos', 'Liberation Serif', Georgia, serif`;
    } else if (isDirectCalibri || (matchingDocFont && /calibri/i.test(matchingDocFont))) {
      fontStack = `'Calibri', 'Carlito', 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`;
    } else if (isDirectArial || (matchingDocFont && /arial|helvetica/i.test(matchingDocFont))) {
      fontStack = `Arial, 'Arimo', 'Roboto', 'Helvetica Neue', Helvetica, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
    } else if (matchingDocFont && !/sans-serif|serif|monospace/i.test(matchingDocFont)) {
      fontStack = `'${matchingDocFont}', 'Calibri', 'Carlito', 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`;
    } else {
      fontStack = `'Calibri', 'Carlito', 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`;
    }

    span.style.fontFamily = fontStack;
    span._customFontStack = fontStack;

    // Preserve font weight and style
    const fontWeight = compStyle.fontWeight || 'normal';
    const isBold = span._pdfIsBold || parseInt(fontWeight, 10) >= 600 || /bold/i.test(fontWeight);
    span.style.fontWeight = isBold ? '700' : '400';
    span._customFontWeight = isBold ? '700' : '400';

    const isItalic = span._pdfIsItalic || compStyle.fontStyle === 'italic' || /italic|oblique/i.test(compStyle.fontStyle);
    span.style.fontStyle = isItalic ? 'italic' : 'normal';
    span._customFontStyle = isItalic ? 'italic' : 'normal';

    // Extract exact unscaled CSS pixel base size from PDF stream or style
    let baseFontSize = span._pdfPtFontSize || 0;
    if (!baseFontSize) {
      const fsMatch = (span.style.fontSize || '').match(/([\d\.]+)\s*px/);
      if (fsMatch) {
        baseFontSize = parseFloat(fsMatch[1]);
      } else {
        const compFs = parseFloat(compStyle.fontSize) || 16;
        const scaleFactor = (this.viewer && this.viewer.scale) || 1;
        baseFontSize = compFs / scaleFactor;
      }
    }
    span._baseFontSize = baseFontSize;
    span.style.fontSize = `calc(var(--scale-factor, 1) * ${baseFontSize.toFixed(2)}px)`;
    span.style.lineHeight = String(span._lineHeightRatio || 1.2);
    span.style.webkitTextSizeAdjust = 'none';
    span.style.textSizeAdjust = 'none';
    span.style.maxHeight = '999999px';

    // Reset artificial PDF.js transform and spacing so typography flows naturally
    span.style.transform = 'none';
    span.style.letterSpacing = 'normal';

    // Wrap within the available line width without overflowing the page margin
    let minNextLeft = Infinity;
    const siblingSpans = pageWrapper.querySelectorAll('.textLayer span');
    for (const sibling of siblingSpans) {
      if (sibling !== span && Math.abs(sibling.offsetTop - span.offsetTop) < 6 && sibling.offsetLeft > span.offsetLeft) {
        if (sibling.offsetLeft < minNextLeft) {
          minNextLeft = sibling.offsetLeft;
        }
      }
    }

    let calculatedMaxW;
    if (span._paragraphMerge) {
      // Paragraph edits use the full original paragraph width so the merged
      // text re-wraps naturally instead of into the clicked fragment's slot.
      calculatedMaxW = span._paragraphMerge.widthPx;
    } else if (minNextLeft !== Infinity) {
      calculatedMaxW = Math.max(span._originalWidth || 40, minNextLeft - span.offsetLeft - 4);
    } else {
      // No same-line sibling: wrap within the original line width so typed text
      // grows into a paragraph without changing the font size or crossing into
      // an adjacent column.
      calculatedMaxW = Math.max(span._originalWidth || 40, 40);
    }

    const maxW = Math.max(40, Math.floor(calculatedMaxW));
    span.style.maxWidth = `${maxW}px`;
    span.style.whiteSpace = 'pre-wrap';
    span.style.overflowWrap = 'break-word';
    span.style.wordBreak = 'normal';
    span.style.overflow = 'visible';
    span.style.height = 'auto';

    // Set as active in-place span in annotator engine
    this.annotator.setActiveInPlaceSpan(span);

    // Make native PDF span directly editable in-place
    span.contentEditable = 'true';
    span.spellcheck = false;
    span.classList.add('inline-editing');
    span.style.cursor = 'text';

    const textLayer = span.closest('.textLayer');
    if (textLayer) textLayer.classList.add('has-modifications');

    span._pageNum = pageNum;
    span._pageWrapper = pageWrapper;

    // Keep the PDF's original typography while editing. Text wraps and the box
    // grows downward; the font size is never shrunk to squeeze text into one line.
    const cleanSpanContent = () => {
      if (span._isComposing) return;
      span.style.fontFamily = fontStack;
      span.style.fontWeight = span._customFontWeight || 'normal';
      span.style.fontStyle = span._customFontStyle || 'normal';
      span.style.fontSize = `calc(var(--scale-factor, 1) * ${baseFontSize.toFixed(2)}px)`;
      span.style.lineHeight = String(span._lineHeightRatio || 1.2);
      span.style.letterSpacing = 'normal';
      span.style.webkitTextSizeAdjust = 'none';
      span.style.textSizeAdjust = 'none';
      span.style.maxHeight = '999999px';
      span.style.transform = 'none';
      span._reflowBaseTransform = 'none';
      span.style.maxWidth = `${Math.floor(maxW)}px`;
      span.style.whiteSpace = 'pre-wrap';
      span.style.overflowWrap = 'break-word';
      span.style.wordBreak = 'normal';
      span.style.overflow = 'visible';
      span.style.height = 'auto';
      span.style.color = span._originalColor || '#111827';
      span.style.backgroundColor = '#ffffff';
      if (span._paragraphMerge) {
        const pm = span._paragraphMerge;
        const wrapW = pageWrapper.clientWidth || 1;
        const wrapH = pageWrapper.clientHeight || 1;
        span.style.left = `${(pm.rect.x * wrapW).toFixed(2)}px`;
        span.style.top = `${(pm.rect.y * wrapH).toFixed(2)}px`;
        span.style.width = `${Math.floor(pm.widthPx)}px`;
        span.style.maxWidth = `${Math.floor(pm.widthPx)}px`;
      }
    };

    // Execute immediately on edit start
    cleanSpanContent();
    this._reflowEditedPage(pageNum, pageWrapper);

    // Sync toolbar font, size, bold, italic, color to match native PDF styling
    if (this.ui) {
      this.ui.syncInPlaceSpan(span);
    }

    // Attach listeners on this span if not yet attached
    if (!span._hasDirectEditListeners) {
      span._hasDirectEditListeners = true;

      // Track IME / soft keyboard composition (Gboard on Android) to prevent character corruption
      span._isComposing = false;
      span.addEventListener('compositionstart', () => {
        span._isComposing = true;
      });
      span.addEventListener('compositionend', () => {
        span._isComposing = false;
        cleanSpanContent();
        this.annotator.recordInPlaceEdit(span, pageNum, pageWrapper);
        this._reflowEditedPage(pageNum, pageWrapper);
      });

      span.addEventListener('input', (e) => {
        if (span._isComposing || (e && e.isComposing)) {
          return; // Allow soft keyboard composition without resetting DOM
        }
        cleanSpanContent();
        this.annotator.recordInPlaceEdit(span, pageNum, pageWrapper);
        this._reflowEditedPage(pageNum, pageWrapper);
      });

      span.addEventListener('paste', (e) => {
        // Keep pasted text plain so PDF typography and line layout stay intact.
        const text = (e.clipboardData || window.clipboardData)?.getData('text/plain');
        if (text === undefined || text === null) return;
        e.preventDefault();
        document.execCommand('insertText', false, text);
      });

      span.addEventListener('keydown', (kEvt) => {
        if (kEvt.key === 'Escape') {
          kEvt.preventDefault();
          this.annotator.revertInPlaceEdit(span, pageNum);
          span.blur();
          this._reflowEditedPage(pageNum, pageWrapper);
          this.ui.setStatus('Reverted in-place text edit');
        }
        // Enter is intentionally left alone: it inserts a paragraph line break and
        // the text box grows instead of shrinking the font or committing the edit.
      });

      span.addEventListener('blur', () => {
        span._isComposing = false;
        cleanSpanContent();
        span.contentEditable = 'false';
        span.classList.remove('inline-editing');
        const tLayer = span.closest('.textLayer');
        const curText = span.innerText || span.textContent || '';
        if (curText !== span._originalText) {
          span.classList.add('in-place-modified');
          if (tLayer) tLayer.classList.add('has-modifications');

          // Keep the same font size; the edited line may wrap into a paragraph.
          span.style.transform = 'none';
          span.style.letterSpacing = 'normal';
          span.style.maxWidth = `${Math.floor(maxW)}px`;
          span.style.whiteSpace = 'pre-wrap';
          span.style.overflowWrap = 'break-word';
          span.style.wordBreak = 'normal';
          span.style.overflow = 'visible';
          span.style.height = 'auto';
          span.style.width = 'auto';
          span.style.minWidth = '0';
          span.style.webkitTextSizeAdjust = 'none';
          span.style.textSizeAdjust = 'none';
          span.style.maxHeight = '999999px';
          span.style.color = span._originalColor || '#111827';
          span.style.backgroundColor = '#ffffff';
          span.style.opacity = '1';
          span.style.visibility = 'visible';

          // Erase the original PDF text underneath the edited block. The block is
          // opaque white, so mask its current (possibly expanded) height too.
          const pageCanvas = pageWrapper.querySelector('canvas.pdf-canvas, canvas[id^="page-canvas-"]');
          if (pageCanvas && span._normRect) {
            const canvasCtx = pageCanvas.getContext('2d');
            canvasCtx.save();
            canvasCtx.setTransform(1, 0, 0, 1, 0, 0); // Pure canvas buffer pixels
            const normX = span._normRect.x;
            const normY = span._normRect.y;
            const normW = Math.max(span._originalWidth || 0, maxW) / (pageWrapper.clientWidth || 1);
            const normH = Math.max(span._originalHeight || 0, span.offsetHeight || 0) / (pageWrapper.clientHeight || 1);
            canvasCtx.fillStyle = '#ffffff';
            canvasCtx.fillRect(
              Math.floor(normX * pageCanvas.width) - 2,
              Math.floor(normY * pageCanvas.height) - 2,
              Math.ceil(normW * pageCanvas.width) + 4,
              Math.ceil(normH * pageCanvas.height) + 4
            );
            canvasCtx.restore();
          }

          this.annotator.recordInPlaceEdit(span, pageNum, pageWrapper);
          this._reflowEditedPage(pageNum, pageWrapper);
          this.ui.setStatus('In-place text edit saved');
        } else {
          span.classList.remove('in-place-modified');
          if (tLayer && !tLayer.querySelector('.in-place-modified, .inline-editing')) {
            tLayer.classList.remove('has-modifications');
          }
          this.annotator.revertInPlaceEdit(span, pageNum);
          this._reflowEditedPage(pageNum, pageWrapper);
        }
      });
    }

    // Focus and position cursor cleanly without selecting all text (avoids solid blue highlight box)
    span.focus();
    try {
      const sel = window.getSelection();
      sel.removeAllRanges();
      let positioned = false;

      if (editData.clientX !== undefined && editData.clientY !== undefined) {
        if (document.caretPositionFromPoint) {
          const pos = document.caretPositionFromPoint(editData.clientX, editData.clientY);
          if (pos && pos.offsetNode) {
            const range = document.createRange();
            range.setStart(pos.offsetNode, pos.offset);
            range.collapse(true);
            sel.addRange(range);
            positioned = true;
          }
        } else if (document.caretRangeFromPoint) {
          const range = document.caretRangeFromPoint(editData.clientX, editData.clientY);
          if (range) {
            range.collapse(true);
            sel.addRange(range);
            positioned = true;
          }
        }
      }

      if (!positioned) {
        const range = document.createRange();
        range.selectNodeContents(span);
        range.collapse(false); // Place cursor at end of text
        sel.addRange(range);
      }
    } catch (_) {}

    this.ui.setStatus(`In-place edit active: editing with PDF's embedded font`);
  }

  /**
   * Group the text layer into visual lines (PDF.js often splits one line into
   * several positioned spans/runs).
   */
  _collectTextLines(pageWrapper) {
    const spans = Array.from(pageWrapper.querySelectorAll('.textLayer span')).filter(span => {
      if (!span.textContent || !span.textContent.trim()) return false;
      if (span._mergeHidden || span._paragraphMerge) return false;
      return true;
    });
    spans.sort((a, b) => (a.offsetTop - b.offsetTop) || (a.offsetLeft - b.offsetLeft));

    // PDF.js stretches each run horizontally with scaleX(), and offsetWidth
    // ignores that transform. Use the visual width so the paragraph box does
    // not run past the page edge.
    const visualRight = (span) => {
      const match = /scaleX\(([-\d.]+)\)/.exec(span.style.transform || '');
      const scaleX = match ? Math.abs(parseFloat(match[1])) : 1;
      return span.offsetLeft + span.offsetWidth * (isNaN(scaleX) ? 1 : scaleX);
    };

    const lines = [];
    for (const span of spans) {
      let line = lines.find(item => Math.abs(item.top - span.offsetTop) <= 4);
      if (!line) {
        line = { top: span.offsetTop, bottom: 0, left: Infinity, right: 0, height: 0, fontSize: 0, spans: [] };
        lines.push(line);
      }
      line.spans.push(span);
      line.top = Math.min(line.top, span.offsetTop);
      line.bottom = Math.max(line.bottom, span.offsetTop + span.offsetHeight);
      line.left = Math.min(line.left, span.offsetLeft);
      line.right = Math.max(line.right, visualRight(span));
      line.height = Math.max(line.height, span.offsetHeight);
      line.fontSize = Math.max(line.fontSize, parseFloat(window.getComputedStyle(span).fontSize) || 0);
    }
    lines.sort((a, b) => a.top - b.top);
    return lines;
  }

  /** Join a paragraph's runs/lines into one re-wrappable string. */
  _buildParagraphText(groups) {
    const joinRuns = (line) => {
      let text = '';
      let prevRight = null;
      const runs = line.spans.slice().sort((a, b) => a.offsetLeft - b.offsetLeft);
      for (const run of runs) {
        const value = run.textContent || '';
        if (!value.trim()) continue;
        if (text && !/\s$/.test(text) && !/^\s/.test(value)) {
          const prevChar = text.slice(-1);
          const nextChar = value[0];
          const wordish = /[A-Za-z0-9,;:)\]]/.test(prevChar) && /[A-Za-z0-9(\[]/.test(nextChar);
          if (wordish || (prevRight !== null && run.offsetLeft > prevRight + 1.2)) {
            text += ' ';
          }
        }
        text += value;
        prevRight = run.offsetLeft + run.offsetWidth;
      }
      return text.trim();
    };

    let paragraph = '';
    for (const line of groups) {
      const text = joinRuns(line);
      if (!text) continue;
      if (paragraph) {
        const joiner = /[-–—]$/.test(paragraph) ? '' : ' ';
        paragraph += joiner + text;
      } else {
        paragraph = text;
      }
    }
    return paragraph;
  }

  /**
   * Turn the clicked text fragment into an editor for its whole paragraph so
   * line fragments and overprints cannot be left behind.
   */
  _prepareParagraphEdit(span, pageNum, pageWrapper) {
    const lines = this._collectTextLines(pageWrapper);
    const clickedIndex = lines.findIndex(line => line.spans.includes(span));
    if (clickedIndex < 0) return;

    const clicked = lines[clickedIndex];
    const baseFont = clicked.fontSize || 0;
    const actualLineHeight = clicked.height || (baseFont ? baseFont * 1.2 : 16);
    const maxIntraLineGap = Math.max(3, actualLineHeight * 0.45);

    // Calculate maximum visual line length on this page for detecting terminal paragraph lines
    const maxLineWidth = lines.reduce((max, l) => Math.max(max, l.right - l.left), 0);

    const isContinuation = (prev, next) => {
      const gap = next.top - prev.bottom;
      
      // If gap exceeds normal line spacing (leading), this is a paragraph break or section gap
      if (gap < -2 || gap > maxIntraLineGap) {
        return false;
      }

      // If prev line ended significantly early, it is the last line of a paragraph
      const prevLineWidth = prev.right - prev.left;
      if (maxLineWidth > 100 && prevLineWidth < maxLineWidth * 0.75 && prevLineWidth < 350) {
        return false;
      }

      // Check horizontal left alignment (must be on the same left margin or column)
      const aligned =
        Math.abs(next.left - clicked.left) <= Math.max(8, actualLineHeight * 0.4) &&
        Math.abs(prev.left - clicked.left) <= Math.max(8, actualLineHeight * 0.4);
      if (!aligned) {
        return false;
      }

      // Font size check: Both lines must match clicked line's font size
      const fontOk = !baseFont ||
        (Math.abs((next.fontSize || 0) - baseFont) <= 0.6 &&
         Math.abs((prev.fontSize || 0) - baseFont) <= 0.6);
      if (!fontOk) {
        return false;
      }

      return true;
    };

    let start = clickedIndex;
    let end = clickedIndex;
    while (start > 0 && isContinuation(lines[start - 1], lines[start])) start -= 1;
    while (end < lines.length - 1 && isContinuation(lines[end], lines[end + 1])) end += 1;

    const groups = lines.slice(start, end + 1);
    const totalSpans = groups.reduce((count, line) => count + line.spans.length, 0);
    if (totalSpans <= 1) return; // Single fragment: keep the light editor.

    const left = Math.min(...groups.map(line => line.left));
    const right = Math.max(...groups.map(line => line.right));
    const top = Math.min(...groups.map(line => line.top));
    const bottom = Math.max(...groups.map(line => line.bottom));
    const wrapW = pageWrapper.clientWidth || 1;
    const wrapH = pageWrapper.clientHeight || 1;
    // Never let the editable block extend past the page's right edge.
    const widthPx = Math.max(40, Math.min(right - left, wrapW - left - 6));

    // Keep the document's real leading: the merged block must use the same
    // baseline-to-baseline distance as the original PDF lines, not the 1.0
    // line-height that PDF.js sets on each individual fragment.
    const steps = [];
    for (let i = 1; i < groups.length; i++) {
      const step = groups[i].top - groups[i - 1].top;
      if (step > 0) steps.push(step);
    }
    if (steps.length && baseFont > 0) {
      steps.sort((a, b) => a - b);
      const medStep = steps[Math.floor(steps.length / 2)];
      span._lineHeightRatio = Math.max(0.9, Math.min(2.5, medStep / baseFont));
    }

    const rect = {
      x: left / wrapW,
      y: top / wrapH,
      w: widthPx / wrapW,
      h: Math.max(0.005, (bottom - top) / wrapH)
    };
    let paragraphText = this._buildParagraphText(groups);
    if (typeof healPdfTextLigatures === 'function') {
      paragraphText = healPdfTextLigatures(paragraphText);
    }

    const hidden = [];
    groups.forEach(line => {
      line.spans.forEach(el => {
        if (el === span) return;
        const entry = {
          el,
          prevVisibility: el.style.visibility,
          prevPointerEvents: el.style.pointerEvents
        };
        el._mergeHidden = true;
        el.style.setProperty('visibility', 'hidden', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
        hidden.push(entry);
      });
    });

    span._matchRect = { ...span._normRect };
    span._normRect = rect;
    span._originalWidth = widthPx;
    span._originalHeight = bottom - top;
    span._paragraphMerge = { rect, widthPx, hidden, paragraphText };
    span.textContent = paragraphText;
    span.style.left = `${left.toFixed(2)}px`;
    span.style.top = `${top.toFixed(2)}px`;
    span.style.width = `${Math.floor(widthPx)}px`;
    span.style.maxWidth = `${Math.floor(widthPx)}px`;
  }

  /**
   * Re-apply a saved paragraph merge after the text layer is rebuilt (zoom,
   * rotate, or document re-render).
   */
  _applyParagraphLayout(span, edit, pageWrapperArg) {
    if (!span || !edit?.paragraphRect) return;
    const pageNum = edit.pageNum || span._pageNum;
    const pageWrapper = pageWrapperArg || document.getElementById(`page-wrapper-${pageNum}`);
    if (!pageWrapper) return;

    const rect = edit.paragraphRect;
    const wrapW = pageWrapper.clientWidth || 1;
    const wrapH = pageWrapper.clientHeight || 1;
    const left = rect.x * wrapW;
    const top = rect.y * wrapH;
    const widthPx = Math.max(40, rect.w * wrapW);
    const bottom = top + rect.h * wrapH;

    const hidden = [];
    pageWrapper.querySelectorAll('.textLayer span').forEach(el => {
      if (el === span || el._mergeHidden) return;
      const elTop = el.offsetTop;
      const elLeft = el.offsetLeft;
      if (elTop < top - 6 || elTop > bottom + 6) return;
      if (elLeft < left - 6 || elLeft > left + widthPx + 6) return;
      const entry = {
        el,
        prevVisibility: el.style.visibility,
        prevPointerEvents: el.style.pointerEvents
      };
      el._mergeHidden = true;
      el.style.setProperty('visibility', 'hidden', 'important');
      el.style.setProperty('pointer-events', 'none', 'important');
      hidden.push(entry);
    });

    span._matchRect = edit.matchRect || span._matchRect || { ...rect };
    span._normRect = rect;
    span._originalWidth = widthPx;
    span._originalHeight = rect.h * wrapH;
    span._paragraphMerge = { rect, widthPx, hidden, paragraphText: edit.newText };
    span.style.left = `${left.toFixed(2)}px`;
    span.style.top = `${top.toFixed(2)}px`;
    span.style.width = `${Math.floor(widthPx)}px`;
    span.style.maxWidth = `${Math.floor(widthPx)}px`;
  }

  _restoreInPlaceEdits(pageNum, textLayer, pageWrapperArg) {
    if (!this.annotator || !this.annotator.inPlaceEdits) return;
    const pageEdits = this.annotator.inPlaceEdits.get(pageNum);
    if (!pageEdits || pageEdits.size === 0) return;

    textLayer.classList.add('has-modifications');
    const pageWrapper = pageWrapperArg || textLayer.closest('.page-wrapper');
    const pageCanvas = pageWrapper ? pageWrapper.querySelector('canvas.pdf-canvas, canvas[id^="page-canvas-"]') : null;

    const spans = Array.from(textLayer.querySelectorAll('span'));
    for (const [origSpan, edit] of Array.from(pageEdits.entries())) {
      let matchedSpan = null;
      const matchRect = edit.matchRect || edit.normRect;

      // 1. First try matching by the clicked fragment's position proximity.
      if (matchRect && pageWrapper) {
        const wrapW = pageWrapper.clientWidth || 1;
        const wrapH = pageWrapper.clientHeight || 1;
        for (const s of spans) {
          const sLeft = s.offsetLeft / wrapW;
          const sTop = s.offsetTop / wrapH;
          const dist = Math.hypot(sLeft - matchRect.x, sTop - matchRect.y);
          if (dist < 0.05 && (s.textContent === edit.originalText || (edit.originalText && s.textContent.includes(edit.originalText)))) {
            matchedSpan = s;
            break;
          }
        }
      }

      // 2. Fallback to text match
      if (!matchedSpan) {
        matchedSpan = spans.find(s => s.textContent === edit.originalText || (edit.originalText && s.textContent.includes(edit.originalText)));
      }

      if (matchedSpan) {
        matchedSpan._originalText = edit.originalText;
        matchedSpan._normRect = edit.normRect || origSpan._normRect || matchedSpan._normRect;
        matchedSpan._baseFontSize = edit.baseFontSize || origSpan._baseFontSize;
        matchedSpan._customFontStack = edit.fontFamily || origSpan._customFontStack;
        matchedSpan._lineHeightRatio = edit.lineHeightRatio || origSpan._lineHeightRatio;
        matchedSpan._originalColor = edit.color || origSpan._originalColor;
        if (edit.originalInlineStyle !== undefined) {
          matchedSpan._originalInlineStyle = edit.originalInlineStyle;
        }

        matchedSpan.textContent = edit.newText;
        matchedSpan.classList.add('in-place-modified');
        matchedSpan.style.webkitTextSizeAdjust = 'none';
        matchedSpan.style.textSizeAdjust = 'none';
        matchedSpan.style.lineHeight = String(edit.lineHeightRatio || matchedSpan._lineHeightRatio || 1.2);
        matchedSpan.style.transform = 'none';
        matchedSpan._reflowBaseTransform = 'none';
        matchedSpan.style.letterSpacing = 'normal';
        matchedSpan.style.whiteSpace = 'pre-wrap';
        matchedSpan.style.overflowWrap = 'break-word';
        matchedSpan.style.wordBreak = 'normal';
        matchedSpan.style.overflow = 'visible';
        matchedSpan.style.height = 'auto';
        matchedSpan.style.width = 'auto';
        matchedSpan.style.minWidth = '0';
        matchedSpan.style.color = edit.color || matchedSpan._originalColor || '#111827';
        matchedSpan.style.backgroundColor = '#ffffff';
        matchedSpan.style.opacity = '1';
        matchedSpan.style.visibility = 'visible';

        if (matchedSpan._customFontStack) {
          matchedSpan.style.fontFamily = matchedSpan._customFontStack;
        }
        if (matchedSpan._baseFontSize) {
          matchedSpan.style.fontSize = `calc(var(--scale-factor, 1) * ${matchedSpan._baseFontSize.toFixed(2)}px)`;
        }
        const restoredMaxW = edit.maxWidth || Math.max(80, (pageWrapper?.clientWidth || 800) - matchedSpan.offsetLeft - 48);
        matchedSpan.style.maxWidth = `${restoredMaxW}px`;

        // Restore the whole-paragraph editor block (merged runs hidden, full
        // paragraph width) before measuring, so reflow sees the same layout.
        if (edit.paragraphRect) {
          this._applyParagraphLayout(matchedSpan, edit, pageWrapper);
        }

        const normRect = matchedSpan._normRect;
        if (pageCanvas && pageWrapper && normRect) {
          const canvasCtx = pageCanvas.getContext('2d');
          canvasCtx.save();
          canvasCtx.setTransform(1, 0, 0, 1, 0, 0); // Pure canvas buffer pixels
          const normX = normRect.x;
          const normY = normRect.y;
          const normW = Math.max(normRect.w, restoredMaxW / (pageWrapper.clientWidth || 1));
          const normH = Math.max(normRect.h, (matchedSpan.offsetHeight || 0) / (pageWrapper.clientHeight || 1));
          canvasCtx.fillStyle = '#ffffff';
          canvasCtx.fillRect(
            Math.floor(normX * pageCanvas.width) - 2,
            Math.floor(normY * pageCanvas.height) - 2,
            Math.ceil(normW * pageCanvas.width) + 4,
            Math.ceil(normH * pageCanvas.height) + 4
          );
          canvasCtx.restore();
        }

        pageEdits.delete(origSpan);
        pageEdits.set(matchedSpan, edit);
      }
    }

    // Re-apply canvas reflow after the text layer has been rebuilt.
    this._reflowEditedPage(pageNum, pageWrapper);
  }

  /**
   * Keep a pristine copy of the rendered page so paragraph reflow can always
   * be recomputed from the original pixels instead of stacking shifts.
   */
  _capturePageSnapshot(pageNum, pageWrapper) {
    const wrapper = pageWrapper || document.getElementById(`page-wrapper-${pageNum}`);
    const canvas = wrapper?.querySelector('canvas.pdf-canvas, canvas[id^="page-canvas-"]');
    if (!canvas || !canvas.width || !canvas.height) return null;

    const existing = this._pageSnapshots.get(pageNum);
    if (existing && existing.width === canvas.width && existing.height === canvas.height) {
      return existing;
    }

    const wrapH = wrapper.clientHeight || 1;
    const wrapW = wrapper.clientWidth || 1;
    const scaleY = canvas.height / wrapH;

    const snapshotCanvas = document.createElement('canvas');
    snapshotCanvas.width = canvas.width;
    snapshotCanvas.height = canvas.height;
    snapshotCanvas.getContext('2d').drawImage(canvas, 0, 0);

    // Freeze pristine native text spans before ANY mutation
    const nativeSpans = Array.from(wrapper.querySelectorAll('.textLayer span:not(.reflow-overflow-span)')).map(s => ({
      span: s,
      topNorm: s.offsetTop / wrapH,
      bottomNorm: (s.offsetTop + s.offsetHeight) / wrapH,
      leftNorm: s.offsetLeft / wrapW,
      rightNorm: (s.offsetLeft + s.offsetWidth) / wrapW,
      origOffsetTop: s.offsetTop,
      origOffsetHeight: s.offsetHeight,
      origOffsetLeft: s.offsetLeft,
      origOffsetWidth: s.offsetWidth,
      textContent: s.textContent,
      styleText: s.getAttribute('style') || '',
      className: s.className,
      fontFamily: s.style.fontFamily,
      fontSize: s.style.fontSize
    }));

    // Find pristine content boundaries
    let maxCssBottom = 0;
    let minCssTop = wrapH;
    for (const s of nativeSpans) {
      if (s.textContent && s.textContent.trim()) {
        maxCssBottom = Math.max(maxCssBottom, s.origOffsetTop + s.origOffsetHeight);
        minCssTop = Math.min(minCssTop, s.origOffsetTop);
      }
    }
    wrapper.querySelectorAll('.annotation-textbox, .placed-stamp, .whiteout-box, .redaction-box').forEach(el => {
      maxCssBottom = Math.max(maxCssBottom, el.offsetTop + el.offsetHeight);
      minCssTop = Math.min(minCssTop, el.offsetTop);
    });

    let contentBottomPx = Math.round(maxCssBottom * scaleY);
    let contentTopPx = Math.round(minCssTop * scaleY);

    // Scan canvas raster for non-white ink below text layer (e.g. diagrams, images, or footer)
    const ctx = snapshotCanvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    try {
      const checkRows = 40;
      for (let rowBottom = H; rowBottom > contentBottomPx; rowBottom -= checkRows) {
        const rowTop = Math.max(contentBottomPx, rowBottom - checkRows);
        const blockH = rowBottom - rowTop;
        if (blockH <= 0) break;
        const imgData = ctx.getImageData(0, rowTop, W, blockH);
        const data = imgData.data;
        let hasInk = false;
        let inkMaxY = 0;
        for (let y = blockH - 1; y >= 0; y--) {
          const rowOffset = y * W * 4;
          for (let x = 0; x < W; x += 16) {
            const idx = rowOffset + x * 4;
            const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
            if (a > 20 && (r < 240 || g < 240 || b < 240)) {
              hasInk = true;
              inkMaxY = rowTop + y;
              break;
            }
          }
          if (hasInk) break;
        }
        if (hasInk) {
          contentBottomPx = Math.max(contentBottomPx, inkMaxY);
          break;
        }
      }
    } catch (_) {}

    const snapshot = {
      canvas: snapshotCanvas,
      width: canvas.width,
      height: canvas.height,
      pristineBottomPx: Math.min(H, Math.max(0, contentBottomPx)),
      pristineTopPx: Math.max(0, Math.min(H, contentTopPx)),
      nativeSpans
    };
    this._pageSnapshots.set(pageNum, snapshot);
    return snapshot;
  }

  _getPageCanvas(pageWrapper) {
    return pageWrapper?.querySelector('canvas.pdf-canvas, canvas[id^="page-canvas-"]') || null;
  }

  /** Schedule reflow on the next frame (used after undo/redo/toolbar changes). */
  _scheduleReflow(pageNum) {
    if (typeof requestAnimationFrame !== 'function') {
      this._reflowEditedPage(pageNum);
      return;
    }
    this._reflowPageNum = Math.min(this._reflowPageNum || pageNum || 1, pageNum || 1);
    cancelAnimationFrame(this._reflowFrame);
    this._reflowFrame = requestAnimationFrame(() => {
      const pending = this._reflowPageNum || 1;
      this._reflowPageNum = null;
      if (pending) this._reflowEditedPage(pending);
    });
  }

  _createOverflowPage(pageNum) {
    const existing = document.getElementById(`page-wrapper-${pageNum}`);
    if (existing) return existing;

    const prevWrapper = document.getElementById(`page-wrapper-${pageNum - 1}`);
    if (!prevWrapper) return null;

    const pageWrapper = document.createElement('div');
    pageWrapper.className = 'page-wrapper overflow-page';
    if (document.body.classList.contains('mode-edit')) {
      pageWrapper.classList.add('editing-content');
    }
    pageWrapper.id = `page-wrapper-${pageNum}`;
    pageWrapper.dataset.pageNumber = String(pageNum);
    pageWrapper.style.width = prevWrapper.style.width || `${prevWrapper.clientWidth}px`;
    pageWrapper.style.height = prevWrapper.style.height || `${prevWrapper.clientHeight}px`;
    pageWrapper.dataset.renderWidth = prevWrapper.dataset.renderWidth || `${prevWrapper.clientWidth}`;
    pageWrapper.dataset.renderHeight = prevWrapper.dataset.renderHeight || `${prevWrapper.clientHeight}`;

    const prevCanvas = this._getPageCanvas(prevWrapper);
    const w = prevCanvas ? prevCanvas.width : (prevWrapper.clientWidth * 2);
    const h = prevCanvas ? prevCanvas.height : (prevWrapper.clientHeight * 2);

    const canvas = document.createElement('canvas');
    canvas.id = `page-canvas-${pageNum}`;
    canvas.className = 'pdf-canvas';
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${Math.floor(parseFloat(pageWrapper.style.width) || prevWrapper.clientWidth)}px`;
    canvas.style.height = `${Math.floor(parseFloat(pageWrapper.style.height) || prevWrapper.clientHeight)}px`;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    const textLayer = document.createElement('div');
    textLayer.className = 'textLayer';
    textLayer.id = `text-layer-${pageNum}`;
    textLayer.style.width = canvas.style.width;
    textLayer.style.height = canvas.style.height;

    const annotationLayer = document.createElement('div');
    annotationLayer.className = 'annotation-layer';
    annotationLayer.id = `annotation-layer-${pageNum}`;
    const annotCanvas = document.createElement('canvas');
    annotCanvas.id = `annot-canvas-${pageNum}`;
    annotCanvas.width = w;
    annotCanvas.height = h;
    annotCanvas.style.width = canvas.style.width;
    annotCanvas.style.height = canvas.style.height;
    annotationLayer.appendChild(annotCanvas);

    pageWrapper.appendChild(canvas);
    pageWrapper.appendChild(textLayer);
    pageWrapper.appendChild(annotationLayer);

    const container = this.viewer?.pagesContainer || document.getElementById('viewer-container');
    if (container) {
      container.appendChild(pageWrapper);
    }

    if (this.viewer) {
      if (this.viewer.observer) {
        this.viewer.observer.observe(pageWrapper);
      }
      this.viewer.totalPages = Math.max(this.viewer.totalPages, pageNum);
      if (this.ui) {
        this.ui.updatePageInfo(this.viewer.currentPage || 1, this.viewer.totalPages);
      }
    }

    const snapshotCanvas = document.createElement('canvas');
    snapshotCanvas.width = w;
    snapshotCanvas.height = h;
    const sCtx = snapshotCanvas.getContext('2d');
    sCtx.fillStyle = '#ffffff';
    sCtx.fillRect(0, 0, w, h);
    this._pageSnapshots.set(pageNum, { canvas: snapshotCanvas, width: w, height: h });

    return pageWrapper;
  }

  _removeOverflowPage(pageNum) {
    const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
    if (!wrapper || !wrapper.classList.contains('overflow-page')) return;

    if (this.viewer?.observer) {
      this.viewer.observer.unobserve(wrapper);
    }
    wrapper.remove();
    this._pageSnapshots.delete(pageNum);

    if (this.viewer && this.viewer.totalPages >= pageNum) {
      const wrappers = document.querySelectorAll('.page-wrapper');
      let maxPage = 1;
      wrappers.forEach(w => {
        const n = parseInt(w.dataset.pageNumber, 10);
        if (n && n > maxPage) maxPage = n;
      });
      this.viewer.totalPages = maxPage;
      if (this.ui) {
        this.ui.updatePageInfo(this.viewer.currentPage || 1, this.viewer.totalPages);
      }
    }
  }

  _getPageContentBottom(pageWrapper, pageCanvas, pristine) {
    if (pageWrapper.classList.contains('overflow-page')) {
      return 0; // Pure overflow page has no inherent pristine content
    }
    if (pristine && pristine.pristineBottomPx !== undefined) {
      return pristine.pristineBottomPx;
    }
    const H = pageCanvas.height;
    const wrapH = pageWrapper.clientHeight || 1;
    const scaleY = H / wrapH;

    let maxCssBottom = 0;
    // 1. Spans in text layer
    pageWrapper.querySelectorAll('.textLayer span:not(.reflow-overflow-span)').forEach(s => {
      if (s.textContent && s.textContent.trim()) {
        maxCssBottom = Math.max(maxCssBottom, s.offsetTop + s.offsetHeight);
      }
    });

    // 2. Overlays (stamps, textboxes, images)
    pageWrapper.querySelectorAll('.annotation-textbox, .placed-stamp, .whiteout-box, .redaction-box').forEach(el => {
      maxCssBottom = Math.max(maxCssBottom, el.offsetTop + el.offsetHeight);
    });

    let contentBottomPx = Math.round(maxCssBottom * scaleY);

    // 3. Check canvas for non-white pixels below textLayer (e.g. diagrams or images at page bottom)
    if (pristine && pristine.canvas) {
      const pCanvas = pristine.canvas;
      const W = pCanvas.width;
      const ctx = pCanvas.getContext('2d');
      try {
        const checkRows = 40;
        for (let rowBottom = H; rowBottom > contentBottomPx; rowBottom -= checkRows) {
          const rowTop = Math.max(contentBottomPx, rowBottom - checkRows);
          const blockH = rowBottom - rowTop;
          if (blockH <= 0) break;
          const imgData = ctx.getImageData(0, rowTop, W, blockH);
          const data = imgData.data;
          let hasInk = false;
          let inkMaxY = 0;
          for (let y = blockH - 1; y >= 0; y--) {
            const rowOffset = y * W * 4;
            for (let x = 0; x < W; x += 16) {
              const idx = rowOffset + x * 4;
              const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
              if (a > 20 && (r < 240 || g < 240 || b < 240)) {
                hasInk = true;
                inkMaxY = rowTop + y;
                break;
              }
            }
            if (hasInk) break;
          }
          if (hasInk) {
            contentBottomPx = Math.max(contentBottomPx, inkMaxY);
            break;
          }
        }
      } catch (_) {}
    }

    return Math.min(H, Math.max(0, contentBottomPx));
  }

  /**
   * Re-layout document pages after in-place text growth.
   *
   * The visible PDF is a canvas raster plus transparent text-layer spans.
   * When an edited paragraph grows, content below it is shifted down. If content
   * reaches the bottom boundary of a page, it cascades seamlessly onto following pages,
   * pushing their existing content down and creating dynamic overflow pages if necessary,
   * guaranteeing that zero text or diagram elements are lost off the page edge.
   */
  _reflowEditedPage(pageNum, pageWrapperArg) {
    const totalPages = this.viewer?.totalPages || 1;
    const maxPagesToCheck = Math.max(totalPages, this._lastReflowedMaxPage || totalPages, 1) + 20;

    let incomingSlice = null;
    let highestReflowedPage = 1;

    for (let p = 1; p <= maxPagesToCheck; p++) {
      let pageWrapper = document.getElementById(`page-wrapper-${p}`);
      if (!pageWrapper) {
        if (incomingSlice && incomingSlice.height > 0) {
          pageWrapper = this._createOverflowPage(p);
          if (!pageWrapper) break;
        } else {
          break;
        }
      }

      const pageCanvas = this._getPageCanvas(pageWrapper);
      if (!pageCanvas) break;

      // Ensure pristine copy exists
      if (!this._pageSnapshots.has(p) ||
          this._pageSnapshots.get(p).width !== pageCanvas.width ||
          this._pageSnapshots.get(p).height !== pageCanvas.height) {
        this._capturePageSnapshot(p, pageWrapper);
      }
      const pristine = this._pageSnapshots.get(p);

      const pageEdits = this.annotator?.inPlaceEdits?.get(p);
      const wrapH = pageWrapper.clientHeight || 1;
      const wrapW = pageWrapper.clientWidth || 1;
      const W = pageCanvas.width;
      const H = pageCanvas.height;
      const scaleY = H / wrapH;

      const ops = [];
      if (pageEdits && pageEdits.size > 0) {
        for (const [span, edit] of pageEdits.entries()) {
          if (!span || !span.isConnected) continue;
          const norm = span._normRect || edit.normRect;
          if (!norm) continue;
          const origHeightPx = norm.h * wrapH;
          const currentHeightPx = span.offsetHeight || 0;
          ops.push({
            span,
            edit,
            norm,
            topNorm: norm.y,
            bottomNorm: norm.y + norm.h,
            origHeightPx,
            extraNorm: Math.max(0, (currentHeightPx - origHeightPx) / wrapH),
            extraPx: Math.max(0, currentHeightPx - origHeightPx)
          });
        }
        ops.sort((a, b) => a.topNorm - b.topNorm);
      }

      const hasIncoming = Boolean(incomingSlice && incomingSlice.height > 0);
      const hasDirectGrowth = ops.some(op => op.extraPx > 0);
      const hasEdits = Boolean(pageEdits && pageEdits.size > 0);

      if (!hasIncoming && !hasDirectGrowth && !hasEdits) {
        if (pageWrapper.classList.contains('overflow-page')) {
          this._removeOverflowPage(p);
          incomingSlice = null;
          continue;
        }

        // Restore pristine page canvas
        if (pristine) {
          const ctx = pageCanvas.getContext('2d');
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, W, H);
          ctx.drawImage(pristine.canvas, 0, 0);
          ctx.restore();
        }

        const textLayer = pageWrapper.querySelector('.textLayer');
        if (textLayer) {
          textLayer.querySelectorAll('span.reflow-overflow-span').forEach(s => s.remove());
          textLayer.querySelectorAll('span').forEach(span => {
            if (span.dataset.reflowShift) {
              span.style.transform = span._reflowBaseTransform || '';
              delete span.dataset.reflowShift;
            }
            if (span.style.display === 'none') {
              span.style.display = '';
            }
          });
        }
        pageWrapper.querySelectorAll('.annotation-textbox, .placed-stamp, .whiteout-box, .redaction-box').forEach(el => {
          if (el.dataset.reflowShift) {
            el.style.transform = el._reflowBaseTransform || '';
            delete el.dataset.reflowShift;
          }
        });
        delete pageWrapper.dataset.hasReflow;
        incomingSlice = null;
        continue;
      }

      highestReflowedPage = p;
      pageWrapper.dataset.hasReflow = 'true';

      const incomingH = hasIncoming ? incomingSlice.height : 0;
      const incomingCssH = incomingH / scaleY;

      // Ensure pristine content bottom & top bounds from frozen snapshot
      const pristineBottomPx = (pristine && pristine.pristineBottomPx !== undefined)
        ? pristine.pristineBottomPx
        : this._getPageContentBottom(pageWrapper, pageCanvas, pristine);
      const pristineTopPx = (pristine && pristine.pristineTopPx !== undefined)
        ? pristine.pristineTopPx
        : Math.round(40 * scaleY);

      // Safe bottom padding: Ensure content NEVER reaches the bottom edge of the page
      const bottomPaddingPx = Math.max(
        Math.round(45 * scaleY),
        Math.min(Math.round(80 * scaleY), H - (pristineBottomPx || Math.round(H - 50 * scaleY)))
      );
      const maxContentY = H - bottomPaddingPx;

      // Top padding for incoming content on this page
      const topPaddingPx = pageWrapper.classList.contains('overflow-page')
        ? Math.round(45 * scaleY)
        : pristineTopPx;
      const topPaddingCss = topPaddingPx / scaleY;

      // Paragraph spacing gap between incoming overflow and existing page content
      const paragraphGapPx = (hasIncoming && pristineBottomPx > 0) ? Math.round(14 * scaleY) : 0;
      const incomingTotalShiftPx = hasIncoming ? (incomingH + paragraphGapPx) : 0;
      const incomingTotalShiftCss = incomingTotalShiftPx / scaleY;

      const totalDirectDeltaPx = ops.reduce((acc, op) => acc + Math.round(op.extraNorm * H), 0);
      const newBottomPx = pristineBottomPx > 0
        ? (pristineBottomPx + incomingTotalShiftPx + totalDirectDeltaPx)
        : (topPaddingPx + incomingTotalShiftPx + totalDirectDeltaPx);

      // Virtual canvas holds full continuous content of this page + overflow
      const virtualH = Math.max(H, newBottomPx + bottomPaddingPx);
      const virtualCanvas = document.createElement('canvas');
      virtualCanvas.width = W;
      virtualCanvas.height = virtualH;
      const vCtx = virtualCanvas.getContext('2d');
      vCtx.fillStyle = '#ffffff';
      vCtx.fillRect(0, 0, W, virtualH);

      // A. Draw incoming slice at y = topPaddingPx
      if (hasIncoming && incomingSlice.canvas) {
        vCtx.drawImage(incomingSlice.canvas, 0, 0, incomingSlice.canvas.width, incomingSlice.height, 0, topPaddingPx, W, incomingH);
      }

      // B. Draw pristine page at y = incomingTotalShiftPx
      if (pristine && !pageWrapper.classList.contains('overflow-page')) {
        vCtx.drawImage(pristine.canvas, 0, incomingTotalShiftPx, W, H);
      }

      // C. Shift content below direct in-place edits on this page
      let priorExtra = 0;
      for (const op of ops) {
        const deltaPx = Math.round(op.extraNorm * H);
        const bottomPx = Math.round((op.bottomNorm + priorExtra) * H) + incomingTotalShiftPx;
        if (deltaPx > 0 && bottomPx < virtualH && bottomPx >= 0) {
          const contentBelowH = virtualH - (bottomPx + deltaPx);
          if (contentBelowH > 0) {
            const scratch = document.createElement('canvas');
            scratch.width = W;
            scratch.height = contentBelowH;
            scratch.getContext('2d').drawImage(virtualCanvas, 0, bottomPx, W, contentBelowH, 0, 0, W, contentBelowH);
            vCtx.fillStyle = '#ffffff';
            vCtx.fillRect(0, bottomPx, W, contentBelowH + deltaPx);
            vCtx.drawImage(scratch, 0, 0, W, contentBelowH, 0, bottomPx + deltaPx, W, contentBelowH);
          }
        }
        priorExtra += op.extraNorm;
      }

      // D. Mask original lines behind direct in-place edits on this page
      let maskShift = 0;
      for (const op of ops) {
        const topPx = (op.topNorm + maskShift) * H + incomingTotalShiftPx;
        const maskW = Math.max(op.norm.w * W, (parseFloat(op.span.style.maxWidth) || 0) * W / wrapW);
        const maskH = (op.origHeightPx + op.extraPx) * H / wrapH;
        vCtx.fillStyle = '#ffffff';
        vCtx.fillRect(
          Math.max(0, Math.floor(op.norm.x * W) - 2),
          Math.max(0, Math.floor(topPx) - 2),
          Math.ceil(maskW) + 4,
          Math.ceil(maskH) + 4
        );
        maskShift += op.extraNorm;
      }

      // E. Check overflow to next page and determine CLEAN cut point (splitY)
      let splitY = H;
      let hasOverflow = false;

      if (newBottomPx > maxContentY) {
        hasOverflow = true;
        // Collect candidate line bottoms from native spans and incoming spans
        const lineBottoms = [];
        if (hasIncoming && incomingSlice.spans) {
          for (const s of incomingSlice.spans) {
            const botPx = Math.round((topPaddingCss + s.topPx + (s.heightPx || 16)) * scaleY);
            lineBottoms.push(botPx);
          }
        }
        if (pristine && pristine.nativeSpans) {
          for (const s of pristine.nativeSpans) {
            let directShiftNorm = 0;
            for (const op of ops) {
              if (op.bottomNorm <= s.topNorm + 0.0001) directShiftNorm += op.extraNorm;
            }
            const shiftedBottomPx = Math.round((s.bottomNorm + directShiftNorm) * H) + incomingTotalShiftPx;
            lineBottoms.push(shiftedBottomPx);
          }
        }
        lineBottoms.sort((a, b) => a - b);

        // Find last line that fits within maxContentY
        const fitting = lineBottoms.filter(b => b <= maxContentY);
        if (fitting.length > 0) {
          const lastFittingBottom = fitting[fitting.length - 1];
          splitY = Math.min(maxContentY, lastFittingBottom + 4);
        } else {
          splitY = maxContentY;
        }
      }

      // Draw onto live page canvas: 0 to splitY, leaving bottom margin pure white!
      const ctx = pageCanvas.getContext('2d');
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(virtualCanvas, 0, 0, W, splitY, 0, 0, W, splitY);
      ctx.restore();

      // F. TextLayer spans
      const textLayer = pageWrapper.querySelector('.textLayer');
      if (textLayer) {
        textLayer.querySelectorAll('span.reflow-overflow-span').forEach(s => s.remove());
      }
      const outgoingSpans = [];
      const splitYCss = splitY / scaleY;

      // Add incoming spans to text layer
      if (hasIncoming && incomingSlice.spans && textLayer) {
        for (const sData of incomingSlice.spans) {
          const placedTopCss = topPaddingCss + sData.topPx;
          const placedBottomCss = placedTopCss + (sData.heightPx || 16);
          if (hasOverflow && placedBottomCss > splitYCss) {
            outgoingSpans.push({
              ...sData,
              topPx: placedTopCss - splitYCss
            });
          } else {
            const overflowSpan = document.createElement('span');
            overflowSpan.className = (sData.className || '') + ' reflow-overflow-span';
            overflowSpan.textContent = sData.textContent;
            if (sData.styleText) overflowSpan.style.cssText = sData.styleText;
            overflowSpan.style.position = 'absolute';
            overflowSpan.style.left = `${sData.leftPx}px`;
            overflowSpan.style.top = `${placedTopCss}px`;
            overflowSpan.style.transform = 'none';
            overflowSpan.style.display = '';
            overflowSpan.style.visibility = sData.visibility || '';
            if (sData.fontFamily) overflowSpan.style.fontFamily = sData.fontFamily;
            if (sData.fontSize) overflowSpan.style.fontSize = sData.fontSize;
            if (sData.lineHeight) overflowSpan.style.lineHeight = sData.lineHeight;
            if (sData.color) overflowSpan.style.color = sData.color;
            textLayer.appendChild(overflowSpan);
          }
        }
      }

      // Shift native spans on this page using pristine records
      const nativeSpanRecords = (pristine && pristine.nativeSpans)
        ? pristine.nativeSpans
        : Array.from(pageWrapper.querySelectorAll('.textLayer span:not(.reflow-overflow-span)')).map(s => ({
            span: s,
            topNorm: s.offsetTop / wrapH,
            bottomNorm: (s.offsetTop + s.offsetHeight) / wrapH,
            origOffsetTop: s.offsetTop,
            origOffsetHeight: s.offsetHeight,
            origOffsetLeft: s.offsetLeft,
            origOffsetWidth: s.offsetWidth,
            textContent: s.textContent,
            styleText: s.getAttribute('style') || '',
            className: s.className,
            fontFamily: s.style.fontFamily,
            fontSize: s.style.fontSize
          }));

      for (const sRec of nativeSpanRecords) {
        const span = sRec.span;
        if (!span || !span.isConnected) continue;

        let directShiftNorm = 0;
        for (const op of ops) {
          if (op.span === span) continue;
          if (op.bottomNorm <= sRec.topNorm + 0.0001) directShiftNorm += op.extraNorm;
        }
        const shiftNorm = (incomingTotalShiftCss / wrapH) + directShiftNorm;
        const shiftPx = Math.round(shiftNorm * wrapH);

        if (span._reflowBaseTransform === undefined) {
          span._reflowBaseTransform = span.style.transform || '';
        }
        const base = span._reflowBaseTransform;
        const newTopCss = sRec.origOffsetTop + shiftPx;
        const newBottomCss = newTopCss + (sRec.origOffsetHeight || 16);

        if (hasOverflow && newBottomCss > splitYCss) {
          span.style.display = 'none';
          const cs = window.getComputedStyle(span);
          outgoingSpans.push({
            className: span.className,
            textContent: span.textContent,
            styleText: span.getAttribute('style') || '',
            leftPx: sRec.origOffsetLeft,
            topPx: Math.max(0, newTopCss - splitYCss),
            heightPx: sRec.origOffsetHeight || 16,
            visibility: span.style.visibility,
            fontFamily: span.style.fontFamily || cs.fontFamily,
            fontSize: span.style.fontSize || cs.fontSize,
            lineHeight: span.style.lineHeight || cs.lineHeight,
            color: span.style.color || cs.color
          });
        } else {
          span.style.display = '';
          if (shiftPx) {
            const translate = `translateY(${shiftPx}px)`;
            span.style.transform = (base && base !== 'none') ? `${base} ${translate}` : translate;
            span.dataset.reflowShift = String(shiftPx);
          } else if (span.dataset.reflowShift) {
            span.style.transform = base;
            delete span.dataset.reflowShift;
          }
        }
      }

      // G. Shift any overlay elements on this page
      if (incomingTotalShiftCss > 0) {
        pageWrapper.querySelectorAll('.annotation-textbox, .placed-stamp, .whiteout-box, .redaction-box').forEach(el => {
          if (el._reflowBaseTransform === undefined) {
            el._reflowBaseTransform = el.style.transform || '';
          }
          const base = el._reflowBaseTransform;
          const translate = `translateY(${Math.round(incomingTotalShiftCss)}px)`;
          el.style.transform = (base && base !== 'none') ? `${base} ${translate}` : translate;
          el.dataset.reflowShift = String(Math.round(incomingTotalShiftCss));
        });
      }

      // H. Check overflow to next page
      if (hasOverflow && virtualH > splitY) {
        const overflowH = virtualH - splitY;
        const nextOverflowCanvas = document.createElement('canvas');
        nextOverflowCanvas.width = W;
        nextOverflowCanvas.height = overflowH;
        const oCtx = nextOverflowCanvas.getContext('2d');
        oCtx.drawImage(virtualCanvas, 0, splitY, W, overflowH, 0, 0, W, overflowH);

        incomingSlice = {
          canvas: nextOverflowCanvas,
          height: overflowH,
          spans: outgoingSpans
        };
      } else {
        incomingSlice = null;
      }
    }

    this._lastReflowedMaxPage = highestReflowedPage;
  }

  addCustomBookmark(title, pageNum) {
    if (!this.customBookmarks) this.customBookmarks = [];
    const validPage = Math.max(1, Math.min(parseInt(pageNum, 10) || 1, this.viewer?.totalPages || 1));
    this.customBookmarks.push({ title: title || `Page ${validPage} Bookmark`, pageNum: validPage });
  }

  _setupElectronBridge() {
    if (window.electronAPI) {
      window.electronAPI.onOpenPdf((fileInfo) => {
        const u8 = new Uint8Array(fileInfo.data);
        this.loadArrayBuffer(u8.buffer, fileInfo.name);
      });
      window.electronAPI.onTriggerSave(() => this.saveDocument());
      window.electronAPI.onTriggerPrint(() => this.exporter.printDocument());
    }
  }

  /**
   * Desktop drag & drop: Tauri reports real filesystem paths, so files dropped
   * on the window can be saved back in place (the HTML5 drop event gives no
   * usable path in the native shell).
   */
  _setupTauriFileDrop() {
    if (!this.fileAccess.canUseNativeDesktop) return;
    try {
      const win = window.__TAURI__?.webviewWindow?.getCurrentWebviewWindow?.();
      if (!win?.onDragDropEvent) return;
      win.onDragDropEvent(async (event) => {
        const payload = event?.payload || {};
        if (payload.type !== 'drop') return;
        const path = (payload.paths || []).find(p => /\.pdf$/i.test(p));
        if (!path) return;
        try {
          const bytes = await this.fileAccess.readNativePdf(path);
          const name = fileNameFromPath(path);
          // Link the target before rendering so an early Save can never
          // fall back to the location picker.
          this._setSaveTarget({ kind: 'native', path });
          await this.loadArrayBuffer(bytes, name);
          this.ui.showToast(`Opened: ${name}`, 'success');
        } catch (err) {
          console.error('Could not open dropped file:', err);
          this.ui.showToast(`Could not open dropped file: ${err.message}`, 'error');
        }
      });
    } catch (err) {
      console.warn('Native drag & drop is unavailable:', err);
    }
  }

  /**
   * Shared Open entry point for every toolbar, menu and keyboard shortcut.
   * Uses native dialogs / File System Access API when available and falls back
   * to the hidden <input type="file"> everywhere else (Android, Firefox, ...).
   */
  async openDocumentPicker() {
    if (this._openPickerInFlight) return;
    this._openPickerInFlight = true;
    try {
      const result = await this.fileAccess.openPdf();
      if (!result || result.cancelled) return;
      if (result.fallback) {
        document.getElementById('file-input')?.click();
        return;
      }
      // Link the new save target before rendering so an early Save cannot
      // write to the previously opened document.
      this._setSaveTarget(result.target || null);
      await this.loadArrayBuffer(result.bytes, result.name);
      this.ui.setStatus(`Ready: ${result.name}`);
    } catch (err) {
      console.error('Open document failed:', err);
      this.ui.showToast(`Could not open document: ${err.message}`, 'error');
      this.ui.setStatus(`Open error: ${err.message}`);
    } finally {
      this._openPickerInFlight = false;
    }
  }

  async loadFile(file) {
    // Files arriving through <input type="file"> or drag & drop expose no
    // writable location, so the previous save target must be dropped.
    this._setSaveTarget(null);
    this.currentDocName = file.name;
    const arrayBuffer = await file.arrayBuffer();
    await this.loadArrayBuffer(arrayBuffer, file.name);
  }

  _setSaveTarget(target) {
    if (!target) {
      this.currentFileHandle = null;
      this.currentFilePath = null;
      this.fileAccess.storePath(null);
      return;
    }
    if (target.kind === 'handle') {
      this.currentFileHandle = target.handle;
      this.currentFilePath = null;
      this.fileAccess.storePath(null);
    } else {
      this.currentFilePath = target.path || null;
      this.currentFileHandle = null;
      this.fileAccess.storePath(this.currentFilePath);
    }
  }

  _currentSaveTarget() {
    if (this.currentFilePath && this.fileAccess.canUseNativeDesktop) {
      return { kind: 'native', path: this.currentFilePath };
    }
    if (this.currentFileHandle) {
      return { kind: 'handle', handle: this.currentFileHandle };
    }
    return null;
  }

  _suggestCopyName() {
    const baseName = (this.currentDocName || 'document.pdf').replace(/\.pdf$/i, '');
    return `${baseName}_copy.pdf`;
  }

  _setDocumentName(name) {
    if (!name) return;
    this.currentDocName = name;
    const titleEl = document.getElementById('current-doc-name');
    if (titleEl) titleEl.textContent = name;
    const m3Title = document.getElementById('m3-doc-title');
    if (m3Title) m3Title.textContent = name;
    if (this.storage && this.currentPdfBytes) {
      this.storage.saveActiveDocument(name, this.currentPdfBytes, this.viewer?.currentPage || 1);
    }
  }

  async loadArrayBuffer(data, docName = 'document.pdf', persist = true) {
    this.currentDocName = docName;
    this._pageSnapshots.clear();
    this._lastReflowedMaxPage = 1;
    if (data instanceof Uint8Array) {
      this.currentPdfBytes = data.slice();
    } else if (data instanceof ArrayBuffer) {
      this.currentPdfBytes = new Uint8Array(data.slice(0));
    } else if (data && data.buffer) {
      this.currentPdfBytes = new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    } else {
      this.currentPdfBytes = new Uint8Array(data);
    }

    if (persist && this.storage) {
      this.storage.saveActiveDocument(this.currentDocName, this.currentPdfBytes, 1);
    }

    if (this.annotator) {
      this.annotator.clearAllEdits();
    }
    if (this.exporter && typeof this.exporter.cleanupPrintContainer === 'function') {
      this.exporter.cleanupPrintContainer();
    }
    this.customBookmarks = [];

    // Safely toggle welcome screen and viewer
    const welcomeScreen = document.getElementById('welcome-screen');
    const pdfViewer = document.getElementById('pdf-viewer');
    if (welcomeScreen) welcomeScreen.style.display = 'none';
    if (pdfViewer) pdfViewer.style.display = 'flex';
    document.getElementById('current-doc-name').textContent = docName;
    const m3Title = document.getElementById('m3-doc-title');
    if (m3Title) m3Title.textContent = docName;
    this.ui.setStatus(`Loading ${docName}...`);

    try {
      await this.viewer.loadDocument(this.currentPdfBytes, docName);
      if (this.wakeLock) this.wakeLock.acquire();
      this.ui.setStatus(`Ready: ${docName}`);
    } catch (err) {
      console.error(err);
      this.ui.setStatus(`Error loading PDF: ${err.message}`);
    }
  }

  _onPageChange(current, total) {
    if (this.storage) {
      this.storage.updateActivePage(current);
    }
    const pageInput = document.getElementById('page-num-input');
    const pageCount = document.getElementById('page-count');
    const m3Page = document.getElementById('m3-page-display');
    const m3Sub = document.getElementById('m3-drawer-subtitle');

    if (pageInput) pageInput.value = current;
    if (pageCount) pageCount.textContent = total;
    if (m3Page) m3Page.textContent = `${current} / ${total}`;
    if (m3Sub) m3Sub.textContent = `${total} pages • Page ${current}`;
  }

  _onDocumentLoaded(meta) {
    const pageCount = document.getElementById('page-count');
    const pageInput = document.getElementById('page-num-input');
    const m3Page = document.getElementById('m3-page-display');
    const m3Sub = document.getElementById('m3-drawer-subtitle');

    if (pageCount) pageCount.textContent = meta.pages;
    if (pageInput) {
      pageInput.value = 1;
      pageInput.max = meta.pages;
    }
    if (m3Page) m3Page.textContent = `1 / ${meta.pages}`;
    if (m3Sub) m3Sub.textContent = `${meta.pages} pages • Page 1`;
    document.getElementById('status-size').textContent = `${Math.round(meta.bytes / 1024)} KB`;
    this.ui.setZoomStatus(`${Math.round(this.viewer.scale * 100)}%`);
    if (this.ui) {
      if (meta.fonts && meta.fonts.length > 0) {
        this.ui.setDocumentFonts(meta.fonts);
      }
      this.ui.syncBookmarks();
    }
  }

  async loadSamplePDF() {
    this.ui.setStatus('Generating sample PDF...');
    try {
      const lib = window.PDFLib || window.pdfLib;
      if (!lib) {
        alert('PDF library is loading, please wait a moment...');
        return;
      }
      const { PDFDocument, rgb, StandardFonts } = lib;
      const doc = await PDFDocument.create();

      // Page 1: Welcome & Overview
      const page1 = doc.addPage([600, 800]);
      const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
      const fontRegular = await doc.embedFont(StandardFonts.Helvetica);

      page1.drawText('Personal PDF Suite', {
        x: 50,
        y: 720,
        size: 28,
        font: fontBold,
        color: rgb(0.92, 0.18, 0.25)
      });

      page1.drawText('Professional Cross-Platform PDF Application', {
        x: 50,
        y: 690,
        size: 14,
        font: fontRegular,
        color: rgb(0.3, 0.3, 0.3)
      });

      const features = [
        '- High-DPI Continuous Viewer with Crisp Text Rendering',
        '- Freehand Inking, Highlighters, Sticky Notes, and Custom Stamps',
        '- Drag-and-Drop Page Organizer (Reorder, Rotate, Delete, Insert)',
        '- Electronic Signature Pad (Draw, Type Cursive, Upload Image)',
        '- Document Security: Watermarking, Page Numbers, Redaction',
        '- 100% Offline & Private (Runs on Windows, Arch Linux, and Android APK)'
      ];

      let y = 630;
      features.forEach(f => {
        page1.drawText(f, { x: 50, y, size: 12, font: fontRegular, color: rgb(0.1, 0.1, 0.1) });
        y -= 30;
      });

      // Sample Form Fill Box
      page1.drawRectangle({
        x: 50,
        y: 350,
        width: 500,
        height: 80,
        borderColor: rgb(0.8, 0.8, 0.8),
        borderWidth: 1,
        color: rgb(0.96, 0.96, 0.98)
      });
      page1.drawText('Interactive Review Section', { x: 65, y: 405, size: 12, font: fontBold });
      page1.drawText('Use the Annotate ribbon above to draw, highlight, or place stamps here.', {
        x: 65,
        y: 380,
        size: 10,
        font: fontRegular,
        color: rgb(0.4, 0.4, 0.4)
      });

      // Page 2: Testing Multi-Page Continuous Scroll
      const page2 = doc.addPage([600, 800]);
      page2.drawText('Page 2: Document Organization & Testing', {
        x: 50,
        y: 720,
        size: 22,
        font: fontBold,
        color: rgb(0.2, 0.4, 0.8)
      });
      page2.drawText('You can reorder, duplicate, or delete this page using Organize Pages.', {
        x: 50,
        y: 680,
        size: 12,
        font: fontRegular
      });

      const pdfBytes = await doc.save();
      this._setSaveTarget(null);
      await this.loadArrayBuffer(pdfBytes, 'Personal_PDF_Suite_Welcome.pdf');
      this.ui.showToast('Sample PDF generated & loaded', 'success');
    } catch (err) {
      console.error('Failed to generate sample PDF:', err);
      alert('Could not generate sample PDF: ' + err.message);
    }
  }

  async _compositeDocumentAnnotations(bytes = this.currentPdfBytes) {
    if (this.annotator && typeof this.annotator['burnAnnotationsToPdf'] === 'function') {
      try {
        return await this.annotator['burnAnnotationsToPdf'](bytes);
      } catch (burnErr) {
        console.warn('Could not composite annotations:', burnErr);
      }
    }
    return bytes;
  }

  async saveDocument() {
    return this._savePdfToDisk(false);
  }

  async saveAsDocument() {
    return this._savePdfToDisk(true);
  }

  /**
   * Save (or Save As) the open document.
   *
   * Save  -> overwrite the file the document was opened from.
   * Save As -> always ask for a new location, then keep writing there.
   *
   * When no writable location is known (drag & drop, restored session, Android
   * or browsers without the File System Access API) the legacy download/share
   * flow is used so every platform keeps working.
   */
  async _savePdfToDisk(forceNewTarget) {
    if (!this.currentPdfBytes) {
      alert('No document is open to save.');
      return;
    }

    const existingTarget = forceNewTarget ? null : this._currentSaveTarget();
    this.ui.setStatus(forceNewTarget
      ? 'Compositing annotations and saving a new PDF copy...'
      : 'Saving changes to the open document...');

    try {
      // 1. Save straight back into the file the document came from.
      if (existingTarget) {
        // Ask for write permission before burning, while the click's user
        // activation is still fresh (required by Chromium).
        const writable = existingTarget.kind !== 'handle'
          || await this.fileAccess.ensureWritable(existingTarget);

        if (writable) {
          const outputBytes = await this.annotator.burnAnnotationsToPdf(this.currentPdfBytes);
          const res = await this.fileAccess.write(existingTarget, outputBytes);
          if (res.success) {
            this._reportSaveSuccess(outputBytes, this.currentDocName,
              this.fileAccess.describeTarget(existingTarget), false);
            return;
          }
          if (res.cancelled) {
            this.ui.setStatus('Save cancelled');
            return;
          }
          console.error('In-place save failed:', res.error);
          this.ui.showToast(`Could not update the original file: ${res.error || 'unknown error'}`, 'error');
        } else {
          this.ui.showToast('Write access to the original file was denied. Choose where to save.', 'error');
        }
        // Fall through so the user can pick a different location instead of
        // being stuck with a failed save.
      }

      // 2. Ask for a destination. Native dialogs and the Chromium save picker
      //    must run before the burn so the picker keeps user activation.
      let chosen = null;
      if (this.fileAccess.canPickSaveTarget) {
        if (!existingTarget) {
          this.ui.setStatus(forceNewTarget
            ? 'Choose a location for the new PDF copy...'
            : 'Choose where to save this document (no linked file yet)...');
        }
        chosen = await this.fileAccess.pickSaveTarget(
          forceNewTarget ? this._suggestCopyName() : this.currentDocName
        );
        if (chosen?.cancelled) {
          this.ui.setStatus(forceNewTarget ? 'Save As cancelled' : 'Save cancelled');
          return;
        }
        if (chosen?.fallback) chosen = null;
      }

      // 3. Legacy fallback (Android, Firefox, file://, restored sessions).
      let fallbackName = this.currentDocName || 'document.pdf';
      if (!chosen && forceNewTarget) {
        const defaultName = this._suggestCopyName();
        const customName = prompt('Save As - Enter name for new PDF copy:', defaultName);
        if (!customName || !customName.trim()) {
          this.ui.setStatus('Save As cancelled');
          return;
        }
        fallbackName = customName.trim();
        if (!fallbackName.toLowerCase().endsWith('.pdf')) {
          fallbackName += '.pdf';
        }
      }

      const outputBytes = await this.annotator.burnAnnotationsToPdf(this.currentPdfBytes);

      if (chosen) {
        const res = await this.fileAccess.write(chosen.target, outputBytes);
        if (res.cancelled) {
          this.ui.setStatus(forceNewTarget ? 'Save As cancelled' : 'Save cancelled');
          return;
        }
        if (!res.success) {
          this.ui.showToast(`Save error: ${res.error || 'could not write file'}`, 'error');
          this.ui.setStatus(`Save error: ${res.error || 'could not write file'}`);
          return;
        }
        this._setSaveTarget(chosen.target);
        if (chosen.name && (forceNewTarget || !existingTarget)) {
          // First save to a chosen location (or Save As): the active document
          // now lives under that new name.
          this._setDocumentName(chosen.name);
        }
        this._reportSaveSuccess(
          outputBytes,
          forceNewTarget ? chosen.name : this.currentDocName,
          this.fileAccess.describeTarget(chosen.target),
          forceNewTarget
        );
        return;
      }

      const dlRes = await this.exporter.downloadFile(outputBytes, fallbackName, 'application/pdf');
      if (dlRes?.cancelled) {
        this.ui.setStatus(forceNewTarget ? 'Save As cancelled' : 'Save cancelled');
        return;
      }
      if (dlRes && dlRes.success) {
        this._reportSaveSuccess(
          outputBytes,
          fallbackName,
          dlRes.destination || 'Downloads folder',
          forceNewTarget
        );
      } else {
        this.ui.showToast('Could not save document', 'error');
      }
    } catch (err) {
      console.error(err);
      this.ui.showToast(`Save error: ${err.message}`, 'error');
      this.ui.setStatus(`Save error: ${err.message}`);
    }
  }

  _reportSaveSuccess(bytes, name, destination, isCopy) {
    this.ui.showExportResultModal({
      title: isCopy ? 'Save As Complete' : 'Document Saved',
      message: isCopy ? 'New PDF copy saved successfully.' : `Changes saved to ${name}.`,
      destination: destination || 'Downloads folder',
      files: [{ name, size: bytes.length }]
    });
    this.ui.showToast(`${isCopy ? 'Saved As' : 'Saved'}: ${name}`, 'success');
    this.ui.setStatus(`${isCopy ? 'Saved As' : 'Saved'}: ${name}`);
  }

  saveAsModifiedPdf() {
    return this.saveAsDocument();
  }

  async _restoreSession() {
    try {
      const saved = await this.storage.getActiveDocument();
      if (this.currentPdfBytes) return;

      // Desktop: the original path is remembered, so re-read the current file
      // from disk and keep saving straight back into it after a restart.
      const storedPath = this.fileAccess.getStoredPath();
      if (storedPath) {
        try {
          const bytes = await this.fileAccess.readNativePdf(storedPath);
          if (bytes && bytes.length) {
            const name = fileNameFromPath(storedPath);
            this._setSaveTarget({ kind: 'native', path: storedPath });
            await this.loadArrayBuffer(bytes, name, true);
            this._restoreSessionPage(saved);
            this.ui.showToast(`Restored document: ${name}`, 'info');
            return;
          }
        } catch (err) {
          console.warn('Saved document path is no longer available:', err);
          this.fileAccess.storePath(null);
        }
      }

      if (saved && saved.bytes) {
        console.log('Restoring previous PDF session:', saved.name);
        // A session restored from memory has no known file handle/path.
        this._setSaveTarget(null);
        await this.loadArrayBuffer(saved.bytes, saved.name, false);
        this._restoreSessionPage(saved);
        this.ui.showToast(`Restored document: ${saved.name}`, 'info');
      }
    } catch (err) {
      console.warn('Could not restore session:', err);
    }
  }

  _restoreSessionPage(saved) {
    if (saved?.page && saved.page > 1) {
      setTimeout(() => {
        this.viewer.goToPage(saved.page);
      }, 350);
    }
  }

  _initBackButton() {
    // 1. Capacitor native back button listener for Android
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
      window.Capacitor.Plugins.App.addListener('backButton', () => {
        this._handleBackPress();
      });
    }

    // 2. HTML5 popstate fallback for Android back gestures
    window.addEventListener('popstate', () => {
      this._handleBackPress();
    });

    try {
      history.pushState({ app: 'personal-pdf' }, '');
    } catch (_) {}
  }

  _initAppStatePersistence() {
    const persistActiveDoc = async () => {
      if (this.currentPdfBytes && this.currentDocName && this.storage) {
        try {
          const currentPage = this.viewer ? (this.viewer.currentPage || 1) : 1;
          await this.storage.saveActiveDocument(this.currentDocName, this.currentPdfBytes, currentPage);
          console.log('[Session] Flushed active document to storage on backgrounding');
        } catch (e) {
          console.warn('[Session] Failed to persist on pause:', e);
        }
      }
    };

    const handleResume = async () => {
      try {
        if (!this.currentPdfBytes) {
          console.log('[Session] Resumed with empty memory: restoring full document session');
          await this._restoreSession();
        } else if (this.viewer && this.viewer.pdfDoc) {
          console.log('[Session] Resumed from background: re-rendering pages to restore GPU surfaces');
          await this.viewer.renderAllPages();
        }
      } catch (e) {
        console.warn('[Session] Failed to recover session on resume:', e);
      }
    };

    // 1. Capacitor native app state change (Android Activity pause/resume)
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
      window.Capacitor.Plugins.App.addListener('appStateChange', (state) => {
        if (state.isActive) {
          handleResume();
        } else {
          persistActiveDoc();
        }
      });
    }

    // 2. Web visibility API & pagehide (Standard browser and WebView background events)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        persistActiveDoc();
      } else if (document.visibilityState === 'visible') {
        handleResume();
      }
    });

    window.addEventListener('pagehide', () => {
      persistActiveDoc();
    });
  }

  _handleBackPress() {
    try {
      history.pushState({ app: 'personal-pdf' }, '');
    } catch (_) {}

    // A. Close open modal if any
    const openModal = document.querySelector('.modal-backdrop.open');
    if (openModal) {
      openModal.classList.remove('open');
      return true;
    }

    // B. Close open sheet or drawer on mobile
    const openSheet = document.querySelector('.m3-bottom-sheet.open, .m3-drawer.open');
    if (openSheet) {
      openSheet.classList.remove('open');
      document.getElementById('m3-sheet-backdrop')?.classList.remove('open');
      return true;
    }

    // C. Revert to View mode if in any editing/organizing/annotating mode
    if (this.ui && this.ui.currentMode !== 'view') {
      const viewTab = document.querySelector('.mode-tab[data-mode="view"]');
      if (viewTab) viewTab.click();
      else this.ui.setMode('view');
      return true;
    }

    // D. In View mode, require double tap within 2s to exit so document is not abruptly lost
    if (!this._lastBackPressTime || Date.now() - this._lastBackPressTime > 2000) {
      this._lastBackPressTime = Date.now();
      if (this.ui) this.ui.showToast('Press back again to exit', 'info');
      return true;
    }

    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
      window.Capacitor.Plugins.App.exitApp();
    }
  }

  getVisibleCenterTarget() {
    const pageNum = (this.viewer && this.viewer.currentPage) ? this.viewer.currentPage : 1;
    const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
    const container = document.getElementById('viewer-container');
    if (wrapper && container) {
      const cRect = container.getBoundingClientRect();
      const wRect = wrapper.getBoundingClientRect();
      const x = Math.max(30, Math.min(wRect.width - 220, Math.round((wRect.width - 180) / 2)));
      const visibleTop = Math.max(cRect.top, wRect.top);
      const visibleBottom = Math.min(cRect.bottom, wRect.bottom);
      const visibleCenter = (visibleTop + visibleBottom) / 2;
      const y = Math.max(30, Math.min(wRect.height - 120, Math.round(visibleCenter - wRect.top - 40)));
      return { pageNum, x, y };
    }
    return { pageNum: 1, x: 120, y: 150 };
  }

  async openMergeModal() {
    const modal = document.getElementById('modal-merge');
    const mergeInput = document.getElementById('merge-files-input');
    if (mergeInput) mergeInput.value = '';

    this.mergeItems = [];
    if (this.currentPdfBytes) {
      const currentBytes = await this._compositeDocumentAnnotations(this.currentPdfBytes);
      this.mergeItems.push({
        name: this.currentDocName,
        bytes: currentBytes,
        size: currentBytes.length,
        isCurrent: true
      });
    }

    this._renderMergeList();
    if (modal) modal.classList.add('open');
  }

  _renderMergeList() {
    const mergeList = document.getElementById('merge-files-list');
    const btnMerge = document.getElementById('btn-apply-merge');
    if (!mergeList) return;
    mergeList.innerHTML = '';

    const count = this.mergeItems ? this.mergeItems.length : 0;
    if (btnMerge) {
      btnMerge.textContent = count >= 2 ? `Combine (${count} Documents)` : 'Combine Documents';
      btnMerge.disabled = count < 2;
      btnMerge.style.opacity = count < 2 ? '0.6' : '1';
    }

    if (!this.mergeItems || this.mergeItems.length === 0) {
      mergeList.innerHTML = '<div class="empty-state" style="padding:16px; font-size:12px; color:var(--text-muted); text-align:center;">No files selected yet. Choose PDF files below to combine.</div>';
      return;
    }

    if (count === 1 && this.mergeItems[0].isCurrent) {
      const helper = document.createElement('div');
      helper.style.padding = '8px 12px';
      helper.style.marginBottom = '10px';
      helper.style.fontSize = '12px';
      helper.style.background = 'rgba(59, 130, 246, 0.08)';
      helper.style.borderRadius = '6px';
      helper.style.border = '1px solid rgba(59, 130, 246, 0.2)';
      helper.style.color = 'var(--text-primary)';
      helper.innerHTML = `ℹ️ Current document <strong>${escapeHtml(this.mergeItems[0].name)}</strong> is loaded. Click <strong>+ Add PDF Files to Combine...</strong> above to select at least 1 more document to combine.`;
      mergeList.appendChild(helper);
    }

    this.mergeItems.forEach((item, idx) => {
      const el = document.createElement('div');
      el.className = 'merge-item';
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'space-between';
      el.style.padding = '8px 12px';
      el.style.background = 'var(--bg-secondary)';
      el.style.border = '1px solid var(--border-color)';
      el.style.borderRadius = '6px';
      el.style.marginBottom = '6px';

      const left = document.createElement('div');
      left.style.display = 'flex';
      left.style.alignItems = 'center';
      left.style.gap = '8px';
      left.innerHTML = `<span>📄 <strong>${idx + 1}.</strong> ${escapeHtml(item.name)}</span>` + 
        (item.isCurrent ? ' <span style="background:var(--accent-red); color:#fff; font-size:10px; padding:2px 6px; border-radius:4px; font-weight:600;">Current Document</span>' : ` <span class="text-muted">(${Math.round(item.size / 1024)} KB)</span>`);

      const right = document.createElement('div');
      right.style.display = 'flex';
      right.style.alignItems = 'center';
      right.style.gap = '4px';

      if (idx > 0) {
        const btnUp = document.createElement('button');
        btnUp.className = 'tool-btn-sm';
        btnUp.innerHTML = '▲';
        btnUp.title = 'Move file up in merge order';
        btnUp.onclick = (e) => {
          e.stopPropagation();
          const temp = this.mergeItems[idx];
          this.mergeItems[idx] = this.mergeItems[idx - 1];
          this.mergeItems[idx - 1] = temp;
          this._renderMergeList();
        };
        right.appendChild(btnUp);
      }

      if (idx < this.mergeItems.length - 1) {
        const btnDown = document.createElement('button');
        btnDown.className = 'tool-btn-sm';
        btnDown.innerHTML = '▼';
        btnDown.title = 'Move file down in merge order';
        btnDown.onclick = (e) => {
          e.stopPropagation();
          const temp = this.mergeItems[idx];
          this.mergeItems[idx] = this.mergeItems[idx + 1];
          this.mergeItems[idx + 1] = temp;
          this._renderMergeList();
        };
        right.appendChild(btnDown);
      }

      const btnRemove = document.createElement('button');
      btnRemove.className = 'tool-btn-sm';
      btnRemove.innerHTML = '&times;';
      btnRemove.title = 'Remove from merge';
      btnRemove.onclick = (e) => {
        e.stopPropagation();
        this.mergeItems.splice(idx, 1);
        this._renderMergeList();
      };
      right.appendChild(btnRemove);

      el.appendChild(left);
      el.appendChild(right);
      mergeList.appendChild(el);
    });
  }

  // Page Organizer Dialog
  async openOrganizerModal() {
    if (!this.viewer.pdfDoc) {
      alert('Please open a PDF document first.');
      return;
    }

    const modal = document.getElementById('modal-organizer');
    const grid = document.getElementById('organizer-grid');
    grid.innerHTML = '';
    this.organizerCards = [];

    for (let i = 1; i <= this.viewer.totalPages; i++) {
      const card = document.createElement('div');
      card.className = 'organizer-card';
      card.dataset.pageIndex = (i - 1).toString();
      card.dataset.rotationDelta = '0';
      card.draggable = true;

      const thumbBox = document.createElement('div');
      thumbBox.className = 'organizer-thumb organizer-thumb-loading';
      const canvas = document.createElement('canvas');
      thumbBox.appendChild(canvas);

      const footer = document.createElement('div');
      footer.className = 'organizer-footer';
      footer.innerHTML = `
        <span class="organizer-page-num">${i}</span>
        <div class="organizer-card-actions">
          <button class="organizer-mini-btn btn-move-left" title="Move Left">◀</button>
          <button class="organizer-mini-btn btn-move-right" title="Move Right">▶</button>
          <button class="organizer-mini-btn btn-rot-left" title="Rotate Left">↺</button>
          <button class="organizer-mini-btn btn-rot-right" title="Rotate Right">↻</button>
          <button class="organizer-mini-btn btn-view-card" title="View Page">👁</button>
          <button class="organizer-mini-btn btn-del-card" title="Delete Page">🗑</button>
        </div>
      `;

      card.appendChild(thumbBox);
      card.appendChild(footer);
      grid.appendChild(card);
      this.organizerCards.push(card);

      // Move Left/Right actions (Instant touch & click page switching)
      footer.querySelector('.btn-move-left').onclick = (e) => {
        e.stopPropagation();
        if (card.previousElementSibling) {
          grid.insertBefore(card, card.previousElementSibling);
          this._renumberOrganizerCards();
        }
      };

      footer.querySelector('.btn-move-right').onclick = (e) => {
        e.stopPropagation();
        if (card.nextElementSibling) {
          card.nextElementSibling.after(card);
          this._renumberOrganizerCards();
        }
      };

      // Card rotate actions
      footer.querySelector('.btn-rot-left').onclick = (e) => {
        e.stopPropagation();
        const currentRot = parseInt(card.dataset.rotationDelta, 10);
        card.dataset.rotationDelta = (currentRot - 90).toString();
        thumbBox.style.transform = `rotate(${card.dataset.rotationDelta}deg)`;
      };

      footer.querySelector('.btn-rot-right').onclick = (e) => {
        e.stopPropagation();
        const currentRot = parseInt(card.dataset.rotationDelta, 10);
        card.dataset.rotationDelta = (currentRot + 90).toString();
        thumbBox.style.transform = `rotate(${card.dataset.rotationDelta}deg)`;
      };

      footer.querySelector('.btn-view-card').onclick = (e) => {
        e.stopPropagation();
        this.viewer.goToPage(i);
        modal.classList.remove('open');
      };

      footer.querySelector('.btn-del-card').onclick = (e) => {
        e.stopPropagation();
        card.remove();
        this._renumberOrganizerCards();
      };

      card.onclick = () => {
        card.classList.toggle('selected');
      };

      card.ondblclick = () => {
        const targetPage = parseInt(card.querySelector('.organizer-page-num')?.textContent, 10) || i;
        this.viewer.goToPage(targetPage);
        modal.classList.remove('open');
      };
    }

    this._setupDragAndDropReorder(grid);
    // Show the dialog right away. Thumbnails are rendered progressively so large
    // documents do not delay opening the organizer.
    modal.classList.add('open');
    const token = this._organizerRenderToken = (this._organizerRenderToken || 0) + 1;
    await new Promise(resolve => setTimeout(resolve, 0));
    this._renderOrganizerThumbnails(token);
  }

  async _renderOrganizerThumbnails(token) {
    const cards = Array.from(this.organizerCards || []);
    for (const card of cards) {
      if (token !== this._organizerRenderToken) return;
      if (!card.isConnected) continue;

      const pageNum = parseInt(card.dataset.pageIndex, 10) + 1;
      const thumbBox = card.querySelector('.organizer-thumb');
      const canvas = thumbBox ? thumbBox.querySelector('canvas') : null;
      if (!thumbBox || !canvas) continue;

      try {
        const page = await this.viewer.pdfDoc.getPage(pageNum);
        if (token !== this._organizerRenderToken) return;

        const effectiveRot = ((page.rotate || 0) + (this.viewer.rotation || 0)) % 360;
        const vp = page.getViewport({ scale: 0.25, rotation: effectiveRot });
        canvas.width = Math.max(1, Math.floor(vp.width));
        canvas.height = Math.max(1, Math.floor(vp.height));
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        if (token !== this._organizerRenderToken) return;

        // Also render user's annotations/drawings onto thumbnail if present on this page
        const annotCanvas = document.getElementById(`annot-canvas-${pageNum}`);
        if (annotCanvas) {
          canvas.getContext('2d').drawImage(annotCanvas, 0, 0, canvas.width, canvas.height);
        }
      } catch (err) {
        console.warn(`Could not render thumbnail for page ${pageNum}:`, err);
      } finally {
        thumbBox.classList.remove('organizer-thumb-loading');
      }

      // Yield to the browser so opening, scrolling and drag/drop stay responsive.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  _renumberOrganizerCards() {
    const grid = document.getElementById('organizer-grid');
    const cards = grid.querySelectorAll('.organizer-card');
    cards.forEach((card, idx) => {
      card.querySelector('.organizer-page-num').textContent = (idx + 1).toString();
    });
  }

  _setupDragAndDropReorder(grid) {
    let draggedCard = null;

    grid.querySelectorAll('.organizer-card').forEach(card => {
      card.addEventListener('dragstart', (e) => {
        draggedCard = card;
        card.classList.add('dragging');
        if (e.dataTransfer) {
          e.dataTransfer.setData('text/plain', card.dataset.pageIndex || '0');
          e.dataTransfer.effectAllowed = 'move';
        }
      });

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (draggedCard && draggedCard !== card) {
          card.classList.add('drag-over');
        }
      });

      card.addEventListener('dragleave', () => {
        card.classList.remove('drag-over');
      });

      card.addEventListener('drop', (e) => {
        e.preventDefault();
        card.classList.remove('drag-over');
        if (!draggedCard || draggedCard === card) return;

        const rect = card.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        if (e.clientX < midX) {
          grid.insertBefore(draggedCard, card);
        } else {
          card.after(draggedCard);
        }
        this._renumberOrganizerCards();
      });

      card.addEventListener('dragend', () => {
        if (draggedCard) draggedCard.classList.remove('dragging');
        draggedCard = null;
        grid.querySelectorAll('.organizer-card').forEach(c => c.classList.remove('drag-over'));
        this._renumberOrganizerCards();
      });
    });
  }

  _bindOrganizerEvents() {
    // 1. Toolbar actions: Move Left/Right, Rotate, Delete, Duplicate, Insert Blank, Extract
    const btnMoveLeft = document.getElementById('btn-org-move-left');
    const btnMoveRight = document.getElementById('btn-org-move-right');
    const btnRotLeft = document.getElementById('btn-org-rotate-left');
    const btnRotRight = document.getElementById('btn-org-rotate-right');
    const btnDel = document.getElementById('btn-org-delete');
    const btnDup = document.getElementById('btn-org-duplicate');
    const btnInsertBlank = document.getElementById('btn-org-insert-blank');
    const btnExtract = document.getElementById('btn-org-extract');
    const grid = document.getElementById('organizer-grid');

    if (btnMoveLeft) {
      btnMoveLeft.onclick = () => {
        const selected = Array.from(grid.querySelectorAll('.organizer-card.selected'));
        if (selected.length === 0) {
          alert('Click to select a page card to move left.');
          return;
        }
        selected.forEach(card => {
          if (card.previousElementSibling) {
            grid.insertBefore(card, card.previousElementSibling);
          }
        });
        this._renumberOrganizerCards();
      };
    }

    if (btnMoveRight) {
      btnMoveRight.onclick = () => {
        const selected = Array.from(grid.querySelectorAll('.organizer-card.selected')).reverse();
        if (selected.length === 0) {
          alert('Click to select a page card to move right.');
          return;
        }
        selected.forEach(card => {
          if (card.nextElementSibling) {
            card.nextElementSibling.after(card);
          }
        });
        this._renumberOrganizerCards();
      };
    }

    if (btnRotLeft) {
      btnRotLeft.onclick = () => {
        const selected = grid.querySelectorAll('.organizer-card.selected');
        const targetCards = selected.length > 0 ? selected : grid.querySelectorAll('.organizer-card');
        targetCards.forEach(card => {
          const currentRot = parseInt(card.dataset.rotationDelta, 10) || 0;
          card.dataset.rotationDelta = (currentRot - 90).toString();
          const thumb = card.querySelector('.organizer-thumb');
          if (thumb) thumb.style.transform = `rotate(${card.dataset.rotationDelta}deg)`;
        });
      };
    }

    if (btnRotRight) {
      btnRotRight.onclick = () => {
        const selected = grid.querySelectorAll('.organizer-card.selected');
        const targetCards = selected.length > 0 ? selected : grid.querySelectorAll('.organizer-card');
        targetCards.forEach(card => {
          const currentRot = parseInt(card.dataset.rotationDelta, 10) || 0;
          card.dataset.rotationDelta = (currentRot + 90).toString();
          const thumb = card.querySelector('.organizer-thumb');
          if (thumb) thumb.style.transform = `rotate(${card.dataset.rotationDelta}deg)`;
        });
      };
    }

    if (btnDel) {
      btnDel.onclick = () => {
        const selected = grid.querySelectorAll('.organizer-card.selected');
        if (selected.length === 0) {
          alert('Click to select one or more page cards to delete.');
          return;
        }
        selected.forEach(card => card.remove());
        this._renumberOrganizerCards();
      };
    }

    if (btnDup) {
      btnDup.onclick = () => {
        const selected = grid.querySelectorAll('.organizer-card.selected');
        if (selected.length === 0) {
          alert('Click to select a page card to duplicate.');
          return;
        }
        selected.forEach(orig => {
          const clone = orig.cloneNode(true);
          clone.classList.remove('selected', 'dragging', 'drag-over');

          // Copy canvas pixels from original thumbnail to clone so duplicate is never blank
          const origCanvas = orig.querySelector('canvas');
          const cloneCanvas = clone.querySelector('canvas');
          if (origCanvas && cloneCanvas) {
            cloneCanvas.width = origCanvas.width;
            cloneCanvas.height = origCanvas.height;
            const cloneCtx = cloneCanvas.getContext('2d');
            cloneCtx.drawImage(origCanvas, 0, 0);
          }

          // Re-bind actions on clone
          const footer = clone.querySelector('.organizer-footer');
          const thumbBox = clone.querySelector('.organizer-thumb');

          footer.querySelector('.btn-move-left').onclick = (e) => {
            e.stopPropagation();
            if (clone.previousElementSibling) {
              grid.insertBefore(clone, clone.previousElementSibling);
              this._renumberOrganizerCards();
            }
          };

          footer.querySelector('.btn-move-right').onclick = (e) => {
            e.stopPropagation();
            if (clone.nextElementSibling) {
              clone.nextElementSibling.after(clone);
              this._renumberOrganizerCards();
            }
          };

          footer.querySelector('.btn-rot-left').onclick = (e) => {
            e.stopPropagation();
            const currentRot = parseInt(clone.dataset.rotationDelta, 10) || 0;
            clone.dataset.rotationDelta = (currentRot - 90).toString();
            thumbBox.style.transform = `rotate(${clone.dataset.rotationDelta}deg)`;
          };

          footer.querySelector('.btn-rot-right').onclick = (e) => {
            e.stopPropagation();
            const currentRot = parseInt(clone.dataset.rotationDelta, 10) || 0;
            clone.dataset.rotationDelta = (currentRot + 90).toString();
            thumbBox.style.transform = `rotate(${clone.dataset.rotationDelta}deg)`;
          };

          const btnView = footer.querySelector('.btn-view-card');
          if (btnView) {
            btnView.onclick = (e) => {
              e.stopPropagation();
              const pNum = parseInt(clone.querySelector('.organizer-page-num')?.textContent, 10) || 1;
              this.viewer.goToPage(pNum);
              modal.classList.remove('open');
            };
          }

          footer.querySelector('.btn-del-card').onclick = (e) => {
            e.stopPropagation();
            clone.remove();
            this._renumberOrganizerCards();
          };

          clone.onclick = () => {
            clone.classList.toggle('selected');
          };

          clone.ondblclick = () => {
            const targetPage = parseInt(clone.querySelector('.organizer-page-num')?.textContent, 10) || 1;
            this.viewer.goToPage(targetPage);
            modal.classList.remove('open');
          };

          orig.after(clone);
        });
        this._renumberOrganizerCards();
        this._setupDragAndDropReorder(grid);
      };
    }

    if (btnInsertBlank) {
      btnInsertBlank.onclick = () => {
        const card = document.createElement('div');
        card.className = 'organizer-card';
        card.dataset.isBlank = 'true';
        card.dataset.pageIndex = '-1';
        card.dataset.rotationDelta = '0';
        card.draggable = true;

        const thumbBox = document.createElement('div');
        thumbBox.className = 'organizer-thumb';
        thumbBox.style.display = 'flex';
        thumbBox.style.alignItems = 'center';
        thumbBox.style.justifyContent = 'center';
        thumbBox.style.backgroundColor = '#ffffff';
        thumbBox.style.border = '1px dashed #9ca3af';
        thumbBox.innerHTML = '<span style="color:#6b7280; font-size:12px; font-weight:600;">📄 Blank Page</span>';

        const footer = document.createElement('div');
        footer.className = 'organizer-footer';
        footer.innerHTML = `
          <span class="organizer-page-num">+</span>
          <div class="organizer-card-actions">
            <button class="organizer-mini-btn btn-move-left" title="Move Left">◀</button>
            <button class="organizer-mini-btn btn-move-right" title="Move Right">▶</button>
            <button class="organizer-mini-btn btn-rot-left" title="Rotate Left">↺</button>
            <button class="organizer-mini-btn btn-rot-right" title="Rotate Right">↻</button>
            <button class="organizer-mini-btn btn-del-card" title="Delete Page">🗑</button>
          </div>
        `;

        card.appendChild(thumbBox);
        card.appendChild(footer);

        footer.querySelector('.btn-move-left').onclick = (e) => {
          e.stopPropagation();
          if (card.previousElementSibling) {
            grid.insertBefore(card, card.previousElementSibling);
            this._renumberOrganizerCards();
          }
        };

        footer.querySelector('.btn-move-right').onclick = (e) => {
          e.stopPropagation();
          if (card.nextElementSibling) {
            card.nextElementSibling.after(card);
            this._renumberOrganizerCards();
          }
        };

        footer.querySelector('.btn-rot-left').onclick = (e) => {
          e.stopPropagation();
          const currentRot = parseInt(card.dataset.rotationDelta, 10) || 0;
          card.dataset.rotationDelta = (currentRot - 90).toString();
          thumbBox.style.transform = `rotate(${card.dataset.rotationDelta}deg)`;
        };

        footer.querySelector('.btn-rot-right').onclick = (e) => {
          e.stopPropagation();
          const currentRot = parseInt(card.dataset.rotationDelta, 10) || 0;
          card.dataset.rotationDelta = (currentRot + 90).toString();
          thumbBox.style.transform = `rotate(${card.dataset.rotationDelta}deg)`;
        };

        footer.querySelector('.btn-del-card').onclick = (e) => {
          e.stopPropagation();
          card.remove();
          this._renumberOrganizerCards();
        };

        card.onclick = () => {
          card.classList.toggle('selected');
        };

        const lastSelected = grid.querySelector('.organizer-card.selected');
        if (lastSelected) {
          lastSelected.after(card);
        } else {
          grid.appendChild(card);
        }

        grid.querySelectorAll('.organizer-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        this.ui.showToast('Blank page inserted into grid', 'info');

        this._renumberOrganizerCards();
        this._setupDragAndDropReorder(grid);
      };
    }

    if (btnExtract) {
      btnExtract.onclick = async () => {
        const selected = grid.querySelectorAll('.organizer-card.selected');
        const targetCards = selected.length > 0 ? selected : grid.querySelectorAll('.organizer-card');
        const indices = [];
        targetCards.forEach(c => {
          const idx = parseInt(c.dataset.pageIndex, 10);
          if (!isNaN(idx) && idx >= 0) indices.push(idx);
        });

        if (indices.length === 0) {
          alert('No document pages selected to extract.');
          return;
        }

        this.ui.setStatus('Extracting pages...');
        try {
          const extracted = await this.organizer.extractPages(this.currentPdfBytes, indices);
          const baseName = (this.currentDocName || 'document').replace(/\.pdf$/i, '');
          const fileName = `${baseName}_extracted.pdf`;
          const dlRes = await this.exporter.downloadFile(extracted, fileName, 'application/pdf');
          if (dlRes?.cancelled) {
            this.ui.setStatus('Extract cancelled');
            return;
          }
          if (dlRes && dlRes.success) {
            const dest = dlRes.destination || 'Downloads folder';
            this.ui.showExportResultModal({
              title: 'Extract Pages Complete',
              message: `${indices.length} pages extracted to a new PDF document.`,
              destination: dest,
              files: [{ name: fileName, size: extracted.length }]
            });
            this.ui.showToast(`Extracted ${indices.length} pages saved`, 'success');
            this.ui.setStatus('Extracted pages downloaded');
          } else {
            this.ui.showToast('Could not save extracted pages', 'error');
          }
        } catch (err) {
          console.error('Extract pages failed:', err);
          this.ui.showToast(`Extract pages failed: ${err.message}`, 'error');
          this.ui.setStatus('Extract pages failed');
        }
      };
    }

    // 2. Apply Page Changes button
    const btnApplyOrg = document.getElementById('btn-org-apply');
    if (btnApplyOrg) {
      btnApplyOrg.onclick = async () => {
        try {
          const cards = grid.querySelectorAll('.organizer-card');
          const operations = [];

          cards.forEach(card => {
            const pIdx = parseInt(card.dataset.pageIndex, 10);
            const isBlank = card.dataset.isBlank === 'true';
            if (!isNaN(pIdx) && (pIdx >= 0 || isBlank)) {
              operations.push({
                originalIndex: pIdx,
                rotationDelta: parseInt(card.dataset.rotationDelta, 10) || 0,
                isBlank: isBlank
              });
            }
          });

          if (operations.length === 0) {
            alert('Cannot create an empty PDF. Keep at least one page.');
            return;
          }

          this.ui.setStatus('Compositing annotations and applying page changes...');

          // 1. First bake any active annotations and markup into PDF bytes so reordering/rotating never loses them
          let basePdfBytes = this.currentPdfBytes;
          if (this.annotator) {
            try {
              basePdfBytes = await this.annotator.burnAnnotationsToPdf(this.currentPdfBytes);
            } catch (burnErr) {
              console.warn('Could not composite annotations before reordering:', burnErr);
            }
          }

          // 2. Perform page operations (reordering, rotation, blank pages, duplication, deletion)
          const updatedBytes = await this.organizer.reorderAndModifyPages(basePdfBytes, operations);

          document.getElementById('modal-organizer')?.classList.remove('open');
          await this.loadArrayBuffer(updatedBytes, this.currentDocName);
          this.ui.showToast(`Page modifications applied successfully (${operations.length} pages)`, 'success');
          this.ui.setStatus(`Page modifications applied successfully (${operations.length} pages)`);
        } catch (err) {
          console.error('Failed to apply page changes:', err);
          alert('Could not apply page changes: ' + err.message);
          this.ui.setStatus('Error applying page changes: ' + err.message);
        }
      };
    }
  }

  _bindProtectEvents() {
    const btnApplyProtect = document.getElementById('btn-apply-protect');
    if (!btnApplyProtect) return;

    btnApplyProtect.onclick = async () => {
      if (!this.currentPdfBytes) {
        this.ui.showToast('Please open a PDF document first', 'warning');
        return;
      }

      const passwordInput = document.getElementById('protect-password');
      const confirmInput = document.getElementById('protect-password-confirm');
      const password = (passwordInput?.value || '').trim();
      const confirm = (confirmInput?.value || '').trim();

      if (!password) {
        this.ui.showToast('Enter a password to protect the document', 'warning');
        passwordInput?.focus();
        return;
      }
      if (password !== confirm) {
        this.ui.showToast('Passwords do not match', 'error');
        confirmInput?.focus();
        return;
      }

      // PDF permission flags (/P): default -4 permits everything. Clear the
      // print (bit 3) and copy/extract (bits 5 and 10) bits when unchecked.
      let permissions = -4;
      if (!document.getElementById('protect-allow-print')?.checked) permissions &= ~4;
      if (!document.getElementById('protect-allow-copy')?.checked) {
        permissions &= ~16;
        permissions &= ~512;
      }

      const originalText = btnApplyProtect.textContent;
      btnApplyProtect.disabled = true;
      btnApplyProtect.textContent = 'Encrypting...';
      this.ui.setStatus('Encrypting document with AES-256...');

      try {
        // Bake pending annotations first so nothing is lost in the exported copy.
        let bytes = this.currentPdfBytes;
        if (this.annotator) {
          try {
            bytes = await this.annotator.burnAnnotationsToPdf(bytes);
          } catch (burnErr) {
            console.warn('Could not composite annotations before encryption:', burnErr);
          }
        }

        const encrypted = await this.security.encryptPdf(bytes, {
          userPassword: password,
          permissions
        });

        const baseName = (this.currentDocName || 'document.pdf').replace(/\.pdf$/i, '');
        const fileName = `${baseName}_protected.pdf`;
        const result = await this.exporter.downloadFile(encrypted, fileName, 'application/pdf');

        document.getElementById('modal-protect')?.classList.remove('open');
        if (passwordInput) passwordInput.value = '';
        if (confirmInput) confirmInput.value = '';

        const destination = result?.destination || 'your device';
        this.ui.setStatus(`Encrypted document saved to ${destination}`);
        this.ui.showToast(`Password-protected PDF saved: ${fileName}`, 'success');
      } catch (err) {
        console.error('Password encryption failed:', err);
        const msg = err?.code === 'NO_SUBTLE'
          ? 'AES-256 encryption needs a secure (HTTPS) context or the desktop/mobile app.'
          : `Encryption failed: ${err.message}`;
        this.ui.setStatus(msg);
        this.ui.showToast(msg, 'error');
      } finally {
        btnApplyProtect.disabled = false;
        btnApplyProtect.textContent = originalText;
      }
    };
  }

  _bindWatermarkEvents() {
    const btnApplyWatermark = document.getElementById('btn-apply-watermark');
    if (btnApplyWatermark) {
      btnApplyWatermark.onclick = async () => {
        if (!this.currentPdfBytes) {
          alert('Please open a PDF document first.');
          return;
        }
        try {
          const text = document.getElementById('watermark-text').value.trim() || 'CONFIDENTIAL';
          const angle = parseInt(document.getElementById('watermark-angle').value, 10) || 45;
          const opacity = (parseInt(document.getElementById('watermark-opacity').value, 10) || 25) / 100;
          const color = document.getElementById('watermark-color').value || '#ff0000';
          const size = parseInt(document.getElementById('watermark-size').value, 10) || 48;

          this.ui.setStatus('Applying watermark to all pages...');
          const baseBytes = await this._compositeDocumentAnnotations(this.currentPdfBytes);
          const modified = await this.security.applyWatermark(baseBytes, {
            text, angle, opacity, color, size
          });
          await this.loadArrayBuffer(modified, this.currentDocName);
          document.getElementById('modal-watermark').classList.remove('open');
          this.ui.setStatus('Watermark applied successfully');
        } catch (err) {
          console.error('Failed to apply watermark:', err);
          alert('Could not apply watermark: ' + err.message);
          this.ui.setStatus('Watermark error: ' + err.message);
        }
      };
    }

    const opacitySlider = document.getElementById('watermark-opacity');
    if (opacitySlider) {
      opacitySlider.oninput = (e) => {
        document.getElementById('watermark-opacity-val').textContent = `${e.target.value}%`;
      };
    }
  }

  insertImageOnPage(pageNum, dataUrl, x, y) {
    if (x === undefined || y === undefined) {
      const centerTarget = this.getVisibleCenterTarget();
      pageNum = centerTarget.pageNum;
      x = centerTarget.x;
      y = centerTarget.y;
    }

    const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
    if (!wrapper) return;

    const container = document.createElement('div');
    container.className = 'placed-stamp placed-image-box';
    container.style.left = `${x}px`;
    container.style.top = `${y}px`;
    container.style.width = '200px';

    const img = document.createElement('img');
    img.src = dataUrl;
    img.style.width = '100%';
    img.style.display = 'block';
    container.appendChild(img);

    this.annotator._makeDraggable(container, wrapper);
    this.annotator._makeResizable(container, wrapper, { keepAspectRatio: true });
    wrapper.appendChild(container);
    this.annotator._selectElement(container);

    this.annotator.undoStack.push({
      type: 'element',
      pageNum,
      elements: [container]
    });
    this.annotator.redoStack = [];
  }

  insertSignatureOnPage(pageNum, dataUrl, x, y) {
    if (x === undefined || y === undefined) {
      const centerTarget = this.getVisibleCenterTarget();
      pageNum = centerTarget.pageNum;
      x = centerTarget.x;
      y = centerTarget.y;
    }

    const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
    if (!wrapper) return;

    const container = document.createElement('div');
    container.className = 'placed-stamp placed-signature-box';
    container.style.left = `${x}px`;
    container.style.top = `${y}px`;
    container.style.width = '180px';

    const img = document.createElement('img');
    img.src = dataUrl;
    img.style.width = '100%';
    img.style.display = 'block';
    container.appendChild(img);

    this.annotator._makeDraggable(container, wrapper);
    this.annotator._makeResizable(container, wrapper, { keepAspectRatio: true });
    wrapper.appendChild(container);
    this.annotator._selectElement(container);

    this.annotator.undoStack.push({
      type: 'element',
      pageNum,
      elements: [container]
    });
    this.annotator.redoStack = [];
  }

  insertWhiteoutOnPage(pageNum, x = 150, y = 150, width = 160, height = 30) {
    const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
    if (!wrapper) return;

    const box = document.createElement('div');
    box.className = 'placed-stamp whiteout-box';
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
    box.style.width = `${width}px`;
    box.style.height = `${height}px`;

    this.annotator._makeDraggable(box, wrapper);
    this.annotator._makeResizable(box, wrapper, { keepAspectRatio: false, isWhiteout: true });
    wrapper.appendChild(box);
    this.annotator._selectElement(box);

    this.annotator.undoStack.push({
      type: 'element',
      pageNum,
      elements: [box]
    });
    this.annotator.redoStack = [];
  }

  async insertBlankPage() {
    if (!this.currentPdfBytes) return;
    this.ui.setStatus('Inserting blank page...');
    // currentPage is 1-based; insertPage() takes a 0-based index. Passing the
    // 1-based value inserts the blank page immediately AFTER the current page.
    const insertIndex = Math.max(0, Math.min(this.viewer.totalPages, this.viewer.currentPage || 1));
    const updated = await this.organizer.insertBlankPage(this.currentPdfBytes, insertIndex);
    await this.loadArrayBuffer(updated, this.currentDocName);
    this.ui.setStatus('Blank page inserted');
  }

  async flattenFormFields() {
    if (!this.currentPdfBytes) {
      this.ui.showToast('Please open a PDF document first', 'warning');
      return false;
    }
    this.ui.setStatus('Flattening form fields and annotations...');
    try {
      const baseBytes = await this._compositeDocumentAnnotations(this.currentPdfBytes);
      const result = await this.organizer.flattenForm(baseBytes);
      const outputBytes = result ? result.bytes : baseBytes;
      await this.loadArrayBuffer(outputBytes, this.currentDocName);
      const count = result?.fieldCount || 0;
      const msg = count > 0
        ? `Flattened ${count} form field${count === 1 ? '' : 's'} & baked annotations`
        : 'Baked all annotations permanently into document stream';
      this.ui.setStatus(msg);
      this.ui.showToast(msg, 'success');
      return true;
    } catch (err) {
      console.error('Form flatten failed:', err);
      const msg = `Could not flatten form: ${err.message}`;
      this.ui.setStatus(msg);
      this.ui.showToast(msg, 'error');
      return false;
    }
  }

  async applyPageNumbers() {
    if (!this.currentPdfBytes) return;
    this.ui.setStatus('Adding page numbers...');
    const baseBytes = await this._compositeDocumentAnnotations(this.currentPdfBytes);
    const updated = await this.security.addPageNumbers(baseBytes);
    await this.loadArrayBuffer(updated, this.currentDocName);
    this.ui.setStatus('Page numbers added');
  }
}

// Start application when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  window.app = new PersonalPDFApp();
});

