const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { BrowserWindow, ipcMain } = require('electron');

function createScreenViewer() {
  const page = path.join(__dirname, 'screen-viewer.html');
  const pageURL = pathToFileURL(page).href;
  let current;

  function close() {
    if (current && !current.window.isDestroyed()) current.window.close();
  }

  function trustedViewer(event) {
    const contents = current?.window.webContents;
    return (
      contents &&
      event.sender === contents &&
      event.senderFrame === contents.mainFrame &&
      event.senderFrame?.url === pageURL
    );
  }

  ipcMain.handle('lanvory:viewer-fullscreen', (event, enabled) => {
    if (trustedViewer(event) && typeof enabled === 'boolean')
      current.window.setFullScreen(enabled);
  });
  ipcMain.handle('lanvory:viewer-close', (event) => {
    if (trustedViewer(event)) close();
  });

  function open(owner, id) {
    if (current?.id === id && !current.window.isDestroyed()) {
      current.window.focus();
      return;
    }
    close();
    const viewer = new BrowserWindow({
      width: 1100,
      height: 720,
      minWidth: 420,
      minHeight: 280,
      show: false,
      title: 'Lanvory · Screen Viewer',
      backgroundColor: '#101314',
      webPreferences: {
        preload: path.join(__dirname, '../preload/screen-viewer.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const contents = owner.webContents;
    const restore = contents.getBackgroundThrottling();
    const entry = { window: viewer, id, ready: false, frame: undefined };
    current = entry;
    contents.setBackgroundThrottling(false);
    viewer.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    viewer.webContents.on('will-navigate', (event) => event.preventDefault());
    const notifyFullScreen = (active) => {
      if (entry.ready && !viewer.isDestroyed())
        viewer.webContents.send('lanvory:viewer-fullscreen-state', active);
    };
    viewer.on('enter-full-screen', () => notifyFullScreen(true));
    viewer.on('leave-full-screen', () => notifyFullScreen(false));
    viewer.once('closed', () => {
      if (current !== entry) return;
      current = undefined;
      if (!contents.isDestroyed()) contents.setBackgroundThrottling(restore);
    });
    viewer
      .loadFile(page)
      .then(() => {
        if (viewer.isDestroyed() || current !== entry) return;
        entry.ready = true;
        if (entry.frame)
          viewer.webContents.send('lanvory:viewer-frame', entry.frame);
        viewer.show();
      })
      .catch(() => {
        if (!viewer.isDestroyed()) viewer.close();
      });
  }

  function update(id, reply) {
    const entry = current;
    if (!entry || entry.id !== id || entry.window.isDestroyed()) return;
    if (reply?.state !== 'accepted') {
      if (reply?.state === 'stopped') close();
      return;
    }
    if (
      typeof reply.frame !== 'string' ||
      reply.frame.length > 4 * Math.ceil((640 * 1024) / 3)
    )
      return;
    entry.frame = reply.frame;
    if (entry.ready)
      entry.window.webContents.send('lanvory:viewer-frame', entry.frame);
  }

  return { open, update, close };
}

module.exports = { createScreenViewer };
