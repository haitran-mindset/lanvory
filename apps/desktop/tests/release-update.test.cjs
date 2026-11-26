const assert = require('node:assert/strict');
const test = require('node:test');
const { checkForDesktopUpdate } = require('../src/main/release-update.cjs');

const releaseBase = 'https://github.com/haitran-mindset/lanvory/releases/download';

function release(version) {
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    assets: ['arm64', 'x64'].map((arch) => {
      const name = `Lanvory-${version}-${arch}.dmg`;
      return { name, state: 'uploaded', browser_download_url: `${releaseBase}/v${version}/${name}` };
    }),
  };
}

function check(value, architecture = 'arm64', currentVersion = '0.9.8') {
  return checkForDesktopUpdate({
    currentVersion,
    architecture,
    fetchRelease: async () => ({ ok: true, json: async () => value }),
  });
}

test('compares numeric versions and selects the correct DMG for both Mac architectures', async () => {
  for (const arch of ['arm64', 'x64']) {
    assert.deepEqual(await check(release('0.10.0'), arch), {
      version: '0.10.0',
      url: `${releaseBase}/v0.10.0/Lanvory-0.10.0-${arch}.dmg`,
    });
  }
  assert.equal(await check(release('0.9.8')), null);
  assert.equal(await check(release('0.9.7')), null);
  assert.equal(await check(release('0.10.0'), 'ia32'), null);
});

test('ignores drafts, prereleases, malformed response, and incomplete or unexpected download assets', async () => {
  const candidate = release('0.10.0');
  assert.equal(await check({ ...candidate, draft: true }), null);
  assert.equal(await check({ ...candidate, prerelease: true }), null);
  assert.equal(await check({ ...candidate, tag_name: 'v0.10.0-beta.1' }), null);
  assert.equal(await check(null), null);
  assert.equal(await check({ ...candidate, assets: candidate.assets.slice(1) }), null);
  assert.equal(await check({ ...candidate, assets: [{ ...candidate.assets[0], state: 'open' }] }), null);
  assert.equal(await check({ ...candidate, assets: [{ ...candidate.assets[0], browser_download_url: 'https://example.com/update.dmg' }] }), null);
});

test('uses the fixed public release endpoint and handles an offline, rate-limited, or cancelled check', async () => {
  const controller = new AbortController();
  const options = { currentVersion: '0.9.8', architecture: 'arm64', signal: controller.signal };
  let requests = 0;
  for (const fail of [
    () => ({ ok: false, status: 403 }),
    () => { throw new Error('offline'); },
    (signal) => {
      controller.abort();
      signal.throwIfAborted();
    },
  ]) {
    assert.equal(await checkForDesktopUpdate({
      ...options,
      fetchRelease: async (url, request) => {
        requests++;
        assert.equal(url, 'https://api.github.com/repos/haitran-mindset/lanvory/releases/latest');
        assert.equal(request.credentials, 'omit');
        assert.equal(request.redirect, 'error');
        return fail(request.signal);
      },
    }), null);
  }
  assert.equal(requests, 3);
});
