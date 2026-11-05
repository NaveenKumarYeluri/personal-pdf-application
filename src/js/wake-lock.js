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
    this._hasActiveDocument = true;

    // 1. Try standard W3C Screen Wake Lock API
    if (this.isSupported) {
      try {
        if (!this.wakeLock) {
          this.wakeLock = await navigator.wakeLock.request('screen');
          this.wakeLock.addEventListener('release', () => {
            this.wakeLock = null;
          });
          console.log('Screen Wake Lock acquired: display will remain awake.');
          return;
        }
      } catch (err) {
        console.warn('Wake Lock request error (may be denied by browser/battery mode):', err);
      }
    }

    // 2. Fallback: Capacitor KeepAwake plugin if available
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.KeepAwake) {
      try {
        await window.Capacitor.Plugins.KeepAwake.keepAwake();
        console.log('Capacitor KeepAwake active: display will remain awake.');
        return;
      } catch (e) {
        console.warn('Capacitor KeepAwake error:', e);
      }
    }

    // 3. Fallback: Micro looping video element (Supported in Android WebView)
    if (!this._videoFallback) {
      try {
        const vid = document.createElement('video');
        vid.setAttribute('playsinline', '');
        vid.setAttribute('muted', '');
        vid.setAttribute('loop', '');
        vid.muted = true;
        vid.style.position = 'fixed';
        vid.style.top = '-9999px';
        vid.style.width = '1px';
        vid.style.height = '1px';
        vid.style.opacity = '0';
        vid.src = 'data:video/mp4;base64,AAAAHGZ0eXBtcDQyAAAAAW1wNDJpc29tYXZjMQAAADpmcmVlAAAAJm1kYXQAAAAyAQACEAABwAAAAmV4AMAAABwAAAAAAG1vb3YAAABsbXZoZAAAAAA=';
        document.body.appendChild(vid);
        vid.play().catch(() => {});
        this._videoFallback = vid;
        console.log('Video loop wake fallback active.');
      } catch (_) {}
    }
  }

  release() {
    this._hasActiveDocument = false;
    if (this.wakeLock) {
      this.wakeLock.release().catch(() => {});
      this.wakeLock = null;
      console.log('Screen Wake Lock released.');
    }
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.KeepAwake) {
      window.Capacitor.Plugins.KeepAwake.allowSleep().catch(() => {});
    }
    if (this._videoFallback) {
      this._videoFallback.pause();
      this._videoFallback.remove();
      this._videoFallback = null;
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
