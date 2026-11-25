const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { createServer, isIPv4 } = require('node:net');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');
const { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell } = require('electron');
const { createPairingAlerts, stopOwnedDaemon } = require('../src/main/native-lifecycle.cjs');

const profile = process.env.LANVORY_NATIVE_SMOKE_PROFILE;
assert.ok(profile && path.isAbsolute(profile), 'native smoke profile must be an isolated absolute path');
process.env.LANVORY_STATE_DIR = path.join(profile, 'state');
app.setPath('userData', path.join(profile, 'desktop'));
const bin = path.resolve(__dirname, '../../../bin');
const externalMode = process.argv.includes('--external-daemon');
let external;
let failure;

function daemonOnline() {
  try {
    execFileSync(path.join(bin, 'lanvory'), ['identity'], { stdio: 'ignore', timeout: 1000 });
    return true;
  } catch {
    return false;
  }
}

async function eventually(check, label) {
  const limit = Date.now() + 6000;
  do {
    if (await check()) return;
    await wait(100);
  } while (Date.now() < limit);
  throw new Error(`Timed out: ${label}`);
}

app.on('will-quit', (event) => {
  event.preventDefault();
  void (async () => {
    try {
      if (!failure) {
        assert.equal(daemonOnline(), externalMode, 'daemon ownership upon app exit');
        console.log(externalMode ? 'External daemon remained running' : 'App-owned daemon shut down');
      }
    } catch (err) {
      failure = err;
    } finally {
      await stopOwnedDaemon(external);
      if (failure) console.error(failure);
      app.exit(failure ? 1 : 0);
    }
  })();
});

