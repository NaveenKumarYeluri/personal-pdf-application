/**
 * Personal PDF Suite - Export & Printing Engine
 * Convert PDF to PNG images, extract clean text, and native high-res printing.
 */

export class PDFExportEngine {
  constructor(viewer) {
    this.viewer = viewer;
  }

  async exportPageAsImage(pageNum, format = 'image/png') {
    const targetPage = Math.max(1, Math.min(pageNum || 1, this.viewer.totalPages || 1));
    const wrapper = document.getElementById(`page-wrapper-${targetPage}`);
    const origCanvas = wrapper?.querySelector('canvas.pdf-canvas');

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
    const viewport = page.getViewport({ scale: 2.0 }); // 2x sharp print quality

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
      const pageText = content.items.map(item => item.str).join(' ');
      fullText += `--- Page ${i} ---\n${pageText}\n\n`;
    }
    return fullText;
  }

  async downloadFile(data, fileName, mimeType = 'application/pdf') {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });

    // 1. Android / Mobile Web Share API support
    if (typeof navigator !== 'undefined' && navigator.canShare && typeof File !== 'undefined') {
      try {
        const file = new File([blob], fileName, { type: mimeType });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: fileName,
            text: `Exported: ${fileName}`
          });
          return;
        }
      } catch (shareErr) {
        if (shareErr.name === 'AbortError') return; // User closed share sheet intentionally
        console.warn('Web Share failed, using standard download:', shareErr);
      }
    }

    // 2. Standard Blob Object URL Download
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return;
    } catch (urlErr) {
      console.warn('Object URL download failed, trying data URI:', urlErr);
    }

    // 3. Fallback Data URI reader
    const reader = new FileReader();
    reader.onloadend = () => {
      const a = document.createElement('a');
      a.href = reader.result;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    };
    reader.readAsDataURL(blob);
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

