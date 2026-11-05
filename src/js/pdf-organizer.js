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
    const srcDoc = await this.PDFDocument.load(pdfBytes);
    const newDoc = await this.PDFDocument.create();

    // operations is an array of page descriptors:
    // [{ originalIndex: 0, rotationDelta: 90, isBlank: false }]
    for (const op of operations) {
      if (op.isBlank) {
        newDoc.addPage([595.28, 841.89]); // A4 dimensions
      } else {
        const [copiedPage] = await newDoc.copyPages(srcDoc, [op.originalIndex]);
        if (op.rotationDelta) {
          const currentRot = copiedPage.getRotation().angle;
          copiedPage.setRotation(this.degrees((currentRot + op.rotationDelta) % 360));
        }
        newDoc.addPage(copiedPage);
      }
    }

    return await newDoc.save();
  }

  async rotatePage(pdfBytes, pageIndex, angleDegrees = 90) {
    this._checkLib();
    const doc = await this.PDFDocument.load(pdfBytes);
    const page = doc.getPage(pageIndex);
    const currentRot = page.getRotation().angle;
    page.setRotation(this.degrees((currentRot + angleDegrees) % 360));
    return await doc.save();
  }

  async deletePages(pdfBytes, pageIndicesToDelete) {
    this._checkLib();
    const doc = await this.PDFDocument.load(pdfBytes);
    // Sort indices descending so deleting does not shift previous indices
    const sortedIndices = [...pageIndicesToDelete].sort((a, b) => b - a);
    for (const idx of sortedIndices) {
      doc.removePage(idx);
    }
    return await doc.save();
  }

  async extractPages(pdfBytes, pageIndicesToExtract) {
    this._checkLib();
    const srcDoc = await this.PDFDocument.load(pdfBytes);
    const newDoc = await this.PDFDocument.create();
    const copiedPages = await newDoc.copyPages(srcDoc, pageIndicesToExtract);
    copiedPages.forEach(p => newDoc.addPage(p));
    return await newDoc.save();
  }

  async mergeDocuments(pdfByteArrayList) {
    this._checkLib();
    const mergedDoc = await this.PDFDocument.create();

    for (const bytes of pdfByteArrayList) {
      const doc = await this.PDFDocument.load(bytes);
      const copiedPages = await mergedDoc.copyPages(doc, doc.getPageIndices());
      copiedPages.forEach(page => mergedDoc.addPage(page));
    }

    return await mergedDoc.save();
  }

  async insertBlankPage(pdfBytes, atIndex = -1) {
    this._checkLib();
    const doc = await this.PDFDocument.load(pdfBytes);
    const pageCount = doc.getPageCount();
    const targetIdx = atIndex === -1 ? pageCount : atIndex;
    doc.insertPage(targetIdx, [595.28, 841.89]);
    return await doc.save();
  }
}
