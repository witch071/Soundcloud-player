const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nav', {
  back: () => ipcRenderer.send('nav:back'),
  forward: () => ipcRenderer.send('nav:forward'),
  reload: () => ipcRenderer.send('nav:reload'),
  vpn: () => ipcRenderer.send('nav:vpn'),
  adblock: () => ipcRenderer.send('nav:adblock'),
  onState: (cb) => ipcRenderer.on('nav:state', (_e, s) => cb(s))
});
