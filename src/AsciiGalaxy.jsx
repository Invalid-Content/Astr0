import { useEffect, useRef } from 'react'

const GLYPHS = ' .·˚:+*✦oO%@#'
const ARM_COUNT = 4
const STAR_COUNT = 4800
const DUST_COUNT = 1600
const BULGE_COUNT = 900
const FIELD_COUNT = 900
const CLUSTER_COUNT = 6
const METEOR_COUNT = 5

function mulberry32(seed) {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function buildWorld(seed) {
  const rand = mulberry32(seed)
  const stars = []

  for (let i = 0; i < STAR_COUNT; i += 1) {
    const arm = i % ARM_COUNT
    const t = rand()
    const radius = 0.06 + t ** 0.5 * 1.7
    const armAngle = (arm / ARM_COUNT) * Math.PI * 2
    const spiral = Math.log(radius + 0.1) * 2.55
    const scatter = (rand() - 0.5) * (0.16 + radius * 0.22)
    const spur = rand() < 0.12 ? (rand() - 0.5) * 0.55 : 0
    const theta = armAngle + spiral + scatter + spur
    const bulge = Math.exp(-radius * radius * 2.4)
    const brightness = 0.22 + rand() * 0.65 + bulge * 0.85
    const warm = rand() * 0.4 + bulge * 0.45

    stars.push({
      x: Math.cos(theta) * radius,
      y: Math.sin(theta) * radius,
      z: (rand() - 0.5) * (0.035 + (1 - bulge) * 0.1),
      brightness,
      warm,
      twinkle: rand() * Math.PI * 2,
      speed: 0.5 + rand() * 2.2,
      drift: (rand() - 0.5) * 0.015,
    })
  }

  for (let i = 0; i < DUST_COUNT; i += 1) {
    const arm = i % ARM_COUNT
    const t = rand()
    const radius = 0.2 + t ** 0.65 * 1.45
    const armAngle = (arm / ARM_COUNT) * Math.PI * 2 + 0.18
    const spiral = Math.log(radius + 0.14) * 2.55
    const scatter = (rand() - 0.5) * (0.28 + radius * 0.2)
    const theta = armAngle + spiral + scatter
    stars.push({
      x: Math.cos(theta) * radius,
      y: Math.sin(theta) * radius,
      z: (rand() - 0.5) * 0.06,
      brightness: 0.08 + rand() * 0.22,
      warm: 0.15 + rand() * 0.35,
      twinkle: rand() * Math.PI * 2,
      speed: 0.15 + rand() * 0.5,
      dust: true,
      soft: 1.8 + rand() * 1.6,
    })
  }

  for (let i = 0; i < BULGE_COUNT; i += 1) {
    const u = rand()
    const v = rand()
    const radius = Math.sqrt(u) * 0.28
    const theta = v * Math.PI * 2
    stars.push({
      x: Math.cos(theta) * radius,
      y: Math.sin(theta) * radius * 0.72,
      z: (rand() - 0.5) * 0.12,
      brightness: 0.55 + rand() * 0.8,
      warm: 0.45 + rand() * 0.45,
      twinkle: rand() * Math.PI * 2,
      speed: 0.8 + rand() * 2.6,
      bulge: true,
    })
  }

  for (let c = 0; c < CLUSTER_COUNT; c += 1) {
    const arm = c % ARM_COUNT
    const radius = 0.45 + rand() * 1.05
    const armAngle = (arm / ARM_COUNT) * Math.PI * 2
    const spiral = Math.log(radius + 0.12) * 2.55
    const cx = Math.cos(armAngle + spiral) * radius
    const cy = Math.sin(armAngle + spiral) * radius
    const count = 40 + Math.floor(rand() * 55)
    for (let i = 0; i < count; i += 1) {
      const ang = rand() * Math.PI * 2
      const rr = rand() ** 0.7 * 0.08
      stars.push({
        x: cx + Math.cos(ang) * rr,
        y: cy + Math.sin(ang) * rr,
        z: (rand() - 0.5) * 0.05,
        brightness: 0.45 + rand() * 0.7,
        warm: rand() * 0.25,
        twinkle: rand() * Math.PI * 2,
        speed: 1.2 + rand() * 2.8,
        cluster: true,
      })
    }
  }

  for (let i = 0; i < FIELD_COUNT; i += 1) {
    const radius = 1.5 + rand() * 2.8
    const theta = rand() * Math.PI * 2
    stars.push({
      x: Math.cos(theta) * radius,
      y: Math.sin(theta) * radius,
      z: (rand() - 0.5) * 1.2,
      brightness: 0.1 + rand() * 0.42,
      warm: rand() * 0.2,
      twinkle: rand() * Math.PI * 2,
      speed: 0.3 + rand() * 1.6,
      field: true,
    })
  }

  const meteors = Array.from({ length: METEOR_COUNT }, () => ({
    delay: rand() * 8,
    period: 5.5 + rand() * 7,
    life: 0.7 + rand() * 0.6,
    x0: (rand() - 0.5) * 2.4,
    y0: (rand() - 0.5) * 1.6,
    z0: (rand() - 0.5) * 0.8,
    vx: 0.9 + rand() * 1.4,
    vy: -0.35 - rand() * 0.55,
    vz: (rand() - 0.5) * 0.3,
    phase: rand() * Math.PI * 2,
  }))

  const nebulae = Array.from({ length: 5 }, () => {
    const arm = Math.floor(rand() * ARM_COUNT)
    const radius = 0.35 + rand() * 1.1
    const armAngle = (arm / ARM_COUNT) * Math.PI * 2
    const spiral = Math.log(radius + 0.12) * 2.55
    return {
      x: Math.cos(armAngle + spiral) * radius,
      y: Math.sin(armAngle + spiral) * radius,
      z: (rand() - 0.5) * 0.08,
      radius: 0.18 + rand() * 0.22,
      warm: 0.2 + rand() * 0.55,
      pulse: rand() * Math.PI * 2,
    }
  })

  return { stars, meteors, nebulae }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export default function AsciiGalaxy({ variant = 'studio' }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const card = variant === 'card'

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return undefined

    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return undefined

    const { stars, meteors, nebulae } = buildWorld(card ? 42 : 77)
    const state = {
      yaw: -0.55,
      pitch: 0.72,
      zoom: card ? 1.15 : 1,
      panX: 0,
      panY: 0,
      auto: true,
      dragging: false,
      lastX: 0,
      lastY: 0,
      pointerId: null,
      width: 0,
      height: 0,
      dpr: 1,
      cols: 0,
      rows: 0,
      cellW: 0,
      cellH: 0,
    }

    let frame = 0
    let running = true
    let lastTs = performance.now()

    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      state.width = Math.max(1, Math.floor(rect.width))
      state.height = Math.max(1, Math.floor(rect.height))
      state.dpr = dpr
      canvas.width = Math.floor(state.width * dpr)
      canvas.height = Math.floor(state.height * dpr)
      canvas.style.width = `${state.width}px`
      canvas.style.height = `${state.height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const cell = card ? 6 : Math.max(6, Math.min(9, Math.floor(state.width / 120)))
      state.cellW = cell * 0.58
      state.cellH = cell
      state.cols = Math.max(28, Math.floor(state.width / state.cellW))
      state.rows = Math.max(18, Math.floor(state.height / state.cellH))
    }

    let densBuffer = new Float32Array(0)
    let warmBuffer = new Float32Array(0)

    const ensureBuffers = (n) => {
      if (densBuffer.length !== n) {
        densBuffer = new Float32Array(n)
        warmBuffer = new Float32Array(n)
      }
    }

    const project = (x, y, z, cosY, sinY, cosP, sinP) => {
      const x1 = x * cosY - y * sinY
      const y1 = x * sinY + y * cosY
      const y2 = y1 * cosP - z * sinP
      const z2 = y1 * sinP + z * cosP
      const depth = 2.6 + z2
      const scale = (0.92 * state.zoom) / depth
      const px = state.width * 0.5 + (x1 * scale + state.panX) * state.height * 0.42
      const py = state.height * 0.52 + (y2 * scale + state.panY) * state.height * 0.42
      return { px, py, depth, scale }
    }

    const splat = (px, py, weight, warmth, soft, cells, cols, rows, cellW, cellH) => {
      const col = Math.floor(px / cellW)
      const row = Math.floor(py / cellH)
      if (col < 0 || row < 0 || col >= cols || row >= rows) return

      const radius = soft || 0
      const r = Math.max(0, Math.ceil(radius))
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          const c = col + dx
          const rr = row + dy
          if (c < 0 || rr < 0 || c >= cols || rr >= rows) continue
          const dist = Math.hypot(dx, dy)
          if (dist > radius + 0.01 && r > 0) continue
          const fall = r === 0 ? 1 : 1 - dist / (radius + 0.35)
          const w = weight * fall * fall
          const idx = rr * cols + c
          densBuffer[idx] += w
          warmBuffer[idx] += warmth * w
        }
      }
    }

    const paint = (ts) => {
      if (!running) return
      frame = requestAnimationFrame(paint)
      const dt = Math.min(0.05, (ts - lastTs) / 1000)
      lastTs = ts

      if (state.auto && !state.dragging) {
        state.yaw += dt * (card ? 0.2 : 0.14)
      }

      const { cols, rows, cellW, cellH, width, height } = state
      const cells = cols * rows
      ensureBuffers(cells)
      densBuffer.fill(0)
      warmBuffer.fill(0)

      const cosY = Math.cos(state.yaw)
      const sinY = Math.sin(state.yaw)
      const cosP = Math.cos(state.pitch)
      const sinP = Math.sin(state.pitch)
      const t = ts * 0.001

      for (let i = 0; i < nebulae.length; i += 1) {
        const neb = nebulae[i]
        const pulse = 0.75 + 0.25 * Math.sin(t * 0.7 + neb.pulse)
        const { px, py, depth } = project(neb.x, neb.y, neb.z, cosY, sinY, cosP, sinP)
        if (px < -80 || py < -80 || px > width + 80 || py > height + 80) continue
        const soft = (neb.radius * height * 0.22 * state.zoom) / Math.max(depth, 1.2) / cellH
        splat(px, py, 0.55 * pulse, neb.warm, soft, cells, cols, rows, cellW, cellH)
      }

      for (let i = 0; i < stars.length; i += 1) {
        const star = stars[i]
        const drift = star.drift ? t * star.drift : 0
        const x = star.x * Math.cos(drift) - star.y * Math.sin(drift)
        const y = star.x * Math.sin(drift) + star.y * Math.cos(drift)
        const { px, py, depth, scale } = project(x, y, star.z, cosY, sinY, cosP, sinP)
        if (px < -30 || py < -30 || px > width + 30 || py > height + 30) continue

        const twinkle = 0.55 + 0.45 * Math.sin(t * star.speed + star.twinkle)
        const flicker = star.cluster || star.bulge ? 0.85 + 0.15 * Math.sin(t * star.speed * 1.7 + star.twinkle) : 1
        const falloff = star.field ? 0.5 : clamp(1.4 - depth * 0.16, 0.3, 1.35)
        const weight = star.brightness * twinkle * flicker * falloff * (0.65 + scale * 0.55)
        const soft = star.dust ? star.soft : star.bulge && weight > 0.9 ? 1.1 : weight > 0.75 ? 0.85 : 0
        splat(px, py, weight, star.warm, soft, cells, cols, rows, cellW, cellH)
      }

      for (let i = 0; i < meteors.length; i += 1) {
        const m = meteors[i]
        const cycle = (t + m.delay) % m.period
        if (cycle > m.life) continue
        const u = cycle / m.life
        const fade = u < 0.15 ? u / 0.15 : u > 0.7 ? (1 - u) / 0.3 : 1
        const mx = m.x0 + m.vx * u
        const my = m.y0 + m.vy * u
        const mz = m.z0 + m.vz * u
        for (let s = 0; s < 7; s += 1) {
          const back = s * 0.045
          const { px, py } = project(
            mx - m.vx * back,
            my - m.vy * back,
            mz - m.vz * back,
            cosY,
            sinY,
            cosP,
            sinP,
          )
          splat(px, py, (0.9 - s * 0.1) * fade, 0.1, s === 0 ? 0.6 : 0, cells, cols, rows, cellW, cellH)
        }
      }

      ctx.fillStyle = '#05070d'
      ctx.fillRect(0, 0, width, height)

      const gx = width * 0.5 + state.panX * height * 0.08
      const gy = height * 0.52 + state.panY * height * 0.08
      const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, height * (0.42 * state.zoom))
      glow.addColorStop(0, 'rgba(255, 214, 160, 0.2)')
      glow.addColorStop(0.28, 'rgba(160, 180, 255, 0.1)')
      glow.addColorStop(0.65, 'rgba(80, 100, 180, 0.04)')
      glow.addColorStop(1, 'rgba(5, 7, 13, 0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, width, height)

      const armGlow = ctx.createRadialGradient(
        gx + Math.cos(state.yaw) * height * 0.12,
        gy + Math.sin(state.yaw * 0.7) * height * 0.08,
        0,
        gx,
        gy,
        height * 0.55 * state.zoom,
      )
      armGlow.addColorStop(0, 'rgba(120, 160, 255, 0.05)')
      armGlow.addColorStop(1, 'rgba(5, 7, 13, 0)')
      ctx.fillStyle = armGlow
      ctx.fillRect(0, 0, width, height)

      ctx.font = `${Math.floor(cellH * 0.92)}px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace`
      ctx.textBaseline = 'top'
      ctx.textAlign = 'left'

      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const idx = row * cols + col
          const d = densBuffer[idx]
          if (d < 0.045) continue

          const level = clamp(d / 1.55, 0, 1)
          const gi = Math.min(GLYPHS.length - 1, Math.floor(level * (GLYPHS.length - 1)))
          const glyph = GLYPHS[gi]
          if (glyph === ' ') continue

          const warmth = warmBuffer[idx] / Math.max(d, 0.001)
          const r = Math.floor(165 + warmth * 80 + level * 50)
          const g = Math.floor(178 + (1 - warmth) * 40 + level * 50)
          const b = Math.floor(225 - warmth * 100 + level * 25)
          const a = 0.28 + level * 0.68
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`
          ctx.fillText(glyph, col * cellW, row * cellH)
        }
      }
    }

    const onPointerDown = (event) => {
      if (card) return
      state.dragging = true
      state.auto = false
      state.lastX = event.clientX
      state.lastY = event.clientY
      state.pointerId = event.pointerId
      wrap.setPointerCapture?.(event.pointerId)
      wrap.dataset.cursor = 'grabbing'
    }

    const onPointerMove = (event) => {
      if (card || !state.dragging) return
      const dx = event.clientX - state.lastX
      const dy = event.clientY - state.lastY
      state.lastX = event.clientX
      state.lastY = event.clientY
      state.yaw += dx * 0.0055
      state.pitch = clamp(state.pitch + dy * 0.0035, 0.2, 1.25)
    }

    const onPointerUp = (event) => {
      if (card) return
      if (state.pointerId != null && event.pointerId !== state.pointerId) return
      state.dragging = false
      state.pointerId = null
      wrap.dataset.cursor = 'grab'
      window.setTimeout(() => {
        if (!state.dragging) state.auto = true
      }, 1800)
    }

    const onWheel = (event) => {
      if (card) return
      event.preventDefault()
      const next = state.zoom * (event.deltaY > 0 ? 0.94 : 1.06)
      state.zoom = clamp(next, 0.55, 2.4)
    }

    const onKey = (event) => {
      if (card) return
      if (event.key === 'ArrowLeft') state.yaw -= 0.08
      if (event.key === 'ArrowRight') state.yaw += 0.08
      if (event.key === 'ArrowUp') state.pitch = clamp(state.pitch - 0.05, 0.2, 1.25)
      if (event.key === 'ArrowDown') state.pitch = clamp(state.pitch + 0.05, 0.2, 1.25)
      if (event.key === '+' || event.key === '=') state.zoom = clamp(state.zoom * 1.08, 0.55, 2.4)
      if (event.key === '-' || event.key === '_') state.zoom = clamp(state.zoom * 0.92, 0.55, 2.4)
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    frame = requestAnimationFrame(paint)

    if (!card) {
      wrap.addEventListener('pointerdown', onPointerDown)
      wrap.addEventListener('pointermove', onPointerMove)
      wrap.addEventListener('pointerup', onPointerUp)
      wrap.addEventListener('pointercancel', onPointerUp)
      wrap.addEventListener('wheel', onWheel, { passive: false })
      wrap.addEventListener('keydown', onKey)
      wrap.tabIndex = 0
      wrap.dataset.cursor = 'grab'
    }

    return () => {
      running = false
      cancelAnimationFrame(frame)
      observer.disconnect()
      if (!card) {
        wrap.removeEventListener('pointerdown', onPointerDown)
        wrap.removeEventListener('pointermove', onPointerMove)
        wrap.removeEventListener('pointerup', onPointerUp)
        wrap.removeEventListener('pointercancel', onPointerUp)
        wrap.removeEventListener('wheel', onWheel)
        wrap.removeEventListener('keydown', onKey)
      }
    }
  }, [card])

  return (
    <div
      className={card ? 'ascii-galaxy is-card' : 'ascii-galaxy is-studio'}
      ref={wrapRef}
      aria-label={card ? 'ASCII spiral galaxy preview' : 'Interactive ASCII spiral galaxy'}
    >
      <canvas ref={canvasRef} />
      {!card ? (
        <p className="ascii-galaxy-hint">Drag to orbit · Scroll to zoom</p>
      ) : null}
    </div>
  )
}
