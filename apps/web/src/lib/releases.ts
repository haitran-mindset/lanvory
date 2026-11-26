export const githubRepository = 'haitran-mindset/lanvory'
export const githubUrl = `https://github.com/${githubRepository}`
export const latestReleaseUrl = `${githubUrl}/releases/latest`

type GitHubRelease = {
  tag_name?: unknown
  draft?: unknown
  prerelease?: unknown
  assets?: unknown
}

export function readMacRelease(release: GitHubRelease | null | undefined) {
  if (!release) return null
  const tag = release.tag_name
  if (
    typeof tag !== 'string' || !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag) ||
    release.draft !== false || release.prerelease !== false || !Array.isArray(release.assets)
  ) return null

  const assets = release.assets
  const download = (architecture: 'arm64' | 'x64') => {
    const name = `Lanvory-${tag.slice(1)}-${architecture}.dmg`
    const url = `${githubUrl}/releases/download/${tag}/${name}`
    return assets.some(
      (asset) => asset?.name === name && asset.state === 'uploaded' && asset.browser_download_url === url,
    ) ? url : null
  }

  const arm64 = download('arm64')
  const x64 = download('x64')
  if (!arm64 || !x64) return null

  return { tag, arm64, x64, notesUrl: `${githubUrl}/releases/tag/${tag}` }
}

export async function fetchMacRelease(signal: AbortSignal) {
  try {
    const response = await fetch(`https://api.github.com/repos/${githubRepository}/releases/latest`, {
      credentials: 'omit',
      signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]),
    })
    return response.ok ? readMacRelease(await response.json()) : null
  } catch {
    return null
  }
}
