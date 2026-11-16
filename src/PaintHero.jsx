import { useEffect, useRef, useState } from 'react'

const PIGMENTS = [
  { r: 196, g: 48, b: 38 },
  { r: 29, g: 72, b: 138 },
  { r: 22, g: 122, b: 98 },
  { r: 212, g: 148, b: 42 },
  { r: 142, g: 42, b: 88 },
  { r: 28, g: 28, b: 28 },
]

const BASE_SCALE = 1
const HOLD_SCALE = 2.6

const BRUSHES = [
  { id: 'bristle', label: 'Bristle', note: 'A bundle of hairs' },
  { id: 'pen', label: 'Pen', note: 'A fine ink line' },
  { id: 'marker', label: 'Marker', note: 'A broad, even stroke' },
  { id: 'splatter', label: 'Splatter', note: 'Dots thrown off the path' },
]

const COLORS = [
  { id: 'shift', label: 'Shifting', value: null },
  { id: 'crimson', label: 'Crimson', value: { r: 196, g: 48, b: 38 } },
  { id: 'indigo', label: 'Indigo', value: { r: 29, g: 72, b: 138 } },
  { id: 'teal', label: 'Teal', value: { r: 22, g: 122, b: 98 } },
  { id: 'gold', label: 'Gold', value: { r: 212, g: 148, b: 42 } },
  { id: 'plum', label: 'Plum', value: { r: 142, g: 42, b: 88 } },
  { id: 'ink', label: 'Ink', value: { r: 28, g: 28, b: 28 } },
]

const CURSOR_SIZE = { bristle: 28, pen: 14, marker: 42, splatter: 32 }

function lerp(a, b, t) {
  return a + (b - a) * t
}

function mixPigment(t) {
  const n = PIGMENTS.length
  const wrapped = ((t % n) + n) % n
  const i = Math.floor(wrapped)
  const f = wrapped - i
  const a = PIGMENTS[i]
  const b = PIGMENTS[(i + 1) % n]
  return {
    r: lerp(a.r, b.r, f),
    g: lerp(a.g, b.g, f),
    b: lerp(a.b, b.b, f),
  }
}

function strokeLine(context, x0, y0, x1, y1, width, style) {
  context.strokeStyle = style
  context.lineWidth = width
  context.beginPath()
  context.moveTo(x0, y0)
  context.lineTo(x1, y1)
  context.stroke()
}

function makeBristles() {
  return Array.from({ length: 24 }, () => {
    const angle = Math.random() * Math.PI * 2
    const radius = Math.random() ** 0.55 * 12
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      width: 0.55 + Math.random() * 2.6,
      ink: 0.08 + Math.random() * 0.16,
    }
  })
}

function HeroFooter() {
  return (
    <p className="hero-footer">
      <span>Selected disciplines</span>
      <span>Brand / Web / 3D / Interactive</span>
    </p>
  )
}

function SnowCopy({ hint }) {
  return (
    <div className="hero-copy">
      <p className="eyebrow">Designer / Software Developer / Digital Artist</p>
      <h1>
        Ideas are
        <br />
        <em>made</em> to move
      </h1>
      <p className="lede">
        I design identities, digital experiences and visual worlds where strategy
        meets experimentation.
      </p>
      <p className="hero-hint">{hint}</p>
      <div className="hero-actions">
        <span className="btn">See selected work</span>
        <span className="btn ghost">Wipe the canvas</span>
      </div>
      <HeroFooter />
    </div>
  )
}

