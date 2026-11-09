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
    this.activeStickyNote = null;
    this.activeInPlaceSpan = null;
    this.activeStamp = null;
    this.ui = options.ui || null;
    this.inPlaceEdits = new Map(); // Map<pageNum, Map<span, editData>>
    this.onActiveTextBoxChange = options.onActiveTextBoxChange || (() => {});
    this.onActiveStampChange = options.onActiveStampChange || (() => {});
    
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

    const isAnnotating = tool !== 'none' && tool !== 'select';
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('annotating-active', isAnnotating);
      document.body.classList.toggle('annot-tool-none', !isAnnotating);
    }

    // Toggle drawing-active class and pointer-events on all annotation layers
    const layers = this.container ? this.container.querySelectorAll('.annotation-layer') : (typeof document !== 'undefined' ? document.querySelectorAll('.annotation-layer') : []);
    layers.forEach(layer => {
      if (!isAnnotating) {
        layer.classList.remove('drawing-active');
        layer.style.cursor = 'default';
        layer.style.pointerEvents = 'none';
        const c = layer.querySelector('canvas');
        if (c) c.style.pointerEvents = 'none';
      } else {
        layer.classList.add('drawing-active');
        layer.style.cursor = tool === 'text' ? 'text' : 'crosshair';
        layer.style.pointerEvents = 'auto';
        const c = layer.querySelector('canvas');
        if (c) c.style.pointerEvents = 'auto';
      }
    });

    if (!isAnnotating && typeof document !== 'undefined') {
      document.querySelectorAll('.textLayer').forEach(tl => {
        tl.style.pointerEvents = 'auto';
        tl.style.userSelect = 'text';
        tl.style.webkitUserSelect = 'text';
      });
    }
  }

  _bindEvents() {
    this.container.addEventListener('mousedown', (e) => this._onMouseDown(e));
    window.addEventListener('mousemove', (e) => this._onMouseMove(e));
    window.addEventListener('mouseup', (e) => this._onMouseUp(e));

    // Touch events for tablet/stylus/Android
    this.container.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
    window.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
    window.addEventListener('touchend', (e) => this._onTouchEnd(e));
  }

  _getCanvasAndCoords(e) {
    const pageWrapper = e.target.closest('.page-wrapper');
    if (!pageWrapper) return null;

    const pageNum = parseInt(pageWrapper.dataset.pageNumber, 10) || 1;
    const canvas = pageWrapper.querySelector('canvas[id^="annot-canvas-"]') || pageWrapper.querySelector('.annotation-layer canvas');
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    return { 
      canvas, 
      pageNum, 
      x, 
      y, 
      rect, 
      rawX: clientX - rect.left, 
      rawY: clientY - rect.top,
      pageWrapper 
    };
  }

  _onMouseDown(e) {
    if (this.currentTool === 'none' || this.currentTool === 'select') return;

    // If clicking inside an existing active element, editor, or handle, let it interact normally
    if (e.target.closest('.annotation-textbox, .textbox-content, .placed-stamp, .stamp-badge, .placed-image-box, .placed-signature-box, .whiteout-box, .element-resize-handle, .element-rotate-handle, .element-rotate-line, .element-floating-bar, .resize-handle, .annotation-action-bar, .sticky-note-popup, .sticky-note-marker, .sticky-note-container, .textbox-delete-btn, .btn-delete-note')) {
      if (this.currentTool !== 'eraser') return;
    }

    const info = this._getCanvasAndCoords(e);
    if (!info) return;

    // Prevent default browser text selection or panning while annotating or drawing!
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();

    // 1. Dedicated Eraser Tool handling
    if (this.currentTool === 'eraser') {
      const annotEl = e.target.closest('.annotation-textbox, .placed-stamp, .sticky-note-marker, .sticky-note-popup, .sticky-note-container, .whiteout-box, .redaction-box');
      if (annotEl) {
        e.stopPropagation();
        const actualEl = annotEl.closest('.sticky-note-container') || annotEl;
        const pageWrapper = actualEl.closest('.page-wrapper');
        const pNum = pageWrapper ? parseInt(pageWrapper.dataset.pageNumber, 10) : 1;
        this.undoStack.push({
          type: 'element',
          pageNum: pNum,
          elements: [actualEl]
        });
        actualEl._savedParent = actualEl.parentNode;
        actualEl.remove();
        if (this.activeTextBox === actualEl) {
          this.activeTextBox = null;
          this.onActiveTextBoxChange(null);
        }
        if (this.activeStickyNote === actualEl) {
          this.activeStickyNote = null;
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
        if (e.cancelable) e.preventDefault();
        this._eraseStrokesAt(info.pageNum, info.x, info.y);
      }
      return;
    }

    if (!this.isDrawing || !this.activeCanvas) return;

    if (e.cancelable) e.preventDefault();
    e.stopPropagation();

    // Compute coordinates relative to the activeCanvas where the drawing started
    const rect = this.activeCanvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const scaleX = this.activeCanvas.width / rect.width;
    const scaleY = this.activeCanvas.height / rect.height;

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const rawX = clientX - rect.left;
    const rawY = clientY - rect.top;

    // Constrain points within the active page dimensions so dragging past the page margin
    // or onto adjacent pages cleanly completes the shape right up to the page edge without breaking!
    const clampedX = Math.max(0, Math.min(this.activeCanvas.width, rawX * scaleX));
    const clampedY = Math.max(0, Math.min(this.activeCanvas.height, rawY * scaleY));

    this.currentPath.push({ x: clampedX, y: clampedY });
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
      const isShape = this.currentTool === 'rectangle' || this.currentTool === 'circle' || this.currentTool === 'line';
      const strokeW = isHighlighter ? 24 : (isShape ? this.strokeWidth * 2 : this.strokeWidth * 2);
      const annot = {
        type: this.currentTool,
        points: [...this.currentPath],
        color: this.color,
        strokeWidth: strokeW,
        opacity: isHighlighter ? 0.35 : this.opacity
      };

      if (!this.annotations.has(this.activePageNum)) {
        this.annotations.set(this.activePageNum, []);
      }
      this.annotations.get(this.activePageNum).push(annot);

      // Immediately redraw page to lock in the completed shape with its stored properties
      this._redrawPageAnnotations(this.activePageNum);

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
      // Clear and redraw existing annotations first with their own stored properties
      this._redrawPageAnnotations(this.activePageNum);

      // Re-apply CURRENT tool's styling for the live shape preview!
      ctx.strokeStyle = this.color;
      ctx.lineWidth = this.strokeWidth * 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = this.opacity;

      const start = this.currentPath[0];
      const curr = this.currentPath[this.currentPath.length - 1];
      ctx.beginPath();
      ctx.strokeRect(start.x, start.y, curr.x - start.x, curr.y - start.y);
    } else if (this.currentTool === 'circle') {
      this._redrawPageAnnotations(this.activePageNum);

      ctx.strokeStyle = this.color;
      ctx.lineWidth = this.strokeWidth * 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = this.opacity;

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

      ctx.strokeStyle = this.color;
      ctx.lineWidth = this.strokeWidth * 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = this.opacity;

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
      } else if (a.type === 'underline' || a.type === 'strikethrough') {
        if (!a.rects) return;
        ctx.strokeStyle = a.color || '#2563eb';
        ctx.lineWidth = a.strokeWidth || 2;
        ctx.lineCap = 'butt';
        a.rects.forEach(r => {
          ctx.beginPath();
          const y = (a.type === 'underline') ? Math.round(r.y + r.h - 1) : Math.round(r.y + r.h / 2);
          ctx.moveTo(r.x, y);
          ctx.lineTo(r.x + r.w, y);
          ctx.stroke();
        });
      }
    });
  }

  _addStickyNote(pageNum, x, y) {
    const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
    if (!wrapper) return;

    const noteContainer = document.createElement('div');
    noteContainer.className = 'sticky-note-container';
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
    popup.style.display = 'block';
    popup.innerHTML = `
      <div class="sticky-note-header">
        <span>Note</span>
        <button class="tool-btn-sm btn-delete-note" title="Delete Note">&times;</button>
      </div>
      <textarea placeholder="Type your comment..."></textarea>
    `;

    const btnDel = popup.querySelector('.btn-delete-note');
    const doDelete = (e) => {
      if (e) {
        e.stopPropagation();
        e.preventDefault();
      }
      this.undoStack.push({
        type: 'element',
        pageNum,
        elements: [noteContainer]
      });
      noteContainer.remove();
      if (this.activeStickyNote === noteContainer) {
        this.activeStickyNote = null;
      }
    };
    btnDel.onclick = doDelete;
    btnDel.onmousedown = (e) => { e.stopPropagation(); doDelete(e); };
    btnDel.onpointerdown = (e) => { e.stopPropagation(); e.preventDefault(); doDelete(e); };

    const textarea = popup.querySelector('textarea');
    ['mousedown', 'click', 'keydown', 'touchstart', 'pointerdown'].forEach(evt => {
      textarea.addEventListener(evt, (e) => {
        e.stopPropagation();
      });
    });

    const setActiveNote = (e) => {
      e?.stopPropagation();
      this.activeStickyNote = noteContainer;
      document.querySelectorAll('.sticky-note-container').forEach(c => c.classList.remove('active-note'));
      noteContainer.classList.add('active-note');
    };

    // Unified drag handler attached directly to noteContainer
    let isDragging = false;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;
    let hasMoved = false;
    let activeWrapper = wrapper;

    const onPointerDown = (e) => {
      // Don't drag when interacting with the textarea or close button
      if (e.target.closest('.btn-delete-note, textarea, button, input')) return;

      e.stopPropagation();
      setActiveNote(e);

      // Prevent native browser text selection/drag ghost image from taking over
      if (e.cancelable) e.preventDefault();

      isDragging = true;
      hasMoved = false;
      const pt = e.touches ? e.touches[0] : e;
      startX = pt.clientX;
      startY = pt.clientY;
      initialLeft = noteContainer.offsetLeft;
      initialTop = noteContainer.offsetTop;

      const onPointerMove = (mEvt) => {
        if (!isDragging) return;
        const mPt = mEvt.touches ? mEvt.touches[0] : mEvt;
        const dx = mPt.clientX - startX;
        const dy = mPt.clientY - startY;

        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          hasMoved = true;
          if (mEvt.cancelable) mEvt.preventDefault();

          // Live cross-page reparenting if dragged over another page
          const elementsAtPoint = document.elementsFromPoint(mPt.clientX, mPt.clientY);
          const targetWrapper = elementsAtPoint.find(el => el.classList && el.classList.contains('page-wrapper'));
          if (targetWrapper && targetWrapper !== noteContainer.parentNode) {
            const elRect = noteContainer.getBoundingClientRect();
            const targetRect = targetWrapper.getBoundingClientRect();
            targetWrapper.appendChild(noteContainer);
            activeWrapper = targetWrapper;
            initialLeft = elRect.left - targetRect.left - dx;
            initialTop = elRect.top - targetRect.top - dy;
          }

          const wrapW = activeWrapper.clientWidth || 800;
          const wrapH = activeWrapper.clientHeight || 1000;
          const newL = Math.min(wrapW - 24, Math.max(0, initialLeft + dx));
          const newT = Math.min(wrapH - 24, Math.max(0, initialTop + dy));

          noteContainer.style.left = `${Math.round(newL)}px`;
          noteContainer.style.top = `${Math.round(newT)}px`;
        }
      };

      const onPointerUp = () => {
        if (!isDragging) return;
        isDragging = false;

        window.removeEventListener('mousemove', onPointerMove, true);
        window.removeEventListener('mouseup', onPointerUp, true);
        window.removeEventListener('touchmove', onPointerMove, true);
        window.removeEventListener('touchend', onPointerUp, true);

        // If mouse/finger didn't move, treat as click toggle on marker
        if (!hasMoved) {
          const clickTarget = e.target;
          if (clickTarget && clickTarget.closest('.sticky-note-marker')) {
            popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
            if (popup.style.display !== 'none') {
              setTimeout(() => textarea.focus(), 50);
            }
          }
        }
      };

      window.addEventListener('mousemove', onPointerMove, true);
      window.addEventListener('mouseup', onPointerUp, true);
      window.addEventListener('touchmove', onPointerMove, { passive: false, capture: true });
      window.addEventListener('touchend', onPointerUp, true);
    };

    noteContainer.addEventListener('mousedown', onPointerDown);
    noteContainer.addEventListener('touchstart', onPointerDown, { passive: false });

    noteContainer.appendChild(marker);
    noteContainer.appendChild(popup);
    wrapper.appendChild(noteContainer);

    this.activeStickyNote = noteContainer;
    setTimeout(() => textarea.focus(), 50);

    this.undoStack.push({
      type: 'element',
      pageNum,
      elements: [noteContainer]
    });
    this.redoStack = [];

    // Switch tool to select mode so user doesn't accidentally drop more notes
    this.setTool('select');
    if (this.ui && typeof this.ui.setAnnotationTool === 'function') {
      this.ui.setAnnotationTool('select');
    }
  }

  _addTextBox(pageNum, x, y, initialText = '') {
    const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
    if (!wrapper) return;

    const wrapW = wrapper.clientWidth || 800;
    const wrapH = wrapper.clientHeight || 1100;

    // Constrain placement inside page boundaries
    const safeX = Math.max(12, Math.min(x, wrapW - 140));
    const safeY = Math.max(12, Math.min(y, wrapH - 50));

    const box = document.createElement('div');
    box.className = 'annotation-textbox';
    box.style.left = `${Math.round(safeX)}px`;
    box.style.top = `${Math.round(safeY)}px`;

    // Maximum available width from x to right page margin (leaving at least 20px margin)
    const maxAvailableW = Math.max(120, wrapW - safeX - 24);
    // Explicit initial width (~260px or bounded to available page space)
    const initialWidth = Math.min(260, maxAvailableW);
    box.style.width = `${Math.round(initialWidth)}px`;
    box.style.maxWidth = `${Math.round(wrapW - safeX - 16)}px`;
    box.style.minWidth = '80px';
    box.style.boxSizing = 'border-box';

    // Top Move Grip / Drag Bar - 100% reliable drag handle that never conflicts with text typing
    const dragBar = document.createElement('div');
    dragBar.className = 'textbox-drag-bar';
    dragBar.title = 'Drag to move text box';
    dragBar.innerHTML = `
      <span class="textbox-drag-grip">⠿</span>
      <span class="textbox-drag-label">Text</span>
    `;

    const contentArea = document.createElement('div');
    contentArea.className = 'textbox-content';
    contentArea.contentEditable = 'true';
    contentArea.dataset.placeholder = 'Type text here...';
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
      if (box._floatingBar) box._floatingBar.remove();
      box.remove();
      if (this.activeTextBox === box) {
        this.activeTextBox = null;
        this.onActiveTextBoxChange(null);
      }
    };

    box.appendChild(dragBar);
    box.appendChild(contentArea);
    box.appendChild(btnDel);

    const selectThisBox = (e) => {
      e?.stopPropagation();
      this.setActiveTextBox(box);
      this._selectElement(box);
    };

    box.onclick = selectThisBox;
    contentArea.onfocus = selectThisBox;
    contentArea.onclick = (e) => {
      e.stopPropagation();
      selectThisBox(e);
    };

    contentArea.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        contentArea.blur();
      }
    });

    contentArea.onblur = () => {
      if (!contentArea.innerText.trim()) {
        if (box._floatingBar) box._floatingBar.remove();
        box.remove();
        if (this.activeTextBox === box) {
          this.activeTextBox = null;
          this.onActiveTextBoxChange(null);
        }
      }
    };

    // Attach drag handlers and 8-point resize handles!
    this._makeDraggable(box, wrapper);
    this._makeResizable(box, wrapper, { keepAspectRatio: false, isTextBox: true });
    wrapper.appendChild(box);

    contentArea.focus();
    selectThisBox();

    // If initial text is present, select it; otherwise leave caret ready for immediate typing
    if (initialText) {
      try {
        const range = document.createRange();
        range.selectNodeContents(contentArea);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (_) {}
    }

    this.undoStack.push({
      type: 'element',
      pageNum,
      elements: [box]
    });
    this.redoStack = [];

    // Auto-switch tool to select mode so subsequent clicks don't drop extra textboxes
    this.setTool('select');
    if (this.ui && typeof this.ui.setAnnotationTool === 'function') {
      this.ui.setAnnotationTool('select');
    }

    return box;
  }

  _getTargetElement() {
    if (this.activeTextBox) {
      return this.activeTextBox.querySelector('.textbox-content') || this.activeTextBox;
    }
    if (this.activeInPlaceSpan) {
      return this.activeInPlaceSpan;
    }
    return null;
  }

  setActiveTextBox(box) {
    if (this.activeInPlaceSpan) {
      this.activeInPlaceSpan.classList.remove('inline-editing');
      this.activeInPlaceSpan = null;
    }
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

  setActiveInPlaceSpan(span) {
    if (this.activeTextBox) {
      this.activeTextBox.classList.remove('active');
      this.activeTextBox = null;
    }
    if (this.activeInPlaceSpan && this.activeInPlaceSpan !== span) {
      this.activeInPlaceSpan.classList.remove('inline-editing');
    }
    this.activeInPlaceSpan = span;
    if (span) {
      this.onActiveTextBoxChange(span);
    } else {
      this.onActiveTextBoxChange(null);
    }
  }

  clearActiveEditing() {
    if (this.activeTextBox) {
      this.activeTextBox.classList.remove('active');
      this.activeTextBox = null;
    }
    if (this.activeInPlaceSpan) {
      this.activeInPlaceSpan.classList.remove('inline-editing');
      this.activeInPlaceSpan = null;
    }
    if (this.activeStamp) {
      this.activeStamp.classList.remove('selected');
      this.activeStamp = null;
      this.onActiveStampChange(null);
    }
    this.onActiveTextBoxChange(null);
  }

  setActiveStamp(stamp) {
    if (this.activeStamp && this.activeStamp !== stamp) {
      this.activeStamp.classList.remove('selected', 'element-selected');
    }
    this.activeStamp = stamp;
    if (stamp) {
      stamp.classList.add('selected');
      if (this.activeTextBox) {
        this.activeTextBox.classList.remove('active', 'element-selected');
        this.activeTextBox = null;
        this.onActiveTextBoxChange(null);
      }
      this._selectElement(stamp);
    }
    this.onActiveStampChange(stamp);
    if (this.ui && typeof this.ui.syncActiveStamp === 'function') {
      this.ui.syncActiveStamp(stamp);
    }
  }

  deleteActiveStamp() {
    const stamp = this.activeStamp || document.querySelector('.placed-stamp.element-selected') || document.querySelector('.placed-stamp.selected');
    if (!stamp) return;
    const pageWrapper = stamp.closest('.page-wrapper');
    const pageNum = pageWrapper ? parseInt(pageWrapper.dataset.pageNumber, 10) : 1;
    this.undoStack.push({
      type: 'element',
      pageNum,
      elements: [stamp]
    });
    if (stamp._floatingBar) stamp._floatingBar.remove();
    stamp.remove();
    if (this.activeStamp === stamp) {
      this.setActiveStamp(null);
    }
  }

  setStampText(text) {
    if (!this.activeStamp || !text) return;
    const badge = this.activeStamp.querySelector('.stamp-badge');
    if (badge) {
      badge.textContent = text;
      const cleanClass = text.toLowerCase().replace(/[^a-z0-9]/g, '');
      badge.className = `stamp-badge stamp-${cleanClass}`;
    }
  }

  setStampColor(color) {
    if (!this.activeStamp || !color) return;
    const badge = this.activeStamp.querySelector('.stamp-badge');
    if (badge) {
      badge.style.color = color;
      badge.style.borderColor = color;
    }
  }

  setStampOpacity(opacity) {
    if (!this.activeStamp) return;
    const badge = this.activeStamp.querySelector('.stamp-badge');
    if (badge) {
      badge.style.opacity = opacity;
    }
  }

  setStampFontSize(size) {
    const parsed = parseInt(size, 10);
    if (!this.activeStamp || isNaN(parsed) || parsed < 8) return;
    const badge = this.activeStamp.querySelector('.stamp-badge');
    if (badge) {
      badge.style.fontSize = `${parsed}px`;
    }
  }

  setStampRotation(deg) {
    if (!this.activeStamp) return;
    const badge = this.activeStamp.querySelector('.stamp-badge');
    if (badge) {
      badge.style.transform = `rotate(${deg}deg)`;
      badge.dataset.rotation = deg;
    }
  }

  setStampFontFamily(font) {
    if (!this.activeStamp || !font) return;
    const badge = this.activeStamp.querySelector('.stamp-badge');
    if (badge) {
      badge.style.fontFamily = font;
    }
  }

  recordInPlaceEdit(span, pageNum, pageWrapper) {
    if (!this.inPlaceEdits.has(pageNum)) {
      this.inPlaceEdits.set(pageNum, new Map());
    }
    const pageMap = this.inPlaceEdits.get(pageNum);
    const prevText = pageMap.has(span) ? pageMap.get(span).newText : (span._originalText !== undefined ? span._originalText : '');
    pageMap.set(span, {
      span,
      originalText: span._originalText,
      newText: span.textContent,
      normRect: span._normRect,
      fontFamily: span._customFontStack || span.style.fontFamily,
      baseFontSize: span._baseFontSize,
      pageNum
    });
    this.undoStack.push({
      type: 'in-place-edit',
      pageNum,
      span,
      prevText,
      newText: span.textContent
    });
    this.redoStack = [];
  }

  revertInPlaceEdit(span, pageNum) {
    if (this.inPlaceEdits.has(pageNum)) {
      this.inPlaceEdits.get(pageNum).delete(span);
    }
    span.textContent = span._originalText !== undefined ? span._originalText : span.textContent;
    span.classList.remove('inline-editing', 'in-place-modified');
  }

  clearAllEdits() {
    this.annotations.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.inPlaceEdits.clear();
    this.activeInPlaceSpan = null;
    this.activeTextBox = null;
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
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    let handled = false;
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed && el && el.contains(sel.anchorNode)) {
      document.execCommand('bold', false, null);
      handled = true;
    }
    const isBold = el
      ? (el.style.fontWeight === 'bold' || parseInt(window.getComputedStyle(el).fontWeight, 10) >= 700)
      : (this.fontWeight === 'bold');
    const newVal = isBold ? 'normal' : 'bold';
    this.fontWeight = newVal;
    if (el && !handled) {
      el.style.fontWeight = newVal;
    }
    return newVal === 'bold';
  }

  toggleItalic() {
    const el = this._getTargetElement();
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    let handled = false;
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed && el && el.contains(sel.anchorNode)) {
      document.execCommand('italic', false, null);
      handled = true;
    }
    const isItalic = el
      ? (el.style.fontStyle === 'italic')
      : (this.fontStyle === 'italic');
    const newVal = isItalic ? 'normal' : 'italic';
    this.fontStyle = newVal;
    if (el && !handled) {
      el.style.fontStyle = newVal;
    }
    return newVal === 'italic';
  }

  toggleUnderline() {
    const el = this._getTargetElement();
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;

    // 1. If currently inside active textbox, apply rich-text underline
    if (el && sel && sel.rangeCount > 0 && !sel.isCollapsed && el.contains(sel.anchorNode)) {
      document.execCommand('underline', false, null);
      try {
        const state = document.queryCommandState('underline');
        return Boolean(state);
      } catch (_) {}
    }

    // 2. If text is selected in native document textLayer, apply Acrobat-style markup underline!
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      const startNode = range.startContainer;
      const span = startNode.nodeType === 3 ? startNode.parentNode : startNode;
      const pageWrapper = span.closest ? span.closest('.page-wrapper') : null;
      if (pageWrapper) {
        const pageNum = parseInt(pageWrapper.dataset.pageNumber, 10);
        const wRect = pageWrapper.getBoundingClientRect();
        const clientRects = Array.from(range.getClientRects());
        const rects = clientRects.map(cr => ({
          x: cr.left - wRect.left,
          y: cr.top - wRect.top,
          w: cr.width,
          h: cr.height
        })).filter(r => r.w > 0 && r.h > 0);

        if (rects.length > 0) {
          const annots = this.annotations.get(pageNum) || [];
          const annotObj = {
            type: 'underline',
            color: this.color || '#2563eb',
            strokeWidth: 2,
            opacity: 1,
            rects
          };
          annots.push(annotObj);
          this.annotations.set(pageNum, annots);
          this._redrawAnnotations(pageNum);

          this.undoStack.push({
            type: 'draw',
            pageNum,
            annotation: annotObj
          });
          this.redoStack = [];

          sel.removeAllRanges();
          return false;
        }
      }
    }

    const currentDec = (el ? el.style.textDecoration : this.textDecoration) || '';
    const hasUnder = currentDec.includes('underline');
    const newDec = hasUnder
      ? currentDec.replace(/underline/g, '').replace(/\s+/g, ' ').trim()
      : `${currentDec} underline`.trim();
    this.textDecoration = newDec || 'none';
    if (el) {
      el.style.textDecoration = newDec || 'none';
    }
    return !hasUnder;
  }

  toggleStrikethrough() {
    const el = this._getTargetElement();
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;

    // 1. If currently inside active textbox, apply rich-text strikethrough
    if (el && sel && sel.rangeCount > 0 && !sel.isCollapsed && el.contains(sel.anchorNode)) {
      document.execCommand('strikeThrough', false, null);
      try {
        const state = document.queryCommandState('strikeThrough');
        return Boolean(state);
      } catch (_) {}
    }

    // 2. If text is selected in native document textLayer, apply Acrobat-style markup strikethrough!
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      const startNode = range.startContainer;
      const span = startNode.nodeType === 3 ? startNode.parentNode : startNode;
      const pageWrapper = span.closest ? span.closest('.page-wrapper') : null;
      if (pageWrapper) {
        const pageNum = parseInt(pageWrapper.dataset.pageNumber, 10);
        const wRect = pageWrapper.getBoundingClientRect();
        const clientRects = Array.from(range.getClientRects());
        const rects = clientRects.map(cr => ({
          x: cr.left - wRect.left,
          y: cr.top - wRect.top,
          w: cr.width,
          h: cr.height
        })).filter(r => r.w > 0 && r.h > 0);

        if (rects.length > 0) {
          const annots = this.annotations.get(pageNum) || [];
          const annotObj = {
            type: 'strikethrough',
            color: this.color || '#ef4444',
            strokeWidth: 2,
            opacity: 1,
            rects
          };
          annots.push(annotObj);
          this.annotations.set(pageNum, annots);
          this._redrawAnnotations(pageNum);

          this.undoStack.push({
            type: 'draw',
            pageNum,
            annotation: annotObj
          });
          this.redoStack = [];

          sel.removeAllRanges();
          return false;
        }
      }
    }

    const currentDec = (el ? el.style.textDecoration : this.textDecoration) || '';
    const hasStrike = currentDec.includes('line-through');
    const newDec = hasStrike
      ? currentDec.replace(/line-through/g, '').replace(/\s+/g, ' ').trim()
      : `${currentDec} line-through`.trim();
    this.textDecoration = newDec || 'none';
    if (el) {
      el.style.textDecoration = newDec || 'none';
    }
    return !hasStrike;
  }

  setTextAlign(align) {
    this.textAlign = align;
    // Align only applies to multi-line typewriter textboxes to prevent shifting fixed-layout PDF spans
    if (this.activeTextBox) {
      const contentEl = this.activeTextBox.querySelector('.textbox-content') || this.activeTextBox;
      contentEl.style.textAlign = align;
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
    if (this.activeInPlaceSpan && document.body.classList.contains('mode-edit')) {
      const span = this.activeInPlaceSpan;
      const pageNum = span._pageNum || 1;
      this.revertInPlaceEdit(span, pageNum);
      this.clearActiveEditing();
      return;
    }
    const box = this.activeTextBox || document.querySelector('.annotation-textbox.element-selected') || document.querySelector('.annotation-textbox.active');
    if (box) {
      const pageWrapper = box.closest('.page-wrapper');
      const pageNum = pageWrapper ? parseInt(pageWrapper.dataset.pageNumber, 10) : 1;
      
      this.undoStack.push({
        type: 'element',
        pageNum,
        elements: [box]
      });
      box._savedParent = box.parentNode;
      if (box._floatingBar) box._floatingBar.remove();
      box.remove();
      if (this.activeTextBox === box) {
        this.activeTextBox = null;
        this.onActiveTextBoxChange(null);
      }
      return;
    }
  }

  deleteActiveBox() {
    if (this.activeTextBox || document.querySelector('.annotation-textbox.element-selected')) {
      this.deleteActiveTextBox();
      return;
    }
    if (this.activeStickyNote || document.querySelector('.sticky-note-container.active-note') || document.querySelector('.sticky-note-container.element-selected')) {
      this.deleteActiveStickyNote();
      return;
    }
    if (this.activeStamp || document.querySelector('.placed-stamp.element-selected')) {
      this.deleteActiveStamp();
      return;
    }
    const selEl = document.querySelector('.element-selected');
    if (selEl) {
      this.deleteElement(selEl);
    }
  }

  deleteElement(element) {
    if (!element) return;
    if (element.classList.contains('annotation-textbox')) {
      this.activeTextBox = element;
      this.deleteActiveTextBox();
      return;
    }
    if (element.classList.contains('placed-stamp')) {
      this.activeStamp = element;
      this.deleteActiveStamp();
      return;
    }
    if (element.classList.contains('sticky-note-container')) {
      this.activeStickyNote = element;
      this.deleteActiveStickyNote();
      return;
    }
    const pageWrapper = element.closest('.page-wrapper');
    const pageNum = pageWrapper ? parseInt(pageWrapper.dataset.pageNumber, 10) : 1;
    this.undoStack.push({
      type: 'element',
      pageNum,
      elements: [element]
    });
    if (element._floatingBar) element._floatingBar.remove();
    element.remove();
  }

  deleteActiveStickyNote() {
    const note = this.activeStickyNote || document.querySelector('.sticky-note-container.active-note') || document.querySelector('.sticky-note-container.element-selected');
    if (!note) return;
    const pageWrapper = note.closest('.page-wrapper');
    const pageNum = pageWrapper ? parseInt(pageWrapper.dataset.pageNumber, 10) : 1;
    this.undoStack.push({
      type: 'element',
      pageNum,
      elements: [note]
    });
    if (note._floatingBar) note._floatingBar.remove();
    note.remove();
    this.activeStickyNote = null;
  }

  placeStamp(pageNum, stampType = 'APPROVED', x = null, y = null) {
    const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
    if (!wrapper) return;

    if (x === null || y === null) {
      const container = document.getElementById('viewer-container');
      if (container) {
        const contRect = container.getBoundingClientRect();
        const wrapRect = wrapper.getBoundingClientRect();
        const viewCenterY = contRect.top + contRect.height / 2;
        const localY = viewCenterY - wrapRect.top - 35;
        y = Math.max(30, Math.min(wrapper.clientHeight - 90, localY));
        x = Math.max(30, Math.round((wrapper.clientWidth - 200) / 2));
      } else {
        x = 100;
        y = 100;
      }
    }

    const stamp = document.createElement('div');
    stamp.className = 'placed-stamp';
    stamp.style.left = `${x}px`;
    stamp.style.top = `${y}px`;

    const badge = document.createElement('div');
    const cleanClass = stampType.toLowerCase().replace(/[^a-z0-9]/g, '');
    badge.className = `stamp-badge stamp-${cleanClass}`;
    badge.textContent = stampType;
    badge.dataset.rotation = '-8';
    stamp.appendChild(badge);

    // Floating Delete Button (✕)
    const btnDel = document.createElement('button');
    btnDel.className = 'textbox-delete-btn';
    btnDel.contentEditable = 'false';
    btnDel.innerHTML = '&times;';
    btnDel.title = 'Delete Stamp';
    btnDel.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.undoStack.push({
        type: 'element',
        pageNum,
        elements: [stamp]
      });
      stamp.remove();
      if (this.activeStamp === stamp) {
        this.setActiveStamp(null);
      }
    };
    stamp.appendChild(btnDel);

    // Stamp selection on click
    stamp.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setActiveStamp(stamp);
      this._selectElement(stamp);
    });

    // Make draggable & resizable
    this._makeDraggable(stamp, wrapper);
    this._makeResizable(stamp, wrapper);
    wrapper.appendChild(stamp);

    this.setActiveStamp(stamp);
    this._selectElement(stamp);

    // Auto-switch tool to select mode so subsequent clicks move/resize the stamp rather than drawing shapes!
    this.setTool('select');
    if (this.ui && typeof this.ui.setAnnotationTool === 'function') {
      this.ui.setAnnotationTool('select');
    }

    this.undoStack.push({
      type: 'element',
      pageNum,
      elements: [stamp]
    });
    this.redoStack = [];
    return stamp;
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
      if (action.span) {
        action.span.textContent = action.prevText;
        if (action.prevText === action.span._originalText) {
          action.span.classList.remove('inline-editing', 'in-place-modified');
          if (this.inPlaceEdits.has(action.pageNum)) {
            this.inPlaceEdits.get(action.pageNum).delete(action.span);
          }
        } else {
          action.span.classList.add('in-place-modified');
          if (this.inPlaceEdits.has(action.pageNum)) {
            this.inPlaceEdits.get(action.pageNum).set(action.span, {
              span: action.span,
              originalText: action.span._originalText,
              newText: action.prevText,
              pageNum: action.pageNum
            });
          }
        }
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
        action.span.textContent = action.newText;
        action.span.classList.add('in-place-modified');
        if (!this.inPlaceEdits.has(action.pageNum)) {
          this.inPlaceEdits.set(action.pageNum, new Map());
        }
        this.inPlaceEdits.get(action.pageNum).set(action.span, {
          span: action.span,
          originalText: action.span._originalText,
          newText: action.newText,
          pageNum: action.pageNum
        });
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
    const { PDFDocument, rgb } = lib;
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
      const pageInPlaceEdits = this.inPlaceEdits?.get(pageNum);
      const hasInPlaceEdits = pageInPlaceEdits && pageInPlaceEdits.size > 0;

      const hasContent = (this.annotations.has(pageNum) && this.annotations.get(pageNum).length > 0) ||
                         textboxes.length > 0 ||
                         stamps.length > 0 ||
                         redactions.length > 0 ||
                         whiteouts.length > 0 ||
                         hasInPlaceEdits;

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
        const rotDeg = parseFloat(wb.dataset.rotation || 0);
        compCtx.save();
        if (rotDeg !== 0) {
          compCtx.translate(wx + ww / 2, wy + wh / 2);
          compCtx.rotate(rotDeg * Math.PI / 180);
          compCtx.fillStyle = '#ffffff';
          compCtx.fillRect(-ww / 2, -wh / 2, ww, wh);
        } else {
          compCtx.fillStyle = '#ffffff';
          compCtx.fillRect(wx, wy, ww, wh);
        }
        compCtx.restore();
      }

      // 2b. Draw In-Place Text Edits (Mask original canvas text with white and render new text using PDF's exact font)
      if (hasInPlaceEdits) {
        for (const [span, edit] of pageInPlaceEdits.entries()) {
          const textToDraw = span.textContent;
          if (textToDraw === undefined || textToDraw === null) continue;

          const cs = window.getComputedStyle(span);
          const wrapperRect = wrapper.getBoundingClientRect();
          const spanRect = span.getBoundingClientRect();

          const sx = (spanRect.left - wrapperRect.left) * scaleX;
          const sy = (spanRect.top - wrapperRect.top) * scaleY;
          const sw = spanRect.width * scaleX;
          const sh = spanRect.height * scaleY;

          const maxAllowedW = (parseFloat(span.style.maxWidth) || spanRect.width || span._originalWidth || 100) * scaleX;
          const maskW = Math.min(maxAllowedW, Math.max(span._originalWidth || 0, spanRect.width) * scaleX);
          const origH = span._originalHeight || spanRect.height || 18;
          const maskH = origH * scaleY; // Strictly original line height, never mask line below!

          // Mask original PDF text underneath with crisp white rectangle
          compCtx.fillStyle = '#ffffff';
          compCtx.fillRect(Math.floor(sx) - 2, Math.floor(sy) - 2, Math.ceil(maskW) + 4, Math.ceil(maskH) + 4);

          // Vector mask on PDF page stream directly
          if (typeof page.drawRectangle === 'function' && typeof rgb === 'function') {
            const pdfScaleX = width / wrapper.clientWidth;
            const pdfScaleY = height / wrapper.clientHeight;
            const pdfX = (spanRect.left - wrapperRect.left) * pdfScaleX;
            const maxAllowedPdfW = (parseFloat(span.style.maxWidth) || spanRect.width || span._originalWidth || 100) * pdfScaleX;
            const pdfW = Math.min(maxAllowedPdfW, Math.max(span._originalWidth || 0, spanRect.width) * pdfScaleX);
            const pdfH = origH * pdfScaleY;
            const pdfY = height - ((spanRect.top - wrapperRect.top + origH) * pdfScaleY);
            page.drawRectangle({
              x: Math.max(0, pdfX - 2),
              y: Math.max(0, pdfY - 2),
              width: pdfW + 4,
              height: pdfH + 4,
              color: rgb(1, 1, 1)
            });
          }

          // Render modified text using PDF's exact font, size, and styling (strictly single-line to protect adjacent lines)
          const fSize = parseFloat(cs.fontSize) * scaleY;
          const fontFamily = edit.fontFamily || span._customFontStack || cs.fontFamily || 'sans-serif';
          const fontWeight = span._customFontWeight || cs.fontWeight || 'normal';
          const fontStyle = span._customFontStyle || cs.fontStyle || 'normal';
          const color = cs.color || '#111827';

          compCtx.save();
          compCtx.font = `${fontStyle} ${fontWeight} ${fSize}px ${fontFamily}`;
          compCtx.fillStyle = color;
          compCtx.textBaseline = 'top';

          const textToRender = (span.innerText || span.textContent || textToDraw || '').replace(/[\r\n]+/g, ' ');
          // Draw single-line text fitted to maskW using Canvas fillText maxWidth parameter
          // This guarantees text stays strictly on its line and never collides with or erases adjacent lines below!
          compCtx.fillText(textToRender, sx, sy, maskW);
          compCtx.restore();
        }
      }

      // 3. Draw placed stamps, signatures, and images
      for (const stamp of stamps) {
        if (stamp.classList.contains('whiteout-box')) continue;
        const sx = stamp.offsetLeft * scaleX;
        const sy = stamp.offsetTop * scaleY;
        const sw = stamp.offsetWidth * scaleX;
        const sh = stamp.offsetHeight * scaleY;
        const rotDeg = parseFloat(stamp.dataset.rotation || 0);

        const img = stamp.querySelector('img');
        if (img && img.complete) {
          compCtx.save();
          if (rotDeg !== 0) {
            compCtx.translate(sx + sw / 2, sy + sh / 2);
            compCtx.rotate(rotDeg * Math.PI / 180);
            compCtx.drawImage(img, -sw / 2, -sh / 2, sw, sh);
          } else {
            compCtx.drawImage(img, sx, sy, sw, sh);
          }
          compCtx.restore();
        } else {
          const badge = stamp.querySelector('.stamp-badge');
          if (badge) {
            compCtx.save();
            compCtx.translate(sx + sw / 2, sy + sh / 2);
            const rotDeg = parseFloat(badge.dataset.rotation || -8);
            compCtx.rotate(rotDeg * Math.PI / 180);

            const badgeCs = window.getComputedStyle(badge);
            const parsedFSize = parseFloat(badge.style.fontSize || badgeCs.fontSize) || 20;
            const fFamily = badge.style.fontFamily || badgeCs.fontFamily || 'sans-serif';
            const stampColor = badge.style.color || badgeCs.color || '#dc2626';
            const stampOpacity = parseFloat(badge.style.opacity || badgeCs.opacity) || 0.85;

            compCtx.globalAlpha = stampOpacity;
            compCtx.font = `bold ${Math.round(parsedFSize * scaleX)}px ${fFamily}`;
            compCtx.strokeStyle = stampColor;
            compCtx.lineWidth = 3 * scaleX;
            compCtx.strokeRect(-sw / 2, -sh / 2, sw, sh);
            compCtx.fillStyle = stampColor;
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

        const rawLines = textContent.split(/\r?\n/);
        const wrappedLines = [];
        const maxLineWidth = Math.max(40, tw - 16 * scaleX);

        rawLines.forEach(rawLine => {
          if (!rawLine) {
            wrappedLines.push('');
            return;
          }
          const words = rawLine.split(' ');
          let currentLine = '';
          for (let w = 0; w < words.length; w++) {
            const word = words[w];
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            if (compCtx.measureText(testLine).width > maxLineWidth && currentLine) {
              wrappedLines.push(currentLine);
              currentLine = word;
            } else {
              currentLine = testLine;
            }
          }
          if (currentLine) {
            wrappedLines.push(currentLine);
          }
        });

        wrappedLines.forEach((line, lineIdx) => {
          let lineX = tx + 8 * scaleX;
          if (textAlign === 'center') {
            lineX = tx + tw / 2;
            compCtx.textAlign = 'center';
          } else if (textAlign === 'right') {
            lineX = tx + tw - 8 * scaleX;
            compCtx.textAlign = 'right';
          } else {
            compCtx.textAlign = 'left';
          }
          compCtx.fillText(line, lineX, ty + 6 * scaleY + lineIdx * lineHeight);
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

  _selectElement(element) {
    this._deselectAllElements();
    if (element) {
      element.classList.add('element-selected');
      if (typeof element._updateBar === 'function') {
        element._updateBar();
      }
    }
  }

  _deselectAllElements() {
    document.querySelectorAll('.element-selected').forEach(el => {
      el.classList.remove('element-selected');
      if (typeof el._updateBar === 'function') {
        el._updateBar();
      }
    });
    document.querySelectorAll('.element-floating-bar').forEach(bar => {
      bar.style.display = 'none';
    });
    if (this.activeStamp && !this.activeStamp.classList.contains('element-selected')) {
      this.setActiveStamp(null);
    }
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

      // Constrain position within the parent page bounds so element NEVER overflows off-page
      const pW = parent.clientWidth || 800;
      const pH = parent.clientHeight || 1100;
      const elW = element.offsetWidth || 50;
      const elH = element.offsetHeight || 30;

      const boundedX = Math.max(0, Math.min(initialX + dx, pW - elW));
      const boundedY = Math.max(0, Math.min(initialY + dy, pH - elH));

      element.style.left = `${Math.round(boundedX)}px`;
      element.style.top = `${Math.round(boundedY)}px`;

      if (typeof element._updateBar === 'function') {
        element._updateBar();
      }

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

      if (typeof element._updateBar === 'function') {
        element._updateBar();
      }
    };

    // Mouse drag handlers: only drag when selected, not locked, and not in view mode
    element.addEventListener('mousedown', (e) => {
      if (document.body.classList.contains('mode-view')) return;
      if (e.target.closest('.element-floating-bar') || e.target.classList.contains('element-resize-handle') || e.target.classList.contains('element-rotate-handle') || e.target.classList.contains('textbox-delete-btn') || e.target.closest('.btn-delete-note') || e.target.closest('button') || e.target.closest('textarea')) {
        return;
      }
      if (e.target.closest('.textbox-drag-bar')) {
        if (e.cancelable) e.preventDefault();
      } else if (e.target.closest('.textbox-content') || e.target.isContentEditable) {
        return;
      }
      e.stopPropagation();

      // Always select element on click so floating toolbar with unlock & delete buttons is revealed
      const wasSelected = element.classList.contains('element-selected');
      if (!wasSelected) {
        this._selectElement(element);
      }
      if (element.classList.contains('placed-stamp')) {
        this.setActiveStamp(element);
      } else if (element.classList.contains('annotation-textbox')) {
        this.setActiveTextBox(element);
      } else if (element.classList.contains('sticky-note-container')) {
        this.activeStickyNote = element;
      }

      // If locked, prevent movement but leave element selected
      if (element.dataset.locked === 'true') return;

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
      if (document.body.classList.contains('mode-view')) return;
      if (e.target.closest('.element-floating-bar') || e.target.classList.contains('element-resize-handle') || e.target.classList.contains('element-rotate-handle') || e.target.classList.contains('textbox-delete-btn') || e.target.closest('.btn-delete-note') || e.target.closest('button') || e.target.closest('textarea')) {
        return;
      }
      if (e.target.closest('.textbox-drag-bar')) {
        // Drag bar explicitly starts touch drag
      } else if (e.target.closest('.textbox-content') || e.target.isContentEditable) {
        return;
      }
      if (e.touches.length === 1) {
        if (!element.classList.contains('element-selected')) {
          this._selectElement(element);
        }
        if (element.classList.contains('placed-stamp')) {
          this.setActiveStamp(element);
        } else if (element.classList.contains('annotation-textbox')) {
          this.setActiveTextBox(element);
        } else if (element.classList.contains('sticky-note-container')) {
          this.activeStickyNote = element;
        }
        if (element.dataset.locked === 'true') return;
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

  _makeResizable(element, parent, { keepAspectRatio = false, isWhiteout = false, isTextBox = false } = {}) {
    // 1. Create 8 resize handles
    const handlePositions = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    handlePositions.forEach(pos => {
      const h = document.createElement('div');
      h.className = `element-resize-handle handle-${pos}`;
      h.dataset.handle = pos;
      h.title = `Resize (${pos.toUpperCase()})`;
      element.appendChild(h);

      this._bindResizeHandle(h, element, parent, keepAspectRatio);
    });

    // 2. Rotation handle (for non-whiteout and non-textbox elements)
    if (!isWhiteout && !isTextBox) {
      const rotLine = document.createElement('div');
      rotLine.className = 'element-rotate-line';
      element.appendChild(rotLine);

      const rotHandle = document.createElement('div');
      rotHandle.className = 'element-rotate-handle';
      rotHandle.title = 'Drag to rotate';
      element.appendChild(rotHandle);

      this._bindRotateHandle(rotHandle, element);
    }

    // 3. Floating action toolbar (attached to parent wrapper so it never rotates with the element)
    const bar = document.createElement('div');
    bar.className = 'element-floating-bar';
    element._floatingBar = bar;
    parent.appendChild(bar);

    const updateBar = () => {
      if (!element.classList.contains('element-selected') || !element.isConnected) {
        bar.style.display = 'none';
        return;
      }
      bar.style.display = 'flex';
      const elRect = element.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      const top = elRect.top - parentRect.top;
      const left = elRect.left - parentRect.left;
      const width = elRect.width;

      if (top < 44) {
        bar.style.top = `${Math.round(top + elRect.height + 8)}px`;
      } else {
        bar.style.top = `${Math.round(top - 38)}px`;
      }
      bar.style.left = `${Math.round(left + width / 2)}px`;
      bar.style.transform = 'translateX(-50%)';
    };
    element._updateBar = updateBar;

    if (isWhiteout) {
      const label = document.createElement('span');
      label.className = 'element-bar-label';
      label.textContent = '⬜ Whiteout Mask';
      bar.appendChild(label);
    } else if (isTextBox) {
      const label = document.createElement('span');
      label.className = 'element-bar-label';
      label.textContent = '🔤 Text Box';
      bar.appendChild(label);
    } else {
      // Rotate 90° CCW
      const btnRotCCW = document.createElement('button');
      btnRotCCW.className = 'element-bar-btn';
      btnRotCCW.innerHTML = '↺';
      btnRotCCW.title = 'Rotate 90° Left';
      btnRotCCW.onclick = (e) => {
        e.stopPropagation();
        let cur = parseFloat(element.dataset.rotation || 0);
        cur = (cur - 90 + 360) % 360;
        element.dataset.rotation = cur;
        element.style.transform = cur === 0 ? '' : `rotate(${cur}deg)`;
        updateBar();
      };
      bar.appendChild(btnRotCCW);

      // Rotate 90° CW
      const btnRotCW = document.createElement('button');
      btnRotCW.className = 'element-bar-btn';
      btnRotCW.innerHTML = '↻';
      btnRotCW.title = 'Rotate 90° Right';
      btnRotCW.onclick = (e) => {
        e.stopPropagation();
        let cur = parseFloat(element.dataset.rotation || 0);
        cur = (cur + 90) % 360;
        element.dataset.rotation = cur;
        element.style.transform = cur === 0 ? '' : `rotate(${cur}deg)`;
        updateBar();
      };
      bar.appendChild(btnRotCW);
    }

    // Lock toggle button
    const btnLock = document.createElement('button');
    btnLock.className = 'element-bar-btn btn-lock';
    const isLockedInit = element.dataset.locked === 'true';
    btnLock.innerHTML = isLockedInit ? '🔒' : '🔓';
    btnLock.title = isLockedInit ? 'Click to Unlock element' : 'Lock in place';
    if (isLockedInit) btnLock.classList.add('is-locked');

    btnLock.onclick = (e) => {
      e.stopPropagation();
      const isLocked = element.dataset.locked === 'true';
      const willLock = !isLocked;
      element.dataset.locked = willLock ? 'true' : 'false';
      element.classList.toggle('element-locked', willLock);
      btnLock.innerHTML = willLock ? '🔒' : '🔓';
      btnLock.title = willLock ? 'Click to Unlock element' : 'Lock in place';
      btnLock.classList.toggle('is-locked', willLock);
      updateBar();
    };
    bar.appendChild(btnLock);

    // Delete button (always accessible even when element is locked)
    const btnDel = document.createElement('button');
    btnDel.className = 'element-bar-btn btn-delete';
    btnDel.innerHTML = '&times;';
    btnDel.title = 'Remove';
    btnDel.onclick = (e) => {
      e.stopPropagation();
      const pageWrapper = element.closest('.page-wrapper');
      const pageNum = pageWrapper ? parseInt(pageWrapper.id.replace('page-wrapper-', ''), 10) : 1;
      this.undoStack.push({
        type: 'element',
        pageNum,
        elements: [element]
      });
      bar.remove();
      element.remove();
    };
    bar.appendChild(btnDel);
  }

  _bindResizeHandle(handle, element, parent, keepAspectRatio) {
    let isResizing = false;
    let startX = 0, startY = 0;
    let startLeft = 0, startTop = 0;
    let startWidth = 0, startHeight = 0;
    let aspectRatio = 1;
    const handleType = handle.dataset.handle;

    const onStart = (clientX, clientY) => {
      if (document.body.classList.contains('mode-view')) return;
      if (element.dataset.locked === 'true') return;
      isResizing = true;
      startX = clientX;
      startY = clientY;
      startLeft = element.offsetLeft;
      startTop = element.offsetTop;
      startWidth = element.offsetWidth;
      startHeight = element.offsetHeight;
      aspectRatio = startWidth / (startHeight || 1);
      document.body.style.userSelect = 'none';
    };

    const onMove = (clientX, clientY) => {
      if (!isResizing) return;
      let dx = clientX - startX;
      let dy = clientY - startY;

      // Project screen delta into local element coordinates when rotated
      const deg = parseFloat(element.dataset.rotation || 0);
      if (deg !== 0) {
        const rad = (deg * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const ldx = dx * cos + dy * sin;
        const ldy = -dx * sin + dy * cos;
        dx = ldx;
        dy = ldy;
      }

      // Corner handles with aspect ratio option
      const isCorner = ['nw', 'ne', 'se', 'sw'].includes(handleType);
      const shouldKeepRatio = keepAspectRatio && isCorner;

      const parentW = parent.clientWidth || 800;
      const parentH = parent.clientHeight || 1100;
      const maxWFromLeft = Math.max(40, parentW - element.offsetLeft - 16);
      const maxHFromTop = Math.max(18, parentH - element.offsetTop - 16);

      if (handleType === 'se') {
        const newW = Math.min(maxWFromLeft, Math.max(40, startWidth + dx));
        const newH = shouldKeepRatio ? Math.max(15, Math.round(newW / aspectRatio)) : Math.min(maxHFromTop, Math.max(18, startHeight + dy));
        element.style.width = `${Math.round(newW)}px`;
        element.style.height = `${Math.round(newH)}px`;
      } else if (handleType === 'e') {
        const newW = Math.min(maxWFromLeft, Math.max(40, startWidth + dx));
        element.style.width = `${Math.round(newW)}px`;
      } else if (handleType === 's') {
        const newH = Math.min(maxHFromTop, Math.max(18, startHeight + dy));
        element.style.height = `${Math.round(newH)}px`;
      } else if (handleType === 'w') {
        const maxExpandLeft = startLeft;
        const newW = Math.min(startWidth + maxExpandLeft, Math.max(40, startWidth - dx));
        element.style.width = `${Math.round(newW)}px`;
        element.style.left = `${Math.max(0, Math.round(startLeft + (startWidth - newW)))}px`;
      } else if (handleType === 'n') {
        const maxExpandTop = startTop;
        const newH = Math.min(startHeight + maxExpandTop, Math.max(18, startHeight - dy));
        element.style.height = `${Math.round(newH)}px`;
        element.style.top = `${Math.max(0, Math.round(startTop + (startHeight - newH)))}px`;
      } else if (handleType === 'ne') {
        const newW = Math.min(maxWFromLeft, Math.max(40, startWidth + dx));
        const maxExpandTop = startTop;
        const newH = shouldKeepRatio ? Math.max(15, Math.round(newW / aspectRatio)) : Math.min(startHeight + maxExpandTop, Math.max(18, startHeight - dy));
        element.style.width = `${Math.round(newW)}px`;
        element.style.height = `${Math.round(newH)}px`;
        element.style.top = `${Math.max(0, Math.round(startTop + (startHeight - newH)))}px`;
      } else if (handleType === 'sw') {
        const maxExpandLeft = startLeft;
        const newW = Math.min(startWidth + maxExpandLeft, Math.max(40, startWidth - dx));
        const newH = shouldKeepRatio ? Math.max(15, Math.round(newW / aspectRatio)) : Math.min(maxHFromTop, Math.max(18, startHeight + dy));
        element.style.width = `${Math.round(newW)}px`;
        element.style.height = `${Math.round(newH)}px`;
        element.style.left = `${Math.max(0, Math.round(startLeft + (startWidth - newW)))}px`;
      } else if (handleType === 'nw') {
        const maxExpandLeft = startLeft;
        const maxExpandTop = startTop;
        const newW = Math.min(startWidth + maxExpandLeft, Math.max(40, startWidth - dx));
        const newH = shouldKeepRatio ? Math.max(15, Math.round(newW / aspectRatio)) : Math.min(startHeight + maxExpandTop, Math.max(18, startHeight - dy));
        element.style.width = `${Math.round(newW)}px`;
        element.style.height = `${Math.round(newH)}px`;
        element.style.left = `${Math.max(0, Math.round(startLeft + (startWidth - newW)))}px`;
        element.style.top = `${Math.max(0, Math.round(startTop + (startHeight - newH)))}px`;
      }

      if (element.classList.contains('annotation-textbox')) {
        element.style.maxWidth = `${Math.max(40, parentW - element.offsetLeft - 16)}px`;
      }

      if (typeof element._updateBar === 'function') {
        element._updateBar();
      }
    };

    const onEnd = () => {
      if (!isResizing) return;
      isResizing = false;
      document.body.style.userSelect = '';
    };

    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      onStart(e.clientX, e.clientY);

      const mouseMove = (ev) => onMove(ev.clientX, ev.clientY);
      const mouseUp = () => {
        window.removeEventListener('mousemove', mouseMove);
        window.removeEventListener('mouseup', mouseUp);
        onEnd();
      };
      window.addEventListener('mousemove', mouseMove);
      window.addEventListener('mouseup', mouseUp);
    });

    handle.addEventListener('touchstart', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (e.touches.length > 0) {
        onStart(e.touches[0].clientX, e.touches[0].clientY);
      }
      const touchMove = (ev) => {
        if (ev.touches.length > 0) {
          onMove(ev.touches[0].clientX, ev.touches[0].clientY);
        }
      };
      const touchEnd = () => {
        window.removeEventListener('touchmove', touchMove);
        window.removeEventListener('touchend', touchEnd);
        onEnd();
      };
      window.addEventListener('touchmove', touchMove, { passive: false });
      window.addEventListener('touchend', touchEnd);
    }, { passive: false });
  }

  _bindRotateHandle(handle, element) {
    let isRotating = false;

    const onStart = (clientX, clientY) => {
      if (document.body.classList.contains('mode-view')) return;
      if (element.dataset.locked === 'true') return;
      isRotating = true;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'grabbing';
    };

    const onMove = (clientX, clientY) => {
      if (!isRotating) return;
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const rad = Math.atan2(clientY - centerY, clientX - centerX);
      let deg = Math.round(rad * (180 / Math.PI)) + 90;
      deg = (deg + 360) % 360;

      // Magnetic snap within 4 degrees of cardinal angles
      if (Math.abs(deg - 0) < 4 || Math.abs(deg - 360) < 4) deg = 0;
      else if (Math.abs(deg - 90) < 4) deg = 90;
      else if (Math.abs(deg - 180) < 4) deg = 180;
      else if (Math.abs(deg - 270) < 4) deg = 270;

      element.dataset.rotation = deg;
      element.style.transform = deg === 0 ? '' : `rotate(${deg}deg)`;
      if (typeof element._updateBar === 'function') {
        element._updateBar();
      }
    };

    const onEnd = () => {
      if (!isRotating) return;
      isRotating = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      if (typeof element._updateBar === 'function') {
        element._updateBar();
      }
    };

    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      onStart(e.clientX, e.clientY);
      const mouseMove = (ev) => onMove(ev.clientX, ev.clientY);
      const mouseUp = () => {
        window.removeEventListener('mousemove', mouseMove);
        window.removeEventListener('mouseup', mouseUp);
        onEnd();
      };
      window.addEventListener('mousemove', mouseMove);
      window.addEventListener('mouseup', mouseUp);
    });

    handle.addEventListener('touchstart', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (e.touches.length > 0) {
        onStart(e.touches[0].clientX, e.touches[0].clientY);
      }
      const touchMove = (ev) => {
        if (ev.touches.length > 0) {
          onMove(ev.touches[0].clientX, ev.touches[0].clientY);
        }
      };
      const touchEnd = () => {
        window.removeEventListener('touchmove', touchMove);
        window.removeEventListener('touchend', touchEnd);
        onEnd();
      };
      window.addEventListener('touchmove', touchMove, { passive: false });
      window.addEventListener('touchend', touchEnd);
    }, { passive: false });
  }
}

