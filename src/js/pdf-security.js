/**
 * Personal PDF Suite - Security, Watermark & Redaction Engine
 * Watermarking, Page numbering, Redaction, and Encryption.
 */

export class PDFSecurityEngine {
  constructor() {
    this.PDFDocument = window.PDFLib ? window.PDFLib.PDFDocument : null;
    this.rgb = window.PDFLib ? window.PDFLib.rgb : null;
    this.degrees = window.PDFLib ? window.PDFLib.degrees : null;
    this.StandardFonts = window.PDFLib ? window.PDFLib.StandardFonts : null;
  }

  _checkLib() {
    if (!this.PDFDocument && window.PDFLib) {
      this.PDFDocument = window.PDFLib.PDFDocument;
      this.rgb = window.PDFLib.rgb;
      this.degrees = window.PDFLib.degrees;
      this.StandardFonts = window.PDFLib.StandardFonts;
    }
  }

  async applyWatermark(pdfBytes, options = {}) {
    this._checkLib();
    const doc = await this.PDFDocument.load(pdfBytes);
    const font = await doc.embedFont(this.StandardFonts.HelveticaBold);
    const pages = doc.getPages();

    const text = options.text || 'CONFIDENTIAL';
    const angle = options.angle !== undefined ? options.angle : 45;
    const opacity = options.opacity !== undefined ? options.opacity : 0.25;
    const size = options.size || 50;

    // Hex to RGB
    const hex = (options.color || '#ff0000').replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;

    for (const page of pages) {
      const { width, height } = page.getSize();
      const textWidth = font.widthOfTextAtSize(text, size);
      const textHeight = font.heightAtSize(size);

      page.drawText(text, {
        x: width / 2 - textWidth / 2,
        y: height / 2 - textHeight / 2,
        size: size,
        font: font,
        color: this.rgb(r, g, b),
        opacity: opacity,
        rotate: this.degrees(angle)
      });
    }

    return await doc.save();
  }

  async addPageNumbers(pdfBytes, format = 'Page {page} of {total}') {
    this._checkLib();
    const doc = await this.PDFDocument.load(pdfBytes);
    const font = await doc.embedFont(this.StandardFonts.Helvetica);
    const pages = doc.getPages();
    const total = pages.length;

    pages.forEach((page, idx) => {
      const { width } = page.getSize();
      const text = format.replace('{page}', (idx + 1).toString()).replace('{total}', total.toString());
      const textWidth = font.widthOfTextAtSize(text, 10);

      page.drawText(text, {
        x: width / 2 - textWidth / 2,
        y: 20,
        size: 10,
        font: font,
        color: this.rgb(0.4, 0.4, 0.4)
      });
    });

    return await doc.save();
  }

  addRedactionBox(pageNum, x, y, width = 120, height = 30) {
    const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
    if (!wrapper) return;

    const box = document.createElement('div');
    box.className = 'redaction-box';
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
    box.style.width = `${width}px`;
    box.style.height = `${height}px`;
    box.title = 'Double-click to remove redaction';

    box.ondblclick = () => box.remove();
    wrapper.appendChild(box);
  }
}
