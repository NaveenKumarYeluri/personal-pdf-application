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
    // Do not automatically reopen previously opened document on fresh application startup.
    // Let user open document as and when needed.

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
      if (e.target.closest('.inline-editing, #in-place-floating-bar, .in-place-bar')) {
        return;
      }
      const activeSpan = document.querySelector('.textLayer span.inline-editing');
      if (activeSpan) {
        activeSpan.blur();
        this._hideInPlaceFloatingBar();
      }
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
          if (!res || !res.success) {
            if (res?.cancelled) {
              this.ui.showToast('Split PDF save cancelled', 'info');
              this.ui.setStatus('Split PDF cancelled');
            } else {
              this.ui.showToast(`Split PDF save failed: ${res?.error || 'Files could not be saved'}`, 'error');
              this.ui.setStatus('Split PDF save failed');
            }
            return;
          }

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
      // Handle Escape globally to dismiss open modals, clear active search, or deselect elements
      if (e.key === 'Escape') {
        const openModals = document.querySelectorAll('.modal-backdrop.open');
        if (openModals.length > 0) {
          e.preventDefault();
          openModals.forEach(m => m.classList.remove('open'));
          return;
        }
        if (searchInput && (searchInput.value || this.viewer?.currentSearchQuery)) {
          e.preventDefault();
          blurSearchInput();
          return;
        }
        if (this.annotator) {
          this.annotator._deselectAllElements?.();
          if (this.annotator.activeTextBox) {
            this.annotator.activeTextBox.classList.remove('active');
            this.annotator.activeTextBox = null;
            this.annotator.onActiveTextBoxChange(null);
          }
        }
        return;
      }

      if (
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.isContentEditable ||
        e.target.closest('[contenteditable="true"], .annotation-textbox, .textbox-content')
      ) {
        // Intercept Select All if inside an active in-place editor span so viewport does not jump
        if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A' || e.keyCode === 65)) {
          const activeSpan = e.target.closest('.inline-editing') || document.querySelector('.inline-editing[contenteditable="true"]');
          if (activeSpan) {
            e.preventDefault();
            e.stopPropagation();
            const viewerContainer = document.getElementById('viewer-container');
            const sTop = viewerContainer ? viewerContainer.scrollTop : 0;
            const sLeft = viewerContainer ? viewerContainer.scrollLeft : 0;

            const sel = window.getSelection();
            if (sel) {
              const range = document.createRange();
              range.selectNodeContents(activeSpan);
              sel.removeAllRanges();
              sel.addRange(range);
            }

            if (viewerContainer) {
              viewerContainer.scrollTop = sTop;
              viewerContainer.scrollLeft = sLeft;
            }
            requestAnimationFrame(() => {
              if (viewerContainer) {
                viewerContainer.scrollTop = sTop;
                viewerContainer.scrollLeft = sLeft;
              }
            });
            return;
          }
        }
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
      } else if ((e.key === 'ArrowRight' || e.key === 'PageDown') && !document.body.classList.contains('in-place-editing-active')) {
        this.viewer.goToPage(this.viewer.currentPage + 1);
      } else if ((e.key === 'ArrowLeft' || e.key === 'PageUp') && !document.body.classList.contains('in-place-editing-active')) {
        this.viewer.goToPage(this.viewer.currentPage - 1);
      }
    });

    // Intercept document-level Select All (e.g. from soft keyboard or context bar) while in-place editing
    document.addEventListener('selectall', (e) => {
      const activeSpan = document.querySelector('.inline-editing[contenteditable="true"]');
      if (activeSpan) {
        e.preventDefault();
        e.stopPropagation();
        const viewerContainer = document.getElementById('viewer-container');
        const sTop = viewerContainer ? viewerContainer.scrollTop : 0;
        const sLeft = viewerContainer ? viewerContainer.scrollLeft : 0;

        const sel = window.getSelection();
        if (sel) {
          const range = document.createRange();
          range.selectNodeContents(activeSpan);
          sel.removeAllRanges();
          sel.addRange(range);
        }

        if (viewerContainer) {
          viewerContainer.scrollTop = sTop;
          viewerContainer.scrollLeft = sLeft;
        }
        requestAnimationFrame(() => {
          if (viewerContainer) {
            viewerContainer.scrollTop = sTop;
            viewerContainer.scrollLeft = sLeft;
          }
        });
      }
    });
  }

  /**
   * Sample non-background pixel colors directly from the rendered PDF canvas
   * under a text span to extract the exact native PDF text color.
   * Completely filters out anti-aliasing edge blur (e.g. #e0e0e0) to guarantee
   * high-contrast readability and true native color matching.
   */
  _extractSpanColor(span, pageWrapper) {
    if (!span) return '#000000';
    if (span._originalColor && span._originalColor !== 'transparent' && span._originalColor !== 'rgba(0, 0, 0, 0)') {
      return span._originalColor;
    }
    const pageNum = span._pageNum || (span.closest('.page-wrapper') ? parseInt(span.closest('.page-wrapper').dataset.pageNumber, 10) : null);
    const wrapper = pageWrapper || (pageNum ? document.getElementById(`page-wrapper-${pageNum}`) : null) || span.closest('.page-wrapper');
    if (!wrapper) return '#000000';

    // Prefer pristine snapshot canvas if already captured, to avoid reflow shift/mask artifacts
    const snapshot = pageNum ? this._pageSnapshots.get(pageNum) : null;
    const canvas = (snapshot && snapshot.canvas) || wrapper.querySelector('canvas.pdf-canvas, canvas[id^="page-canvas-"], canvas');
    if (!canvas) return '#000000';

    // If span has a pristine record, use its pristine layout metrics before any reflow shift
    const pristineSpanRec = snapshot?.nativeSpans?.find(item => item.span === span);
    const wrapW = wrapper.clientWidth || 1;
    const wrapH = wrapper.clientHeight || 1;
    const leftNorm = pristineSpanRec ? pristineSpanRec.leftNorm : (span.offsetLeft / wrapW);
    const topNorm = pristineSpanRec ? pristineSpanRec.topNorm : (span.offsetTop / wrapH);
    const widthNorm = pristineSpanRec ? (pristineSpanRec.rightNorm - pristineSpanRec.leftNorm) : (span.offsetWidth / wrapW);
    const heightNorm = pristineSpanRec ? (pristineSpanRec.bottomNorm - pristineSpanRec.topNorm) : (span.offsetHeight / wrapH);

    const x = Math.max(0, Math.floor(leftNorm * canvas.width));
    const y = Math.max(0, Math.floor(topNorm * canvas.height));
    const w = Math.min(canvas.width - x, Math.ceil(widthNorm * canvas.width));
    const h = Math.min(canvas.height - y, Math.ceil(heightNorm * canvas.height));
    if (w <= 0 || h <= 0) return '#000000';

    let ctx;
    try {
      ctx = canvas.getContext('2d', { willReadFrequently: true });
    } catch (_) {
      ctx = canvas.getContext('2d');
    }
    if (!ctx) return '#000000';

    let imgData;
    try {
      imgData = ctx.getImageData(x, y, w, h).data;
    } catch (_) {
      return '#000000';
    }

    const chromaticBins = {};
    let maxChromaticCount = 0;
    let peakChromaticBin = null;

    let minBrightness = 255;
    let maxBrightness = 0;
    let darkPixelCount = 0;
    let lightPixelCount = 0;

    const totalPixels = w * h;
    const step = Math.max(1, Math.floor(totalPixels / 2000)) * 4;

    for (let i = 0; i < imgData.length; i += step) {
      const r = imgData[i];
      const g = imgData[i + 1];
      const b = imgData[i + 2];
      const a = imgData[i + 3];
      if (a < 128) continue;

      const brightness = (r + g + b) / 3;
      const saturation = Math.max(r, g, b) - Math.min(r, g, b);

      if (brightness < minBrightness) minBrightness = brightness;
      if (brightness > maxBrightness) maxBrightness = brightness;
      if (brightness < 110) darkPixelCount++;
      if (brightness > 200) lightPixelCount++;

      // If chromatic / colored text (e.g. blue hyperlink #4472c4, red heading, purple, etc.)
      if (saturation >= 28 && brightness < 225 && brightness > 30) {
        const qr = Math.min(255, Math.round(r / 16) * 16);
        const qg = Math.min(255, Math.round(g / 16) * 16);
        const qb = Math.min(255, Math.round(b / 16) * 16);
        const key = `${qr},${qg},${qb}`;
        const count = (chromaticBins[key] || 0) + 1;
        chromaticBins[key] = count;
        if (count > maxChromaticCount) {
          maxChromaticCount = count;
          peakChromaticBin = { r: qr, g: qg, b: qb };
        }
      }
    }

    // 1. If clear chromatic cluster exists (colored text like blue links), use it
    if (peakChromaticBin && maxChromaticCount >= 3) {
      const toHex = (n) => n.toString(16).padStart(2, '0');
      return `#${toHex(peakChromaticBin.r)}${toHex(peakChromaticBin.g)}${toHex(peakChromaticBin.b)}`;
    }

    // 2. Dark text on light background (standard document): return pure black #000000
    // Anti-aliased transition pixels (e.g. #e0e0e0 / 224,224,224) are completely filtered out.
    if (darkPixelCount >= 2 || minBrightness < 140) {
      return '#000000';
    }

    // 3. Inverted / dark mode page (white text on dark background)
    if (lightPixelCount >= 2 && maxBrightness > 200 && minBrightness < 60) {
      return '#ffffff';
    }

    return '#000000';
  }

  _colorToHex(col) {
    if (!col) return '#000000';
    col = String(col).trim();
    if (col.startsWith('#')) {
      if (col.length === 4) {
        return '#' + col[1] + col[1] + col[2] + col[2] + col[3] + col[3];
      }
      return col.substring(0, 7);
    }
    const match = col.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (match) {
      const r = Math.min(255, Math.max(0, parseInt(match[1], 10))).toString(16).padStart(2, '0');
      const g = Math.min(255, Math.max(0, parseInt(match[2], 10))).toString(16).padStart(2, '0');
      const b = Math.min(255, Math.max(0, parseInt(match[3], 10))).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`;
    }
    return '#000000';
  }

  /**
   * Build a rich, metric-compatible font stack ensuring subpixel typography match.
   */
  _resolveFontStack(detectedFont = '', isMonospace = false, isSerif = false) {
    const fn = (detectedFont || '').toLowerCase();

    if (isMonospace || /consolas|courier|mono|code|inconsolata|jetbrains/i.test(fn)) {
      if (fn.includes('consolas')) {
        return `'Consolas', 'Cousine', 'JetBrains Mono', 'Roboto Mono', 'Courier New', monospace`;
      }
      if (fn.includes('inconsolata')) {
        return `'Inconsolata', 'Consolas', 'Cousine', 'Courier New', monospace`;
      }
      if (fn.includes('jetbrains')) {
        return `'JetBrains Mono', 'Consolas', 'Cousine', 'Courier New', monospace`;
      }
      return `'Consolas', 'Cousine', 'Courier New', 'Roboto Mono', 'Liberation Mono', monospace`;
    }

    if (isSerif || /times|cambria|georgia|garamond|baskerville|merriweather|serif/i.test(fn)) {
      if (fn.includes('cambria')) {
        return `'Cambria', 'Caladea', 'Georgia', 'Times New Roman', 'Tinos', serif`;
      }
      if (fn.includes('times')) {
        return `'Times New Roman', 'Tinos', 'Times', 'Cambria', 'Caladea', Georgia, serif`;
      }
      if (fn.includes('georgia')) {
        return `'Georgia', 'Tinos', 'Times New Roman', 'Cambria', serif`;
      }
      if (fn.includes('garamond')) {
        return `'Garamond', 'EB Garamond', 'Cormorant Garamond', 'Georgia', serif`;
      }
      if (fn.includes('baskerville')) {
        return `'Libre Baskerville', 'Baskerville', 'Georgia', 'Times New Roman', serif`;
      }
      if (fn.includes('merriweather')) {
        return `'Merriweather', 'Georgia', 'Times New Roman', serif`;
      }
      return `'Cambria', 'Caladea', 'Times New Roman', 'Tinos', 'Georgia', serif`;
    }

    // Sans-serif and specific standard typefaces
    if (fn.includes('calibri')) {
      return `'Calibri', 'Carlito', 'Candara', 'Roboto', 'Segoe UI', -apple-system, BlinkMacSystemFont, Arial, sans-serif`;
    }
    if (fn.includes('arial') || fn.includes('helvetica')) {
      return `'Arial', 'Arimo', 'Helvetica Neue', Helvetica, 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
    }
    if (fn.includes('verdana')) {
      return `'Verdana', 'Geneva', 'Roboto', 'Segoe UI', sans-serif`;
    }
    if (fn.includes('tahoma')) {
      return `'Tahoma', 'Verdana', 'Roboto', 'Segoe UI', sans-serif`;
    }
    if (fn.includes('trebuchet')) {
      return `'Trebuchet MS', 'Lucida Sans', 'Roboto', 'Segoe UI', sans-serif`;
    }
    if (fn.includes('segoe')) {
      return `'Segoe UI', 'Inter', 'Roboto', -apple-system, BlinkMacSystemFont, sans-serif`;
    }
    if (fn.includes('roboto')) {
      return `'Roboto', 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif`;
    }
    if (fn.includes('open sans')) {
      return `'Open Sans', 'Roboto', 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif`;
    }
    if (fn.includes('lato')) {
      return `'Lato', 'Roboto', 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif`;
    }
    if (fn.includes('montserrat')) {
      return `'Montserrat', 'Roboto', 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif`;
    }
    if (fn.includes('poppins')) {
      return `'Poppins', 'Roboto', 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif`;
    }
    if (fn.includes('nunito')) {
      return `'Nunito', 'Roboto', 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif`;
    }
    if (fn.includes('source sans')) {
      return `'Source Sans 3', 'Source Sans Pro', 'Roboto', 'Segoe UI', sans-serif`;
    }
    if (fn.includes('inter')) {
      return `'Inter', 'Roboto', 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif`;
    }

    if (detectedFont && !/sans-serif|serif|monospace/i.test(detectedFont)) {
      return `'${detectedFont}', 'Calibri', 'Carlito', 'Roboto', 'Segoe UI', Arial, sans-serif`;
    }

    return `'Calibri', 'Carlito', 'Roboto', 'Segoe UI', Arial, sans-serif`;
  }

  _getEditorText(el) {
    if (!el) return '';
    if (el.innerText !== undefined) {
      return el.innerText;
    }
    const clone = el.cloneNode(true);
    clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    clone.querySelectorAll('div, p').forEach(block => block.append('\n'));
    return clone.textContent || '';
  }

  _extractSpanBaseFontSize(span) {
    if (!span) return 12;
    if (span._baseFontSize && span._baseFontSize > 0) return span._baseFontSize;
    if (span._pdfPtFontSize && span._pdfPtFontSize > 0) return span._pdfPtFontSize;

    const fsStyle = span.style.fontSize || '';
    const calcMatch = fsStyle.match(/calc\([^)]*\*?\s*([\d.]+)\s*px/i);
    if (calcMatch) {
      const val = parseFloat(calcMatch[1]);
      if (val > 0 && val < 60) return val;
    }

    const textLayer = span.closest('.textLayer');
    let scale = 1;
    if (textLayer) {
      const scaleProp = textLayer.style.getPropertyValue('--scale-factor');
      if (scaleProp) {
        scale = parseFloat(scaleProp) || 1;
      }
    }
    if (scale <= 0 && this.viewer?.scale) {
      scale = this.viewer.scale;
    }

    const pxMatch = fsStyle.match(/([\d.]+)\s*px/);
    if (pxMatch) {
      const val = parseFloat(pxMatch[1]);
      if (val > 0) {
        if (scale > 1.05 && val > 16) {
          return val / scale;
        }
        return val;
      }
    }

    const cs = window.getComputedStyle(span);
    const compFs = parseFloat(cs.fontSize) || 16;
    return Math.max(6, compFs / (scale > 0 ? scale : 1));
  }

  _handleDirectContentEdit(editData) {
    const span = editData.span;
    if (!span) return;
    const pageNum = editData.pageNum;
    const pageWrapper = editData.pageWrapper || document.getElementById(`page-wrapper-${pageNum}`);

    // If another span is currently active in-place, commit it cleanly first
    if (this.annotator?.activeInPlaceSpan && this.annotator.activeInPlaceSpan !== span) {
      try {
        this.annotator.activeInPlaceSpan.blur();
      } catch (_) {}
    }

    span._pageNum = pageNum;
    span._pageWrapper = pageWrapper;

    // Snapshot the pristine page before any pixel of it is shifted for reflow.
    if (pageWrapper) this._capturePageSnapshot(pageNum, pageWrapper);

    // If already editing this span, re-focus
    if (span.classList.contains('inline-editing')) {
      span.focus();
      return;
    }

    // Bake any existing reflow shift into style.top and clear transform so span stays visually stationary
    if (span.dataset.reflowShift) {
      const shiftPx = parseFloat(span.dataset.reflowShift) || 0;
      if (shiftPx) {
        const curTop = parseFloat(span.style.top) || span.offsetTop;
        span.style.top = `${curTop + shiftPx}px`;
      }
      span.style.transform = 'none';
      delete span.dataset.reflowShift;
    }

    if (span._fullReflowHtml) {
      span.innerHTML = span._fullReflowHtml;
    } else if (span._fullReflowText) {
      span.textContent = span._fullReflowText;
    }

    // If this span is a dynamic reflow overflow span from a previous page
    if (span.classList.contains('reflow-overflow-span')) {
      if (span._originalText === undefined) {
        span._originalText = this._getEditorText(span) || span.textContent;
        span._originalWidth = span.offsetWidth || (parseFloat(span.style.maxWidth) || 200);
        span._originalHeight = span.offsetHeight || 20;
        const wW = pageWrapper.clientWidth || 1;
        const wH = pageWrapper.clientHeight || 1;
        span._normRect = {
          x: Math.max(0, span.offsetLeft / wW),
          y: Math.max(0, span.offsetTop / wH),
          w: Math.min(1, Math.max(0.005, span._originalWidth / wW)),
          h: Math.min(1, Math.max(0.005, span._originalHeight / wH))
        };
      }
    } else if (span._paragraphMerge || span.classList.contains('in-place-modified')) {
      // Already prepared or modified paragraph: keep existing paragraph merge and bounds
    } else if (span._originalText === undefined) {
      span._originalInlineStyle = span.getAttribute('style') || '';
      const initialStyle = window.getComputedStyle(span);
      const initialFontPx = parseFloat(initialStyle.fontSize) || 16;
      const initialLinePx = parseFloat(initialStyle.lineHeight) || initialFontPx * 1.2;
      span._lineHeightRatio = Math.max(0.9, Math.min(2.5, initialLinePx / initialFontPx));

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
      const baseFs = initialFontPx;
      const descenderPad = Math.max(4, Math.round(baseFs * 0.32));
      span._originalHeight = span.offsetHeight + descenderPad;
      span._normRect.h = Math.min(1, Math.max(0.005, span._originalHeight / wH));

      // Edit the whole paragraph (all runs/lines of the same text block), not
      // just the clicked fragment. Otherwise the rest of the line stays put
      // and the new text is drawn on top of it.
      this._prepareParagraphEdit(span, pageNum, pageWrapper);

      // If not merged into a paragraph (single isolated fragment):
      if (!span._paragraphMerge) {
        span._originalColor = this._extractSpanColor(span, pageWrapper);
        if (typeof healPdfTextLigatures === 'function') {
          span.textContent = healPdfTextLigatures(span.textContent);
        }
        span._originalText = span.textContent;
      }
    }

    // Resolve native PDF font family and size with cross-platform fallback stack
    const compStyle = window.getComputedStyle(span);
    const directFont = span._paragraphMerge?.dominantFontName || span._pdfFontName || '';
    const isDirectMono = /mono|consolas|courier|code|inconsolata/i.test(directFont);
    const isDirectTimes = /times|cambria|georgia|garamond|serif/i.test(directFont) && !/sans/i.test(directFont);
    const isMonospace = isDirectMono || /mono|courier|consolas|code/i.test(compStyle.fontFamily || '');
    const isSerif = isDirectTimes || (/(?<!sans-)serif|times|georgia|cambria|garamond/i.test(compStyle.fontFamily || '') && !/sans/i.test(compStyle.fontFamily || ''));
    const isSansSerif = !isMonospace && !isSerif;

    const docFonts = Array.from(this.viewer?.documentFonts || []);
    const matchingDocFont = (directFont && !/^(?:sans-serif|serif|monospace)$/i.test(directFont))
      ? directFont
      : (docFonts.find(f => {
          const fl = f.toLowerCase();
          if (isMonospace) return fl.includes('consolas') || fl.includes('courier') || fl.includes('mono');
          if (isSerif) return fl.includes('times') || fl.includes('cambria') || fl.includes('georgia') || fl.includes('garamond') || (fl.includes('serif') && !fl.includes('sans'));
          return /sans-serif|calibri|arial|helvetica|verdana|tahoma|trebuchet/i.test(fl) || fl.includes('verdana') || fl.includes('calibri') || fl.includes('arial') || fl.includes('helvetica') || fl.includes('sans');
        }) || directFont || docFonts[0]);

    let fontStack = span._paragraphMerge?.dominantFontStack || this._resolveFontStack(matchingDocFont, isMonospace, isSerif);
    if (!fontStack) {
      fontStack = `'Calibri', 'Carlito', 'Roboto', 'Segoe UI', Arial, sans-serif`;
    }
    span.style.fontFamily = fontStack;
    span._customFontStack = fontStack;

    // Use dominant paragraph weight and style if merged, otherwise span's own
    const isBold = span._pdfIsBold || parseInt(compStyle.fontWeight, 10) >= 600 || /bold/i.test(compStyle.fontWeight);
    span._customFontWeight = isBold ? '700' : '400';
    const fontWeight = span._paragraphMerge?.dominantWeight || span._customFontWeight;
    span.style.fontWeight = fontWeight;

    const fontStyle = span._paragraphMerge?.dominantStyle || (span._pdfIsItalic || compStyle.fontStyle === 'italic' || /italic|oblique/i.test(compStyle.fontStyle) ? 'italic' : 'normal');
    span.style.fontStyle = fontStyle;
    span._customFontStyle = fontStyle;

    const fontColor = span._paragraphMerge?.dominantColor || span._originalColor || '#000000';
    span.style.color = fontColor;
    span._originalColor = fontColor;

    // Extract exact unscaled CSS pixel base size from PDF stream or style
    const baseFontSize = span._baseFontSize || span._paragraphMerge?.dominantBaseFontSize || span._pdfPtFontSize || this._extractSpanBaseFontSize(span) || 12;
    span._baseFontSize = baseFontSize;
    span.style.fontSize = `calc(var(--scale-factor, 1) * ${baseFontSize.toFixed(2)}px)`;
    span.style.lineHeight = String(span._paragraphMerge?.dominantLineHeightRatio || span._lineHeightRatio || 1.2);
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
    span.setAttribute('inputmode', 'text');
    span.setAttribute('tabindex', '0');
    span.style.display = 'inline-block';
    span.classList.add('inline-editing');
    span.style.cursor = 'text';

    document.body.classList.add('in-place-editing-active');
    const textLayer = span.closest('.textLayer');
    if (textLayer) {
      textLayer.classList.add('has-modifications');
      textLayer.classList.add('editing-active');
    }

    span._pageNum = pageNum;
    span._pageWrapper = pageWrapper;

    // Keep the PDF's original typography while editing. Text wraps and the box
    // grows downward; the font size is never shrunk to squeeze text into one line.
    const cleanSpanContent = () => {
      if (span._isComposing) return;
      span.style.fontFamily = span._customFontStack || fontStack;
      span.style.fontWeight = span._customFontWeight || fontWeight;
      span.style.fontStyle = span._customFontStyle || fontStyle;
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
      span.style.color = span._customColor || fontColor;
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

    // Show floating formatting toolbar directly on top of the text block being edited
    this._showInPlaceFloatingBar(span, pageNum, pageWrapper);

    // Place caret at clicked coordinates if available
    span.focus();
    if (editData.clientX !== undefined && editData.clientY !== undefined) {
      let range = null;
      if (document.caretRangeFromPoint) {
        range = document.caretRangeFromPoint(editData.clientX, editData.clientY);
      } else if (document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(editData.clientX, editData.clientY);
        if (pos && pos.offsetNode) {
          range = document.createRange();
          range.setStart(pos.offsetNode, pos.offset);
          range.collapse(true);
        }
      }
      if (range) {
        const isInside = range.startContainer && (span === range.startContainer || span.contains(range.startContainer));
        if (isInside) {
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    }

    // Sync toolbar font, size, bold, italic, color to match native PDF styling
    if (this.ui) {
      this.ui.syncInPlaceSpan(span);
    }

    // Attach listeners on this span if not yet attached
    if (!span._hasDirectEditListeners) {
      span._hasDirectEditListeners = true;

      // Contain touch gestures within the editable paragraph so swiping does not fling the PDF viewer across pages
      span.addEventListener('touchstart', (tEvt) => {
        if (tEvt.touches && tEvt.touches.length === 1) {
          tEvt.stopPropagation();
        }
      }, { passive: true });

      span.addEventListener('touchmove', (tEvt) => {
        if (tEvt.touches && tEvt.touches.length === 1) {
          tEvt.stopPropagation();
        }
      }, { passive: true });

      span.addEventListener('touchend', (tEvt) => {
        if (tEvt.changedTouches && tEvt.changedTouches.length === 1) {
          tEvt.stopPropagation();
        }
      }, { passive: true });

      // Clamp selection strictly within span so swiping to the end of the paragraph never leaks
      // into surrounding textLayer spans, other pages, or top app bar buttons.
      document.addEventListener('selectionchange', () => {
        if (span.classList.contains('inline-editing')) {
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            const insideStart = span === range.startContainer || span.contains(range.startContainer);
            const insideEnd = span === range.endContainer || span.contains(range.endContainer);
            if (insideStart && !insideEnd) {
              try {
                range.setEnd(span, span.childNodes.length);
                sel.removeAllRanges();
                sel.addRange(range);
              } catch (_) {}
            } else if (!insideStart && insideEnd) {
              try {
                range.setStart(span, 0);
                sel.removeAllRanges();
                sel.addRange(range);
              } catch (_) {}
            }
          }
          if (this.ui) {
            this.ui.syncInPlaceSpan(span);
          }
        }
      });

      // Track IME / soft keyboard composition (Gboard on Android) to prevent character corruption
      span._isComposing = false;
      span.addEventListener('compositionstart', () => {
        span._isComposing = true;
      });
      span.addEventListener('compositionend', () => {
        span._isComposing = false;
        span._fullReflowText = this._getEditorText(span);
        span._fullReflowHtml = span.innerHTML;
        this.annotator.recordInPlaceEdit(span, pageNum, pageWrapper);
        this._scheduleReflow(pageNum);
        if (this._activeInPlaceBarUpdate) this._activeInPlaceBarUpdate();
      });

      span.addEventListener('input', (e) => {
        if (span._isComposing || (e && e.isComposing)) {
          return; // Allow soft keyboard composition without resetting DOM
        }
        span._fullReflowText = this._getEditorText(span);
        span._fullReflowHtml = span.innerHTML;
        span._fittingReflowText = null;
        span._overflowReflowText = null;
        this.annotator.recordInPlaceEdit(span, pageNum, pageWrapper);
        this._scheduleReflow(pageNum);
        if (this._activeInPlaceBarUpdate) this._activeInPlaceBarUpdate();
      });

      span.addEventListener('paste', (e) => {
        // Keep pasted text plain so PDF typography and line layout stay intact.
        let text = (e.clipboardData || window.clipboardData)?.getData('text/plain');
        if (text === undefined || text === null) return;
        e.preventDefault();
        text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const textNode = document.createTextNode(text);
          range.insertNode(textNode);
          range.setStartAfter(textNode);
          range.setEndAfter(textNode);
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          span.textContent += text;
        }
        span._fullReflowText = this._getEditorText(span);
        span._fullReflowHtml = span.innerHTML;
        span._fittingReflowText = null;
        span._overflowReflowText = null;
        cleanSpanContent();
        this.annotator.recordInPlaceEdit(span, pageNum, pageWrapper);
        this._reflowEditedPage(pageNum, pageWrapper);
      });

      span.addEventListener('keydown', (kEvt) => {
        if (kEvt.key === 'Escape') {
          kEvt.preventDefault();
          this._hideInPlaceFloatingBar();
          this.annotator.revertInPlaceEdit(span, pageNum);
          document.body.classList.remove('in-place-editing-active');
          const tLayer = span.closest('.textLayer');
          if (tLayer) tLayer.classList.remove('editing-active');
          span.blur();
          this._reflowEditedPage(pageNum, pageWrapper);
          this.ui.setStatus('Reverted in-place text edit');
          return;
        }

        // Intercept Select All (Ctrl+A / Cmd+A) so selection stays strictly inside this span
        // and does NOT leak into other textLayer spans or cause the PDF viewport to jump/scroll randomly.
        if ((kEvt.ctrlKey || kEvt.metaKey) && (kEvt.key === 'a' || kEvt.key === 'A' || kEvt.keyCode === 65)) {
          kEvt.preventDefault();
          kEvt.stopPropagation();
          const viewerContainer = document.getElementById('viewer-container');
          const sTop = viewerContainer ? viewerContainer.scrollTop : 0;
          const sLeft = viewerContainer ? viewerContainer.scrollLeft : 0;

          const sel = window.getSelection();
          if (sel) {
            const range = document.createRange();
            range.selectNodeContents(span);
            sel.removeAllRanges();
            sel.addRange(range);
          }

          if (viewerContainer) {
            viewerContainer.scrollTop = sTop;
            viewerContainer.scrollLeft = sLeft;
          }
          requestAnimationFrame(() => {
            if (viewerContainer) {
              viewerContainer.scrollTop = sTop;
              viewerContainer.scrollLeft = sLeft;
            }
          });
          return;
        }
        // Enter is intentionally left alone: it inserts a paragraph line break and
        // the text box grows instead of shrinking the font or committing the edit.
      });

      span.addEventListener('selectall', (e) => {
        if (!span.classList.contains('inline-editing')) return;
        e.preventDefault();
        e.stopPropagation();
        const viewerContainer = document.getElementById('viewer-container');
        const sTop = viewerContainer ? viewerContainer.scrollTop : 0;
        const sLeft = viewerContainer ? viewerContainer.scrollLeft : 0;

        const sel = window.getSelection();
        if (sel) {
          const range = document.createRange();
          range.selectNodeContents(span);
          sel.removeAllRanges();
          sel.addRange(range);
        }

        if (viewerContainer) {
          viewerContainer.scrollTop = sTop;
          viewerContainer.scrollLeft = sLeft;
        }
        requestAnimationFrame(() => {
          if (viewerContainer) {
            viewerContainer.scrollTop = sTop;
            viewerContainer.scrollLeft = sLeft;
          }
        });
      });

      span.addEventListener('blur', () => {
        this._hideInPlaceFloatingBar();
        span._isComposing = false;
        span._fullReflowText = this._getEditorText(span);
        span._fullReflowHtml = span.innerHTML;
        cleanSpanContent();
        span.contentEditable = 'false';
        span.classList.remove('inline-editing');
        document.body.classList.remove('in-place-editing-active');
        const tLayer = span.closest('.textLayer');
        if (tLayer) tLayer.classList.remove('editing-active');
        const curText = span._fullReflowText !== undefined ? span._fullReflowText : (span.innerText !== undefined ? span.innerText : (span.textContent || ''));
        if (curText !== span._originalText) {
          span.classList.add('in-place-modified');
          if (tLayer) tLayer.classList.add('has-modifications');

          // Keep the same typography and font metrics
          span.style.fontFamily = span._customFontStack || fontStack;
          span.style.fontWeight = span._customFontWeight || (span._pdfIsBold ? '700' : 'normal');
          span.style.fontStyle = span._customFontStyle || (span._pdfIsItalic ? 'italic' : 'normal');
          span.style.fontSize = `calc(var(--scale-factor, 1) * ${baseFontSize.toFixed(2)}px)`;
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
          span.style.color = span._originalColor || '#000000';
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
            const cScaleX = pageCanvas.width / (pageWrapper.clientWidth || 1);
            const cScaleY = pageCanvas.height / (pageWrapper.clientHeight || 1);
            const bX = Math.max(8, Math.round(6 * cScaleX));
            const bTop = Math.max(6, Math.round(5 * cScaleY));
            const bBottom = Math.max(8, Math.round(6 * cScaleY));
            canvasCtx.fillStyle = '#ffffff';
            canvasCtx.fillRect(
              Math.max(0, Math.floor(normX * pageCanvas.width) - bX),
              Math.max(0, Math.floor(normY * pageCanvas.height) - bTop),
              Math.min(pageCanvas.width, Math.ceil(normW * pageCanvas.width) + bX * 2),
              Math.ceil(normH * pageCanvas.height) + bTop + bBottom
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
        let range = null;
        if (document.caretPositionFromPoint) {
          const pos = document.caretPositionFromPoint(editData.clientX, editData.clientY);
          if (pos && pos.offsetNode && (span === pos.offsetNode || span.contains(pos.offsetNode))) {
            range = document.createRange();
            range.setStart(pos.offsetNode, pos.offset);
            range.collapse(true);
          }
        } else if (document.caretRangeFromPoint) {
          const r = document.caretRangeFromPoint(editData.clientX, editData.clientY);
          if (r && r.startContainer && (span === r.startContainer || span.contains(r.startContainer))) {
            range = r;
            range.collapse(true);
          }
        }
        if (range) {
          sel.addRange(range);
          positioned = true;
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
      if (span._mergeHidden) return false;
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
      let line = lines.find(item => Math.abs(item.top - span.offsetTop) <= 6);
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
      line.fontSize = Math.max(line.fontSize, this._extractSpanBaseFontSize(span));
    }
    lines.sort((a, b) => a.top - b.top);
    return lines;
  }

  /**
   * Build both plain text and rich HTML preserving inline formatting runs
   * (e.g. bold keywords, italic phrases, colored links) within the paragraph.
   */
  _buildParagraphContent(groups, pageWrapper, dominant) {
    const escapeHtml = (str) => {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    };

    const joinRuns = (line) => {
      let lineText = '';
      let lineHtml = '';
      let prevRight = null;
      const runs = line.spans.slice().sort((a, b) => a.offsetLeft - b.offsetLeft);

      for (const run of runs) {
        let value = run.textContent || '';
        if (typeof healPdfTextLigatures === 'function') {
          value = healPdfTextLigatures(value);
        }
        if (!value.trim()) continue;

        let needsSpace = false;
        if (lineText && !/\s$/.test(lineText) && !/^\s/.test(value)) {
          const prevChar = lineText.slice(-1);
          const nextChar = value[0];
          const wordish = /[A-Za-z0-9,;:)\]]/.test(prevChar) && /[A-Za-z0-9(\[]/.test(nextChar);
          if (wordish || (prevRight !== null && run.offsetLeft > prevRight + 1.2)) {
            needsSpace = true;
          }
        }
        if (needsSpace) {
          lineText += ' ';
          lineHtml += ' ';
        }

        lineText += value;
        prevRight = run.offsetLeft + run.offsetWidth;

        const cs = window.getComputedStyle(run);
        const runIsBold = run._pdfIsBold || parseInt(cs.fontWeight, 10) >= 600 || /bold/i.test(cs.fontWeight);
        const runIsItalic = run._pdfIsItalic || cs.fontStyle === 'italic' || /italic|oblique/i.test(cs.fontStyle);
        const runColor = this._extractSpanColor(run, pageWrapper) || '#000000';
        const runUnderline = (run.style.textDecoration || cs.textDecoration || '').includes('underline');

        let runInner = escapeHtml(value);
        const diffBold = Boolean(dominant) && (Boolean(runIsBold) !== Boolean(dominant.isBold));
        const diffItalic = Boolean(dominant) && (Boolean(runIsItalic) !== Boolean(dominant.isItalic));
        const diffColor = Boolean(dominant) && Boolean(dominant.color) && (runColor.toLowerCase() !== dominant.color.toLowerCase());

        if (diffBold) {
          runInner = `<strong style="font-weight: ${runIsBold ? '700' : '400'};">${runInner}</strong>`;
        }
        if (diffItalic) {
          runInner = `<em style="font-style: ${runIsItalic ? 'italic' : 'normal'};">${runInner}</em>`;
        }
        if (diffColor) {
          runInner = `<span style="color: ${runColor};">${runInner}</span>`;
        }
        if (runUnderline) {
          runInner = `<u>${runInner}</u>`;
        }

        lineHtml += runInner;
      }
      return { lineText: lineText.trim(), lineHtml: lineHtml.trim() };
    };

    let paragraphText = '';
    let paragraphHtml = '';
    for (const line of groups) {
      const { lineText, lineHtml } = joinRuns(line);
      if (!lineText) continue;
      if (paragraphText) {
        const joiner = /[-–—]$/.test(paragraphText) ? '' : ' ';
        paragraphText += joiner + lineText;
        paragraphHtml += joiner + lineHtml;
      } else {
        paragraphText = lineText;
        paragraphHtml = lineHtml;
      }
    }
    return { paragraphText, paragraphHtml };
  }

  /** Join a paragraph's runs/lines into one re-wrappable string. */
  _buildParagraphText(groups) {
    return this._buildParagraphContent(groups, null, { isBold: false, isItalic: false, color: '#000000' }).paragraphText;
  }

  /**
   * Turn the clicked text fragment into an editor for its whole paragraph so
   * line fragments and overprints cannot be left behind.
   * Accurately distinguishes separate small paragraphs, lists, and headings,
   * while preserving dominant paragraph styling and inline formatting.
   */
  _prepareParagraphEdit(span, pageNum, pageWrapper) {
    const lines = this._collectTextLines(pageWrapper);
    const clickedIndex = lines.findIndex(line => line.spans.includes(span));
    if (clickedIndex < 0) return;

    const clicked = lines[clickedIndex];
    const baseFont = this._extractSpanBaseFontSize(span) || clicked.fontSize || 12;
    const scaleFactor = (this.viewer && this.viewer.scale) || 1;
    const actualLineHeight = clicked.height || (baseFont ? baseFont * scaleFactor * 1.2 : 16);

    // Calculate maximum visual line length on this page for detecting terminal paragraph lines
    const maxLineWidth = lines.reduce((max, l) => Math.max(max, l.right - l.left), 0);

    // Calculate median body font size across all lines on the page with text
    const bodyFontSizes = lines
      .filter(l => l.spans.some(s => (s.textContent || '').trim().length > 10))
      .map(l => l.fontSize || 16)
      .sort((a, b) => a - b);
    const medianBodyFontSize = bodyFontSizes.length
      ? bodyFontSizes[Math.floor(bodyFontSizes.length / 2)]
      : baseFont;

    const isContinuation = (prev, next) => {
      const prevText = (prev.spans.map(s => s.textContent || '').join(' ')).trim();
      const nextText = (next.spans.map(s => s.textContent || '').join(' ')).trim();
      if (!prevText || !nextText) return false;

      // 1. Strict vertical spacing (leading)
      const gap = next.top - prev.bottom;
      const maxLeading = Math.max(18, actualLineHeight * 1.35);
      if (gap < -6 || gap > maxLeading) {
        return false;
      }

      // 2. Colon endings: headings / labels (e.g. "Heap Table:", "Physical Implementation:")
      if ((prevText.length < 50 && prevText.endsWith(':')) || nextText.endsWith(':')) {
        return false;
      }

      // 3. Bullet points and numbered lists
      const listMarkerRegex = /^[\s]*(?:[•\-\*▪▫►▸–—]|\d+[\.\)]|\([0-9a-zA-Z]+\)|[a-zA-Z][\.\)])\s/;
      if (listMarkerRegex.test(nextText)) {
        return false;
      }
      if (listMarkerRegex.test(prevText) && /[.!?:]$/.test(prevText)) {
        return false;
      }

      // 4. Terminal punctuation on short lines
      const prevLineWidth = prev.right - prev.left;
      const isTerminalPunct = /[.!?]["']?$/.test(prevText);
      if (isTerminalPunct) {
        if (maxLineWidth > 100 && prevLineWidth < maxLineWidth * 0.78 && gap > 4) {
          return false;
        }
      }

      // 5. Font size check
      const prevFs = prev.fontSize || baseFont;
      const nextFs = next.fontSize || baseFont;
      if (Math.abs(nextFs - prevFs) > 1.2 || Math.abs(nextFs - baseFont) > 1.2 || Math.abs(prevFs - baseFont) > 1.2) {
        return false;
      }
      if (medianBodyFontSize && (prevFs >= medianBodyFontSize * 1.15 || nextFs >= medianBodyFontSize * 1.15)) {
        return false;
      }

      // 6. Full-line font weight check (headings vs body text)
      const isLineBold = (line) => {
        let boldCount = 0;
        let totalCount = 0;
        for (const s of line.spans) {
          const t = (s.textContent || '').trim();
          if (!t) continue;
          totalCount += t.length;
          const fw = window.getComputedStyle(s).fontWeight;
          if (s._pdfIsBold || parseInt(fw, 10) >= 600 || /bold/i.test(fw)) {
            boldCount += t.length;
          }
        }
        return totalCount > 0 && (boldCount / totalCount) >= 0.75;
      };
      if (isLineBold(prev) !== isLineBold(next)) {
        return false;
      }

      // 7. Monospace / code block mismatch
      const isLineMono = (line) => {
        return line.spans.some(s => {
          const fn = (s._pdfFontName || window.getComputedStyle(s).fontFamily || '').toLowerCase();
          return /mono|consolas|courier|code|inconsolata/i.test(fn);
        });
      };
      if (isLineMono(prev) !== isLineMono(next)) {
        return false;
      }

      // 8. Horizontal left alignment
      if (Math.abs(next.left - prev.left) > 28 || Math.abs(next.left - clicked.left) > 28) {
        return false;
      }

      return true;
    };

    let start = clickedIndex;
    let end = clickedIndex;
    while (start > 0 && isContinuation(lines[start - 1], lines[start])) start -= 1;
    while (end < lines.length - 1 && isContinuation(lines[end], lines[end + 1])) end += 1;

    const groups = lines.slice(start, end + 1);
    const allSpans = groups.flatMap(line => line.spans);
    const totalSpans = allSpans.length;
    if (totalSpans <= 1) return; // Single fragment: keep the light editor.

    const left = Math.min(...groups.map(line => line.left));
    const right = Math.max(...groups.map(line => line.right));
    const top = Math.min(...groups.map(line => line.top));
    const rawBottom = Math.max(...groups.map(line => line.bottom));
    const maxLineFs = Math.max(...groups.map(line => line.fontSize || baseFont || 12));
    const descenderExt = Math.max(5, Math.round(maxLineFs * 0.35));
    const bottom = rawBottom + descenderExt;
    const wrapW = pageWrapper.clientWidth || 1;
    const wrapH = pageWrapper.clientHeight || 1;
    const widthPx = Math.max(40, Math.min(right - left + 14, wrapW - left - 6));

    // Keep the document's real leading
    const steps = [];
    for (let i = 1; i < groups.length; i++) {
      const step = groups[i].top - groups[i - 1].top;
      if (step > 0) steps.push(step);
    }
    let dominantLineHeightRatio = 1.2;
    if (steps.length && baseFont > 0) {
      steps.sort((a, b) => a - b);
      const medStep = steps[Math.floor(steps.length / 2)];
      const scaledBaseFont = baseFont * (scaleFactor > 0 ? scaleFactor : 1);
      dominantLineHeightRatio = Math.max(0.9, Math.min(2.5, medStep / scaledBaseFont));
    }
    span._lineHeightRatio = dominantLineHeightRatio;

    // Calculate dominant typography across all spans in this paragraph
    let totalChars = 0;
    let boldChars = 0;
    let italicChars = 0;
    const colorCharCounts = {};
    const fontCharCounts = {};

    allSpans.forEach(s => {
      const txt = (s.textContent || '').trim();
      const len = txt.length;
      if (len === 0) return;
      totalChars += len;

      const cs = window.getComputedStyle(s);
      const isBold = s._pdfIsBold || parseInt(cs.fontWeight, 10) >= 600 || /bold/i.test(cs.fontWeight);
      if (isBold) boldChars += len;

      const isItalic = s._pdfIsItalic || cs.fontStyle === 'italic' || /italic|oblique/i.test(cs.fontStyle);
      if (isItalic) italicChars += len;

      const color = this._extractSpanColor(s, pageWrapper) || '#000000';
      colorCharCounts[color] = (colorCharCounts[color] || 0) + len;

      const fontName = s._pdfFontName || cs.fontFamily || '';
      if (fontName) {
        fontCharCounts[fontName] = (fontCharCounts[fontName] || 0) + len;
      }
    });

    const dominantIsBold = totalChars > 0 ? (boldChars / totalChars) >= 0.5 : false;
    const dominantWeight = dominantIsBold ? '700' : '400';

    const dominantIsItalic = totalChars > 0 ? (italicChars / totalChars) >= 0.5 : false;
    const dominantStyle = dominantIsItalic ? 'italic' : 'normal';

    let dominantColor = '#000000';
    let maxColorCount = 0;
    for (const [col, count] of Object.entries(colorCharCounts)) {
      if (count > maxColorCount) {
        maxColorCount = count;
        dominantColor = col;
      }
    }

    let dominantFontName = span._pdfFontName || '';
    let maxFontCount = 0;
    for (const [fn, count] of Object.entries(fontCharCounts)) {
      if (count > maxFontCount) {
        maxFontCount = count;
        dominantFontName = fn;
      }
    }

    const isMono = /mono|consolas|courier|code|inconsolata/i.test(dominantFontName);
    const isSerif = /times|cambria|georgia|garamond|serif/i.test(dominantFontName) && !/sans/i.test(dominantFontName);
    const dominantFontStack = this._resolveFontStack(dominantFontName, isMono, isSerif);

    const rect = {
      x: left / wrapW,
      y: top / wrapH,
      w: widthPx / wrapW,
      h: Math.max(0.005, (bottom - top) / wrapH)
    };

    const dominantObj = {
      isBold: dominantIsBold,
      isItalic: dominantIsItalic,
      color: dominantColor
    };

    const { paragraphText, paragraphHtml } = this._buildParagraphContent(groups, pageWrapper, dominantObj);

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
        el._mergedInto = span;
        el.style.setProperty('visibility', 'hidden', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
        hidden.push(entry);
      });
    });

    span._matchRect = { ...span._normRect };
    span._normRect = rect;
    span._originalWidth = widthPx;
    span._originalHeight = bottom - top;
    span._originalFragmentText = span.textContent;
    span._originalFragmentHtml = span.innerHTML;
    span._paragraphMerge = {
      rect,
      widthPx,
      hidden,
      paragraphText,
      paragraphHtml,
      dominantWeight,
      dominantStyle,
      dominantColor,
      dominantFontName,
      dominantFontStack,
      dominantBaseFontSize: baseFont,
      dominantLineHeightRatio
    };

    span._fullReflowText = paragraphText;
    span._fullReflowHtml = paragraphHtml;
    span._originalText = paragraphText;
    span._originalColor = dominantColor;
    span._customFontWeight = dominantWeight;
    span._customFontStyle = dominantStyle;
    span._customFontStack = dominantFontStack;

    span.innerHTML = paragraphHtml;
    span.style.left = `${left.toFixed(2)}px`;
    span.style.top = `${top.toFixed(2)}px`;
    span.style.width = `${Math.floor(widthPx)}px`;
    span.style.maxWidth = `${Math.floor(widthPx)}px`;
    span.style.fontWeight = dominantWeight;
    span.style.fontStyle = dominantStyle;
    span.style.color = dominantColor;
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
    span._paragraphMerge = {
      rect,
      widthPx,
      hidden,
      paragraphText: edit.newText || span.textContent,
      paragraphHtml: edit.htmlContent || span.innerHTML,
      dominantWeight: edit.fontWeight || span.style.fontWeight,
      dominantStyle: edit.fontStyle || span.style.fontStyle,
      dominantColor: edit.color || span.style.color,
      dominantFontName: edit.fontFamily || span.style.fontFamily,
      dominantFontStack: edit.fontFamily || span.style.fontFamily,
      dominantBaseFontSize: edit.baseFontSize || span._baseFontSize,
      dominantLineHeightRatio: edit.lineHeightRatio || span._lineHeightRatio
    };
    if (edit.htmlContent) {
      span.innerHTML = edit.htmlContent;
    } else {
      span.textContent = edit.newText || span.textContent;
    }
    if (edit.fontWeight) {
      span.style.fontWeight = edit.fontWeight;
      span._customFontWeight = edit.fontWeight;
    }
    if (edit.fontStyle) {
      span.style.fontStyle = edit.fontStyle;
      span._customFontStyle = edit.fontStyle;
    }
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

      // 1. First try matching by the clicked fragment's position proximity (relaxed for multi-line paragraphs).
      if (matchRect && pageWrapper) {
        const wrapW = pageWrapper.clientWidth || 1;
        const wrapH = pageWrapper.clientHeight || 1;
        for (const s of spans) {
          const sLeft = s.offsetLeft / wrapW;
          const sTop = s.offsetTop / wrapH;
          const dist = Math.hypot(sLeft - matchRect.x, sTop - matchRect.y);
          const st = (s.textContent || '').trim();
          if (dist < 0.08 && (
            !edit.originalText ||
            s.textContent === edit.originalText ||
            s.textContent === edit.originalFragmentText ||
            (edit.originalText && edit.originalText.includes(st)) ||
            (edit.originalFragmentText && edit.originalFragmentText.includes(st)) ||
            (st && edit.originalText.includes(st))
          )) {
            matchedSpan = s;
            break;
          }
        }
      }

      // 2. Fallback to text match
      if (!matchedSpan) {
        matchedSpan = spans.find(s => {
          const st = (s.textContent || '').trim();
          if (!st) return false;
          return s.textContent === edit.originalText ||
            s.textContent === edit.originalFragmentText ||
            (edit.originalText && edit.originalText.includes(st)) ||
            (edit.originalFragmentText && edit.originalFragmentText.includes(st));
        });
      }

      // 3. Fallback: if origSpan is already in this page's DOM, keep it!
      if (!matchedSpan && origSpan && (pageWrapper.contains(origSpan) || document.body.contains(origSpan))) {
        matchedSpan = origSpan;
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

        if (edit.htmlContent !== undefined && edit.htmlContent !== null) {
          matchedSpan.innerHTML = edit.htmlContent;
        } else {
          matchedSpan.textContent = edit.newText !== undefined ? edit.newText : '';
        }
        matchedSpan._fullReflowText = edit.newText !== undefined ? edit.newText : (matchedSpan.textContent || '');
        matchedSpan._fullReflowHtml = edit.htmlContent !== undefined ? edit.htmlContent : matchedSpan.innerHTML;
        if (edit.fontWeight) {
          matchedSpan.style.fontWeight = edit.fontWeight;
          matchedSpan._customFontWeight = edit.fontWeight;
        }
        if (edit.fontStyle) {
          matchedSpan.style.fontStyle = edit.fontStyle;
          matchedSpan._customFontStyle = edit.fontStyle;
        }
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
          const cScaleX = pageCanvas.width / (pageWrapper.clientWidth || 1);
          const cScaleY = pageCanvas.height / (pageWrapper.clientHeight || 1);
          const bX = Math.max(8, Math.round(6 * cScaleX));
          const bTop = Math.max(6, Math.round(5 * cScaleY));
          const bBottom = Math.max(8, Math.round(6 * cScaleY));
          canvasCtx.fillStyle = '#ffffff';
          canvasCtx.fillRect(
            Math.max(0, Math.floor(normX * pageCanvas.width) - bX),
            Math.max(0, Math.floor(normY * pageCanvas.height) - bTop),
            Math.min(pageCanvas.width, Math.ceil(normW * pageCanvas.width) + bX * 2),
            Math.ceil(normH * pageCanvas.height) + bTop + bBottom
          );
          canvasCtx.restore();
        }

        if (origSpan !== matchedSpan) {
          pageEdits.delete(origSpan);
          pageEdits.set(matchedSpan, edit);
        }
      }
    }

    // Re-apply canvas reflow after the text layer has been rebuilt.
    this._reflowEditedPage(pageNum, pageWrapper);
  }

  _showInPlaceFloatingBar(span, pageNum, pageWrapper) {
    let bar = document.getElementById('in-place-floating-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'in-place-floating-bar';
      bar.className = 'element-floating-bar in-place-bar';
      document.body.appendChild(bar);

      // Prevent mousedown on the toolbar buttons from blurring the active editable text block!
      bar.addEventListener('mousedown', (e) => {
        if (e.target.tagName !== 'SELECT' && e.target.tagName !== 'INPUT') {
          e.preventDefault();
        }
        e.stopPropagation();
      });
      bar.addEventListener('pointerdown', (e) => e.stopPropagation());
      bar.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

      window.addEventListener('scroll', () => { if (this._activeInPlaceBarUpdate) this._activeInPlaceBarUpdate(); }, { passive: true });
      window.addEventListener('resize', () => { if (this._activeInPlaceBarUpdate) this._activeInPlaceBarUpdate(); }, { passive: true });

      const vContainer = document.getElementById('viewer-container');
      if (vContainer && !vContainer._hasInPlaceBarScrollListener) {
        vContainer._hasInPlaceBarScrollListener = true;
        vContainer.addEventListener('scroll', () => {
          if (this._activeInPlaceBarUpdate) this._activeInPlaceBarUpdate();
        }, { passive: true });
      }
    }

    const standardFonts = [
      { name: 'Calibri', value: "'Calibri', 'Carlito', sans-serif" },
      { name: 'Arial', value: "Arial, sans-serif" },
      { name: 'Verdana', value: "'Verdana', sans-serif" },
      { name: 'Tahoma', value: "'Tahoma', sans-serif" },
      { name: 'Trebuchet MS', value: "'Trebuchet MS', sans-serif" },
      { name: 'Times New Roman', value: "'Times New Roman', serif" },
      { name: 'Georgia', value: "Georgia, serif" },
      { name: 'Garamond', value: "'Garamond', serif" },
      { name: 'Cambria', value: "'Cambria', serif" },
      { name: 'Courier New', value: "'Courier New', monospace" },
      { name: 'Consolas', value: "'Consolas', monospace" },
      { name: 'Segoe UI', value: "'Segoe UI', sans-serif" },
      { name: 'Roboto', value: "'Roboto', sans-serif" },
      { name: 'Helvetica', value: "'Helvetica Neue', Helvetica, sans-serif" },
      { name: 'Palatino', value: "'Palatino Linotype', 'Palatino', serif" },
      { name: 'Comic Sans MS', value: "'Comic Sans MS', cursive" },
      { name: 'Impact', value: "Impact, sans-serif" }
    ];

    const allFontList = [...standardFonts];
    if (this.viewer?.documentFonts) {
      this.viewer.documentFonts.forEach(df => {
        if (!allFontList.some(f => f.name.toLowerCase() === df.toLowerCase())) {
          allFontList.unshift({ name: df, value: `'${df}', sans-serif` });
        }
      });
    }

    const curFont = (span.style.fontFamily || span._customFontStack || '').toLowerCase();
    const curColor = this._colorToHex(span.style.color || span._customColor || span._originalColor || '#000000');

    bar.innerHTML = `
      <select class="element-bar-select in-place-font" title="Font Family">
        ${allFontList.map(f => `<option value="${f.value}">${f.name}</option>`).join('')}
      </select>
      <select class="element-bar-select in-place-size" title="Font Size">
        <option value="9">9</option>
        <option value="10">10</option>
        <option value="11">11</option>
        <option value="12">12</option>
        <option value="14">14</option>
        <option value="16">16</option>
        <option value="18">18</option>
        <option value="20">20</option>
        <option value="24">24</option>
        <option value="28">28</option>
        <option value="36">36</option>
      </select>
      <span class="element-bar-sep"></span>
      <button class="element-bar-btn in-place-btn-bold" title="Bold (Ctrl+B)"><b>B</b></button>
      <button class="element-bar-btn in-place-btn-italic" title="Italic (Ctrl+I)"><i>I</i></button>
      <button class="element-bar-btn in-place-btn-underline" title="Underline (Ctrl+U)"><u>U</u></button>
      <button class="element-bar-btn in-place-btn-strike" title="Strikethrough"><s>S</s></button>
      <span class="element-bar-sep"></span>
      <input type="color" class="element-bar-color in-place-color" title="Text Color" value="${curColor}">
      <span class="element-bar-sep"></span>
      <button class="element-bar-btn in-place-btn-done" title="Done Editing (Save)" style="color:#22c55e; font-weight:700;">✓</button>
    `;

    const selFont = bar.querySelector('.in-place-font');
    const selSize = bar.querySelector('.in-place-size');
    const btnBold = bar.querySelector('.in-place-btn-bold');
    const btnItalic = bar.querySelector('.in-place-btn-italic');
    const btnUnder = bar.querySelector('.in-place-btn-underline');
    const btnStrike = bar.querySelector('.in-place-btn-strike');
    const inputColor = bar.querySelector('.in-place-color');
    const btnDone = bar.querySelector('.in-place-btn-done');

    // Auto-select the matching font in selFont
    let fontMatched = false;
    for (const opt of selFont.options) {
      const optName = opt.textContent.toLowerCase();
      const optVal = opt.value.toLowerCase();
      if (curFont.includes(optName) || curFont.includes(optVal.split(',')[0].replace(/['"]/g, '').trim().toLowerCase())) {
        selFont.value = opt.value;
        fontMatched = true;
        break;
      }
    }
    if (!fontMatched && span.style.fontFamily) {
      const firstFont = span.style.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
      if (firstFont) {
        const customOpt = document.createElement('option');
        customOpt.value = span.style.fontFamily;
        customOpt.textContent = firstFont;
        customOpt.selected = true;
        selFont.prepend(customOpt);
      }
    }

    let savedRange = null;

    const captureRange = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const r = sel.getRangeAt(0);
        if (span.contains(r.commonAncestorContainer) || span === r.commonAncestorContainer) {
          savedRange = r.cloneRange();
        }
      }
    };

    const restoreRange = () => {
      span.focus();
      if (savedRange) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedRange);
        return true;
      }
      return false;
    };

    const hasSpecificSelection = () => {
      return Boolean(savedRange && !savedRange.collapsed && savedRange.toString().length > 0);
    };

    const isAllSelected = () => {
      if (!savedRange || savedRange.collapsed) return false;
      const full = (span.textContent || '').trim();
      const selText = savedRange.toString().trim();
      return full.length > 0 && selText.length > 0 && selText === full;
    };

    // Ensure we capture selection whenever selection changes or user begins clicking on toolbar
    bar.addEventListener('mousedown', () => captureRange());
    bar.addEventListener('touchstart', () => captureRange(), { passive: true });

    const syncToolbarState = () => {
      captureRange();
      const sel = window.getSelection();
      const node = (sel && sel.anchorNode) ? (sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentNode : sel.anchorNode) : span;
      const target = (node && span.contains(node)) ? node : span;
      const tcs = window.getComputedStyle(target);
      btnBold.classList.toggle('active', document.queryCommandState('bold') || tcs.fontWeight === 'bold' || parseInt(tcs.fontWeight, 10) >= 600);
      btnItalic.classList.toggle('active', document.queryCommandState('italic') || tcs.fontStyle === 'italic');
      btnUnder.classList.toggle('active', document.queryCommandState('underline') || (tcs.textDecoration || '').includes('underline'));
      btnStrike.classList.toggle('active', document.queryCommandState('strikeThrough') || (tcs.textDecoration || '').includes('line-through'));
      const fs = Math.round(parseFloat(tcs.fontSize) || 16);
      if (selSize.querySelector(`option[value="${fs}"]`)) {
        selSize.value = String(fs);
      }
      const targetColor = target.style.color || tcs.color || curColor;
      inputColor.value = this._colorToHex(targetColor);
      const targetFont = (target.style.fontFamily || tcs.fontFamily || curFont).toLowerCase();
      for (const opt of selFont.options) {
        if (targetFont.includes(opt.textContent.toLowerCase())) {
          selFont.value = opt.value;
          break;
        }
      }
    };
    syncToolbarState();

    btnBold.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      restoreRange();
      document.execCommand('bold', false, null);
      if (isAllSelected() || !hasSpecificSelection()) {
        const curW = span.style.fontWeight;
        const willBold = !(curW === 'bold' || curW === '700' || parseInt(curW, 10) >= 600);
        span.style.fontWeight = willBold ? '700' : 'normal';
        span._customFontWeight = span.style.fontWeight;
      }
      span._fullReflowText = this._getEditorText(span);
      span._fullReflowHtml = span.innerHTML;
      this.annotator.recordInPlaceEdit(span, pageNum, pageWrapper);
      btnBold.classList.toggle('active', document.queryCommandState('bold'));
      captureRange();
      span.focus();
    };

    btnItalic.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      restoreRange();
      document.execCommand('italic', false, null);
      if (isAllSelected() || !hasSpecificSelection()) {
        const willItalic = span.style.fontStyle !== 'italic';
        span.style.fontStyle = willItalic ? 'italic' : 'normal';
        span._customFontStyle = span.style.fontStyle;
      }
      span._fullReflowText = this._getEditorText(span);
      span._fullReflowHtml = span.innerHTML;
      this.annotator.recordInPlaceEdit(span, pageNum, pageWrapper);
      btnItalic.classList.toggle('active', document.queryCommandState('italic'));
      captureRange();
      span.focus();
    };

    btnUnder.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      restoreRange();
      document.execCommand('underline', false, null);
      if (isAllSelected() || !hasSpecificSelection()) {
        const cur = span.style.textDecoration || '';
        span.style.textDecoration = cur.includes('underline') ? cur.replace(/underline/g, '').trim() : `${cur} underline`.trim();
      }
      span._fullReflowText = this._getEditorText(span);
      span._fullReflowHtml = span.innerHTML;
      this.annotator.recordInPlaceEdit(span, pageNum, pageWrapper);
      btnUnder.classList.toggle('active', document.queryCommandState('underline'));
      captureRange();
      span.focus();
    };

    btnStrike.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      restoreRange();
      document.execCommand('strikeThrough', false, null);
      if (isAllSelected() || !hasSpecificSelection()) {
        const cur = span.style.textDecoration || '';
        span.style.textDecoration = cur.includes('line-through') ? cur.replace(/line-through/g, '').trim() : `${cur} line-through`.trim();
      }
      span._fullReflowText = this._getEditorText(span);
      span._fullReflowHtml = span.innerHTML;
      this.annotator.recordInPlaceEdit(span, pageNum, pageWrapper);
      btnStrike.classList.toggle('active', document.queryCommandState('strikeThrough'));
      captureRange();
      span.focus();
    };

    selFont.onchange = (e) => {
      const fontVal = selFont.value;
      if (hasSpecificSelection() && !isAllSelected()) {
        restoreRange();
        document.execCommand('fontName', false, fontVal);
        span.querySelectorAll('font[face]').forEach(fEl => {
          fEl.style.fontFamily = fEl.getAttribute('face');
          fEl.removeAttribute('face');
        });
      } else {
        span.style.fontFamily = fontVal;
        span._customFontStack = fontVal;
        restoreRange();
        document.execCommand('fontName', false, fontVal);
      }
      span._fullReflowText = this._getEditorText(span);
      span._fullReflowHtml = span.innerHTML;
      this.annotator.recordInPlaceEdit(span, pageNum, pageWrapper);
      this._scheduleReflow(pageNum);
      captureRange();
      span.focus();
    };

    selSize.onchange = (e) => {
      const val = parseFloat(selSize.value);
      if (val > 0) {
        if (hasSpecificSelection() && !isAllSelected()) {
          restoreRange();
          document.execCommand('fontSize', false, '7');
          span.querySelectorAll('font[size="7"]').forEach(fEl => {
            fEl.removeAttribute('size');
            fEl.style.fontSize = `${val}px`;
            fEl.style.lineHeight = '1.2';
          });
        } else {
          span.style.fontSize = `${val}px`;
          span._baseFontSize = val;
          span.querySelectorAll('*').forEach(child => {
            child.style.fontSize = '';
          });
        }
        span._fullReflowText = this._getEditorText(span);
        span._fullReflowHtml = span.innerHTML;
        this.annotator.recordInPlaceEdit(span, pageNum, pageWrapper);
        this._scheduleReflow(pageNum);
      }
      captureRange();
      span.focus();
    };

    inputColor.oninput = (e) => {
      const colorVal = inputColor.value;
      if (hasSpecificSelection() && !isAllSelected()) {
        restoreRange();
        document.execCommand('foreColor', false, colorVal);
        span.querySelectorAll('font[color]').forEach(fEl => {
          fEl.style.color = fEl.getAttribute('color');
          fEl.removeAttribute('color');
        });
      } else {
        span.style.color = colorVal;
        span._customColor = colorVal;
        restoreRange();
        document.execCommand('foreColor', false, colorVal);
      }
      span._fullReflowText = this._getEditorText(span);
      span._fullReflowHtml = span.innerHTML;
      this.annotator.recordInPlaceEdit(span, pageNum, pageWrapper);
      captureRange();
      span.focus();
    };

    btnDone.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      span.blur();
    };

    const updatePos = () => {
      if (!span.isConnected || !span.classList.contains('inline-editing') || !document.body.classList.contains('in-place-editing-active')) {
        bar.style.display = 'none';
        return;
      }
      bar.style.display = 'flex';
      if (window.innerWidth <= 768) {
        bar.style.position = 'fixed';
        bar.style.top = '68px';
        bar.style.left = '50%';
        bar.style.transform = 'translateX(-50%)';
        bar.style.maxWidth = 'calc(100vw - 12px)';
        bar.style.zIndex = '9999';
      } else {
        const r = span.getBoundingClientRect();
        const top = r.top < 64 ? (r.bottom + 8) : (r.top - 46);
        bar.style.position = 'fixed';
        bar.style.top = `${Math.round(top)}px`;
        const barW = bar.offsetWidth || 340;
        const left = Math.max(barW / 2 + 8, Math.min(window.innerWidth - barW / 2 - 8, r.left + r.width / 2));
        bar.style.left = `${Math.round(left)}px`;
        bar.style.transform = 'translateX(-50%)';
        bar.style.zIndex = '9999';
      }
    };
    updatePos();
    this._activeInPlaceBarUpdate = updatePos;
  }

  _hideInPlaceFloatingBar() {
    const bar = document.getElementById('in-place-floating-bar');
    if (bar) bar.style.display = 'none';
    this._activeInPlaceBarUpdate = null;
    document.body.classList.remove('in-place-editing-active');
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
    const nativeSpans = Array.from(wrapper.querySelectorAll('.textLayer span:not(.reflow-overflow-span)')).map(s => {
      let top = s.offsetTop;
      let left = s.offsetLeft;
      let height = s.offsetHeight;
      let width = s.offsetWidth;
      if (top === 0 && s.style.top) {
        top = parseFloat(s.style.top) || 0;
      }
      if (left === 0 && s.style.left) {
        left = parseFloat(s.style.left) || 0;
      }
      if (s.dataset.reflowShift) {
        const shift = parseFloat(s.dataset.reflowShift) || 0;
        top -= shift;
      }
      return {
        span: s,
        topNorm: top / wrapH,
        bottomNorm: (top + (height || 16)) / wrapH,
        leftNorm: left / wrapW,
        rightNorm: (left + (width || 40)) / wrapW,
        origOffsetTop: top,
        origOffsetHeight: height || 16,
        origOffsetLeft: left,
        origOffsetWidth: width || 40,
        textContent: s.textContent,
        styleText: s.getAttribute('style') || '',
        className: s.className,
        fontFamily: s.style.fontFamily,
        fontSize: s.style.fontSize
      };
    });

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
  _scheduleReflow(pageNum, immediate = false) {
    this._reflowPageNum = Math.min(this._reflowPageNum || pageNum || 1, pageNum || 1);
    if (this._reflowTimer) {
      clearTimeout(this._reflowTimer);
      this._reflowTimer = null;
    }
    if (this._reflowFrame) {
      cancelAnimationFrame(this._reflowFrame);
      this._reflowFrame = null;
    }
    if (immediate || typeof requestAnimationFrame !== 'function') {
      const pending = this._reflowPageNum || 1;
      this._reflowPageNum = null;
      if (pending) this._reflowEditedPage(pending);
      return;
    }
    this._reflowTimer = setTimeout(() => {
      this._reflowFrame = requestAnimationFrame(() => {
        const pending = this._reflowPageNum || 1;
        this._reflowPageNum = null;
        if (pending) this._reflowEditedPage(pending);
      });
    }, 180);
  }

  _getReflowMeasurer() {
    if (!this._reflowMeasurer || !this._reflowMeasurer.isConnected) {
      this._reflowMeasurer = document.createElement('div');
      this._reflowMeasurer.id = 'reflow-text-measurer';
      this._reflowMeasurer.style.position = 'absolute';
      this._reflowMeasurer.style.visibility = 'hidden';
      this._reflowMeasurer.style.pointerEvents = 'none';
      this._reflowMeasurer.style.left = '-9999px';
      this._reflowMeasurer.style.top = '-9999px';
      this._reflowMeasurer.style.padding = '0';
      this._reflowMeasurer.style.margin = '0';
      this._reflowMeasurer.style.border = 'none';
      this._reflowMeasurer.style.boxSizing = 'border-box';
      document.body.appendChild(this._reflowMeasurer);
    }
    return this._reflowMeasurer;
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
      if (typeof this.viewer._setupContentEditingHandlers === 'function') {
        this.viewer._setupContentEditingHandlers(textLayer, pageNum, pageWrapper);
      }
      if (typeof this.viewer._setupTextLayerSelection === 'function') {
        this.viewer._setupTextLayerSelection(textLayer, pageWrapper);
      }
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
   * Split a block of text into fitting and overflowing parts based on available vertical space.
   */
  _splitTextByAvailableHeight(text, styleObj, maxWidth, availHeightCss) {
    if (!text) {
      return { fits: true, fittingText: '', fittingHeight: 0, overflowText: '', overflowHeight: 0 };
    }
    const measurer = this._getReflowMeasurer();
    measurer.style.fontFamily = styleObj.fontFamily || 'sans-serif';
    measurer.style.fontSize = styleObj.fontSize || '16px';
    measurer.style.lineHeight = styleObj.lineHeight || '1.2';
    measurer.style.fontWeight = styleObj.fontWeight || 'normal';
    measurer.style.fontStyle = styleObj.fontStyle || 'normal';
    measurer.style.whiteSpace = 'pre-wrap';
    measurer.style.wordBreak = 'normal';
    measurer.style.overflowWrap = 'break-word';
    measurer.style.width = `${Math.max(20, Math.floor(maxWidth))}px`;
    measurer.style.maxWidth = `${Math.max(20, Math.floor(maxWidth))}px`;

    measurer.textContent = text;
    const fullHeight = measurer.offsetHeight;

    if (fullHeight <= availHeightCss + 2) {
      return {
        fits: true,
        fittingText: text,
        fittingHeight: fullHeight,
        overflowText: '',
        overflowHeight: 0
      };
    }

    // Estimate line height
    measurer.textContent = 'Ag';
    const singleLineH = Math.max(10, measurer.offsetHeight);

    if (availHeightCss < singleLineH) {
      return {
        fits: false,
        fittingText: '',
        fittingHeight: 0,
        overflowText: text,
        overflowHeight: fullHeight
      };
    }

    const tokens = text.match(/(\S+\s*|\s+)/g) || [text];
    let low = 0, high = tokens.length, best = 0;

    while (low <= high) {
      const mid = (low + high) >> 1;
      measurer.textContent = tokens.slice(0, mid).join('');
      if (measurer.offsetHeight <= availHeightCss + 2) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const fittingText = tokens.slice(0, best).join('').trimEnd();
    measurer.textContent = fittingText;
    const fittingHeight = fittingText ? measurer.offsetHeight : 0;

    const overflowText = tokens.slice(best).join('').trimStart();
    measurer.textContent = overflowText;
    const overflowHeight = overflowText ? measurer.offsetHeight : 0;

    return {
      fits: false,
      fittingText,
      fittingHeight,
      overflowText,
      overflowHeight
    };
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
    const editedPages = Array.from(this.annotator?.inPlaceEdits?.keys() || []);
    const maxEditedPage = editedPages.length > 0 ? Math.max(...editedPages) : (pageNum || 1);
    const maxPagesToCheck = Math.max(totalPages, this._lastReflowedMaxPage || totalPages, maxEditedPage) + 5;

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
      const scaleX = W / wrapW;
      const scaleY = H / wrapH;

      const hasIncoming = Boolean(incomingSlice && incomingSlice.height > 0);
      const incomingH = hasIncoming ? incomingSlice.height : 0;
      const incomingCssH = incomingH / scaleY;

      // Pristine bounds
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
      const maxContentYCss = maxContentY / scaleY;

      // Top padding for incoming content on this page
      const topPaddingPx = pageWrapper.classList.contains('overflow-page')
        ? Math.round(45 * scaleY)
        : pristineTopPx;
      const topPaddingCss = topPaddingPx / scaleY;

      // Paragraph spacing gap between incoming overflow and existing page content
      const paragraphGapPx = (hasIncoming && pristineBottomPx > 0) ? Math.round(14 * scaleY) : 0;
      const incomingTotalShiftPx = hasIncoming ? (incomingH + paragraphGapPx) : 0;
      const incomingTotalShiftCss = incomingTotalShiftPx / scaleY;

      // Prepare operations for in-place edits on this page
      const ops = [];
      if (pageEdits && pageEdits.size > 0) {
        for (const [span, edit] of pageEdits.entries()) {
          if (!span || !span.isConnected) continue;
          const norm = span._normRect || edit.normRect;
          if (!norm) continue;
          const origHeightPx = norm.h * wrapH;
          const currentHeightPx = span.offsetHeight || 0;
          const cs = window.getComputedStyle(span);
          const fullText = span._fullReflowText || (span.innerText !== undefined ? span.innerText : (span.textContent || ''));
          const maxWidth = parseFloat(span.style.maxWidth) || (norm.w * wrapW) || (wrapW - span.offsetLeft - 40);

          const styleObj = {
            fontFamily: span.style.fontFamily || cs.fontFamily,
            fontSize: cs.fontSize,
            lineHeight: cs.lineHeight,
            fontWeight: span.style.fontWeight || cs.fontWeight,
            fontStyle: span.style.fontStyle || cs.fontStyle
          };

          const opTopCss = (norm.y * wrapH) + incomingTotalShiftCss;
          const availCssForOp = Math.max(0, maxContentYCss - opTopCss);

          // Measure if text fits or needs clean line splitting across pages
          const split = this._splitTextByAvailableHeight(fullText, styleObj, maxWidth, availCssForOp);

          let fittingHeightCss = split.fits ? currentHeightPx : split.fittingHeight;
          let extraPx = Math.max(0, fittingHeightCss - origHeightPx);
          let extraNorm = extraPx / wrapH;

          ops.push({
            span,
            edit,
            norm,
            topNorm: norm.y,
            bottomNorm: norm.y + norm.h,
            origHeightPx,
            currentHeightPx,
            fullText,
            maxWidth,
            styleObj,
            hasSplit: !split.fits,
            fittingText: split.fittingText,
            fittingHeightCss,
            overflowText: split.overflowText,
            overflowHeightCss: split.overflowHeight,
            extraNorm,
            extraPx
          });
        }
        ops.sort((a, b) => a.topNorm - b.topNorm);
      }

      const hasDirectGrowth = ops.some(op => op.extraPx > 0 || op.hasSplit);
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
        if (p > maxEditedPage) {
          break;
        }
        continue;
      }

      highestReflowedPage = p;
      pageWrapper.dataset.hasReflow = 'true';

      const totalDirectDeltaPx = ops.reduce((acc, op) => acc + Math.round(op.extraNorm * H), 0);
      let actualContentBottomPx = pristineBottomPx > 0
        ? (pristineBottomPx + incomingTotalShiftPx + totalDirectDeltaPx)
        : (topPaddingPx + incomingTotalShiftPx + totalDirectDeltaPx);

      if (hasIncoming) {
        actualContentBottomPx = Math.max(actualContentBottomPx, topPaddingPx + incomingH);
      }
      for (const op of ops) {
        const opBotPx = Math.round((op.topNorm * H) + incomingTotalShiftPx + (op.fittingHeightCss * scaleY));
        actualContentBottomPx = Math.max(actualContentBottomPx, opBotPx);
      }

      // Virtual canvas holds full continuous content of this page + overflow
      const virtualH = Math.max(H, actualContentBottomPx);
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
        const origNormH = (op.origHeightPx || (op.span._originalHeight || 0)) / wrapH;
        const currentNormH = (op.fittingHeightCss || 0) / wrapH;
        const maskNormH = Math.max(origNormH, currentNormH, op.norm.h || 0);
        const maskH = maskNormH * H;
        const maskW = Math.max(op.norm.w * W, op.maxWidth * W / wrapW, ((op.span._originalWidth || 0) / wrapW) * W);
        const bleedX = Math.max(8, Math.round(6 * scaleX));
        const bleedTop = Math.max(6, Math.round(5 * scaleY));
        const bleedBottom = Math.max(8, Math.round(6 * scaleY));
        vCtx.fillStyle = '#ffffff';
        vCtx.fillRect(
          Math.max(0, Math.floor(op.norm.x * W) - bleedX),
          Math.max(0, Math.floor(topPx) - bleedTop),
          Math.min(W, Math.ceil(maskW) + bleedX * 2),
          Math.ceil(maskH) + bleedTop + bleedBottom
        );
        maskShift += op.extraNorm;
      }

      // E. Check overflow to next page and determine CLEAN cut point (splitY)
      let splitY = H;
      let hasOverflow = false;

      const splitOp = ops.find(op => op.hasSplit);
      if (splitOp) {
        hasOverflow = true;
        const opTopPx = Math.round(splitOp.topNorm * H) + incomingTotalShiftPx;
        const opCutPx = Math.round(opTopPx + (splitOp.fittingHeightCss * scaleY)) + 4;
        splitY = Math.min(maxContentY, opCutPx);
      } else if (actualContentBottomPx > maxContentY) {
        hasOverflow = true;
        const lineBottoms = [];
        if (hasIncoming && incomingSlice.spans) {
          for (const s of incomingSlice.spans) {
            const botPx = Math.round((topPaddingCss + s.topPx + (s.heightPx || 16)) * scaleY);
            if (s.isContinuation && botPx > maxContentY) {
              lineBottoms.push(maxContentY);
            } else {
              lineBottoms.push(botPx);
            }
          }
        }
        for (const op of ops) {
          const opBotPx = Math.round((op.topNorm * H) + incomingTotalShiftPx + (op.fittingHeightCss * scaleY));
          lineBottoms.push(opBotPx);
        }
        if (pristine && pristine.nativeSpans) {
          for (const s of pristine.nativeSpans) {
            if (ops.some(op => op.span === s.span)) continue;
            let directShiftNorm = 0;
            for (const op of ops) {
              if (op.bottomNorm <= s.topNorm + 0.0001) directShiftNorm += op.extraNorm;
            }
            const shiftedBottomPx = Math.round((s.bottomNorm + directShiftNorm) * H) + incomingTotalShiftPx;
            lineBottoms.push(shiftedBottomPx);
          }
        }
        lineBottoms.sort((a, b) => a - b);
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
      const outgoingSpans = [];
      const splitYCss = splitY / scaleY;

      // Handle split in-place edit overflow span to next page
      let continuationGapCss = 0;
      if (splitOp && splitOp.overflowText) {
        const cs = window.getComputedStyle(splitOp.span);
        const sourceBaseFs = splitOp.span._baseFontSize || this._extractSpanBaseFontSize(splitOp.span) || 12;
        outgoingSpans.push({
          sourceSpan: splitOp.span,
          isContinuation: true,
          textContent: splitOp.overflowText,
          className: splitOp.span.className,
          leftPx: Math.round(splitOp.norm.x * wrapW),
          absoluteTopCss: splitYCss,
          topPx: 0,
          widthPx: splitOp.maxWidth,
          heightPx: splitOp.overflowHeightCss,
          fontFamily: splitOp.span.style.fontFamily || cs.fontFamily,
          baseFontSize: sourceBaseFs,
          fontSize: `calc(var(--scale-factor, 1) * ${sourceBaseFs.toFixed(2)}px)`,
          lineHeight: splitOp.span.style.lineHeight || cs.lineHeight,
          fontWeight: splitOp.span.style.fontWeight || cs.fontWeight,
          fontStyle: splitOp.span.style.fontStyle || cs.fontStyle,
          color: splitOp.span.style.color || cs.color || '#000000',
          backgroundColor: '#ffffff'
        });
        continuationGapCss = splitOp.overflowHeightCss + 14;

        splitOp.span._fullReflowText = splitOp.fullText;
        splitOp.span._fittingReflowText = splitOp.fittingText;
        splitOp.span._overflowReflowText = splitOp.overflowText;

        // Keep page DOM span clamped to fitting lines
        if (splitOp.span.classList.contains('inline-editing')) {
          splitOp.span.style.maxHeight = `${splitOp.fittingHeightCss}px`;
          splitOp.span.style.overflow = 'hidden';
        } else {
          splitOp.span.textContent = splitOp.fittingText;
          splitOp.span.style.maxHeight = 'none';
          splitOp.span.style.overflow = 'visible';
        }
      } else if (splitOp) {
        splitOp.span._fullReflowText = null;
        splitOp.span._fittingReflowText = null;
        splitOp.span._overflowReflowText = null;
        splitOp.span.style.maxHeight = 'none';
        splitOp.span.style.overflow = 'visible';
      }

      // Add or update incoming spans in text layer without destroying active editor
      if (hasIncoming && incomingSlice.spans && textLayer) {
        const existingOverflowSpans = Array.from(textLayer.querySelectorAll('span.reflow-overflow-span'));
        const matchedExisting = new Set();

        incomingSlice.spans.forEach((sData, idx) => {
          const placedTopCss = topPaddingCss + sData.topPx;
          const placedBottomCss = placedTopCss + (sData.heightPx || 16);
          if (hasOverflow && placedBottomCss > splitYCss) {
            if (sData.isContinuation && placedTopCss < splitYCss - 20) {
              const availH = Math.max(0, splitYCss - placedTopCss);
              const split = this._splitTextByAvailableHeight(
                sData.textContent,
                {
                  fontFamily: sData.fontFamily,
                  fontSize: sData.fontSize,
                  lineHeight: sData.lineHeight,
                  fontWeight: sData.fontWeight,
                  fontStyle: sData.fontStyle
                },
                sData.widthPx,
                availH
              );

              if (split.fittingText && !split.fits) {
                let overflowSpan = existingOverflowSpans.find(el =>
                  !matchedExisting.has(el) &&
                  ((sData.sourceSpan && el._sourceSpan === sData.sourceSpan) ||
                   (el === this.annotator?.activeInPlaceSpan && el._sourceIndex === idx))
                );
                const isNew = !overflowSpan;
                if (isNew) overflowSpan = document.createElement('span');
                matchedExisting.add(overflowSpan);
                overflowSpan._sourceSpan = sData.sourceSpan || sData;
                overflowSpan._sourceIndex = idx;
                overflowSpan.textContent = split.fittingText;
                overflowSpan.className = 'reflow-overflow-span in-place-continuation in-place-modified';
                overflowSpan.style.setProperty('position', 'absolute', 'important');
                overflowSpan.style.setProperty('left', `${sData.leftPx}px`, 'important');
                overflowSpan.style.setProperty('top', `${placedTopCss}px`, 'important');
                overflowSpan.style.setProperty('max-width', `${sData.widthPx}px`, 'important');
                overflowSpan.style.setProperty('font-family', sData.fontFamily, 'important');
                overflowSpan._baseFontSize = sData.baseFontSize || 12;
                overflowSpan._baseFontSize = sData.baseFontSize || 12;
              overflowSpan.style.setProperty('font-size', sData.fontSize, 'important');
                overflowSpan.style.setProperty('line-height', sData.lineHeight, 'important');
                overflowSpan.style.setProperty('font-weight', sData.fontWeight || 'normal', 'important');
                overflowSpan.style.setProperty('font-style', sData.fontStyle || 'normal', 'important');
                overflowSpan.style.setProperty('color', sData.color || '#000000', 'important');
                overflowSpan.style.setProperty('background-color', '#ffffff', 'important');
                overflowSpan.style.setProperty('white-space', 'pre-wrap', 'important');
                overflowSpan.style.setProperty('word-break', 'normal', 'important');
                overflowSpan.style.setProperty('overflow-wrap', 'break-word', 'important');
                overflowSpan.style.setProperty('opacity', '1', 'important');
                overflowSpan.style.setProperty('visibility', 'visible', 'important');
                overflowSpan.style.setProperty('display', 'inline-block', 'important');
                overflowSpan.style.setProperty('cursor', 'text', 'important');
                overflowSpan.style.setProperty('z-index', '50', 'important');
                if (isNew) textLayer.appendChild(overflowSpan);

                outgoingSpans.push({
                  ...sData,
                  textContent: split.overflowText,
                  heightPx: split.overflowHeight,
                  sourceSpan: sData.sourceSpan || sData,
                  absoluteTopCss: splitYCss
                });
                return;
              }
            }

            outgoingSpans.push({
              ...sData,
              sourceSpan: sData.sourceSpan || sData,
              absoluteTopCss: placedTopCss
            });
          } else {
            let overflowSpan = existingOverflowSpans.find(el =>
              !matchedExisting.has(el) &&
              ((sData.sourceSpan && el._sourceSpan === sData.sourceSpan) ||
               (el === this.annotator?.activeInPlaceSpan && el._sourceIndex === idx))
            );

            const isNew = !overflowSpan;
            if (isNew) {
              overflowSpan = document.createElement('span');
            }
            matchedExisting.add(overflowSpan);
            overflowSpan._sourceSpan = sData.sourceSpan || sData;
            overflowSpan._sourceIndex = idx;

            const isActive = (overflowSpan === this.annotator?.activeInPlaceSpan);

            if (sData.isContinuation) {
              if (!isActive) {
                overflowSpan.textContent = sData.textContent;
              }
              overflowSpan.className = 'reflow-overflow-span in-place-continuation in-place-modified' + (isActive ? ' inline-editing' : '');
              overflowSpan.style.setProperty('position', 'absolute', 'important');
              overflowSpan.style.setProperty('left', `${sData.leftPx}px`, 'important');
              overflowSpan.style.setProperty('top', `${placedTopCss}px`, 'important');
              overflowSpan.style.setProperty('max-width', `${sData.widthPx}px`, 'important');
              overflowSpan.style.setProperty('font-family', sData.fontFamily, 'important');
              overflowSpan._baseFontSize = sData.baseFontSize || 12;
              overflowSpan.style.setProperty('font-size', sData.fontSize, 'important');
              overflowSpan.style.setProperty('line-height', sData.lineHeight, 'important');
              overflowSpan.style.setProperty('font-weight', sData.fontWeight || 'normal', 'important');
              overflowSpan.style.setProperty('font-style', sData.fontStyle || 'normal', 'important');
              overflowSpan.style.setProperty('color', sData.color || '#000000', 'important');
              overflowSpan.style.setProperty('background-color', '#ffffff', 'important');
              overflowSpan.style.setProperty('white-space', 'pre-wrap', 'important');
              overflowSpan.style.setProperty('word-break', 'normal', 'important');
              overflowSpan.style.setProperty('overflow-wrap', 'break-word', 'important');
              overflowSpan.style.setProperty('opacity', '1', 'important');
              overflowSpan.style.setProperty('visibility', 'visible', 'important');
              overflowSpan.style.setProperty('display', 'inline-block', 'important');
              overflowSpan.style.setProperty('cursor', 'text', 'important');
              overflowSpan.style.setProperty('z-index', '50', 'important');
            } else {
              overflowSpan.className = (sData.className || '') + ' reflow-overflow-span' + (isActive ? ' inline-editing' : '');
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
              if (sData.fontWeight) overflowSpan.style.fontWeight = sData.fontWeight;
              if (sData.fontStyle) overflowSpan.style.fontStyle = sData.fontStyle;
              if (sData.color) overflowSpan.style.color = sData.color;
              if (!isActive) {
                overflowSpan.textContent = sData.textContent;
              }
            }

            if (isNew) {
              textLayer.appendChild(overflowSpan);
            }
          }
        });

        // Clean up any unmatched old overflow spans
        for (const el of existingOverflowSpans) {
          if (!matchedExisting.has(el) && el !== this.annotator?.activeInPlaceSpan) {
            el.remove();
          }
        }
      } else if (textLayer) {
        textLayer.querySelectorAll('span.reflow-overflow-span').forEach(s => {
          if (s !== this.annotator?.activeInPlaceSpan) {
            s.remove();
          }
        });
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
          const cs = window.getComputedStyle(span);
          const sBaseFs = span._baseFontSize || this._extractSpanBaseFontSize(span) || 12;
          span.style.display = 'none';
          outgoingSpans.push({
            sourceSpan: span,
            className: span.className,
            textContent: span.textContent,
            styleText: span.getAttribute('style') || '',
            leftPx: sRec.origOffsetLeft,
            absoluteTopCss: newTopCss,
            heightPx: sRec.origOffsetHeight || 16,
            visibility: span.style.visibility,
            fontFamily: span.style.fontFamily || cs.fontFamily,
            baseFontSize: sBaseFs,
            fontSize: `calc(var(--scale-factor, 1) * ${sBaseFs.toFixed(2)}px)`,
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
      if (hasOverflow && outgoingSpans.length > 0) {
        const nativeOutgoing = outgoingSpans.filter(s => !s.isContinuation);
        const firstOverflowTopCss = nativeOutgoing.length > 0
          ? Math.min(...nativeOutgoing.map(s => s.absoluteTopCss))
          : splitYCss;

        for (const s of outgoingSpans) {
          if (s.isContinuation) {
            s.topPx = 0;
          } else {
            s.topPx = continuationGapCss + Math.max(0, s.absoluteTopCss - firstOverflowTopCss);
          }
        }

        const outgoingTotalH = Math.max(0, actualContentBottomPx - splitY);
        const contCanvasH = splitOp ? Math.round(splitOp.overflowHeightCss * scaleY) : 0;
        const contGapH = (splitOp && outgoingTotalH > 0) ? Math.round(14 * scaleY) : 0;
        const nextTotalH = contCanvasH + contGapH + outgoingTotalH;

        if (nextTotalH > 0) {
          const nextOverflowCanvas = document.createElement('canvas');
          nextOverflowCanvas.width = W;
          nextOverflowCanvas.height = nextTotalH;
          const oCtx = nextOverflowCanvas.getContext('2d');
          oCtx.fillStyle = '#ffffff';
          oCtx.fillRect(0, 0, W, nextTotalH);

          if (outgoingTotalH > 0) {
            const firstOverflowTopPx = Math.round(firstOverflowTopCss * scaleY);
            oCtx.drawImage(
              virtualCanvas,
              0, firstOverflowTopPx, W, outgoingTotalH,
              0, contCanvasH + contGapH, W, outgoingTotalH
            );
          }

          incomingSlice = {
            canvas: nextOverflowCanvas,
            height: nextTotalH,
            spans: outgoingSpans
          };
        } else {
          incomingSlice = null;
        }
      } else {
        incomingSlice = null;
      }
    }

    this._lastReflowedMaxPage = highestReflowedPage;
  }

  addBookmark(title, pageNum) {
    this.addCustomBookmark(title, pageNum);
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
          // Keep empty on fresh start or unpersisted resume
        } else if (this.viewer && this.viewer.pdfDoc) {
          // Do not re-render all pages on simple visibility/dialog change:
          // re-rendering wipes in-place DOM edits, canvas overlays, and resets modified paragraphs!
          console.log('[Session] Resumed from background: preserving active DOM state and canvases');
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

