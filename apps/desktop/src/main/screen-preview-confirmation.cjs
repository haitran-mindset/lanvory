const confirmURL = 'https://screen-preview.invalid/confirm';

function confirmScreenPreview(BrowserWindow, parent, sourceName, dark) {
  const title = sourceName
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action https://screen-preview.invalid">
<title>Lanvory · Screen preview</title>
<style>
  :root { color-scheme: ${dark ? 'dark' : 'light'}; }
  * { box-sizing: border-box; }
  body { display: grid; align-content: center; min-height: 100vh; margin: 0; padding: 18px 20px; background: ${dark ? '#151b1a' : '#f3f7f4'}; color: ${dark ? '#f0f4f1' : '#172722'}; font: 14px system-ui, sans-serif; }
  h1 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 18px; margin: 0; }
  p { margin: 6px 0 16px; color: ${dark ? '#a9b8b1' : '#445c51'}; line-height: 1.4; }
  form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  button { width: 100%; height: 40px; border: 1px solid ${dark ? '#52645c' : '#aabcb2'}; border-radius: 6px; background: transparent; color: inherit; font: inherit; font-weight: 650; cursor: pointer; }
  button:hover { background: ${dark ? '#22332a' : '#e1eee6'}; }
  button:focus-visible { outline: 2px solid ${dark ? '#53e89a' : '#146849'}; outline-offset: 2px; }
  .preview { background: #49dc93; border-color: #49dc93; color: #092219; }
  .preview:hover { background: #63e6a3; }
</style>
</head>
<body>
  <h1 title="${title.replace(/"/g, '&quot;')}">Preview “${title}”?</h1>
  <p>The preview stays on this Mac until you invite a paired device and they accept.</p>
  <form action="${confirmURL}" method="post">
    <button type="submit" formaction="https://screen-preview.invalid/cancel">Cancel</button>
    <button type="submit" class="preview">Preview</button>
  </form>
</body>
</html>`;

  return new Promise((resolve) => {
    const popup = new BrowserWindow({
      parent,
      modal: true,
      show: false,
      useContentSize: true,
      width: 360,
      height: 166,
      resizable: false,
      minimizable: false,
      backgroundColor: dark ? '#151b1a' : '#f3f7f4',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    let approved = false;
    const close = () => {
      if (!popup.isDestroyed()) popup.close();
    };
    parent.once('hide', close);
    popup.once('closed', () => {
      parent.removeListener('hide', close);
      resolve(approved);
    });
    popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    popup.webContents.on('will-navigate', (event, url) => {
      event.preventDefault();
      approved = url === confirmURL;
      close();
    });
    popup.webContents.on('before-input-event', (event, input) => {
      if (input.key !== 'Escape') return;
      event.preventDefault();
      close();
    });
    popup.once('ready-to-show', () => {
      if (!popup.isDestroyed()) popup.show();
    });
    popup
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      .catch(close);
  });
}

module.exports = { confirmScreenPreview };
