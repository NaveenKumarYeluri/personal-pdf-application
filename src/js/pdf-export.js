/**
 * Personal PDF Suite - Export & Printing Engine
 * Convert PDF to PNG images, extract clean text, and native high-res printing.
 */

import { healPdfTextLigatures } from './pdf-viewer.js';

export class PDFExportEngine {
  constructor(viewer) {
    this.viewer = viewer;
  }

  async exportPageAsImage(pageNum, format = 'image/png') {
    const targetPage = Math.max(1, Math.min(pageNum || 1, this.viewer.totalPages || 1));
    const wrapper = document.getElementById(`page-wrapper-${targetPage}`);
    const origCanvas = wrapper?.querySelector('canvas.pdf-canvas, canvas[id^="page-canvas-"]');

    // Strategy 1: High-res composite directly from viewer DOM if page is rendered
    if (origCanvas && origCanvas.width > 0 && origCanvas.height > 0) {
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = origCanvas.width;
      exportCanvas.height = origCanvas.height;
      const ctx = exportCanvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
      ctx.drawImage(origCanvas, 0, 0);

      // Composite annotation ink canvas
      const annotCanvas = document.getElementById(`annot-canvas-${targetPage}`);
      if (annotCanvas) {
        ctx.drawImage(annotCanvas, 0, 0, exportCanvas.width, exportCanvas.height);
      }

      // Composite stamps, signatures, images
      if (wrapper) {
        const scaleX = exportCanvas.width / wrapper.clientWidth;
        const scaleY = exportCanvas.height / wrapper.clientHeight;
        const stamps = wrapper.querySelectorAll('.placed-stamp');
        for (const stamp of stamps) {
          const sx = stamp.offsetLeft * scaleX;
          const sy = stamp.offsetTop * scaleY;
          const sw = stamp.offsetWidth * scaleX;
          const sh = stamp.offsetHeight * scaleY;
          const img = stamp.querySelector('img');
          if (img && img.complete) {
            ctx.drawImage(img, sx, sy, sw, sh);
          }
        }
      }

      return exportCanvas.toDataURL(format, 0.95);
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

  printDocument() {
    if (!this.app.viewer || !this.app.viewer.pdfDoc) {
      if (this.app.ui && this.app.ui.showToast) {
        this.app.ui.showToast('Please open a PDF document to print', 'warning');
      }
      return;
    }
    window.print();
  }
}

