const { spawn } = require('node:child_process');

const inputLimit = 896 * 1024;
const outputLimit = 896 * 1024;

function createScreenStream(executable) {
  let process;
  let pending;
  let text = '';
  let idle;

  function close() {
    clearTimeout(idle);
    const worker = process;
    process = undefined;
    worker?.kill();
    const request = pending;
    pending = undefined;
    clearTimeout(request?.timeout);
    request?.resolve(null);
  }

  function start() {
    const worker = spawn(executable, ['screen-signaling', 'stream'], {
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    process = worker;
    text = '';
    const failed = () => {
      if (process === worker) close();
    };
    worker.once('error', failed);
    worker.once('close', failed);
    worker.stdin.on('error', failed);
    worker.stdout.setEncoding('utf8');
    worker.stdout.on('data', (chunk) => {
      if (process !== worker) return;
      text += chunk;
      if (Buffer.byteLength(text) > outputLimit || !pending) {
        close();
        return;
      }
      const newline = text.indexOf('\n');
      if (newline === -1) return;
      if (newline !== text.length - 1) {
        close();
        return;
      }
      try {
        const reply = JSON.parse(text.slice(0, newline));
        const request = pending;
        pending = undefined;
        text = '';
        clearTimeout(request.timeout);
        idle = setTimeout(close, 5000);
        request.resolve(reply);
      } catch {
        close();
      }
    });
  }

  function request(action, body) {
    const line = JSON.stringify({ action, body }) + '\n';
    if (pending || Buffer.byteLength(line) > inputLimit)
      return Promise.resolve(null);
    clearTimeout(idle);
    if (!process) start();
    return new Promise((resolve) => {
      pending = { resolve, timeout: setTimeout(close, 3500) };
      process.stdin.write(line);
    });
  }

  return { request, close };
}

module.exports = { createScreenStream };
