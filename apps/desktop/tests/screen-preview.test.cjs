const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const {
  createScreenSourceFinder,
  installScreenPreview,
} = require('../src/main/screen-preview.cjs');

test('reports missing permission on the first search so Settings can open immediately', async () => {
  let status = 'denied';
  let requests = 0;
  const find = createScreenSourceFinder({
    permission: () => status,
    requestPermission: () => {
      requests++;
      return false;
    },
  });
  const sources = [{ id: 'screen:1' }];
  const list = async () => sources;
  assert.deepEqual(await find(list), { status: 'denied' });
  assert.deepEqual(await find(list), { status: 'denied' });
  status = 'granted';
  assert.deepEqual(await find(list), { status: 'ready', sources });
  assert.equal(requests, 1);
});

test('lists sources as soon as the native request grants access', async () => {
  const find = createScreenSourceFinder({
    permission: () => 'not-determined',
    requestPermission: () => true,
  });
  const sources = [{ id: 'screen:1' }];
  assert.deepEqual(await find(async () => sources), {
    status: 'ready',
    sources,
  });
});

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
    send(channel) {
      this.lastMessage = channel;
    },
    setBackgroundThrottling(enabled) {
      this.throttled = enabled;
    },
  });
  const window = Object.assign(new EventEmitter(), {
    webContents: contents,
    isVisible: () => true,
    isMinimized: () => false,
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

test('changing apps preserves approved capture until the Lanvory window closes', async () => {
  const { api, capture, contents, source, window } = harness();
  await api.list();
  assert.equal(api.select(source.id), true);
  assert.deepEqual(await capture(), { video: source });
  assert.equal(contents.throttled, false);
  window.emit('blur');
  assert.equal(contents.throttled, false);
  assert.equal(contents.lastMessage, undefined);
  window.emit('hide');
  window.emit('minimize');
  assert.equal(contents.throttled, false);
  assert.equal(contents.lastMessage, undefined);
  window.emit('close');
  assert.equal(contents.throttled, true);
  assert.equal(contents.lastMessage, 'lanvory:screen-window-closing');
});
