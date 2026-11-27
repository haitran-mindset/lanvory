function createScreenSourceFinder({ permission, requestPermission }) {
  let requested = false;
  return async (list) => {
    const before = permission();
    let grantedByRequest = false;
    if (before === 'restricted') return { status: before };
    if (before !== 'granted' && !requested) {
      requested = true;
      try {
        grantedByRequest = requestPermission();
        if (!grantedByRequest) {
          const afterRequest = permission();
          if (afterRequest !== 'granted') {
            return {
              status: afterRequest === 'restricted' ? 'restricted' : 'denied',
            };
          }
        }
      } catch {
        // Fall back to Electron source discovery if the native module is unavailable.
      }
    } else if (before === 'denied' || before === 'not-determined') {
      return { status: before };
    }
    const sources = await list().catch(() => null);
    if (grantedByRequest && sources?.length)
      return { status: 'ready', sources };
    const after = permission();
    if (after === 'denied' || after === 'restricted') return { status: after };
    return sources?.length
      ? { status: 'ready', sources }
      : {
          status: after === 'not-determined' ? 'not-determined' : 'unavailable',
        };
  };
}

function installScreenPreview({
  window,
  indexUrl,
  desktopCapturer,
  confirmPreview,
}) {
  const contents = window.webContents;
  const session = contents.session;
  let sources = new Map();
  let selected;
  let generation = 0;
  let confirming = false;

  function allowedFrame(frame) {
    return (
      !window.isDestroyed() &&
      window.isVisible() &&
      !window.isMinimized() &&
      !contents.isDestroyed() &&
      frame === contents.mainFrame &&
      frame?.url === indexUrl
    );
  }

  function canCapture(sender, permission, details) {
    return (
      sender === contents &&
      permission === 'display-capture' &&
      details?.isMainFrame === true &&
      allowedFrame(contents.mainFrame) &&
      selected &&
      selected.expiresAt > Date.now()
    );
  }

  function clearSelection() {
    generation++;
    selected = undefined;
    sources.clear();
  }

  function stopBackgroundCapture() {
    if (!contents.isDestroyed()) contents.setBackgroundThrottling(true);
  }

  function onWindowClosing() {
    clearSelection();
    if (!contents.isDestroyed()) contents.send('lanvory:screen-window-closing');
    stopBackgroundCapture();
  }

  // Hiding or minimizing invalidates a pending selection, but an approved
  // capture must keep producing frames while the user works in another app.
  window.on('hide', clearSelection);
  window.on('minimize', clearSelection);
  window.on('close', onWindowClosing);
  contents.on('render-process-gone', () => {
    clearSelection();
    stopBackgroundCapture();
  });
  session.setPermissionRequestHandler((sender, permission, reply, details) => {
    reply(Boolean(canCapture(sender, permission, details)));
  });
  session.setPermissionCheckHandler((sender, permission, _origin, details) =>
    Boolean(canCapture(sender, permission, details)),
  );
  session.setDisplayMediaRequestHandler(async (request, reply) => {
    if (
      !selected ||
      confirming ||
      selected.expiresAt <= Date.now() ||
      !allowedFrame(request.frame) ||
      !request.userGesture ||
      !request.videoRequested ||
      request.audioRequested
    ) {
      reply(null);
      return;
    }
    const source = selected.source;
    selected = undefined;
    const checkpoint = generation;
    confirming = true;
    try {
      const approved = await confirmPreview(source.name);
      if (
        approved &&
        checkpoint === generation &&
        allowedFrame(request.frame)
      ) {
        contents.setBackgroundThrottling(false);
        reply({ video: source });
      } else {
        reply(null);
      }
    } catch {
      stopBackgroundCapture();
      try {
        reply(null);
      } catch {
        /* Request frame was destroyed. */
      }
    } finally {
      confirming = false;
    }
  });

  return {
    release() {
      generation++;
      selected = undefined;
      stopBackgroundCapture();
    },
    async list() {
      clearSelection();
      const checkpoint = generation;
      const frame = contents.mainFrame;
      if (!allowedFrame(frame) || confirming) return [];
      const found = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 640, height: 360 },
      });
      if (checkpoint !== generation || !allowedFrame(frame)) return [];
      sources = new Map(found.map((source) => [source.id, source]));
      return found.map(({ id, name, thumbnail }) => ({
        id,
        name,
        kind: id.startsWith('screen:') ? 'display' : 'window',
        thumbnail: thumbnail.isEmpty()
          ? undefined
          : Uint8Array.from(thumbnail.toPNG()),
      }));
    },
    select(id) {
      const source = typeof id === 'string' ? sources.get(id) : undefined;
      if (!source || confirming || !allowedFrame(contents.mainFrame))
        return false;
      selected = { source, expiresAt: Date.now() + 5000 };
      return true;
    },
  };
}

module.exports = { createScreenSourceFinder, installScreenPreview };
