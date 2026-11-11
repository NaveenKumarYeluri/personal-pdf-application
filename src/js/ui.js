/**
 * Personal PDF Suite - UI Controller & Ribbon Manager
 * Manages mode ribbons, contextual tools, inspector panels, sidebar tabs, and themes.
 */

export class UIController {
  constructor(app) {
    this.app = app;
    this.currentMode = 'view';
    this.dynamicToolsContainer = document.getElementById('dynamic-mode-tools');
    this.inspector = document.getElementById('inspector');
    this.inspectorContent = document.getElementById('inspector-content');
    this.documentFonts = [];
    
    this._initModeTabs();
    this._initSidebarTabs();
    this._initRightToolsPane();
    this._initModals();
    this._initTheme();
    this._initMaterialMobileUI();
    this._initAnnotationsAutoSync();
    if (this.app?.annotator) this.app.annotator.ui = this;
    this.setMode('view');
  }

  /**
   * Keep the Annotations sidebar in sync while it is visible: newly added text
   * boxes, notes, stamps and in-place edits are DOM mutations, so observing the
   * page container covers them without instrumenting every element handler.
   */
  _initAnnotationsAutoSync() {
    const target = document.getElementById('pdf-viewer');
    if (!target || typeof MutationObserver === 'undefined') return;

    let timer = null;
    const schedule = () => {
      const pane = document.getElementById('tab-annotations');
      if (!pane || !pane.classList.contains('active')) return;
      clearTimeout(timer);
      timer = setTimeout(() => this.syncAnnotationsList(), 120);
    };
    this._annotationsObserver = new MutationObserver(schedule);
    this._annotationsObserver.observe(target, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  _initRightToolsPane() {
    const pane = document.getElementById('acrobat-tools-pane');
    const btnToggle = document.getElementById('btn-toggle-tools-pane');
    const btnToggleTop = document.getElementById('btn-toggle-tools-pane-top');

    const togglePane = () => {
      if (!pane) return;
      pane.classList.toggle('collapsed');
      const isCollapsed = pane.classList.contains('collapsed');
      if (btnToggle) btnToggle.textContent = isCollapsed ? '▶' : '◀';
      if (btnToggleTop) btnToggleTop.classList.toggle('active', !isCollapsed);
    };

    if (btnToggle) btnToggle.onclick = togglePane;
    if (btnToggleTop) btnToggleTop.onclick = togglePane;

    const items = document.querySelectorAll('.acrobat-tool-item[data-acrobat-mode]');
    items.forEach(item => {
      item.onclick = () => {
        const mode = item.dataset.acrobatMode;
        // Sync top mode tabs
        document.querySelectorAll('.mode-tab').forEach(t => {
          if (t.dataset.mode === mode) t.classList.add('active');
          else t.classList.remove('active');
        });
        this.setMode(mode);
      };
    });

    document.getElementById('tool-quick-watermark')?.addEventListener('click', () => {
      document.getElementById('modal-watermark')?.classList.add('open');
    });
    document.getElementById('tool-quick-bates')?.addEventListener('click', () => {
      document.getElementById('modal-bates')?.classList.add('open');
    });
    document.getElementById('tool-quick-merge')?.addEventListener('click', () => {
      this.app.openMergeModal();
    });
  }

  _initMaterialMobileUI() {
    // 1. Mobile Bottom Nav Tabs & Sheets
    const navItems = document.querySelectorAll('.m3-nav-item');
    const sheetMarkup = document.getElementById('m3-sheet-markup');
    const sheetTools = document.getElementById('m3-sheet-tools');
    const sheetEdit = document.getElementById('m3-sheet-edit');
    const scrim = document.getElementById('m3-scrim');
    const drawer = document.getElementById('m3-drawer');

    const closeAllSheets = () => {
      sheetMarkup?.classList.remove('open');
      sheetTools?.classList.remove('open');
      sheetEdit?.classList.remove('open');
      drawer?.classList.remove('open');
      scrim?.classList.remove('open');
    };

    ['click', 'touchstart', 'pointerdown'].forEach(evt => {
      scrim?.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeAllSheets();
      }, { passive: false });
    });

    // Close when tapping on empty area outside drawer or sheets
    const handleOutsideTap = (e) => {
      if (drawer?.classList.contains('open') && !drawer.contains(e.target) && !e.target.closest('#m3-btn-drawer')) {
        closeAllSheets();
      }
      if (sheetMarkup?.classList.contains('open') && !sheetMarkup.contains(e.target) && !e.target.closest('.m3-nav-item') && !e.target.closest('#m3-fab')) {
        closeAllSheets();
      }
      if (sheetEdit?.classList.contains('open') && !sheetEdit.contains(e.target) && !e.target.closest('.m3-nav-item')) {
        closeAllSheets();
      }
      if (sheetTools?.classList.contains('open') && !sheetTools.contains(e.target) && !e.target.closest('.m3-nav-item') && !e.target.closest('#m3-btn-more')) {
        closeAllSheets();
      }
    };
    document.addEventListener('touchstart', handleOutsideTap, { passive: true });
    document.addEventListener('click', handleOutsideTap);

    document.getElementById('m3-close-markup')?.addEventListener('click', closeAllSheets);
    document.getElementById('m3-close-tools')?.addEventListener('click', closeAllSheets);
    document.getElementById('m3-close-edit')?.addEventListener('click', closeAllSheets);
    document.getElementById('m3-drawer-close')?.addEventListener('click', closeAllSheets);

    navItems.forEach(item => {
      item.onclick = () => {
        navItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        const tab = item.dataset.m3Tab;

        if (tab === 'read') {
          closeAllSheets();
          this.setMode('view');
        } else if (tab === 'edit') {
          closeAllSheets();
          this.setMode('edit');
          sheetEdit?.classList.add('open');
          scrim?.classList.add('open');
        } else if (tab === 'annotate') {
          closeAllSheets();
          this.setMode('annotate');
          sheetMarkup?.classList.add('open');
          scrim?.classList.add('open');
        } else if (tab === 'pages') {
          closeAllSheets();
          this.app.openOrganizerModal();
        } else if (tab === 'tools') {
          closeAllSheets();
          sheetTools?.classList.add('open');
          scrim?.classList.add('open');
        }
      };
    });

    // 2. Mobile FAB (Floating Action Button)
    const fab = document.getElementById('m3-fab');
    if (fab) {
      fab.onclick = () => {
        if (this.currentMode === 'annotate') {
          sheetMarkup?.classList.toggle('open');
          scrim?.classList.toggle('open');
        } else if (this.currentMode === 'edit') {
          sheetEdit?.classList.toggle('open');
          scrim?.classList.toggle('open');
        } else {
          document.getElementById('file-input')?.click();
        }
      };
    }

    // 3. Mobile Top App Bar
    document.getElementById('m3-btn-undo')?.addEventListener('click', () => {
      const ok = this.app.annotator.undo();
      this.setStatus(ok ? 'Undo action' : 'Nothing to undo');
    });

    document.getElementById('m3-btn-redo')?.addEventListener('click', () => {
      const ok = this.app.annotator.redo();
      this.setStatus(ok ? 'Redo action' : 'Nothing to redo');
    });

    document.getElementById('m3-sheet-undo')?.addEventListener('click', () => {
      const ok = this.app.annotator.undo();
      this.setStatus(ok ? 'Undo action' : 'Nothing to undo');
    });

    document.getElementById('m3-sheet-redo')?.addEventListener('click', () => {
      const ok = this.app.annotator.redo();
      this.setStatus(ok ? 'Redo action' : 'Nothing to redo');
    });

    document.getElementById('m3-btn-drawer')?.addEventListener('click', () => {
      drawer?.classList.add('open');
      scrim?.classList.add('open');
      this._syncMobileDrawerContent();
    });

    document.getElementById('m3-btn-open')?.addEventListener('click', () => {
      document.getElementById('file-input')?.click();
    });

    document.getElementById('m3-btn-save')?.addEventListener('click', () => {
      this.app.saveDocument();
    });

    document.getElementById('m3-btn-more')?.addEventListener('click', () => {
      sheetTools?.classList.add('open');
      scrim?.classList.add('open');
    });

    // 4. Mobile Edit PDF Sheet Actions
    document.getElementById('m3-edit-toggle-inline')?.addEventListener('click', () => {
      const active = this.app.viewer.isContentEditingActive;
      this.app.viewer.setContentEditingMode(!active);
      document.getElementById('m3-edit-toggle-inline')?.classList.toggle('active', !active);
      this.setStatus(!active ? 'In-place edit: tap any text to modify' : 'In-place edit paused');
    });

    document.getElementById('m3-edit-add-text')?.addEventListener('click', () => {
      closeAllSheets();
      this.app.annotator.fontSize = parseInt(document.getElementById('m3-edit-font-size').value, 10);
      this.app.annotator.fontFamily = document.getElementById('m3-edit-font-family')?.value || 'Inter, sans-serif';
      this.app.annotator.color = document.getElementById('m3-edit-font-color').value;
      const target = this.app.getVisibleCenterTarget();
      this.app.annotator._addTextBox(target.pageNum, target.x, target.y);
      this.setStatus('Added text block in current view. Tap to edit.');
    });

    document.getElementById('m3-edit-font-family')?.addEventListener('change', (e) => {
      this.app.annotator.setFontFamily(e.target.value);
    });
    document.getElementById('m3-edit-font-size')?.addEventListener('change', (e) => {
      this.app.annotator.setFontSize(e.target.value);
    });
    document.getElementById('m3-edit-font-color')?.addEventListener('change', (e) => {
      this.app.annotator.setColor(e.target.value);
    });
    document.getElementById('m3-edit-bold')?.addEventListener('click', () => {
      const isB = this.app.annotator.toggleBold();
      document.getElementById('m3-edit-bold')?.classList.toggle('active', isB);
    });
    document.getElementById('m3-edit-italic')?.addEventListener('click', () => {
      const isI = this.app.annotator.toggleItalic();
      document.getElementById('m3-edit-italic')?.classList.toggle('active', isI);
    });
    document.getElementById('m3-edit-underline')?.addEventListener('click', () => {
      const isU = this.app.annotator.toggleUnderline();
      document.getElementById('m3-edit-underline')?.classList.toggle('active', isU);
    });
    document.getElementById('m3-edit-strike')?.addEventListener('click', () => {
      const isS = this.app.annotator.toggleStrikethrough();
      document.getElementById('m3-edit-strike')?.classList.toggle('active', isS);
    });
    document.getElementById('m3-edit-align-left')?.addEventListener('click', () => {
      this.app.annotator.setTextAlign('left');
    });
    document.getElementById('m3-edit-align-center')?.addEventListener('click', () => {
      this.app.annotator.setTextAlign('center');
    });
    document.getElementById('m3-edit-align-right')?.addEventListener('click', () => {
      this.app.annotator.setTextAlign('right');
    });
    document.getElementById('m3-edit-delete-box')?.addEventListener('click', () => {
      this.app.annotator.deleteActiveBox();
    });

    document.getElementById('m3-edit-signature')?.addEventListener('click', () => {
      closeAllSheets();
      this.app.signature.openModal();
    });

    document.getElementById('m3-edit-insert-img')?.addEventListener('click', () => {
      document.getElementById('m3-edit-img-file')?.click();
    });

    document.getElementById('m3-edit-img-file')?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (re) => {
          this.app.insertImageOnPage(undefined, re.target.result);
          closeAllSheets();
          this.setStatus('Image inserted. Drag to position.');
        };
        reader.readAsDataURL(file);
      }
    });

    document.getElementById('m3-edit-whiteout')?.addEventListener('click', () => {
      closeAllSheets();
      const target = this.app.getVisibleCenterTarget();
      this.app.insertWhiteoutOnPage(target.pageNum, target.x, target.y);
      this.setStatus('Whiteout box placed. Drag to cover text.');
    });

    // 5. Mobile Floating Page Bar & Zoom Controls (Unobtrusive & auto-hiding to protect reading experience)
    const m3Bar = document.getElementById('m3-page-bar');
    let m3BarHideTimer = null;
    const keepMobileBarAlive = () => {
      if (m3Bar) {
        m3Bar.classList.add('visible');
        clearTimeout(m3BarHideTimer);
        m3BarHideTimer = setTimeout(() => {
          m3Bar.classList.remove('visible');
        }, 2500);
      }
    };

    // User can tap mobile top bar title to reveal page switcher & zoom bar briefly
    document.getElementById('m3-doc-title')?.addEventListener('click', keepMobileBarAlive);

    // Immediately dismiss mobile page bar on any scroll or touch to prevent disturbing the reader
    const hideMobileBar = () => {
      if (m3Bar && m3Bar.classList.contains('visible')) {
        m3Bar.classList.remove('visible');
        clearTimeout(m3BarHideTimer);
      }
    };
    document.getElementById('viewer-container')?.addEventListener('scroll', hideMobileBar, { passive: true });
    document.getElementById('viewer-container')?.addEventListener('touchmove', hideMobileBar, { passive: true });
    window.addEventListener('scroll', hideMobileBar, { passive: true });
    document.addEventListener('touchmove', hideMobileBar, { passive: true });

    document.getElementById('m3-page-prev')?.addEventListener('click', () => {
      keepMobileBarAlive();
      this.app.viewer.goToPage(this.app.viewer.currentPage - 1);
    });

    document.getElementById('m3-page-next')?.addEventListener('click', () => {
      keepMobileBarAlive();
      this.app.viewer.goToPage(this.app.viewer.currentPage + 1);
    });

    document.getElementById('m3-page-display')?.addEventListener('click', () => {
      keepMobileBarAlive();
      const target = prompt(`Jump to page (1 - ${this.app.viewer.totalPages}):`, this.app.viewer.currentPage);
      const num = parseInt(target, 10);
      if (!isNaN(num) && num >= 1 && num <= this.app.viewer.totalPages) {
        this.app.viewer.goToPage(num);
      }
    });

    document.getElementById('m3-zoom-out')?.addEventListener('click', () => {
      keepMobileBarAlive();
      this.app.viewer.zoomOut();
      this.setStatus(`Zoom: ${Math.round(this.app.viewer.scale * 100)}%`);
    });

    document.getElementById('m3-zoom-in')?.addEventListener('click', () => {
      keepMobileBarAlive();
      this.app.viewer.zoomIn();
      this.setStatus(`Zoom: ${Math.round(this.app.viewer.scale * 100)}%`);
    });

    document.getElementById('m3-zoom-fit')?.addEventListener('click', () => {
      keepMobileBarAlive();
      this.app.viewer.setZoom('fit-width');
      this.setStatus('Fit to width');
    });

    // 6. Mobile Search Bar Overlay
    const searchBar = document.getElementById('m3-search-bar');
    const searchInput = document.getElementById('m3-search-input');
    const searchCount = document.getElementById('m3-search-count');

    const toggleMobileSearch = () => {
      searchBar.classList.toggle('open');
      if (searchBar.classList.contains('open')) {
        searchInput.focus();
      } else {
        closeMobileSearch();
      }
    };

    const closeMobileSearch = () => {
      searchBar.classList.remove('open');
      if (searchInput) {
        searchInput.value = '';
        searchInput.blur();
      }
      if (document.activeElement) document.activeElement.blur();
      this.app.viewer.clearSearch();
      if (searchCount) searchCount.textContent = '0/0';
      const container = document.getElementById('viewer-container');
      if (container) container.focus();
    };

    document.getElementById('m3-btn-search')?.addEventListener('click', toggleMobileSearch);

    const btnCloseSearch = document.getElementById('m3-search-close');
    if (btnCloseSearch) {
      btnCloseSearch.addEventListener('click', closeMobileSearch);
      btnCloseSearch.addEventListener('touchend', (e) => {
        e.preventDefault();
        closeMobileSearch();
      });
    }

    searchInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMobileSearch();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const res = this.app.viewer.nextSearchResult();
        if (res && searchCount) searchCount.textContent = `${res.current}/${res.total}`;
      }
    });

    let mobileSearchTimeout = null;
    searchInput?.addEventListener('input', () => {
      clearTimeout(mobileSearchTimeout);
      mobileSearchTimeout = setTimeout(async () => {
        const query = searchInput.value.trim();
        const res = await this.app.viewer.searchText(query);
        searchCount.textContent = `${res.current}/${res.total}`;
      }, 300);
    });

    document.getElementById('m3-search-next')?.addEventListener('click', () => {
      const res = this.app.viewer.nextSearchResult();
      if (res) searchCount.textContent = `${res.current}/${res.total}`;
    });

    document.getElementById('m3-search-prev')?.addEventListener('click', () => {
      const res = this.app.viewer.prevSearchResult();
      if (res) searchCount.textContent = `${res.current}/${res.total}`;
    });

    // 7. Mobile Drawer Navigation Tabs & Actions
    const drawerTabs = document.querySelectorAll('.m3-drawer-tab');
    drawerTabs.forEach(tab => {
      tab.onclick = () => {
        drawerTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.m3-drawer-pane').forEach(p => p.classList.remove('active'));
        const pane = document.getElementById(`m3-drawer-tab-${tab.dataset.drawerTab}`);
        if (pane) pane.classList.add('active');
      };
    });

    document.getElementById('m3-drawer-open')?.addEventListener('click', () => {
      closeAllSheets();
      document.getElementById('file-input')?.click();
    });
    document.getElementById('m3-drawer-annotate')?.addEventListener('click', () => {
      closeAllSheets();
      this.setMode('annotate');
      const sheetMarkup = document.getElementById('m3-sheet-markup');
      const scrim = document.getElementById('m3-scrim');
      sheetMarkup?.classList.add('open');
      scrim?.classList.add('open');
      document.querySelectorAll('.m3-nav-item').forEach(i => i.classList.remove('active'));
      document.querySelector('.m3-nav-item[data-m3-tab="annotate"]')?.classList.add('active');
    });
    document.getElementById('m3-drawer-sample')?.addEventListener('click', () => {
      closeAllSheets();
      this.app.loadSamplePDF();
    });
    document.getElementById('m3-drawer-theme')?.addEventListener('click', () => {
      document.getElementById('btn-toggle-theme')?.click();
    });
    document.getElementById('m3-drawer-props')?.addEventListener('click', () => {
      closeAllSheets();
      document.getElementById('btn-doc-props')?.click();
    });
    document.getElementById('m3-drawer-about')?.addEventListener('click', () => {
      closeAllSheets();
      alert('Personal PDF Suite - Professional Edition\nHigh-performance, private PDF suite for Windows, Linux & Android.');
    });

    document.getElementById('m3-btn-add-bookmark')?.addEventListener('click', () => {
      const title = prompt('Enter bookmark title for current page:');
      if (title && title.trim()) {
        const pageNum = (this.app.viewer.getCurrentVisiblePage && this.app.viewer.getCurrentVisiblePage()) || this.app.viewer.currentPage || 1;
        this.app.addBookmark(title.trim(), pageNum);
        this._syncMobileDrawerContent();
        this.showToast(`Bookmark added: "${title.trim()}" (Page ${pageNum})`, 'success');
      }
    });

    document.querySelectorAll('#m3-drawer-accent-palette .accent-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        document.querySelectorAll('#m3-drawer-accent-palette .accent-swatch').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        const color = swatch.dataset.color;
        const hover = swatch.dataset.hover || color;
        document.documentElement.style.setProperty('--accent-color', color);
        document.documentElement.style.setProperty('--accent-color-hover', hover);
      });
    });

    // 8. Mobile Annotation Chips
    const chips = document.querySelectorAll('.m3-chip[data-m3-tool]');
    chips.forEach(chip => {
      chip.onclick = () => {
        chips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const tool = chip.dataset.m3Tool;
        const strokeW = parseInt(document.getElementById('m3-stroke-slider')?.value || 4, 10);

        if (tool === 'select') {
          this.app.annotator.setTool('none');
          this.setStatus('Text selection active: long-press text to select or copy');
        } else if (tool === 'eraser') {
          this.app.annotator.setTool('eraser');
          this.setStatus('Eraser active: tap any annotation or drag across ink to erase');
        } else if (tool === 'underline') {
          closeAllSheets();
          const ok = this.app.annotator.toggleUnderline();
          this.setStatus(ok ? 'Applied underline markup to selected text' : 'Select text on the PDF to underline');
          return;
        } else if (tool === 'strikethrough') {
          closeAllSheets();
          const ok = this.app.annotator.toggleStrikethrough();
          this.setStatus(ok ? 'Applied strikethrough markup to selected text' : 'Select text on the PDF to strikethrough');
          return;
        } else if (tool === 'line') {
          this.app.annotator.setTool('line', {
            color: this.app.annotator.color,
            strokeWidth: strokeW
          });
          this.setStatus('Line tool: drag across the page to draw a line');
        } else {
          this.app.annotator.setTool(tool, {
            color: this.app.annotator.color,
            strokeWidth: strokeW
          });
        }
        closeAllSheets();
      };
    });

    // 9. Mobile Stamps, Stroke Slider & Color Palette
    document.querySelectorAll('.m3-chip[data-m3-stamp]').forEach(chip => {
      chip.addEventListener('click', () => {
        const stampType = chip.dataset.m3Stamp;
        closeAllSheets();
        const target = this.app.getVisibleCenterTarget();
        this.app.annotator.placeStamp(target.pageNum, stampType, target.x, target.y);
        this.setStatus(`Placed ${stampType} stamp. Drag to position.`);
      });
    });

    document.getElementById('m3-stamp-custom')?.addEventListener('click', () => {
      const text = prompt('Enter custom stamp text (e.g. REVIEWED, URGENT):');
      if (text && text.trim()) {
        closeAllSheets();
        const target = this.app.getVisibleCenterTarget();
        this.app.annotator.placeStamp(target.pageNum, text.trim().toUpperCase(), target.x, target.y);
        this.setStatus(`Placed custom stamp '${text.trim()}'.`);
      }
    });

    document.getElementById('m3-stroke-slider')?.addEventListener('input', (e) => {
      const val = e.target.value;
      const disp = document.getElementById('m3-stroke-val');
      if (disp) disp.textContent = `${val}px`;
      this.app.annotator.strokeWidth = parseInt(val, 10);
      if (this.app.annotator.currentTool) {
        this.app.annotator.setTool(this.app.annotator.currentTool, {
          color: this.app.annotator.color,
          strokeWidth: parseInt(val, 10)
        });
      }
    });

    const colorDots = document.querySelectorAll('#m3-color-palette .color-dot');
    colorDots.forEach(dot => {
      dot.onclick = () => {
        colorDots.forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        this.app.annotator.color = dot.dataset.m3Color;
      };
    });

    document.getElementById('m3-custom-color')?.addEventListener('input', (e) => {
      this.app.annotator.color = e.target.value;
      document.querySelectorAll('#m3-color-palette .color-dot').forEach(d => d.classList.remove('active'));
    });

    document.getElementById('m3-sheet-clear')?.addEventListener('click', () => {
      if (confirm('Clear all annotations on current page?')) {
        const pageNum = (this.app.viewer.getCurrentVisiblePage && this.app.viewer.getCurrentVisiblePage()) || this.app.viewer.currentPage || 1;
        this.app.annotator.clearPage(pageNum);
        closeAllSheets();
        this.setStatus(`Cleared annotations on page ${pageNum}`);
        this.showToast(`Cleared page ${pageNum} annotations`, 'info');
      }
    });

    // 10. Mobile Tools Menu Actions
    document.getElementById('m3-tool-print')?.addEventListener('click', () => {
      closeAllSheets();
      this.app.exporter.printDocument();
    });
    document.getElementById('m3-tool-sign')?.addEventListener('click', () => {
      closeAllSheets();
      this.app.signature.openModal();
    });
    document.getElementById('m3-tool-watermark')?.addEventListener('click', () => {
      closeAllSheets();
      document.getElementById('modal-watermark')?.classList.add('open');
    });
    document.getElementById('m3-tool-bates')?.addEventListener('click', () => {
      closeAllSheets();
      document.getElementById('modal-bates')?.classList.add('open');
    });
    document.getElementById('m3-tool-merge')?.addEventListener('click', () => {
      closeAllSheets();
      this.app.openMergeModal();
    });
    document.getElementById('m3-tool-split')?.addEventListener('click', () => {
      closeAllSheets();
      document.getElementById('modal-split')?.classList.add('open');
    });
    document.getElementById('m3-tool-flatten')?.addEventListener('click', async () => {
      closeAllSheets();
      await this.app.flattenFormFields();
    });
    document.getElementById('m3-tool-protect')?.addEventListener('click', () => {
      closeAllSheets();
      document.getElementById('modal-protect')?.classList.add('open');
    });
    document.getElementById('m3-tool-props')?.addEventListener('click', () => {
      closeAllSheets();
      document.getElementById('btn-doc-props')?.click();
    });
    document.getElementById('m3-tool-export-img')?.addEventListener('click', async () => {
      closeAllSheets();
      try {
        const pageNum = (this.app.viewer.getCurrentVisiblePage && this.app.viewer.getCurrentVisiblePage()) || this.app.viewer.currentPage || 1;
        const img = await this.app.exporter.exportPageAsImage(pageNum);
        if (img) {
          const fileName = `page-${pageNum}.png`;
          const blob = this._dataURLtoBlob(img);
          const dlRes = await this.app.exporter.downloadFile(blob, fileName, 'image/png');
          if (dlRes?.cancelled) {
            this.setStatus('Export cancelled');
            return;
          }
          if (dlRes && dlRes.success) {
            const dest = dlRes.destination || 'Documents / Downloads folder';
            this.showExportResultModal({
              title: 'Page Exported as PNG',
              message: `Page ${pageNum} has been exported and saved.`,
              destination: dest,
              files: [{ name: fileName, size: blob.size }]
            });
            this.showToast(`Export Complete: Page ${pageNum} saved as PNG`, 'success');
          } else {
            this.showToast('Could not complete export', 'error');
          }
        } else {
          this.showToast('No PDF document loaded to export', 'error');
        }
      } catch (err) {
        this.showToast(`Export failed: ${err.message}`, 'error');
      }
    });

    document.getElementById('m3-tool-export-all-img')?.addEventListener('click', async () => {
      closeAllSheets();
      this.showToast('Exporting all pages as images...', 'info');
      try {
        const images = await this.app.exporter.exportAllPagesAsImages();
        if (images && images.length > 0) {
          const files = images.map(img => ({
            fileName: `page-${img.pageNum}.png`,
            data: this._dataURLtoBlob(img.dataUrl),
            mimeType: 'image/png'
          }));
          const dlRes = await this.app.exporter.downloadFiles(files);
          this.showExportResultModal({
            title: 'All Pages Exported',
            message: `Successfully exported ${images.length} pages as PNG images.`,
            destination: dlRes.destination || 'Documents / Downloads folder',
            files: dlRes.files || []
          });
          this.showToast(`Exported all ${images.length} pages!`, 'success');
        }
      } catch (err) {
        this.showToast(`Export failed: ${err.message}`, 'error');
      }
    });

    document.getElementById('m3-tool-extract-text')?.addEventListener('click', async () => {
      closeAllSheets();
      this.showToast('Extracting document text...', 'info');
      try {
        const text = await this.app.exporter.extractAllText();
        const baseName = (this.app.currentDocName || 'document').replace(/\.pdf$/i, '');
        const fileName = `${baseName}-text.txt`;
        const blob = new Blob([text], { type: 'text/plain' });
        const dlRes = await this.app.exporter.downloadFile(blob, fileName, 'text/plain');
        if (dlRes && dlRes.success) {
          this.showExportResultModal({
            title: 'Text Extraction Complete',
            message: `Successfully extracted full document text (${text.length} characters).`,
            destination: dlRes.destination || 'Documents / Downloads folder',
            files: [{ name: fileName, size: blob.size }]
          });
          this.showToast('Document text extracted successfully!', 'success');
        }
      } catch (err) {
        this.showToast(`Text extraction failed: ${err.message}`, 'error');
      }
    });

    document.getElementById('m3-tool-save-as')?.addEventListener('click', () => {
      closeAllSheets();
      this.app.saveAsModifiedPdf();
    });
  }

  _syncMobileDrawerContent() {
    const titleEl = document.getElementById('m3-drawer-title');
    const subEl = document.getElementById('m3-drawer-subtitle');
    if (titleEl) titleEl.textContent = this.app.currentDocName || 'Personal PDF Suite';
    if (subEl) subEl.textContent = `${this.app.viewer.totalPages || 0} pages • Page ${this.app.viewer.currentPage || 1}`;

    // Sync Thumbnails to mobile drawer (preserving canvas pixel bitmap data)
    const drawerThumbs = document.getElementById('m3-drawer-thumbs');
    const desktopThumbs = document.getElementById('thumbnails-container');
    if (drawerThumbs && desktopThumbs) {
      drawerThumbs.innerHTML = '';
      desktopThumbs.querySelectorAll('.thumbnail-item').forEach(item => {
        const pageNum = parseInt(item.id.replace('thumb-', ''), 10);
        const clone = item.cloneNode(true);
        const origCanvas = item.querySelector('canvas');
        const newCanvas = clone.querySelector('canvas');
        if (origCanvas && newCanvas) {
          if (origCanvas.width > 0 && origCanvas.height > 0) {
            newCanvas.width = origCanvas.width;
            newCanvas.height = origCanvas.height;
            const ctx = newCanvas.getContext('2d');
            ctx.drawImage(origCanvas, 0, 0);
          } else if (this.app.viewer._renderThumbnailCanvas) {
            this.app.viewer._renderThumbnailCanvas(pageNum, newCanvas);
          }
        }
        clone.onclick = () => {
          this.app.viewer.goToPage(pageNum);
          document.getElementById('m3-drawer')?.classList.remove('open');
          document.getElementById('m3-scrim')?.classList.remove('open');
        };
        drawerThumbs.appendChild(clone);
      });
    }

    // Sync Outline to mobile drawer
    const drawerOutline = document.getElementById('m3-drawer-outline');
    const desktopOutline = document.getElementById('outline-container');
    if (drawerOutline && desktopOutline) {
      drawerOutline.innerHTML = '';
      desktopOutline.querySelectorAll('.outline-item').forEach(item => {
        const clone = item.cloneNode(true);
        clone.onclick = item.onclick;
        drawerOutline.appendChild(clone);
      });
    }
  }

  _initModeTabs() {
    const tabs = document.querySelectorAll('.mode-tab');
    tabs.forEach(tab => {
      tab.onclick = () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        // Sync right tools panel
        document.querySelectorAll('.acrobat-tool-item[data-acrobat-mode]').forEach(i => {
          if (i.dataset.acrobatMode === tab.dataset.mode) i.classList.add('active');
          else i.classList.remove('active');
        });
        this.setMode(tab.dataset.mode);
      };
    });
  }

  _initSidebarTabs() {
    const tabs = document.querySelectorAll('.sidebar-tab');
    tabs.forEach(tab => {
      tab.onclick = () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        const targetPane = document.getElementById(`tab-${tab.dataset.tab}`);
        if (targetPane) targetPane.classList.add('active');

        if (tab.dataset.tab === 'outline') {
          this.syncBookmarks();
        } else if (tab.dataset.tab === 'annotations') {
          this.syncAnnotationsList();
        }
      };
    });

    const btnAddBm = document.getElementById('btn-add-bookmark');
    if (btnAddBm) {
      btnAddBm.onclick = () => {
        const pageNumInput = document.getElementById('page-num-input');
        const inputVal = pageNumInput ? parseInt(pageNumInput.value, 10) : 0;
        const visiblePage = (this.app.viewer.getCurrentVisiblePage && this.app.viewer.getCurrentVisiblePage()) || this.app.viewer.currentPage || 1;
        const totalPages = this.app.viewer.totalPages || 1;
        const pageNum = (inputVal >= 1 && inputVal <= totalPages) ? inputVal : Math.max(1, Math.min(visiblePage, totalPages));

        const defaultTitle = `Page ${pageNum} Bookmark`;
        const title = prompt(`Enter bookmark title for Page ${pageNum}:`, defaultTitle);
        if (title && title.trim()) {
          this.app.addCustomBookmark(title.trim(), pageNum);
          this.syncBookmarks();
          this.showToast(`Bookmark added for Page ${pageNum}`, 'success');
        }
      };
    }

    const btnRefreshAnnots = document.getElementById('btn-refresh-annotations');
    if (btnRefreshAnnots) {
      btnRefreshAnnots.onclick = () => {
        this.syncAnnotationsList();
        this.showToast('Annotations list updated', 'info');
      };
    }

    const btnAddAnnotSidebar = document.getElementById('btn-add-annotation-sidebar');
    if (btnAddAnnotSidebar) {
      btnAddAnnotSidebar.onclick = () => {
        this.setMode('annotate');
        this.showToast('Annotate Mode active: Select Pen ✏️, Highlighter 🖍️, Text T, or Note 💬 from the ribbon', 'info');
      };
    }

    document.getElementById('btn-start-annotating')?.addEventListener('click', () => {
      this.setMode('annotate');
      this.showToast('Annotate Mode active: Select Pen ✏️, Highlighter 🖍️, Text T, or Note 💬 from the ribbon', 'info');
    });
  }

  _initModals() {
    // Close modal triggers
    document.querySelectorAll('.modal-close, .modal-backdrop').forEach(el => {
      el.onclick = (e) => {
        if (e.target === el) {
          const backdrop = el.closest('.modal-backdrop');
          backdrop.classList.remove('open');
          // Stop any in-flight organizer thumbnail rendering.
          if (backdrop.id === 'modal-organizer' && window.app) {
            window.app._organizerRenderToken = (window.app._organizerRenderToken || 0) + 1;
          }
        }
      };
    });
  }

  _initTheme() {
    const btnTheme = document.getElementById('btn-toggle-theme');
    const themeIcon = document.getElementById('theme-icon');
    const metaTheme = document.querySelector('meta[name="theme-color"]');

    const updateThemeState = (isDark) => {
      if (isDark) {
        document.body.classList.remove('theme-light', 'theme-sepia', 'theme-night');
        document.body.classList.add('theme-dark');
        if (themeIcon) {
          themeIcon.innerHTML = `<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>`;
        }
        if (btnTheme) btnTheme.title = 'Switch to Light Mode';
        if (metaTheme) metaTheme.content = '#141318';
        localStorage.setItem('personal-pdf-theme', 'dark');
        this.setStatus('Dark theme active');
      } else {
        document.body.classList.remove('theme-dark', 'theme-sepia', 'theme-night');
        document.body.classList.add('theme-light');
        if (themeIcon) {
          themeIcon.innerHTML = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`;
        }
        if (btnTheme) btnTheme.title = 'Switch to Dark Mode';
        if (metaTheme) metaTheme.content = '#ffffff';
        localStorage.setItem('personal-pdf-theme', 'light');
        this.setStatus('Light theme active');
      }
    };

    // Load saved theme preference - default to LIGHT theme
    const saved = localStorage.getItem('personal-pdf-theme');
    if (saved === 'dark') {
      updateThemeState(true);
    } else {
      updateThemeState(false);
    }

    if (btnTheme) {
      btnTheme.onclick = () => {
        const isCurrentlyDark = document.body.classList.contains('theme-dark');
        updateThemeState(!isCurrentlyDark);
      };
    }

    // Dynamic Multi-Color Theme Accent Management
    const setAccentColor = (color, hoverColor) => {
      if (!color) return;
      const hover = hoverColor || color;
      document.documentElement.style.setProperty('--accent-color', color);
      document.documentElement.style.setProperty('--accent-color-hover', hover);
      document.documentElement.style.setProperty('--accent-red', color);
      document.documentElement.style.setProperty('--accent-red-hover', hover);

      localStorage.setItem('personal-pdf-accent-color', color);
      localStorage.setItem('personal-pdf-accent-hover', hover);

      // Update active state in all swatch buttons
      document.querySelectorAll('.accent-swatch').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.color.toLowerCase() === color.toLowerCase());
      });
      this.setStatus(`Accent theme set to ${color}`);
    };

    // Load saved accent color or default to #ea2e3f (Acrobat Red)
    const savedAccent = localStorage.getItem('personal-pdf-accent-color') || '#ea2e3f';
    const savedHover = localStorage.getItem('personal-pdf-accent-hover') || '#d22333';
    setAccentColor(savedAccent, savedHover);

    // Accent Palette Dropdown Toggle
    const btnPalette = document.getElementById('btn-accent-palette');
    const dropdown = document.getElementById('accent-palette-dropdown');

    if (btnPalette && dropdown) {
      btnPalette.onclick = (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('open');
      };

      document.addEventListener('click', (e) => {
        if (!e.target.closest('.accent-palette-wrapper')) {
          dropdown.classList.remove('open');
        }
      });
    }

    // Wire up all accent swatches (desktop dropdown + mobile drawer)
    document.querySelectorAll('.accent-swatch').forEach(swatch => {
      swatch.onclick = (e) => {
        e.stopPropagation();
        const color = swatch.dataset.color;
        const hover = swatch.dataset.hover || color;
        setAccentColor(color, hover);
        if (dropdown) dropdown.classList.remove('open');
      };
    });
  }

  setDocumentFonts(fonts = []) {
    if (!fonts || fonts.length === 0) return;
    this.documentFonts = fonts;

    const selects = [
      document.getElementById('edit-font-family'),
      document.getElementById('annot-font-family'),
      document.getElementById('m3-edit-font-family')
    ].filter(Boolean);

    selects.forEach(sel => {
      const oldGroup = sel.querySelector('optgroup[data-doc-fonts="true"]');
      if (oldGroup) oldGroup.remove();

      const group = document.createElement('optgroup');
      group.label = 'Document Embedded Fonts';
      group.dataset.docFonts = 'true';

      fonts.forEach((font, idx) => {
        const opt = document.createElement('option');
        const fl = (font || '').toLowerCase();
        let stack = `'${font}', sans-serif`;
        if (fl.includes('consolas') || fl.includes('courier') || fl.includes('mono')) {
          stack = `'${font}', 'Consolas', 'Courier New', 'Liberation Mono', monospace`;
        } else if (fl.includes('times') || fl.includes('cambria') || fl.includes('serif')) {
          stack = `'${font}', 'Cambria', 'Times New Roman', 'Liberation Serif', serif`;
        } else if (fl.includes('calibri')) {
          stack = `'${font}', 'Calibri', 'Carlito', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
        } else {
          stack = `'${font}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
        }
        opt.value = stack;
        opt.textContent = `${font} (Document)`;
        if (idx === 0) opt.selected = true;
        group.appendChild(opt);
      });

      sel.insertBefore(group, sel.firstChild);
      sel.selectedIndex = 0;
    });

    if (this.app.annotator && fonts[0]) {
      this.app.annotator.fontFamily = `'${fonts[0]}', sans-serif`;
    }
  }

  _disablePanning() {
    const container = document.getElementById('viewer-container');
    if (container) {
      container.classList.remove('hand-tool');
      if (this._onPanMouseDown) {
        container.removeEventListener('mousedown', this._onPanMouseDown);
      }
      if (this._onPanMouseMove) {
        window.removeEventListener('mousemove', this._onPanMouseMove);
      }
      if (this._onPanMouseUp) {
        window.removeEventListener('mouseup', this._onPanMouseUp);
      }
      this._isPanning = false;
    }
  }

  setMode(mode) {
    this.currentMode = mode;
    this.dynamicToolsContainer.innerHTML = '';

    // Always disable panning when entering any mode other than view
    if (mode !== 'view') {
      this._disablePanning();
    }

    // Clear any active text selection highlight when switching modes
    if (window.getSelection) {
      window.getSelection().removeAllRanges();
    }

    // Update active tab in mode ribbon and right tools panel
    document.querySelectorAll('.mode-tab').forEach(t => {
      if (t.dataset.mode === mode) t.classList.add('active');
      else t.classList.remove('active');
    });
    document.querySelectorAll('.acrobat-tool-item[data-acrobat-mode]').forEach(i => {
      if (i.dataset.acrobatMode === mode) i.classList.add('active');
      else i.classList.remove('active');
    });

    // Update body mode classes for CSS scoping (e.g. body.mode-view hides all delete buttons & editing borders)
    const modeClasses = ['mode-view', 'mode-annotate', 'mode-organize', 'mode-edit', 'mode-forms', 'mode-protect', 'mode-export'];
    modeClasses.forEach(c => document.body.classList.remove(c));
    document.body.classList.add(`mode-${mode}`);

    // Deselect any active text box or editor when switching modes
    if (this.app.annotator) {
      if (typeof this.app.annotator._deselectAllElements === 'function') {
        this.app.annotator._deselectAllElements();
      }
      if (this.app.annotator.activeTextBox) {
        this.app.annotator.activeTextBox.classList.remove('active');
        this.app.annotator.activeTextBox = null;
        this.app.annotator.onActiveTextBoxChange(null);
      }
    }

    // Toggle in-place PDF content editing
    if (this.app.viewer) {
      this.app.viewer.setContentEditingMode(mode === 'edit');
    }

    // Reset annotator tool if moving away from annotate
    if (mode !== 'annotate') {
      this.app.annotator.setTool('none');
    }

    switch (mode) {
      case 'view':
        this._renderViewTools();
        break;
      case 'annotate':
        this._renderAnnotateTools();
        break;
      case 'organize':
        this._renderOrganizeTools();
        break;
      case 'edit':
        this._renderEditTools();
        break;
      case 'forms':
        this._renderFormsTools();
        break;
      case 'protect':
        this._renderProtectTools();
        break;
      case 'export':
        this._renderExportTools();
        break;
    }
  }

  _renderViewTools() {
    this.dynamicToolsContainer.innerHTML = `
      <div class="tool-group">
        <button id="btn-tool-hand" class="tool-btn" title="Hand / Pan Tool (Click & drag to move pages)">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v6M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8M6 14a4 4 0 0 0 4 4h4a6 6 0 0 0 6-6V9a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2"/></svg>
          <span>Pan</span>
        </button>
        <button id="btn-tool-select" class="tool-btn active" title="Text Selection Tool (Select & highlight text)">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>
          <span>Select Text</span>
        </button>
      </div>
      <div class="divider"></div>
      <div class="tool-group">
        <button id="btn-copy-selection" class="tool-btn" title="Copy selected text to clipboard">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <span>Copy Text</span>
        </button>
      </div>
    `;

    const btnHand = document.getElementById('btn-tool-hand');
    const btnSelect = document.getElementById('btn-tool-select');
    const btnCopy = document.getElementById('btn-copy-selection');
    const container = document.getElementById('viewer-container');

    this._isPanning = false;
    let startX = 0, startY = 0, startScrollLeft = 0, startScrollTop = 0;

    this._onPanMouseDown = (e) => {
      if (this.currentMode !== 'view') return;
      if (e.target.closest('button, input, select, textarea, .annotation-textbox, .sticky-note-popup')) return;
      if (window.getSelection) {
        window.getSelection().removeAllRanges();
      }
      this._isPanning = true;
      startX = e.clientX;
      startY = e.clientY;
      startScrollLeft = container.scrollLeft;
      startScrollTop = container.scrollTop;
      container.style.cursor = 'grabbing';
      e.preventDefault();
    };

    this._onPanMouseMove = (e) => {
      if (!this._isPanning || this.currentMode !== 'view') return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      container.scrollLeft = startScrollLeft - dx;
      container.scrollTop = startScrollTop - dy;
    };

    this._onPanMouseUp = () => {
      if (this._isPanning) {
        this._isPanning = false;
        container.style.cursor = 'grab';
      }
    };

    btnHand.onclick = () => {
      btnHand.classList.add('active');
      btnSelect.classList.remove('active');
      container.classList.add('hand-tool');
      container.style.cursor = 'grab';

      // Immediately clear any active text selection and highlight
      if (window.getSelection) {
        window.getSelection().removeAllRanges();
      }

      document.querySelectorAll('.textLayer').forEach(tl => {
        tl.style.pointerEvents = 'none';
        tl.style.userSelect = 'none';
      });
      container.addEventListener('mousedown', this._onPanMouseDown);
      window.addEventListener('mousemove', this._onPanMouseMove);
      window.addEventListener('mouseup', this._onPanMouseUp);
      this.setStatus('Hand / Pan Tool active: click and drag anywhere to move pages');
    };

    btnSelect.onclick = () => {
      btnSelect.classList.add('active');
      btnHand.classList.remove('active');
      this._disablePanning();
      document.querySelectorAll('.textLayer').forEach(tl => {
        tl.style.pointerEvents = 'auto';
        tl.style.userSelect = 'text';
      });
      this.setStatus('Text selection active: click & drag to select and copy text');
    };

    // Prevent copy button click from stealing focus or deselecting document text
    btnCopy.onmousedown = (e) => {
      e.preventDefault();
    };

    btnCopy.onclick = async () => {
      if (btnHand.classList.contains('active')) {
        this.showToast('Switch to "Select Text" tool to select text for copying', 'info');
        return;
      }
      let selectedText = window.getSelection().toString();
      if (!selectedText) {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
          selectedText = activeEl.value || activeEl.innerText;
        }
      }

      if (!selectedText || !selectedText.trim()) {
        this.showToast('Please select some text first to copy', 'warning');
        return;
      }

      if (selectedText && selectedText.trim()) {
        // Clean encoding: replace corrupted ligatures, PUA chars, soft hyphens, and non-standard spacing
        let cleanText = selectedText
          .replace(/\uFB01/g, 'fi')
          .replace(/\uFB02/g, 'fl')
          .replace(/\uFB00/g, 'ff')
          .replace(/\uFB03/g, 'ffi')
          .replace(/\uFB04/g, 'ffl')
          .replace(/\u00AD/g, '') // Soft hyphen
          .replace(/\u200B/g, '') // Zero-width space
          .replace(/[\u2018\u2019]/g, "'")
          .replace(/[\u201C\u201D]/g, '"')
          .replace(/[\u2013\u2014]/g, '-')
          .replace(/\u00A0/g, ' ')
          .replace(/[\uE000-\uF8FF]/g, '') // Remove Private Use Area characters
          .normalize('NFC');

        // Restore corrupted ligatures (ti, tt, ft) common in PDFs with non-standard ToUnicode CMaps
        cleanText = cleanText
          .replace(/([a-zA-Z])[\uFFFD?](on\b|ons\b|ve\b|vity\b|vities\b|ng\b|ngs\b)/gi, '$1ti$2')
          .replace(/mul[\uFFFD?]ple/gi, 'multiple')
          .replace(/par[\uFFFD?]on/gi, 'partition')
          .replace(/alloca[\uFFFD?]on/gi, 'allocation')
          .replace(/loca[\uFFFD?]on/gi, 'location')
          .replace(/posi[\uFFFD?]on/gi, 'position')
          .replace(/a[\uFFFD?]er/gi, 'after')
          .replace(/swi[\uFFFD?]/gi, 'swift')
          .replace(/se[\uFFFD?]ng/gi, 'setting')
          .replace(/be[\uFFFD?]er/gi, 'better')
          .replace(/li[\uFFFD?]le/gi, 'little')
          .replace(/o[\uFFFD?]en/gi, 'often')
          .replace(/[\uFFFD]/g, '');

        try {
          await navigator.clipboard.writeText(cleanText);
          this.showToast(`Copied ${cleanText.length} characters to clipboard`, 'success');
          this.setStatus(`Copied ${cleanText.length} characters to clipboard`);
        } catch (_) {
          const ta = document.createElement('textarea');
          ta.value = cleanText;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
          this.showToast(`Copied ${cleanText.length} characters to clipboard`, 'success');
          this.setStatus(`Copied ${cleanText.length} characters to clipboard`);
        }
      } else {
        this.setStatus('No text selected. Drag mouse over document text first to select.');
      }
    };
  }

  _renderAnnotateTools() {
    this._disablePanning();
    this.dynamicToolsContainer.innerHTML = `
      <div class="tool-group">
        <button id="tool-select" class="tool-btn" title="Text Selection Tool (Select & copy text)">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>
          <span>Select</span>
        </button>
        <button id="tool-pen" class="tool-btn active" title="Freehand Pen">✏️ Pen</button>
        <button id="tool-highlighter" class="tool-btn" title="Highlighter Brush">🖍️ Highl.</button>
        <button id="tool-eraser" class="tool-btn" title="Eraser Tool (Click/drag to erase ink, shapes, textboxes, stamps)">🧼 Eraser</button>
        <button id="tool-note" class="tool-btn" title="Sticky Note">💬 Note</button>
        <button id="tool-text" class="tool-btn" title="Typewriter Text Block">T Text</button>
        <button id="tool-rect" class="tool-btn" title="Draw Rectangle">▢</button>
        <button id="tool-circle" class="tool-btn" title="Draw Circle">◯</button>
        <button id="tool-line" class="tool-btn" title="Draw Line">╱</button>
      </div>

      <div class="divider"></div>

      <!-- Quick Color Palette Swatches & Custom Color Picker -->
      <div class="tool-group annot-palette-group" title="Annotation Colors">
        <span class="annot-swatch active" data-color="#ef4444" style="background:#ef4444;" title="Red"></span>
        <span class="annot-swatch" data-color="#2563eb" style="background:#2563eb;" title="Blue"></span>
        <span class="annot-swatch" data-color="#16a34a" style="background:#16a34a;" title="Green"></span>
        <span class="annot-swatch" data-color="#eab308" style="background:#eab308;" title="Yellow"></span>
        <span class="annot-swatch" data-color="#f97316" style="background:#f97316;" title="Orange"></span>
        <span class="annot-swatch" data-color="#9333ea" style="background:#9333ea;" title="Purple"></span>
        <span class="annot-swatch" data-color="#000000" style="background:#000000;" title="Black"></span>
        <input type="color" id="annot-color" value="#ef4444" class="tool-select" style="padding:1px; width:22px; height:22px; cursor:pointer;" title="Custom Color Picker">
        <input type="number" id="annot-size" value="4" min="1" max="50" class="tool-select" style="width:40px;" title="Stroke Thickness (px)">
      </div>

      <div class="divider"></div>

      <!-- Textbox Formatting -->
      <div class="tool-group">
        <select id="annot-font-family" class="tool-select" style="max-width:115px;" title="Text Font Family">
          <option value="Inter, sans-serif" selected>Inter / Arial (Sans)</option>
          <option value="'Roboto', sans-serif">Roboto</option>
          <option value="'Segoe UI', sans-serif">Segoe UI</option>
          <option value="'Open Sans', sans-serif">Open Sans</option>
          <option value="'Lato', sans-serif">Lato</option>
          <option value="'Times New Roman', serif">Times New Roman</option>
          <option value="'Georgia', serif">Georgia</option>
          <option value="'Garamond', serif">Garamond</option>
          <option value="'Courier New', monospace">Courier New</option>
          <option value="'Consolas', monospace">Consolas</option>
          <option value="'Impact', sans-serif">Impact</option>
        </select>
        <input type="number" id="annot-font-size" value="16" min="6" max="144" class="tool-select" style="width:42px;" title="Font Size (pt)">
        <button id="btn-text-bold" class="tool-btn" title="Bold Text"><b>B</b></button>
        <button id="btn-text-italic" class="tool-btn" title="Italic Text"><i>I</i></button>
        <button id="btn-text-underline" class="tool-btn" title="Underline Text"><u>U</u></button>
        <button id="btn-text-strike" class="tool-btn" title="Strikethrough"><s>S</s></button>
        <button id="btn-text-align-left" class="tool-btn" title="Align Left">⫷</button>
        <button id="btn-text-align-center" class="tool-btn" title="Align Center">≡</button>
        <button id="btn-text-align-right" class="tool-btn" title="Align Right">⫸</button>
        <button id="btn-text-align-justify" class="tool-btn" title="Justify">▤</button>
        <button id="btn-text-delete" class="tool-btn" style="color:#ef4444;" title="Delete Active Text Box">🗑 Del</button>
      </div>

      <div class="divider"></div>

      <!-- Stamp Creation & Customization -->
      <div class="tool-group">
        <select id="annot-stamp" class="tool-select" style="max-width:105px;" title="Place or Select Stamp">
          <option value="">Stamp...</option>
          <option value="APPROVED">APPROVED</option>
          <option value="REJECTED">REJECTED</option>
          <option value="CONFIDENTIAL">CONFIDENTIAL</option>
          <option value="DRAFT">DRAFT</option>
          <option value="FINAL">FINAL</option>
          <option value="VOID">VOID</option>
          <option value="PAID">PAID</option>
          <option value="custom">+ Custom...</option>
        </select>
        <input type="color" id="stamp-color" value="#dc2626" class="tool-select" style="padding:1px; width:22px; height:22px;" title="Stamp Color">
        <input type="number" id="stamp-font-size" value="18" min="8" max="144" class="tool-select" style="width:46px;" title="Stamp Font Size (pt)">
        <select id="stamp-opacity" class="tool-select" style="width:55px;" title="Stamp Opacity">
          <option value="1.0">100%</option>
          <option value="0.85" selected>85%</option>
          <option value="0.65">65%</option>
          <option value="0.45">45%</option>
          <option value="0.25">25%</option>
        </select>
        <select id="stamp-rotation" class="tool-select" style="width:58px;" title="Stamp Angle">
          <option value="-15">-15°</option>
          <option value="-8" selected>-8°</option>
          <option value="0">0°</option>
          <option value="8">+8°</option>
          <option value="15">+15°</option>
        </select>
        <button id="btn-stamp-delete" class="tool-btn" style="color:#ef4444; display:none;" title="Delete Selected Stamp">🗑 Stamp</button>
      </div>
    `;

    if (this.documentFonts && this.documentFonts.length > 0) {
      this.setDocumentFonts(this.documentFonts);
    }

    // Palette Swatches
    const swatches = document.querySelectorAll('.annot-swatch');
    swatches.forEach(swatch => {
      swatch.onclick = () => {
        swatches.forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        const c = swatch.dataset.color;
        const colorInput = document.getElementById('annot-color');
        if (colorInput) colorInput.value = c;
        this.app.annotator.setColor(c);
      };
    });

    // Tool switching
    const tools = ['select', 'pen', 'highlighter', 'eraser', 'note', 'text', 'rect', 'circle', 'line'];
    tools.forEach(t => {
      const btn = document.getElementById(`tool-${t}`);
      if (!btn) return;
      btn.onclick = () => {
        tools.forEach(other => document.getElementById(`tool-${other}`)?.classList.remove('active'));
        btn.classList.add('active');
        
        if (t === 'select') {
          this.setAnnotationTool('select');
          this.app.annotator.setTool('select');
          const container = document.getElementById('viewer-container');
          if (container) {
            container.classList.remove('hand-tool');
            container.style.cursor = 'default';
          }
          document.querySelectorAll('.textLayer').forEach(tl => {
            tl.style.pointerEvents = 'auto';
            tl.style.userSelect = 'text';
          });
          return;
        }

        if (t === 'eraser') {
          this.app.annotator.setTool('eraser');
          this.setStatus('Eraser active: click or drag across ink, highlighters, or text boxes to erase');
          return;
        }

        if (t === 'highlighter') {
          // If current color is dark, default to bright yellow highlighter
          const curColor = document.getElementById('annot-color').value;
          if (curColor === '#000000' || curColor === '#ef4444') {
            const yellow = '#eab308';
            document.getElementById('annot-color').value = yellow;
            this.app.annotator.setColor(yellow);
            swatches.forEach(s => s.classList.toggle('active', s.dataset.color === yellow));
          }
          document.getElementById('annot-size').value = '20';
          this.app.annotator.strokeWidth = 20;
        }

        let toolName = t;
        if (t === 'rect') toolName = 'rectangle';
        this.app.annotator.setTool(toolName, {
          color: document.getElementById('annot-color').value,
          strokeWidth: parseInt(document.getElementById('annot-size').value, 10),
          fontSize: parseInt(document.getElementById('annot-font-size').value, 10),
          fontFamily: document.getElementById('annot-font-family').value
        });
        if (t === 'text') {
          this.setStatus('Click anywhere on the document to place a rich text block');
        } else if (t === 'pen') {
          this.setStatus('Freehand pen active: click & drag to draw');
        } else if (t === 'highlighter') {
          this.setStatus('Highlighter brush active: click & drag to highlight');
        } else if (t === 'note') {
          this.setStatus('Sticky Note active: click on document to place a note');
        } else if (t === 'rect') {
          this.setStatus('Rectangle tool active: click & drag to draw a box');
        } else if (t === 'circle') {
          this.setStatus('Circle tool active: click & drag to draw an oval/circle');
        } else if (t === 'line') {
          this.setStatus('Line tool active: click & drag to draw a line');
        }
      };
    });

    // Default to pen
    this.app.annotator.setTool('pen', {
      color: document.getElementById('annot-color').value,
      strokeWidth: parseInt(document.getElementById('annot-size').value, 10) || 4
    });

    const colorInput = document.getElementById('annot-color');
    const onColorUpdate = (e) => {
      const c = e.target.value;
      this.app.annotator.setColor(c);
      swatches.forEach(s => s.classList.toggle('active', s.dataset.color === c));
    };
    if (colorInput) {
      colorInput.oninput = onColorUpdate;
      colorInput.onchange = onColorUpdate;
    }

    document.getElementById('annot-size').oninput = (e) => {
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val) && val > 0) this.app.annotator.strokeWidth = val;
    };

    document.getElementById('annot-font-family').onchange = (e) => {
      this.app.annotator.setFontFamily(e.target.value);
    };

    document.getElementById('annot-font-size').oninput = (e) => {
      this.app.annotator.setFontSize(e.target.value);
    };

    document.getElementById('btn-text-bold').onclick = () => {
      const isBold = this.app.annotator.toggleBold();
      document.getElementById('btn-text-bold').classList.toggle('active', isBold);
    };

    document.getElementById('btn-text-italic').onclick = () => {
      const isItalic = this.app.annotator.toggleItalic();
      document.getElementById('btn-text-italic').classList.toggle('active', isItalic);
    };

    document.getElementById('btn-text-underline').onclick = () => {
      const isUnder = this.app.annotator.toggleUnderline();
      document.getElementById('btn-text-underline').classList.toggle('active', isUnder);
    };

    document.getElementById('btn-text-strike').onclick = () => {
      const isStrike = this.app.annotator.toggleStrikethrough();
      document.getElementById('btn-text-strike').classList.toggle('active', isStrike);
    };

    const alignButtons = {
      left: document.getElementById('btn-text-align-left'),
      center: document.getElementById('btn-text-align-center'),
      right: document.getElementById('btn-text-align-right'),
      justify: document.getElementById('btn-text-align-justify')
    };

    const setAlignActive = (align) => {
      Object.keys(alignButtons).forEach(k => {
        alignButtons[k]?.classList.toggle('active', k === align);
      });
    };

    document.getElementById('btn-text-align-left').onclick = () => {
      this.app.annotator.setTextAlign('left');
      setAlignActive('left');
    };
    document.getElementById('btn-text-align-center').onclick = () => {
      this.app.annotator.setTextAlign('center');
      setAlignActive('center');
    };
    document.getElementById('btn-text-align-right').onclick = () => {
      this.app.annotator.setTextAlign('right');
      setAlignActive('right');
    };
    document.getElementById('btn-text-align-justify').onclick = () => {
      this.app.annotator.setTextAlign('justify');
      setAlignActive('justify');
    };

    document.getElementById('btn-text-delete').onclick = () => {
      if (this.app.annotator.activeTextBox || document.querySelector('.annotation-textbox.element-selected') || document.querySelector('.annotation-textbox.active')) {
        this.app.annotator.deleteActiveTextBox();
        this.setStatus('Text box removed');
      } else {
        this.setStatus('No active text box to delete');
      }
    };

    // Stamp controls wiring
    const stampSelect = document.getElementById('annot-stamp');
    const stampColorInput = document.getElementById('stamp-color');
    const stampFontSizeInput = document.getElementById('stamp-font-size');
    const stampOpacityInput = document.getElementById('stamp-opacity');
    const stampRotationInput = document.getElementById('stamp-rotation');
    const btnStampDelete = document.getElementById('btn-stamp-delete');

    stampSelect.onchange = (e) => {
      let val = e.target.value;
      if (val === 'custom') {
        val = prompt('Enter custom stamp text:', 'CONFIDENTIAL');
        if (!val) {
          e.target.value = '';
          return;
        }
      }
      if (val) {
        const stamp = this.app.annotator.placeStamp(this.app.viewer.currentPage, val);
        if (stamp) {
          if (stampColorInput.value) this.app.annotator.setStampColor(stampColorInput.value);
          if (stampFontSizeInput.value) this.app.annotator.setStampFontSize(parseInt(stampFontSizeInput.value, 10));
          if (stampOpacityInput.value) this.app.annotator.setStampOpacity(parseFloat(stampOpacityInput.value));
          if (stampRotationInput.value) this.app.annotator.setStampRotation(parseFloat(stampRotationInput.value));
        }
        e.target.value = '';
        this.setAnnotationTool('select');
        this.setStatus('Stamp placed. Click and drag to move, use handles to resize/rotate.');
      }
    };

    stampColorInput.onchange = (e) => {
      this.app.annotator.setStampColor(e.target.value);
    };

    stampFontSizeInput.onchange = (e) => {
      this.app.annotator.setStampFontSize(e.target.value);
    };

    stampOpacityInput.onchange = (e) => {
      this.app.annotator.setStampOpacity(parseFloat(e.target.value));
    };

    stampRotationInput.onchange = (e) => {
      this.app.annotator.setStampRotation(parseFloat(e.target.value));
    };

    btnStampDelete.onclick = () => {
      this.app.annotator.deleteActiveStamp();
      this.setStatus('Stamp removed');
    };
  }

  _renderOrganizeTools() {
    this.dynamicToolsContainer.innerHTML = `
      <div class="tool-group">
        <button id="btn-open-organizer-modal" class="btn btn-sm btn-outline">
          <span>⊞ Visual Page Grid</span>
        </button>
        <button id="btn-org-add-blank" class="btn btn-sm btn-outline">+ Blank Page</button>
        <button id="btn-org-rotate-all" class="btn btn-sm btn-outline">↻ Rotate 90° CW</button>
        <button id="btn-open-merge" class="btn btn-sm btn-outline">Combine PDFs...</button>
        <button id="btn-open-split" class="btn btn-sm btn-outline">Split PDF...</button>
      </div>
    `;

    document.getElementById('btn-open-organizer-modal').onclick = () => {
      this.app.openOrganizerModal();
    };

    document.getElementById('btn-org-add-blank').onclick = async () => {
      await this.app.insertBlankPage();
    };

    document.getElementById('btn-org-rotate-all').onclick = () => {
      this.app.viewer.rotateClockwise();
    };

    document.getElementById('btn-open-merge').onclick = () => {
      this.app.openMergeModal();
    };

    document.getElementById('btn-open-split').onclick = () => {
      document.getElementById('modal-split').classList.add('open');
    };
  }

  _renderEditTools() {
    this.dynamicToolsContainer.innerHTML = `
      <div class="tool-group">
        <button id="btn-edit-inline" class="tool-btn active" title="In-Place Text Editing (Click existing text in document to edit)">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          <span>In-Place Text</span>
        </button>
        <button id="btn-edit-add-text" class="tool-btn" title="Add New Text Block">
          <span style="font-weight:700; font-size:13px; line-height:1;">T</span>
          <span>Add Text</span>
        </button>
        <button id="btn-edit-add-image" class="tool-btn" title="Insert Image onto PDF">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          <span>Image</span>
        </button>
        <button id="btn-edit-whiteout" class="tool-btn" title="Whiteout Erase">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
          <span>Whiteout</span>
        </button>
        <input type="file" id="edit-image-file-input" accept="image/png, image/jpeg" style="display:none;">
      </div>
      <div class="divider"></div>
      <div class="tool-group">
        <select id="edit-font-family" class="tool-select" style="max-width:130px;" title="Font Family">
          <option value="Inter, sans-serif" selected>Inter / Arial (Sans)</option>
          <option value="'Roboto', sans-serif">Roboto</option>
          <option value="'Segoe UI', sans-serif">Segoe UI</option>
          <option value="'Open Sans', sans-serif">Open Sans</option>
          <option value="'Lato', sans-serif">Lato</option>
          <option value="'Times New Roman', serif">Times New Roman</option>
          <option value="'Georgia', serif">Georgia</option>
          <option value="'Garamond', serif">Garamond</option>
          <option value="'Courier New', monospace">Courier New</option>
          <option value="'Consolas', monospace">Consolas</option>
          <option value="'Trebuchet MS', sans-serif">Trebuchet MS</option>
          <option value="'Verdana', sans-serif">Verdana</option>
          <option value="'Tahoma', sans-serif">Tahoma</option>
          <option value="'Comic Sans MS', cursive">Comic Sans</option>
          <option value="'Dancing Script', cursive">Dancing Script</option>
          <option value="'Impact', sans-serif">Impact</option>
        </select>
        <input type="number" id="edit-font-size" value="16" min="6" max="144" class="tool-select" style="width:48px;" title="Font Size (pt)">
        <button id="btn-edit-bold" class="tool-btn" title="Bold"><b>B</b></button>
        <button id="btn-edit-italic" class="tool-btn" title="Italic"><i>I</i></button>
        <button id="btn-edit-underline" class="tool-btn" title="Underline"><u>U</u></button>
        <button id="btn-edit-strike" class="tool-btn" title="Strikethrough"><s>S</s></button>
        <button id="btn-edit-align-left" class="tool-btn" title="Align Left">⫷</button>
        <button id="btn-edit-align-center" class="tool-btn" title="Align Center">≡</button>
        <button id="btn-edit-align-right" class="tool-btn" title="Align Right">⫸</button>
        <button id="btn-edit-align-justify" class="tool-btn" title="Justify">▤</button>
        <select id="edit-line-spacing" class="tool-select" title="Line Spacing">
          <option value="1.0">1.0x</option>
          <option value="1.25" selected>1.25x</option>
          <option value="1.5">1.5x</option>
          <option value="2.0">2.0x</option>
        </select>
        <input type="color" id="edit-font-color" value="#000000" class="tool-select" style="padding:1px; width:26px; height:26px;" title="Text Color">
        <button id="btn-edit-delete-box" class="tool-btn" style="color:#ef4444;" title="Delete Selected Text Box">🗑 Del</button>
      </div>
      <div class="divider"></div>
      <div class="tool-group">
        <button id="btn-open-watermark" class="btn btn-sm btn-outline">Watermark</button>
        <button id="btn-open-bates" class="btn btn-sm btn-outline">Bates Numbers</button>
      </div>
    `;

    if (this.documentFonts && this.documentFonts.length > 0) {
      this.setDocumentFonts(this.documentFonts);
    }

    const btnInline = document.getElementById('btn-edit-inline');
    const btnText = document.getElementById('btn-edit-add-text');
    const btnImg = document.getElementById('btn-edit-add-image');
    const btnWhiteout = document.getElementById('btn-edit-whiteout');
    const imgInput = document.getElementById('edit-image-file-input');

    // 1. In-place content editing
    btnInline.onclick = () => {
      btnInline.classList.add('active');
      btnText.classList.remove('active');
      btnImg.classList.remove('active');
      btnWhiteout.classList.remove('active');
      this.app.viewer.setContentEditingMode(true);
      this.app.annotator.setTool('none');
      this.setStatus('In-place edit: click any existing text in the document to edit directly');
    };

    // 2. Add New Text Block
    btnText.onclick = () => {
      btnText.classList.add('active');
      btnInline.classList.remove('active');
      btnImg.classList.remove('active');
      btnWhiteout.classList.remove('active');
      this.app.viewer.setContentEditingMode(false);
      this.app.annotator.clearActiveEditing();
      this.app.annotator.setTool('text', {
        fontSize: parseInt(document.getElementById('edit-font-size').value, 10) || 16,
        fontFamily: document.getElementById('edit-font-family').value,
        color: document.getElementById('edit-font-color').value
      });
      this.setStatus('Click anywhere on the document to place a new text block');
    };

    // 3. Add Image
    btnImg.onclick = () => {
      imgInput.click();
    };

    imgInput.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          this.app.insertImageOnPage(undefined, evt.target.result);
          this.setStatus('Image placed in current view. Drag and resize as needed.');
        };
        reader.readAsDataURL(file);
      }
    };

    // 4. Whiteout
    btnWhiteout.onclick = () => {
      btnWhiteout.classList.add('active');
      btnInline.classList.remove('active');
      btnText.classList.remove('active');
      btnImg.classList.remove('active');
      const target = this.app.getVisibleCenterTarget();
      this.app.insertWhiteoutOnPage(target.pageNum, target.x, target.y);
      this.setStatus('Whiteout box placed. Move over unwanted text to cover it.');
    };

    // Font updates wired directly to active text box
    document.getElementById('edit-font-family').onchange = (e) => {
      this.app.annotator.setFontFamily(e.target.value);
    };
    document.getElementById('edit-font-size').oninput = (e) => {
      this.app.annotator.setFontSize(e.target.value);
    };
    document.getElementById('edit-font-color').onchange = (e) => {
      this.app.annotator.setColor(e.target.value);
    };

    // Prevent focus loss from active text box when clicking formatting toolbar buttons
    const formatBtnIds = [
      'btn-edit-bold', 'btn-edit-italic', 'btn-edit-underline', 'btn-edit-strike',
      'btn-edit-align-left', 'btn-edit-align-center', 'btn-edit-align-right', 'btn-edit-align-justify'
    ];
    formatBtnIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.onmousedown = (e) => e.preventDefault();
    });

    document.getElementById('btn-edit-bold').onclick = () => {
      const isBold = this.app.annotator.toggleBold();
      document.getElementById('btn-edit-bold').classList.toggle('active', isBold);
    };
    document.getElementById('btn-edit-italic').onclick = () => {
      const isItalic = this.app.annotator.toggleItalic();
      document.getElementById('btn-edit-italic').classList.toggle('active', isItalic);
    };
    document.getElementById('btn-edit-underline').onclick = () => {
      const isUnder = this.app.annotator.toggleUnderline();
      document.getElementById('btn-edit-underline').classList.toggle('active', isUnder);
    };
    document.getElementById('btn-edit-strike').onclick = () => {
      const isStrike = this.app.annotator.toggleStrikethrough();
      document.getElementById('btn-edit-strike').classList.toggle('active', isStrike);
    };
    document.getElementById('btn-edit-align-left').onclick = () => {
      this.app.annotator.setTextAlign('left');
    };
    document.getElementById('btn-edit-align-center').onclick = () => {
      this.app.annotator.setTextAlign('center');
    };
    document.getElementById('btn-edit-align-right').onclick = () => {
      this.app.annotator.setTextAlign('right');
    };
    document.getElementById('btn-edit-align-justify').onclick = () => {
      this.app.annotator.setTextAlign('justify');
    };
    document.getElementById('edit-line-spacing').onchange = (e) => {
      this.app.annotator.setLineHeight(parseFloat(e.target.value));
    };
    document.getElementById('btn-edit-delete-box').onclick = () => {
      this.app.annotator.deleteActiveTextBox();
      this.setStatus('Text box removed');
    };

    // Modals
    document.getElementById('btn-open-watermark').onclick = () => {
      document.getElementById('modal-watermark').classList.add('open');
    };

    document.getElementById('btn-open-bates').onclick = () => {
      document.getElementById('modal-bates').classList.add('open');
    };

    // Default activate in-place editing
    btnInline.click();
  }

  syncInPlaceSpan(span) {
    if (!span) return;
    this.syncActiveTextBox(span);
  }

  syncActiveTextBox(box) {
    const boldBtn = document.getElementById('btn-edit-bold') || document.getElementById('btn-text-bold');
    const italicBtn = document.getElementById('btn-edit-italic') || document.getElementById('btn-text-italic');
    const underlineBtn = document.getElementById('btn-edit-underline') || document.getElementById('btn-text-underline');
    const strikeBtn = document.getElementById('btn-edit-strike') || document.getElementById('btn-text-strike');
    const alignLeftBtn = document.getElementById('btn-text-align-left');
    const alignCenterBtn = document.getElementById('btn-text-align-center');
    const alignRightBtn = document.getElementById('btn-text-align-right');
    const alignJustifyBtn = document.getElementById('btn-text-align-justify');

    if (!box) {
      boldBtn?.classList.remove('active');
      italicBtn?.classList.remove('active');
      underlineBtn?.classList.remove('active');
      strikeBtn?.classList.remove('active');
      alignLeftBtn?.classList.remove('active');
      alignCenterBtn?.classList.remove('active');
      alignRightBtn?.classList.remove('active');
      alignJustifyBtn?.classList.remove('active');
      return;
    }

    const targetEl = box.querySelector?.('.textbox-content') || box;
    const cs = window.getComputedStyle(targetEl);
    const fontFamEl = document.getElementById('edit-font-family') || document.getElementById('annot-font-family');
    const fontSizeEl = document.getElementById('edit-font-size') || document.getElementById('annot-font-size');
    const colorEl = document.getElementById('edit-font-color') || document.getElementById('annot-color');

    if (fontFamEl) {
      const activeFont = targetEl.style.fontFamily || cs.fontFamily;
      if (activeFont) {
        let found = false;
        const cleanFont = activeFont.split(',')[0].replace(/['"]/g, '').trim().toLowerCase();
        for (let i = 0; i < fontFamEl.options.length; i++) {
          const optVal = fontFamEl.options[i].value.toLowerCase();
          const optText = fontFamEl.options[i].text.toLowerCase();
          if (optVal.includes(cleanFont) || optText.includes(cleanFont)) {
            fontFamEl.selectedIndex = i;
            found = true;
            break;
          }
        }
        if (!found && cleanFont) {
          const displayFont = activeFont.split(',')[0].replace(/['"]/g, '').trim();
          const opt = new Option(`PDF Font: ${displayFont}`, activeFont, true, true);
          fontFamEl.add(opt, 0);
          fontFamEl.selectedIndex = 0;
        }
      }
    }

    if (fontSizeEl) {
      const fSize = parseInt(targetEl.style.fontSize || cs.fontSize, 10);
      if (fSize) fontSizeEl.value = fSize.toString();
    }
    if (colorEl) {
      const colorVal = targetEl.style.color || cs.color;
      if (colorVal && colorVal.startsWith('rgb')) {
        const rgb = colorVal.match(/\d+/g);
        if (rgb && rgb.length >= 3) {
          const hex = '#' + ((1 << 24) + (parseInt(rgb[0], 10) << 16) + (parseInt(rgb[1], 10) << 8) + parseInt(rgb[2], 10)).toString(16).slice(1);
          colorEl.value = hex;
        }
      }
    }
    if (boldBtn) {
      const isBold = targetEl.style.fontWeight === 'bold' || parseInt(cs.fontWeight, 10) >= 700;
      boldBtn.classList.toggle('active', isBold);
    }
    if (italicBtn) {
      const isItalic = targetEl.style.fontStyle === 'italic';
      italicBtn.classList.toggle('active', isItalic);
    }
    if (underlineBtn) {
      const isUnder = (targetEl.style.textDecoration || cs.textDecoration || '').includes('underline');
      underlineBtn.classList.toggle('active', isUnder);
    }
    if (strikeBtn) {
      const isStrike = (targetEl.style.textDecoration || cs.textDecoration || '').includes('line-through');
      strikeBtn.classList.toggle('active', isStrike);
    }

    const currentAlign = targetEl.style.textAlign || cs.textAlign || 'left';
    alignLeftBtn?.classList.toggle('active', currentAlign === 'left');
    alignCenterBtn?.classList.toggle('active', currentAlign === 'center');
    alignRightBtn?.classList.toggle('active', currentAlign === 'right');
    alignJustifyBtn?.classList.toggle('active', currentAlign === 'justify');
  }

  syncActiveStamp(stamp) {
    const stampSelect = document.getElementById('annot-stamp');
    const stampColorInput = document.getElementById('stamp-color');
    const stampFontSizeInput = document.getElementById('stamp-font-size');
    const stampOpacityInput = document.getElementById('stamp-opacity');
    const stampRotationInput = document.getElementById('stamp-rotation');
    const btnStampDelete = document.getElementById('btn-stamp-delete');

    if (!stamp) {
      if (btnStampDelete) btnStampDelete.style.display = 'none';
      return;
    }

    if (btnStampDelete) btnStampDelete.style.display = 'inline-flex';
    const badge = stamp.querySelector('.stamp-badge');
    if (!badge) return;

    if (stampSelect) {
      const txt = (badge.textContent || '').trim().toUpperCase();
      let matched = false;
      for (let i = 0; i < stampSelect.options.length; i++) {
        if (stampSelect.options[i].value === txt) {
          stampSelect.selectedIndex = i;
          matched = true;
          break;
        }
      }
      if (!matched) {
        stampSelect.value = '';
      }
    }

    if (stampColorInput) {
      const cs = window.getComputedStyle(badge);
      const colorVal = badge.style.color || cs.color;
      if (colorVal && colorVal.startsWith('rgb')) {
        const rgb = colorVal.match(/\d+/g);
        if (rgb && rgb.length >= 3) {
          const hex = '#' + ((1 << 24) + (parseInt(rgb[0], 10) << 16) + (parseInt(rgb[1], 10) << 8) + parseInt(rgb[2], 10)).toString(16).slice(1);
          stampColorInput.value = hex;
        }
      } else if (colorVal && colorVal.startsWith('#')) {
        stampColorInput.value = colorVal;
      }
    }

    if (stampOpacityInput) {
      const cs = window.getComputedStyle(badge);
      const op = badge.style.opacity || cs.opacity || '0.85';
      const num = parseFloat(op);
      // Pick nearest option
      let closest = stampOpacityInput.options[0]?.value;
      let minDiff = Infinity;
      for (let i = 0; i < stampOpacityInput.options.length; i++) {
        const diff = Math.abs(parseFloat(stampOpacityInput.options[i].value) - num);
        if (diff < minDiff) {
          minDiff = diff;
          closest = stampOpacityInput.options[i].value;
        }
      }
      if (closest) stampOpacityInput.value = closest;
    }

    if (stampFontSizeInput) {
      const cs = window.getComputedStyle(badge);
      const size = parseInt(badge.style.fontSize || cs.fontSize, 10);
      if (!isNaN(size)) stampFontSizeInput.value = String(size);
    }

    if (stampRotationInput) {
      const rot = badge.dataset.rotation || '-8';
      stampRotationInput.value = rot;
    }
  }

  _renderFormsTools() {
    this.dynamicToolsContainer.innerHTML = `
      <div class="tool-group">
        <button id="btn-open-signature-tool" class="btn btn-sm btn-primary">
          <span>✍️ Place Signature</span>
        </button>
        <button id="btn-flatten-form" class="btn btn-sm btn-outline">Flatten Form</button>
      </div>
    `;

    document.getElementById('btn-open-signature-tool').onclick = () => {
      this.app.signature.openModal();
    };

    document.getElementById('btn-flatten-form').onclick = async () => {
      await this.app.flattenFormFields();
    };
  }

  _renderProtectTools() {
    this.dynamicToolsContainer.innerHTML = `
      <div class="tool-group">
        <button id="btn-open-protect" class="btn btn-sm btn-outline">🔒 Encrypt with Password</button>
        <button id="btn-add-redact" class="btn btn-sm btn-danger">■ Add Redaction Box</button>
      </div>
    `;

    document.getElementById('btn-open-protect').onclick = () => {
      document.getElementById('modal-protect').classList.add('open');
    };

    document.getElementById('btn-add-redact').onclick = () => {
      this.app.security.addRedactionBox(this.app.viewer.currentPage, 150, 150);
      this.setStatus('Redaction box placed. Double-click to remove.');
    };
  }

  _renderExportTools() {
    this.dynamicToolsContainer.innerHTML = `
      <div class="tool-group">
        <button id="btn-export-page-img" class="tool-btn" title="Export Current Page as High-Resolution PNG">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          <span>Export Page (PNG)</span>
        </button>
        <button id="btn-export-text" class="tool-btn" title="Extract All Document Text as TXT file">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          <span>Extract All Text (TXT)</span>
        </button>
      </div>
    `;

    document.getElementById('btn-export-page-img').onclick = async () => {
      try {
        const pageNum = (this.app.viewer.getCurrentVisiblePage && this.app.viewer.getCurrentVisiblePage()) || this.app.viewer.currentPage || 1;
        this.setStatus(`Exporting page ${pageNum} as PNG...`);
        const img = await this.app.exporter.exportPageAsImage(pageNum);
        if (img) {
          const fileName = `page-${pageNum}.png`;
          const blob = this._dataURLtoBlob(img);
          const dlRes = await this.app.exporter.downloadFile(
            blob,
            fileName,
            'image/png'
          );
          if (dlRes?.cancelled) {
            this.setStatus('Export cancelled');
            return;
          }
          if (dlRes && dlRes.success) {
            const dest = dlRes.destination || 'Downloads folder';
            this.showExportResultModal({
              title: 'Page Exported as PNG',
              message: `Page ${pageNum} has been exported and saved.`,
              destination: dest,
              files: [{ name: fileName, size: blob.size }]
            });
            this.showToast(`Export Complete: Page ${pageNum} saved as ${fileName}`, 'success');
            this.setStatus(`Exported Page ${pageNum} successfully as PNG`);
          } else {
            this.showToast('Could not complete export', 'error');
          }
        } else {
          this.showToast('No PDF document loaded to export', 'error');
        }
      } catch (err) {
        console.error('Export PNG failed:', err);
        this.showToast(`Export PNG failed: ${err.message}`, 'error');
        this.setStatus(`Export PNG error: ${err.message}`);
      }
    };

    document.getElementById('btn-export-text').onclick = async () => {
      try {
        this.setStatus('Extracting document text...');
        const text = await this.app.exporter.extractAllText();
        const baseName = (this.app.currentDocName || 'document').replace(/\.pdf$/i, '');
        const fileName = `${baseName}-text.txt`;
        const blob = new Blob([text], { type: 'text/plain' });
        const dlRes = await this.app.exporter.downloadFile(blob, fileName, 'text/plain');
        if (dlRes?.cancelled) {
          this.setStatus('Text extraction cancelled');
          return;
        }
        if (dlRes && dlRes.success) {
          const dest = dlRes.destination || 'Downloads folder';
          this.showExportResultModal({
            title: 'Text Export Complete',
            message: `Document text successfully extracted (${text.length} characters).`,
            destination: dest,
            files: [{ name: fileName, size: blob.size }]
          });
          this.showToast(`Export Complete: All text saved to ${fileName}`, 'success');
          this.setStatus(`Exported text (${text.length} characters) successfully`);
        } else {
          this.showToast('Could not save extracted text', 'error');
        }
      } catch (err) {
        console.error('Export text failed:', err);
        this.showToast(`Export text failed: ${err.message}`, 'error');
        this.setStatus(`Export text error: ${err.message}`);
      }
    };
  }

  showExportResultModal({ title = 'Export Complete', message = 'File(s) processed successfully.', destination = 'Documents folder', files = [] } = {}) {
    let modal = document.getElementById('modal-export-result');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modal-export-result';
      modal.className = 'modal-backdrop';
      modal.innerHTML = `
        <div class="modal-box">
          <div class="modal-header">
            <h3 id="export-result-title">${title}</h3>
            <button class="modal-close">&times;</button>
          </div>
          <div class="modal-body">
            <div style="display:flex; align-items:center; gap:14px; margin-bottom:14px;">
              <div style="width:42px; height:42px; border-radius:50%; background:rgba(34,197,94,0.15); color:#16a34a; display:flex; align-items:center; justify-content:center; font-size:22px; font-weight:bold; flex-shrink:0;">✔</div>
              <div>
                <p id="export-result-message" style="margin:0; font-weight:500; font-size:14px; color:var(--text-primary);">${message}</p>
                <p style="margin:4px 0 0 0; font-size:12px; color:var(--text-secondary);">Saved location:</p>
                <div id="export-result-destination" style="display:inline-block; margin-top:2px; padding:4px 10px; border-radius:4px; background:var(--bg-main); border:1px solid var(--border-color); font-family:monospace; font-size:12px; color:var(--accent-color); word-break:break-all;">${destination}</div>
              </div>
            </div>
            <div style="margin-top:12px;">
              <label style="font-size:12px; font-weight:600; text-transform:uppercase; color:var(--text-secondary);">Saved Files (<span id="export-result-count">${files.length}</span>):</label>
              <ul id="export-result-list" style="list-style:none; padding:0; margin:6px 0 0 0; max-height:160px; overflow-y:auto; border:1px solid var(--border-color); border-radius:6px; background:var(--bg-main);">
              </ul>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-primary modal-close" style="min-width:90px;">Done</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      modal.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => modal.classList.remove('open'));
      });
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('open');
      });
    }

    const titleEl = document.getElementById('export-result-title');
    const msgEl = document.getElementById('export-result-message');
    const destEl = document.getElementById('export-result-destination');
    const countEl = document.getElementById('export-result-count');
    const listEl = document.getElementById('export-result-list');

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    if (destEl) destEl.textContent = destination;
    if (countEl) countEl.textContent = files.length;

    if (listEl) {
      listEl.innerHTML = '';
      if (files.length === 0) {
        listEl.innerHTML = '<li style="padding:8px 12px; font-size:12px; color:var(--text-secondary);">No files</li>';
      } else {
        files.forEach(f => {
          const li = document.createElement('li');
          li.style.cssText = 'padding:6px 12px; border-bottom:1px solid var(--border-color); font-size:12px; display:flex; justify-content:space-between; align-items:center;';
          const sizeKb = f.size ? (f.size > 1024 * 1024 ? `${(f.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(f.size / 1024)} KB`) : '';
          const nameSpan = document.createElement('span');
          nameSpan.style.cssText = 'font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:70%;';
          nameSpan.textContent = f.name || 'document.pdf';
          const sizeSpan = document.createElement('span');
          sizeSpan.style.cssText = 'color:var(--text-secondary); font-family:monospace; font-size:11px;';
          sizeSpan.textContent = sizeKb;
          li.appendChild(nameSpan);
          li.appendChild(sizeSpan);
          listEl.appendChild(li);
        });
      }
    }

    modal.classList.add('open');
  }

  showToast(msg, type = 'info') {
    let container = document.getElementById('app-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'app-toast-container';
      container.className = 'app-toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `app-toast toast-${type}`;
    const icon = type === 'success' ? '✔' : type === 'error' ? '✖' : 'ℹ';
    toast.textContent = `${icon} ${msg}`;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  syncBookmarks() {
    const container = document.getElementById('outline-container');
    if (!container) return;
    const customBms = this.app.customBookmarks || [];
    const docOutline = this.app.viewer?.documentOutline;

    container.innerHTML = '';

    // Section 1: User's Custom Bookmarks
    if (customBms.length > 0) {
      const customHeader = document.createElement('div');
      customHeader.className = 'bookmark-section-header';
      customHeader.innerHTML = `<span>My Bookmarks</span> <span style="font-weight:normal; opacity:0.8;">(${customBms.length})</span>`;
      container.appendChild(customHeader);

      customBms.forEach((bm, idx) => {
        const item = document.createElement('div');
        item.className = 'bookmark-list-item';
        item.innerHTML = `
          <div class="bookmark-list-left">
            <span>🔖</span>
            <span class="bookmark-title" title="${bm.title}">${bm.title}</span>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <span class="annot-page-badge" style="cursor:pointer;">Page ${bm.pageNum}</span>
            <button class="bookmark-delete-btn" title="Delete Bookmark">&times;</button>
          </div>
        `;
        item.onclick = (e) => {
          if (e.target.classList.contains('bookmark-delete-btn')) {
            e.stopPropagation();
            this.app.customBookmarks.splice(idx, 1);
            this.syncBookmarks();
            this.showToast('Bookmark removed', 'info');
            return;
          }
          this.app.viewer.goToPage(bm.pageNum);
        };
        container.appendChild(item);
      });
    }

    // Section 2: Original PDF Document Outline
    if (docOutline && docOutline.length > 0) {
      const docHeader = document.createElement('div');
      docHeader.className = 'bookmark-section-header';
      docHeader.textContent = 'Document Outline';
      container.appendChild(docHeader);

      const list = document.createElement('div');
      list.className = 'outline-list';
      
      const renderItem = async (item, depth = 0) => {
        const div = document.createElement('div');
        div.className = 'outline-item';
        div.style.paddingLeft = `${8 + depth * 12}px`;
        div.textContent = item.title;
        div.onclick = async () => {
          if (typeof item.dest === 'string') {
            const dest = await this.app.viewer.pdfDoc.getDestination(item.dest);
            const pageIndex = await this.app.viewer.pdfDoc.getPageIndex(dest[0]);
            this.app.viewer.goToPage(pageIndex + 1);
          } else if (Array.isArray(item.dest)) {
            const pageIndex = await this.app.viewer.pdfDoc.getPageIndex(item.dest[0]);
            this.app.viewer.goToPage(pageIndex + 1);
          }
        };
        list.appendChild(div);

        if (item.items && item.items.length > 0) {
          for (const sub of item.items) {
            await renderItem(sub, depth + 1);
          }
        }
      };

      for (const item of docOutline) {
        renderItem(item);
      }
      container.appendChild(list);
    }

    if (customBms.length === 0 && (!docOutline || docOutline.length === 0)) {
      container.innerHTML = '<div class="empty-state">No bookmarks found.<br>Click "+ Add" above to bookmark the current page.</div>';
    }
  }

  syncAnnotationsList() {
    const list = document.getElementById('annotations-list');
    if (!list) return;
    list.innerHTML = '';

    const items = [];
    const totalPages = this.app.viewer?.totalPages || 0;

    // 1. Text boxes, sticky notes, stamps and in-place edits from the page DOM.
    const wrappers = Array.from(document.querySelectorAll('.page-wrapper'));
    wrappers.sort((a, b) => {
      const na = parseInt(a.dataset.pageNumber || a.id.replace('page-wrapper-', ''), 10) || 0;
      const nb = parseInt(b.dataset.pageNumber || b.id.replace('page-wrapper-', ''), 10) || 0;
      return na - nb;
    });

    const shortText = (value, max = 28) => {
      const text = String(value || '').replace(/\s+/g, ' ').trim();
      return text.length > max ? `${text.substring(0, max)}…` : text;
    };

    wrappers.forEach(w => {
      const pageNum = parseInt(w.dataset.pageNumber || w.id.replace('page-wrapper-', ''), 10) || 1;

      // Textboxes
      w.querySelectorAll('.annotation-textbox:not(.in-place-editor)').forEach(tb => {
        const content = tb.querySelector('.textbox-content') || tb;
        const text = shortText(content.innerText || content.textContent);
        items.push({
          type: 'text',
          icon: 'T',
          label: text ? `Text box: “${text}”` : 'Empty text box',
          pageNum,
          el: tb
        });
      });

      // Sticky notes
      w.querySelectorAll('.sticky-note, .sticky-note-container').forEach(note => {
        const text = shortText(note.querySelector('textarea')?.value || '');
        items.push({
          type: 'note',
          icon: '💬',
          label: text ? `Note: “${text}”` : 'Sticky note',
          pageNum,
          el: note
        });
      });

      // Stamps / signatures
      w.querySelectorAll('.placed-stamp').forEach(stamp => {
        const badge = stamp.querySelector('.stamp-badge');
        items.push({
          type: 'stamp',
          icon: '✍️',
          label: badge ? `Stamp: ${shortText(badge.textContent)}` : 'Stamp / Signature',
          pageNum,
          el: stamp
        });
      });

      // In-place text edits
      w.querySelectorAll('.textLayer span.in-place-modified, .textLayer span.inline-editing').forEach(span => {
        items.push({
          type: 'edit',
          icon: '📝',
          label: `Edited text: “${shortText(span.innerText || span.textContent)}”`,
          pageNum,
          el: span
        });
      });
    });

    // 2. Canvas markup (highlighter, pen, shapes, underline, strikethrough).
    //    Group by page + type so highlighted pages always appear here, even
    //    when the user used the highlighter brush instead of a text markup.
    const annotator = this.app.annotator;
    if (annotator?.annotations) {
      const typeMeta = {
        highlighter: { icon: '🖍️', label: 'Highlight' },
        pen: { icon: '✏️', label: 'Freehand drawing' },
        rectangle: { icon: '▭', label: 'Rectangle' },
        circle: { icon: '◯', label: 'Circle' },
        line: { icon: '╱', label: 'Line' },
        arrow: { icon: '➜', label: 'Arrow' },
        underline: { icon: 'U̲', label: 'Underline markup' },
        strikethrough: { icon: 'S̶', label: 'Strikethrough markup' }
      };

      const orderedPages = Array.from(annotator.annotations.entries())
        .map(([pageNum, annots]) => [parseInt(pageNum, 10), annots])
        .filter(([pageNum, annots]) => Number.isFinite(pageNum) &&
          (!totalPages || (pageNum >= 1 && pageNum <= totalPages)) &&
          Array.isArray(annots) && annots.length > 0)
        .sort((a, b) => a[0] - b[0]);

      for (const [pageNum, annots] of orderedPages) {
        const counts = new Map();
        annots.forEach(a => {
          const type = typeMeta[a?.type] ? a.type : 'pen';
          counts.set(type, (counts.get(type) || 0) + 1);
        });
        for (const [type, count] of counts) {
          const meta = typeMeta[type];
          items.push({
            type: type === 'highlighter' ? 'highlight' : type,
            icon: meta.icon,
            label: `${meta.label} (${count})`,
            pageNum,
            el: document.getElementById(`annot-canvas-${pageNum}`)
          });
        }
      }
    }

    if (items.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          No annotations added yet.<br>
          Use the Highlighter 🖍️, Pen ✏️, Text T or Note 💬 tools, then return here to see every marked page.<br>
          <button id="btn-start-annotating" class="btn btn-primary btn-sm" style="margin-top:10px; cursor:pointer;">✏️ Start Annotating</button>
        </div>
      `;
      document.getElementById('btn-start-annotating')?.addEventListener('click', () => {
        this.setMode('annotate');
        this.showToast('Annotate Mode active: Select Pen ✏️, Highlighter 🖍️, Text T, or Note 💬 from the ribbon', 'info');
      });
      return;
    }

    const typeOrder = {
      highlight: 0, underline: 1, strikethrough: 2, ink: 3, pen: 3,
      rectangle: 4, circle: 4, line: 4, arrow: 4,
      text: 5, note: 6, stamp: 7, edit: 8
    };
    items.sort((a, b) => a.pageNum - b.pageNum ||
      ((typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9)) ||
      a.label.localeCompare(b.label));

    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'annot-list-item';
      row.dataset.page = String(item.pageNum);
      row.dataset.type = item.type;

      const left = document.createElement('div');
      left.className = 'annot-list-left';
      const icon = document.createElement('span');
      icon.textContent = item.icon;
      const label = document.createElement('span');
      // textContent keeps document/user text from being parsed as markup.
      label.textContent = item.label;
      left.appendChild(icon);
      left.appendChild(label);

      const badge = document.createElement('span');
      badge.className = 'annot-page-badge';
      badge.textContent = `Page ${item.pageNum}`;

      row.appendChild(left);
      row.appendChild(badge);

      row.onclick = () => {
        this.app.viewer.goToPage(item.pageNum);
        if (item.el) {
          item.el.style.transition = 'box-shadow 0.3s ease';
          item.el.style.boxShadow = '0 0 0 3px #ef4444';
          setTimeout(() => {
            if (item.el) item.el.style.boxShadow = '';
          }, 1500);
        }
      };
      list.appendChild(row);
    });
  }

  _dataURLtoBlob(dataurl) {
    const arr = dataurl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  }

  setStatus(msg) {
    const el = document.getElementById('status-message');
    if (el) el.textContent = msg;
  }

  setAnnotationTool(toolName) {
    const tools = ['select', 'pen', 'highlighter', 'eraser', 'note', 'text', 'rect', 'circle', 'line'];
    tools.forEach(t => {
      const btn = document.getElementById(`tool-${t}`);
      if (btn) btn.classList.toggle('active', t === toolName);
    });
    document.querySelectorAll('[data-m3-tool]').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.m3Tool === toolName);
    });
    if (toolName === 'select' || toolName === 'none') {
      const container = document.getElementById('viewer-container');
      if (container) {
        container.classList.remove('hand-tool');
        container.style.cursor = 'default';
      }
      document.querySelectorAll('.textLayer').forEach(tl => {
        tl.style.pointerEvents = 'auto';
        tl.style.userSelect = 'text';
      });
      this.setStatus('Text selection active: click & drag to select and copy text');
    }
  }

  setZoomStatus(zoomText) {
    const el = document.getElementById('status-zoom');
    if (el) el.textContent = zoomText;
  }
}

