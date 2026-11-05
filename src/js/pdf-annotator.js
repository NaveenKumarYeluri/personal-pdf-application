/**
 * Personal PDF Suite - Annotations & Markup Engine
 * Drawing pen, highlighter, shapes, sticky notes, typewriter textboxes, and stamps.
 */

export class PDFAnnotatorEngine {
  constructor(options = {}) {
    this.container = options.container;
    this.currentTool = 'none'; // 'pen', 'highlighter', 'eraser', 'rectangle', 'circle', 'line', 'arrow', 'note', 'text', 'stamp'
    this.color = '#ef4444';
    this.strokeWidth = 4;
    this.opacity = 1.0;
    this.fontSize = 16;
    this.fontFamily = 'Inter, sans-serif';
    this.fontWeight = 'normal';
    this.fontStyle = 'normal';
    this.textDecoration = 'none';
    this.textAlign = 'left';
    this.lineHeight = 1.25;

    this.activeTextBox = null;
    this.onActiveTextBoxChange = options.onActiveTextBoxChange || (() => {});
    
    // Store annotations per page
    // Map<pageNum, Array<AnnotationObject>>
    this.annotations = new Map();
    this.undoStack = [];
    this.redoStack = [];
    this.isDrawing = false;
    this.isErasing = false;
    this.currentPath = [];
    this.activeCanvas = null;
    this.activePageNum = null;
    
    this._bindEvents();
  }

  setTool(tool, props = {}) {
    this.currentTool = tool;
    if (props.color) this.color = props.color;
    if (props.strokeWidth) this.strokeWidth = props.strokeWidth;
    if (props.opacity !== undefined) this.opacity = props.opacity;
    if (props.fontSize) this.fontSize = props.fontSize;
    if (props.fontFamily) this.fontFamily = props.fontFamily;

    // Toggle drawing-active class on all annotation layers
    const layers = this.container.querySelectorAll('.annotation-layer');
    layers.forEach(layer => {
      if (this.currentTool === 'none') {
        layer.classList.remove('drawing-active');
        layer.style.cursor = 'default';
      } else if (this.currentTool === 'eraser') {
        layer.classList.add('drawing-active');
        layer.style.cursor = 'crosshair';
      } else {
        layer.classList.add('drawing-active');
        layer.style.cursor = 'crosshair';
      }
    });
  }

  _bindEvents() {
    this.container.addEventListener('mousedown', (e) => this._onMouseDown(e));
    this.container.addEventListener('mousemove', (e) => this._onMouseMove(e));
    window.addEventListener('mouseup', (e) => this._onMouseUp(e));

    // Touch events for tablet/stylus/Android
    this.container.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
    this.container.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
    window.addEventListener('touchend', (e) => this._onTouchEnd(e));
  }

  _getCanvasAndCoords(e) {
    const target = e.target.closest('.annotation-layer');
    if (!target) return null;

    const pageWrapper = target.closest('.page-wrapper');
    if (!pageWrapper) return null;
    const pageNum = parseInt(pageWrapper.dataset.pageNumber, 10);
    const canvas = target.querySelector('canvas');
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    return { canvas, pageNum, x, y, rect, rawX: clientX - rect.left, rawY: clientY - rect.top };
  }

  _onMouseDown(e) {
    if (this.currentTool === 'none') return;

    // 1. Dedicated Eraser Tool handling
    if (this.currentTool === 'eraser') {
      const annotEl = e.target.closest('.annotation-textbox, .placed-stamp, .sticky-note-marker, .sticky-note-popup, .whiteout-box, .redaction-box');
      if (annotEl) {
        e.stopPropagation();
        const pageWrapper = annotEl.closest('.page-wrapper');
        const pNum = pageWrapper ? parseInt(pageWrapper.dataset.pageNumber, 10) : 1;
        this.undoStack.push({
          type: 'element',
          pageNum: pNum,
          elements: [annotEl]
        });
        annotEl._savedParent = annotEl.parentNode;
        annotEl.remove();
        if (this.activeTextBox === annotEl) {
          this.activeTextBox = null;
          this.onActiveTextBoxChange(null);
        }
        return;
      }

      const info = this._getCanvasAndCoords(e);
      if (info) {
        this.isErasing = true;
        this.activeCanvas = info.canvas;
        this.activePageNum = info.pageNum;
        this._eraseStrokesAt(info.pageNum, info.x, info.y);
      }
      return;
    }

    const info = this._getCanvasAndCoords(e);
    if (!info) return;

    if (this.currentTool === 'note') {
      this._addStickyNote(info.pageNum, info.rawX, info.rawY);
      return;
    }

    if (this.currentTool === 'text') {
      this._addTextBox(info.pageNum, info.rawX, info.rawY);
      return;
    }

    this.isDrawing = true;
    this.activeCanvas = info.canvas;
    this.activePageNum = info.pageNum;
    this.currentPath = [{ x: info.x, y: info.y }];
  }

