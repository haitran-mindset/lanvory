import { useEffect, useRef, useState } from 'react'
import {
  ArrowDownToLine, ArrowRight, ArrowUpRight, Check, ChevronDown, Copy, Github,
  Layers3, Play, ShieldCheck, Square, Star, Terminal, Zap, ZoomIn,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { fetchMacRelease, githubRepository, githubUrl, latestReleaseUrl } from '@/lib/releases'
import { copy, features, securityControls, technicalArchitecture } from './content'

const sectionIds = ['why', 'features', 'how', 'security', 'architecture', 'roadmap']
const macQuarantineCommand = 'xattr -cr /Applications/Lanvory.app'
const starCountFormat = new Intl.NumberFormat('en')
const desktopPreviewUrl = `${import.meta.env.BASE_URL}images/desktop-preview-1644.webp`

function Brand() {
  return (
    <a href="#top" className="inline-flex items-center gap-2.5 text-xl font-bold tracking-tight">
      <span className="brand-mark" aria-hidden="true" />
      Lanvory
    </a>
  )
}

function GitHubStar() {
  const [stars, setStars] = useState<number | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function loadStars() {
      try {
        const response = await fetch(`https://api.github.com/repos/${githubRepository}`, {
          signal: controller.signal,
        })
        if (!response.ok) return

        const repository = await response.json()
        const count: unknown = repository?.stargazers_count
        if (!controller.signal.aborted && typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) {
          setStars(count)
        }
      } catch {
        // The GitHub link remains usable if the count is unavailable.
      }
    }

    void loadStars()
    return () => controller.abort()
  }, [])

  const count = stars === null ? null : starCountFormat.format(stars)

  return (
    <Button asChild variant="outline" className="min-h-9 gap-1.5 px-2.5 text-xs">
      <a href={githubUrl} aria-label={count === null ? 'Star Lanvory on GitHub' : `Star Lanvory on GitHub (${count} ${stars === 1 ? 'star' : 'stars'})`}>
        <Star className="fill-yellow-400 text-yellow-400" data-icon="inline-start" aria-hidden="true" />
        Star
        {count !== null && <span className="border-l border-border pl-1.5 tabular-nums">{count}</span>}
      </a>
    </Button>
  )
}

function DemoMedia({
  demo, title, alt, width, height, isPlaying, onToggle,
}: {
  demo: string
  title: string
  alt: string
  width: number
  height: number
  isPlaying: boolean
  onToggle: () => void
}) {
  const imageUrl = `${import.meta.env.BASE_URL}demos/${demo}.${isPlaying ? 'gif' : 'png'}`
  const PlaybackIcon = isPlaying ? Square : Play

  return (
    <>
      <img
        src={imageUrl}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        className="h-auto w-full rounded-lg border border-border"
      />
      <Button
        type="button"
        variant="outline"
        className="mt-3"
        aria-label={`${isPlaying ? 'Stop' : 'Play'} demo: ${title}`}
        onClick={onToggle}
      >
        <PlaybackIcon data-icon="inline-start" aria-hidden="true" />
        {isPlaying ? 'Stop demo' : 'Play demo'}
      </Button>
    </>
  )
}

type ArchitectureNode =
  | (typeof technicalArchitecture.connection)[number]['nodes'][number]
  | (typeof technicalArchitecture.resources)[number]

function ArchitectureLink({ technology, icon: Icon, description, link }: ArchitectureNode) {
  return (
    <a
      className="group grid h-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5 rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/60 hover:bg-selected"
      href={`${githubUrl}/blob/main/${link}`}
    >
      <span className="grid size-8 place-items-center rounded-md border border-border bg-background text-primary">
        <Icon size={16} aria-hidden="true" />
      </span>
      <div>
        <span className="text-sm font-semibold">{technology}</span>
        <p>{description}</p>
      </div>
      <ArrowUpRight size={14} className="mt-0.5 text-muted-foreground group-hover:text-primary" aria-hidden="true" />
    </a>
  )
}

