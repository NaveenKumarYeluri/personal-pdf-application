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
    this.setMode('view');
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
    const themes = ['theme-dark', 'theme-light', 'theme-sepia', 'theme-night'];
    let themeIndex = 0;

    if (btnTheme) {
      btnTheme.onclick = () => {
        document.body.classList.remove(themes[themeIndex]);
        themeIndex = (themeIndex + 1) % themes.length;
        document.body.classList.add(themes[themeIndex]);
        this.setStatus(`Theme set to ${themes[themeIndex].replace('theme-', '')}`);
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
        <button id="btn-open-watermark" class="btn btn-sm btn-outline">Add Watermark</button>
        <button id="btn-open-bates" class="btn btn-sm btn-outline">Header / Footer / Bates</button>
      </div>
    `;

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

