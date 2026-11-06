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
    this.removeBgCheckbox = document.getElementById('sig-remove-bg');
    this.thresholdSlider = document.getElementById('sig-threshold');
    this.thresholdVal = document.getElementById('sig-threshold-val');
    this.previewCanvas = document.getElementById('sig-image-preview-canvas');
    this.imageOptions = document.getElementById('sig-image-options');
    
    this.currentMode = 'draw';
    this.currentColor = '#000000';
    this.isDrawing = false;
    this.lastPoint = null;
    this.signatureDataUrl = null;
    this.rawImage = null;

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

    // Image input and transparency options
    if (this.imageInput) {
      this.imageInput.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            const img = new Image();
            img.onload = () => {
              this.rawImage = img;
              if (this.imageOptions) this.imageOptions.style.display = 'block';
              this._updateImageSignaturePreview();
            };
            img.src = evt.target.result;
          };
          reader.readAsDataURL(file);
        }
      };
    }

    if (this.removeBgCheckbox) {
      this.removeBgCheckbox.onchange = () => {
        const thresholdRow = document.getElementById('sig-threshold-row');
        if (thresholdRow) {
          thresholdRow.style.display = this.removeBgCheckbox.checked ? 'flex' : 'none';
        }
        this._updateImageSignaturePreview();
      };
    }

    if (this.thresholdSlider) {
      this.thresholdSlider.oninput = () => {
        if (this.thresholdVal) this.thresholdVal.textContent = this.thresholdSlider.value;
        this._updateImageSignaturePreview();
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

  _updateImageSignaturePreview() {
    if (!this.rawImage) return;
    const removeBg = this.removeBgCheckbox ? this.removeBgCheckbox.checked : true;
    const threshold = this.thresholdSlider ? parseInt(this.thresholdSlider.value, 10) : 215;

    const processedDataUrl = this.extractSignatureInk(this.rawImage, removeBg, threshold);
    this.signatureDataUrl = processedDataUrl;

    if (this.previewCanvas) {
      const pImg = new Image();
      pImg.onload = () => {
        this.previewCanvas.width = pImg.naturalWidth || pImg.width;
        this.previewCanvas.height = pImg.naturalHeight || pImg.height;
        const pCtx = this.previewCanvas.getContext('2d');
        pCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
        pCtx.drawImage(pImg, 0, 0);
      };
      pImg.src = processedDataUrl;
    }
  }

  extractSignatureInk(img, removeBg = true, threshold = 215) {
    const canvas = document.createElement('canvas');
    const w = img.naturalWidth || img.width || 400;
    const h = img.naturalHeight || img.height || 160;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    if (!removeBg) {
      return canvas.toDataURL('image/png');
    }

    try {
      const imgData = ctx.getImageData(0, 0, w, h);
      const data = imgData.data;
      const totalPixels = w * h;

      // 1. Adaptive paper detection: Sample perimeter borders to find actual paper color & brightness
      let borderR = 0, borderG = 0, borderB = 0, borderCount = 0;
      const borderThickness = Math.max(2, Math.floor(Math.min(w, h) * 0.08));

      for (let y = 0; y < h; y += 2) {
        for (let x = 0; x < w; x += 2) {
          if (y < borderThickness || y >= h - borderThickness || x < borderThickness || x >= w - borderThickness) {
            const idx = (y * w + x) * 4;
            borderR += data[idx];
            borderG += data[idx + 1];
            borderB += data[idx + 2];
            borderCount++;
          }
        }
      }

      const bgR = borderCount > 0 ? (borderR / borderCount) : 255;
      const bgG = borderCount > 0 ? (borderG / borderCount) : 255;
      const bgB = borderCount > 0 ? (borderB / borderCount) : 255;
      const bgLum = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;

      // 2. Find minimum ink luminance
      let minLum = 255;
      for (let i = 0; i < data.length; i += 16) {
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (lum < minLum) minLum = lum;
      }

      // Sensitivity factor: slider 140-250 maps to 0.1 - 0.95
      const sensitivity = Math.max(0.1, Math.min(0.95, (threshold - 130) / 120));
      const contrastRange = Math.max(15, bgLum - minLum);
      const cutoff = bgLum - (contrastRange * (0.04 + (1.0 - sensitivity) * 0.42));
      const colorTolerance = 25 * (sensitivity + 0.4);

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const colorDist = Math.hypot(r - bgR, g - bgG, b - bgB);

        // If luminance is close to paper or color is paper-like -> 100% transparent
        if (lum >= cutoff || colorDist < colorTolerance) {
          data[i + 3] = 0;
        } else {
          // Dark ink -> smooth antialiased alpha transition
          const delta = cutoff - lum;
          const alphaRatio = delta / Math.max(10, cutoff - minLum);
          const alpha = Math.min(255, Math.max(0, Math.round(255 * Math.pow(alphaRatio, 0.75))));
          data[i + 3] = alpha;

          // Preserve rich blue ink if detected, otherwise render deep crisp dark ink
          const isBlueInk = (b > r + 15 && b > g + 10);
          if (isBlueInk) {
            data[i] = Math.min(25, r);
            data[i + 1] = Math.min(50, g);
            data[i + 2] = Math.max(120, b);
          } else {
            data[i] = Math.min(20, Math.max(0, r - 60));
            data[i + 1] = Math.min(20, Math.max(0, g - 60));
            data[i + 2] = Math.min(20, Math.max(0, b - 60));
          }
        }
      }

      ctx.putImageData(imgData, 0, 0);
      return canvas.toDataURL('image/png');
    } catch (_) {
      return canvas.toDataURL('image/png');
    }
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