  _onMouseMove(e) {
    if (this.isErasing && this.activePageNum) {
      const info = this._getCanvasAndCoords(e);
      if (info && info.pageNum === this.activePageNum) {
        this._eraseStrokesAt(info.pageNum, info.x, info.y);
      }
      return;
    }

    if (!this.isDrawing || !this.activeCanvas) return;
    const info = this._getCanvasAndCoords(e);
    if (!info || info.pageNum !== this.activePageNum) return;

    this.currentPath.push({ x: info.x, y: info.y });
    this._renderCurrentStroke();
  }

  _onMouseUp() {
    if (this.isErasing) {
      this.isErasing = false;
      this.activeCanvas = null;
      this.activePageNum = null;
      return;
    }

    if (!this.isDrawing) return;
    this.isDrawing = false;

    if (this.currentPath.length > 1 && this.activePageNum) {
      const isHighlighter = this.currentTool === 'highlighter';
      const annot = {
        type: this.currentTool,
        points: [...this.currentPath],
        color: this.color,
        strokeWidth: isHighlighter ? 24 : this.strokeWidth * 2,
        opacity: isHighlighter ? 0.35 : this.opacity
      };

      if (!this.annotations.has(this.activePageNum)) {
        this.annotations.set(this.activePageNum, []);
      }
      this.annotations.get(this.activePageNum).push(annot);

      // Record to undo stack
      this.undoStack.push({
        type: 'stroke',
        pageNum: this.activePageNum,
        data: annot
      });
      this.redoStack = [];
    }

    this.currentPath = [];
    this.activeCanvas = null;
    this.activePageNum = null;
  }

  _onTouchStart(e) {
    if (this.currentTool !== 'none') {
      e.preventDefault();
      this._onMouseDown(e);
    }
  }

  _onTouchMove(e) {
    if (this.currentTool !== 'none' && (this.isDrawing || this.isErasing)) {
      e.preventDefault();
      this._onMouseMove(e);
    }
  }

  _onTouchEnd(e) {
    if (this.currentTool !== 'none') {
      this._onMouseUp(e);
    }
  }

  _eraseStrokesAt(pageNum, x, y) {
    const list = this.annotations.get(pageNum);
    if (!list || list.length === 0) return;

    const threshold = 35; // Hit radius
    let changed = false;

    for (let i = list.length - 1; i >= 0; i--) {
      const annot = list[i];
      let hit = false;
      if (annot.points && annot.points.length) {
        for (const pt of annot.points) {
          const dist = Math.hypot(pt.x - x, pt.y - y);
          if (dist <= threshold) {
            hit = true;
            break;
          }
        }
      }
      if (hit) {
        const removed = list.splice(i, 1)[0];
        this.undoStack.push({
          type: 'stroke',
          pageNum,
          data: removed
        });
        changed = true;
      }
    }

    if (changed) {
      this._redrawPageAnnotations(pageNum);
    }
  }

