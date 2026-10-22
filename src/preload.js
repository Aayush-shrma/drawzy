const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  onMode: (cb) => ipcRenderer.on('mode', (_, on) => cb(on)),
  onVisible: (cb) => ipcRenderer.on('visible', (_, on) => cb(on)),
  onCommand: (cb) => ipcRenderer.on('command', (_, cmd) => cb(cmd)),
  exitDraw: () => ipcRenderer.send('exit-draw'),
  setVisible: (on) => ipcRenderer.send('set-visible', on),
  screenshot: () => ipcRenderer.invoke('screenshot'),
  saveFile: (opts) => ipcRenderer.invoke('save-file', opts),
  openFile: (opts) => ipcRenderer.invoke('open-file', opts),
  copyImage: (dataURL) => ipcRenderer.invoke('copy-image', dataURL),
  readClipboard: () => ipcRenderer.invoke('read-clipboard'),
  writeClipboardText: (text) => ipcRenderer.invoke('write-clipboard-text', text),
});
