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

  async addPageNumbers(pdfBytes, options = {}) {
    this._checkLib();
    const doc = await this.PDFDocument.load(pdfBytes);
    const font = await doc.embedFont(this.StandardFonts.Helvetica);
    const pages = doc.getPages();
    const total = pages.length;

    const format = options.format || 'Page {page} of {total}';
    const position = options.position || 'bottom-center'; // 'top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'
    const startNum = options.startNumber || 1;
    const prefix = options.prefix || '';
    const fontSize = options.fontSize || 10;

    pages.forEach((page, idx) => {
      const { width, height } = page.getSize();
      const currentNum = startNum + idx;
      let text = format.replace('{page}', currentNum.toString()).replace('{total}', (startNum + total - 1).toString());
      if (prefix) text = `${prefix} ${text}`;

      const textWidth = font.widthOfTextAtSize(text, fontSize);
      let x = width / 2 - textWidth / 2;
      let y = 25;

      if (position === 'bottom-left') {
        x = 35;
        y = 25;
      } else if (position === 'bottom-right') {
        x = width - textWidth - 35;
        y = 25;
      } else if (position === 'top-left') {
        x = 35;
        y = height - 30;
      } else if (position === 'top-center') {
        x = width / 2 - textWidth / 2;
        y = height - 30;
      } else if (position === 'top-right') {
        x = width - textWidth - 35;
        y = height - 30;
      }

      page.drawText(text, {
        x,
        y,
        size: fontSize,
        font: font,
        color: this.rgb(0.3, 0.3, 0.3)
      });
    });

    return await doc.save();
  }

  async getMetadata(pdfBytes) {
    this._checkLib();
    const doc = await this.PDFDocument.load(pdfBytes);
    return {
      title: doc.getTitle() || '',
      author: doc.getAuthor() || '',
      subject: doc.getSubject() || '',
      keywords: doc.getKeywords() || '',
      creator: doc.getCreator() || '',
      producer: doc.getProducer() || '',
      pageCount: doc.getPageCount()
    };
  }

  async updateMetadata(pdfBytes, meta = {}) {
    this._checkLib();
    const doc = await this.PDFDocument.load(pdfBytes);
    if (meta.title !== undefined) doc.setTitle(meta.title);
    if (meta.author !== undefined) doc.setAuthor(meta.author);
    if (meta.subject !== undefined) doc.setSubject(meta.subject);
    if (meta.keywords !== undefined) doc.setKeywords(meta.keywords);
    if (meta.creator !== undefined) doc.setCreator(meta.creator);
    return await doc.save();
  }

  async burnRedactions(pdfBytes, redactionList = []) {
    // redactionList: Array<{ pageIndex: number, x: number, y: number, width: number, height: number }>
    this._checkLib();
    const doc = await this.PDFDocument.load(pdfBytes);
    for (const r of redactionList) {
      const page = doc.getPage(r.pageIndex);
      const { height } = page.getSize();
      // PDF coordinate system origin is bottom-left
      page.drawRectangle({
        x: r.x,
        y: height - r.y - r.height,
        width: r.width,
        height: r.height,
        color: this.rgb(0, 0, 0)
      });
    }
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

