/**
 * Personal PDF Suite - Main Application Controller
 * Adobe Acrobat-grade functionality for Windows, Arch Linux, and Android.
 */

import { PDFViewerEngine } from './pdf-viewer.js';
import { PDFOrganizerEngine } from './pdf-organizer.js';
import { PDFAnnotatorEngine } from './pdf-annotator.js';
import { PDFSignatureEngine } from './pdf-signature.js';
import { PDFSecurityEngine } from './pdf-security.js';
import { PDFExportEngine } from './pdf-export.js';
import { UIController } from './ui.js';

class PersonalPDFApp {
  constructor() {
    this.currentDocName = 'document.pdf';
    this.currentPdfBytes = null;
    this.organizerCards = [];

    this._initEngines();
    this._bindCoreEvents();
    this._bindOrganizerEvents();
    this._bindWatermarkEvents();
    this._setupElectronBridge();

    // Check if running in native desktop shell
    if (window.__TAURI__) {
      console.log('Running in native Tauri v2 desktop shell.');
    }
  }

  _initEngines() {
    const viewerContainer = document.getElementById('viewer-container');
    const thumbnailsContainer = document.getElementById('thumbnails-container');
    const outlineContainer = document.getElementById('outline-container');

    // 1. Viewer Engine
    this.viewer = new PDFViewerEngine({
      container: viewerContainer,
      thumbnailsContainer: thumbnailsContainer,
      outlineContainer: outlineContainer,
      onPageChange: (current, total) => this._onPageChange(current, total),
      onDocumentLoaded: (meta) => this._onDocumentLoaded(meta)
    });

    // 2. Organizer Engine
    this.organizer = new PDFOrganizerEngine();

    // 3. Annotator Engine
    this.annotator = new PDFAnnotatorEngine({
      container: viewerContainer
    });

    // 4. Signature Engine
    this.signature = new PDFSignatureEngine({
      onSignatureReady: (dataUrl) => {
        this.signature.placeSignatureOnPage(this.viewer.currentPage, dataUrl);
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
    const btnPrint = document.getElementById('btn-print');

    btnOpenFile.onclick = () => fileInput.click();
    btnWelcomeOpen.onclick = () => fileInput.click();

    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (file) this.loadFile(file);
    };

    btnLoadSample.onclick = () => this.loadSamplePDF();
    btnSavePdf.onclick = () => this.saveDocument();
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
    const mergeList = document.getElementById('merge-files-list');
    let mergeBuffers = [];

    if (mergeInput) {
      mergeInput.onchange = async (e) => {
        mergeBuffers = [];
        mergeList.innerHTML = '';
        for (const file of e.target.files) {
          const buf = await file.arrayBuffer();
          mergeBuffers.push(buf);
          const item = document.createElement('div');
          item.className = 'merge-item';
          item.innerHTML = `<span>📄 ${file.name}</span> <span class="text-muted">${Math.round(file.size / 1024)} KB</span>`;
          mergeList.appendChild(item);
        }
      };
    }

    const btnApplyMerge = document.getElementById('btn-apply-merge');
    if (btnApplyMerge) {
      btnApplyMerge.onclick = async () => {
        if (mergeBuffers.length < 2) {
          alert('Please select at least 2 PDF files to combine.');
          return;
        }
        this.ui.setStatus('Combining documents...');
        const mergedBytes = await this.organizer.mergeDocuments(mergeBuffers);
        await this.loadArrayBuffer(mergedBytes, 'Merged_Document.pdf');
        document.getElementById('modal-merge').classList.remove('open');
        this.ui.setStatus('PDFs merged successfully');
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
        if (!this.currentPdfBytes) return;
        const prefix = document.getElementById('bates-prefix').value.trim();
        const startNumber = parseInt(document.getElementById('bates-start').value, 10) || 1;
        const format = document.getElementById('bates-format').value;
        const position = document.getElementById('bates-position').value;

        this.ui.setStatus('Applying numbering...');
        const updated = await this.security.addPageNumbers(this.currentPdfBytes, {
          prefix,
          startNumber,
          format,
          position
        });
        await this.loadArrayBuffer(updated, this.currentDocName);
        document.getElementById('modal-bates').classList.remove('open');
        this.ui.setStatus('Header/Footer numbering applied');
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
      }, 300);
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
        } else if (e.key === 's' || e.key === 'S') {
          e.preventDefault();
          this.saveDocument();
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

  async loadArrayBuffer(arrayBuffer, docName = 'document.pdf') {
    this.currentDocName = docName;
    this.currentPdfBytes = new Uint8Array(arrayBuffer);

    // Hide welcome card
    document.getElementById('welcome-screen').style.display = 'none';
    document.getElementById('current-doc-name').textContent = docName;
    const m3Title = document.getElementById('m3-doc-title');
    if (m3Title) m3Title.textContent = docName;
    this.ui.setStatus(`Loading ${docName}...`);

    try {
      await this.viewer.loadDocument(this.currentPdfBytes, docName);
      this.ui.setStatus(`Ready: ${docName}`);
    } catch (err) {
      console.error(err);
      this.ui.setStatus(`Error loading PDF: ${err.message}`);
    }
  }

  _onPageChange(current, total) {
    document.getElementById('page-num-input').value = current;
    document.getElementById('page-count').textContent = total;
  }

  _onDocumentLoaded(meta) {
    document.getElementById('page-count').textContent = meta.pages;
    document.getElementById('page-num-input').max = meta.pages;
    document.getElementById('status-size').textContent = `${Math.round(meta.bytes / 1024)} KB`;
    this.ui.setZoomStatus(`${Math.round(this.viewer.scale * 100)}%`);
  }

  async loadSamplePDF() {
    this.ui.setStatus('Generating sample PDF...');
    try {
      if (!window.PDFLib) {
        alert('PDF library is loading, please wait a moment...');
        return;
      }
      const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
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
        '✔ High-DPI Continuous Viewer with Crisp Text Rendering',
        '✔ Freehand Inking, Highlighters, Sticky Notes, and Custom Stamps',
        '✔ Drag-and-Drop Page Organizer (Reorder, Rotate, Delete, Insert)',
        '✔ Electronic Signature Pad (Draw, Type Cursive, Upload Image)',
        '✔ Document Security: Watermarking, Page Numbers, Redaction',
        '✔ 100% Offline & Private (Runs on Windows, Arch Linux, and Android APK)'
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
      // 1. Burn all drawn strokes, highlighters, signatures, textboxes, and stamps directly into the PDF streams
      let outputBytes = await this.annotator.burnAnnotationsToPdf(this.currentPdfBytes);
      
      const saveName = this.currentDocName.endsWith('.pdf') 
        ? this.currentDocName.replace('.pdf', '_edited.pdf')
        : `${this.currentDocName}_edited.pdf`;

      this.exporter.downloadFile(outputBytes, saveName, 'application/pdf');
      this.ui.setStatus(`Saved: ${saveName}`);
    } catch (err) {
      console.error(err);
      this.ui.setStatus(`Save error: ${err.message}`);
    }
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
          <button class="organizer-mini-btn btn-rot-left" title="Rotate Left">↺</button>
          <button class="organizer-mini-btn btn-rot-right" title="Rotate Right">↻</button>
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

      // Card actions
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

      footer.querySelector('.btn-del-card').onclick = (e) => {
        e.stopPropagation();
        card.remove();
        this._renumberOrganizerCards();
      };

      card.onclick = () => {
        card.classList.toggle('selected');
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

    grid.addEventListener('dragstart', (e) => {
      draggedCard = e.target.closest('.organizer-card');
      if (draggedCard) draggedCard.classList.add('dragging');
    });

    grid.addEventListener('dragend', () => {
      if (draggedCard) draggedCard.classList.remove('dragging');
      draggedCard = null;
      this._renumberOrganizerCards();
    });

    grid.addEventListener('dragover', (e) => {
      e.preventDefault();
      const afterElement = this._getDragAfterElement(grid, e.clientX, e.clientY);
      if (afterElement == null) {
        grid.appendChild(draggedCard);
      } else {
        grid.insertBefore(draggedCard, afterElement);
      }
    });
  }

  _getDragAfterElement(container, x, y) {
    const draggableElements = [...container.querySelectorAll('.organizer-card:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = (x - box.left - box.width / 2) + (y - box.top - box.height / 2);
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  _bindOrganizerEvents() {
    const btnApplyOrg = document.getElementById('btn-org-apply');
    if (btnApplyOrg) {
      btnApplyOrg.onclick = async () => {
        const grid = document.getElementById('organizer-grid');
        const cards = grid.querySelectorAll('.organizer-card');
        const operations = [];

        cards.forEach(card => {
          operations.push({
            originalIndex: parseInt(card.dataset.pageIndex, 10),
            rotationDelta: parseInt(card.dataset.rotationDelta, 10) || 0,
            isBlank: card.dataset.isBlank === 'true'
          });
        });

        if (operations.length === 0) {
          alert('Cannot create an empty PDF. Keep at least one page.');
          return;
        }

        this.ui.setStatus('Applying page changes...');
        const updatedBytes = await this.organizer.reorderAndModifyPages(this.currentPdfBytes, operations);
        await this.loadArrayBuffer(updatedBytes, this.currentDocName);
        document.getElementById('modal-organizer').classList.remove('open');
        this.ui.setStatus('Page modifications applied successfully');
      };
    }
  }

  _bindWatermarkEvents() {
    const btnApplyWatermark = document.getElementById('btn-apply-watermark');
    if (btnApplyWatermark) {
      btnApplyWatermark.onclick = async () => {
        if (!this.currentPdfBytes) return;
        const text = document.getElementById('watermark-text').value;
        const angle = parseInt(document.getElementById('watermark-angle').value, 10);
        const opacity = parseInt(document.getElementById('watermark-opacity').value, 10) / 100;
        const color = document.getElementById('watermark-color').value;
        const size = parseInt(document.getElementById('watermark-size').value, 10);

        this.ui.setStatus('Applying watermark...');
        const modified = await this.security.applyWatermark(this.currentPdfBytes, {
          text, angle, opacity, color, size
        });
        await this.loadArrayBuffer(modified, this.currentDocName);
        document.getElementById('modal-watermark').classList.remove('open');
        this.ui.setStatus('Watermark applied successfully');
      };
    }

    const opacitySlider = document.getElementById('watermark-opacity');
    if (opacitySlider) {
      opacitySlider.oninput = (e) => {
        document.getElementById('watermark-opacity-val').textContent = `${e.target.value}%`;
      };
    }
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

