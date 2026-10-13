const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set(['chat:text', 'chat:emotion', 'chat:tool', 'chat:audio', 'chat:error', 'cursor', 'ui:openSettings', 'ui:clickThrough']);

contextBridge.exposeInMainWorld('companion', {
  chat: (text) => ipcRenderer.invoke('brain:chat', text),
  cancel: () => ipcRenderer.invoke('brain:cancel'),
  state: () => ipcRenderer.invoke('brain:state'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch, apiKey) => ipcRenderer.invoke('settings:set', patch, apiKey),
  loadAvatar: () => ipcRenderer.invoke('avatar:load'),
  pickVrm: () => ipcRenderer.invoke('dialog:pickVrm'),
  pickDir: () => ipcRenderer.invoke('dialog:pickDir'),
  listDisplays: () => ipcRenderer.invoke('window:displays'),
  setIgnoreMouse: (ignore) => ipcRenderer.send('window:ignoreMouse', ignore),
  getWindowPos: () => ipcRenderer.invoke('window:getPos'),
  setWindowPos: (x, y) => ipcRenderer.send('window:setPos', x, y),
  backupNow: () => ipcRenderer.invoke('backup:now'),
  restoreBackup: () => ipcRenderer.invoke('backup:restore'),
  exportMemory: () => ipcRenderer.invoke('memory:export'),
  forgetMemory: (id) => ipcRenderer.invoke('memory:forget', id),
  quit: () => ipcRenderer.send('app:quit'),
  on: (channel, cb) => {
    if (!EVENTS.has(channel)) throw new Error(`허용되지 않은 채널: ${channel}`);
    const fn = (_e, ...args) => cb(...args);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  },
});
