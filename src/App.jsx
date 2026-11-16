import { useEffect, useRef, useState } from 'react'
import { asset } from './asset.js'
import AsciiGalaxy from './AsciiGalaxy.jsx'
import HeadStudio from './HeadStudio.jsx'
import PaintHero from './PaintHero.jsx'
import WeatherApp from './WeatherApp.jsx'

// Cards shown in the work grid before "Show more" reveals the rest.
const VISIBLE_PROJECTS = 6

const projects = [
  {
    slug: 'plinth',
    title: 'Plinth',
    info: 'Product / WebGL / 3D modelling',
    image: '/projects/plinth.jpg',
    summary:
      'A 3D modeller that runs in the browser — sketch profiles, extrude and combine solids, then export them as STL, OBJ, GLB or 3MF.',
    kind: 'modeller',
    embed: '/projects/plinth/index.html',
  },
  {
    slug: 'task-boards',
    title: 'Task Boards',
    info: 'Product / Interface / Interaction',
    image: '/projects/task-boards.jpg',
    summary:
      'A kanban and freeform workspace for folding ideas into stages — boards, rows, tags, and drag.',
    kind: 'boards',
    embed: '/projects/task-boards.html',
  },
  {
    slug: 'fenolia',
    title: 'Fenolia',
    info: 'Brand direction / Packaging / Digital',
    image: '/projects/fenolia.jpg',
    summary:
      'A botanical identity carried through packaging, a digital presence, and a quieter product world.',
    gallery: [
      '/projects/fenolia.jpg',
      '/projects/fenolia-2.jpg',
      '/projects/fenolia-3.jpg',
      '/projects/fenolia-4.jpg',
      '/projects/fenolia-5.jpg',
    ],
  },
  {
    slug: 'astro64',
    title: 'Astro64',
    info: 'Interactive / 3D / Experiment',
    summary:
      'A floating astronaut you can pull out of shape. Let go, and it springs back.',
    kind: 'head',
  },
  {
    slug: 'atmo',
    title: 'Atmo',
    info: 'Product / Interface / Live data',
    summary:
      'A live weather surface that shifts with the sky — pick a city and watch rain, fog, snow, and storm lighting follow the forecast.',
    kind: 'weather',
  },
  {
    slug: 'helix',
    title: 'Helix',
    info: 'Interactive / ASCII / Experiment',
    summary:
      'A spiral galaxy drawn in characters — drag to orbit, scroll to zoom, and watch the arms turn.',
    kind: 'galaxy',
  },
  {
    slug: 'edge',
    title: 'EDGE',
    info: 'Website / Brand / Event',
    image: '/projects/edge.jpg',
    summary:
      'A site for Emerging Digital Gaming Expo — three days of demos, makers, and the next wave of play.',
    kind: 'site',
    embed: '/projects/edge/index.html',
    process: {
      kicker: 'Process',
      title: 'From signal to ticket',
      body: [
        'EDGE needed to feel like the floor it promotes — loud enough to cut through, clear enough to book a day without friction. The site leads with a full-bleed hero, then drops into about, agenda, and tickets as one continuous scroll.',
        'Type, colour, and motion borrow from arcade UI without tipping into parody: Pixelify for titles, Space Grotesk for reading, violet on void for atmosphere. The ticket path is a short demo flow — date, pass, checkout — that stops before real payment so the interaction stays the focus.',
      ],
      steps: [
        { label: 'Concept', text: 'Position the expo as a lab of unfinished play, not a trade-show brochure.' },
        { label: 'System', text: 'Lock a pixel-led brand kit and apply it across hero, agenda cards, and ticket UI.' },
        { label: 'Build', text: 'Ship a single-page site plus a calendar-led ticket flow visitors can click through end to end.' },
      ],
    },
    gallery: [
      '/projects/edge.jpg',
      '/projects/edge-2.jpg',
      '/projects/edge-3.jpg',
      '/projects/edge-4.jpg',
      '/projects/edge-5.jpg',
    ],
  },
]

