const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  onOpenPdf: (callback) => ipcRenderer.on('open-pdf-file', (event, data) => callback(data)),
  onTriggerSave: (callback) => ipcRenderer.on('trigger-save', () => callback()),
  onTriggerPrint: (callback) => ipcRenderer.on('trigger-print', () => callback())
});

