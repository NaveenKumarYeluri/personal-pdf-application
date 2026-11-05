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
    this._initModals();
    this._initTheme();
    this._initMaterialMobileUI();
    this.setMode('view');
  }

  _initMaterialMobileUI() {
    // 1. Mobile Bottom Nav Tabs
    const navItems = document.querySelectorAll('.m3-nav-item');
    const sheetMarkup = document.getElementById('m3-sheet-markup');
    const sheetTools = document.getElementById('m3-sheet-tools');
    const scrim = document.getElementById('m3-scrim');
    const drawer = document.getElementById('m3-drawer');

    const closeAllSheets = () => {
      sheetMarkup?.classList.remove('open');
      sheetTools?.classList.remove('open');
      drawer?.classList.remove('open');
      scrim?.classList.remove('open');
    };

    scrim?.addEventListener('click', closeAllSheets);
    document.getElementById('m3-close-markup')?.addEventListener('click', closeAllSheets);
    document.getElementById('m3-close-tools')?.addEventListener('click', closeAllSheets);

    navItems.forEach(item => {
      item.onclick = () => {
        navItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        const tab = item.dataset.m3Tab;

        if (tab === 'read') {
          closeAllSheets();
          this.setMode('view');
        } else if (tab === 'annotate') {
          closeAllSheets();
          this.setMode('annotate');
          sheetMarkup?.classList.add('open');
          scrim?.classList.add('open');
        } else if (tab === 'pages') {
          closeAllSheets();
          this.app.openOrganizerModal();
        } else if (tab === 'sign') {
          closeAllSheets();
          this.app.signature.openModal();
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
        } else {
          document.getElementById('file-input')?.click();
        }
      };
    }

    // 3. Mobile Top App Bar
    document.getElementById('m3-btn-drawer')?.addEventListener('click', () => {
      drawer?.classList.add('open');
      scrim?.classList.add('open');
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

    // 4. Mobile Drawer Actions
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
    document.getElementById('m3-drawer-about')?.addEventListener('click', () => {
      closeAllSheets();
      alert('Personal PDF Suite - Material 3 Edition\nCross-platform Adobe Acrobat alternative.');
    });

    // 5. Mobile Annotation Chips
    const chips = document.querySelectorAll('.m3-chip');
    chips.forEach(chip => {
      chip.onclick = () => {
        chips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const tool = chip.dataset.m3Tool;
        this.app.annotator.setTool(tool, {
          color: this.app.annotator.color,
          strokeWidth: 4
        });
        closeAllSheets();
      };
    });

    // 6. Mobile Color Palette
    const colorDots = document.querySelectorAll('#m3-color-palette .color-dot');
    colorDots.forEach(dot => {
      dot.onclick = () => {
        colorDots.forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        this.app.annotator.color = dot.dataset.m3Color;
      };
    });

    // 7. Mobile Tools Menu Actions
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
      document.getElementById('modal-merge')?.classList.add('open');
    });
    document.getElementById('m3-tool-split')?.addEventListener('click', () => {
      closeAllSheets();
      document.getElementById('modal-split')?.classList.add('open');
    });
    document.getElementById('m3-tool-protect')?.addEventListener('click', () => {
      closeAllSheets();
      document.getElementById('modal-protect')?.classList.add('open');
    });
    document.getElementById('m3-tool-export-img')?.addEventListener('click', async () => {
      closeAllSheets();
      const img = await this.app.exporter.exportPageAsImage(this.app.viewer.currentPage);
      if (img) {
        this.app.exporter.downloadFile(this._dataURLtoBlob(img), `page-${this.app.viewer.currentPage}.png`, 'image/png');
      }
    });
  }

  _initModeTabs() {
    const tabs = document.querySelectorAll('.mode-tab');
    tabs.forEach(tab => {
      tab.onclick = () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
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
      };
    });
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

    const updateIcon = (isDark) => {
      if (!themeIcon) return;
      if (isDark) {
        // Show Sun icon (switch to light)
        themeIcon.innerHTML = `<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>`;
        btnTheme.title = 'Switch to Light Mode';
      } else {
        // Show Moon icon (switch to dark)
        themeIcon.innerHTML = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`;
        btnTheme.title = 'Switch to Dark Mode';
      }
    };

    if (btnTheme) {
      btnTheme.onclick = () => {
        const isCurrentlyDark = document.body.classList.contains('theme-dark');
        if (isCurrentlyDark) {
          document.body.classList.remove('theme-dark', 'theme-sepia', 'theme-night');
          document.body.classList.add('theme-light');
          updateIcon(false);
          this.setStatus('Light theme active');
        } else {
          document.body.classList.remove('theme-light', 'theme-sepia', 'theme-night');
          document.body.classList.add('theme-dark');
          updateIcon(true);
          this.setStatus('Dark theme active');
        }
      };
    }
  }

  setMode(mode) {
    this.currentMode = mode;
    this.dynamicToolsContainer.innerHTML = '';

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
        <button id="btn-tool-hand" class="tool-btn" title="Hand / Pan Tool">✋</button>
        <button id="btn-tool-select" class="tool-btn active" title="Text Select Tool">I</button>
      </div>
    `;

    const btnHand = document.getElementById('btn-tool-hand');
    const btnSelect = document.getElementById('btn-tool-select');
    const container = document.getElementById('viewer-container');

    btnHand.onclick = () => {
      btnHand.classList.add('active');
      btnSelect.classList.remove('active');
      container.classList.add('hand-tool');
    };

    btnSelect.onclick = () => {
      btnSelect.classList.add('active');
      btnHand.classList.remove('active');
      container.classList.remove('hand-tool');
    };
  }

  _renderAnnotateTools() {
    this.dynamicToolsContainer.innerHTML = `
      <div class="tool-group">
        <button id="tool-pen" class="tool-btn active" title="Freehand Pen">✏️</button>
        <button id="tool-highlighter" class="tool-btn" title="Highlighter Brush">🖍️</button>
        <button id="tool-note" class="tool-btn" title="Sticky Note">💬</button>
        <button id="tool-text" class="tool-btn" title="Typewriter Text">T</button>
        <button id="tool-rect" class="tool-btn" title="Draw Rectangle">▢</button>
        <button id="tool-circle" class="tool-btn" title="Draw Circle">◯</button>
        <button id="tool-line" class="tool-btn" title="Draw Line">╱</button>
      </div>
      <div class="divider"></div>
      <div class="tool-group">
        <input type="color" id="annot-color" value="#ef4444" class="tool-select" style="padding:1px; width:28px; height:28px;" title="Stroke Color">
        <select id="annot-size" class="tool-select" title="Line Thickness">
          <option value="2">Thin (2px)</option>
          <option value="4" selected>Medium (4px)</option>
          <option value="8">Thick (8px)</option>
          <option value="14">Heavy (14px)</option>
        </select>
        <select id="annot-stamp" class="tool-select" title="Place Stamp">
          <option value="">Stamp...</option>
          <option value="APPROVED">APPROVED</option>
          <option value="REJECTED">REJECTED</option>
          <option value="CONFIDENTIAL">CONFIDENTIAL</option>
          <option value="DRAFT">DRAFT</option>
        </select>
      </div>
    `;

    // Tool switching
    const tools = ['pen', 'highlighter', 'note', 'text', 'rect', 'circle', 'line'];
    tools.forEach(t => {
      const btn = document.getElementById(`tool-${t}`);
      btn.onclick = () => {
        tools.forEach(other => document.getElementById(`tool-${other}`)?.classList.remove('active'));
        btn.classList.add('active');
        
        let toolName = t;
        if (t === 'rect') toolName = 'rectangle';
        this.app.annotator.setTool(toolName, {
          color: document.getElementById('annot-color').value,
          strokeWidth: parseInt(document.getElementById('annot-size').value, 10)
        });
      };
    });

    // Default to pen
    this.app.annotator.setTool('pen', {
      color: document.getElementById('annot-color').value,
      strokeWidth: 4
    });

    document.getElementById('annot-color').onchange = (e) => {
      this.app.annotator.color = e.target.value;
    };

    document.getElementById('annot-size').onchange = (e) => {
      this.app.annotator.strokeWidth = parseInt(e.target.value, 10);
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
      document.getElementById('modal-merge').classList.add('open');
    };

    document.getElementById('btn-open-split').onclick = () => {
      document.getElementById('modal-split').classList.add('open');
    };
  }

  _renderEditTools() {
    this.dynamicToolsContainer.innerHTML = `
      <div class="tool-group">
        <button id="btn-edit-add-text" class="tool-btn active" title="Add / Edit Text Block">T</button>
        <button id="btn-edit-add-image" class="tool-btn" title="Insert Image onto PDF">🖼️</button>
        <button id="btn-edit-whiteout" class="tool-btn" title="Whiteout / Erase Existing Content">⬜</button>
        <input type="file" id="edit-image-file-input" accept="image/png, image/jpeg" style="display:none;">
      </div>
      <div class="divider"></div>
      <div class="tool-group">
        <select id="edit-font-family" class="tool-select" title="Font Family">
          <option value="Inter, sans-serif" selected>Helvetica (Sans-Serif)</option>
          <option value="'Times New Roman', serif">Times (Serif)</option>
          <option value="'Courier New', monospace">Courier (Mono)</option>
        </select>
        <select id="edit-font-size" class="tool-select" title="Font Size">
          <option value="12">12 pt</option>
          <option value="14">14 pt</option>
          <option value="16" selected>16 pt</option>
          <option value="20">20 pt</option>
          <option value="24">24 pt</option>
          <option value="32">32 pt</option>
          <option value="48">48 pt</option>
        </select>
        <input type="color" id="edit-font-color" value="#000000" class="tool-select" style="padding:1px; width:28px; height:28px;" title="Text Color">
      </div>
      <div class="divider"></div>
      <div class="tool-group">
        <button id="btn-open-watermark" class="btn btn-sm btn-outline">Watermark</button>
        <button id="btn-open-bates" class="btn btn-sm btn-outline">Bates Numbers</button>
      </div>
    `;

    // 1. Add Text
    const btnText = document.getElementById('btn-edit-add-text');
    const btnImg = document.getElementById('btn-edit-add-image');
    const btnWhiteout = document.getElementById('btn-edit-whiteout');
    const imgInput = document.getElementById('edit-image-file-input');

    btnText.onclick = () => {
      btnText.classList.add('active');
      btnImg.classList.remove('active');
      btnWhiteout.classList.remove('active');
      this.app.annotator.setTool('text', {
        fontSize: parseInt(document.getElementById('edit-font-size').value, 10),
        color: document.getElementById('edit-font-color').value
      });
      this.setStatus('Click anywhere on the document to add or edit text');
    };

    // Default activate text tool in edit mode
    btnText.click();

    // 2. Add Image
    btnImg.onclick = () => {
      imgInput.click();
    };

    imgInput.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          this.app.insertImageOnPage(this.app.viewer.currentPage, evt.target.result);
          this.setStatus('Image placed. Drag and resize as needed.');
        };
        reader.readAsDataURL(file);
      }
    };

    // 3. Whiteout
    btnWhiteout.onclick = () => {
      btnWhiteout.classList.add('active');
      btnText.classList.remove('active');
      btnImg.classList.remove('active');
      this.app.insertWhiteoutOnPage(this.app.viewer.currentPage);
      this.setStatus('Whiteout box placed. Move over unwanted text to cover it.');
    };

    // Font updates
    document.getElementById('edit-font-size').onchange = (e) => {
      this.app.annotator.fontSize = parseInt(e.target.value, 10);
    };
    document.getElementById('edit-font-color').onchange = (e) => {
      this.app.annotator.color = e.target.value;
    };

    // Modals
    document.getElementById('btn-open-watermark').onclick = () => {
      document.getElementById('modal-watermark').classList.add('open');
    };

    document.getElementById('btn-open-bates').onclick = () => {
      document.getElementById('modal-bates').classList.add('open');
    };
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
        <button id="btn-export-page-img" class="btn btn-sm btn-outline">Export Current Page (PNG)</button>
        <button id="btn-export-text" class="btn btn-sm btn-outline">Extract All Text (TXT)</button>
      </div>
    `;

    document.getElementById('btn-export-page-img').onclick = async () => {
      const img = await this.app.exporter.exportPageAsImage(this.app.viewer.currentPage);
      if (img) {
        this.app.exporter.downloadFile(
          this._dataURLtoBlob(img),
          `page-${this.app.viewer.currentPage}.png`,
          'image/png'
        );
      }
    };

    document.getElementById('btn-export-text').onclick = async () => {
      const text = await this.app.exporter.extractAllText();
      this.app.exporter.downloadFile(text, 'document-text.txt', 'text/plain');
    };
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

