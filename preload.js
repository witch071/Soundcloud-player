const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('vpn', {
  state: () => ipcRenderer.invoke('vpn:state'),
  list: (source) => ipcRenderer.invoke('vpn:list', source),
  connect: (opts) => ipcRenderer.invoke('vpn:connect', opts),
  disconnect: () => ipcRenderer.invoke('vpn:disconnect'),
  onStatus: (cb) => ipcRenderer.on('vpn:status', (_e, d) => cb(d))
});