  _renderCurrentStroke() {
    const ctx = this.activeCanvas.getContext('2d');
    const isHighlighter = this.currentTool === 'highlighter';
    
    ctx.strokeStyle = this.color;
    ctx.lineWidth = isHighlighter ? 24 : this.strokeWidth * 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = isHighlighter ? 0.35 : this.opacity;

    if (this.currentTool === 'pen' || isHighlighter) {
      const len = this.currentPath.length;
      if (len < 2) return;
      ctx.beginPath();
      ctx.moveTo(this.currentPath[len - 2].x, this.currentPath[len - 2].y);
      ctx.lineTo(this.currentPath[len - 1].x, this.currentPath[len - 1].y);
      ctx.stroke();
    } else if (this.currentTool === 'rectangle') {
      // Clear and redraw for shape preview
      this._redrawPageAnnotations(this.activePageNum);
      const start = this.currentPath[0];
      const curr = this.currentPath[this.currentPath.length - 1];
      ctx.beginPath();
      ctx.strokeRect(start.x, start.y, curr.x - start.x, curr.y - start.y);
    } else if (this.currentTool === 'circle') {
      this._redrawPageAnnotations(this.activePageNum);
      const start = this.currentPath[0];
      const curr = this.currentPath[this.currentPath.length - 1];
      const rx = Math.abs(curr.x - start.x) / 2;
      const ry = Math.abs(curr.y - start.y) / 2;
      const cx = Math.min(start.x, curr.x) + rx;
      const cy = Math.min(start.y, curr.y) + ry;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (this.currentTool === 'line') {
      this._redrawPageAnnotations(this.activePageNum);
      const start = this.currentPath[0];
      const curr = this.currentPath[this.currentPath.length - 1];
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(curr.x, curr.y);
      ctx.stroke();
    }
  }

  _redrawPageAnnotations(pageNum) {
    const canvas = document.getElementById(`annot-canvas-${pageNum}`);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const annots = this.annotations.get(pageNum) || [];
    annots.forEach(a => {
      ctx.strokeStyle = a.color;
      ctx.lineWidth = a.strokeWidth;
      ctx.globalAlpha = a.opacity;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (a.type === 'pen' || a.type === 'highlighter') {
        if (a.points.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(a.points[0].x, a.points[0].y);
        for (let i = 1; i < a.points.length; i++) {
          ctx.lineTo(a.points[i].x, a.points[i].y);
        }
        ctx.stroke();
      } else if (a.type === 'rectangle') {
        const start = a.points[0];
        const end = a.points[a.points.length - 1];
        ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
      } else if (a.type === 'circle') {
        const start = a.points[0];
        const end = a.points[a.points.length - 1];
        const rx = Math.abs(end.x - start.x) / 2;
        const ry = Math.abs(end.y - start.y) / 2;
        const cx = Math.min(start.x, end.x) + rx;
        const cy = Math.min(start.y, end.y) + ry;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (a.type === 'line') {
        const start = a.points[0];
        const end = a.points[a.points.length - 1];
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
      }
    });
  }

  _addStickyNote(pageNum, x, y) {
    const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
    if (!wrapper) return;

    const noteContainer = document.createElement('div');
    noteContainer.className = 'sticky-note-container placed-stamp';
    noteContainer.style.left = `${x}px`;
    noteContainer.style.top = `${y}px`;

    const marker = document.createElement('div');
    marker.className = 'sticky-note-marker';
    marker.innerHTML = `💬`;
    marker.title = 'Click to open note, drag to reposition';

    const popup = document.createElement('div');
    popup.className = 'sticky-note-popup';
    popup.style.left = '30px';
    popup.style.top = '0px';
    popup.innerHTML = `
      <div class="sticky-note-header">
        <span>Note</span>
        <button class="tool-btn-sm btn-delete-note" title="Delete Note">&times;</button>
      </div>
      <textarea placeholder="Type your comment..."></textarea>
    `;

    popup.querySelector('.btn-delete-note').onclick = (e) => {
      e.stopPropagation();
      this.undoStack.push({
        type: 'element',
        pageNum,
        elements: [noteContainer]
      });
      noteContainer.remove();
    };

    marker.onclick = (e) => {
      e.stopPropagation();
      popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
      if (popup.style.display !== 'none') popup.querySelector('textarea').focus();
    };

    noteContainer.appendChild(marker);
    noteContainer.appendChild(popup);

    this._makeDraggable(noteContainer, wrapper);
    wrapper.appendChild(noteContainer);
    popup.querySelector('textarea').focus();

    this.undoStack.push({
      type: 'element',
      pageNum,
      elements: [noteContainer]
    });
    this.redoStack = [];
  }

  _addTextBox(pageNum, x, y, initialText = 'Click to edit text') {
    const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
    if (!wrapper) return;

    const box = document.createElement('div');
    box.className = 'annotation-textbox';
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;

    const contentArea = document.createElement('div');
    contentArea.className = 'textbox-content';
    contentArea.contentEditable = 'true';
    contentArea.style.fontSize = `${this.fontSize}px`;
    contentArea.style.fontFamily = this.fontFamily;
    contentArea.style.fontWeight = this.fontWeight;
    contentArea.style.fontStyle = this.fontStyle;
    contentArea.style.textDecoration = this.textDecoration;
    contentArea.style.textAlign = this.textAlign;
    contentArea.style.lineHeight = this.lineHeight;
    contentArea.style.color = this.color;
    contentArea.innerText = initialText;

    // Delete button (✕) placed as sibling of contentArea
    const btnDel = document.createElement('button');
    btnDel.className = 'textbox-delete-btn';
    btnDel.contentEditable = 'false';
    btnDel.innerHTML = '&times;';
    btnDel.title = 'Delete Text Box';
    btnDel.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.undoStack.push({
        type: 'element',
        pageNum,
        elements: [box]
      });
      box._savedParent = box.parentNode;
      box.remove();
      if (this.activeTextBox === box) {
        this.activeTextBox = null;
        this.onActiveTextBoxChange(null);
      }
    };

    box.appendChild(contentArea);
    box.appendChild(btnDel);

    const selectThisBox = (e) => {
      e?.stopPropagation();
      if (this.activeTextBox && this.activeTextBox !== box) {
        this.activeTextBox.classList.remove('active');
      }
      this.activeTextBox = box;
      box.classList.add('active');
      this.onActiveTextBoxChange(box);
    };

    box.onclick = selectThisBox;
    contentArea.onfocus = selectThisBox;
    contentArea.onclick = (e) => {
      e.stopPropagation();
      selectThisBox();
    };

    contentArea.onblur = () => {
      if (!contentArea.innerText.trim()) {
        box.remove();
        if (this.activeTextBox === box) {
          this.activeTextBox = null;
          this.onActiveTextBoxChange(null);
        }
      }
    };

    this._makeDraggable(box, wrapper);
    wrapper.appendChild(box);

    contentArea.focus();
    selectThisBox();

    // Select text on creation
    try {
      const range = document.createRange();
      range.selectNodeContents(contentArea);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {}

    this.undoStack.push({
      type: 'element',
      pageNum,
      elements: [box]
    });
    this.redoStack = [];
    return box;
  }

  _getTargetElement() {
    if (!this.activeTextBox) return null;
    return this.activeTextBox.querySelector('.textbox-content') || this.activeTextBox;
  }

  setActiveTextBox(box) {
    if (this.activeTextBox && this.activeTextBox !== box) {
      this.activeTextBox.classList.remove('active');
    }
    this.activeTextBox = box;
    if (box) {
      box.classList.add('active');
      this.onActiveTextBoxChange(box);
    } else {
      this.onActiveTextBoxChange(null);
    }
  }

  setFontFamily(family) {
    this.fontFamily = family;
    const el = this._getTargetElement();
    if (el) {
      el.style.fontFamily = family;
    }
  }

  setFontSize(size) {
    const parsed = parseInt(size, 10);
    if (!isNaN(parsed) && parsed > 0) {
      this.fontSize = parsed;
      const el = this._getTargetElement();
      if (el) {
        el.style.fontSize = `${parsed}px`;
      }
    }
  }

  setColor(color) {
    this.color = color;
    const el = this._getTargetElement();
    if (el) {
      el.style.color = color;
    }
  }

  toggleBold() {
    const el = this._getTargetElement();
    const isBold = el
      ? (el.style.fontWeight === 'bold' || parseInt(window.getComputedStyle(el).fontWeight, 10) >= 700)
      : (this.fontWeight === 'bold');
    const newVal = isBold ? 'normal' : 'bold';
    this.fontWeight = newVal;
    if (el) {
      el.style.fontWeight = newVal;
    }
    return newVal === 'bold';
  }

  toggleItalic() {
    const el = this._getTargetElement();
    const isItalic = el
      ? (el.style.fontStyle === 'italic')
      : (this.fontStyle === 'italic');
    const newVal = isItalic ? 'normal' : 'italic';
    this.fontStyle = newVal;
    if (el) {
      el.style.fontStyle = newVal;
    }
    return newVal === 'italic';
  }

  toggleUnderline() {
    const el = this._getTargetElement();
    const currentDec = el ? (el.style.textDecoration || '') : this.textDecoration;
    const hasUnder = currentDec.includes('underline');
    let newDec = '';
    if (hasUnder) {
      newDec = currentDec.replace('underline', '').trim();
    } else {
      newDec = `${currentDec} underline`.trim();
    }
    this.textDecoration = newDec || 'none';
    if (el) {
      el.style.textDecoration = newDec || 'none';
    }
    return !hasUnder;
  }

  toggleStrikethrough() {
    const el = this._getTargetElement();
    if (!el) return false;
    const currentDec = el.style.textDecoration || '';
    const hasStrike = currentDec.includes('line-through');
    let newDec = '';
    if (hasStrike) {
      newDec = currentDec.replace('line-through', '').trim();
    } else {
      newDec = `${currentDec} line-through`.trim();
    }
    el.style.textDecoration = newDec || 'none';
    return !hasStrike;
  }

  setTextAlign(align) {
    this.textAlign = align;
    const el = this._getTargetElement();
    if (el) {
      el.style.textAlign = align;
    }
  }

  setLineHeight(height) {
    this.lineHeight = height;
    const el = this._getTargetElement();
    if (el) {
      el.style.lineHeight = height;
    }
  }

  deleteActiveTextBox() {
    if (this.activeTextBox) {
      const box = this.activeTextBox;
      const pageWrapper = box.closest('.page-wrapper');
      const pageNum = pageWrapper ? parseInt(pageWrapper.dataset.pageNumber, 10) : 1;
      
      if (box._originalSpan) {
        box._originalSpan.style.visibility = 'visible';
        box._originalSpan._linkedEditor = null;
      }

      this.undoStack.push({
        type: box._originalSpan ? 'in-place-edit' : 'element',
        pageNum,
        editorEl: box,
        span: box._originalSpan || null,
        elements: [box]
      });
      box._savedParent = box.parentNode;
      box.remove();
      this.activeTextBox = null;
      this.onActiveTextBoxChange(null);
    }
  }

  placeStamp(pageNum, stampType = 'APPROVED', x = 100, y = 100) {
    const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
    if (!wrapper) return;

    const stamp = document.createElement('div');
    stamp.className = 'placed-stamp';
    stamp.style.left = `${x}px`;
    stamp.style.top = `${y}px`;

    const badge = document.createElement('div');
    badge.className = `stamp-badge stamp-${stampType.toLowerCase()}`;
    badge.textContent = stampType;
    stamp.appendChild(badge);

    // Make draggable
    this._makeDraggable(stamp, wrapper);
    wrapper.appendChild(stamp);

    this.undoStack.push({
      type: 'element',
      pageNum,
      elements: [stamp]
    });
    this.redoStack = [];
  }

  undo() {
    if (this.undoStack.length === 0) return false;
    const action = this.undoStack.pop();
    this.redoStack.push(action);

    if (action.type === 'stroke') {
      const pageAnnots = this.annotations.get(action.pageNum);
      if (pageAnnots && pageAnnots.length > 0) {
        const idx = pageAnnots.lastIndexOf(action.data);
        if (idx !== -1) {
          pageAnnots.splice(idx, 1);
        } else {
          pageAnnots.pop();
        }
        this._redrawPageAnnotations(action.pageNum);
      }
    } else if (action.type === 'in-place-edit') {
      if (action.editorEl && action.editorEl.parentNode) {
        action.editorEl.remove();
      }
      if (action.span) {
        action.span.style.visibility = 'visible';
        action.span._linkedEditor = null;
      }
      if (this.activeTextBox === action.editorEl) {
        this.activeTextBox = null;
        this.onActiveTextBoxChange(null);
      }
    } else if (action.type === 'element') {
      action.elements.forEach(el => {
        if (el && el.parentNode) {
          el._savedParent = el.parentNode;
          el.remove();
        }
      });
    }
    return true;
  }

  redo() {
    if (this.redoStack.length === 0) return false;
    const action = this.redoStack.pop();
    this.undoStack.push(action);

    if (action.type === 'stroke') {
      if (!this.annotations.has(action.pageNum)) {
        this.annotations.set(action.pageNum, []);
      }
      this.annotations.get(action.pageNum).push(action.data);
      this._redrawPageAnnotations(action.pageNum);
    } else if (action.type === 'in-place-edit') {
      if (action.span) {
        action.span.style.visibility = 'hidden';
        action.span._linkedEditor = action.editorEl;
      }
      const wrapper = document.getElementById(`page-wrapper-${action.pageNum}`);
      if (wrapper && action.editorEl) {
        wrapper.appendChild(action.editorEl);
        this.setActiveTextBox(action.editorEl);
      }
    } else if (action.type === 'element') {
      action.elements.forEach(el => {
        if (el && el._savedParent) {
          el._savedParent.appendChild(el);
        }
      });
    }
    return true;
  }

  /**
   * Burns all visual annotations (ink, highlights, textboxes, stamps)
   * into the underlying PDF using pdf-lib by compositing them onto each page.
   */
  async burnAnnotationsToPdf(pdfBytes) {
    const lib = window.PDFLib || window.pdfLib;
    if (!lib) return pdfBytes;
    const { PDFDocument } = lib;
    const rawBytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
    const doc = await PDFDocument.load(rawBytes.slice(), { ignoreEncryption: true });
    const pages = doc.getPages();

    for (let i = 0; i < pages.length; i++) {
      const pageNum = i + 1;
      const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
      if (!wrapper) continue;

      const page = pages[i];
      const { width, height } = page.getSize();

      // Check if there are annotations or drawings on this page
      const annotCanvas = document.getElementById(`annot-canvas-${pageNum}`);
      const textboxes = wrapper.querySelectorAll('.annotation-textbox');
      const stamps = wrapper.querySelectorAll('.placed-stamp');
      const redactions = wrapper.querySelectorAll('.redaction-box');
      const whiteouts = wrapper.querySelectorAll('.whiteout-box');

      const hasContent = (this.annotations.has(pageNum) && this.annotations.get(pageNum).length > 0) ||
                         textboxes.length > 0 ||
                         stamps.length > 0 ||
                         redactions.length > 0 ||
                         whiteouts.length > 0;

      if (!hasContent) continue;

      // Composite onto a high-res temporary canvas matching PDF coordinate resolution
      const compCanvas = document.createElement('canvas');
      compCanvas.width = annotCanvas ? annotCanvas.width : wrapper.clientWidth * 2;
      compCanvas.height = annotCanvas ? annotCanvas.height : wrapper.clientHeight * 2;
      const compCtx = compCanvas.getContext('2d');

      // 1. Draw ink canvas
      if (annotCanvas) {
        compCtx.drawImage(annotCanvas, 0, 0);
      }

      const scaleX = compCanvas.width / wrapper.clientWidth;
      const scaleY = compCanvas.height / wrapper.clientHeight;

      // 2. Draw whiteout boxes first (so text or ink can appear over them)
      for (const wb of whiteouts) {
        const wx = wb.offsetLeft * scaleX;
        const wy = wb.offsetTop * scaleY;
        const ww = wb.offsetWidth * scaleX;
        const wh = wb.offsetHeight * scaleY;
        compCtx.fillStyle = '#ffffff';
        compCtx.fillRect(wx, wy, ww, wh);
      }

      // 3. Draw placed stamps and signatures
      for (const stamp of stamps) {
        const sx = stamp.offsetLeft * scaleX;
        const sy = stamp.offsetTop * scaleY;
        const sw = stamp.offsetWidth * scaleX;
        const sh = stamp.offsetHeight * scaleY;

        const img = stamp.querySelector('img');
        if (img && img.complete) {
          compCtx.drawImage(img, sx, sy, sw, sh);
        } else {
          const badge = stamp.querySelector('.stamp-badge');
          if (badge) {
            compCtx.save();
            compCtx.translate(sx + sw / 2, sy + sh / 2);
            compCtx.rotate(-8 * Math.PI / 180);
            compCtx.font = `bold ${Math.round(20 * scaleX)}px sans-serif`;
            compCtx.strokeStyle = window.getComputedStyle(badge).color;
            compCtx.lineWidth = 3 * scaleX;
            compCtx.strokeRect(-sw / 2, -sh / 2, sw, sh);
            compCtx.fillStyle = compCtx.strokeStyle;
            compCtx.textAlign = 'center';
            compCtx.textBaseline = 'middle';
            compCtx.fillText(badge.textContent, 0, 0);
            compCtx.restore();
          }
        }
      }

      // 4. Draw text boxes with multi-line, custom font, bold, italic, and alignment
      for (const tb of textboxes) {
        const contentEl = tb.querySelector('.textbox-content') || tb;
        const textContent = Array.from(contentEl.childNodes)
          .filter(n => !(n.classList && n.classList.contains('textbox-delete-btn')))
          .map(n => n.textContent || '')
          .join('');

        if (!textContent.trim()) continue;

        const cs = window.getComputedStyle(contentEl);
        const tx = tb.offsetLeft * scaleX;
        const ty = tb.offsetTop * scaleY;
        const tw = tb.offsetWidth * scaleX;
        const fSize = parseFloat(cs.fontSize) * scaleY;
        const fontFamily = cs.fontFamily || 'Inter, sans-serif';
        const fontWeight = cs.fontWeight || 'normal';
        const fontStyle = cs.fontStyle || 'normal';
        const textAlign = cs.textAlign || 'left';
        const color = cs.color || '#000000';
        const parsedLineHeight = parseFloat(cs.lineHeight);
        const lineHeight = !isNaN(parsedLineHeight) && parsedLineHeight > 0
          ? parsedLineHeight * scaleY
          : fSize * 1.3;

        // If this textbox has a white background (e.g. in-place editor) or explicit background, mask the canvas behind it
        if (tb.classList.contains('in-place-editor') || (cs.backgroundColor && cs.backgroundColor.includes('255, 255, 255'))) {
          compCtx.fillStyle = '#ffffff';
          compCtx.fillRect(tx - 1, ty - 1, tw + 2, (tb.offsetHeight * scaleY) + 2);
        }

        compCtx.save();
        compCtx.font = `${fontStyle} ${fontWeight} ${fSize}px ${fontFamily}`;
        compCtx.fillStyle = color;
        compCtx.textBaseline = 'top';

        const lines = textContent.split(/\r?\n/);
        lines.forEach((line, lineIdx) => {
          let lineX = tx;
          if (textAlign === 'center') {
            lineX = tx + tw / 2;
            compCtx.textAlign = 'center';
          } else if (textAlign === 'right') {
            lineX = tx + tw;
            compCtx.textAlign = 'right';
          } else {
            compCtx.textAlign = 'left';
          }
          compCtx.fillText(line, lineX, ty + lineIdx * lineHeight);
        });
        compCtx.restore();
      }

      // 5. Draw redaction blackouts
      for (const rb of redactions) {
        const rx = rb.offsetLeft * scaleX;
        const ry = rb.offsetTop * scaleY;
        const rw = rb.offsetWidth * scaleX;
        const rh = rb.offsetHeight * scaleY;
        compCtx.fillStyle = '#000000';
        compCtx.fillRect(rx, ry, rw, rh);
      }

      // Embed composite canvas image into PDF page
      const pngDataUrl = compCanvas.toDataURL('image/png');
      const pngImage = await doc.embedPng(pngDataUrl);
      page.drawImage(pngImage, {
        x: 0,
        y: 0,
        width: width,
        height: height
      });
    }

    return await doc.save();
  }

  _makeDraggable(element, parent) {
    let isDragging = false;
    let startX, startY, initialX, initialY;
    const container = document.getElementById('viewer-container');

    let scrollTimer = null;
    let currentClientY = 0;

    const runAutoScroll = () => {
      if (!isDragging || !container) return;
      const cRect = container.getBoundingClientRect();
      const topDist = currentClientY - cRect.top;
      const bottomDist = cRect.bottom - currentClientY;

      if (topDist < 80 && topDist > -30) {
        container.scrollTop -= Math.max(5, Math.round((80 - topDist) * 0.35));
      } else if (bottomDist < 80 && bottomDist > -30) {
        container.scrollTop += Math.max(5, Math.round((80 - bottomDist) * 0.35));
      }
      scrollTimer = requestAnimationFrame(runAutoScroll);
    };

    const startDrag = (clientX, clientY) => {
      isDragging = true;
      startX = clientX;
      startY = clientY;
      initialX = element.offsetLeft;
      initialY = element.offsetTop;
      currentClientY = clientY;
      element.classList.add('is-dragging');
      if (scrollTimer) cancelAnimationFrame(scrollTimer);
      scrollTimer = requestAnimationFrame(runAutoScroll);
    };

    const moveDrag = (clientX, clientY) => {
      if (!isDragging) return;
      currentClientY = clientY;
      const dx = clientX - startX;
      const dy = clientY - startY;
      element.style.left = `${initialX + dx}px`;
      element.style.top = `${initialY + dy}px`;

      // Live cross-page reparenting while dragging across pages
      const elementsAtPoint = document.elementsFromPoint(clientX, clientY);
      const targetWrapper = elementsAtPoint.find(el => el.classList && el.classList.contains('page-wrapper'));
      if (targetWrapper && targetWrapper !== element.parentNode) {
        const elRect = element.getBoundingClientRect();
        const targetRect = targetWrapper.getBoundingClientRect();
        targetWrapper.appendChild(element);
        initialX = elRect.left - targetRect.left - dx;
        initialY = elRect.top - targetRect.top - dy;
      }
    };

    const stopDrag = (clientX, clientY) => {
      if (!isDragging) return;
      isDragging = false;
      element.classList.remove('is-dragging');
      if (scrollTimer) {
        cancelAnimationFrame(scrollTimer);
        scrollTimer = null;
      }

      // Final cross-page adjustment
      if (clientX !== undefined && clientY !== undefined) {
        const elementsAtPoint = document.elementsFromPoint(clientX, clientY);
        const targetWrapper = elementsAtPoint.find(el => el.classList && el.classList.contains('page-wrapper'));

        if (targetWrapper && targetWrapper !== element.parentNode) {
          const elRect = element.getBoundingClientRect();
          const targetRect = targetWrapper.getBoundingClientRect();
          const newLeft = elRect.left - targetRect.left;
          const newTop = elRect.top - targetRect.top;
          element.style.left = `${Math.max(0, newLeft)}px`;
          element.style.top = `${Math.max(0, newTop)}px`;
          targetWrapper.appendChild(element);
        }
      }
    };

    // Mouse drag handlers
    element.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.classList.contains('textbox-delete-btn')) return;
      if (element.classList.contains('annotation-textbox') && document.activeElement === element && e.target === element) {
        return;
      }
      e.stopPropagation();
      startDrag(e.clientX, e.clientY);

      const onMouseMove = (moveEvt) => moveDrag(moveEvt.clientX, moveEvt.clientY);
      const onMouseUp = (upEvt) => {
        stopDrag(upEvt.clientX, upEvt.clientY);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });

    // Touch drag handlers for Android and mobile
    element.addEventListener('touchstart', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.classList.contains('textbox-delete-btn')) return;
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        startDrag(touch.clientX, touch.clientY);
      }
    }, { passive: true });

    element.addEventListener('touchmove', (e) => {
      if (isDragging && e.touches.length === 1) {
        e.preventDefault();
        const touch = e.touches[0];
        moveDrag(touch.clientX, touch.clientY);
      }
    }, { passive: false });

    element.addEventListener('touchend', (e) => {
      if (isDragging) {
        const touch = e.changedTouches ? e.changedTouches[0] : null;
        stopDrag(touch ? touch.clientX : undefined, touch ? touch.clientY : undefined);
      }
    });
  }
}

