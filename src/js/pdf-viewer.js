/**
 * Personal PDF Suite - PDF Viewer Engine (PDF.js Integration)
 * High-DPI canvas rendering, continuous scroll, text layer, bookmarks, search.
 */

/**
 * Clean & restore ligatures and replacement characters (\uFFFD / ?) from buggy PDF ToUnicode CMaps.
 * Corrects common ligatures like 'ti', 'fi', 'fl', 'tion', 'partition', 'multiple', 'allocation'.
 */
export function healPdfTextLigatures(text) {
  if (!text || typeof text !== 'string') return text;
  if (!text.includes('\ufffd') && !text.includes('\u0000') && !text.includes('\u001f') && !text.includes('?') && !/[\uFB00-\uFB06\uE000-\uF8FF]/.test(text)) {
    return text;
  }

  let cleaned = text;

  // 0. Standard Unicode alphabetic presentation forms
  cleaned = cleaned
    .replace(/\uFB00/g, 'ff')
    .replace(/\uFB01/g, 'fi')
    .replace(/\uFB02/g, 'fl')
    .replace(/\uFB03/g, 'ffi')
    .replace(/\uFB04/g, 'ffl')
    .replace(/\uFB05/g, 'ft')
    .replace(/\uFB06/g, 'st');

  // 1. Common database/technical words: partition / partitioned / partitioning
  cleaned = cleaned.replace(/par[\ufffd\u0000\u001f\u007f\?]{1,2}on\b/gi, 'partition');
  cleaned = cleaned.replace(/par[\ufffd\u0000\u001f\u007f\?]{1,2}ons\b/gi, 'partitions');
  cleaned = cleaned.replace(/par[\ufffd\u0000\u001f\u007f\?]{1,2}oned\b/gi, 'partitioned');
  cleaned = cleaned.replace(/par[\ufffd\u0000\u001f\u007f\?]{1,2}oning\b/gi, 'partitioning');

  // 2. Words ending in -tion: allocation, implementation, connection, operation, etc.
  cleaned = cleaned.replace(/([a-zA-Z])[\ufffd\u0000\u001f\u007f\?]{1,2}on\b/g, '$1tion');
  cleaned = cleaned.replace(/([a-zA-Z])[\ufffd\u0000\u001f\u007f\?]{1,2}ons\b/g, '$1tions');
  cleaned = cleaned.replace(/([a-zA-Z])[\ufffd\u0000\u001f\u007f\?]{1,2}onal\b/g, '$1tional');
  cleaned = cleaned.replace(/([a-zA-Z])[\ufffd\u0000\u001f\u007f\?]{1,2}oned\b/g, '$1tioned');
  cleaned = cleaned.replace(/([a-zA-Z])[\ufffd\u0000\u001f\u007f\?]{1,2}oning\b/g, '$1tioning');

  // 3. Words with -tive: creative, active, informative, objective, etc.
  cleaned = cleaned.replace(/([a-zA-Z])[\ufffd\u0000\u001f\u007f\?]{1,2}ve\b/g, '$1tive');
  cleaned = cleaned.replace(/([a-zA-Z])[\ufffd\u0000\u001f\u007f\?]{1,2}ves\b/g, '$1tives');
  cleaned = cleaned.replace(/([a-zA-Z])[\ufffd\u0000\u001f\u007f\?]{1,2}vely\b/g, '$1tively');
  cleaned = cleaned.replace(/([a-zA-Z])[\ufffd\u0000\u001f\u007f\?]{1,2}vity\b/g, '$1tivity');

  // 4. Words with -ting: testing, sorting, existing, creating, writing, depicting
  cleaned = cleaned.replace(/([a-zA-Z])[\ufffd\u0000\u001f\u007f\?]{1,2}ng\b/g, '$1ting');

  // 5. Words with -tial / -tian / -tious: essential, potential, initial
  cleaned = cleaned.replace(/([a-zA-Z])[\ufffd\u0000\u001f\u007f\?]{1,2}al\b/g, '$1tial');
  cleaned = cleaned.replace(/([a-zA-Z])[\ufffd\u0000\u001f\u007f\?]{1,2}ally\b/g, '$1tially');

  // 6. multiple / multi / multiply
  cleaned = cleaned.replace(/mul[\ufffd\u0000\u001f\u007f\?]ple\b/gi, 'multiple');
  cleaned = cleaned.replace(/mul[\ufffd\u0000\u001f\u007f\?]ply\b/gi, 'multiply');
  cleaned = cleaned.replace(/mul[\ufffd\u0000\u001f\u007f\?]/gi, 'multi');

  // 7. Common technical words with fi / fl / ff ligatures
  cleaned = cleaned.replace(/spe[\ufffd\u0000\u001f\u007f\?]{1,2}c\b/gi, 'specific');
  cleaned = cleaned.replace(/spe[\ufffd\u0000\u001f\u007f\?]{1,2}cs\b/gi, 'specifics');
  cleaned = cleaned.replace(/spe[\ufffd\u0000\u001f\u007f\?]{1,2}cally\b/gi, 'specifically');
  cleaned = cleaned.replace(/suf[\ufffd\u0000\u001f\u007f\?]{1,2}cent\b/gi, 'sufficient');
  cleaned = cleaned.replace(/ef[\ufffd\u0000\u001f\u007f\?]{1,2}cent\b/gi, 'efficient');
  cleaned = cleaned.replace(/dif[\ufffd\u0000\u001f\u007f\?]{1,2}erent\b/gi, 'different');
  cleaned = cleaned.replace(/dif[\ufffd\u0000\u001f\u007f\?]{1,2}cult\b/gi, 'difficult');
  cleaned = cleaned.replace(/dif[\ufffd\u0000\u001f\u007f\?]{1,2}culty\b/gi, 'difficulty');
  cleaned = cleaned.replace(/dif[\ufffd\u0000\u001f\u007f\?]{1,2}culties\b/gi, 'difficulties');
  cleaned = cleaned.replace(/par[\ufffd\u0000\u001f\u007f\?]{1,2}cular\b/gi, 'particular');

  // 8. Contextual ligature repair:
  cleaned = cleaned.replace(/([a-zA-Z])[\ufffd\u0000\u001f\u007f\?]{1,2}([aeiou])/g, '$1ti$2');
  cleaned = cleaned.replace(/([a-zA-Z])[\ufffd\u0000\u001f\u007f\?]([a-zA-Z])/g, '$1t$2');

  // Strip any leftover replacement characters
  cleaned = cleaned.replace(/[\ufffd\u0000\u001f\u007f\uE000-\uF8FF]/g, '');

  return cleaned;
}

