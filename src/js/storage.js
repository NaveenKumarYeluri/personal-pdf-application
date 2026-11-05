/**
 * Personal PDF Suite - Document Session & IndexedDB Storage Engine
 * Persists the currently opened PDF, page position, and metadata
 * across mobile app restarts, memory eviction, and backgrounding.
 */

export class StorageEngine {
  constructor() {
    this.dbName = 'PersonalPDFSuiteDB';
    this.storeName = 'session';
    this.db = null;
  }

  async _getDB() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        return resolve(null);
      }
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
      req.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };
      req.onerror = () => {
        console.warn('IndexedDB failed to open:', req.error);
        resolve(null);
      };
    });
  }

  async saveActiveDocument(name, bytes, page = 1) {
    try {
      const db = await this._getDB();
      if (!db) return false;
      return new Promise((resolve) => {
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        // Ensure bytes is ArrayBuffer or Uint8Array clone
        const bufferToStore = bytes instanceof Uint8Array ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes.slice(0);
        store.put({ name, bytes: bufferToStore, page, timestamp: Date.now() }, 'active_doc');
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch (err) {
      console.warn('StorageEngine: failed to save active document:', err);
      return false;
    }
  }

  async updateActivePage(page) {
    try {
      const db = await this._getDB();
      if (!db) return false;
      return new Promise((resolve) => {
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        const req = store.get('active_doc');
        req.onsuccess = () => {
          const doc = req.result;
          if (doc) {
            doc.page = page;
            doc.timestamp = Date.now();
            store.put(doc, 'active_doc');
          }
          resolve(true);
        };
        req.onerror = () => resolve(false);
      });
    } catch (_) {
      return false;
    }
  }

  async getActiveDocument() {
    try {
      const db = await this._getDB();
      if (!db) return null;
      return new Promise((resolve) => {
        const tx = db.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        const req = store.get('active_doc');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (_) {
      return null;
    }
  }

  async clearActiveDocument() {
    try {
      const db = await this._getDB();
      if (!db) return false;
      return new Promise((resolve) => {
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        store.delete('active_doc');
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch (_) {
      return false;
    }
  }
}
