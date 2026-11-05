/**
 * Personal PDF Suite - Digital / Electronic Signatures Engine
 * Draw signature, type signature with cursive font, or upload image, and stamp to pages.
 */

export class PDFSignatureEngine {
  constructor(options = {}) {
    this.modal = document.getElementById('modal-signature');
    this.canvas = document.getElementById('sig-canvas');
    this.typeInput = document.getElementById('sig-type-input');
    this.typePreview = document.getElementById('sig-type-preview');
    this.imageInput = document.getElementById('sig-image-file');
    
    this.currentMode = 'draw';
    this.currentColor = '#000000';
    this.isDrawing = false;
    this.lastPoint = null;
    this.signatureDataUrl = null;

    this.onSignatureReady = options.onSignatureReady || (() => {});

    this._initCanvas();
    this._bindEvents();
  }

  _initCanvas() {
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.lineWidth = 2.5;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.strokeStyle = this.currentColor;
  }

  _bindEvents() {
    // Mode tabs
    const tabs = document.querySelectorAll('.sig-tab');
    tabs.forEach(tab => {
      tab.onclick = () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.currentMode = tab.dataset.sigMode;
        
        document.querySelectorAll('.sig-pane').forEach(p => p.classList.remove('active'));
        const activePane = document.getElementById(`sig-pane-${this.currentMode}`);
        if (activePane) activePane.classList.add('active');
      };
    });

    // Draw canvas events
    if (this.canvas) {
      this.canvas.onmousedown = (e) => this._startDrawing(e);
      this.canvas.onmousemove = (e) => this._draw(e);
      window.addEventListener('mouseup', () => this._stopDrawing());

      this.canvas.ontouchstart = (e) => {
        e.preventDefault();
        this._startDrawing(e.touches[0]);
      };
      this.canvas.ontouchmove = (e) => {
        e.preventDefault();
        this._draw(e.touches[0]);
      };
      window.addEventListener('touchend', () => this._stopDrawing());
    }

    // Clear button
    const btnClear = document.getElementById('btn-sig-clear');
    if (btnClear) {
      btnClear.onclick = () => this.clearCanvas();
    }

    // Color buttons
    document.querySelectorAll('.color-dot').forEach(dot => {
      dot.onclick = () => {
        document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        this.currentColor = dot.dataset.color;
        if (this.ctx) this.ctx.strokeStyle = this.currentColor;
      };
    });

    // Type input
    if (this.typeInput) {
      this.typeInput.oninput = () => {
        const text = this.typeInput.value || 'Your Signature';
        this.typePreview.textContent = text;
      };
    }

    // Image input
    if (this.imageInput) {
      this.imageInput.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            this.signatureDataUrl = evt.target.result;
          };
          reader.readAsDataURL(file);
        }
      };
    }

    // Apply button
    const btnApply = document.getElementById('btn-apply-signature');
    if (btnApply) {
      btnApply.onclick = () => this._generateAndPlaceSignature();
    }
  }

  _startDrawing(e) {
    this.isDrawing = true;
    const rect = this.canvas.getBoundingClientRect();
    this.lastPoint = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  _draw(e) {
    if (!this.isDrawing) return;
    const rect = this.canvas.getBoundingClientRect();
    const currentPoint = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };

    this.ctx.beginPath();
    this.ctx.moveTo(this.lastPoint.x, this.lastPoint.y);
    this.ctx.lineTo(currentPoint.x, currentPoint.y);
    this.ctx.stroke();

    this.lastPoint = currentPoint;
  }

  _stopDrawing() {
    this.isDrawing = false;
  }

  clearCanvas() {
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  openModal() {
    this.clearCanvas();
    this.modal.classList.add('open');
  }

  closeModal() {
    this.modal.classList.remove('open');
  }

  _generateAndPlaceSignature() {
    let finalDataUrl = null;

    if (this.currentMode === 'draw') {
      finalDataUrl = this.canvas.toDataURL('image/png');
    } else if (this.currentMode === 'type') {
      // Render cursive text to offscreen canvas
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = 450;
      tempCanvas.height = 120;
      const ctx = tempCanvas.getContext('2d');
      ctx.font = '54px "Dancing Script", cursive';
      ctx.fillStyle = this.currentColor;
      ctx.textBaseline = 'middle';
      ctx.fillText(this.typeInput.value || 'Signature', 20, 60);
      finalDataUrl = tempCanvas.toDataURL('image/png');
    } else if (this.currentMode === 'image') {
      finalDataUrl = this.signatureDataUrl;
    }

    if (!finalDataUrl) {
      alert('Please draw, type, or upload a signature first.');
      return;
    }

    this.closeModal();
    this.onSignatureReady(finalDataUrl);
  }

  placeSignatureOnPage(pageNum, dataUrl, x = 120, y = 200) {
    const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
    if (!wrapper) return;

    const container = document.createElement('div');
    container.className = 'placed-stamp';
    container.style.left = `${x}px`;
    container.style.top = `${y}px`;
    container.style.width = '180px';

    const img = document.createElement('img');
    img.src = dataUrl;
    container.appendChild(img);

    // Draggable
    let isDragging = false;
    let startX, startY, initX, initY;

    container.onmousedown = (e) => {
      e.stopPropagation();
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      initX = container.offsetLeft;
      initY = container.offsetTop;

      const onMove = (moveEvt) => {
        if (!isDragging) return;
        container.style.left = `${initX + (moveEvt.clientX - startX)}px`;
        container.style.top = `${initY + (moveEvt.clientY - startY)}px`;
      };

      const onUp = () => {
        isDragging = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };

    wrapper.appendChild(container);
  }
}

