'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('gv', {
  init: () => ipcRenderer.invoke('init'),
  ready: () => ipcRenderer.invoke('ready'),
  captureStart: () => ipcRenderer.invoke('capture-start'),
  frame: (buf) => ipcRenderer.invoke('frame', buf),
  captureDone: () => ipcRenderer.invoke('capture-done'),
  benchResult: (r) => ipcRenderer.invoke('bench-result', r),
  log: (m) => ipcRenderer.invoke('log', String(m)),
});
