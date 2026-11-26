export const githubRepository = 'haitran-mindset/lanvory'
export const githubUrl = `https://github.com/${githubRepository}`
export const latestReleaseUrl = `${githubUrl}/releases/latest`

const CACHE_TTL_MS = 15 * 60 * 1000
const COOLDOWN_KEY = 'lanvory_gh_api_cooldown_until'

export function isGitHubApiInCooldown() {
  try {
    const raw = window.localStorage.getItem(COOLDOWN_KEY)
    return raw ? Number(raw) > Date.now() : false
  } catch {
    return false
  }
}

export function markGitHubApiCooldown() {
  try {
    window.localStorage.setItem(COOLDOWN_KEY, String(Date.now() + CACHE_TTL_MS))
  } catch {
    // Ignore storage errors in restricted contexts.
  }
}

export function readCachedJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { expiresAt?: number; value?: T }
    if (!parsed || typeof parsed.expiresAt !== 'number' || parsed.expiresAt < Date.now()) return null
    return parsed.value ?? null
  } catch {
    return null
  }
}

export function writeCachedJson<T>(key: string, value: T) {
  try {
    window.localStorage.setItem(key, JSON.stringify({ expiresAt: Date.now() + CACHE_TTL_MS, value }))
  } catch {
    // Ignore storage errors in restricted contexts.
  }
}

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
  const cacheKey = `lanvory_gh_release_${githubRepository}`
  const cached = readCachedJson<ReturnType<typeof readMacRelease>>(cacheKey)
  if (cached) return cached
  if (isGitHubApiInCooldown()) return null

  try {
    const response = await fetch(`https://api.github.com/repos/${githubRepository}/releases/latest`, {
      credentials: 'omit',
      signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]),
    })
    if (response.status === 403 || response.status === 429) {
      markGitHubApiCooldown()
      return null
    }
    if (!response.ok) return null
    const parsed = readMacRelease(await response.json())
    if (parsed) writeCachedJson(cacheKey, parsed)
    return parsed
  } catch {
    return null
  }
}
