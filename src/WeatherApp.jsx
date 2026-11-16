import { Fragment, useEffect, useEffectEvent, useRef, useState } from 'react'

const REFRESH_MS = 10 * 60 * 1000

const CITIES = [
  { id: 'manchester', name: 'Manchester', country: 'United Kingdom', lat: 53.4808, lon: -2.2426, tz: 'Europe/London' },
  { id: 'amsterdam', name: 'Amsterdam', country: 'Netherlands', lat: 52.3676, lon: 4.9041, tz: 'Europe/Amsterdam' },
  { id: 'auckland', name: 'Auckland', country: 'New Zealand', lat: -36.8485, lon: 174.7633, tz: 'Pacific/Auckland' },
  { id: 'bangkok', name: 'Bangkok', country: 'Thailand', lat: 13.7563, lon: 100.5018, tz: 'Asia/Bangkok' },
  { id: 'barcelona', name: 'Barcelona', country: 'Spain', lat: 41.3874, lon: 2.1686, tz: 'Europe/Madrid' },
  { id: 'beijing', name: 'Beijing', country: 'China', lat: 39.9042, lon: 116.4074, tz: 'Asia/Shanghai' },
  { id: 'berlin', name: 'Berlin', country: 'Germany', lat: 52.52, lon: 13.405, tz: 'Europe/Berlin' },
  { id: 'buenos-aires', name: 'Buenos Aires', country: 'Argentina', lat: -34.6037, lon: -58.3816, tz: 'America/Argentina/Buenos_Aires' },
  { id: 'cairo', name: 'Cairo', country: 'Egypt', lat: 30.0444, lon: 31.2357, tz: 'Africa/Cairo' },
  { id: 'chicago', name: 'Chicago', country: 'United States', lat: 41.8781, lon: -87.6298, tz: 'America/Chicago' },
  { id: 'delhi', name: 'Delhi', country: 'India', lat: 28.6139, lon: 77.209, tz: 'Asia/Kolkata' },
  { id: 'dubai', name: 'Dubai', country: 'United Arab Emirates', lat: 25.2048, lon: 55.2708, tz: 'Asia/Dubai' },
  { id: 'hong-kong', name: 'Hong Kong', country: 'China', lat: 22.3193, lon: 114.1694, tz: 'Asia/Hong_Kong' },
  { id: 'istanbul', name: 'Istanbul', country: 'Türkiye', lat: 41.0082, lon: 28.9784, tz: 'Europe/Istanbul' },
  { id: 'johannesburg', name: 'Johannesburg', country: 'South Africa', lat: -26.2041, lon: 28.0473, tz: 'Africa/Johannesburg' },
  { id: 'lagos', name: 'Lagos', country: 'Nigeria', lat: 6.5244, lon: 3.3792, tz: 'Africa/Lagos' },
  { id: 'lisbon', name: 'Lisbon', country: 'Portugal', lat: 38.7223, lon: -9.1393, tz: 'Europe/Lisbon' },
  { id: 'london', name: 'London', country: 'United Kingdom', lat: 51.5074, lon: -0.1278, tz: 'Europe/London' },
  { id: 'los-angeles', name: 'Los Angeles', country: 'United States', lat: 34.0522, lon: -118.2437, tz: 'America/Los_Angeles' },
  { id: 'madrid', name: 'Madrid', country: 'Spain', lat: 40.4168, lon: -3.7038, tz: 'Europe/Madrid' },
  { id: 'melbourne', name: 'Melbourne', country: 'Australia', lat: -37.8136, lon: 144.9631, tz: 'Australia/Melbourne' },
  { id: 'mexico-city', name: 'Mexico City', country: 'Mexico', lat: 19.4326, lon: -99.1332, tz: 'America/Mexico_City' },
  { id: 'moscow', name: 'Moscow', country: 'Russia', lat: 55.7558, lon: 37.6173, tz: 'Europe/Moscow' },
  { id: 'mumbai', name: 'Mumbai', country: 'India', lat: 19.076, lon: 72.8777, tz: 'Asia/Kolkata' },
  { id: 'nairobi', name: 'Nairobi', country: 'Kenya', lat: -1.2921, lon: 36.8219, tz: 'Africa/Nairobi' },
  { id: 'new-york', name: 'New York', country: 'United States', lat: 40.7128, lon: -74.006, tz: 'America/New_York' },
  { id: 'paris', name: 'Paris', country: 'France', lat: 48.8566, lon: 2.3522, tz: 'Europe/Paris' },
  { id: 'rio', name: 'Rio de Janeiro', country: 'Brazil', lat: -22.9068, lon: -43.1729, tz: 'America/Sao_Paulo' },
  { id: 'rome', name: 'Rome', country: 'Italy', lat: 41.9028, lon: 12.4964, tz: 'Europe/Rome' },
  { id: 'sao-paulo', name: 'São Paulo', country: 'Brazil', lat: -23.5505, lon: -46.6333, tz: 'America/Sao_Paulo' },
  { id: 'seoul', name: 'Seoul', country: 'South Korea', lat: 37.5665, lon: 126.978, tz: 'Asia/Seoul' },
  { id: 'shanghai', name: 'Shanghai', country: 'China', lat: 31.2304, lon: 121.4737, tz: 'Asia/Shanghai' },
  { id: 'singapore', name: 'Singapore', country: 'Singapore', lat: 1.3521, lon: 103.8198, tz: 'Asia/Singapore' },
  { id: 'stockholm', name: 'Stockholm', country: 'Sweden', lat: 59.3293, lon: 18.0686, tz: 'Europe/Stockholm' },
  { id: 'sydney', name: 'Sydney', country: 'Australia', lat: -33.8688, lon: 151.2093, tz: 'Australia/Sydney' },
  { id: 'tokyo', name: 'Tokyo', country: 'Japan', lat: 35.6762, lon: 139.6503, tz: 'Asia/Tokyo' },
  { id: 'toronto', name: 'Toronto', country: 'Canada', lat: 43.6532, lon: -79.3832, tz: 'America/Toronto' },
  { id: 'vancouver', name: 'Vancouver', country: 'Canada', lat: 49.2827, lon: -123.1207, tz: 'America/Vancouver' },
]

