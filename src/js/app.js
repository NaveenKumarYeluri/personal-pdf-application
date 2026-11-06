/**
 * Personal PDF Suite - Main Application Controller
 * Adobe Acrobat-grade functionality for Windows, Arch Linux, and Android.
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

class PersonalPDFApp {
  constructor() {
    this.currentDocName = 'document.pdf';
    this.currentPdfBytes = null;
    this.organizerCards = [];
    this.wakeLock = new ScreenWakeLockManager();
    this.storage = new StorageEngine();

    this._initEngines();
    this._bindCoreEvents();
    this._bindOrganizerEvents();
    this._bindWatermarkEvents();
    this._setupElectronBridge();
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
      onPageRendered: (pageNum, textLayer) => this._restoreInPlaceEdits(pageNum, textLayer)
    });

    // 2. Organizer Engine
    this.organizer = new PDFOrganizerEngine();

    // 3. Annotator Engine
    this.annotator = new PDFAnnotatorEngine({
      container: viewerContainer,
      onActiveTextBoxChange: (box) => {
        if (this.ui) this.ui.syncActiveTextBox(box);
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
    this.exporter = new PDFExportEngine(this.viewer);

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

    btnOpenFile.onclick = () => fileInput.click();
    btnWelcomeOpen.onclick = () => fileInput.click();

    // Tab close
    const btnTabClose = document.getElementById('btn-tab-close');
    if (btnTabClose) {
      btnTabClose.onclick = async (e) => {
        e.stopPropagation();
        this.currentPdfBytes = null;
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
    };

    btnLoadSample.onclick = () => this.loadSamplePDF();
    btnSavePdf.onclick = () => this.saveDocument();
    if (btnSaveAsPdf) btnSaveAsPdf.onclick = () => this.saveAsDocument();
    btnPrint.onclick = () => this.exporter.printDocument();

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
        const parts = await this.organizer.splitByRanges(this.currentPdfBytes, rangeStr, this.currentDocName.replace('.pdf', ''));
        parts.forEach(p => {
          this.exporter.downloadFile(p.bytes, p.name, 'application/pdf');
        });
        document.getElementById('modal-split').classList.remove('open');
        this.ui.setStatus(`Document split into ${parts.length} files`);
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
          const updated = await this.security.addPageNumbers(this.currentPdfBytes, {
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

    // Global Keyboard Shortcuts (Adobe Acrobat compatible)
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'o' || e.key === 'O') {
          e.preventDefault();
          fileInput.click();
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

    // If already editing this span, re-focus
    if (span.classList.contains('inline-editing')) {
      span.focus();
      return;
    }

    // Save initial text once
    if (span._originalText === undefined) {
      if (typeof healPdfTextLigatures === 'function') {
        span.textContent = healPdfTextLigatures(span.textContent);
      }
      span._originalText = span.textContent;
      const wrapRect = pageWrapper.getBoundingClientRect();
      const sRect = span.getBoundingClientRect();
      const wW = wrapRect.width || 1;
      const wH = wrapRect.height || 1;
      span._normRect = {
        x: Math.max(0, (sRect.left - wrapRect.left) / wW),
        y: Math.max(0, (sRect.top - wrapRect.top) / wH),
        w: Math.min(1, Math.max(0.005, sRect.width / wW)),
        h: Math.min(1, Math.max(0.005, sRect.height / wH))
      };
      span._originalWidth = sRect.width;
      span._originalHeight = sRect.height;
    }

    // Resolve native PDF font family and size with cross-platform fallback stack
    const compStyle = window.getComputedStyle(span);
    const existingFont = span.style.fontFamily || compStyle.fontFamily || '';
    const isMonospace = /mono|courier|consolas|code/i.test(existingFont);
    const isSerif = /serif|times|georgia|cambria/i.test(existingFont);

    const docFonts = Array.from(this.viewer.documentFonts || []);
    const matchingDocFont = docFonts.find(f => {
      const fl = f.toLowerCase();
      if (isMonospace) return fl.includes('consolas') || fl.includes('courier') || fl.includes('mono');
      if (isSerif) return fl.includes('times') || fl.includes('cambria') || fl.includes('serif');
      return fl.includes('calibri') || fl.includes('arial') || fl.includes('sans');
    }) || docFonts[0];

    let fontStack = '';
    if (isMonospace || (matchingDocFont && /consolas|courier|mono/i.test(matchingDocFont))) {
      fontStack = `'Consolas', 'Courier New', 'Liberation Mono', Menlo, Monaco, monospace`;
    } else if (isSerif || (matchingDocFont && /times|cambria|serif/i.test(matchingDocFont))) {
      fontStack = `'Cambria', 'Times New Roman', 'Liberation Serif', Georgia, serif`;
    } else if (matchingDocFont && /calibri/i.test(matchingDocFont)) {
      fontStack = `'Calibri', 'Carlito', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
    } else if (matchingDocFont) {
      fontStack = `'${matchingDocFont}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
    } else {
      fontStack = `'Calibri', 'Carlito', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
    }

    span.style.fontFamily = fontStack;
    span._customFontStack = fontStack;

    // Use dynamic scale factor so zooming maintains exact font size proportion
    const scaleFactor = (this.viewer && this.viewer.scale) || 1;
    const computedFontSizePx = parseFloat(compStyle.fontSize) || 16;
    const baseFontSize = span._baseFontSize || (computedFontSizePx / scaleFactor);
    span._baseFontSize = baseFontSize;
    span.style.fontSize = `calc(var(--scale-factor, 1) * ${baseFontSize.toFixed(2)}px)`;
    span.style.lineHeight = '1';
    span.style.webkitTextSizeAdjust = 'none';
    span.style.textSizeAdjust = 'none';

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

    // Helper to sanitize child HTML injected by Android Gboard/IME (e.g. <font face="Roboto" size="3">)
    const cleanSpanContent = () => {
      if (span.children && span.children.length > 0) {
        const text = (span.innerText || span.textContent || '').replace(/[\r\n]+/g, ' ');
        span.textContent = text;
      }
      span.style.fontFamily = fontStack;
      span.style.fontSize = `calc(var(--scale-factor, 1) * ${baseFontSize.toFixed(2)}px)`;
      span.style.lineHeight = '1';
      span.style.webkitTextSizeAdjust = 'none';
      span.style.textSizeAdjust = 'none';
    };

    // Sync toolbar font, size, bold, italic, color to match native PDF styling
    if (this.ui) {
      this.ui.syncInPlaceSpan(span);
    }

    // Attach listeners on this span if not yet attached
    if (!span._hasDirectEditListeners) {
      span._hasDirectEditListeners = true;

      span.addEventListener('input', () => {
        cleanSpanContent();
        this.annotator.recordInPlaceEdit(span, pageNum, pageWrapper);
      });

      span.addEventListener('keydown', (kEvt) => {
        if (kEvt.key === 'Escape') {
          kEvt.preventDefault();
          this.annotator.revertInPlaceEdit(span, pageNum);
          span.blur();
          this.ui.setStatus('Reverted in-place text edit');
        } else if (kEvt.key === 'Enter' && !kEvt.shiftKey) {
          kEvt.preventDefault();
          span.blur();
        }
      });

      span.addEventListener('blur', () => {
        cleanSpanContent();
        span.contentEditable = 'false';
        span.classList.remove('inline-editing');
        const tLayer = span.closest('.textLayer');
        if (span.textContent !== span._originalText) {
          span.classList.add('in-place-modified');
          if (tLayer) tLayer.classList.add('has-modifications');
          
          if (span._normRect && pageWrapper) {
            span.style.minWidth = `${Math.ceil(span._normRect.w * (pageWrapper.clientWidth || 1))}px`;
          }

          // Directly erase original text pixels from underlying PDF canvas using normalized coordinates
          const pageCanvas = pageWrapper.querySelector('canvas.pdf-canvas, canvas[id^="page-canvas-"]');
          if (pageCanvas && span._normRect) {
            const canvasCtx = pageCanvas.getContext('2d');
            canvasCtx.save();
            canvasCtx.setTransform(1, 0, 0, 1, 0, 0); // Pure canvas buffer pixels
            const normX = span._normRect.x;
            const normY = span._normRect.y;
            const normW = Math.max(span._normRect.w, (span.offsetWidth || 0) / (pageWrapper.clientWidth || 1));
            const normH = Math.max(span._normRect.h, (span.offsetHeight || 0) / (pageWrapper.clientHeight || 1));
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
          this.ui.setStatus('In-place text edit saved');
        } else {
          span.classList.remove('in-place-modified');
          if (tLayer && !tLayer.querySelector('.in-place-modified, .inline-editing')) {
            tLayer.classList.remove('has-modifications');
          }
          this.annotator.revertInPlaceEdit(span, pageNum);
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

  _restoreInPlaceEdits(pageNum, textLayer) {
    if (!this.annotator || !this.annotator.inPlaceEdits) return;
    const pageEdits = this.annotator.inPlaceEdits.get(pageNum);
    if (!pageEdits || pageEdits.size === 0) return;

    textLayer.classList.add('has-modifications');
    const pageWrapper = textLayer.closest('.page-wrapper');
    const pageCanvas = pageWrapper ? pageWrapper.querySelector('canvas.pdf-canvas, canvas[id^="page-canvas-"]') : null;

    const spans = Array.from(textLayer.querySelectorAll('span'));
    for (const [origSpan, edit] of Array.from(pageEdits.entries())) {
      let matchedSpan = null;

      // 1. First try matching by normRect position proximity
      if (edit.normRect && pageWrapper) {
        const wrapW = pageWrapper.clientWidth || 1;
        const wrapH = pageWrapper.clientHeight || 1;
        for (const s of spans) {
          const sLeft = s.offsetLeft / wrapW;
          const sTop = s.offsetTop / wrapH;
          const dist = Math.hypot(sLeft - edit.normRect.x, sTop - edit.normRect.y);
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

        matchedSpan.textContent = edit.newText;
        matchedSpan.classList.add('in-place-modified');
        matchedSpan.style.webkitTextSizeAdjust = 'none';
        matchedSpan.style.textSizeAdjust = 'none';
        matchedSpan.style.lineHeight = '1';

        if (matchedSpan._customFontStack) {
          matchedSpan.style.fontFamily = matchedSpan._customFontStack;
        }
        if (matchedSpan._baseFontSize) {
          matchedSpan.style.fontSize = `calc(var(--scale-factor, 1) * ${matchedSpan._baseFontSize.toFixed(2)}px)`;
        }
        if (matchedSpan._normRect && pageWrapper) {
          matchedSpan.style.minWidth = `${Math.ceil(matchedSpan._normRect.w * (pageWrapper.clientWidth || 1))}px`;
        }

        const normRect = matchedSpan._normRect;
        if (pageCanvas && pageWrapper && normRect) {
          const canvasCtx = pageCanvas.getContext('2d');
          canvasCtx.save();
          canvasCtx.setTransform(1, 0, 0, 1, 0, 0); // Pure canvas buffer pixels
          const normX = normRect.x;
          const normY = normRect.y;
          const normW = Math.max(normRect.w, (matchedSpan.offsetWidth || 0) / (pageWrapper.clientWidth || 1));
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
  }

  addCustomBookmark(title, pageNum) {
    if (!this.customBookmarks) this.customBookmarks = [];
    this.customBookmarks.push({ title, pageNum });
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

  async loadFile(file) {
    this.currentDocName = file.name;
    const arrayBuffer = await file.arrayBuffer();
    await this.loadArrayBuffer(arrayBuffer, file.name);
  }

  async loadArrayBuffer(data, docName = 'document.pdf', persist = true) {
    this.currentDocName = docName;
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
    if (pageInput) pageInput.max = meta.pages;
    if (m3Page) m3Page.textContent = `1 / ${meta.pages}`;
    if (m3Sub) m3Sub.textContent = `${meta.pages} pages • Page 1`;
    document.getElementById('status-size').textContent = `${Math.round(meta.bytes / 1024)} KB`;
    this.ui.setZoomStatus(`${Math.round(this.viewer.scale * 100)}%`);
    if (this.ui && meta.fonts && meta.fonts.length > 0) {
      this.ui.setDocumentFonts(meta.fonts);
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

      page1.drawText('Adobe Acrobat-Grade Cross-Platform Application', {
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
      await this.loadArrayBuffer(pdfBytes, 'Personal_PDF_Suite_Welcome.pdf');
      this.ui.showToast('Sample PDF generated & loaded', 'success');
    } catch (err) {
      console.error('Failed to generate sample PDF:', err);
      alert('Could not generate sample PDF: ' + err.message);
    }
  }

  async saveDocument() {
    if (!this.currentPdfBytes) {
      alert('No document is open to save.');
      return;
    }

    this.ui.setStatus('Compositing annotations and signatures into PDF...');
    try {
      let outputBytes = await this.annotator.burnAnnotationsToPdf(this.currentPdfBytes);
      const saveName = this.currentDocName;
      await this.exporter.downloadFile(outputBytes, saveName, 'application/pdf');
      this.ui.showToast(`Saved: ${saveName}`, 'success');
      this.ui.setStatus(`Saved: ${saveName}`);
    } catch (err) {
      console.error(err);
      this.ui.showToast(`Save error: ${err.message}`, 'error');
      this.ui.setStatus(`Save error: ${err.message}`);
    }
  }

  async saveAsDocument() {
    if (!this.currentPdfBytes) {
      alert('No document is open to save.');
      return;
    }

    const origName = this.currentDocName || 'document.pdf';
    const baseName = origName.replace(/\.pdf$/i, '');
    const defaultName = `${baseName}_copy.pdf`;

    const customName = prompt('Save As - Enter name for new PDF copy:', defaultName);
    if (!customName || !customName.trim()) {
      return; // Cancelled
    }

    let saveName = customName.trim();
    if (!saveName.toLowerCase().endsWith('.pdf')) {
      saveName += '.pdf';
    }

    this.ui.setStatus('Compositing annotations and saving new PDF copy...');
    try {
      let outputBytes = await this.annotator.burnAnnotationsToPdf(this.currentPdfBytes);
      await this.exporter.downloadFile(outputBytes, saveName, 'application/pdf');
      this.ui.showToast(`Saved As: ${saveName}`, 'success');
      this.ui.setStatus(`Saved new copy: ${saveName}`);
    } catch (err) {
      console.error(err);
      this.ui.showToast(`Save As error: ${err.message}`, 'error');
      this.ui.setStatus(`Save As error: ${err.message}`);
    }
  }

  saveAsModifiedPdf() {
    return this.saveAsDocument();
  }

  async _restoreSession() {
    try {
      const saved = await this.storage.getActiveDocument();
      if (saved && saved.bytes && !this.currentPdfBytes) {
        console.log('Restoring previous PDF session:', saved.name);
        await this.loadArrayBuffer(saved.bytes, saved.name, false);
        if (saved.page && saved.page > 1) {
          setTimeout(() => {
            this.viewer.goToPage(saved.page);
          }, 350);
        }
        this.ui.showToast(`Restored document: ${saved.name}`, 'info');
      }
    } catch (err) {
      console.warn('Could not restore session:', err);
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

  openMergeModal() {
    const modal = document.getElementById('modal-merge');
    const mergeInput = document.getElementById('merge-files-input');
    if (mergeInput) mergeInput.value = '';

    this.mergeItems = [];
    if (this.currentPdfBytes) {
      this.mergeItems.push({
        name: this.currentDocName,
        bytes: this.currentPdfBytes,
        size: this.currentPdfBytes.length,
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
      helper.innerHTML = `ℹ️ Current document <strong>${this.mergeItems[0].name}</strong> is loaded. Click <strong>+ Add PDF Files to Combine...</strong> above to select at least 1 more document to combine.`;
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
      left.innerHTML = `<span>📄 <strong>${idx + 1}.</strong> ${item.name}</span>` + 
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
      thumbBox.className = 'organizer-thumb';
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

      // Render thumbnail
      const page = await this.viewer.pdfDoc.getPage(i);
      const vp = page.getViewport({ scale: 0.25 });
      canvas.width = vp.width;
      canvas.height = vp.height;
      page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });

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
    modal.classList.add('open');
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

          footer.querySelector('.btn-del-card').onclick = (e) => {
            e.stopPropagation();
            clone.remove();
            this._renumberOrganizerCards();
          };

          clone.onclick = () => {
            clone.classList.toggle('selected');
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
        const extracted = await this.organizer.extractPages(this.currentPdfBytes, indices);
        this.exporter.downloadFile(extracted, `${this.currentDocName.replace('.pdf', '')}_extracted.pdf`, 'application/pdf');
        this.ui.setStatus('Extracted pages downloaded');
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

          this.ui.setStatus('Applying page changes...');
          const updatedBytes = await this.organizer.reorderAndModifyPages(this.currentPdfBytes, operations);

          // Clear annotations and in-place edits cleanly since page indices have changed
          if (this.annotator) {
            this.annotator.clearAllEdits();
          }

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
          const modified = await this.security.applyWatermark(this.currentPdfBytes, {
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

    // Delete button
    const btnDel = document.createElement('button');
    btnDel.className = 'textbox-delete-btn';
    btnDel.innerHTML = '&times;';
    btnDel.title = 'Remove Image';
    btnDel.onclick = (e) => {
      e.stopPropagation();
      this.annotator.undoStack.push({
        type: 'element',
        pageNum,
        elements: [container]
      });
      container._savedParent = container.parentNode;
      container.remove();
    };
    container.appendChild(btnDel);

    this.annotator._makeDraggable(container, wrapper);
    this.annotator._makeResizable(container, wrapper);
    wrapper.appendChild(container);

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

    // Delete button
    const btnDel = document.createElement('button');
    btnDel.className = 'textbox-delete-btn';
    btnDel.innerHTML = '&times;';
    btnDel.title = 'Remove Signature';
    btnDel.onclick = (e) => {
      e.stopPropagation();
      this.annotator.undoStack.push({
        type: 'element',
        pageNum,
        elements: [container]
      });
      container._savedParent = container.parentNode;
      container.remove();
    };
    container.appendChild(btnDel);

    this.annotator._makeDraggable(container, wrapper);
    this.annotator._makeResizable(container, wrapper);
    wrapper.appendChild(container);

    this.annotator.undoStack.push({
      type: 'element',
      pageNum,
      elements: [container]
    });
    this.annotator.redoStack = [];
  }

  insertWhiteoutOnPage(pageNum, x = 150, y = 150, width = 140, height = 28) {
    const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
    if (!wrapper) return;

    const box = document.createElement('div');
    box.className = 'placed-stamp whiteout-box';
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
    box.style.width = `${width}px`;
    box.style.height = `${height}px`;
    box.style.backgroundColor = '#ffffff';
    box.style.border = '1.5px dashed #3b82f6';
    box.title = 'Whiteout block (drags to cover text)';

    // Delete button
    const btnDel = document.createElement('button');
    btnDel.className = 'tool-btn-sm';
    btnDel.style.position = 'absolute';
    btnDel.style.top = '-8px';
    btnDel.style.right = '-8px';
    btnDel.style.background = '#ef4444';
    btnDel.style.color = '#fff';
    btnDel.style.borderRadius = '50%';
    btnDel.style.width = '18px';
    btnDel.style.height = '18px';
    btnDel.innerHTML = '&times;';
    btnDel.onclick = (e) => {
      e.stopPropagation();
      box.remove();
    };
    box.appendChild(btnDel);

    this.annotator._makeDraggable(box, wrapper);
    this.annotator._makeResizable(box, wrapper);
    wrapper.appendChild(box);

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
    const updated = await this.organizer.insertBlankPage(this.currentPdfBytes, this.viewer.currentPage);
    await this.loadArrayBuffer(updated, this.currentDocName);
    this.ui.setStatus('Blank page inserted');
  }

  async applyPageNumbers() {
    if (!this.currentPdfBytes) return;
    this.ui.setStatus('Adding page numbers...');
    const updated = await this.security.addPageNumbers(this.currentPdfBytes);
    await this.loadArrayBuffer(updated, this.currentDocName);
    this.ui.setStatus('Page numbers added');
  }
}

// Start application when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  window.app = new PersonalPDFApp();
});

