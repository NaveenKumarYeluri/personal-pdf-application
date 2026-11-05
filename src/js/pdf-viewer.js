/**
 * Personal PDF Suite - PDF Viewer Engine (PDF.js Integration)
 * High-DPI canvas rendering, continuous scroll, text layer, bookmarks, search.
 */

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

  _setupIntersectionObserver() {
    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const pageNum = parseInt(entry.target.dataset.pageNumber, 10);
          if (pageNum && pageNum !== this.currentPage) {
            this.currentPage = pageNum;
            this.onPageChange(pageNum, this.totalPages);
            this._highlightThumbnail(pageNum);
          }
        }
      });
    }, { root: this.container, threshold: 0.5 });
  }

  async loadDocument(data, fileName = 'document.pdf') {
    try {
      this.pdfBytes = data instanceof Uint8Array ? data : new Uint8Array(data);
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
        bytes: this.pdfBytes.length
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
    const viewport = page.getViewport({ scale: 1.0, rotation: this.rotation });
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
    const viewport = page.getViewport({ scale: this.scale, rotation: this.rotation });
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

      this._setupContentEditingHandlers(textLayer, pageNum, pageWrapper);
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

  _setupContentEditingHandlers(textLayer, pageNum, pageWrapper) {
    textLayer.addEventListener('click', (e) => {
      const span = e.target.closest('span');
      if (!span || !this.isContentEditingActive) return;

      e.stopPropagation();

      this.onContentEdited({
        span,
        pageNum,
        pageWrapper
      });
    });
  }

  async loadBookmarks() {
    if (!this.outlineContainer || !this.pdfDoc) return;
    try {
      const outline = await this.pdfDoc.getOutline();
      this.outlineContainer.innerHTML = '';
      if (!outline || outline.length === 0) {
        this.outlineContainer.innerHTML = '<div class="empty-state">No bookmarks found</div>';
        return;
      }

      const list = document.createElement('div');
      list.className = 'outline-list';
      
      const renderItem = async (item) => {
        const div = document.createElement('div');
        div.className = 'outline-item';
        div.textContent = item.title;
        div.onclick = async () => {
          if (typeof item.dest === 'string') {
            const dest = await this.pdfDoc.getDestination(item.dest);
            const pageIndex = await this.pdfDoc.getPageIndex(dest[0]);
            this.goToPage(pageIndex + 1);
          } else if (Array.isArray(item.dest)) {
            const pageIndex = await this.pdfDoc.getPageIndex(item.dest[0]);
            this.goToPage(pageIndex + 1);
          }
        };
        list.appendChild(div);

        if (item.items && item.items.length > 0) {
          for (const sub of item.items) {
            await renderItem(sub);
          }
        }
      };

      for (const item of outline) {
        await renderItem(item);
      }
      this.outlineContainer.appendChild(list);
    } catch (e) {
      this.outlineContainer.innerHTML = '<div class="empty-state">Bookmarks not available</div>';
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
      const thumbViewport = page.getViewport({ scale: 0.25, rotation: this.rotation });
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

  async searchText(query) {
    if (!this.pdfDoc || !query) {
      this.searchResults = [];
      this.currentSearchIndex = -1;
      return { total: 0, current: 0 };
    }

    this.searchResults = [];
    query = query.toLowerCase();

    for (let pageNum = 1; pageNum <= this.totalPages; pageNum++) {
      const page = await this.pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(i => i.str).join(' ').toLowerCase();

      let pos = 0;
      while ((pos = pageText.indexOf(query, pos)) !== -1) {
        this.searchResults.push({ pageNum, index: pos });
        pos += query.length;
      }
    }

    if (this.searchResults.length > 0) {
      this.currentSearchIndex = 0;
      this.goToPage(this.searchResults[0].pageNum);
    } else {
      this.currentSearchIndex = -1;
    }

    return {
      total: this.searchResults.length,
      current: this.searchResults.length > 0 ? this.currentSearchIndex + 1 : 0
    };
  }

  nextSearchResult() {
    if (this.searchResults.length === 0) return null;
    this.currentSearchIndex = (this.currentSearchIndex + 1) % this.searchResults.length;
    const match = this.searchResults[this.currentSearchIndex];
    this.goToPage(match.pageNum);
    return {
      total: this.searchResults.length,
      current: this.currentSearchIndex + 1
    };
  }

  prevSearchResult() {
    if (this.searchResults.length === 0) return null;
    this.currentSearchIndex = (this.currentSearchIndex - 1 + this.searchResults.length) % this.searchResults.length;
    const match = this.searchResults[this.currentSearchIndex];
    this.goToPage(match.pageNum);
    return {
      total: this.searchResults.length,
      current: this.currentSearchIndex + 1
    };
  }
}