const DEFAULT_CITY_ID = 'manchester'

function cityById(id) {
  return CITIES.find((city) => city.id === id) || CITIES[0]
}

function cityLabel(city) {
  return `${city.name} - ${city.country}`
}

function weatherApiUrl(city) {
  return (
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${city.lat}&longitude=${city.lon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,is_day` +
    `&timezone=${encodeURIComponent(city.tz)}`
  )
}

function sceneFromCode(code) {
  if (code === 0) return 'clear'
  if (code === 1 || code === 2) return 'partly'
  if (code === 3) return 'overcast'
  if (code === 45 || code === 48) return 'fog'
  if (code >= 51 && code <= 57) return 'drizzle'
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if (code >= 95) return 'storm'
  return 'partly'
}

function labelFromCode(code) {
  const map = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Fog',
    48: 'Rime fog',
    51: 'Light drizzle',
    53: 'Drizzle',
    55: 'Dense drizzle',
    56: 'Freezing drizzle',
    57: 'Heavy freezing drizzle',
    61: 'Slight rain',
    63: 'Rain',
    65: 'Heavy rain',
    66: 'Freezing rain',
    67: 'Heavy freezing rain',
    71: 'Slight snow',
    73: 'Snow',
    75: 'Heavy snow',
    77: 'Snow grains',
    80: 'Slight showers',
    81: 'Showers',
    82: 'Violent showers',
    85: 'Snow showers',
    86: 'Heavy snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with hail',
    99: 'Severe thunderstorm',
  }
  return map[code] || 'Local sky'
}

function rainIntensity(code, precipitation) {
  if (code >= 95) return 1
  if (code === 65 || code === 82) return 0.95
  if (code === 63 || code === 81) return 0.7
  if (code === 61 || code === 80) return 0.45
  if (code >= 51 && code <= 57) return 0.28
  return Math.min(1, precipitation / 4)
}

function snowIntensity(code, precipitation) {
  if (code === 75 || code === 86) return 0.95
  if (code === 73 || code === 85) return 0.65
  if (code === 71 || code === 77) return 0.4
  return Math.min(1, precipitation / 3)
}

function windLabel(degrees) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return dirs[Math.round(degrees / 45) % 8]
}

function formatTime(iso, timeZone = 'Europe/London') {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  })
}

function formatClock(date, timeZone = 'Europe/London') {
  return date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  })
}

function localHours(date, timeZone = 'Europe/London') {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(date)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 12)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
  return hour + minute / 60
}

/** 0.34 (late night) → 1.1 (early afternoon) for the selected city. */
function skyBrightness(hours) {
  const wave = Math.cos(((hours - 13) / 24) * Math.PI * 2)
  return Number((0.72 + 0.38 * wave).toFixed(3))
}

function isDaylightHours(hours) {
  return hours >= 6 && hours < 20
}

function useCityClock(timeZone) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    setNow(new Date())
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [timeZone])

  const hours = localHours(now, timeZone)
  return {
    label: formatClock(now, timeZone),
    bright: skyBrightness(hours),
    isDay: isDaylightHours(hours),
  }
}

function WeatherParticles({ scene, intensity, windSpeed, active }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    const context = canvas.getContext('2d')
    let frame = 0
    let width = 0
    let height = 0
    let particles = []
    let disposed = false

    const isSnow = scene === 'snow'
    const isWet = active && (scene === 'rain' || scene === 'drizzle' || scene === 'storm' || isSnow)

    function clear() {
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, canvas.width, canvas.height)
    }

    if (!isWet) {
      clear()
      return clear
    }

    // All wet weather draws on a chunky low-res grid (scaled up via CSS pixelated)
    const pixelSize = isSnow ? 3 : scene === 'drizzle' ? 3 : 2

    function resize() {
      const bounds = canvas.getBoundingClientRect()
      width = Math.max(1, Math.floor(bounds.width / pixelSize))
      height = Math.max(1, Math.floor(bounds.height / pixelSize))
      canvas.width = width
      canvas.height = height
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.imageSmoothingEnabled = false
      seed()
    }

    function seed() {
      const baseCount = isSnow ? 70 : scene === 'drizzle' ? 55 : scene === 'storm' ? 120 : 95
      const count = Math.floor(baseCount * (0.35 + intensity * 0.9) * (width / 220))
      const drift = Math.min(
        isSnow ? 1.2 : scene === 'storm' ? 1.6 : 1.1,
        (windSpeed || 0) / (isSnow ? 28 : 22),
      )
      particles = Array.from({ length: Math.max(24, count) }, () => {
        const sizeRoll = Math.random()
        if (isSnow) {
          const size = sizeRoll > 0.82 ? 3 : sizeRoll > 0.45 ? 2 : 1
          return {
            x: Math.random() * width,
            y: Math.random() * height,
            len: size,
            // 0 = block, 1 = plus flake (larger flakes only)
            shape: size >= 2 && Math.random() > 0.55 ? 1 : 0,
            speed: 0.18 + Math.random() * 0.45,
            drift: drift * (0.4 + Math.random()),
            opacity: 0.45 + Math.random() * 0.5,
            wobble: Math.random() * Math.PI * 2,
          }
        }

        // Pixel rain: short vertical/diagonal dashes of 1px columns
        const len =
          scene === 'drizzle'
            ? 2 + Math.floor(Math.random() * 3)
            : scene === 'storm'
              ? 4 + Math.floor(Math.random() * 6)
              : 3 + Math.floor(Math.random() * 5)
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          len,
          shape: 0,
          // Wind lean in whole pixels: -1, 0, or 1 (storm can lean more)
          lean:
            Math.abs(drift) < 0.15
              ? 0
              : (drift > 0 ? 1 : -1) * (scene === 'storm' && Math.random() > 0.55 ? 2 : 1),
          speed:
            scene === 'drizzle'
              ? 1.1 + Math.random() * 1.4
              : scene === 'storm'
                ? 2.4 + Math.random() * 2.8
                : 1.6 + Math.random() * 2.2,
          drift: drift * (0.35 + Math.random() * 0.8),
          opacity:
            scene === 'storm' ? 0.4 + Math.random() * 0.5 : 0.35 + Math.random() * 0.45,
          wobble: 0,
        }
      })
    }

    function drawSnowFlake(drop) {
      const x = Math.round(drop.x)
      const y = Math.round(drop.y)
      const s = drop.len
      context.fillStyle = '#ffffff'
      if (drop.shape === 1 && s >= 2) {
        // Classic pixel plus / asterisk flake
        context.fillRect(x - s, y, s * 2 + 1, 1)
        context.fillRect(x, y - s, 1, s * 2 + 1)
        if (s >= 3) {
          context.fillStyle = 'rgba(200, 220, 245, 0.95)'
          context.fillRect(x - 1, y - 1, 1, 1)
          context.fillRect(x + 1, y - 1, 1, 1)
          context.fillRect(x - 1, y + 1, 1, 1)
          context.fillRect(x + 1, y + 1, 1, 1)
        }
      } else {
        context.fillRect(x, y, s, s)
        if (s >= 2) {
          context.fillStyle = 'rgba(185, 210, 240, 0.85)'
          context.fillRect(x + s - 1, y + s - 1, 1, 1)
        }
      }
    }

    function drawRainDrop(drop) {
      const x0 = Math.round(drop.x)
      const y0 = Math.round(drop.y)
      const lean = drop.lean || 0
      const bright =
        scene === 'storm' ? 'rgba(170, 215, 255, 0.95)' : 'rgba(140, 200, 255, 0.95)'
      const mid =
        scene === 'storm' ? 'rgba(110, 170, 230, 0.9)' : 'rgba(95, 160, 220, 0.88)'
      const tip = 'rgba(70, 120, 180, 0.75)'

      for (let i = 0; i < drop.len; i += 1) {
        const px = x0 + Math.round((i / Math.max(1, drop.len - 1)) * lean)
        const py = y0 + i
        if (i === 0) context.fillStyle = bright
        else if (i === drop.len - 1) context.fillStyle = tip
        else context.fillStyle = mid
        context.fillRect(px, py, 1, 1)
      }
    }

    function draw() {
      if (disposed) return
      frame = requestAnimationFrame(draw)
      context.clearRect(0, 0, width, height)

      for (const drop of particles) {
        drop.y += drop.speed
        drop.x += drop.drift + (isSnow ? Math.sin(drop.wobble) * 0.2 : 0)
        if (isSnow) drop.wobble += 0.035
        if (drop.y > height + 20) {
          drop.y = -20
          drop.x = Math.random() * width
        }
        if (drop.x > width + 20) drop.x = -20
        if (drop.x < -20) drop.x = width + 20

        context.globalAlpha = drop.opacity
        if (isSnow) drawSnowFlake(drop)
        else drawRainDrop(drop)
      }
      context.globalAlpha = 1
    }

    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()
    draw()

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      clear()
    }
  }, [scene, intensity, windSpeed, active])

  return <canvas className="weather-particles" ref={canvasRef} aria-hidden="true" />
}

const PREVIEW_SCENES = [
  { id: 'live', label: 'Live' },
  { id: 'clear', label: 'Clear' },
  { id: 'rain', label: 'Rain' },
  { id: 'storm', label: 'Storm' },
  { id: 'snow', label: 'Snow' },
  { id: 'fog', label: 'Fog' },
]

const PREVIEW_LABEL = {
  clear: 'Clear sky',
  rain: 'Rain',
  storm: 'Thunderstorm',
  snow: 'Snow',
  fog: 'Fog',
}

/** Drop PNGs in public/projects/atmo/ using these names. */
const CLOUD_FILES = {
  clear: '/projects/atmo/cloud-clear.png',
  partly: '/projects/atmo/cloud-partly.png',
  overcast: '/projects/atmo/cloud-overcast.png',
  fog: '/projects/atmo/cloud-fog.png',
  drizzle: '/projects/atmo/cloud-drizzle.png',
  rain: '/projects/atmo/cloud-rain.png',
  snow: '/projects/atmo/cloud-snow.png',
  storm: '/projects/atmo/cloud-storm.png',
}

const SUN_SRC = '/projects/atmo/sun.png'
const MOON_SRC = '/projects/atmo/moon.png'
const LIGHTNING_SRC = '/projects/atmo/lightning.png'

const CLOUD_ALIAS = {
  partly: 'clear',
  overcast: 'clear',
  drizzle: 'storm',
  rain: 'storm',
}

function cloudSrcForScene(scene) {
  const key = CLOUD_ALIAS[scene] || scene
  return CLOUD_FILES[key] || CLOUD_FILES.clear
}

function useImageFallback(src) {
  const [fallback, setFallback] = useState(false)

  useEffect(() => {
    setFallback(false)
  }, [src])

  return [fallback, () => setFallback(true)]
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

const cloudHitCanvasCache = new Map()

function getImageHitCanvas(img) {
  if (!img.complete || !img.naturalWidth || !img.naturalHeight) return null
  const key = img.currentSrc || img.src
  let entry = cloudHitCanvasCache.get(key)
  if (entry && entry.width === img.naturalWidth && entry.height === img.naturalHeight) {
    return entry
  }
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(img, 0, 0)
  entry = { canvas, context, width: canvas.width, height: canvas.height }
  cloudHitCanvasCache.set(key, entry)
  return entry
}

function objectFitContainOffsets(img, elemW, elemH, drawW, drawH) {
  const parts = (getComputedStyle(img).objectPosition || '50% 50%').split(/\s+/)
  const axis = (token, total, size) => {
    if (token === 'left' || token === 'top') return 0
    if (token === 'right' || token === 'bottom') return total - size
    if (token === 'center') return (total - size) / 2
    if (String(token).endsWith('%')) return ((total - size) * parseFloat(token)) / 100
    const value = parseFloat(token)
    return Number.isFinite(value) ? value : (total - size) / 2
  }
  return {
    offsetX: axis(parts[0] || '50%', elemW, drawW),
    offsetY: axis(parts[1] || parts[0] || '50%', elemH, drawH),
  }
}

/** True when the cursor is over opaque image pixels (supports object-fit: contain). */
function imageAlphaHit(img, clientX, clientY, threshold = 10) {
  const rect = img.getBoundingClientRect()
  const elemW = rect.width
  const elemH = rect.height
  if (elemW <= 0 || elemH <= 0) return false

  const natW = img.naturalWidth
  const natH = img.naturalHeight
  if (!img.complete || !natW || !natH) return true

  const scale = Math.min(elemW / natW, elemH / natH)
  const drawW = natW * scale
  const drawH = natH * scale
  const { offsetX, offsetY } = objectFitContainOffsets(img, elemW, elemH, drawW, drawH)
  const localX = clientX - rect.left - offsetX
  const localY = clientY - rect.top - offsetY
  if (localX < 0 || localY < 0 || localX >= drawW || localY >= drawH) return false

  const hit = getImageHitCanvas(img)
  if (!hit) return true
  const natX = Math.min(natW - 1, Math.max(0, Math.floor(localX / scale)))
  const natY = Math.min(natH - 1, Math.max(0, Math.floor(localY / scale)))
  try {
    const pixel = hit.context.getImageData(natX, natY, 1, 1).data
    return pixel[3] > threshold
  } catch {
    return true
  }
}

function jellyPointerHit(node, clientX, clientY) {
  const img = node.querySelector('img')
  if (img) return imageAlphaHit(img, clientX, clientY)
  // Fallback puff clouds: treat the jelly bounds as solid enough
  const rect = node.getBoundingClientRect()
  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  )
}

const jellyRegistry = new Map()

/** Topmost jelly with an opaque pixel under the cursor (skips transparent overlaps). */
function pickOpaqueJellyAt(clientX, clientY) {
  const stack = document.elementsFromPoint(clientX, clientY)
  const seen = new Set()
  for (const el of stack) {
    const jelly = el.closest?.('.weather-jelly')
    if (!jelly || seen.has(jelly) || !jellyRegistry.has(jelly)) continue
    seen.add(jelly)
    if (jellyPointerHit(jelly, clientX, clientY)) return jelly
  }
  return null
}

let weatherDragZ = 10

function WeatherJelly({
  enabled = true,
  stayWhereDropped = false,
  className = '',
  label,
  children,
}) {
  const rootRef = useRef(null)
  const stayRef = useRef(stayWhereDropped)
  stayRef.current = stayWhereDropped
  const stateRef = useRef({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    sx: 1,
    sy: 1,
    svx: 0,
    svy: 0,
    rot: 0,
    rv: 0,
    dragging: false,
    pointerId: null,
    lastX: 0,
    lastY: 0,
    originX: 0,
    originY: 0,
    startX: 0,
    startY: 0,
    awake: false,
  })
  const [dragging, setDragging] = useState(false)
  const [hot, setHot] = useState(false)

  const applyTransform = useEffectEvent(() => {
    const node = rootRef.current
    const s = stateRef.current
    if (!node) return
    node.style.transform = `translate3d(${s.x.toFixed(2)}px, ${s.y.toFixed(2)}px, 0) rotate(${s.rot.toFixed(2)}deg) scale(${s.sx.toFixed(3)}, ${s.sy.toFixed(3)})`
  })

  const beginDrag = useEffectEvent((event) => {
    const s = stateRef.current
    const node = rootRef.current
    if (!node || s.dragging) return
    try {
      node.setPointerCapture(event.pointerId)
    } catch {
      // ignore
    }
    // Raise dragged clouds among themselves, but never lift the sun above clouds
    const cloud = node.closest('.weather-cloud')
    if (cloud) cloud.style.zIndex = String(++weatherDragZ)
    s.dragging = true
    s.awake = true
    s.pointerId = event.pointerId
    s.lastX = event.clientX
    s.lastY = event.clientY
    s.originX = s.x
    s.originY = s.y
    s.startX = event.clientX
    s.startY = event.clientY
    s.vx = 0
    s.vy = 0
    node.style.cursor = 'grabbing'
    setDragging(true)
    setHot(true)
    event.preventDefault()
    event.stopPropagation()
  })

  const syncCursor = useEffectEvent((event) => {
    const node = rootRef.current
    const s = stateRef.current
    if (!node || s.dragging) return
    const hit = pickOpaqueJellyAt(event.clientX, event.clientY)
    node.style.cursor = hit ? 'grab' : 'default'
    const over = hit === node
    setHot((prev) => (prev === over ? prev : over))
  })

  useEffect(() => {
    if (!enabled) return undefined
    const node = rootRef.current
    if (!node) return undefined
    const api = { beginDrag: (event) => beginDrag(event) }
    jellyRegistry.set(node, api)
    return () => {
      jellyRegistry.delete(node)
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return undefined

    let frame = 0
    let previous = performance.now()

    const tick = (now) => {
      frame = requestAnimationFrame(tick)
      const s = stateRef.current
      const dt = Math.min(0.033, (now - previous) / 1000 || 0.016)
      previous = now
      const stay = stayRef.current

      if (!s.dragging && !s.awake) return

      if (!s.dragging) {
        if (stay) {
          // Keep drop position; only ease out leftover motion
          s.vx *= Math.exp(-18 * dt)
          s.vy *= Math.exp(-18 * dt)
          s.x += s.vx * dt
          s.y += s.vy * dt
        } else {
          const stiffness = 220
          const damping = 22
          const ax = -stiffness * s.x - damping * s.vx
          const ay = -stiffness * s.y - damping * s.vy
          s.vx += ax * dt
          s.vy += ay * dt
          s.x += s.vx * dt
          s.y += s.vy * dt
        }

        // Jelly only from motion, not from how far it was pulled
        const targetSx = 1 + clamp(s.vx * 0.0002, -0.04, 0.04)
        const targetSy = 1 + clamp(s.vy * 0.0002, -0.04, 0.04) - clamp(Math.abs(s.vx) * 0.0001, 0, 0.03)
        const jellyStiffness = 280
        const jellyDamping = 18
        s.svx += (jellyStiffness * (targetSx - s.sx) - jellyDamping * s.svx) * dt
        s.svy += (jellyStiffness * (targetSy - s.sy) - jellyDamping * s.svy) * dt
        s.sx += s.svx * dt
        s.sy += s.svy * dt

        const targetRot = clamp(s.vx * 0.01, -3, 3)
        s.rv += (220 * (targetRot - s.rot) - 18 * s.rv) * dt
        s.rot += s.rv * dt
      } else {
        // While dragging, keep shape calm — only tiny velocity-based squash
        const targetSx = 1 + clamp(s.vx * 0.00012, -0.03, 0.03)
        const targetSy = 1 + clamp(s.vy * 0.00012, -0.03, 0.03)
        s.sx += (targetSx - s.sx) * 0.2
        s.sy += (targetSy - s.sy) * 0.2
        s.rot += (clamp(s.vx * 0.008, -2.5, 2.5) - s.rot) * 0.16
      }

      applyTransform()

      const positionSettled = stay
        ? Math.abs(s.vx) < 0.4 && Math.abs(s.vy) < 0.4
        : Math.abs(s.x) < 0.2 &&
          Math.abs(s.y) < 0.2 &&
          Math.abs(s.vx) < 0.4 &&
          Math.abs(s.vy) < 0.4

      const settled =
        !s.dragging &&
        positionSettled &&
        Math.abs(s.sx - 1) < 0.01 &&
        Math.abs(s.sy - 1) < 0.01 &&
        Math.abs(s.rot) < 0.2

      if (settled) {
        if (!stay) {
          s.x = 0
          s.y = 0
        }
        s.vx = 0
        s.vy = 0
        s.sx = 1
        s.sy = 1
        s.svx = 0
        s.svy = 0
        s.rot = 0
        s.rv = 0
        s.awake = false
        applyTransform()
      }
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [enabled])

  useEffect(() => {
    if (enabled) return
    const s = stateRef.current
    s.x = 0
    s.y = 0
    s.vx = 0
    s.vy = 0
    s.sx = 1
    s.sy = 1
    s.rot = 0
    s.dragging = false
    s.awake = false
    applyTransform()
  }, [enabled])

  if (!enabled) {
    return <div className={className}>{children}</div>
  }

  const onPointerDown = (event) => {
    if (event.button !== 0) return
    const node = rootRef.current
    if (!node) return
    const hit = pickOpaqueJellyAt(event.clientX, event.clientY)
    if (!hit) return
    if (hit !== node) {
      jellyRegistry.get(hit)?.beginDrag(event)
      return
    }
    beginDrag(event)
  }

  const onPointerMove = (event) => {
    const s = stateRef.current
    if (!s.dragging) {
      syncCursor(event)
      return
    }
    if (s.pointerId !== event.pointerId) return
    const dx = event.clientX - s.startX
    const dy = event.clientY - s.startY
    const nextX = s.originX + dx
    const nextY = s.originY + dy
    s.vx = (event.clientX - s.lastX) * 18
    s.vy = (event.clientY - s.lastY) * 18
    s.lastX = event.clientX
    s.lastY = event.clientY
    s.x = nextX
    s.y = nextY

    // Light jelly response when moving quickly
    const shake = clamp(Math.hypot(s.vx, s.vy) / 2200, 0, 0.18)
    if (shake > 0.1) {
      s.svx += (Math.random() > 0.5 ? 1 : -1) * shake * 1.6
      s.svy += (Math.random() > 0.5 ? 1 : -1) * shake * 1.4
      s.sx = clamp(s.sx + s.vx * 0.00008, 0.92, 1.1)
      s.sy = clamp(s.sy - s.vx * 0.00006, 0.92, 1.1)
    }
    applyTransform()
  }

  const endDrag = (event) => {
    const s = stateRef.current
    if (!s.dragging || (event && s.pointerId !== event.pointerId)) return
    s.dragging = false
    s.pointerId = null
    s.awake = true
    // Soft jelly kick from release velocity
    s.svx += clamp(s.vx * 0.0012, -2.5, 2.5)
    s.svy += clamp(-s.vx * 0.0008 + s.vy * 0.0006, -2.5, 2.5)
    setDragging(false)
    const node = rootRef.current
    if (event && node?.hasPointerCapture?.(event.pointerId)) {
      node.releasePointerCapture(event.pointerId)
    }
    if (event) syncCursor(event)
  }

  const onPointerLeave = () => {
    const node = rootRef.current
    const s = stateRef.current
    if (!node || s.dragging) return
    node.style.cursor = 'default'
    setHot(false)
  }

  return (
    <div
      ref={rootRef}
      className={`weather-jelly${dragging ? ' is-dragging' : ''}${hot ? ' is-over' : ''}${className ? ` ${className}` : ''}`}
      role="button"
      tabIndex={0}
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={onPointerLeave}
    >
      {children}
    </div>
  )
}

function WeatherCloud({ index, src, interactive }) {
  const [fallback, onError] = useImageFallback(src)

  return (
    <div
      className={`weather-cloud cloud-${index}${fallback ? ' is-fallback' : ' is-image'}${interactive ? ' is-interactive' : ''}`}
    >
      <WeatherJelly
        enabled={interactive}
        stayWhereDropped
        label={`Drag cloud ${index}`}
      >
        <div className="weather-cloud-body">
          {fallback ? (
            <>
              <i />
              <i />
              <i />
              <i />
            </>
          ) : (
            <img src={src} alt="" draggable={false} onError={onError} />
          )}
        </div>
      </WeatherJelly>
    </div>
  )
}

function WeatherSun({ interactive }) {
  const [fallback, onError] = useImageFallback(SUN_SRC)

  return (
    <div className={`weather-sun${fallback ? ' is-fallback' : ' is-image'}${interactive ? ' is-interactive' : ''}`}>
      <WeatherJelly enabled={interactive} label="Drag the sun">
        {fallback ? (
          <>
            <span className="weather-sun-core" />
            <span className="weather-sun-rays" />
          </>
        ) : (
          <img src={SUN_SRC} alt="" draggable={false} onError={onError} />
        )}
      </WeatherJelly>
    </div>
  )
}

function WeatherMoon({ interactive }) {
  const [fallback, onError] = useImageFallback(MOON_SRC)

  return (
    <div className={`weather-moon${fallback ? ' is-fallback' : ' is-image'}${interactive ? ' is-interactive' : ''}`}>
      <WeatherJelly enabled={interactive} label="Drag the moon">
        {fallback ? (
          <span className="weather-moon-core" />
        ) : (
          <img src={MOON_SRC} alt="" draggable={false} onError={onError} />
        )}
      </WeatherJelly>
    </div>
  )
}

function WeatherBolt() {
  const [fallback, onError] = useImageFallback(LIGHTNING_SRC)

  return (
    <div className={`weather-bolt${fallback ? ' is-fallback' : ' is-image'}`} aria-hidden="true">
      {fallback ? null : <img src={LIGHTNING_SRC} alt="" draggable={false} onError={onError} />}
    </div>
  )
}

function WeatherCityPicker({ cityId, onChange }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const listRef = useRef(null)
  const city = cityById(cityId)

  useEffect(() => {
    if (!open) return undefined

    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (!open || !listRef.current) return
    const active = listRef.current.querySelector('[aria-selected="true"]')
    active?.scrollIntoView({ block: 'nearest' })
  }, [open, cityId])

  return (
    <div className={`weather-place${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="weather-city"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Weather location"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="weather-city-label">{cityLabel(city)}</span>
        <span className="weather-city-caret" aria-hidden="true" />
      </button>
      {open ? (
        <ul
          className="weather-city-list"
          ref={listRef}
          role="listbox"
          aria-label="Cities"
        >
          {CITIES.map((item, index) => {
            const selected = item.id === cityId
            const showDefaultDivider =
              index === 0 && item.id === DEFAULT_CITY_ID && CITIES.length > 1
            return (
              <Fragment key={item.id}>
                <li role="option" aria-selected={selected}>
                  <button
                    type="button"
                    className={selected ? 'is-selected' : undefined}
                    onClick={() => {
                      onChange(item.id)
                      setOpen(false)
                    }}
                  >
                    <span className="weather-city-name">{item.name}</span>
                    <span className="weather-city-country">{item.country}</span>
                  </button>
                </li>
                {showDefaultDivider ? (
                  <li className="weather-city-divider" role="presentation" />
                ) : null}
              </Fragment>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

function WeatherPreviewPicker({ preview, onChange }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const selected = PREVIEW_SCENES.find((item) => item.id === preview) || PREVIEW_SCENES[0]

  useEffect(() => {
    if (!open) return undefined

    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className={`weather-previews${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className={[
          'weather-preview-trigger',
          selected.id === 'live' ? 'is-live' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Weather scene"
        onClick={() => setOpen((prev) => !prev)}
      >
        {selected.id === 'live' ? <span className="weather-live-dot" aria-hidden="true" /> : null}
        <span className="weather-preview-label">{selected.label}</span>
        <span className="weather-preview-caret" aria-hidden="true" />
      </button>
      {open ? (
        <ul className="weather-preview-list" role="listbox" aria-label="Weather scenes">
          {PREVIEW_SCENES.map((item) => {
            const isSelected = item.id === preview
            return (
              <li key={item.id} role="option" aria-selected={isSelected}>
                <button
                  type="button"
                  className={[
                    isSelected ? 'is-selected' : '',
                    item.id === 'live' ? 'is-live' : '',
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined}
                  onClick={() => {
                    onChange(item.id)
                    setOpen(false)
                  }}
                >
                  {item.id === 'live' ? (
                    <span className="weather-live-dot" aria-hidden="true" />
                  ) : null}
                  {item.label}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

const SWIPE_MS = 580
const CROSSFADE_MS = 500

function celestialForScene(scene, isDay) {
  if (scene !== 'clear' && scene !== 'partly') return null
  return isDay ? 'sun' : 'moon'
}

function WeatherBackdrop({ scene, isDay, phase, fading }) {
  return (
    <div
      className={[
        'weather-backdrop',
        `is-${scene}`,
        isDay ? 'is-day' : 'is-night',
        phase ? `is-${phase}` : '',
        fading ? 'is-fading' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-hidden="true"
    >
      <div className="weather-sky" />
      <div className="weather-glow" />
      <div className="weather-fog" />
      <div className="weather-sheet" />
    </div>
  )
}

function WeatherSkyBodies({ scene, isDay, phase, fading, interactive }) {
  const body = celestialForScene(scene, isDay)
  const active = phase === 'active' && !fading

  return (
    <div
      className={[
        'weather-sky-bodies',
        phase ? `is-${phase}` : 'is-active',
        fading ? 'is-fading' : '',
        body ? `has-${body}` : 'is-empty',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-hidden="true"
    >
      {body === 'sun' ? <WeatherSun interactive={interactive && active} /> : null}
      {body === 'moon' ? <WeatherMoon interactive={interactive && active} /> : null}
    </div>
  )
}

export default function WeatherApp({ variant = 'studio' }) {
  const [cityId, setCityId] = useState(DEFAULT_CITY_ID)
  const [weatherCityId, setWeatherCityId] = useState(DEFAULT_CITY_ID)
  const [weather, setWeather] = useState(null)
  const [status, setStatus] = useState('loading')
  const [flash, setFlash] = useState(false)
  const [preview, setPreview] = useState('live')
  const [metaOpen, setMetaOpen] = useState(false)
  const [backdrops, setBackdrops] = useState(() => [
    { id: 0, scene: 'partly', isDay: true, phase: 'active' },
  ])
  const previewRef = useRef('live')
  const weatherCityRef = useRef(DEFAULT_CITY_ID)
  const backdropIdRef = useRef(1)
  const card = variant === 'card'
  const city = cityById(cityId)
  const clock = useCityClock(city.tz)

  useEffect(() => {
    let alive = true
    const selected = cityById(cityId)

    async function load() {
      try {
        const response = await fetch(weatherApiUrl(selected))
        if (!response.ok) throw new Error(`Weather ${response.status}`)
        const data = await response.json()
        if (!alive) return
        setWeather(data.current)
        setWeatherCityId(selected.id)
        setStatus('ready')
      } catch {
        if (!alive) return
        setStatus((prev) => (prev === 'ready' ? 'ready' : 'error'))
      }
    }

    setStatus('loading')
    // Keep prior weather on screen so city changes can crossfade into the new forecast
    load()
    const timer = window.setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [cityId])

  const liveCode = weather?.weather_code ?? 2
  const scene = preview === 'live' ? sceneFromCode(liveCode) : preview
  const isDay =
    preview === 'storm' || preview === 'fog'
      ? false
      : preview === 'live' && weather
        ? weather.is_day !== 0
        : clock.isDay
  const wet =
    scene === 'rain' || scene === 'drizzle' || scene === 'storm' || scene === 'snow'
  const intensity =
    preview === 'live'
      ? scene === 'snow'
        ? snowIntensity(liveCode, weather?.precipitation ?? 0)
        : rainIntensity(liveCode, weather?.precipitation ?? 0)
      : scene === 'storm'
        ? 1
        : scene === 'rain'
          ? 0.75
          : scene === 'snow'
            ? 0.7
            : 0.35

  useEffect(() => {
    const previewChanged = previewRef.current !== preview
    const previousPreview = previewRef.current
    const cityChanged = weatherCityRef.current !== weatherCityId

    const isOutgoing = (layer) =>
      layer.cloudFade ||
      layer.fading ||
      layer.phase === 'exit-left' ||
      layer.phase === 'exit-right'

    const frontLayer = (layers) =>
      [...layers].reverse().find((layer) => !isOutgoing(layer)) || layers[layers.length - 1]

    const settleLayer = (nextId, delay) => {
      const timer = window.setTimeout(() => {
        setBackdrops((prev) => {
          const kept = prev.find((layer) => layer.id === nextId)
          if (!kept) return prev
          return [{ ...kept, scene, isDay, phase: 'active', fading: false, cloudFade: false }]
        })
      }, delay)
      return () => window.clearTimeout(timer)
    }

    if (!previewChanged && !cityChanged) {
      setBackdrops((prev) => {
        const active = frontLayer(prev)
        if (!active) return [{ id: 0, scene, isDay, phase: 'active' }]
        if (active.scene === scene && active.isDay === isDay) return prev
        return prev.map((layer) =>
          layer.id === active.id ? { ...layer, scene, isDay } : layer,
        )
      })
      return undefined
    }

    if (cityChanged) {
      weatherCityRef.current = weatherCityId
      if (!weather) return undefined

      const nextId = backdropIdRef.current++
      setBackdrops((prev) => {
        const outgoing = prev.map((layer) => ({
          ...layer,
          fading: true,
          cloudFade: true,
        }))
        return [
          ...outgoing,
          {
            id: nextId,
            scene,
            isDay,
            phase: 'enter-fade',
            fading: false,
            cloudFade: false,
          },
        ]
      })
      return settleLayer(nextId, CROSSFADE_MS)
    }

    const fromIndex = PREVIEW_SCENES.findIndex((item) => item.id === previousPreview)
    const toIndex = PREVIEW_SCENES.findIndex((item) => item.id === preview)
    const fromRight = toIndex > fromIndex
    previewRef.current = preview

    const nextId = backdropIdRef.current++
    setBackdrops((prev) => {
      const active = frontLayer(prev)
      if (!active) {
        return [{ id: nextId, scene, isDay, phase: 'active' }]
      }
      if (active.scene === scene && active.isDay === isDay && !isOutgoing(active)) {
        return prev.map((layer) =>
          layer.id === active.id
            ? { ...layer, scene, isDay, phase: 'active', fading: false, cloudFade: false }
            : layer,
        )
      }

      // Keep every in-flight layer; old clouds always fade out
      const outgoing = prev.map((layer) => {
        if (isOutgoing(layer)) return { ...layer, cloudFade: true }
        if (layer.phase === 'enter-left' || layer.phase === 'enter-right') {
          return { ...layer, fading: true, cloudFade: true }
        }
        return {
          ...layer,
          phase: fromRight ? 'exit-left' : 'exit-right',
          fading: false,
          cloudFade: true,
        }
      })

      return [
        ...outgoing,
        {
          id: nextId,
          scene,
          isDay,
          phase: fromRight ? 'enter-right' : 'enter-left',
          fading: false,
          cloudFade: false,
        },
      ]
    })

    return settleLayer(nextId, SWIPE_MS)
  }, [preview, scene, isDay, weatherCityId, weather])

  useEffect(() => {
    if (scene !== 'storm' || card) {
      setFlash(false)
      return undefined
    }

    let timeout = 0
    const schedule = () => {
      const wait = 1800 + Math.random() * 4200
      timeout = window.setTimeout(() => {
        setFlash(true)
        window.setTimeout(() => setFlash(false), 90 + Math.random() * 120)
        if (Math.random() > 0.55) {
          window.setTimeout(() => {
            setFlash(true)
            window.setTimeout(() => setFlash(false), 70)
          }, 140)
        }
        schedule()
      }, wait)
    }
    schedule()
    return () => window.clearTimeout(timeout)
  }, [scene, card])

  const classes = [
    'weather-app',
    card ? 'is-card' : 'is-studio',
    `is-${scene}`,
    isDay ? 'is-day' : 'is-night',
    flash ? 'is-flash' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const conditionLabel =
    preview === 'live' ? labelFromCode(liveCode) : PREVIEW_LABEL[preview]

  return (
    <div
      className={classes}
      style={{ '--weather-sky-bright': String(clock.bright) }}
      aria-label={
        weather
          ? `${city.name} weather: ${labelFromCode(liveCode)}, ${Math.round(weather.temperature_2m)} degrees`
          : `${city.name} weather loading`
      }
    >
      <div className="weather-backdrops">
        {backdrops.map((layer) => (
          <WeatherBackdrop
            key={layer.id}
            scene={layer.scene}
            isDay={layer.isDay}
            phase={layer.phase}
            fading={layer.fading}
          />
        ))}
      </div>
      {backdrops.map((layer) => (
        <WeatherSkyBodies
          key={`sky-bodies-${layer.id}`}
          scene={layer.scene}
          isDay={layer.isDay}
          phase={layer.phase}
          fading={layer.fading}
          interactive={!card}
        />
      ))}
      {backdrops.map((layer) => (
        <div
          key={`clouds-${layer.id}`}
          className={[
            'weather-clouds',
            layer.phase ? `is-${layer.phase}` : 'is-active',
            layer.cloudFade || layer.fading ? 'is-fading' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-hidden={layer.phase !== 'active' || layer.cloudFade || layer.fading ? true : undefined}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <WeatherCloud
              key={n}
              index={n}
              src={cloudSrcForScene(layer.scene)}
              interactive={
                !card && layer.phase === 'active' && !layer.cloudFade && !layer.fading
              }
            />
          ))}
        </div>
      ))}
      <WeatherParticles
        scene={scene}
        intensity={intensity}
        windSpeed={weather?.wind_speed_10m ?? (scene === 'storm' ? 40 : 12)}
        active={wet}
      />
      <div className="weather-lightning" aria-hidden="true" />
      <WeatherBolt />

      {!card ? (
        <>
          <div className="weather-top">
            <p className="weather-clock" aria-live="polite">
              {clock.label}
            </p>
            {preview === 'live' ? (
              <div className="weather-top-city">
                <WeatherCityPicker cityId={cityId} onChange={setCityId} />
              </div>
            ) : null}
          </div>
          <WeatherPreviewPicker preview={preview} onChange={setPreview} />
        </>
      ) : null}

      <div className="weather-panel">
        {card ? (
          status === 'ready' && weather ? (
            <>
              <p className="weather-temp">
                {Math.round(weather.temperature_2m)}
                <span>°</span>
              </p>
              <p className="weather-label">{labelFromCode(liveCode)}</p>
            </>
          ) : (
            <p className="weather-status">{city.name}</p>
          )
        ) : (
          <>
            {preview === 'live' ? (
              <div className="weather-panel-city">
                <WeatherCityPicker cityId={cityId} onChange={setCityId} />
              </div>
            ) : null}
            {status === 'loading' && !weather ? (
              <p className="weather-status">Reading the sky…</p>
            ) : status === 'error' && !weather ? (
              <p className="weather-status">Couldn’t reach the forecast.</p>
            ) : (
              <>
                <p className={`weather-temp${metaOpen ? ' is-compact' : ''}`}>
                  {Math.round(weather.temperature_2m)}
                  <span>°</span>
                </p>
                <div className="weather-condition">
                  <p className="weather-label">{conditionLabel}</p>
                  <button
                    type="button"
                    className={`weather-meta-toggle${metaOpen ? ' is-open' : ''}`}
                    aria-expanded={metaOpen}
                    aria-controls="weather-meta-details"
                    onClick={() => setMetaOpen((prev) => !prev)}
                  >
                    <span className="weather-meta-toggle-icon" aria-hidden="true" />
                    <span className="visually-hidden">
                      {metaOpen ? 'Hide weather details' : 'Show weather details'}
                    </span>
                  </button>
                </div>
                <div
                  id="weather-meta-details"
                  className={`weather-meta-wrap${metaOpen ? ' is-open' : ''}`}
                >
                  <dl className="weather-meta">
                    <div>
                      <dt>Feels</dt>
                      <dd>{Math.round(weather.apparent_temperature)}°</dd>
                    </div>
                    <div>
                      <dt>Wind</dt>
                      <dd>
                        {Math.round(weather.wind_speed_10m)} {windLabel(weather.wind_direction_10m)}
                      </dd>
                    </div>
                    <div>
                      <dt>Humidity</dt>
                      <dd>{weather.relative_humidity_2m}%</dd>
                    </div>
                    <div>
                      <dt>Cloud</dt>
                      <dd>{weather.cloud_cover}%</dd>
                    </div>
                  </dl>
                </div>
                <p className="weather-updated">
                  {preview === 'live'
                    ? `Live · updated ${formatTime(weather.time, city.tz)}`
                    : `Preview · live is ${labelFromCode(liveCode).toLowerCase()}`}
                </p>
              </>
            )}
          </>
        )}
      </div>

      {!card ? (
        <a
          className="weather-source"
          href="https://open-meteo.com/"
          target="_blank"
          rel="noreferrer"
        >
          Data from Open-Meteo
          <span aria-hidden="true">↗</span>
        </a>
      ) : null}
    </div>
  )
}
