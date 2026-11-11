/**
 * Personal PDF Suite - In-place file access layer
 *
 * Keeps track of where the currently opened document lives so Save can write
 * the updated bytes back to that exact file instead of downloading a copy.
 *
 * Three strategies, in priority order:
 *   1. Tauri v2 desktop shell: native dialogs + Rust file commands.
 *   2. Chromium browsers: File System Access API (retained FileSystemFileHandle).
 *   3. Everything else (Android, Firefox, Safari, file://): legacy file input
 *      plus the existing download/share flow.
 */

function bytesToBase64(bytes) {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(text) {
  const binary = atob(text || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function fileNameFromPath(path) {
  const parts = String(path || '').split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : 'document.pdf';
}

const STORED_PATH_KEY = 'personalPdfSuite.lastFilePath';

export class FileAccessManager {
  /** True when running inside the Tauri desktop shell with the IPC bridge. */
  get isTauri() {
    return typeof window !== 'undefined' && Boolean(window.__TAURI__?.core?.invoke);
  }

  /** True when running inside the Capacitor Android shell. */
  get isCapacitorNative() {
    if (typeof window === 'undefined') return false;
    return Boolean(window.Capacitor?.isNativePlatform?.()) || window.Capacitor?.platform === 'android';
  }

  /** Native dialogs + Rust read/write commands (Windows & Linux Tauri builds). */
  get canUseNativeDesktop() {
    return this.isTauri && !this.isCapacitorNative;
  }

  get canUseOpenPicker() {
    return typeof window !== 'undefined'
      && typeof window.showOpenFilePicker === 'function'
      && !this.isCapacitorNative;
  }

  get canUseSavePicker() {
    return typeof window !== 'undefined'
      && typeof window.showSaveFilePicker === 'function'
      && !this.isCapacitorNative;
  }

  /** Whether the app can ask the user for a save location before writing. */
  get canPickSaveTarget() {
    return this.canUseNativeDesktop || this.canUseSavePicker;
  }

  describeTarget(target) {
    if (!target) return 'Downloads folder';
    if (target.kind === 'native') return target.path;
    return 'Original file (in place)';
  }

  /**
   * Remember the native file path so a restored session keeps saving to the
   * same document after the app is restarted.
   */
  getStoredPath() {
    if (!this.canUseNativeDesktop) return null;
    try {
      return localStorage.getItem(STORED_PATH_KEY) || null;
    } catch (_) {
      return null;
    }
  }

  storePath(path) {
    if (!this.canUseNativeDesktop) return;
    try {
      if (path) localStorage.setItem(STORED_PATH_KEY, path);
      else localStorage.removeItem(STORED_PATH_KEY);
    } catch (_) {
      // Storage may be unavailable; saving still works for this session.
    }
  }

  /** Read a PDF straight from a known native path (no dialog). */
  async readNativePdf(path) {
    const data = await this._invoke('read_pdf_file', { path });
    return base64ToBytes(String(data || ''));
  }

  _invoke(command, args = {}) {
    return window.__TAURI__.core.invoke(command, args);
  }

  /**
   * Open a PDF and return the writable target it came from.
   * @returns {Promise<{cancelled?: true, fallback?: true, name?: string, bytes?: Uint8Array, target?: object}>}
   */
  async openPdf() {
    if (this.canUseNativeDesktop) {
      try {
        const path = await this._invoke('pick_pdf_to_open');
        if (!path) return { cancelled: true };
        const data = await this._invoke('read_pdf_file', { path });
        return {
          name: fileNameFromPath(path),
          bytes: base64ToBytes(String(data || '')),
          target: { kind: 'native', path }
        };
      } catch (err) {
        console.warn('Native open failed, falling back to the file input:', err);
        return { fallback: true };
      }
    }

    if (this.canUseOpenPicker) {
      try {
        const handles = await window.showOpenFilePicker({
          multiple: false,
          excludeAcceptAllOption: false,
          types: [{
            description: 'PDF Documents',
            accept: { 'application/pdf': ['.pdf'] }
          }]
        });
        const handle = handles && handles[0];
        if (!handle) return { cancelled: true };
        const file = await handle.getFile();
        const bytes = new Uint8Array(await file.arrayBuffer());
        return {
          name: file.name || 'document.pdf',
          bytes,
          target: { kind: 'handle', handle }
        };
      } catch (err) {
        if (err?.name === 'AbortError') return { cancelled: true };
        console.warn('File System Access picker unavailable, falling back:', err);
        return { fallback: true };
      }
    }

    return { fallback: true };
  }

  /**
   * Ask the user where to save. Must be called directly from a user gesture on
   * Chromium (showSaveFilePicker requires transient activation).
   * @returns {Promise<{cancelled?: true, fallback?: true, name?: string, target?: object}>}
   */
  async pickSaveTarget(defaultName = 'document.pdf') {
    if (this.canUseNativeDesktop) {
      try {
        const path = await this._invoke('pick_pdf_save_path', { name: defaultName });
        if (!path) return { cancelled: true };
        return {
          name: fileNameFromPath(path),
          target: { kind: 'native', path }
        };
      } catch (err) {
        console.warn('Native save dialog failed, falling back to download:', err);
        return { fallback: true };
      }
    }

    if (this.canUseSavePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: defaultName,
          types: [{
            description: 'PDF Documents',
            accept: { 'application/pdf': ['.pdf'] }
          }]
        });
        if (!handle) return { cancelled: true };
        return {
          name: handle.name || defaultName,
          target: { kind: 'handle', handle }
        };
      } catch (err) {
        if (err?.name === 'AbortError') return { cancelled: true };
        console.warn('Save picker unavailable, falling back:', err);
        return { fallback: true };
      }
    }

    return { fallback: true };
  }

  /**
   * Make sure the target can be written. Requesting permission here (while the
   * Save click still counts as user activation) keeps the later write silent.
   */
  async ensureWritable(target) {
    if (!target) return false;
    if (target.kind !== 'handle') return true;
    const handle = target.handle;
    try {
      if (typeof handle.queryPermission !== 'function') return true;
      const options = { mode: 'readwrite' };
      if ((await handle.queryPermission(options)) === 'granted') return true;
      if (typeof handle.requestPermission !== 'function') return false;
      return (await handle.requestPermission(options)) === 'granted';
    } catch (err) {
      console.warn('Write permission request failed:', err);
      return false;
    }
  }

  /**
   * Write bytes to an existing target.
   * @returns {Promise<{success: boolean, destination?: string, cancelled?: boolean, error?: string}>}
   */
  async write(target, bytes) {
    if (!target) return { success: false, error: 'No save target' };

    if (target.kind === 'native') {
      try {
        await this._invoke('write_pdf_file', { path: target.path, data: bytesToBase64(bytes) });
        return { success: true, destination: target.path };
      } catch (err) {
        return { success: false, error: String(err?.message || err) };
      }
    }

    if (target.kind === 'handle') {
      try {
        await this._writeHandle(target.handle, bytes);
        return { success: true, destination: 'Original file (in place)' };
      } catch (err) {
        if (err?.name === 'AbortError') {
          return { success: false, cancelled: true };
        }
        // The handle may have lost write permission (browser restart, revoked
        // grant). Ask once more so the caller can retry silently or reprompt.
        try {
          const granted = await this.ensureWritable(target);
          if (granted) {
            await this._writeHandle(target.handle, bytes);
            return { success: true, destination: 'Original file (in place)' };
          }
        } catch (retryErr) {
          console.warn('Retry after permission grant failed:', retryErr);
        }
        return { success: false, needsPermission: err?.name === 'NotAllowedError', error: String(err?.message || err) };
      }
    }

    return { success: false, error: `Unsupported save target: ${target.kind}` };
  }

  async _writeHandle(handle, bytes) {
    const writable = await handle.createWritable();
    try {
      await writable.write(bytes);
      await writable.close();
    } catch (err) {
      try {
        await writable.abort();
      } catch (_) {
        // Nothing else we can do; surface the original write error.
      }
      throw err;
    }
  }
}