async function verify() {
  let alerts = 0;
  const alertPairing = createPairingAlerts(() => { alerts++; });
  const now = Date.now();
  const future = new Date(now + 10000).toISOString();
  const past = new Date(now - 1000).toISOString();
  const request = (id, direction, expiresAt) => ({ id: id.repeat(32), direction, expiresAt });
  alertPairing([request('a', 'outgoing', future), request('b', 'incoming', past)], now);
  assert.equal(alerts, 0, 'outgoing and expired requests do not notify');
  const incoming = [request('c', 'incoming', future), request('d', 'incoming', future)];
  alertPairing(incoming, now);
  alertPairing(incoming, now + 1000);
  assert.equal(alerts, 1, 'incoming requests are grouped and deduplicated');
  console.log('Pairing notification policy ignored expired and outgoing requests and deduplicated pending requests');
  const preference = path.join(app.getPath('userData'), 'start-minimized');
  if (externalMode) {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(preference, '', { mode: 0o600 });
    external = spawn(path.join(bin, 'lanvoryd'), [], { stdio: 'ignore' });
    external.on('error', (err) => { failure = err; });
    await eventually(daemonOnline, 'initial external daemon readiness');
    const owner = JSON.parse(execFileSync(path.join(bin, 'lanvory'), ['identity'], { encoding: 'utf8' })).id;
    assert.match(owner, /^ed25519-v1:[a-f0-9]{64}$/);
    await stopOwnedDaemon(external);
    // Seed persisted history in the isolated profile before the daemon reloads it.
    execFileSync('/usr/bin/sqlite3', [path.join(process.env.LANVORY_STATE_DIR, 'state.sqlite3'),
      `INSERT INTO transfers (owner_id,id,direction,fingerprint,name,size,bytes,state,updated_ns)
       VALUES ('${owner}','${'b'.repeat(32)}','incoming','${'a'.repeat(64)}','stored-transfer.txt',23,23,'completed',unixepoch()*1000000000);`]);
    external = spawn(path.join(bin, 'lanvoryd'), [], { stdio: 'ignore' });
    external.on('error', (err) => { failure = err; });
    await eventually(daemonOnline, 'external daemon readiness after restart');
  }
  require('../src/main/index.cjs');
  await app.whenReady();
  if (externalMode) {
    await eventually(() => BrowserWindow.getAllWindows().length === 1, 'background window');
    assert.equal(BrowserWindow.getAllWindows()[0].isVisible(), false, 'window starts hidden');
    app.emit('activate');
    console.log('Startup preference hid the window until activation');
  }
  await eventually(() => BrowserWindow.getAllWindows().some((window) => window.isVisible()), 'visible window');
  await eventually(daemonOnline, 'daemon readiness');

  const [window] = BrowserWindow.getAllWindows();
  const initial = JSON.parse(execFileSync(path.join(bin, 'lanvory'), ['identity'], { encoding: 'utf8' }));
  const evaluate = (script) => window.webContents.executeJavaScript(script);
  async function selectOption(selector, label) {
    await eventually(() => evaluate(`
      (() => {
        const trigger = document.querySelector(${JSON.stringify(selector)});
        if (!trigger || trigger.disabled || !trigger.getClientRects().length) return false;
        trigger.focus();
        trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        return true;
      })();
    `), 'open select');
    await eventually(() => evaluate(`
      (() => {
        const options = [...document.querySelectorAll('[role=option]')];
        const option = ${label === undefined ? 'options[0]' : `options.find(item => item.textContent.trim() === ${JSON.stringify(label)})`};
        if (!option) return false;
        option.focus();
        option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return true;
      })();
    `), 'choose select option');
  }
  await eventually(() => evaluate('Boolean(document.querySelector(".workspace-header"))'), 'workspace rendered');
  assert.equal(await evaluate(`[...document.querySelectorAll('nav button')].some(button => button.textContent === 'Terminal')`), false);
  assert.equal(await evaluate(`Boolean([...document.querySelectorAll('.page-heading button')].find(button => button.textContent === ' Pair Device' || button.textContent === 'Pair Device'))`), true);
  const originalBounds = window.getBounds();
  window.setSize(780, 540);
  try {
    await eventually(() => evaluate(`document.querySelector('.page-scroll').scrollHeight > document.querySelector('.page-scroll').clientHeight`), 'scrollable page content');
    const layout = await evaluate(`
      (() => {
        const content = document.querySelector('.page-scroll');
        const sidebar = document.querySelector('aside');
        const header = document.querySelector('.workspace-header');
        const before = [sidebar.getBoundingClientRect().top, header.getBoundingClientRect().top];
        content.scrollTop = 160;
        const after = [sidebar.getBoundingClientRect().top, header.getBoundingClientRect().top];
        const scrolled = content.scrollTop > 0;
        content.scrollTop = 0;
        return { before, after, scrolled };
      })();
    `);
    assert.equal(layout.scrolled, true);
    assert.deepEqual(layout.before, layout.after, 'workspace header and sidebar stay fixed while content scrolls');
  } finally {
    window.setBounds(originalBounds);
  }
  let copiedFingerprint;
  const writeText = clipboard.writeText;
  clipboard.writeText = (text) => { copiedFingerprint = text; };
  try {
    const wrongFingerprint = (initial.fingerprint[0] === 'a' ? 'b' : 'a') + initial.fingerprint.slice(1);
    assert.equal(await evaluate(`window.lanvory.copyFingerprint('${wrongFingerprint}')`), false);
    assert.equal(copiedFingerprint, undefined);
    await eventually(() => evaluate(`
      (() => {
        const button = document.querySelector('button[aria-controls="identity-details"]');
        if (button?.textContent.trim() !== "View device ID") return false;
        button.click();
        return true;
      })();
    `), 'local identity details');
    await evaluate(`[...document.querySelectorAll('#identity-details button')].find(button => button.textContent.trim() === 'Copy device ID').click()`);
    await eventually(() => copiedFingerprint === initial.fingerprint, 'copy local fingerprint');
    assert.equal(await evaluate('document.querySelector("#identity-details").matches(":modal")'), true);
    await evaluate(`document.querySelector('#identity-details button[aria-label="Close My device"]').click()`);
    console.log('Copy fingerprint sent only the current local identity to the clipboard adapter');
  } finally {
    clipboard.writeText = writeText;
  }
  await evaluate(`
    [...document.querySelectorAll('nav button')].find(button => button.textContent === 'Settings').click();
  `);
  await evaluate(`new Promise((resolve, reject) => {
    let attempts = 0;
    const timer = setInterval(() => {
      if (document.querySelector('input[name="name"]') && document.querySelector('#settings-startup')) {
        clearInterval(timer);
        resolve();
      } else if (++attempts === 50) {
        clearInterval(timer);
        reject(new Error('Settings form unavailable'));
      }
    }, 100);
  })`);
  await evaluate(`
    document.querySelector('input[name="name"]').value = 'Native Smoke Device';
    document.querySelector('input[name="name"]').form.requestSubmit();
  `);
  await eventually(() => {
    const current = JSON.parse(execFileSync(path.join(bin, 'lanvory'), ['identity'], { encoding: 'utf8' }));
    return current.name === 'Native Smoke Device' && current.fingerprint === initial.fingerprint;
  }, 'persisted name with stable identity');
  console.log('Settings saved the device name through authenticated IPC');
  await evaluate('document.querySelector("#settings-startup[role=checkbox]").closest("label").querySelector("span").click()');
  await eventually(() => existsSync(preference) === !externalMode, 'startup preference persisted');
  assert.deepEqual(await evaluate(`
    Promise.all([window.lanvory.loginItem(), window.lanvory.setLoginItem(true)])
  `), [null, null], 'development builds cannot register a login item');
  assert.equal(await evaluate('Boolean(document.querySelector("#settings-loginItem[role=checkbox]"))'), false);
  console.log('Settings updated the startup preference');

  await selectOption('[data-field=textSize]', 'Large');
  const setTheme = (value) => selectOption('[data-field=theme]', value);
  const canvasIs = (color) => evaluate(`
    getComputedStyle(document.documentElement).backgroundColor === ${JSON.stringify(color)}
  `);
  nativeTheme.themeSource = 'dark';
  await eventually(() => canvasIs('rgb(16, 19, 20)'), 'default dark theme');
  await setTheme('Light');
  await eventually(() => canvasIs('rgb(243, 247, 244)'), 'explicit light theme');
  await setTheme('System');
  await eventually(() => canvasIs('rgb(16, 19, 20)'), 'system theme follows dark');
  nativeTheme.themeSource = 'light';
  await eventually(() => canvasIs('rgb(243, 247, 244)'), 'system theme follows light');
  const navGapIs = (gap) => evaluate(`
    getComputedStyle(document.querySelector('nav')).rowGap === ${JSON.stringify(gap)}
  `);
  await eventually(() => navGapIs('6px'), 'default comfortable density');
  await selectOption('[data-field=density]', 'Compact');
  await eventually(() => navGapIs('2px'), 'compact density applied');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.settings-versions dd')].map((field) => field.textContent)`),
    [require('../package.json').version, initial.daemonVersion, String(initial.protocolVersion)],
    'About shows application, daemon build, and protocol versions');
  assert.equal(initial.daemonVersion, require('../package.json').version, 'built daemon reports the release version');
  await evaluate(`document.querySelector('[aria-labelledby=settings-about] button').click()`);
  await eventually(() => evaluate(`
    document.querySelector('[aria-labelledby=settings-about] [role=status]')?.textContent ===
      'Open-source notices are included in packaged builds.'
  `), 'About explains notice availability in the development build');

  assert.ok(await evaluate(`!!document.querySelector('[aria-labelledby=settings-shortcuts]')`), 'shortcuts card present in Settings');
  assert.ok(await evaluate(`!!document.querySelector('[aria-labelledby=settings-storage]')`), 'storage and inbox card present in Settings');
  assert.ok(await evaluate(`!!document.querySelector('[aria-labelledby=settings-perm-defaults]')`), 'permission defaults card present in Settings');
  await selectOption('[aria-labelledby=settings-perm-defaults] [data-field=defaultDuration]', '24 hours');
  assert.equal(await evaluate(`localStorage.getItem('lanvory.default-grant-duration')`), 'day', 'default duration persisted');
  await selectOption('[aria-labelledby=settings-perm-defaults] [data-field=defaultDuration]', 'Until revoked');
  assert.equal(await evaluate(`localStorage.getItem('lanvory.default-grant-duration')`), 'until-revoked', 'default duration restored to until-revoked');
  console.log('Permission defaults updated and persisted in Settings');
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', metaKey: true }))`);
  await eventually(() => evaluate(`document.querySelector('.shell')?.dataset.page === 'Devices'`), 'Cmd+1 switches to Devices');
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '5', metaKey: true }))`);
  await eventually(() => evaluate(`document.querySelector('.shell')?.dataset.page === 'Settings'`), 'Cmd+5 switches back to Settings');
  console.log('Global keyboard shortcuts switched views between Settings and Devices');

  const motionIsReduced = () => evaluate('document.documentElement.dataset.reducedMotion === "true"');
  await evaluate('document.querySelector("#settings-reducedMotion[role=checkbox]").click()');
  await eventually(motionIsReduced, 'reduced motion applied');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".settings-activity-chevron")).transitionDuration'), '0s');

  const alertsSupported = await evaluate('window.lanvory.pairingAlerts()') !== null;
  if (alertsSupported) {
    assert.equal(await evaluate('window.lanvory.pairingAlerts()'), true, 'pairing alerts enabled by default');
    await eventually(() => evaluate(`
      (() => {
        const control = document.querySelector('#settings-pairingAlerts[role=checkbox]');
        if (!control || control.disabled) return false;
        control.click();
        return true;
      })();
    `), 'pairing notifications checkbox');
    await eventually(async () => await evaluate('window.lanvory.pairingAlerts()') === false, 'pairing alerts muted');
  }

  const sizeApplied = () => evaluate('getComputedStyle(document.documentElement).fontSize === "20px"');
  await eventually(sizeApplied, 'large text applied');
  await new Promise((resolve, reject) => {
    window.webContents.once('did-finish-load', resolve);
    window.webContents.once('did-fail-load', (_event, code, description) => reject(new Error(`${code}: ${description}`)));
    window.webContents.reload();
  });
  await eventually(sizeApplied, 'large text restored after renderer reload');
  await eventually(() => canvasIs('rgb(243, 247, 244)'), 'system theme restored after renderer reload');
  await eventually(() => navGapIs('2px'), 'compact density restored after renderer reload');
  await eventually(motionIsReduced, 'reduced motion restored after renderer reload');
  if (alertsSupported) {
    assert.equal(await evaluate('window.lanvory.pairingAlerts()'), false, 'notification preference survived reload');
    assert.equal(await evaluate('window.lanvory.setPairingAlerts(true)'), true, 'pairing alerts can be re-enabled');
    console.log('Settings persisted the pairing notification preference');
  }
  nativeTheme.themeSource = 'system';
  console.log('Text size, theme, and density applied throughout the renderer and survived reload');
  const inventory = () => JSON.parse(execFileSync(path.join(bin, 'lanvory'), ['network'], { encoding: 'utf8' }));
  const eligible = inventory().find((adapter) => adapter.eligible);
  const loopback = inventory().find((adapter) => adapter.loopback);
  assert.ok(loopback, 'macOS should report its loopback interface');
  const setApproval = (adapter, approved) => evaluate(`
    window.lanvory.setInterfaceApproval(${JSON.stringify(adapter)}, ${approved})
  `);
  assert.equal(await setApproval(loopback.name, true), false, 'daemon rejects loopback approval');
  await evaluate(`[...document.querySelectorAll('nav button')].find(button => button.textContent === 'Network').click()`);
  await eventually(() => evaluate(`
    document.querySelector('[aria-labelledby=listener-heading]')?.textContent.includes('Local-only mode')
  `), 'local-only listener status');
  assert.equal(await evaluate(`window.lanvory.setListener('start', ${JSON.stringify(loopback.name)}, '127.0.0.1:0', true)`), null,
    'daemon rejects loopback listener startup');
  if (eligible) {
    await eventually(() => evaluate(`
      document.querySelector('[aria-labelledby=adapters-heading] li strong')?.textContent === ${JSON.stringify(eligible.name)}
    `), 'approvable adapter before inactive interfaces');
  }
  if (eligible) {
    await evaluate(`[...document.querySelectorAll('nav button')].find(button => button.textContent === 'Network').click()`);
    const clickAdapter = (label) => evaluate(`
      (() => {
        const button = [...document.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === ${JSON.stringify(label)});
        if (!button || button.disabled) return false;
        button.click();
        return true;
      })();
    `);
    const address = eligible.addresses.map((cidr) => cidr.split('/')[0]).find(isIPv4);
    assert.ok(address, 'eligible adapter has an IPv4 address');
    async function startListener(pairing, port = 0) {
      await selectOption('[aria-labelledby=listener-heading] [data-field=bind]', `${eligible.name} · ${address}`);
      await evaluate(`
        (() => {
          const form = document.querySelector('[aria-labelledby=listener-heading] form');
          form.elements.namedItem('port').value = '${port}';
          const checkbox = form.querySelector('[role=checkbox]');
          if ((checkbox.getAttribute('aria-checked') === 'true') !== ${pairing}) checkbox.click();
        })();
      `);
      await eventually(() => evaluate(`
        new FormData(document.querySelector('[aria-labelledby=listener-heading] form')).has('pairing') === ${pairing}
      `), 'pairing checkbox value reached the form');
      await evaluate(`document.querySelector('[aria-labelledby=listener-heading] form').requestSubmit()`);
    }
    const occupied = createServer((socket) => socket.destroy());
    await new Promise((resolve, reject) => {
      occupied.once('error', reject);
      occupied.listen(0, address, resolve);
    });
    try {
      await startListener(true, occupied.address().port);
      await eventually(() => evaluate(`
        document.querySelector('[aria-labelledby=listener-heading]').textContent.includes('The temporary network permission was removed.')
      `), 'LAN bind failure reported and rolled back');
      assert.equal(inventory().find((adapter) => adapter.name === eligible.name)?.approved, false, 'failed bind did not leave an approval');
      assert.equal((await evaluate('window.lanvory.listenerStatus()')).state, 'local-only', 'failed bind did not start the listener');
      console.log('A real listener bind failure rolled back the temporary adapter approval');
    } finally {
      await new Promise((resolve, reject) => occupied.close((error) => error ? reject(error) : resolve()));
    }
    await startListener(true);
    await eventually(async () => {
      const status = await evaluate('window.lanvory.listenerStatus()');
      return status?.state === 'listening' && status.adapter === eligible.name && status.pairing;
    }, 'scoped listener is running with pairing');
    assert.equal(inventory().find((adapter) => adapter.name === eligible.name)?.approved, true, 'starting approves the chosen adapter');
    const activeListener = await evaluate('window.lanvory.listenerStatus()');
    const originalWrite = clipboard.writeText;
    let copiedAddress;
    const pairingDetails = `Lanvory pairing\nAddress: ${activeListener.endpoint}\nDevice ID: ${initial.fingerprint}`;
    clipboard.writeText = (text) => { copiedAddress = text; };
    try {
      assert.equal(await evaluate('window.lanvory.copyLanAddress("127.0.0.1:1")'), false, 'stale address refused');
      assert.equal(copiedAddress, undefined);
      await eventually(() => clickAdapter('Copy LAN address'), 'copy LAN address control');
      await eventually(() => copiedAddress === activeListener.endpoint, 'current LAN endpoint copied through IPC');
      assert.equal(await evaluate(`window.lanvory.copyPairingDetails(${JSON.stringify(initial.fingerprint)})`), true);
      assert.equal(copiedAddress, pairingDetails, 'pairing export contains current endpoint and identity');
      console.log('Network copied the current LAN endpoint and refused an unrelated address');
    } finally {
      clipboard.writeText = originalWrite;
    }
    await evaluate(`[...document.querySelectorAll('nav button')].find(button => button.textContent === 'Devices').click()`);
    await eventually(() => evaluate(`
      (() => {
        const manual = document.querySelector('.pairing-manual');
        if (!manual) return false;
        manual.open = true;
        return !!manual.querySelector('input[name=endpoint]');
      })()
    `), 'manual pairing address form');
    await evaluate(`
      (() => {
        const data = new DataTransfer();
        data.setData('text/plain', ${JSON.stringify(pairingDetails)});
        const input = document.querySelector('.pairing-manual input[name=fingerprint]');
        input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
      })();
    `);
    await eventually(() => evaluate(`
      (() => {
        const form = document.querySelector('.pairing-manual form');
        const values = new FormData(form);
        return values.get('endpoint') === ${JSON.stringify(activeListener.endpoint)}
          && values.get('fingerprint') === ${JSON.stringify(initial.fingerprint)}
          && form.textContent.includes('No approved local adapter can reach this address')
          && form.querySelector('button[type=submit]').disabled;
      })()
    `), 'pairing paste prefills both fields and blocks the local address');
    console.log('Pair by address prefilled the pasted address and rejected the same-host endpoint');
    await evaluate(`[...document.querySelectorAll('nav button')].find(button => button.textContent === 'Network').click()`);
    await eventually(() => evaluate(`
      (() => {
        const button = [...document.querySelectorAll('[aria-labelledby=listener-heading] button')]
          .find(item => item.textContent === 'Turn off LAN');
        if (!button || button.disabled) return false;
        button.click();
        return true;
      })();
    `), 'stop listener control');
    await eventually(async () => (await evaluate('window.lanvory.listenerStatus()'))?.state === 'stopped', 'listener stopped');
    await eventually(() => inventory().find((adapter) => adapter.name === eligible.name)?.approved === false, 'turning off LAN revoked adapter approval');
    assert.equal(daemonOnline(), true, 'stopping the listener leaves local IPC running');
    await startListener(false);
    await eventually(async () => {
      const status = await evaluate('window.lanvory.listenerStatus()');
      return status?.state === 'listening' && status.pairing === false;
    }, 'listener running with incoming pairing disabled');
    assert.equal(await evaluate(`window.lanvory.copyPairingDetails(${JSON.stringify(initial.fingerprint)})`), false,
      'pairing details cannot be copied while incoming pairing is disabled');
    await eventually(() => evaluate(`
      JSON.parse(localStorage.getItem('lanvory.connection-settings') || 'null')?.pairing === false
    `), 'connection preferences saved');
    const stopped = await evaluate('window.lanvory.setListener("stop")');
    assert.equal(stopped?.state, 'stopped');
    await evaluate(`[...document.querySelectorAll('nav button')].find(button => button.textContent === 'Devices').click()`);
    await eventually(() => evaluate('!document.querySelector("[aria-labelledby=listener-heading]")'), 'Network unmounted');
    await evaluate(`[...document.querySelectorAll('nav button')].find(button => button.textContent === 'Network').click()`);
    await eventually(() => evaluate(`
      document.querySelector('[aria-labelledby=listener-heading] input[name=port]')?.value === '0'
      && document.querySelector('[aria-labelledby=listener-heading] [role=checkbox]')?.getAttribute('aria-checked') === 'false'
    `), 'connection preferences restored after reopening Network');
    console.log('Network started and stopped an approved listener without restarting the daemon');
    await eventually(() => clickAdapter(`Revoke ${eligible.name}`), 'adapter revoke control');
    await eventually(() => inventory().find((adapter) => adapter.name === eligible.name)?.approved === false, 'persisted adapter revocation');
    console.log('Network view approved and revoked an eligible adapter; the daemon rejected loopback approval');
  } else {
    console.log('Skipped adapter approval UI check: no eligible adapter');
  }
  await evaluate(`[...document.querySelectorAll('nav button')].find(button => button.textContent === 'Network').click()`);
  await eventually(() => evaluate(`
    (() => {
      const section = document.querySelector('[aria-labelledby=scope-heading]');
      if (!section) return false;
      section.open = true;
      return true;
    })();
  `), 'connection diagnostics');
  await selectOption('[data-field=adapter]', loopback.name);
  const submitScope = (address) => evaluate(`
    (() => {
      const field = document.querySelector('[aria-labelledby=scope-heading] input[name=address]');
      if (!field || field.disabled) return false;
      field.value = ${JSON.stringify(address)};
      field.form.requestSubmit();
      return true;
    })();
  `);
  const scopeSays = (message) => evaluate(`
    document.querySelector('[aria-labelledby=scope-heading] .scope-result')?.textContent.includes(${JSON.stringify(message)})
  `);
  await eventually(() => submitScope('192.168.1.42'), 'IPv4 scope form');
  await eventually(() => scopeSays('The adapter must be active and approved.'), 'daemon scope denial');
  await eventually(() => submitScope('300.0.0.1'), 'invalid IPv4 submission');
  await eventually(() => scopeSays('Enter a valid IPv4 address.'), 'IPv4 validation');
  let report;
  const writeClipboard = clipboard.writeText;
  clipboard.writeText = (value) => { report = value; };
  try {
    await evaluate(`
      [...document.querySelectorAll('[aria-labelledby=scope-heading] button')]
        .find(button => button.textContent.trim() === 'Copy diagnostic report').click();
    `);
    await eventually(() => typeof report === 'string', 'network diagnostics copied');
    assert.match(report, /^Lanvory network diagnostics\n/);
    assert.match(report, /\nLAN listener: (?:local-only|stopped)\n/);
    assert.match(report, /\nNetwork adapters: \d+\nApproved adapters: \d+$/);
    assert.ok(!report.includes(initial.fingerprint) && !report.includes(loopback.name) && !report.includes('127.0.0.1'));
    console.log('Network copied diagnostic counts without device or adapter identifiers');
  } finally {
    clipboard.writeText = writeClipboard;
  }
  console.log('Network scope check displayed daemon denial and rejected malformed IPv4 input');
  const testPeer = 'a'.repeat(64);
  assert.equal(await evaluate(`window.lanvory.setInboxAccess('${testPeer}', true)`), false, 'inbox grants require peer trust');
  assert.match(initial.id, /^ed25519-v1:[a-f0-9]{64}$/);
  // Seed a trusted remote identity in this isolated database. Pairing is tested separately.
  execFileSync('/usr/bin/sqlite3', [path.join(process.env.LANVORY_STATE_DIR, 'state.sqlite3'),
    `INSERT INTO trusted_peers VALUES ('${initial.id}', '${testPeer}', unixepoch());`]);
  await evaluate(`[...document.querySelectorAll('nav button')].find(button => button.textContent === 'Sharing').click()`);
  if (externalMode) {
    await eventually(() => evaluate(`
      [...document.querySelectorAll('[aria-labelledby=transfer-history-heading] li')].some(row =>
        row.textContent.includes('stored-transfer.txt') && row.textContent.includes('From DEVICE-AAAAA')
        && row.textContent.includes('Incoming · Completed · 23 B / 23 B'))
    `), 'persisted history reached Sharing after daemon restart');
    assert.equal(await evaluate(`!!document.querySelector('[aria-labelledby=active-transfers-heading]')`), false,
      'completed history stays out of active transfers');
    console.log('Sharing displayed stored transfer history after a daemon restart');
    await selectOption('[aria-labelledby=transfer-history-heading] [data-field=directionFilter]', 'Sent');
    assert.equal(await evaluate(`[...document.querySelectorAll('[aria-labelledby=transfer-history-heading] li')].length`), 0, 'Sent filter excludes incoming transfer');
    await selectOption('[aria-labelledby=transfer-history-heading] [data-field=directionFilter]', 'Received');
    assert.equal(await evaluate(`[...document.querySelectorAll('[aria-labelledby=transfer-history-heading] li')].length`), 1, 'Received filter includes incoming transfer');
    await selectOption('[aria-labelledby=transfer-history-heading] [data-field=directionFilter]', 'All directions');
    console.log('Sharing history filtered by direction');
    await evaluate(`
      document.querySelector('button[aria-label="Remove stored-transfer.txt from history"]').click()
    `);
    await eventually(() => evaluate(`
      (() => {
        const confirm = [...document.querySelectorAll('[aria-labelledby=transfer-history-heading] button')]
          .find(button => button.textContent === 'Remove entry');
        if (!confirm) return false;
        confirm.click();
        return true;
      })()
    `), 'confirm history removal in Sharing');
    await eventually(() => evaluate(`
      document.querySelector('[aria-labelledby=transfer-history-heading]').textContent.includes('Entry removed from history.')
      && !document.querySelector('.sharing-history-remove')
    `), 'remove history entry from Sharing');
    const storedCount = execFileSync('/usr/bin/sqlite3', [path.join(process.env.LANVORY_STATE_DIR, 'state.sqlite3'),
      `SELECT count(*) FROM transfers WHERE id='${'b'.repeat(32)}';`], { encoding: 'utf8' }).trim();
    assert.equal(storedCount, '0', 'history deletion persisted');
  }
  const fixture = path.join(profile, 'native-smoke-file.txt');
  writeFileSync(fixture, 'native smoke fixture');
  const showOpenDialog = dialog.showOpenDialog;
  const clickPicker = (label) => evaluate(`
    (() => {
      const button = [...document.querySelectorAll('.file-selection button')]
        .find(item => (item.getAttribute('aria-label') || item.textContent.trim()) === ${JSON.stringify(label)});
      if (!button || button.disabled) return false;
      button.click();
      return true;
    })();
  `);
  try {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] });
    await eventually(() => clickPicker('Choose file'), 'open file picker');
    await eventually(() => evaluate('document.querySelector(".file-selection span")?.textContent === "native-smoke-file.txt"'), 'selected file appears');
    await eventually(() => clickPicker('Remove selected file'), 'remove current file');
    await eventually(() => evaluate(`
      document.querySelector('.file-selection span')?.textContent === 'Drop a file here' &&
      document.querySelector('.sharing-panel button[type=submit]').disabled
    `), 'selection cleared and sending disabled');
    assert.equal(readFileSync(fixture, 'utf8'), 'native smoke fixture', 'removing the selection preserves the original file');
    await eventually(() => clickPicker('Choose file'), 'reopen file picker');
    await eventually(() => evaluate('document.querySelector(".file-selection span")?.textContent === "native-smoke-file.txt"'), 'file can be selected again');
    await eventually(() => clickPicker('Remove selected file'), 'remove reselected file');
    await eventually(() => evaluate('!document.querySelector(".sharing-remove-file")'), 'reselected file cleared');
    console.log('Sharing cleared and reselected a file through desktop IPC while preserving the source file');
    const fixtureTwo = path.join(profile, 'native-smoke-file-2.txt');
    writeFileSync(fixtureTwo, 'native smoke fixture 2');
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture, fixtureTwo] });
    await eventually(() => clickPicker('Choose file'), 'open multi-file picker');
    await eventually(() => evaluate(`
      document.querySelector('.file-selection span')?.textContent === '2 files selected' &&
      document.querySelectorAll('.selected-files-list li').length === 2
    `), 'multi-file selection appears');
    await evaluate('document.querySelector(".selected-files-list li button[aria-label=\\"Remove native-smoke-file-2.txt\\"]")?.click()');
    await eventually(() => evaluate(`
      document.querySelector('.file-selection span')?.textContent === 'native-smoke-file.txt' &&
      !document.querySelector('.selected-files-list')
    `), 'individual file removed from multi-file selection');
    await eventually(() => clickPicker('Remove selected file'), 'remove remaining file');
    await eventually(() => evaluate('!document.querySelector(".sharing-remove-file")'), 'multi-file selection cleared');
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] });
    assert.equal(await evaluate('window.lanvory.selectDroppedFile(new File(["test"], "fake.txt"))'), null,
      'a script-created file has no selectable local path');
    await evaluate(`
      (() => {
        const input = document.createElement('input');
        input.id = 'smoke-drop-source';
        input.type = 'file';
        input.hidden = true;
        document.body.append(input);
      })();
    `);
    const debuggerSession = window.webContents.debugger;
    debuggerSession.attach('1.3');
    try {
      const { root } = await debuggerSession.sendCommand('DOM.getDocument');
      const { nodeId } = await debuggerSession.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '#smoke-drop-source' });
      await debuggerSession.sendCommand('DOM.setFileInputFiles', { nodeId, files: [fixture] });
      await evaluate(`
        (() => {
          const source = document.querySelector('#smoke-drop-source');
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(source.files[0]);
          source.remove();
          document.querySelector('.file-selection').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
        })();
      `);
    } finally {
      debuggerSession.detach();
    }
    await eventually(() => evaluate('document.querySelector(".file-selection span")?.textContent === "native-smoke-file.txt"'), 'dropped file selected');
    const stateDatabase = path.join(process.env.LANVORY_STATE_DIR, 'state.sqlite3');
    const navigate = (page) => evaluate(`
      [...document.querySelectorAll('nav button')].find(button => button.textContent.trim() === ${JSON.stringify(page)}).click()
    `);
    await navigate('Network');
    execFileSync('/usr/bin/sqlite3', ['-cmd', '.timeout 5000', stateDatabase,
      `DELETE FROM trusted_peers WHERE owner_id = '${initial.id}' AND fingerprint = '${testPeer}';`]);
    await navigate('Sharing');
    await eventually(() => evaluate(`
      document.querySelector('.sharing-panel .pair-required') !== null &&
      document.querySelector('.file-selection button.refresh')?.disabled === true &&
      !document.querySelector('.sharing-panel button[type=submit]')
    `), 'lost recipient disables file selection and send');
    await eventually(() => clickPicker('Remove selected file'), 'remove dropped file');
    await eventually(() => evaluate('!document.querySelector(".sharing-remove-file")'), 'dropped selection cleared');
    execFileSync('/usr/bin/sqlite3', [stateDatabase,
      `INSERT INTO trusted_peers VALUES ('${initial.id}', '${testPeer}', unixepoch());`]);
    await navigate('Network');
    await navigate('Sharing');
    console.log('Sharing selected a disk-backed drop through preload and rejected a script-created file');
  } finally {
    dialog.showOpenDialog = showOpenDialog;
  }
  const clickInbox = (text) => evaluate(`
    (() => {
      const button = [...document.querySelectorAll('[aria-labelledby=inbox-access-heading] button')]
        .find(item => item.textContent === ${JSON.stringify(text)});
      if (!button || button.disabled) return false;
      button.click();
      return true;
    })();
  `);
  await eventually(() => clickInbox('Set permission'), 'open duration options for a device');
  await selectOption('[aria-labelledby=inbox-access-heading] [data-field=duration]', '1 hour');
  await eventually(() => clickInbox('Allow requests'), 'grant inbox access control');
  await eventually(() => evaluate(`document.querySelector('[aria-labelledby=inbox-access-heading]').textContent.includes('Requests allowed until')`), 'inbox expiry displayed');
  const inboxGrant = JSON.parse(execFileSync(path.join(bin, 'lanvory'), ['permissions', 'list'], { encoding: 'utf8' }))
    .find((grant) => grant.fingerprint === testPeer && grant.capability === 'file-receive' && grant.resource === 'inbox');
  const remainingMs = Date.parse(inboxGrant?.expiresAt) - Date.now();
  assert.ok(remainingMs > 3500000 && remainingMs <= 3600000, 'one-hour expiry reached the daemon');
  await eventually(() => clickInbox('Block requests'), 'revoke inbox access control');
  await eventually(() => evaluate(`document.querySelector('[aria-labelledby=inbox-access-heading]').textContent.includes('File requests from DEVICE-AAAAA are blocked.')`), 'inbox access revoked');
  let openedFolder;
  const openPath = shell.openPath;
  shell.openPath = async (folder) => { openedFolder = folder; return ''; };
  try {
    const inbox = path.join(process.env.LANVORY_STATE_DIR, 'inbox');
    assert.equal(await evaluate('window.lanvory.openInbox()'), 'missing', 'inbox does not exist before receipt');
    assert.equal(openedFolder, undefined);
    mkdirSync(inbox, { mode: 0o700 });
    await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Open inbox').click()`);
    await eventually(() => openedFolder === inbox, 'open fixed inbox folder');
    console.log('Sharing opened the isolated profile’s inbox and handled a missing folder');
  } finally {
    shell.openPath = openPath;
  }
  console.log('Sharing granted and revoked inbox access and denied an untrusted peer');
  await evaluate(`[...document.querySelectorAll('nav button')].find(button => button.textContent === 'Services').click()`);
  await eventually(() => evaluate(`
    (() => {
      const form = document.querySelector('.services-connection')?.closest('form');
      return form && new FormData(form).get('fingerprint') === '${testPeer}'
        && form.querySelector('[data-field=fingerprint]').textContent.includes('DEVICE-AAAAA');
    })();
  `), 'Services preselected the only paired device');
  const bridgeID = 'smoke-bridge';
  const target = '127.0.0.1:49151';
  assert.equal(await evaluate(`window.lanvory.serviceAction('share', { id: '${bridgeID}', target: '192.168.1.2:49151' })`),
    false, 'service registry rejects a non-loopback target');
  await eventually(() => evaluate(`
    (() => {
      const field = document.querySelector('[aria-labelledby=services-heading] input[name=target]');
      if (!field || field.form.querySelector('button').disabled) return false;
      field.value = '${target}';
      field.form.elements.namedItem('id').value = '${bridgeID}';
      field.form.requestSubmit();
      return true;
    })();
  `), 'register service form');
  const serviceState = (command) => JSON.parse(execFileSync(path.join(bin, 'lanvory'), command, { encoding: 'utf8' }));
  const registered = () => serviceState(['services', 'list']).some((item) => item.id === bridgeID && item.target === target);
  await eventually(registered, 'registered loopback service');
  await selectOption('[aria-labelledby=services-heading] .sharing-item [data-field=fingerprint]', `DEVICE-${testPeer.slice(0, 5).toUpperCase()}`);
  await selectOption('[aria-labelledby=services-heading] .sharing-item [data-field=duration]', '24 hours');
  await evaluate(`document.querySelector('[aria-labelledby=services-heading] .sharing-item form').requestSubmit()`);
  const findBridgeGrant = () => serviceState(['permissions', 'list']).find((grant) =>
    grant.fingerprint === testPeer && grant.capability === 'service-connect' && grant.resource === bridgeID);
  await eventually(findBridgeGrant, 'service grant saved');
  const bridgeRemainingMs = Date.parse(findBridgeGrant()?.expiresAt) - Date.now();
  assert.ok(bridgeRemainingMs > 86300000 && bridgeRemainingMs <= 86400000, '24-hour service expiry reached the daemon');
  assert.equal(await evaluate(`window.lanvory.serviceAction('grant', { id: '${bridgeID}', fingerprint: '${testPeer}', duration: 'invalid' })`),
    false, 'invalid service grant duration rejected');
  const clickServiceAction = (text) => evaluate(`
    (() => {
      const button = [...document.querySelectorAll('[aria-labelledby=services-heading] .sharing-item button')]
        .find(item => item.textContent === ${JSON.stringify(text)});
      if (!button || button.disabled) return false;
      button.click();
      return true;
    })();
  `);
  await eventually(() => clickServiceAction('Revoke access'), 'revoke service access control');
  await eventually(() => !findBridgeGrant(), 'service grant revoked');
  await evaluate('void (window.confirm = () => true)');
  await eventually(() => clickServiceAction('Remove service'), 'remove service control');
  await eventually(() => !registered(), 'service removed');
  console.log('Services registered and removed a loopback service, granted and revoked access, and rejected a non-loopback target');
  assert.equal(await evaluate(`
    (async () => {
      const pending = window.lanvory.startPairing(${JSON.stringify(loopback.name)}, '192.168.1.42:43110', '${testPeer}');
      await window.lanvory.cancelPairing();
      return pending;
    })();
  `), 'cancelled');
  assert.equal(await evaluate(`
    window.lanvory.startPairing(${JSON.stringify(loopback.name)}, '192.168.1.42:43110', '${testPeer}')
  `), 'failed', 'after cancellation the next request reaches scope validation');
  console.log('Pairing cancellation stopped the local request and released its slot');
  await evaluate(`[...document.querySelectorAll('nav button')].find(button => button.textContent === 'Settings').click()`);
  await eventually(() => evaluate(`
    (() => {
      const summary = [...document.querySelectorAll('summary')].find(item => item.textContent === 'Permission activity');
      if (!summary) return false;
      summary.click();
      return true;
    })();
  `), 'permission activity panel');
  await eventually(() => evaluate(`
    (() => {
      const rows = [...document.querySelectorAll('.permission-events li strong')].map(item => item.textContent);
      return rows[0] === 'revoked · service-connect / ${bridgeID}'
        && rows[1] === 'granted · service-connect / ${bridgeID}'
        && rows[2] === 'revoked · file-receive / inbox'
        && rows[3] === 'granted · file-receive / inbox';
    })();
  `), 'permission events newest first');
  console.log('Settings displayed the actual Inbox and Bridge audit events in daemon order');
  window.close();
  assert.equal(window.isDestroyed(), false, 'closing the window should retain its renderer');
  assert.equal(window.isVisible(), false, 'closing the window should hide it');
  assert.equal(daemonOnline(), true, 'hiding the window should leave daemon available');

  app.emit('activate');
  await eventually(() => window.isVisible(), 'reopened window');
  assert.equal(BrowserWindow.getAllWindows()[0], window, 'activation should reuse the same window');
  console.log('Native close hid the window and activation restored it');
  if (!externalMode) {
    const ownedPid = () => {
      try {
        return Number(execFileSync('/usr/bin/pgrep', ['-P', String(process.pid), '-x', 'lanvoryd'], { encoding: 'utf8' }).trim());
      } catch {
        return 0;
      }
    };
    const previous = ownedPid();
    assert.ok(previous > 0, 'identified app-owned daemon');
    process.kill(previous, 'SIGKILL');
    await eventually(() => ownedPid() > 0 && ownedPid() !== previous && daemonOnline(), 'owned daemon recovered after crash');
    const recovered = JSON.parse(execFileSync(path.join(bin, 'lanvory'), ['identity'], { encoding: 'utf8' }));
    assert.equal(recovered.fingerprint, initial.fingerprint, 'recovery retains the local identity');
    assert.equal((await evaluate('window.lanvory.listenerStatus()')).state, 'local-only', 'recovery starts in local-only mode');
    console.log('App-owned daemon recovered after a crash with the same identity and LAN off');
  }
  // Simulate a change from System Settings without registering an OS login item.
  let loginItemState = 'requires-approval';
  ipcMain.removeHandler('lanvory:login-item');
  ipcMain.handle('lanvory:login-item', () => loginItemState);
  const focusSettings = () => evaluate('window.dispatchEvent(new Event("focus"))');
  await focusSettings();
  await eventually(() => evaluate(`
    document.querySelector('#settings-loginItem')?.getAttribute('aria-checked') === 'true'
      && document.querySelector('.settings-options [role=status]')?.textContent.includes('Allow Lanvory')
  `), 'login item approval status');
  loginItemState = 'disabled';
  await focusSettings();
  await eventually(() => evaluate(`
    document.querySelector('#settings-loginItem')?.getAttribute('aria-checked') === 'false'
      && !document.querySelector('.settings-options [role=status]')?.textContent.includes('Allow Lanvory')
  `), 'login item status refreshed after focus');
  console.log('Settings refreshed simulated login item approval on focus');
  // Exercise the renderer's already-paired branch without contacting a remote host.
  let pairingStarts = 0;
  const matchEndpoint = '192.168.1.42:43110';
  for (const [channel, handler] of [
    ['lanvory:interfaces', () => ['test0', 'test1'].map((name, index) => ({
      index: index + 1, name, up: true, loopback: false,
      multicast: true, approved: true, eligible: true, addresses: [`192.168.1.${10 + index}/24`],
    }))],
    ['lanvory:check-scope', () => ({ allowed: true })],
    ['lanvory:match-trusted-peer', (_event, adapter, endpoint) => adapter === 'test0' && endpoint === matchEndpoint ? testPeer : null],
    ['lanvory:pairing-start', () => { pairingStarts++; return 'failed'; }],
  ]) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, handler);
  }
  await evaluate(`[...document.querySelectorAll('nav button')].find(button => button.textContent === 'Devices').click()`);
  await eventually(() => evaluate(`
    (() => {
      const manual = document.querySelector('.pairing-manual');
      const id = manual?.querySelector('input[name=fingerprint]');
      if (!id) return false;
      manual.open = true;
      const data = new DataTransfer();
      data.setData('text/plain', ${JSON.stringify(`Lanvory pairing\nAddress: ${matchEndpoint}\nDevice ID: ${testPeer}`)});
      id.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
      return true;
    })()
  `), 'fill manual pairing with the verified device');
  await eventually(() => evaluate(`
    (() => {
      const manual = document.querySelector('.pairing-manual');
      return manual?.querySelector('[data-field=adapter]')?.textContent.includes('Choose a local adapter')
        && manual.querySelector('button[type=submit]')?.disabled;
    })()
  `), 'Pair Device requires a choice between two approved adapters');
  await selectOption('.pairing-manual [data-field=adapter]', 'test0');
  await eventually(() => evaluate(`
    (() => {
      const button = document.querySelector('.pairing-manual button[type=submit]');
      if (!button || button.disabled) return false;
      button.click();
      return true;
    })()
  `), 'submit the already-paired device');
  await eventually(() => evaluate(`
    document.querySelector('.pairing-panel')?.textContent.includes('Already paired. Connection details updated.')
      || document.body.textContent.includes('Already paired. Connection details updated.')
  `), 'verified device updates connection details');
  assert.equal(pairingStarts, 0, 'a verified paired device does not start pairing');
  const savedRoute = await evaluate(`
    JSON.parse(localStorage.getItem(${JSON.stringify(`lanvory.peer-routes.${initial.id}`)}))[${JSON.stringify(testPeer)}]
  `);
  assert.equal(savedRoute.endpoint, matchEndpoint);
  assert.equal(savedRoute.adapter, 'test0');
  ipcMain.removeHandler('lanvory:interfaces');
  ipcMain.handle('lanvory:interfaces', () => [
    { index: 7, name: 'local0', up: true, loopback: false, multicast: true,
      approved: true, eligible: true, addresses: ['192.168.1.10/24'] },
    { index: 8, name: 'test0', up: true, loopback: false, multicast: true,
      approved: true, eligible: true, addresses: ['10.20.30.10/24'] },
  ]);
  let allowAllAdapters = false;
  ipcMain.removeHandler('lanvory:check-scope');
  ipcMain.handle('lanvory:check-scope', (_event, adapter, address) => ({
    allowed: allowAllAdapters || (adapter === 'local0' && address === '192.168.1.42'),
  }));
  await evaluate(`[...document.querySelectorAll('nav button')].find(button => button.textContent === 'Sharing').click()`);
  await eventually(() => evaluate(`
    (() => {
      const form = document.querySelector('.sharing-panel .operation-highlight form');
      if (!form) return false;
      const data = new FormData(form);
      return data.get('fingerprint') === '${testPeer}'
        && data.get('endpoint') === '${matchEndpoint}'
        && data.get('adapter') === 'local0'
        && !form.textContent.includes('test0');
    })()
  `), 'Sharing selects the current machine adapter for the saved peer address');
  await evaluate(`[...document.querySelectorAll('nav button')].find(button => button.textContent === 'Services').click()`);
  await eventually(() => evaluate(`
    (() => {
      const form = document.querySelector('.services-connection')?.closest('form');
      if (!form) return false;
      const data = new FormData(form);
      return data.get('endpoint') === '${matchEndpoint}'
        && data.get('adapter') === 'local0'
        && !form.textContent.includes('test0')
        && form.elements.namedItem('endpoint').labels[0].textContent.includes('sharing device')
        && form.querySelector('label[for="' + form.querySelector('[data-field=adapter]').id + '"]').textContent.includes('this device')
        && form.elements.namedItem('bind').labels[0].textContent.includes('this device')
        && data.get('bind') === '127.0.0.1:0';
    })()
  `), 'Services distinguishes the sharing device from this device and preserves submitted addresses').catch(async (error) => {
    const state = await evaluate(`
      (() => {
        const form = document.querySelector('.services-connection')?.closest('form');
        return {
          servicesVisible: Boolean(document.querySelector('.services-panel')),
          formPresent: Boolean(form),
          addressMatches: form ? new FormData(form).get('endpoint') === '${matchEndpoint}' : false,
          adapterMatches: form ? new FormData(form).get('adapter') === 'local0' : false,
          staleAdapterVisible: form?.textContent.includes('test0') ?? false,
        };
      })()
    `);
    throw new Error(`${error.message}: ${JSON.stringify(state)}`, { cause: error });
  });
  allowAllAdapters = true;
  await evaluate(`
    (() => {
      const input = document.querySelector('.services-connection')?.closest('form')?.elements.namedItem('endpoint');
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setValue.call(input, '192.168.1.43:43110');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()
  `);
  await eventually(() => evaluate(`
    (() => {
      const form = document.querySelector('.services-connection')?.closest('form');
      const adapter = form?.querySelector('[data-field=adapter]');
      return adapter && !new FormData(form).get('adapter') && adapter.textContent.includes('Choose a local adapter');
    })()
  `), 'Services requires a choice when multiple local adapters can reach the peer');
  await selectOption('[aria-labelledby=services-heading] [data-field=adapter]', 'test0');
  assert.equal(await evaluate(`
    new FormData(document.querySelector('.services-connection').closest('form')).get('adapter')
  `), 'test0', 'Services submits the local adapter chosen by the user');
  let openCalls = 0;
  ipcMain.removeHandler('lanvory:service-action');
  ipcMain.handle('lanvory:service-action', (_event, action) => {
    if (action === 'open') openCalls++;
    return false;
  });
  allowAllAdapters = false;
  await evaluate(`
    (() => {
      const form = document.querySelector('.services-connection').closest('form');
      form.elements.namedItem('id').value = 'smoke';
      form.requestSubmit();
    })()
  `);
  await eventually(() => evaluate(`
    document.querySelector('.services-panel [role=status]')?.textContent.includes('no longer approved')
  `), 'Services explains a scope change before connecting');
  assert.equal(openCalls, 0, 'Services does not open a tunnel after scope is denied');
  allowAllAdapters = true;
  await evaluate(`[...document.querySelectorAll('nav button')].find(button => button.textContent === 'Sharing').click()`);
  const sharingForm = '.sharing-panel .operation-highlight form';
  await evaluate(`
    (() => {
      const input = document.querySelector('${sharingForm} input[name=endpoint]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '192.168.1.43:43110');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()
  `);
  await eventually(() => evaluate(`
    (() => {
      const form = document.querySelector('${sharingForm}');
      const adapter = form?.querySelector('[data-field=adapter]');
      return adapter?.closest('details')?.open && !new FormData(form).get('adapter')
        && adapter.textContent.includes('Choose a local adapter');
    })()
  `), 'Sharing opens connection details for an explicit adapter choice');
  await selectOption(`${sharingForm} [data-field=adapter]`, 'test0');
  assert.equal(await evaluate(`new FormData(document.querySelector('${sharingForm}')).get('adapter')`), 'test0');
  let sendCalls = 0;
  ipcMain.removeHandler('lanvory:select-file');
  ipcMain.handle('lanvory:select-file', () => 'scope-test.txt');
  ipcMain.removeHandler('lanvory:send-file');
  ipcMain.handle('lanvory:send-file', () => { sendCalls++; return 'failed'; });
  await evaluate(`document.querySelector('${sharingForm} .file-selection button').click()`);
  await eventually(() => evaluate(`
    document.querySelector('${sharingForm} button[type=submit]')?.disabled === false
  `), 'Sharing is ready to send the selected fixture file');
  allowAllAdapters = false;
  await evaluate(`document.querySelector('${sharingForm} button[type=submit]').click()`);
  await eventually(() => evaluate(`
    document.querySelector('.sharing-panel .operation-highlight .sharing-feedback')?.textContent.includes('no longer approved')
  `), 'Sharing explains the scope change before sending');
  assert.equal(sendCalls, 0, 'Sharing does not call send-file after scope is denied');
  assert.equal(await evaluate(`document.querySelector('${sharingForm} .file-selection span').textContent`), 'scope-test.txt');
  console.log('Sharing and Services selected the sole current adapter that can reach the peer and ignored the stale saved adapter name');
  console.log('Services required an explicit choice when multiple current adapters could reach the peer');
  app.quit();
}

verify().catch((err) => {
  failure = err;
  app.quit();
});
