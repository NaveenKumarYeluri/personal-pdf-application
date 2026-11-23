/**
 * Personal PDF Suite - PDF Organizer & Document Mutation Engine (pdf-lib)
 * Handles page reordering, rotation, deletion, duplication, blank pages, merging, and splitting.
 */

export class PDFOrganizerEngine {
  constructor() {
    const lib = window.PDFLib || window.pdfLib;
    this.PDFDocument = lib ? lib.PDFDocument : null;
    this.degrees = lib ? lib.degrees : null;
  }

  _checkLib() {
    const lib = window.PDFLib || window.pdfLib;
    if (lib) {
      this.PDFDocument = lib.PDFDocument;
      this.degrees = lib.degrees;
    }
    if (!this.PDFDocument) {
      throw new Error('PDF-lib library not loaded.');
    }
  }

  async reorderAndModifyPages(pdfBytes, operations) {
    this._checkLib();
    const rawBytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
    const srcDoc = await this.PDFDocument.load(rawBytes.slice(), { ignoreEncryption: true, parseSpeed: Infinity });
    const newDoc = await this.PDFDocument.create();

    const deg = (angle) => {
      if (typeof this.degrees === 'function') return this.degrees(angle);
      const lib = window.PDFLib || window.pdfLib;
      if (lib && typeof lib.degrees === 'function') return lib.degrees(angle);
      return { type: 'degrees', angle };
    };

    // operations is an array of page descriptors:
    // [{ originalIndex: 0, rotationDelta: 90, isBlank: false }]
    for (const op of operations) {
      if (op.isBlank) {
        const blankPage = newDoc.addPage([595.28, 841.89]); // A4 dimensions
        if (op.rotationDelta) {
          const finalAngle = ((op.rotationDelta % 360) + 360) % 360;
          blankPage.setRotation(deg(finalAngle));
        }
      } else if (typeof op.originalIndex === 'number' && op.originalIndex >= 0 && op.originalIndex < srcDoc.getPageCount()) {
        try {
          const [copiedPage] = await newDoc.copyPages(srcDoc, [op.originalIndex]);
          const srcPage = srcDoc.getPage(op.originalIndex);
          const rot = srcPage.getRotation();
          const currentRot = (rot && typeof rot.angle === 'number') ? rot.angle : (typeof rot === 'number' ? rot : 0);
          const finalAngle = (((currentRot + (op.rotationDelta || 0)) % 360) + 360) % 360;
          copiedPage.setRotation(deg(finalAngle));
          const addedPage = newDoc.addPage(copiedPage);
          addedPage.setRotation(deg(finalAngle));
        } catch (copyErr) {
          console.warn(`Could not copy page ${op.originalIndex} with full references, falling back:`, copyErr);
          const [copiedPage] = await newDoc.copyPages(srcDoc, [op.originalIndex]);
          const addedPage = newDoc.addPage(copiedPage);
          if (op.rotationDelta) {
            const finalAngle = ((op.rotationDelta % 360) + 360) % 360;
            addedPage.setRotation(deg(finalAngle));
          }
        }
      }
    }

    return await newDoc.save({ useObjectStreams: false });
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
    return await doc.save({ useObjectStreams: false });
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
    return await doc.save({ useObjectStreams: false });
  }

  async extractPages(pdfBytes, pageIndicesToExtract) {
    this._checkLib();
    const rawBytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
    const doc = await this.PDFDocument.load(rawBytes.slice(), { ignoreEncryption: true });
    const keepSet = new Set(pageIndicesToExtract);
    for (let i = doc.getPageCount() - 1; i >= 0; i--) {
      if (!keepSet.has(i)) {
        doc.removePage(i);
      }
    }
    return await doc.save({ useObjectStreams: false });
  }

