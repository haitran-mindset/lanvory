const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('screenViewer', {
  onFrame: (callback) => subscribe('lanvory:viewer-frame', callback),
  onFullscreen: (callback) =>
    subscribe('lanvory:viewer-fullscreen-state', callback),
  fullscreen: (active) =>
    ipcRenderer.invoke('lanvory:viewer-fullscreen', active),
  close: () => ipcRenderer.invoke('lanvory:viewer-close'),
});
