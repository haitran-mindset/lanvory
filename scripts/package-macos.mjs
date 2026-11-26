import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { packager } from '@electron/packager';

const exec = promisify(execFile);
const repo = fileURLToPath(new URL('../', import.meta.url));
const desktop = path.join(repo, 'apps', 'desktop');
const arch = process.env.LANVORY_MAC_ARCH || process.arch;
const dmg = process.argv[2] === '--dmg';
if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(arch)) {
  throw new Error('Packaging requires macOS and an arm64 or x64 target.');
}
if (process.argv.length > 2 && (!dmg || process.argv.length > 3)) {
  throw new Error('Usage: node scripts/package-macos.mjs [--dmg]');
}

async function sha256(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

function packageURL(type, name, version) {
  const coordinate = name.split('/').map(encodeURIComponent).join('/');
  return `pkg:${type}/${coordinate}@${encodeURIComponent(version)}`;
}

const desktopManifest = JSON.parse(await readFile(path.join(desktop, 'package.json'), 'utf8'));
const electronPackage = path.join(desktop, 'node_modules', 'electron');
const { version: electronVersion } = JSON.parse(await readFile(path.join(electronPackage, 'package.json'), 'utf8'));
const zipDir = process.env.LANVORY_ELECTRON_ZIP_DIR;
if (zipDir) {
  const zip = `electron-v${electronVersion}-darwin-${arch}.zip`;
  const checksums = JSON.parse(await readFile(path.join(electronPackage, 'checksums.json'), 'utf8'));
  if (!checksums[zip] || await sha256(path.join(zipDir, zip)) !== checksums[zip]) {
    throw new Error('The local Electron archive does not match the pinned Electron checksum.');
  }
}

const binaryDir = path.resolve(process.env.LANVORY_MAC_BIN_DIR || path.join(repo, 'bin'));
const binaries = ['lanvoryd', 'lanvory'].map((name) => path.join(binaryDir, name));
const nearbyBinary = path.join(binaryDir, 'lanvory-nearby');
let hasNearbyBinary = false;
try {
  await access(nearbyBinary);
  hasNearbyBinary = true;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const packagedBinaries = hasNearbyBinary ? [...binaries, nearbyBinary] : binaries;
const expectedArch = arch === 'x64' ? 'x86_64' : arch;
async function verifyArchitecture(binary) {
  const { stdout } = await exec('/usr/bin/lipo', ['-archs', binary]);
  if (stdout.trim() !== expectedArch) {
    throw new Error(`${path.basename(binary)} must be built for ${expectedArch} before packaging.`);
  }
}
for (const binary of packagedBinaries) await verifyArchitecture(binary);

const identity = process.env.LANVORY_MAC_SIGN_IDENTITY || '-';
const releases = path.join(repo, 'dist', 'macos');
await mkdir(releases, { recursive: true });
const output = await mkdtemp(path.join(releases, `${desktopManifest.version}-${arch}-`));
const staging = await mkdtemp(path.join(os.tmpdir(), 'lanvory-packager-'));
let successful = false;
try {
  const content = path.join(staging, 'application');
  await mkdir(content);
  await cp(path.join(desktop, 'dist'), path.join(content, 'dist'), { recursive: true });
  await mkdir(path.join(content, 'src'));
  for (const directory of ['main', 'preload']) {
    await cp(path.join(desktop, 'src', directory), path.join(content, 'src', directory), { recursive: true });
  }
  await mkdir(path.join(content, 'assets'));
  for (const trayAsset of ['trayTemplate.png', 'trayTemplate@2x.png']) {
    await cp(path.join(desktop, 'assets', trayAsset), path.join(content, 'assets', trayAsset));
  }
  await writeFile(path.join(content, 'package.json'), JSON.stringify({
    name: 'lanvory',
    productName: 'Lanvory',
    version: desktopManifest.version,
    main: desktopManifest.main,
  }));

  const notices = path.join(staging, 'Notices');
  await mkdir(notices);
  const npmComponents = new Map();
  async function copyPackageNotice(name, resolve) {
    let folder = path.dirname(resolve.resolve(name));
    for (;;) {
      const manifestPath = path.join(folder, 'package.json');
      let manifest;
      try {
        manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (manifest?.name === name) {
        const key = `${name}@${manifest.version}`;
        if (npmComponents.has(key)) return;
        npmComponents.set(key, { type: 'library', name, version: manifest.version });
        const label = /^[a-z0-9-]+$/.test(name) ? name : name.replace(/[^a-zA-Z0-9_.-]/g, '_');
        const filename = name.startsWith('@') ? `${label}-${manifest.version}.txt` : `${label}.txt`;
        const files = await readdir(folder);
        const license = files.find((file) => /^license(?:\.txt|\.md)?$/i.test(file));
        // Some registry tarballs omit the notice published in their upstream repository.
        const licensePath = license
          ? path.join(folder, license)
          : path.join(repo, 'scripts', 'notices', `${label}-${manifest.version}.txt`);
        await cp(licensePath, path.join(notices, filename));
        for (const extra of files.filter((file) => /^(?:notice|copyrightnotice)(?:\.txt|\.md)?$/i.test(file))) {
          await cp(path.join(folder, extra), path.join(notices, `${filename.slice(0, -4)}-${extra}`));
        }
        const resolveNested = createRequire(manifestPath);
        for (const dependency of Object.keys(manifest.dependencies ?? {})) {
          await copyPackageNotice(dependency, resolveNested);
        }
        return;
      }
      const parent = path.dirname(folder);
      if (parent === folder) throw new Error(`Cannot locate notice sources for ${name}.`);
      folder = parent;
    }
  }
  const resolveDesktop = createRequire(path.join(desktop, 'package.json'));
  for (const name of Object.keys(desktopManifest.dependencies)) {
    await copyPackageNotice(name, resolveDesktop);
  }
  const goRoot = process.env.LANVORY_GO_ROOT || (await exec('go', ['env', 'GOROOT'])).stdout.trim();
  await cp(path.join(goRoot, 'LICENSE'), path.join(notices, 'Go.txt'));

  const go = path.join(goRoot, 'bin', 'go');
  const linked = new Map();
  const goVersions = new Set();
  for (const binary of binaries) {
    const { stdout } = await exec(go, ['version', '-m', binary]);
    const [header, ...lines] = stdout.split('\n');
    const runtimeVersion = /: (go\S+)$/.exec(header)?.[1];
    if (!runtimeVersion) throw new Error('Cannot identify the embedded Go runtime version.');
    goVersions.add(runtimeVersion);
    for (const line of lines) {
      const [, kind, name, version] = line.split('\t');
      if (kind === 'dep') linked.set(name, version);
    }
  }
  for (const [name, version] of linked) {
    const { stdout } = await exec(go, ['list', '-m', '-json', name], { cwd: path.join(repo, 'core') });
    const module = JSON.parse(stdout);
    if (!module.Dir || module.Version !== version || module.Replace) {
      throw new Error(`Cannot verify notice sources for ${name}@${version}.`);
    }
    const label = name.replace(/[^a-zA-Z0-9_.-]/g, '_');
    await cp(path.join(module.Dir, 'LICENSE'), path.join(notices, `${label}.txt`));
    for (const extra of ['NOTICE', 'PATENTS']) {
      try {
        await cp(path.join(module.Dir, extra), path.join(notices, `${label}-${extra}.txt`));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  for (const noticeFile of await readdir(notices)) {
    await chmod(path.join(notices, noticeFile), 0o644);
  }

  const [bundleFolder] = await packager({
    dir: content,
    name: 'Lanvory',
    icon: path.join(desktop, 'assets', 'icon.icns'),
    appVersion: desktopManifest.version,
    appBundleId: 'local.lanvory.desktop',
    platform: 'darwin',
    arch,
    electronVersion,
    out: output,
    electronZipDir: zipDir,
    asar: true,
    prune: false,
    extraResource: [...packagedBinaries, notices],
    afterCopyExtraResources: [async ({ buildPath }) => {
      const destination = path.join(buildPath, 'Lanvory.app', 'Contents', 'Resources', 'Notices');
      await cp(path.join(buildPath, 'LICENSE'), path.join(destination, 'Electron.txt'));
      await cp(path.join(buildPath, 'LICENSES.chromium.html'), path.join(destination, 'Chromium.html'));
    }],
    extendInfo: {
      NSLocalNetworkUsageDescription: 'Lanvory uses your local network to discover and connect to approved devices.',
      NSBluetoothAlwaysUsageDescription: 'Lanvory uses Bluetooth and peer-to-peer Wi-Fi to discover nearby devices.',
      NSBonjourServices: ['_lanvory._tcp', '_lanvory._udp'],
    },
    osxSign: {
      identity,
      continueOnError: false,
      ...(identity === '-' ? {
        identityValidation: false,
        preAutoEntitlements: false,
        optionsForFile: () => ({ hardenedRuntime: false, timestamp: 'none' }),
      } : {}),
    },
  });

  const application = path.join(bundleFolder, 'Lanvory.app');
  await verifyArchitecture(path.join(application, 'Contents', 'MacOS', 'Lanvory'));
  await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', application]);
  if (identity === '-') {
    const { stderr } = await exec('/usr/bin/codesign', ['--display', '--verbose=4', application]);
    if (/flags=[^\n]*\bruntime\b/.test(stderr)) {
      throw new Error('The ad hoc app unexpectedly retained hardened runtime signing.');
    }
  }

  const nativeComponents = [];
  for (const binary of packagedBinaries) {
    const name = path.basename(binary);
    const embedded = path.join(application, 'Contents', 'Resources', name);
    await exec('/usr/bin/codesign', ['--verify', '--strict', embedded]);
    nativeComponents.push({
      type: 'application', name, version: desktopManifest.version,
      hashes: [{ alg: 'SHA-256', content: await sha256(embedded) }],
    });
  }
  const sbomPath = path.join(output, `Lanvory-${desktopManifest.version}-${arch}.cdx.json`);
  const metadata = {
    timestamp: new Date().toISOString(),
    lifecycles: [{ phase: 'post-build' }],
    component: { type: 'application', name: 'Lanvory', version: desktopManifest.version },
    properties: [{ name: 'lanvory:target', value: `darwin-${arch}` }],
  };
  const components = [
    ...nativeComponents,
    { type: 'framework', name: 'Electron', version: electronVersion, purl: packageURL('npm', 'electron', electronVersion) },
    ...[...goVersions].map((version) => ({ type: 'framework', name: 'Go runtime', version })),
    ...[...linked].map(([name, version]) => ({
      type: 'library', name, version, group: 'Go', purl: packageURL('golang', name.toLowerCase(), version),
    })),
    ...[...npmComponents.values()].map((component) => ({
      ...component, group: 'npm', purl: packageURL('npm', component.name, component.version),
    })),
  ];
  const sbom = { bomFormat: 'CycloneDX', specVersion: '1.6', serialNumber: `urn:uuid:${randomUUID()}`, version: 1, metadata, components };
  await writeFile(sbomPath, `${JSON.stringify(sbom, null, 2)}\n`);
  console.log(`SBOM: ${sbomPath}`);
  if (dmg) {
    const imageRoot = path.join(staging, 'image');
    await mkdir(imageRoot);
    await exec('/usr/bin/ditto', [application, path.join(imageRoot, 'Lanvory.app')]);
    await symlink('/Applications', path.join(imageRoot, 'Applications'));
    const image = path.join(output, `Lanvory-${desktopManifest.version}-${arch}.dmg`);
    await exec('/usr/bin/hdiutil', ['create', '-srcfolder', imageRoot, '-volname', 'Lanvory', '-format', 'UDZO', image]);
    if (identity !== '-') {
      await exec('/usr/bin/codesign', ['--sign', identity, '--timestamp', image]);
      await exec('/usr/bin/codesign', ['--verify', '--strict', image]);
    }
    await exec('/usr/bin/hdiutil', ['verify', image]);
    await writeFile(`${image}.sha256`, `${await sha256(image)}  ${path.basename(image)}\n`);
    console.log(`Disk image: ${image}`);
  }
  console.log(`App bundle: ${application}`);
  successful = true;
} finally {
  await rm(staging, { recursive: true, force: true });
  if (!successful) await rm(output, { recursive: true, force: true });
}
