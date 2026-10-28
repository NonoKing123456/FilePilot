const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('filepilot', {
  chooseFiles: () => ipcRenderer.invoke('files:choose'),
  chooseOutputDirectory: () => ipcRenderer.invoke('output:choose'),
  getDefaultOutputDirectory: () => ipcRenderer.invoke('output:default'),
  getCapabilities: () => ipcRenderer.invoke('app:capabilities'),
  getImagePreview: (payload) => ipcRenderer.invoke('preview:image', payload),
  runOperation: (payload) => ipcRenderer.invoke('operation:run', payload),
  revealFile: (filePath) => ipcRenderer.invoke('file:reveal', filePath),
  openFile: (filePath) => ipcRenderer.invoke('file:open', filePath),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  onProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('operation:progress', handler);
    return () => ipcRenderer.removeListener('operation:progress', handler);
  }
});
