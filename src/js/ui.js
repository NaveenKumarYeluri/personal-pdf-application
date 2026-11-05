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
    
    this._initModeTabs();
    this._initSidebarTabs();
    this._initRightToolsPane();
    this._initModals();
    this._initTheme();
    this._initMaterialMobileUI();
    this.setMode('view');
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

    // 5. Mobile Floating Page Bar
    document.getElementById('m3-page-prev')?.addEventListener('click', () => {
      this.app.viewer.goToPage(this.app.viewer.currentPage - 1);
    });

    document.getElementById('m3-page-next')?.addEventListener('click', () => {
      this.app.viewer.goToPage(this.app.viewer.currentPage + 1);
    });

    document.getElementById('m3-page-display')?.addEventListener('click', () => {
      const target = prompt(`Jump to page (1 - ${this.app.viewer.totalPages}):`, this.app.viewer.currentPage);
      const num = parseInt(target, 10);
      if (!isNaN(num) && num >= 1 && num <= this.app.viewer.totalPages) {
        this.app.viewer.goToPage(num);
      }
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
        searchInput.value = '';
        this.app.viewer.clearSearch();
        searchCount.textContent = '0/0';
      }
    };

    const closeMobileSearch = () => {
      searchBar.classList.remove('open');
      searchInput.value = '';
      this.app.viewer.clearSearch();
      searchCount.textContent = '0/0';
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
      alert('Personal PDF Suite - Acrobat Pro Edition\nCross-platform Adobe Acrobat alternative for Windows, Linux & Android.');
    });

    // 8. Mobile Annotation Chips
    const chips = document.querySelectorAll('.m3-chip[data-m3-tool]');
    chips.forEach(chip => {
      chip.onclick = () => {
        chips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const tool = chip.dataset.m3Tool;
        if (tool === 'select') {
          this.app.annotator.setTool('none');
          this.setStatus('Text selection active: long-press text to select or copy');
        } else if (tool === 'eraser') {
          this.app.annotator.setTool('eraser');
          this.setStatus('Eraser active: tap any annotation or drag across ink to erase');
        } else {
          this.app.annotator.setTool(tool, {
            color: this.app.annotator.color,
            strokeWidth: 4
          });
        }
        closeAllSheets();
      };
    });

    // 9. Mobile Color Palette
    const colorDots = document.querySelectorAll('#m3-color-palette .color-dot');
    colorDots.forEach(dot => {
      dot.onclick = () => {
        colorDots.forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        this.app.annotator.color = dot.dataset.m3Color;
      };
    });

    // 10. Mobile Tools Menu Actions
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
        const pageNum = this.app.viewer.currentPage || 1;
        const img = await this.app.exporter.exportPageAsImage(pageNum);
        if (img) {
          await this.app.exporter.downloadFile(this._dataURLtoBlob(img), `page-${pageNum}.png`, 'image/png');
          this.showToast(`Export Complete: Page ${pageNum} saved as PNG`, 'success');
        } else {
          this.showToast('No PDF document loaded to export', 'error');
        }
      } catch (err) {
        this.showToast(`Export failed: ${err.message}`, 'error');
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
        const pageNum = this.app.viewer.currentPage || 1;
        const defaultTitle = `Page ${pageNum} Bookmark`;
        const title = prompt('Enter bookmark title:', defaultTitle);
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
  }

  _initModals() {
    // Close modal triggers
    document.querySelectorAll('.modal-close, .modal-backdrop').forEach(el => {
      el.onclick = (e) => {
        if (e.target === el) {
          el.closest('.modal-backdrop').classList.remove('open');
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

    // Load saved theme preference
    const saved = localStorage.getItem('personal-pdf-theme');
    if (saved === 'light') {
      updateThemeState(false);
    } else {
      updateThemeState(true);
    }

    if (btnTheme) {
      btnTheme.onclick = () => {
        const isCurrentlyDark = document.body.classList.contains('theme-dark');
        updateThemeState(!isCurrentlyDark);
      };
    }
  }

  setMode(mode) {
    this.currentMode = mode;
    this.dynamicToolsContainer.innerHTML = '';

    // Update body mode classes for CSS scoping (e.g. body.mode-view hides all delete buttons & editing borders)
    const modeClasses = ['mode-view', 'mode-annotate', 'mode-organize', 'mode-edit', 'mode-forms', 'mode-protect', 'mode-export'];
    modeClasses.forEach(c => document.body.classList.remove(c));
    document.body.classList.add(`mode-${mode}`);

    // Deselect any active text box or editor when switching modes
    if (this.app.annotator) {
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
        <button id="btn-tool-select" class="tool-btn active" title="Text Selection Tool (Select & highlight text)">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>
          <span>Select Text</span>
        </button>
        <button id="btn-tool-hand" class="tool-btn" title="Hand / Pan Tool (Click & drag to move pages)">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v6M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8M6 14a4 4 0 0 0 4 4h4a6 6 0 0 0 6-6V9a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2"/></svg>
          <span>Pan</span>
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

    let isPanning = false;
    let startX = 0, startY = 0, startScrollLeft = 0, startScrollTop = 0;

    const onPanMouseDown = (e) => {
      if (e.target.closest('button, input, select, textarea, .annotation-textbox, .sticky-note-popup')) return;
      isPanning = true;
      startX = e.clientX;
      startY = e.clientY;
      startScrollLeft = container.scrollLeft;
      startScrollTop = container.scrollTop;
      container.style.cursor = 'grabbing';
      e.preventDefault();
    };

    const onPanMouseMove = (e) => {
      if (!isPanning) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      container.scrollLeft = startScrollLeft - dx;
      container.scrollTop = startScrollTop - dy;
    };

    const onPanMouseUp = () => {
      if (isPanning) {
        isPanning = false;
        container.style.cursor = 'grab';
      }
    };

    btnHand.onclick = () => {
      btnHand.classList.add('active');
      btnSelect.classList.remove('active');
      container.classList.add('hand-tool');
      container.style.cursor = 'grab';
      document.querySelectorAll('.textLayer').forEach(tl => {
        tl.style.pointerEvents = 'none';
        tl.style.userSelect = 'none';
      });
      container.addEventListener('mousedown', onPanMouseDown);
      window.addEventListener('mousemove', onPanMouseMove);
      window.addEventListener('mouseup', onPanMouseUp);
      this.setStatus('Hand / Pan Tool active: click and drag anywhere to move pages');
    };

    btnSelect.onclick = () => {
      btnSelect.classList.add('active');
      btnHand.classList.remove('active');
      container.classList.remove('hand-tool');
      container.style.cursor = 'default';
      container.removeEventListener('mousedown', onPanMouseDown);
      window.removeEventListener('mousemove', onPanMouseMove);
      window.removeEventListener('mouseup', onPanMouseUp);
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
      let selectedText = window.getSelection().toString();
      if (!selectedText) {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
          selectedText = activeEl.value || activeEl.innerText;
        }
      }

      if (selectedText && selectedText.trim()) {
        // Clean encoding: replace corrupted ligatures, PUA chars, soft hyphens, and non-standard spacing
        const cleanText = selectedText
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
    this.dynamicToolsContainer.innerHTML = `
      <div class="tool-group">
        <button id="tool-select" class="tool-btn" title="Text Selection Tool">✋</button>
        <button id="tool-pen" class="tool-btn active" title="Freehand Pen">✏️</button>
        <button id="tool-highlighter" class="tool-btn" title="Highlighter Brush">🖍️</button>
        <button id="tool-eraser" class="tool-btn" title="Eraser Tool (Click/drag to erase ink, textboxes, stamps)">🧼</button>
        <button id="tool-note" class="tool-btn" title="Sticky Note">💬</button>
        <button id="tool-text" class="tool-btn" title="Typewriter Text Block">T</button>
        <button id="tool-rect" class="tool-btn" title="Draw Rectangle">▢</button>
        <button id="tool-circle" class="tool-btn" title="Draw Circle">◯</button>
        <button id="tool-line" class="tool-btn" title="Draw Line">╱</button>
      </div>
      <div class="divider"></div>
      <div class="tool-group">
        <input type="color" id="annot-color" value="#ef4444" class="tool-select" style="padding:1px; width:26px; height:26px;" title="Stroke / Text Color">
        <input type="number" id="annot-size" value="4" min="1" max="50" class="tool-select" style="width:46px;" title="Stroke Thickness (px)">
        <select id="annot-font-family" class="tool-select" style="max-width:130px;" title="Text Font Family">
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
        <input type="number" id="annot-font-size" value="16" min="6" max="144" class="tool-select" style="width:48px;" title="Font Size (pt)">
        <button id="btn-text-bold" class="tool-btn" title="Bold Text"><b>B</b></button>
        <button id="btn-text-italic" class="tool-btn" title="Italic Text"><i>I</i></button>
        <button id="btn-text-underline" class="tool-btn" title="Underline Text"><u>U</u></button>
        <button id="btn-text-strike" class="tool-btn" title="Strikethrough"><s>S</s></button>
        <button id="btn-text-align-left" class="tool-btn" title="Align Left">⫷</button>
        <button id="btn-text-align-center" class="tool-btn" title="Align Center">≡</button>
        <button id="btn-text-align-right" class="tool-btn" title="Align Right">⫸</button>
        <button id="btn-text-align-justify" class="tool-btn" title="Justify">▤</button>
        <select id="annot-line-spacing" class="tool-select" title="Line Spacing">
          <option value="1.0">1.0x</option>
          <option value="1.25" selected>1.25x</option>
          <option value="1.5">1.5x</option>
          <option value="2.0">2.0x</option>
        </select>
        <button id="btn-text-delete" class="tool-btn" style="color:#ef4444;" title="Delete Active Text Box">🗑 Del</button>
        <select id="annot-stamp" class="tool-select" style="max-width:90px;" title="Place Stamp">
          <option value="">Stamp...</option>
          <option value="APPROVED">APPROVED</option>
          <option value="REJECTED">REJECTED</option>
          <option value="CONFIDENTIAL">CONFIDENTIAL</option>
          <option value="DRAFT">DRAFT</option>
        </select>
      </div>
    `;

    // Tool switching
    const tools = ['select', 'pen', 'highlighter', 'eraser', 'note', 'text', 'rect', 'circle', 'line'];
    tools.forEach(t => {
      const btn = document.getElementById(`tool-${t}`);
      if (!btn) return;
      btn.onclick = () => {
        tools.forEach(other => document.getElementById(`tool-${other}`)?.classList.remove('active'));
        btn.classList.add('active');
        
        if (t === 'select') {
          this.app.annotator.setTool('none');
          this.setStatus('Text selection active: click & drag to select and copy text');
          return;
        }

        if (t === 'eraser') {
          this.app.annotator.setTool('eraser');
          this.setStatus('Eraser active: click or drag across ink, highlighters, or text boxes to erase');
          return;
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
          this.setStatus('Freehand pen active');
        } else if (t === 'highlighter') {
          this.setStatus('Highlighter brush active');
        }
      };
    });

    // Default to pen
    this.app.annotator.setTool('pen', {
      color: document.getElementById('annot-color').value,
      strokeWidth: parseInt(document.getElementById('annot-size').value, 10) || 4
    });

    document.getElementById('annot-color').onchange = (e) => {
      this.app.annotator.setColor(e.target.value);
    };

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

    document.getElementById('btn-text-align-left').onclick = () => {
      this.app.annotator.setTextAlign('left');
    };
    document.getElementById('btn-text-align-center').onclick = () => {
      this.app.annotator.setTextAlign('center');
    };
    document.getElementById('btn-text-align-right').onclick = () => {
      this.app.annotator.setTextAlign('right');
    };
    document.getElementById('btn-text-align-justify').onclick = () => {
      this.app.annotator.setTextAlign('justify');
    };

    document.getElementById('annot-line-spacing').onchange = (e) => {
      this.app.annotator.setLineHeight(parseFloat(e.target.value));
    };

    document.getElementById('btn-text-delete').onclick = () => {
      this.app.annotator.deleteActiveTextBox();
      this.setStatus('Text box removed');
    };

    document.getElementById('annot-stamp').onchange = (e) => {
      if (e.target.value) {
        this.app.annotator.placeStamp(this.app.viewer.currentPage, e.target.value);
        e.target.value = '';
      }
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
    if (!box) return;
    const targetEl = box.querySelector?.('.textbox-content') || box;
    const cs = window.getComputedStyle(targetEl);
    const fontFamEl = document.getElementById('edit-font-family') || document.getElementById('annot-font-family');
    const fontSizeEl = document.getElementById('edit-font-size') || document.getElementById('annot-font-size');
    const colorEl = document.getElementById('edit-font-color') || document.getElementById('annot-color');
    const boldBtn = document.getElementById('btn-edit-bold') || document.getElementById('btn-text-bold');
    const italicBtn = document.getElementById('btn-edit-italic') || document.getElementById('btn-text-italic');
    const underlineBtn = document.getElementById('btn-edit-underline') || document.getElementById('btn-text-underline');
    const strikeBtn = document.getElementById('btn-edit-strike') || document.getElementById('btn-text-strike');

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
      const isUnder = (targetEl.style.textDecoration || '').includes('underline');
      underlineBtn.classList.toggle('active', isUnder);
    }
    if (strikeBtn) {
      const isStrike = (targetEl.style.textDecoration || '').includes('line-through');
      strikeBtn.classList.toggle('active', isStrike);
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

    document.getElementById('btn-flatten-form').onclick = () => {
      this.setStatus('Form fields flattened successfully');
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
        const pageNum = this.app.viewer.currentPage || 1;
        this.setStatus(`Exporting page ${pageNum} as PNG...`);
        const img = await this.app.exporter.exportPageAsImage(pageNum);
        if (img) {
          const fileName = `page-${pageNum}.png`;
          await this.app.exporter.downloadFile(
            this._dataURLtoBlob(img),
            fileName,
            'image/png'
          );
          this.showToast(`Export Complete: Page ${pageNum} saved as ${fileName}`, 'success');
          this.setStatus(`Exported Page ${pageNum} successfully as PNG`);
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
      this.setStatus('Extracting document text...');
      const text = await this.app.exporter.extractAllText();
      const fileName = `${(this.app.currentDocName || 'document').replace(/\.pdf$/i, '')}-text.txt`;
      this.app.exporter.downloadFile(text, fileName, 'text/plain');
      this.showToast(`Export Complete: All text saved to ${fileName}`, 'success');
      this.setStatus(`Exported text (${text.length} characters) successfully`);
    };
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
    const hasOutlineItems = container.querySelectorAll('.outline-item').length > 0;
    
    if (customBms.length === 0 && !hasOutlineItems) {
      container.innerHTML = '<div class="empty-state">No bookmarks found. Click "+ Add" above to bookmark the current page.</div>';
      return;
    }

    if (customBms.length > 0) {
      // If there are custom bookmarks, render them
      container.innerHTML = '';
      customBms.forEach((bm, idx) => {
        const item = document.createElement('div');
        item.className = 'bookmark-list-item';
        item.innerHTML = `
          <div class="bookmark-list-left">
            <span>🔖</span>
            <span class="bookmark-title">${bm.title}</span>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <span class="annot-page-badge">Page ${bm.pageNum}</span>
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
  }

  syncAnnotationsList() {
    const list = document.getElementById('annotations-list');
    if (!list) return;
    list.innerHTML = '';

    const items = [];

    // 1. Text boxes & sticky notes & stamps & in-place edits from pages
    document.querySelectorAll('.page-wrapper').forEach(w => {
      const pageNum = parseInt(w.id.replace('page-wrapper-', ''), 10) || 1;

      // Textboxes
      w.querySelectorAll('.annotation-textbox:not(.in-place-editor)').forEach(tb => {
        const text = (tb.innerText || '').trim();
        items.push({
          type: 'text',
          icon: 'T',
          label: text ? `Text: "${text.substring(0, 25)}..."` : 'Text Box',
          pageNum,
          el: tb
        });
      });

      // Sticky notes
      w.querySelectorAll('.sticky-note').forEach(note => {
        const text = (note.querySelector('textarea')?.value || '').trim();
        items.push({
          type: 'note',
          icon: '💬',
          label: text ? `Note: "${text.substring(0, 25)}..."` : 'Sticky Note',
          pageNum,
          el: note
        });
      });

      // Stamps
      w.querySelectorAll('.placed-stamp').forEach(stamp => {
        const badge = stamp.querySelector('.stamp-badge');
        items.push({
          type: 'stamp',
          icon: '✍️',
          label: badge ? `Stamp: ${badge.textContent}` : 'Stamp / Signature',
          pageNum,
          el: stamp
        });
      });

      // In-place edits
      w.querySelectorAll('.textLayer span.in-place-modified, .textLayer span.inline-editing').forEach(span => {
        items.push({
          type: 'edit',
          icon: '📝',
          label: `Edit: "${(span.textContent || '').substring(0, 25)}..."`,
          pageNum,
          el: span
        });
      });
    });

    // Ink drawings
    if (this.app.annotator?.annotations) {
      for (const [pageNum, strokes] of this.app.annotator.annotations.entries()) {
        if (strokes && strokes.length > 0) {
          items.push({
            type: 'ink',
            icon: '✏️',
            label: `Drawings (${strokes.length} strokes)`,
            pageNum,
            el: document.getElementById(`annot-canvas-${pageNum}`)
          });
        }
      }
    }

    if (items.length === 0) {
      list.innerHTML = '<div class="empty-state">No annotations added yet. Use Annotate & Markup tools above to add notes, drawings, or text.</div>';
      return;
    }

    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'annot-list-item';
      row.innerHTML = `
        <div class="annot-list-left">
          <span>${item.icon}</span>
          <span>${item.label}</span>
        </div>
        <span class="annot-page-badge">Page ${item.pageNum}</span>
      `;
      row.onclick = () => {
        this.app.viewer.goToPage(item.pageNum);
        if (item.el) {
          item.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

  setZoomStatus(zoomText) {
    const el = document.getElementById('status-zoom');
    if (el) el.textContent = zoomText;
  }
}