function useHash() {
  const [hash, setHash] = useState(() => window.location.hash)

  useEffect(() => {
    const sync = () => setHash(window.location.hash)
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  return hash
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7 17L17 7M9 7h8v8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M19 12H5M11 6l-6 6 6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ProjectGallery({ images }) {
  const [active, setActive] = useState(null)

  return (
    <ul
      className={active === null ? 'project-gallery' : 'project-gallery is-active'}
      onMouseLeave={() => setActive(null)}
    >
      {images.map((src, index) => (
        <li
          key={src}
          className={
            active === null
              ? 'project-gallery-item'
              : active === index
                ? 'project-gallery-item is-focus'
                : 'project-gallery-item is-dim'
          }
          onMouseEnter={() => setActive(index)}
        >
          <img src={asset(src)} alt="" />
        </li>
      ))}
    </ul>
  )
}

function ProjectEmbed({ src, title }) {
  const shellRef = useRef(null)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    const sync = () => {
      setFullscreen(document.fullscreenElement === shellRef.current)
    }
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  const toggleFullscreen = async () => {
    const shell = shellRef.current
    if (!shell) return

    try {
      if (document.fullscreenElement === shell) {
        await document.exitFullscreen()
        return
      }
      await shell.requestFullscreen()
    } catch {
      setFullscreen(false)
    }
  }

  return (
    <div className={fullscreen ? 'project-embed-shell is-fullscreen' : 'project-embed-shell'} ref={shellRef}>
      <div className="project-embed-toolbar">
        <button
          className="project-embed-fullscreen"
          type="button"
          aria-pressed={fullscreen}
          onClick={toggleFullscreen}
        >
          {fullscreen ? 'Exit full screen' : 'Full screen'}
        </button>
      </div>
      <iframe
        className="project-embed-frame"
        src={asset(src)}
        title={title}
        allow="fullscreen; gamepad; autoplay"
        allowFullScreen
      />
    </div>
  )
}

function ProjectPage({ project }) {
  const isEmbed = Boolean(project.embed)
  const pageClass =
    project.kind === 'head'
      ? 'project-page astro64-page section'
      : project.kind === 'weather'
        ? 'project-page weather-page section'
        : project.kind === 'galaxy'
          ? 'project-page galaxy-page section'
          : isEmbed
            ? 'project-page embed-page section'
            : 'project-page section'

  return (
    <article className={pageClass}>
      <a className="project-back" href="#work">
        <BackIcon />
        Back
      </a>
      {project.kind === 'head' ? (
        <HeadStudio />
      ) : project.kind === 'weather' ? (
        <WeatherApp />
      ) : project.kind === 'galaxy' ? (
        <AsciiGalaxy />
      ) : isEmbed ? null : (
        <div className="project-page-media">
          <img src={asset(project.image)} alt="" />
        </div>
      )}
      <header>
        <h1>{project.title}</h1>
        <p className="project-page-info">{project.info}</p>
      </header>
      <p className="project-page-summary">{project.summary}</p>
      {isEmbed ? (
        <ProjectEmbed src={project.embed} title={`${project.title} interactive project`} />
      ) : null}
      {project.process ? <ProjectProcess process={project.process} /> : null}
      {project.gallery ? <ProjectGallery images={project.gallery} /> : null}
    </article>
  )
}

function ProjectProcess({ process }) {
  return (
    <section className="project-process" aria-label="Project process">
      <p className="project-process-kicker">{process.kicker}</p>
      <h2 className="project-process-title">{process.title}</h2>
      <div className="project-process-body">
        {process.body.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
      {process.steps?.length ? (
        <ol className="project-process-steps">
          {process.steps.map((step, index) => (
            <li key={step.label}>
              <span className="project-process-step-index">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3>{step.label}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  )
}

function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('portfolio-theme', theme)
  }, [theme])

  useEffect(() => {
    const sync = (event) => {
      if (event.key !== 'portfolio-theme') return
      if (event.newValue !== 'dark' && event.newValue !== 'light') return
      setTheme(event.newValue)
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])

  const dark = theme === 'dark'

  return (
    <button
      className={dark ? 'theme-toggle is-dark' : 'theme-toggle'}
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      <span className="theme-toggle-icon theme-toggle-sun" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      </span>
      <span className="theme-toggle-icon theme-toggle-moon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z" />
        </svg>
      </span>
      <span className="theme-toggle-thumb" aria-hidden="true" />
    </button>
  )
}

export default function App() {
  const hash = useHash()
  const slug = hash.startsWith('#project/') ? decodeURIComponent(hash.slice('#project/'.length)) : ''
  const project = projects.find((item) => item.slug === slug)
  const [showAllProjects, setShowAllProjects] = useState(false)
  const hasMoreProjects = projects.length > VISIBLE_PROJECTS
  const shownProjects = showAllProjects ? projects : projects.slice(0, VISIBLE_PROJECTS)

  useEffect(() => {
    if (slug) {
      window.scrollTo(0, 0)
      return
    }

    const id = hash.startsWith('#') ? hash.slice(1) : ''
    if (!id) return
    if (id === 'top') {
      // True page top — scrollIntoView(#top) tucks main under the sticky header
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    document.getElementById(id)?.scrollIntoView()
  }, [hash, slug])

  return (
    <>
      <header className="site-header">
        <a
          className="wordmark"
          href="#top"
          onClick={(event) => {
            event.preventDefault()
            window.scrollTo({ top: 0, behavior: 'smooth' })
            if (window.location.hash !== '#top') {
              window.history.pushState(null, '', '#top')
              window.dispatchEvent(new HashChangeEvent('hashchange'))
            }
          }}
        >
          TB
        </a>
        <nav className="site-nav" aria-label="Primary">
          <a href="#work">Work</a>
          <a href="#about">About</a>
          <a href="#contact">Contact</a>
        </nav>
      </header>

      <main id="top">
        {slug ? (
          project ? (
            <ProjectPage project={project} />
          ) : (
            <section className="section">
              <h2 className="section-kicker">Project</h2>
              <p className="section-title">This page is not on the canvas yet.</p>
              <a className="project-back" href="#work">
                <BackIcon />
                Back
              </a>
            </section>
          )
        ) : (
          <>
        <PaintHero />

        <section className="section statement">
          <p>
            Brand systems, websites, interfaces and visual experiments — built with
            equal attention to concept and craft.
          </p>
        </section>

        <section className="section" id="work">
          <h2 className="section-kicker">01 / Selected work</h2>
          <div className="project-grid" id="project-grid">
            {shownProjects.map((item) => (
              <article className="project-card" key={item.slug}>
                {item.kind === 'head' ? (
                  <HeadStudio variant="card" />
                ) : item.kind === 'weather' ? (
                  <WeatherApp variant="card" />
                ) : item.kind === 'galaxy' ? (
                  <AsciiGalaxy variant="card" />
                ) : (
                  <img className={item.slug === 'fenolia' ? 'is-wide' : undefined} src={asset(item.image)} alt="" />
                )}
                <div className="project-card-foot">
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.info}</p>
                  </div>
                  <a className="project-arrow" href={`#project/${item.slug}`} aria-label={`Open ${item.title}`}>
                    <ArrowIcon />
                  </a>
                </div>
              </article>
            ))}
          </div>
          {hasMoreProjects ? (
            <button
              className="project-more"
              type="button"
              aria-expanded={showAllProjects}
              aria-controls="project-grid"
              onClick={() => setShowAllProjects((open) => !open)}
            >
              {showAllProjects ? 'Show less' : 'Show more'}
            </button>
          ) : null}
        </section>

        <section className="section about" id="about">
          <h2 className="section-kicker">02 / About</h2>
          <header className="about-header">
            <p className="section-title">
              <strong>Designing between</strong>
              <br />
              disciplines
            </p>
          </header>
          <div className="about-body">
            <p>
              I&apos;m Tom, a graphic designer and web developer with a fascination for the
              space where visual design and technology overlap.
            </p>
            <p>
              My work moves between identity, websites, UI, 3D modelling, game
              development, illustration and digital art. I like projects that need both
              a strong visual point of view and someone willing to get into the details.
            </p>
            <ul className="skill-list">
              <li>Brand</li>
              <li>Web</li>
              <li>UI / UX</li>
              <li>3D</li>
              <li>Creative code</li>
              <li>Digital art</li>
            </ul>
          </div>
        </section>

        <section className="section" id="approach">
          <h2 className="section-kicker">03 / My approach</h2>
          <ol className="approach-list">
            <li>
              <svg className="approach-icon" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <path d="M16 16.2L20 20.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <h3>Find the Idea</h3>
              <p>Get underneath the brief and identify what makes the project worth noticing.</p>
            </li>
            <li>
              <svg className="approach-icon" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="6.5" width="12" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <rect x="9" y="3.5" width="12" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
              </svg>
              <h3>Make it visual</h3>
              <p>Build a visual language that gives the idea a distinctive, coherent form.</p>
            </li>
            <li>
              <svg className="approach-icon" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="4" y="4.5" width="16" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <path d="M4 9h16M8 7.2h.01M11 7.2h.01" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <h3>Make it work</h3>
              <p>Turn the design into a useful, responsive and technically sound experience.</p>
            </li>
          </ol>
        </section>

        <section className="section" id="contact">
          <h2 className="section-kicker">04 / Contact</h2>
          <div className="contact-block">
            <p className="section-title">
              <strong>Have something</strong>
              <br />
              interesting?
            </p>
            <a href="mailto:tbridgeland1@gmail.com">Email Me</a>
          </div>
        </section>
          </>
        )}
      </main>

      <footer className="site-footer">
        <span>© {new Date().getFullYear()} Tom Bridgeland</span>
        <span>Designed + built by Tom</span>
        <a
          href="#top"
          onClick={(event) => {
            event.preventDefault()
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
        >
          Back to top ↑
        </a>
      </footer>
      <ThemeToggle />
    </>
  )
}