export function App() {
  const [activeDemo, setActiveDemo] = useState<string | null>(null)
  const [macRelease, setMacRelease] = useState<Awaited<ReturnType<typeof fetchMacRelease>>>(null)

  useEffect(() => {
    const controller = new AbortController()
    void fetchMacRelease(controller.signal).then((release) => {
      if (!controller.signal.aborted) setMacRelease(release)
    })
    return () => controller.abort()
  }, [])
  const [copiedQuarantine, setCopiedQuarantine] = useState(false)
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const headerRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const header = headerRef.current
    if (!header) return

    const rootStyle = document.documentElement.style
    const sections = Array.from(document.querySelectorAll('#main > section[id]')).reverse()
    let frame = 0
    const updateNavigation = () => {
      frame = 0
      header.toggleAttribute('data-scrolled', window.scrollY > 0)

      const readingLine = header.offsetHeight + 48
      const section = sections.find((item) => item.getBoundingClientRect().top <= readingLine)
      const id = section?.id === 'quick-start' ? 'how' : section?.id
      setActiveSection(id && sectionIds.includes(id) ? id : null)
    }
    const scheduleNavigationUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(updateNavigation)
    }
    const updateHeaderHeight = () => {
      rootStyle.setProperty('--site-header-height', `${header.offsetHeight}px`)
      scheduleNavigationUpdate()
    }

    updateHeaderHeight()
    const observer = new ResizeObserver(updateHeaderHeight)
    observer.observe(header)
    window.addEventListener('scroll', scheduleNavigationUpdate, { passive: true })
    window.addEventListener('resize', scheduleNavigationUpdate)
    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', scheduleNavigationUpdate)
      window.removeEventListener('resize', scheduleNavigationUpdate)
      rootStyle.removeProperty('--site-header-height')
    }
  }, [])

  function toggleDemo(demo: string) {
    setActiveDemo((current) => current === demo ? null : demo)
  }

  async function copyQuarantineCommand() {
    try {
      await navigator.clipboard.writeText(macQuarantineCommand)
      setCopiedQuarantine(true)
      window.setTimeout(() => setCopiedQuarantine(false), 2000)
    } catch {
      // Clipboard API may be unavailable in restricted contexts.
    }
  }

  return (
    <div id="top">
      <a className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-30 focus:bg-background focus:p-3" href="#main">
        {copy.skip}
      </a>
      <a className="announcement flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2.5 text-center text-xs" href="#roadmap">
        <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
        <span>{macRelease ? `Lanvory ${macRelease.tag} is available for macOS` : 'Lanvory for macOS'}</span>
        <span className="inline-flex items-center gap-1 text-foreground underline underline-offset-4">
          {copy.nav[5]} <ArrowUpRight size={13} aria-hidden="true" />
        </span>
      </a>

      <header ref={headerRef} className="site-header-bar">
        <div className="shell site-header">
          <Brand />
          <nav aria-label="Main navigation" className="site-nav">
            {copy.nav.map((label, index) => (
              <a
                key={sectionIds[index]}
                href={`#${sectionIds[index]}`}
                aria-current={activeSection === sectionIds[index] ? 'location' : undefined}
              >
                {label}
              </a>
            ))}
          </nav>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <a className="inline-flex items-center gap-2 text-sm hover:text-primary" href={githubUrl}>
              <Github size={16} aria-hidden="true" /> GitHub
            </a>
            <GitHubStar />
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="shell">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-kicker flex flex-wrap items-baseline gap-x-4 gap-y-2 text-sm text-muted-foreground">
            <span className="font-bold text-primary">lanvory</span>
            <span>{copy.tagline}</span>
          </div>
          <div className="hero-grid">
            <h1 id="hero-title">
              {copy.headline[0]} <em>{copy.headline[1]}</em>
            </h1>
            <div className="hero-copy">
              <p>{copy.intro}</p>
              <ul className="mt-5 grid gap-2 text-sm">
                {copy.checks.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <Check size={17} className="shrink-0 text-primary" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild>
              <a href="#download"><ArrowDownToLine data-icon="inline-start" aria-hidden="true" /> {copy.download}</a>
            </Button>
            <Button asChild variant="outline">
              <a href="#how">{copy.nav[2]} <ArrowRight data-icon="inline-end" aria-hidden="true" /></a>
            </Button>
          </div>
          <p className="mt-2.5 text-xs text-muted-foreground">
            {macRelease ? `${macRelease.tag} · Apple Silicon and Intel` : 'Apple Silicon and Intel'}
          </p>

          <ul className="mt-7 flex flex-wrap gap-2.5 text-xs">
            {features.slice(0, 5).map(({ id, title }) => (
              <li key={id}>
                <a className="feature-tag inline-block hover:border-primary hover:text-primary" href={`#${id}`}>{title}</a>
              </li>
            ))}
          </ul>

          <figure className="mt-10 sm:mt-12">
            <svg width="0" height="0" className="absolute" aria-hidden="true">
              <filter id="desktop-preview-sharpen" colorInterpolationFilters="sRGB">
                <feConvolveMatrix order={3} kernelMatrix="0 -.18 0 -.18 1.72 -.18 0 -.18 0" preserveAlpha />
              </filter>
            </svg>
            <a
              href={desktopPreviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open the Lanvory desktop preview at full size in a new tab"
              className="group relative block cursor-zoom-in overflow-hidden rounded-xl border border-border"
            >
              <img
                src={desktopPreviewUrl}
                srcSet={`${import.meta.env.BASE_URL}images/desktop-preview-768.webp 768w, ${desktopPreviewUrl} 1644w`}
                sizes="(max-width: 28rem) calc(100vw - 2rem), (max-width: 79rem) calc(100vw - 3rem), 76rem"
                width={1644}
                height={957}
                alt="A MacBook displaying the Lanvory desktop concept with a nearby devices panel."
                decoding="async"
                className="desktop-preview-image h-auto w-full"
              />
              <span className="absolute right-3 bottom-3 grid size-9 place-items-center rounded-lg border border-border bg-background/85 text-muted-foreground group-hover:text-foreground">
                <ZoomIn size={17} aria-hidden="true" />
              </span>
            </a>
          </figure>
        </section>

        <section id="why" className="principles" aria-label={copy.nav[0]}>
          {copy.why.map(([title, description], index) => {
            const Icon = [Layers3, ShieldCheck, Zap][index]
            return (
              <article key={title} className="principle">
                <span className="icon-box"><Icon size={20} aria-hidden="true" /></span>
                <div><h2>{title}</h2><p>{description}</p></div>
              </article>
            )
          })}
        </section>

        <section id="features" className="detail-section">
          <h2>{copy.nav[1]}</h2>
          <p>{copy.featureIntro}</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <article id={feature.id} key={feature.id} className="detail-card target:border-primary">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <feature.icon className="text-primary" size={22} aria-hidden="true" />
                  {'status' in feature && <span className="text-xs text-primary">{feature.status}</span>}
                </div>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
                {'docs' in feature && (
                  <a className="mt-3 inline-flex items-center gap-2 text-xs underline underline-offset-4 hover:text-primary" href={`${githubUrl}/blob/main/${feature.docs}`}>
                    Bluetooth + P2P protocol <ArrowUpRight size={14} aria-hidden="true" />
                  </a>
                )}
              </article>
            ))}
          </div>
        </section>

        <section id="how" className="detail-section">
          <h2>{copy.nav[2]}</h2>
          <p>See what it’s like to send a file to another device with Lanvory.</p>
          <figure className="detail-card mt-6">
            <figcaption className="mb-4">
              <h3>From discovery to delivery</h3>
              <p>Follow Machine A and Machine B as they pair, approve a file, and transfer it over the local network.</p>
            </figcaption>
            <picture>
              <source media="(prefers-reduced-motion: reduce)" srcSet={`${import.meta.env.BASE_URL}demos/overview.png`} />
              <img
                src={`${import.meta.env.BASE_URL}demos/overview.gif`}
                alt="Machine A and Machine B discover each other, pair, approve a file, and verify it after transfer."
                width={960}
                height={384}
                loading="lazy"
                className="h-auto w-full rounded-lg border border-border"
              />
            </picture>
          </figure>
          <ol className="steps mt-6 grid gap-4 md:grid-cols-3">
            {copy.steps.map(({ demo, title, description, alt }, index) => (
              <li key={demo} className="detail-card flex flex-col">
                <span className="step-number" aria-hidden="true">0{index + 1}</span>
                <h3>{title}</h3>
                <p>{description}</p>
                <div className="mt-auto pt-4">
                  <DemoMedia
                    demo={demo}
                    title={title}
                    alt={alt}
                    width={600}
                    height={344}
                    isPlaying={activeDemo === demo}
                    onToggle={() => toggleDemo(demo)}
                  />
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section id="quick-start" className="detail-section" aria-labelledby="quick-start-title">
          <div className="quick-start-layout">
            <div className="quick-start-intro">
              <h2 id="quick-start-title">Quick Start</h2>
              <p>Send your first file between two devices.</p>
              <Button asChild variant="outline" className="mt-5">
                <a href="#how"><Play data-icon="inline-start" aria-hidden="true" /> See the demo</a>
              </Button>
              <img
                src={`${import.meta.env.BASE_URL}images/quick-start.webp`}
                alt="A file travels directly between two laptops."
                width={900}
                height={600}
                loading="lazy"
                decoding="async"
                className="mt-6 h-auto w-full rounded-xl border border-border"
              />
            </div>
            <ol className="quick-start-steps" role="list">
              {copy.quickStart.map(([title, description], index) => (
                <li key={title} className="quick-start-step">
                  <span className="quick-start-number" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <h3>{title}</h3>
                    <p>{description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="security" className="detail-section">
          <h2>{copy.nav[3]}</h2>
          <p className="max-w-3xl">{copy.securityIntro}</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {securityControls.map(({ title, icon: Icon, description }) => (
              <article key={title} className="detail-card">
                <Icon className="mb-4 text-primary" size={22} aria-hidden="true" />
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="architecture" className="detail-section" aria-labelledby="architecture-title">
          <h2 id="architecture-title">Technical Architecture</h2>
          <div className="architecture-diagram mt-6 rounded-xl border border-border">
            <h3 className="architecture-layer-title">Peer connection</h3>
            <ol className="architecture-nodes architecture-connection" aria-label="Peer connection stages" role="list">
              {technicalArchitecture.connection.map(({ stage, nodes }) => (
                <li key={stage} className="architecture-node architecture-stage">
                  <h4>{stage}</h4>
                  <ul className="grid gap-2" role="list">
                    {nodes.map((node) => (
                      <li key={node.technology}><ArchitectureLink {...node} /></li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
            <div className="architecture-branch" aria-hidden="true" />
            <h3 className="architecture-layer-title architecture-resource-title">Resource operations</h3>
            <ul className="architecture-nodes architecture-resources" aria-label="Resource operation technologies" role="list">
              {technicalArchitecture.resources.map((node) => (
                <li key={node.technology} className="architecture-node"><ArchitectureLink {...node} /></li>
              ))}
            </ul>
          </div>
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-3 text-sm">
            <a className="underline underline-offset-4 hover:text-primary" href={`${githubUrl}/blob/main/docs/architecture/overview.md`}>Architecture overview</a>
            <a className="underline underline-offset-4 hover:text-primary" href={`${githubUrl}/blob/main/docs/development/known-limitations.md`}>Known limitations</a>
          </div>
        </section>

        <section id="roadmap" className="detail-section">
          <h2>{copy.nav[5]}</h2>
          <ol className="roadmap-timeline mt-8" role="list">
            {copy.roadmap.map(({ phase, title, description, icon: Icon }) => (
              <li
                key={title}
                className="roadmap-milestone"
                aria-current={phase === 'Current focus' ? 'step' : undefined}
                data-completed={phase === 'Available' ? '' : undefined}
              >
                <span className="roadmap-node" aria-hidden="true">
                  <Icon size={20} />
                  {phase === 'Available' && <span className="roadmap-complete-mark"><Check size={12} strokeWidth={3} /></span>}
                </span>
                <article className="detail-card roadmap-card">
                  <span className="roadmap-phase">{phase}</span>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </article>
              </li>
            ))}
          </ol>
        </section>

        <section id="download" className="detail-section" aria-labelledby="download-title">
          <h2 id="download-title">Download &amp; Compatibility</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {copy.platforms.map(({ id, name, description }) => (
              <article key={id} className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
                <img
                  src={`${import.meta.env.BASE_URL}images/platform-${id}.webp`}
                  alt=""
                  width={720}
                  height={480}
                  loading="lazy"
                  decoding="async"
                  className="h-auto w-full border-b border-border"
                />
                <div className="flex flex-1 flex-col p-5">
                  <h3 className="text-xl">{name}</h3>
                  <p>{description}</p>
                  <div className="mt-auto pt-4">
                    {id === 'macos' ? (
                      macRelease ? (
                        <div className="flex flex-col gap-3">
                          <div className="flex flex-wrap items-center gap-2.5">
                            <Button asChild>
                              <a href={macRelease.arm64} download><ArrowDownToLine data-icon="inline-start" aria-hidden="true" /> Apple Silicon (.dmg)</a>
                            </Button>
                            <Button asChild variant="outline">
                              <a href={macRelease.x64} download><ArrowDownToLine data-icon="inline-start" aria-hidden="true" /> Intel (.dmg)</a>
                            </Button>
                          </div>
                          <a className="text-sm underline underline-offset-4 hover:text-primary" href={macRelease.notesUrl}>
                            Release notes ({macRelease.tag})
                          </a>
                        </div>
                      ) : (
                        <Button asChild variant="outline">
                          <a href={latestReleaseUrl}>View latest release <ArrowUpRight data-icon="inline-end" aria-hidden="true" /></a>
                        </Button>
                      )
                    ) : (
                      <a className="inline-flex items-center gap-2 text-sm underline underline-offset-4 hover:text-primary" href="#roadmap">
                        View roadmap <ArrowUpRight size={15} aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
          {macRelease && (
            <div className="mt-6 rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2.5 text-sm font-semibold">
                <Terminal size={17} className="text-primary" aria-hidden="true" />
                <span>First launch on macOS (unsigned build)</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Current macOS releases are ad-hoc signed and not yet notarized by Apple. After dragging{' '}
                <code className="rounded bg-background px-1.5 py-0.5 text-xs text-foreground">Lanvory.app</code> to{' '}
                <code className="rounded bg-background px-1.5 py-0.5 text-xs text-foreground">Applications</code>, run this command in Terminal before opening the app:
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background px-3.5 py-2.5">
                <code className="text-xs sm:text-sm text-foreground">{macQuarantineCommand}</code>
                <Button type="button" variant="outline" className="min-h-8 px-2.5 text-xs" onClick={copyQuarantineCommand}>
                  {copiedQuarantine ? <Check data-icon="inline-start" aria-hidden="true" /> : <Copy data-icon="inline-start" aria-hidden="true" />}
                  {copiedQuarantine ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>
          )}
        </section>

        <section id="faq" className="detail-section" aria-labelledby="faq-title">
          <h2 id="faq-title">Frequently asked questions</h2>
          <div className="mt-6 max-w-3xl divide-y divide-border rounded-xl border border-border bg-card">
            {copy.faq.map(([question, answer]) => (
              <details key={question} className="group">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold hover:text-primary [&::-webkit-details-marker]:hidden">
                  {question}
                  <ChevronDown className="shrink-0 text-muted-foreground motion-safe:transition-transform group-open:rotate-180" size={17} aria-hidden="true" />
                </summary>
                <p className="px-4 pb-4">{answer}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="shell flex flex-wrap items-center justify-between gap-4 border-t border-border py-7">
        <Brand />
        <nav className="site-nav" aria-label="Support and resources">
          <a href={githubUrl}>GitHub</a>
          <a href={`${githubUrl}#readme`}>Documentation</a>
          <a href={`${githubUrl}/issues`}>Report an issue</a>
          <a href={`${githubUrl}/blob/main/docs/security/threat-model.md`}>Security model</a>
          <a href="#faq">FAQ</a>
          <a href="#architecture">Architecture</a>
        </nav>
        <a className="text-sm text-muted-foreground hover:text-primary" href="#top">{copy.back} ↑</a>
      </footer>
    </div>
  )
}