export class PDFViewerEngine {
  constructor(options = {}) {
    this.container = options.container;
    this.pagesContainer = options.pagesContainer || document.getElementById('pdf-viewer') || this.container;
    this.thumbnailsContainer = options.thumbnailsContainer;
    this.outlineContainer = options.outlineContainer;
    this.onPageChange = options.onPageChange || (() => {});
    this.onDocumentLoaded = options.onDocumentLoaded || (() => {});
    this.onContentEdited = options.onContentEdited || (() => {});
    this.onPageRendered = options.onPageRendered || (() => {});
    
    this.pdfDoc = null;
    this.pdfBytes = null;
    this.currentPage = 1;
    this.totalPages = 0;
    this.scale = 1.0;
    this.currentZoomMode = 'page-width';
    this.rotation = 0;
    this.isContentEditingActive = false;
    this.pageRenders = new Map();
    this.searchResults = [];
    this.currentSearchIndex = -1;
    this.currentSearchQuery = '';
    this.documentFonts = new Set();

    // Configure PDF.js worker (Bundled offline first with CDN fallback)
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    }

    this._setupIntersectionObserver();
    this._setupPinchToZoom();
  }

  _setupPinchToZoom() {
    let initialDistance = 0;
    let initialScale = 1.0;

    this.container.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        initialDistance = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        initialScale = this.scale;
      }
    }, { passive: true });

    this.container.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2 && initialDistance > 0) {
        const currentDistance = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const factor = currentDistance / initialDistance;
        const newScale = Math.min(3.0, Math.max(0.4, initialScale * factor));
        
        // Debounce render if significant change
        if (Math.abs(newScale - this.scale) > 0.15) {
          this.setZoom('custom', newScale);
        }
      }
    }, { passive: true });

    this.container.addEventListener('touchend', (e) => {
      if (e.touches.length < 2) {
        initialDistance = 0;
      }
    }, { passive: true });
  }

  getCurrentVisiblePage() {
    if (!this.container || !this.pagesContainer) return this.currentPage || 1;
    const cRect = this.container.getBoundingClientRect();
    const wrappers = this.pagesContainer.querySelectorAll('.page-wrapper');
    if (!wrappers || wrappers.length === 0) return this.currentPage || 1;

    let bestPage = this.currentPage || 1;
    let maxVisibleHeight = -1;

    for (const w of wrappers) {
      const pageNum = parseInt(w.dataset.pageNumber, 10);
      if (!pageNum) continue;
      const rect = w.getBoundingClientRect();

      // Calculate how many vertical pixels of this page are inside the viewport
      const visibleTop = Math.max(cRect.top, rect.top);
      const visibleBottom = Math.min(cRect.bottom, rect.bottom);
      const visibleHeight = Math.max(0, visibleBottom - visibleTop);

      if (visibleHeight > maxVisibleHeight) {
        maxVisibleHeight = visibleHeight;
        bestPage = pageNum;
      }
    }

    return bestPage;
  }

  _setupIntersectionObserver() {
    // 1. Dual strategy: Continuous scroll listener with requestAnimationFrame for instant, accurate page tracking
    let ticking = false;
    this.container.addEventListener('scroll', () => {
      // Auto-dismiss floating mobile page indicator while scrolling to avoid disturbing reading
      const m3Bar = document.getElementById('m3-page-bar');
      if (m3Bar && m3Bar.classList.contains('visible')) {
        m3Bar.classList.remove('visible');
      }

      if (!ticking) {
        requestAnimationFrame(() => {
          const visiblePage = this.getCurrentVisiblePage();
          if (visiblePage && visiblePage !== this.currentPage) {
            this.currentPage = visiblePage;
            this.onPageChange(visiblePage, this.totalPages);
            this._highlightThumbnail(visiblePage);
          }
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });

    // 2. Multi-threshold IntersectionObserver for fallback
    this.observer = new IntersectionObserver((entries) => {
      let mostVisibleEntry = null;
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          if (!mostVisibleEntry || entry.intersectionRatio > mostVisibleEntry.intersectionRatio) {
            mostVisibleEntry = entry;
          }
        }
      });
      if (mostVisibleEntry) {
        const pageNum = parseInt(mostVisibleEntry.target.dataset.pageNumber, 10);
        if (pageNum && pageNum !== this.currentPage) {
          this.currentPage = pageNum;
          this.onPageChange(pageNum, this.totalPages);
          this._highlightThumbnail(pageNum);
        }
      }
    }, { root: this.container, threshold: [0.1, 0.3, 0.5, 0.7, 0.9] });
  }

  async _extractDocumentFonts(pdfBytes) {
    if (!pdfBytes) return;
    try {
      const lib = window.PDFLib || window.pdfLib;
      if (!lib) return;
      const { PDFDocument, PDFName } = lib;
      const rawBytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
      const doc = await PDFDocument.load(rawBytes.slice(), { ignoreEncryption: true });
      const objects = doc.context.enumerateIndirectObjects();
      for (const [ref, obj] of objects) {
        if (obj && typeof obj.get === 'function') {
          const baseFont = obj.get(PDFName.of('BaseFont'));
          if (baseFont) {
            let name = baseFont.name || baseFont.encodedName || (typeof baseFont.toString === 'function' ? baseFont.toString() : '');
            if (name.startsWith('/')) name = name.substring(1);
            name = name.replace(/^[A-Z0-9]{6}\+/, '');
            name = name.replace(/-(?:Bold|Italic|Regular|BoldItalic|Oblique|BoldOblique).*$/i, '').trim();
            if (name && name.length >= 2 && !name.startsWith('g_d') && !name.startsWith('F')) {
              this.documentFonts.add(name);
            }
          }
        }
      }
      if (this.documentFonts.size > 0 && window.app && window.app.ui) {
        window.app.ui.setDocumentFonts(Array.from(this.documentFonts));
      }
    } catch (e) {
      console.warn('Document font extraction via PDFLib:', e);
    }
  }

  async loadDocument(data, fileName = 'document.pdf') {
    try {
      this.clearSearch();
      const sInput = document.getElementById('search-input');
      if (sInput) sInput.value = '';
      const sCount = document.getElementById('search-count');
      if (sCount) sCount.textContent = '0/0';

      this.documentFonts.clear();
      this.pdfBytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      
      // Concurrently extract real font metadata from PDF indirect objects
      this._extractDocumentFonts(this.pdfBytes);

      const loadingTask = window.pdfjsLib.getDocument({ data: this.pdfBytes.slice() });
      this.pdfDoc = await loadingTask.promise;
      this.totalPages = this.pdfDoc.numPages;
      this.currentPage = 1;
      this.rotation = 0;

      // Render document pages
      await this.renderAllPages();
      
      // Load outline / bookmarks
      await this.loadBookmarks();

      // Render thumbnails in sidebar
      this.renderThumbnails();

      this.onDocumentLoaded({
        title: fileName,
        pages: this.totalPages,
        bytes: this.pdfBytes.length,
        fonts: Array.from(this.documentFonts)
      });

      return true;
    } catch (err) {
      console.error('Error loading PDF document:', err);
      throw err;
    }
  }

  async renderAllPages() {
    if (!this.pdfDoc) return;
    this.pagesContainer.innerHTML = '';
    this.pageRenders.clear();

    const firstPage = await this.pdfDoc.getPage(1);
    this._calculateScale(firstPage);

    for (let pageNum = 1; pageNum <= this.totalPages; pageNum++) {
      const pageWrapper = document.createElement('div');
      pageWrapper.className = 'page-wrapper';
      pageWrapper.id = `page-wrapper-${pageNum}`;
      pageWrapper.dataset.pageNumber = pageNum;

      const canvas = document.createElement('canvas');
      canvas.id = `page-canvas-${pageNum}`;
      canvas.className = 'pdf-canvas';
      pageWrapper.appendChild(canvas);

      // Text Layer container for selection & search
      const textLayer = document.createElement('div');
      textLayer.className = 'textLayer';
      textLayer.id = `text-layer-${pageNum}`;
      pageWrapper.appendChild(textLayer);

      // Overlay canvas for annotations
      const annotationLayer = document.createElement('div');
      annotationLayer.className = 'annotation-layer';
      annotationLayer.id = `annotation-layer-${pageNum}`;
      const annotCanvas = document.createElement('canvas');
      annotCanvas.id = `annot-canvas-${pageNum}`;
      annotationLayer.appendChild(annotCanvas);
      pageWrapper.appendChild(annotationLayer);

      this.pagesContainer.appendChild(pageWrapper);
      this.observer.observe(pageWrapper);

      // Render the page
      await this._renderSinglePage(pageNum, pageWrapper, canvas, textLayer, annotCanvas);
    }
  }

  _calculateScale(page) {
    const effectiveRot = ((page.rotate || 0) + (this.rotation || 0)) % 360;
    const viewport = page.getViewport({ scale: 1.0, rotation: effectiveRot });
    const cWidth = this.container.clientWidth;
    const cHeight = this.container.clientHeight;

    if (this.currentZoomMode === 'page-width') {
      // Fit full width cleanly with minimal padding
      const targetWidth = Math.max(300, cWidth - 24);
      this.scale = Math.max(0.2, Math.min(5.0, targetWidth / viewport.width));
    } else if (this.currentZoomMode === 'page-fit') {
      // Fit entire page vertically in viewport
      const targetHeight = Math.max(300, cHeight - 48);
      const targetWidth = Math.max(300, cWidth - 24);
      const scaleH = targetHeight / viewport.height;
      const scaleW = targetWidth / viewport.width;
      this.scale = Math.max(0.2, Math.min(5.0, Math.min(scaleW, scaleH)));
    } else if (this.currentZoomMode === 'auto') {
      // Auto Fit: smart Acrobat fit for window dimensions
      const targetHeight = Math.max(300, cHeight - 64);
      const targetWidth = Math.max(300, cWidth - 48);
      const scaleH = targetHeight / viewport.height;
      const scaleW = targetWidth / viewport.width;
      this.scale = Math.max(0.2, Math.min(5.0, Math.min(scaleW, scaleH)));
    }
  }

  async _renderSinglePage(pageNum, pageWrapper, canvas, textLayer, annotCanvas) {
    const page = await this.pdfDoc.getPage(pageNum);
    const effectiveRot = ((page.rotate || 0) + (this.rotation || 0)) % 360;
    const viewport = page.getViewport({ scale: this.scale, rotation: effectiveRot });
    const outputScale = window.devicePixelRatio || 1;

    pageWrapper.style.width = `${Math.floor(viewport.width)}px`;
    pageWrapper.style.height = `${Math.floor(viewport.height)}px`;

    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    annotCanvas.width = canvas.width;
    annotCanvas.height = canvas.height;
    annotCanvas.style.width = canvas.style.width;
    annotCanvas.style.height = canvas.style.height;

    const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
    const ctx = canvas.getContext('2d');
    
    const renderContext = {
      canvasContext: ctx,
      transform: transform,
      viewport: viewport
    };

    await page.render(renderContext).promise;

    // Render Text Layer
    try {
      const textContent = await page.getTextContent();
      if (textContent && textContent.items) {
        textContent.items.forEach(item => {
          if (item && item.str) {
            item.str = healPdfTextLigatures(item.str);
          }
        });
      }
      if (textContent && textContent.styles) {
        Object.values(textContent.styles).forEach(s => {
          if (s.fontFamily) {
            let clean = s.fontFamily.replace(/^[A-Z0-9]{6}\+/, '').trim();
            clean = clean.replace(/-(?:Bold|Italic|Regular|BoldItalic|Oblique|BoldOblique)$/i, '');
            if (clean && !clean.startsWith('g_d') && !this.documentFonts.has(clean)) {
              this.documentFonts.add(clean);
            }
          }
        });
      }

      textLayer.innerHTML = '';
      textLayer.style.width = `${Math.floor(viewport.width)}px`;
      textLayer.style.height = `${Math.floor(viewport.height)}px`;
      textLayer.style.setProperty('--scale-factor', viewport.scale);

      if (window.pdfjsLib.renderTextLayer) {
        const textTask = window.pdfjsLib.renderTextLayer({
          textContentSource: textContent,
          container: textLayer,
          viewport: viewport,
          textDivs: []
        });
        if (textTask && textTask.promise) {
          await textTask.promise;
        }
      }

      // Heal any ligature defects directly in the rendered textLayer DOM spans
      textLayer.querySelectorAll('span').forEach(s => {
        if (s.textContent && (s.textContent.includes('\ufffd') || s.textContent.includes('?') || /[\uFB00-\uFB06\uE000-\uF8FF]/.test(s.textContent))) {
          s.textContent = healPdfTextLigatures(s.textContent);
        }
      });

      this._setupTextLayerSelection(textLayer, pageWrapper);
      this._setupContentEditingHandlers(textLayer, pageNum, pageWrapper);
      if (this.currentSearchQuery) {
        this._applySearchHighlightToPage(pageNum, textLayer);
      }
      if (this.onPageRendered) {
        this.onPageRendered(pageNum, textLayer, pageWrapper);
      }
    } catch (e) {
      console.warn('Text layer render skipped:', e);
    }

    this.pageRenders.set(pageNum, { page, viewport });
  }

  setContentEditingMode(active) {
    this.isContentEditingActive = active;
    const wrappers = (this.pagesContainer || this.container).querySelectorAll('.page-wrapper');
    wrappers.forEach(w => {
      if (active) {
        w.classList.add('editing-content');
      } else {
        w.classList.remove('editing-content');
      }
    });
  }

  _setupTextLayerSelection(textLayer, pageWrapper) {
    let endOfContent = textLayer.querySelector('.endOfContent');
    if (!endOfContent) {
      endOfContent = document.createElement('div');
      endOfContent.className = 'endOfContent';
      textLayer.appendChild(endOfContent);
    }

    textLayer.addEventListener('mousedown', (e) => {
      // If user clicked directly on the textLayer background or endOfContent spacer (e.g. whitespace or margins)
      if (e.target === textLayer || e.target === endOfContent) {
        const clickX = e.clientX;
        const clickY = e.clientY;

        // Find all text spans on this page
        const spans = Array.from(textLayer.querySelectorAll('span'));
        if (spans.length === 0) return;

        // Find the span closest to the click coordinates
        let bestSpan = null;
        let minDistance = Infinity;
        let isPastEnd = false;

        for (const span of spans) {
          const sRect = span.getBoundingClientRect();
          if (sRect.width === 0 || sRect.height === 0) continue;

          // Check vertical distance
          const verticalDist = (clickY < sRect.top) ? (sRect.top - clickY) : (clickY > sRect.bottom ? (clickY - sRect.bottom) : 0);
          // Check horizontal distance
          const horizontalDist = (clickX < sRect.left) ? (sRect.left - clickX) : (clickX > sRect.right ? (clickX - sRect.right) : 0);

          // Weight vertical distance much higher (x12) so we snap to spans on the same horizontal line
          const distance = verticalDist * 12 + horizontalDist;
          if (distance < minDistance) {
            minDistance = distance;
            bestSpan = span;
            isPastEnd = (clickX >= sRect.right);
          }
        }

        if (bestSpan) {
          const targetNode = bestSpan.lastChild || bestSpan.firstChild || bestSpan;
          const offset = isPastEnd ? (targetNode.textContent?.length || 0) : 0;
          try {
            const sel = window.getSelection();
            if (sel) {
              sel.collapse(targetNode, offset);
            }
          } catch (err) {
            // Ignore if collapse is not supported
          }
        }
      }

      endOfContent.classList.add('active');
    });

    const onMouseUp = () => {
      endOfContent.classList.remove('active');
    };
    window.addEventListener('mouseup', onMouseUp);
  }

  _setupContentEditingHandlers(textLayer, pageNum, pageWrapper) {
    textLayer.addEventListener('click', (e) => {
      const span = e.target.closest('span');
      if (!span || !this.isContentEditingActive) return;

      e.stopPropagation();

      this.onContentEdited({
        span,
        pageNum,
        pageWrapper,
        clientX: e.clientX,
        clientY: e.clientY
      });
    });

    // Touch tap detection for responsive Android mobile editing
    let touchStartX = 0;
    let touchStartY = 0;
    textLayer.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }
    }, { passive: true });

    textLayer.addEventListener('touchend', (e) => {
      if (!this.isContentEditingActive) return;
      if (e.changedTouches && e.changedTouches.length === 1) {
        const dx = Math.abs(e.changedTouches[0].clientX - touchStartX);
        const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
        if (dx < 10 && dy < 10) {
          const span = e.target.closest('span');
          if (span) {
            e.stopPropagation();
            this.onContentEdited({
              span,
              pageNum,
              pageWrapper,
              clientX: e.changedTouches[0].clientX,
              clientY: e.changedTouches[0].clientY
            });
          }
        }
      }
    });
  }

  async loadBookmarks() {
    if (!this.outlineContainer || !this.pdfDoc) return;
    try {
      const outline = await this.pdfDoc.getOutline();
      this.documentOutline = outline || [];
      if (window.app && window.app.ui) {
        window.app.ui.syncBookmarks();
      }
    } catch (e) {
      console.warn('Bookmarks load error:', e);
      this.documentOutline = [];
    }
  }

  async renderThumbnails() {
    if (!this.thumbnailsContainer || !this.pdfDoc) return;
    this.thumbnailsContainer.innerHTML = '';

    for (let pageNum = 1; pageNum <= this.totalPages; pageNum++) {
      const item = document.createElement('div');
      item.className = `thumbnail-item ${pageNum === this.currentPage ? 'active' : ''}`;
      item.id = `thumb-${pageNum}`;
      item.onclick = () => this.goToPage(pageNum);

      const preview = document.createElement('div');
      preview.className = 'thumbnail-preview';
      const canvas = document.createElement('canvas');
      preview.appendChild(canvas);

      const label = document.createElement('div');
      label.className = 'thumbnail-number';
      label.textContent = `Page ${pageNum}`;

      item.appendChild(preview);
      item.appendChild(label);
      this.thumbnailsContainer.appendChild(item);

      // Render thumbnail canvas asynchronously
      this._renderThumbnailCanvas(pageNum, canvas);
    }
  }

  async _renderThumbnailCanvas(pageNum, canvas) {
    try {
      const page = await this.pdfDoc.getPage(pageNum);
      const effectiveRot = ((page.rotate || 0) + (this.rotation || 0)) % 360;
      const thumbViewport = page.getViewport({ scale: 0.25, rotation: effectiveRot });
      canvas.width = thumbViewport.width;
      canvas.height = thumbViewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: thumbViewport }).promise;
    } catch (e) {
      console.warn('Thumbnail render err:', e);
    }
  }

  _highlightThumbnail(pageNum) {
    const prev = this.thumbnailsContainer?.querySelector('.thumbnail-item.active');
    if (prev) prev.classList.remove('active');
    const curr = document.getElementById(`thumb-${pageNum}`);
    if (curr) {
      curr.classList.add('active');
      curr.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  goToPage(pageNum) {
    if (pageNum < 1 || pageNum > this.totalPages) return;
    const target = document.getElementById(`page-wrapper-${pageNum}`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      this.currentPage = pageNum;
      this.onPageChange(pageNum, this.totalPages);
      this._highlightThumbnail(pageNum);
    }
  }

  setZoom(zoomMode, customScale = null) {
    this.currentZoomMode = zoomMode;
    if (customScale) {
      this.scale = customScale;
    }
    this.renderAllPages();
  }

  rotateClockwise() {
    this.rotation = (this.rotation + 90) % 360;
    this.renderAllPages();
    this.renderThumbnails();
  }

  clearSearch() {
    this.currentSearchQuery = '';
    this.searchResults = [];
    this.currentSearchIndex = -1;
    const target = this.pagesContainer || this.container || document;

    // Restore original text in all spans that were wrapped with marks
    target.querySelectorAll('.textLayer span').forEach(span => {
      if (span.dataset.rawText !== undefined) {
        span.textContent = span.dataset.rawText;
        delete span.dataset.rawText;
      }
      span.classList.remove('search-highlight', 'active-match', 'highlight', 'selected');
    });

    // Cleanup any lingering marks
    target.querySelectorAll('mark.search-highlight').forEach(mark => {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent), mark);
      }
    });

    target.querySelectorAll('.has-search-matches').forEach(tl => {
      tl.classList.remove('has-search-matches');
    });
    document.querySelectorAll('.page-wrapper.has-search-matches').forEach(pw => {
      pw.classList.remove('has-search-matches');
    });
  }

  _buildSearchRegex(query) {
    if (!query) return null;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Normalize English ligatures to match both standard chars and unicode replacements (\uFFFD / ?)
    const withLigatures = escaped
      .replace(/ti/gi, '(?:ti|[\\uFFFD?])')
      .replace(/tt/gi, '(?:tt|[\\uFFFD?])')
      .replace(/ft/gi, '(?:ft|[\\uFFFD?])')
      .replace(/fi/gi, '(?:fi|[\\uFFFD?])')
      .replace(/fl/gi, '(?:fl|[\\uFFFD?])')
      .replace(/ff/gi, '(?:ff|[\\uFFFD?])');
    return new RegExp(withLigatures, 'gi');
  }

  _wrapMatchesInSpan(span, query, pageNum) {
    if (!span || !query) return [];
    const rawText = span.dataset.rawText || span.textContent || '';
    if (!rawText.trim()) return [];

    if (!span.dataset.rawText) {
      span.dataset.rawText = rawText;
    }

    const searchRegex = this._buildSearchRegex(query);
    if (!searchRegex) return [];

    searchRegex.lastIndex = 0;
    if (!searchRegex.test(rawText)) {
      if (span.innerHTML !== rawText) {
        span.textContent = rawText;
      }
      return [];
    }

    searchRegex.lastIndex = 0;
    const matches = [];
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match;

    while ((match = searchRegex.exec(rawText)) !== null) {
      const matchStart = match.index;
      const matchStr = match[0];
      const matchEnd = matchStart + matchStr.length;

      if (matchStart > lastIndex) {
        fragment.appendChild(document.createTextNode(rawText.slice(lastIndex, matchStart)));
      }

      const mark = document.createElement('mark');
      mark.className = 'search-highlight';
      mark.textContent = matchStr;
      fragment.appendChild(mark);

      matches.push({
        pageNum,
        element: mark,
        text: matchStr,
        span
      });

      lastIndex = matchEnd;
      if (searchRegex.lastIndex <= matchStart) {
        searchRegex.lastIndex = matchStart + 1;
      }
    }

    if (lastIndex < rawText.length) {
      fragment.appendChild(document.createTextNode(rawText.slice(lastIndex)));
    }

    span.innerHTML = '';
    span.appendChild(fragment);
    return matches;
  }

  _applySearchHighlightToPage(pageNum, textLayer) {
    if (!this.currentSearchQuery || !textLayer) return;

    const spans = textLayer.querySelectorAll('span');
    let hasMatches = false;

    spans.forEach(span => {
      const matches = this._wrapMatchesInSpan(span, this.currentSearchQuery, pageNum);
      if (matches.length > 0) {
        hasMatches = true;
        // Re-link element pointers if page was re-rendered (e.g. after zoom)
        matches.forEach(m => {
          const existing = this.searchResults.find(r => r.pageNum === pageNum && r.text.toLowerCase() === m.text.toLowerCase() && !r.element?.isConnected);
          if (existing) {
            existing.element = m.element;
          }
        });
      }
    });

    if (hasMatches) {
      textLayer.classList.add('has-search-matches');
      const pw = textLayer.closest('.page-wrapper');
      if (pw) pw.classList.add('has-search-matches');
    }

    // Restore active match if on this page
    if (this.currentSearchIndex >= 0 && this.searchResults[this.currentSearchIndex]?.pageNum === pageNum) {
      const activeMatch = this.searchResults[this.currentSearchIndex];
      if (activeMatch.element && activeMatch.element.isConnected) {
        activeMatch.element.classList.add('active-match');
      }
    }
  }

  async searchText(query) {
    this.clearSearch();
    if (!this.pdfDoc || !query || !query.trim()) {
      return { total: 0, current: 0 };
    }

    const q = query.trim();
    this.currentSearchQuery = q;

    for (let pageNum = 1; pageNum <= this.totalPages; pageNum++) {
      const pageWrapper = document.getElementById(`page-wrapper-${pageNum}`);
      if (!pageWrapper) continue;
      const textLayer = pageWrapper.querySelector('.textLayer');
      if (!textLayer) continue;

      const spans = Array.from(textLayer.querySelectorAll('span'));
      let pageHasMatches = false;

      spans.forEach(span => {
        const matches = this._wrapMatchesInSpan(span, q, pageNum);
        if (matches.length > 0) {
          pageHasMatches = true;
          this.searchResults.push(...matches);
        }
      });

      if (pageHasMatches) {
        textLayer.classList.add('has-search-matches');
        pageWrapper.classList.add('has-search-matches');
      }
    }

    if (this.searchResults.length > 0) {
      this._activateSearchResult(0);
    }

    return {
      total: this.searchResults.length,
      current: this.searchResults.length > 0 ? this.currentSearchIndex + 1 : 0
    };
  }

  _activateSearchResult(index) {
    if (this.searchResults.length === 0 || index < 0 || index >= this.searchResults.length) return;
    this.currentSearchIndex = index;
    const match = this.searchResults[index];

    // Remove active state from all highlights
    const target = this.pagesContainer || this.container || document;
    target.querySelectorAll('.active-match').forEach(el => el.classList.remove('active-match'));

    // Highlight active element
    if (match.element && match.element.isConnected) {
      match.element.classList.add('active-match');
    } else {
      const pw = target.querySelector(`#page-wrapper-${match.pageNum}`);
      if (pw) {
        const marks = pw.querySelectorAll('mark.search-highlight');
        const targetMark = Array.from(marks).find(m => (m.textContent || '').toLowerCase().includes(this.currentSearchQuery.toLowerCase()));
        if (targetMark) {
          targetMark.classList.add('active-match');
          match.element = targetMark;
        }
      }
    }

    // Scroll smoothly to the match location across ALL pages 1..N
    this._scrollToMatch(match);
  }

  _scrollToMatch(match) {
    const pageWrapper = document.getElementById(`page-wrapper-${match.pageNum}`);
    if (!pageWrapper) return;

    if (match.element && match.element.isConnected) {
      match.element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    } else {
      pageWrapper.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
    }

    this.currentPage = match.pageNum;
    this.onPageChange(match.pageNum, this.totalPages);
    this._highlightThumbnail(match.pageNum);
  }

  nextSearchResult() {
    if (this.searchResults.length === 0) return null;
    const nextIdx = (this.currentSearchIndex + 1) % this.searchResults.length;
    this._activateSearchResult(nextIdx);
    return {
      total: this.searchResults.length,
      current: this.currentSearchIndex + 1
    };
  }

  prevSearchResult() {
    if (this.searchResults.length === 0) return null;
    const prevIdx = (this.currentSearchIndex - 1 + this.searchResults.length) % this.searchResults.length;
    this._activateSearchResult(prevIdx);
    return {
      total: this.searchResults.length,
      current: this.currentSearchIndex + 1
    };
  }
}