export default function PaintHero() {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const maskRef = useRef(null)
  const snowRef = useRef(null)
  const layerARef = useRef(null)
  const layerBRef = useRef(null)
  const cursorRef = useRef(null)
  const toolRef = useRef({ brush: 'bristle', colorId: 'shift' })
  const paintApi = useRef(null)
  const [hint, setHint] = useState('Move to paint — hold click to widen the brush.')
  const [menuOpen, setMenuOpen] = useState(false)
  const [brushId, setBrushId] = useState('bristle')
  const [colorId, setColorId] = useState('shift')

  const chooseBrush = (id) => {
    toolRef.current.brush = id
    setBrushId(id)
    paintApi.current?.refreshCursor()
  }

  const chooseColor = (id) => {
    toolRef.current.colorId = id
    setColorId(id)
    paintApi.current?.refreshCursor()
  }

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    const mask = maskRef.current
    const cursor = cursorRef.current
    const layerA = layerARef.current
    const layerB = layerBRef.current
    const ctx = canvas.getContext('2d', { alpha: true })
    const maskCtx = mask.getContext('2d', { alpha: true })

    let dpr = 1
    let last = null
    let traveled = 0
    let sizeScale = BASE_SCALE
    let pressing = false
    let maskDirty = false
    let maskLoading = false
    let maskToken = 0
    let shownLayer = layerA
    let hiddenLayer = layerB
    const bristles = makeBristles()

    const paintMask = (layer, value) => {
      layer.style.webkitMaskImage = value
      layer.style.maskImage = value
    }

    const hideSnow = () => {
      maskToken += 1
      maskDirty = false
      maskLoading = false
      shownLayer = layerA
      hiddenLayer = layerB
      for (const layer of [layerA, layerB]) {
        paintMask(layer, 'linear-gradient(transparent, transparent)')
        layer.classList.remove('is-shown')
      }
    }

    const flushSnow = () => {
      if (maskLoading || !maskDirty) return
      maskDirty = false
      maskLoading = true
      const token = ++maskToken
      const url = mask.toDataURL('image/png')
      const image = new Image()
      image.onload = () => {
        if (token !== maskToken) return
        paintMask(hiddenLayer, `url("${url}")`)
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (token !== maskToken) return
            hiddenLayer.classList.add('is-shown')
            shownLayer.classList.remove('is-shown')
            const previous = shownLayer
            shownLayer = hiddenLayer
            hiddenLayer = previous
            maskLoading = false
            if (maskDirty) flushSnow()
          })
        })
      }
      image.onerror = () => {
        if (token !== maskToken) return
        maskLoading = false
        if (maskDirty) flushSnow()
      }
      image.src = url
    }

    const queueSnow = () => {
      maskDirty = true
      flushSnow()
    }

    const currentPigment = () => {
      const chosen = COLORS.find((color) => color.id === toolRef.current.colorId)
      if (chosen?.value) return chosen.value
      return mixPigment(traveled / 380)
    }

    const updateCursorSize = () => {
      if (!cursor) return
      const px = (CURSOR_SIZE[toolRef.current.brush] ?? 28) * sizeScale
      cursor.style.width = `${px}px`
      cursor.style.height = `${px}px`
      cursor.style.marginLeft = `${-px / 2}px`
      cursor.style.marginTop = `${-px / 2}px`
      cursor.style.background = ''
    }

    paintApi.current = { refreshCursor: updateCursorSize }

    const setPressed = (next) => {
      pressing = next
      sizeScale = next ? HOLD_SCALE : BASE_SCALE
      wrap.classList.toggle('is-pressing', next)
      updateCursorSize()
    }

    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(rect.width * dpr)
      canvas.height = Math.floor(rect.height * dpr)
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      mask.width = Math.max(1, Math.floor(rect.width))
      mask.height = Math.max(1, Math.floor(rect.height))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      maskCtx.setTransform(1, 0, 0, 1, 0, 0)
      hideSnow()
      last = null
    }

    const paintSegment = (x0, y0, x1, y1, speed) => {
      const distance = Math.hypot(x1 - x0, y1 - y0)
      if (distance === 0) return

      const steps = Math.max(1, Math.ceil(distance / 1.8))
      const fatness = lerp(18, 5, Math.min(speed / 42, 1)) * sizeScale
      traveled += distance
      const pigment = currentPigment()
      const rgb = `${pigment.r}, ${pigment.g}, ${pigment.b}`
      const brush = toolRef.current.brush

      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.globalCompositeOperation = 'source-over'
      maskCtx.lineCap = 'round'
      maskCtx.lineJoin = 'round'
      maskCtx.strokeStyle = '#fff'
      maskCtx.fillStyle = '#fff'
      maskCtx.globalCompositeOperation = 'source-over'

      if (brush === 'pen') {
        const width = lerp(2.6, 0.85, Math.min(speed / 36, 1)) * sizeScale
        strokeLine(ctx, x0, y0, x1, y1, width, `rgba(${rgb}, 0.92)`)
        strokeLine(maskCtx, x0, y0, x1, y1, width * 1.5, '#fff')
        queueSnow()
        return
      }

      if (brush === 'marker') {
        const width = lerp(30, 16, Math.min(speed / 28, 1)) * sizeScale
        strokeLine(ctx, x0, y0, x1, y1, width, `rgba(${rgb}, 0.34)`)
        strokeLine(maskCtx, x0, y0, x1, y1, width * 0.92, '#fff')
        queueSnow()
        return
      }

      if (brush === 'splatter') {
        const drops = Math.max(5, Math.ceil(distance / 3.5))
        for (let i = 0; i < drops; i += 1) {
          const t = i / drops
          const spread = fatness * (0.35 + Math.random() * 1.7)
          const angle = Math.random() * Math.PI * 2
          const x = lerp(x0, x1, t) + Math.cos(angle) * spread
          const y = lerp(y0, y1, t) + Math.sin(angle) * spread
          const radius = (0.7 + Math.random() * 2.8) * sizeScale
          ctx.fillStyle = `rgba(${rgb}, ${0.28 + Math.random() * 0.5})`
          ctx.beginPath()
          ctx.arc(x, y, radius, 0, Math.PI * 2)
          ctx.fill()
          maskCtx.beginPath()
          maskCtx.arc(x, y, radius * 1.15, 0, Math.PI * 2)
          maskCtx.fill()
        }
        queueSnow()
        return
      }

      for (let step = 0; step < steps; step += 1) {
        const t0 = step / steps
        const t1 = (step + 1) / steps
        const spread = fatness / 13

        for (const bristle of bristles) {
          const lineWidth =
            bristle.width * (fatness / 7.5) * (0.75 + (1 - Math.min(speed / 40, 1)) * 0.55)
          const ax = lerp(x0, x1, t0) + bristle.x * spread
          const ay = lerp(y0, y1, t0) + bristle.y * spread
          const bx = lerp(x0, x1, t1) + bristle.x * spread
          const by = lerp(y0, y1, t1) + bristle.y * spread

          ctx.strokeStyle = `rgba(${pigment.r}, ${pigment.g}, ${pigment.b}, ${bristle.ink})`
          ctx.lineWidth = lineWidth
          ctx.beginPath()
          ctx.moveTo(ax, ay)
          ctx.lineTo(bx, by)
          ctx.stroke()

          maskCtx.lineWidth = lineWidth * 1.35
          maskCtx.beginPath()
          maskCtx.moveTo(ax, ay)
          maskCtx.lineTo(bx, by)
          maskCtx.stroke()
        }
      }
      queueSnow()
    }

    const pointFromEvent = (event) => {
      const rect = wrap.getBoundingClientRect()
      const source = event.touches?.[0] ?? event
      return {
        x: source.clientX - rect.left,
        y: source.clientY - rect.top,
      }
    }

    const onMove = (event) => {
      if (event.target.closest('.brush-drawer')) {
        last = null
        wrap.classList.remove('is-painting')
        return
      }
      const point = pointFromEvent(event)
      wrap.classList.add('is-painting')
      if (cursor) {
        cursor.style.left = `${point.x}px`
        cursor.style.top = `${point.y}px`
      }
      if (last) {
        const speed = Math.hypot(point.x - last.x, point.y - last.y)
        paintSegment(last.x, last.y, point.x, point.y, speed)
      }
      last = point
    }

    const onDown = (event) => {
      if (event.target.closest('a, button, .brush-drawer')) return
      if (event.pointerId != null && wrap.setPointerCapture) {
        wrap.setPointerCapture(event.pointerId)
      }
      setPressed(true)
      setHint('Release to return to a finer brush.')
      onMove(event)
    }

    const onUp = () => {
      if (!pressing) return
      setPressed(false)
      setHint('Move to paint — hold click to widen the brush.')
    }

    const onLeave = () => {
      last = null
      wrap.classList.remove('is-painting')
    }

    const onClear = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      maskCtx.setTransform(1, 0, 0, 1, 0, 0)
      maskCtx.clearRect(0, 0, mask.width, mask.height)
      hideSnow()
      traveled = 0
      last = null
      setPressed(false)
      setHint('Move to paint — hold click to widen the brush.')
    }

    resize()
    window.addEventListener('resize', resize)
    wrap.addEventListener('pointermove', onMove)
    wrap.addEventListener('pointerdown', onDown)
    wrap.addEventListener('pointerup', onUp)
    wrap.addEventListener('pointercancel', onUp)
    wrap.addEventListener('lostpointercapture', onUp)
    wrap.addEventListener('pointerleave', onLeave)
    wrap.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('portfolio:clear-paint', onClear)

    return () => {
      maskToken += 1
      window.removeEventListener('resize', resize)
      wrap.removeEventListener('pointermove', onMove)
      wrap.removeEventListener('pointerdown', onDown)
      wrap.removeEventListener('pointerup', onUp)
      wrap.removeEventListener('pointercancel', onUp)
      wrap.removeEventListener('lostpointercapture', onUp)
      wrap.removeEventListener('pointerleave', onLeave)
      wrap.removeEventListener('touchmove', onMove)
      window.removeEventListener('portfolio:clear-paint', onClear)
    }
  }, [])

  return (
    <section className="paint-hero" ref={wrapRef} aria-label="Interactive painted hero">
      <div className="paint-stage" aria-hidden="true">
        <canvas className="paint-canvas" ref={canvasRef} />
        <div className="paper-grain" />
      </div>
      <canvas className="mask-canvas" ref={maskRef} aria-hidden="true" />
      <div className="brush-cursor" ref={cursorRef} aria-hidden="true" />
      <aside className={menuOpen ? 'brush-drawer is-open' : 'brush-drawer'}>
        <div className="brush-drawer-panel" id="brush-options">
          <p className="brush-drawer-kicker">Tools</p>
          <h2>Brush & color</h2>
          <div className="brush-options" role="radiogroup" aria-label="Brush">
            {BRUSHES.map((brush) => (
              <button
                key={brush.id}
                className={brushId === brush.id ? 'brush-option is-selected' : 'brush-option'}
                type="button"
                role="radio"
                aria-checked={brushId === brush.id}
                onClick={() => chooseBrush(brush.id)}
              >
                <span className={`brush-mark brush-mark-${brush.id}`} aria-hidden="true" />
                <span>
                  <strong>{brush.label}</strong>
                  <small>{brush.note}</small>
                </span>
              </button>
            ))}
          </div>
          <p className="brush-drawer-label">Color</p>
          <div className="color-options" role="radiogroup" aria-label="Color">
            {COLORS.map((color) => (
              <button
                key={color.id}
                className={colorId === color.id ? `color-swatch is-selected swatch-${color.id}` : `color-swatch swatch-${color.id}`}
                type="button"
                role="radio"
                aria-checked={colorId === color.id}
                aria-label={color.label}
                title={color.label}
                onClick={() => chooseColor(color.id)}
              />
            ))}
          </div>
        </div>
        <button
          className="brush-drawer-tab"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="brush-options"
          onClick={() => setMenuOpen((open) => !open)}
        >
          Brushes
        </button>
      </aside>
      <div className="hero-copy">
        <p className="eyebrow">Designer / Software Developer / Digital Artist</p>
        <h1>
          Ideas are
          <br />
          <em>made</em> to move
        </h1>
        <p className="lede">
          I design identities, digital experiences and visual worlds where strategy
          meets experimentation.
        </p>
        <p className="hero-hint">{hint}</p>
        <div className="hero-actions">
          <a className="btn" href="#work">
            See selected work
          </a>
          <button
            className="btn ghost"
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('portfolio:clear-paint'))}
          >
            Wipe the canvas
          </button>
        </div>
        <HeroFooter />
      </div>
      <div className="title-snow" ref={snowRef} aria-hidden="true">
        <div className="snow-layer" ref={layerARef}>
          <SnowCopy hint={hint} />
        </div>
        <div className="snow-layer" ref={layerBRef}>
          <SnowCopy hint={hint} />
        </div>
      </div>
    </section>
  )
}
