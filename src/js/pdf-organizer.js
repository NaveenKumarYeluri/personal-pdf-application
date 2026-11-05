/**
 * Personal PDF Suite - PDF Organizer & Document Mutation Engine (pdf-lib)
 * Handles page reordering, rotation, deletion, duplication, blank pages, merging, and splitting.
 */

export class PDFOrganizerEngine {
  constructor() {
    this.PDFDocument = window.PDFLib ? window.PDFLib.PDFDocument : null;
    this.degrees = window.PDFLib ? window.PDFLib.degrees : null;
  }

  _checkLib() {
    if (!this.PDFDocument && window.PDFLib) {
      this.PDFDocument = window.PDFLib.PDFDocument;
      this.degrees = window.PDFLib.degrees;
    }
    if (!this.PDFDocument) {
      throw new Error('PDF-lib library not loaded.');
    }
  }

  async reorderAndModifyPages(pdfBytes, operations) {
    this._checkLib();
    const rawBytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
    const srcDoc = await this.PDFDocument.load(rawBytes.slice(), { ignoreEncryption: true });
    const newDoc = await this.PDFDocument.create();

    // operations is an array of page descriptors:
    // [{ originalIndex: 0, rotationDelta: 90, isBlank: false }]
    for (const op of operations) {
      if (op.isBlank) {
        const blankPage = newDoc.addPage([595.28, 841.89]); // A4 dimensions
        if (op.rotationDelta) {
          const finalAngle = ((op.rotationDelta % 360) + 360) % 360;
          blankPage.setRotation(this.degrees(finalAngle));
        }
      } else if (op.originalIndex >= 0 && op.originalIndex < srcDoc.getPageCount()) {
        const [copiedPage] = await newDoc.copyPages(srcDoc, [op.originalIndex]);
        if (op.rotationDelta) {
          const currentRot = (copiedPage.getRotation() && typeof copiedPage.getRotation().angle === 'number')
            ? copiedPage.getRotation().angle
            : 0;
          const finalAngle = (((currentRot + op.rotationDelta) % 360) + 360) % 360;
          copiedPage.setRotation(this.degrees(finalAngle));
        }
        newDoc.addPage(copiedPage);
      }
    }

    return await newDoc.save();
  }

  async rotatePage(pdfBytes, pageIndex, angleDegrees = 90) {
    this._checkLib();
    const rawBytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
    const doc = await this.PDFDocument.load(rawBytes.slice(), { ignoreEncryption: true });
    const page = doc.getPage(pageIndex);
    const currentRot = (page.getRotation() && typeof page.getRotation().angle === 'number')
      ? page.getRotation().angle
      : 0;
    const finalAngle = (((currentRot + angleDegrees) % 360) + 360) % 360;
    page.setRotation(this.degrees(finalAngle));
    return await doc.save();
  }

  async deletePages(pdfBytes, pageIndicesToDelete) {
    this._checkLib();
    const rawBytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
    const doc = await this.PDFDocument.load(rawBytes.slice(), { ignoreEncryption: true });
    // Sort indices descending so deleting does not shift previous indices
    const sortedIndices = [...pageIndicesToDelete].sort((a, b) => b - a);
    for (const idx of sortedIndices) {
      doc.removePage(idx);
    }
    return await doc.save();
  }

  async extractPages(pdfBytes, pageIndicesToExtract) {
    this._checkLib();
    const rawBytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
    const srcDoc = await this.PDFDocument.load(rawBytes.slice(), { ignoreEncryption: true });
    const newDoc = await this.PDFDocument.create();
    const copiedPages = await newDoc.copyPages(srcDoc, pageIndicesToExtract);
    copiedPages.forEach(p => newDoc.addPage(p));
    return await newDoc.save();
  }

  /**
   * Split PDF by comma-separated page ranges, e.g. "1-3, 5, 7-10"
   * Returns Array<{ name: string, bytes: Uint8Array }>
   */
  async splitByRanges(pdfBytes, rangeString, baseName = 'document') {
    this._checkLib();
    const rawBytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
    const srcDoc = await this.PDFDocument.load(rawBytes.slice(), { ignoreEncryption: true });
    const totalPages = srcDoc.getPageCount();
    const results = [];

    const ranges = rangeString.split(',').map(r => r.trim()).filter(Boolean);

    for (const r of ranges) {
      const parts = r.split('-').map(p => parseInt(p.trim(), 10));
      let start = parts[0];
      let end = parts.length > 1 ? parts[1] : start;

      if (isNaN(start) || start < 1) start = 1;
      if (isNaN(end) || end > totalPages) end = totalPages;
      if (start > end) [start, end] = [end, start];

      const indices = [];
      for (let i = start; i <= end; i++) {
        indices.push(i - 1);
      }

      const newDoc = await this.PDFDocument.create();
      const copiedPages = await newDoc.copyPages(srcDoc, indices);
      copiedPages.forEach(p => newDoc.addPage(p));
      const bytes = await newDoc.save();

      results.push({
        name: `${baseName}_pages_${start}-${end}.pdf`,
        bytes: bytes
      });
    }

    return results;
  }

  async mergeDocuments(pdfByteArrayList) {
    this._checkLib();
    const mergedDoc = await this.PDFDocument.create();

    for (const bytes of pdfByteArrayList) {
      const rawBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const doc = await this.PDFDocument.load(rawBytes.slice(), { ignoreEncryption: true });
      const copiedPages = await mergedDoc.copyPages(doc, doc.getPageIndices());
      copiedPages.forEach(page => mergedDoc.addPage(page));
    }

    return await mergedDoc.save();
  }

  async insertBlankPage(pdfBytes, atIndex = -1) {
    this._checkLib();
    const rawBytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
    const doc = await this.PDFDocument.load(rawBytes.slice(), { ignoreEncryption: true });
    const pageCount = doc.getPageCount();
    const targetIdx = atIndex === -1 ? pageCount : atIndex;
    doc.insertPage(targetIdx, [595.28, 841.89]);
    return await doc.save();
  }
}

