/**
 * Personal PDF Suite - Export & Printing Engine
 * Convert PDF to PNG images, extract clean text, and native high-res printing.
 */

import { healPdfTextLigatures } from './pdf-viewer.js';

export class PDFExportEngine {
  constructor(viewer, app = null) {
    this.viewer = viewer;
    this.app = app || (typeof window !== 'undefined' ? window.app : null);
  }

  _wrapCanvasText(ctx, text, maxWidth) {
    const paragraphs = String(text).replace(/\r\n?/g, '\n').split('\n');
    const lines = [];
    for (const para of paragraphs) {
      if (!para) {
        lines.push('');
        continue;
      }
      const words = para.split(/\s+/);
      let current = '';
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (current && ctx.measureText(candidate).width > maxWidth) {
          lines.push(current);
          current = word;
        } else {
          current = candidate;
        }
      }
      if (current) lines.push(current);
    }
    return lines.length > 0 ? lines : [''];
  }

  /**
   * Draw every visible layer of a rendered page onto one canvas: PDF content,
   * ink, whiteouts, in-place edits, stamps/signatures/images, text boxes and
   * redaction boxes. Used by both PNG export and printing.
   */
  _compositePageCanvas(pageNum, targetWidth, targetHeight) {
    const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
    if (!wrapper) return null;
    const origCanvas = wrapper.querySelector('canvas.pdf-canvas, canvas[id^="page-canvas-"]');
    if (!origCanvas || origCanvas.width === 0 || origCanvas.height === 0) return null;

    const out = document.createElement('canvas');
    out.width = targetWidth || origCanvas.width;
    out.height = targetHeight || origCanvas.height;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);

    // 1. Base PDF render
    ctx.drawImage(origCanvas, 0, 0, out.width, out.height);

    // 2. Ink / highlighter / shapes
    const annotCanvas = document.getElementById(`annot-canvas-${pageNum}`);
    if (annotCanvas) {
      ctx.drawImage(annotCanvas, 0, 0, out.width, out.height);
    }

    const wrapW = wrapper.clientWidth || 1;
    const wrapH = wrapper.clientHeight || 1;
    const scaleX = out.width / wrapW;
    const scaleY = out.height / wrapH;

    // 3. Whiteout masks
    wrapper.querySelectorAll('.whiteout-box').forEach(wb => {
      const wx = wb.offsetLeft * scaleX;
      const wy = wb.offsetTop * scaleY;
      const ww = wb.offsetWidth * scaleX;
      const wh = wb.offsetHeight * scaleY;
      const rotDeg = parseFloat(wb.dataset.rotation || 0);
      ctx.save();
      ctx.fillStyle = '#ffffff';
      if (rotDeg !== 0) {
        ctx.translate(wx + ww / 2, wy + wh / 2);
        ctx.rotate(rotDeg * Math.PI / 180);
        ctx.fillRect(-ww / 2, -wh / 2, ww, wh);
      } else {
        ctx.fillRect(wx, wy, ww, wh);
      }
      ctx.restore();
    });

    // 4. In-place text edits: mask the original text and draw the new paragraph.
    wrapper.querySelectorAll('.textLayer span.in-place-modified, .textLayer span.inline-editing').forEach(span => {
      const cs = window.getComputedStyle(span);
      const fSize = parseFloat(cs.fontSize) * scaleY;
      const fontFamily = span._customFontStack || cs.fontFamily || 'sans-serif';
      const fontWeight = span._customFontWeight || cs.fontWeight || 'normal';
      const fontStyle = cs.fontStyle || 'normal';
      const color = cs.color || span._originalColor || '#111827';
      // Use the visual position: previous paragraph edits may have shifted
      // this span with translateY(), and offsetTop ignores transforms.
      const wrapperRect = wrapper.getBoundingClientRect();
      const spanRect = span.getBoundingClientRect();
      const sx = (spanRect.left - wrapperRect.left) * scaleX;
      const sy = (spanRect.top - wrapperRect.top) * scaleY;
      const origH = (span._originalHeight || 18) * scaleY;
      const maxW = parseFloat(span.style.maxWidth) || spanRect.width || span.offsetWidth || 100;
      const maskW = Math.max(span._originalWidth || 0, spanRect.width, maxW) * scaleX;
      const csFontPx = parseFloat(cs.fontSize) || 1;
      const csLinePx = parseFloat(cs.lineHeight);
      const lineRatio = span._lineHeightRatio || (csLinePx && !isNaN(csLinePx) ? csLinePx / csFontPx : 1.2);
      const lineHeight = fSize * lineRatio;

      ctx.save();
      ctx.font = `${fontStyle} ${fontWeight} ${fSize}px ${fontFamily}`;
      ctx.fillStyle = color;
      ctx.textBaseline = 'top';

      const textContentVal = String(span.innerText !== undefined ? span.innerText : span.textContent || '');
      const lines = this._wrapCanvasText(ctx, textContentVal, Math.max(1, maskW));
      const blockH = Math.max(origH, lines.length * lineHeight);

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(Math.floor(sx) - 2, Math.floor(sy) - 2, Math.ceil(maskW) + 4, Math.ceil(blockH) + 4);

      ctx.fillStyle = color;
      lines.forEach((line, idx) => {
        if (line) ctx.fillText(line, sx, sy + idx * lineHeight);
      });
      ctx.restore();
    });

    // 5. Stamps, signatures and placed images
    wrapper.querySelectorAll('.placed-stamp').forEach(stamp => {
      if (stamp.classList.contains('whiteout-box')) return;
      const sx = stamp.offsetLeft * scaleX;
      const sy = stamp.offsetTop * scaleY;
      const sw = stamp.offsetWidth * scaleX;
      const sh = stamp.offsetHeight * scaleY;
      const rotDeg = parseFloat(stamp.dataset.rotation || 0);
      const img = stamp.querySelector('img');

      if (img && img.complete) {
        ctx.save();
        if (rotDeg !== 0) {
          ctx.translate(sx + sw / 2, sy + sh / 2);
          ctx.rotate(rotDeg * Math.PI / 180);
          ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);
        } else {
          ctx.drawImage(img, sx, sy, sw, sh);
        }
        ctx.restore();
        return;
      }

      const badge = stamp.querySelector('.stamp-badge');
      if (badge) {
        const badgeCs = window.getComputedStyle(badge);
        const parsedFSize = parseFloat(badge.style.fontSize || badgeCs.fontSize) || 20;
        const fFamily = badge.style.fontFamily || badgeCs.fontFamily || 'sans-serif';
        const stampColor = badge.style.color || badgeCs.color || '#dc2626';
        const stampOpacity = parseFloat(badge.style.opacity || badgeCs.opacity) || 0.85;
        const badgeRot = parseFloat(badge.dataset.rotation || -8);
        ctx.save();
        ctx.translate(sx + sw / 2, sy + sh / 2);
        ctx.rotate(badgeRot * Math.PI / 180);
        ctx.globalAlpha = stampOpacity;
        ctx.font = `bold ${Math.round(parsedFSize * scaleX)}px ${fFamily}`;
        ctx.strokeStyle = stampColor;
        ctx.lineWidth = 3 * scaleX;
        ctx.strokeRect(-sw / 2, -sh / 2, sw, sh);
        ctx.fillStyle = stampColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(badge.textContent, 0, 0);
        ctx.restore();
      }
    });

    // 6. Typewriter text boxes
    wrapper.querySelectorAll('.annotation-textbox').forEach(tb => {
      const contentEl = tb.querySelector('.textbox-content') || tb;
      const textContent = contentEl.innerText || contentEl.textContent || '';
      if (!textContent.trim()) return;

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
      const lineHeight = (!isNaN(parsedLineHeight) && parsedLineHeight > 0) ? parsedLineHeight * scaleY : fSize * 1.3;

      if (tb.classList.contains('in-place-editor') || (cs.backgroundColor && cs.backgroundColor.includes('255, 255, 255'))) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(tx - 1, ty - 1, tw + 2, (tb.offsetHeight * scaleY) + 2);
      }

      ctx.save();
      ctx.font = `${fontStyle} ${fontWeight} ${fSize}px ${fontFamily}`;
      ctx.fillStyle = color;
      ctx.textBaseline = 'top';

      const maxLineWidth = Math.max(40, tw - 16 * scaleX);
      const wrappedLines = [];
      textContent.split(/\r?\n/).forEach(rawLine => {
        if (!rawLine) { wrappedLines.push(''); return; }
        let currentLine = '';
        rawLine.split(' ').forEach(word => {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          if (ctx.measureText(testLine).width > maxLineWidth && currentLine) {
            wrappedLines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        });
        if (currentLine) wrappedLines.push(currentLine);
      });

      wrappedLines.forEach((line, lineIdx) => {
        let lineX = tx + 8 * scaleX;
        if (textAlign === 'center') {
          lineX = tx + tw / 2;
          ctx.textAlign = 'center';
        } else if (textAlign === 'right') {
          lineX = tx + tw - 8 * scaleX;
          ctx.textAlign = 'right';
        } else {
          ctx.textAlign = 'left';
        }
        ctx.fillText(line, lineX, ty + 6 * scaleY + lineIdx * lineHeight);
      });
      ctx.restore();
    });

    // 7. Redaction blackouts
    wrapper.querySelectorAll('.redaction-box').forEach(rb => {
      ctx.fillStyle = '#000000';
      ctx.fillRect(rb.offsetLeft * scaleX, rb.offsetTop * scaleY, rb.offsetWidth * scaleX, rb.offsetHeight * scaleY);
    });

    return out;
  }

  async exportPageAsImage(pageNum, format = 'image/png') {
    const targetPage = Math.max(1, Math.min(pageNum || 1, this.viewer.totalPages || 1));
    const wrapper = document.getElementById(`page-wrapper-${targetPage}`);
    const origCanvas = wrapper?.querySelector('canvas.pdf-canvas, canvas[id^="page-canvas-"]');

    // Strategy 1: High-res composite directly from viewer DOM if page is rendered
    if (origCanvas && origCanvas.width > 0 && origCanvas.height > 0) {
      const exportCanvas = this._compositePageCanvas(targetPage, origCanvas.width, origCanvas.height);
      if (exportCanvas) return exportCanvas.toDataURL(format, 0.95);
    }

    // Strategy 2: Render directly from PDF.js if not present in DOM
    if (!this.viewer.pdfDoc) return null;
    const page = await this.viewer.pdfDoc.getPage(targetPage);
    const effectiveRot = ((page.rotate || 0) + (this.viewer?.rotation || 0)) % 360;
    const viewport = page.getViewport({ scale: 2.0, rotation: effectiveRot }); // 2x sharp print quality

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport: viewport }).promise;

    return canvas.toDataURL(format, 0.95);
  }

  async exportAllPagesAsImages() {
    if (!this.viewer.pdfDoc) return [];
    const images = [];
    for (let i = 1; i <= this.viewer.totalPages; i++) {
      const dataUrl = await this.exportPageAsImage(i);
      images.push({ pageNum: i, dataUrl });
    }
    return images;
  }

  async extractAllText() {
    if (!this.viewer.pdfDoc) return '';
    let fullText = '';
    for (let i = 1; i <= this.viewer.totalPages; i++) {
      const page = await this.viewer.pdfDoc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => healPdfTextLigatures(item.str)).join(' ');
      fullText += `--- Page ${i} ---\n${pageText}\n\n`;
    }
    return fullText;
  }

  _blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result;
        if (typeof dataUrl === 'string') {
          const commaIdx = dataUrl.indexOf(',');
          resolve(commaIdx >= 0 ? dataUrl.substring(commaIdx + 1) : dataUrl);
        } else {
          resolve('');
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async downloadFile(data, fileName, mimeType = 'application/pdf', { skipShare = false } = {}) {
    let blob;
    if (data instanceof Blob) {
      blob = data;
    } else if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
      blob = new Blob([data], { type: mimeType });
    } else if (typeof data === 'string') {
      blob = new Blob([data], { type: mimeType });
    } else {
      blob = new Blob([data], { type: mimeType });
    }

    const isCapacitor = typeof window !== 'undefined' && 
      (Boolean(window.Capacitor?.isNativePlatform?.()) || window.Capacitor?.platform === 'android');
    const isMobileDevice = typeof navigator !== 'undefined' && 
      /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '');

    // 1. Android Capacitor Native Filesystem & Share
    if (isCapacitor) {
      try {
        const plugins = window.Capacitor?.Plugins;
        let Filesystem = plugins?.Filesystem || (window.Capacitor?.registerPlugin && window.Capacitor.registerPlugin('Filesystem'));
        let Share = plugins?.Share || (window.Capacitor?.registerPlugin && window.Capacitor.registerPlugin('Share'));
        const base64Data = await this._blobToBase64(blob);

        let fileUri = null;
        if (Filesystem) {
          try {
            const res = await Filesystem.writeFile({
              path: fileName,
              data: base64Data,
              directory: 'DOCUMENTS',
              recursive: true
            });
            fileUri = res?.uri;
          } catch (docErr) {
            console.warn('Filesystem.writeFile to DOCUMENTS failed, falling back to CACHE directory:', docErr);
            const res = await Filesystem.writeFile({
              path: fileName,
              data: base64Data,
              directory: 'CACHE',
              recursive: true
            });
            fileUri = res?.uri;
          }
        }

        // Open Android Native Save / Share Picker so user can choose exact folder or app
        if (Share && !skipShare && fileUri) {
          await Share.share({
            title: fileName,
            text: `Save ${fileName}`,
            url: fileUri,
            dialogTitle: `Save ${fileName}`
          });
        }

        return {
          success: true,
          destination: 'Documents folder & Android Save Sheet',
          fileName,
          uri: fileUri
        };
      } catch (capErr) {
        if (capErr.name === 'AbortError' || capErr.message?.toLowerCase().includes('cancel') || capErr.message?.toLowerCase().includes('closed')) {
          // File was still written to Documents directory
          return { success: true, destination: 'Documents folder', fileName };
        }
        console.warn('Capacitor native download error:', capErr);
      }
    }

    // 2. Mobile Browser Web Share API (Mobile Devices ONLY - NEVER run on Windows/Linux desktop)
    if (isMobileDevice && typeof navigator !== 'undefined' && navigator.canShare && typeof File !== 'undefined' && !skipShare) {
      try {
        const file = new File([blob], fileName, { type: mimeType });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: fileName,
            text: `Save ${fileName}`
          });
          return { success: true, destination: 'Saved via Share dialog', fileName };
        }
      } catch (shareErr) {
        if (shareErr.name === 'AbortError') {
          return { success: false, cancelled: true, destination: 'Cancelled', fileName };
        }
        console.warn('Web Share API error:', shareErr);
      }
    }

    // 3. Desktop (Windows, Linux, macOS): Direct File Download to Downloads folder
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 20000);
      return { success: true, destination: 'Downloads folder', fileName };
    } catch (urlErr) {
      console.warn('Object URL download failed:', urlErr);
    }

    // 4. Fallback Data URL for Desktop
    try {
      const dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return { success: true, destination: 'Downloads folder', fileName };
    } catch (dataErr) {
      console.error('Data URL fallback failed:', dataErr);
    }

    return { success: false, destination: 'Unknown', fileName };
  }

  async downloadFiles(files = []) {
    if (!files || files.length === 0) return { success: false, results: [] };

    const isCapacitor = typeof window !== 'undefined' && 
      (Boolean(window.Capacitor?.isNativePlatform?.()) || window.Capacitor?.platform === 'android');

    if (isCapacitor) {
      const plugins = window.Capacitor?.Plugins;
      let Filesystem = plugins?.Filesystem || (window.Capacitor?.registerPlugin && window.Capacitor.registerPlugin('Filesystem'));
      let Share = plugins?.Share || (window.Capacitor?.registerPlugin && window.Capacitor.registerPlugin('Share'));

      const savedUris = [];
      const results = [];

      for (const item of files) {
        let blob;
        if (item.data instanceof Blob) {
          blob = item.data;
        } else {
          blob = new Blob([item.data], { type: item.mimeType || 'application/pdf' });
        }
        const base64Data = await this._blobToBase64(blob);
        let fileUri = null;
        if (Filesystem) {
          try {
            const res = await Filesystem.writeFile({
              path: item.fileName,
              data: base64Data,
              directory: 'DOCUMENTS',
              recursive: true
            });
            fileUri = res?.uri;
          } catch (e) {
            console.warn('Write to DOCUMENTS failed, trying CACHE directory:', e);
            const res = await Filesystem.writeFile({
              path: item.fileName,
              data: base64Data,
              directory: 'CACHE',
              recursive: true
            });
            fileUri = res?.uri;
          }
        }
        if (fileUri) savedUris.push(fileUri);
        results.push({
          name: item.fileName,
          size: blob.size,
          uri: fileUri,
          destination: 'Documents folder & Android Save Sheet'
        });
      }

      // Pop native Android Share / Save Sheet for the files
      if (Share && savedUris.length > 0) {
        try {
          if (savedUris.length === 1) {
            await Share.share({
              title: files[0].fileName,
              text: `Save ${files[0].fileName}`,
              url: savedUris[0],
              dialogTitle: `Save ${files[0].fileName}`
            });
          } else {
            await Share.share({
              title: `${files.length} PDF Documents`,
              text: `Save ${files.length} split PDF documents`,
              files: savedUris,
              dialogTitle: `Save ${files.length} PDF files`
            });
          }
        } catch (shareErr) {
          console.warn('Native share sheet dismissed or error:', shareErr);
        }
      }

      return {
        success: true,
        destination: 'Documents folder & Android Save Sheet',
        files: results
      };
    }

    // Desktop fallback: download sequentially
    const results = [];
    for (const item of files) {
      const res = await this.downloadFile(item.data, item.fileName, item.mimeType || 'application/pdf');
      results.push({
        name: item.fileName,
        size: item.data?.length || item.data?.size || 0,
        destination: res?.destination || 'Downloads folder'
      });
    }
    return {
      success: true,
      destination: 'Downloads folder',
      files: results
    };
  }

  preparePrintContainer() {
    // Always rebuild: annotations may have changed since the last print, and
    // a cached container would print a stale snapshot.
    const existing = document.getElementById('print-render-container');
    if (existing) existing.remove();

    const currentDoc = this.app?.currentDocName || this.viewer?.currentDocName || 'default';
    const container = document.createElement('div');
    container.id = 'print-render-container';
    container.dataset.docName = currentDoc;

    const viewer = this.viewer || this.app?.viewer || (typeof window !== 'undefined' ? window.app?.viewer : null);
    const totalPages = viewer?.totalPages || 1;

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
      const origCanvas = wrapper?.querySelector('canvas.pdf-canvas, canvas[id^="page-canvas-"]');
      if (!origCanvas || origCanvas.width === 0 || origCanvas.height === 0) continue;

      const printCanvas = this._compositePageCanvas(pageNum, origCanvas.width, origCanvas.height);
      if (!printCanvas) continue;
      printCanvas.className = 'print-page-canvas';

      const sheet = document.createElement('div');
      sheet.className = 'print-page-sheet';
      sheet.appendChild(printCanvas);
      container.appendChild(sheet);
    }

    document.body.appendChild(container);
    return container;
  }

  cleanupPrintContainer() {
    const container = document.getElementById('print-render-container');
    if (container) container.remove();
  }

  printDocument() {
    const viewer = this.viewer || this.app?.viewer || (typeof window !== 'undefined' ? window.app?.viewer : null);
    if (!viewer || !viewer.pdfDoc) {
      const ui = this.app?.ui || (typeof window !== 'undefined' ? window.app?.ui : null);
      if (ui && ui.showToast) {
        ui.showToast('Please open a PDF document to print', 'warning');
      } else {
        alert('Please open a PDF document to print');
      }
      return;
    }

    this.preparePrintContainer();
    window.print();
  }
}

