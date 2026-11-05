/**
 * Personal PDF Suite - Annotations & Markup Engine
 * Drawing pen, highlighter, shapes, sticky notes, typewriter textboxes, and stamps.
 */

export class PDFAnnotatorEngine {
  constructor(options = {}) {
    this.container = options.container;
    this.currentTool = 'none'; // 'pen', 'highlighter', 'eraser', 'rectangle', 'circle', 'line', 'arrow', 'note', 'text', 'stamp'
    this.color = '#ef4444';
    this.strokeWidth = 3;
    this.opacity = 1.0;
    this.fontSize = 16;
    
    // Store annotations per page
    // Map<pageNum, Array<AnnotationObject>>
    this.annotations = new Map();
    this.undoStack = [];
    this.redoStack = [];
    this.isDrawing = false;
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

    // Toggle drawing-active class on all annotation layers
    const layers = this.container.querySelectorAll('.annotation-layer');
    layers.forEach(layer => {
      if (this.currentTool === 'none') {
        layer.classList.remove('drawing-active');
      } else {
        layer.classList.add('drawing-active');
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
    if (!this.isDrawing || !this.activeCanvas) return;
    const info = this._getCanvasAndCoords(e);
    if (!info || info.pageNum !== this.activePageNum) return;

    this.currentPath.push({ x: info.x, y: info.y });
    this._renderCurrentStroke();
  }

  _onMouseUp() {
    if (!this.isDrawing) return;
    this.isDrawing = false;

    if (this.currentPath.length > 1 && this.activePageNum) {
      const annot = {
        type: this.currentTool,
        points: [...this.currentPath],
        color: this.color,
        strokeWidth: this.currentTool === 'highlighter' ? 24 : this.strokeWidth,
        opacity: this.currentTool === 'highlighter' ? 0.35 : this.opacity
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
    if (this.currentTool !== 'none' && this.isDrawing) {
      e.preventDefault();
      this._onMouseMove(e);
    }
  }

  _onTouchEnd(e) {
    if (this.currentTool !== 'none') {
      this._onMouseUp(e);
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

    const marker = document.createElement('div');
    marker.className = 'sticky-note-marker';
    marker.style.left = `${x}px`;
    marker.style.top = `${y}px`;
    marker.innerHTML = `💬`;

    const popup = document.createElement('div');
    popup.className = 'sticky-note-popup';
    popup.style.left = `${x + 28}px`;
    popup.style.top = `${y}px`;
    popup.innerHTML = `
      <div class="sticky-note-header">
        <span>Note</span>
        <button class="tool-btn-sm btn-delete-note">✕</button>
      </div>
      <textarea placeholder="Type your comment..."></textarea>
    `;

    popup.querySelector('.btn-delete-note').onclick = (e) => {
      e.stopPropagation();
      marker.remove();
      popup.remove();
    };

    marker.onclick = () => {
      popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
    };

    wrapper.appendChild(marker);
    wrapper.appendChild(popup);
    popup.querySelector('textarea').focus();

    this.undoStack.push({
      type: 'element',
      pageNum,
      elements: [marker, popup]
    });
    this.redoStack = [];
  }

  _addTextBox(pageNum, x, y) {
    const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
    if (!wrapper) return;

    const box = document.createElement('div');
    box.className = 'annotation-textbox';
    box.contentEditable = true;
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
    box.style.fontSize = `${this.fontSize}px`;
    box.style.color = this.color;
    box.innerText = 'Click to edit text';

    wrapper.appendChild(box);
    box.focus();

    box.onblur = () => {
      if (!box.innerText.trim()) box.remove();
    };

    this.undoStack.push({
      type: 'element',
      pageNum,
      elements: [box]
    });
    this.redoStack = [];
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
    if (!window.PDFLib) return pdfBytes;
    const { PDFDocument } = window.PDFLib;
    const doc = await PDFDocument.load(pdfBytes);
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

      const hasContent = (this.annotations.has(pageNum) && this.annotations.get(pageNum).length > 0) ||
                         textboxes.length > 0 ||
                         stamps.length > 0 ||
                         redactions.length > 0;

      if (!hasContent) continue;

      // Composite onto a high-res temporary canvas
      const compCanvas = document.createElement('canvas');
      compCanvas.width = annotCanvas.width;
      compCanvas.height = annotCanvas.height;
      const compCtx = compCanvas.getContext('2d');

      // 1. Draw ink canvas
      if (annotCanvas) {
        compCtx.drawImage(annotCanvas, 0, 0);
      }

      // 2. Draw placed stamps
      const scaleX = compCanvas.width / wrapper.clientWidth;
      const scaleY = compCanvas.height / wrapper.clientHeight;

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

      // 3. Draw text boxes
      for (const tb of textboxes) {
        const tx = tb.offsetLeft * scaleX;
        const ty = tb.offsetTop * scaleY;
        const fSize = parseFloat(window.getComputedStyle(tb).fontSize) * scaleY;
        compCtx.font = `${fSize}px sans-serif`;
        compCtx.fillStyle = window.getComputedStyle(tb).color || '#000000';
        compCtx.textBaseline = 'top';
        compCtx.fillText(tb.innerText, tx, ty);
      }

      // 4. Draw redaction blackouts
      for (const rb of redactions) {
        const rx = rb.offsetLeft * scaleX;
        const ry = rb.offsetTop * scaleY;
        const rw = rb.offsetWidth * scaleX;
        const rh = rb.offsetHeight * scaleY;
        compCtx.fillStyle = '#000000';
        compCtx.fillRect(rx, ry, rw, rh);
      }

      // 5. Draw whiteout boxes
      const whiteouts = wrapper.querySelectorAll('.whiteout-box');
      for (const wb of whiteouts) {
        const wx = wb.offsetLeft * scaleX;
        const wy = wb.offsetTop * scaleY;
        const ww = wb.offsetWidth * scaleX;
        const wh = wb.offsetHeight * scaleY;
        compCtx.fillStyle = '#ffffff';
        compCtx.fillRect(wx, wy, ww, wh);
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

    element.onmousedown = (e) => {
      e.stopPropagation();
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      initialX = element.offsetLeft;
      initialY = element.offsetTop;

      const onMouseMove = (moveEvt) => {
        if (!isDragging) return;
        const dx = moveEvt.clientX - startX;
        const dy = moveEvt.clientY - startY;
        element.style.left = `${initialX + dx}px`;
        element.style.top = `${initialY + dy}px`;
      };

      const onMouseUp = () => {
        isDragging = false;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    };
  }
}

