const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { installScreenPreview } = require('../src/main/screen-preview.cjs');

function harness(confirmPreview = async () => true) {
  const indexUrl = 'file:///test/index.html';
  const frame = { url: indexUrl };
  const session = {
    setPermissionCheckHandler(handler) {
      this.checkPermission = handler;
    },
    setPermissionRequestHandler(handler) {
      this.requestPermission = handler;
    },
    setDisplayMediaRequestHandler(handler) {
      this.requestCapture = handler;
    },
  };
  const contents = Object.assign(new EventEmitter(), {
    session,
    mainFrame: frame,
    isDestroyed: () => false,
  });
  const window = Object.assign(new EventEmitter(), {
    webContents: contents,
    isVisible: () => true,
    isDestroyed: () => false,
  });
  const source = {
    id: 'window:1:0',
    name: 'Test window',
    thumbnail: { isEmpty: () => false, toPNG: () => Buffer.from([1, 2]) },
  };
  const api = installScreenPreview({
    window,
    indexUrl,
    desktopCapturer: { getSources: async () => [source] },
    confirmPreview,
  });
  const request = {
    frame,
    userGesture: true,
    videoRequested: true,
    audioRequested: false,
  };
  const capture = (overrides = {}) =>
    new Promise((resolve) =>
      session.requestCapture({ ...request, ...overrides }, resolve),
    );
  return { api, capture, contents, session, source, window };
}

test('only an explicit video-only request from the trusted frame consumes a selected source', async () => {
  const { api, capture, contents, session, source } = harness();
  const mainFrame = { isMainFrame: true };
  assert.equal(
    session.checkPermission(contents, 'display-capture', '', mainFrame),
    false,
  );
  assert.deepEqual(await api.list(), [
    {
      id: source.id,
      name: source.name,
      kind: 'window',
      thumbnail: Uint8Array.of(1, 2),
    },
  ]);
  assert.equal(api.select('unknown'), false);
  assert.equal(api.select(source.id), true);
  assert.equal(
    session.checkPermission(contents, 'display-capture', '', mainFrame),
    true,
  );
  assert.equal(
    session.checkPermission(contents, 'media', '', mainFrame),
    false,
  );
  assert.equal(
    session.checkPermission(contents, 'display-capture', '', {
      isMainFrame: false,
    }),
    false,
  );
  assert.equal(await capture({ frame: { url: contents.mainFrame.url } }), null);
  assert.equal(await capture({ userGesture: false }), null);
  assert.equal(await capture({ audioRequested: true }), null);
  assert.deepEqual(await capture(), { video: source });
  assert.equal(await capture(), null);
});

test('cancelling confirmation consumes the selection without granting capture', async () => {
  const { api, capture, source } = harness(async () => false);
  await api.list();
  api.select(source.id);
  assert.equal(await capture(), null);
  assert.equal(await capture(), null);
});

test('hiding the window invalidates an in-flight confirmation', async () => {
  let finish;
  const { api, capture, source, window } = harness(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await api.list();
  api.select(source.id);
  const pending = capture();
  window.emit('hide');
  finish(true);
  assert.equal(await pending, null);
  assert.equal(api.select(source.id), false);
});