  /**
   * Split PDF by comma-separated page ranges, e.g. "1-3, 5, 7-10"
   * Returns Array<{ name: string, bytes: Uint8Array }>
   */
  async splitByRanges(pdfBytes, rangeString, baseName = 'document') {
    this._checkLib();
    if (!rangeString || !rangeString.trim()) {
      throw new Error('Please enter page ranges (e.g. 1-2, 3-5).');
    }

    const rawBytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
    const mainDoc = await this.PDFDocument.load(rawBytes.slice(), { ignoreEncryption: true });
    const totalPages = mainDoc.getPageCount();
    if (totalPages === 0) {
      throw new Error('The PDF document contains no pages.');
    }

    const rawSegments = rangeString.split(',').map(r => r.trim()).filter(Boolean);
    if (rawSegments.length === 0) {
      throw new Error('Please enter valid page ranges (e.g. 1-2, 3-5).');
    }

    const parsedRanges = [];
    for (const r of rawSegments) {
      const singleMatch = r.match(/^(\d+)$/);
      const rangeMatch = r.match(/^(\d+)\s*-\s*(\d+)$/);

      if (!singleMatch && !rangeMatch) {
        throw new Error(`Invalid page range "${r}". Please use numbers and hyphens (e.g. 1-3, 5).`);
      }

      let start, end;
      if (singleMatch) {
        start = parseInt(singleMatch[1], 10);
        end = start;
      } else {
        start = parseInt(rangeMatch[1], 10);
        end = parseInt(rangeMatch[2], 10);
      }

      if (start < 1) {
        throw new Error(`Invalid page number ${start}. Page numbers must be 1 or greater.`);
      }
      if (end < 1) {
        throw new Error(`Invalid page number ${end}. Page numbers must be 1 or greater.`);
      }
      if (start > totalPages) {
        throw new Error(`Page ${start} exceeds document total pages (${totalPages}).`);
      }
      if (end > totalPages) {
        throw new Error(`Page ${end} exceeds document total pages (${totalPages}).`);
      }
      if (start > end) {
        throw new Error(`Invalid range "${r}": start page (${start}) cannot be greater than end page (${end}).`);
      }

      parsedRanges.push({ start, end });
    }

    const results = [];
    for (const { start, end } of parsedRanges) {
      // Clone original document and remove pages outside [start, end] from back to front.
      // This preserves 100% of all document fonts, XObjects, graphics, and page resources!
      const subDoc = await this.PDFDocument.load(rawBytes.slice(), { ignoreEncryption: true });
      const keepMin = start - 1;
      const keepMax = end - 1;

      for (let i = subDoc.getPageCount() - 1; i >= 0; i--) {
        if (i < keepMin || i > keepMax) {
          subDoc.removePage(i);
        }
      }

      const bytes = await subDoc.save({ useObjectStreams: false });
      const rangeLabel = start === end ? `page_${start}` : `pages_${start}-${end}`;

      results.push({
        name: `${baseName}_${rangeLabel}.pdf`,
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

    return await mergedDoc.save({ useObjectStreams: false });
  }

  /**
   * Flatten all interactive form fields into static page content.
   * Returns { bytes, fieldCount }. When the document has no fields, bytes is
   * returned unchanged and fieldCount is 0.
   */
  async flattenForm(pdfBytes) {
    this._checkLib();
    const rawBytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
    const doc = await this.PDFDocument.load(rawBytes.slice(), { ignoreEncryption: true });
    const form = doc.getForm();
    const fields = form.getFields();
    if (!fields || fields.length === 0) {
      return { bytes: rawBytes, fieldCount: 0 };
    }
    form.flatten();
    const bytes = await doc.save({ useObjectStreams: false });
    return { bytes, fieldCount: fields.length };
  }

  async insertBlankPage(pdfBytes, atIndex = -1) {
    this._checkLib();
    const rawBytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
    const doc = await this.PDFDocument.load(rawBytes.slice(), { ignoreEncryption: true });
    const pageCount = doc.getPageCount();
    const targetIdx = atIndex === -1 ? pageCount : Math.max(0, Math.min(pageCount, atIndex));
    doc.insertPage(targetIdx, [595.28, 841.89]);
    return await doc.save({ useObjectStreams: false });
  }
}

