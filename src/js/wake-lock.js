/**
 * Personal PDF Suite - Screen Wake Lock Controller
 * Keeps the screen awake on Android / mobile while reading a PDF document.
 */

export class ScreenWakeLockManager {
  constructor() {
    this.wakeLock = null;
    this.isSupported = 'wakeLock' in navigator;
    this._initVisibilityListener();
  }

  async acquire() {
    if (!this.isSupported) return;
    try {
      if (!this.wakeLock) {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this._hasActiveDocument = true;
        this.wakeLock.addEventListener('release', () => {
          this.wakeLock = null;
        });
        console.log('Screen Wake Lock acquired: display will remain awake.');
      }
    } catch (err) {
      console.warn('Wake Lock request error (may be denied by browser/battery mode):', err);
    }
  }

  release() {
    this._hasActiveDocument = false;
    if (this.wakeLock) {
      this.wakeLock.release().catch(() => {});
      this.wakeLock = null;
      console.log('Screen Wake Lock released.');
    }
  }

  _initVisibilityListener() {
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' && this._hasActiveDocument && !this.wakeLock) {
        await this.acquire();
      }
    });
  }
}
