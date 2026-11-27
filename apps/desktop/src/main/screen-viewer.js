const image = document.getElementById('frame');
const dimensions = document.getElementById('dimensions');
const waiting = document.getElementById('waiting');
const fullscreen = document.getElementById('fullscreen');
let isFullscreen = false;
let latest;
let drawing = false;

async function draw() {
  if (drawing) return;
  drawing = true;
  try {
    while (latest) {
      const frame = latest;
      latest = undefined;
      const next = new Image();
      next.src = `data:image/jpeg;base64,${frame}`;
      try {
        await next.decode();
        image.src = next.src;
        image.hidden = false;
        waiting.hidden = true;
        dimensions.textContent = `${next.naturalWidth} × ${next.naturalHeight}`;
      } catch {
        // A later frame can replace an invalid image.
      }
    }
  } finally {
    drawing = false;
  }
}

window.screenViewer.onFrame((frame) => {
  latest = frame;
  void draw();
});
window.screenViewer.onFullscreen((active) => {
  isFullscreen = active;
  fullscreen.setAttribute('aria-pressed', String(active));
  fullscreen.textContent = active ? 'Exit full screen' : 'Full screen';
});
fullscreen.addEventListener(
  'click',
  () => void window.screenViewer.fullscreen(!isFullscreen),
);
document
  .getElementById('close')
  .addEventListener('click', () => void window.screenViewer.close());
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && isFullscreen)
    void window.screenViewer.fullscreen(false);
});
