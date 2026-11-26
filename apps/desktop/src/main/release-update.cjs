const repository = 'haitran-mindset/lanvory';
const latestReleaseUrl = `https://api.github.com/repos/${repository}/releases/latest`;

function versionParts(version) {
  const match = typeof version === 'string' && /^(0|[1-9]\d{0,15})\.(0|[1-9]\d{0,15})\.(0|[1-9]\d{0,15})$/.exec(version);
  return match ? match.slice(1).map(BigInt) : null;
}

function availableUpdate(release, currentVersion, architecture) {
  if (!['arm64', 'x64'].includes(architecture) || release?.draft !== false || release.prerelease !== false) return null;

  const tag = release.tag_name;
  const version = typeof tag === 'string' && tag.startsWith('v') ? tag.slice(1) : null;
  const latest = versionParts(version);
  const current = versionParts(currentVersion);
  if (!latest || !current || version === currentVersion) return null;

  const differentPart = latest.findIndex((part, index) => part !== current[index]);
  if (differentPart === -1 || latest[differentPart] < current[differentPart]) return null;

  const filename = `Lanvory-${version}-${architecture}.dmg`;
  const url = `https://github.com/${repository}/releases/download/${tag}/${filename}`;
  if (!Array.isArray(release.assets) || !release.assets.some((asset) =>
    asset?.name === filename && asset.state === 'uploaded' && asset.browser_download_url === url
  )) return null;

  return { version, url };
}

async function checkForDesktopUpdate({ currentVersion, architecture, signal, fetchRelease = fetch }) {
  if (!['arm64', 'x64'].includes(architecture) || !versionParts(currentVersion)) return null;

  try {
    const timeout = AbortSignal.timeout(6000);
    const response = await fetchRelease(latestReleaseUrl, {
      headers: { Accept: 'application/vnd.github+json' },
      credentials: 'omit',
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) return null;
    return availableUpdate(await response.json(), currentVersion, architecture);
  } catch {
    // Updates are optional when GitHub is unavailable.
    return null;
  }
}

module.exports = { checkForDesktopUpdate };
