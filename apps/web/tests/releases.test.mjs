import assert from 'node:assert/strict'
import test from 'node:test'
import { githubUrl, readMacRelease } from '../src/lib/releases.ts'

const version = '0.42.3'
const tag = `v${version}`
const downloads = `${githubUrl}/releases/download/${tag}`
const release = {
  tag_name: tag,
  draft: false,
  prerelease: false,
  assets: ['arm64', 'x64'].map((architecture) => {
    const name = `Lanvory-${version}-${architecture}.dmg`
    return { name, browser_download_url: `${downloads}/${name}`, state: 'uploaded' }
  }),
}

test('maps the published tag to both DMG links and release notes', () => {
  assert.deepEqual(readMacRelease(release), {
    tag,
    arm64: `${downloads}/Lanvory-${version}-arm64.dmg`,
    x64: `${downloads}/Lanvory-${version}-x64.dmg`,
    notesUrl: `${githubUrl}/releases/tag/${tag}`,
  })
})

test('rejects missing, unpublished, or inconsistent release data', () => {
  assert.equal(readMacRelease(null), null)
  assert.equal(readMacRelease({ ...release, prerelease: true }), null)
  assert.equal(readMacRelease({ ...release, draft: true }), null)
  assert.equal(readMacRelease({ ...release, tag_name: 'v0.42.4' }), null)
  assert.equal(readMacRelease({ ...release, assets: release.assets.slice(0, 1) }), null)
  assert.equal(readMacRelease({
    ...release,
    assets: [{ ...release.assets[0], browser_download_url: 'https://example.com/download.dmg' }, release.assets[1]],
  }), null)
})
