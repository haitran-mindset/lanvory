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

  window.on('hide', clearSelection);
  contents.on('render-process-gone', clearSelection);
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
      reply(
        approved && checkpoint === generation && allowedFrame(request.frame)
          ? { video: source }
          : null,
      );
    } catch {
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

module.exports = { installScreenPreview };
