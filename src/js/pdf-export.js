/**
 * Personal PDF Suite - Export & Printing Engine
 * Convert PDF to PNG images, extract clean text, and native high-res printing.
 */

export class PDFExportEngine {
  constructor(viewer) {
    this.viewer = viewer;
  }

  async exportPageAsImage(pageNum, format = 'image/png') {
    if (!this.viewer.pdfDoc) return null;
    const page = await this.viewer.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2.0 }); // 2x for sharp print quality

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');

    await page.render({ canvasContext: ctx, viewport: viewport }).promise;

    return canvas.toDataURL(format);
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

    // Handle Android / Capacitor environment where blob: link clicks might be blocked
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
      try {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64data = reader.result;
          const a = document.createElement('a');
          a.href = base64data;
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        };
        reader.readAsDataURL(blob);
        return;
      } catch (err) {
        console.warn('Capacitor FileReader fallback error:', err);
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  printDocument() {
    window.print();
  }
}

