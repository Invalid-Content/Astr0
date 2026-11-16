import * as THREE from 'three'

const PHI_START = -Math.PI
const RING_Y = -0.74
const VISOR_X = 0.84
const VISOR_Y = 0.62
const VISOR_CY = -0.06

function smoothstep(edge0, edge1, value) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function sampleProfile(t) {
  const theta = Math.PI * (1 - t)
  return [Math.max(0.02, Math.sin(theta) * 0.9), Math.cos(theta) * 0.96]
}

function buildPoints(steps) {
  const points = []
  for (let index = 0; index <= steps; index++) {
    const [radius, y] = sampleProfile(index / steps)
    points.push(new THREE.Vector2(radius, y))
  }
  return points
}

function visorOval(x, y) {
  return Math.hypot(x / VISOR_X, (y - VISOR_CY) / VISOR_Y)
}

function visorAmount(x, y, z) {
  return smoothstep(1.08, 0.82, visorOval(x, y)) * smoothstep(0.05, 0.42, z)
}

function shapeVertex(x, y, z) {
  let px = x
  let py = y
  let pz = z

  const visor = visorAmount(x, y, z)
  pz += visor * 0.26

  const radial = Math.hypot(px, pz) || 1
  const ring = Math.exp(-((y - RING_Y) ** 2) / 0.007)
  px += (px / radial) * ring * 0.16
  pz += (pz / radial) * ring * 0.16
  py -= ring * 0.02

  return [px, py, pz]
}

function mix(a, b, t) {
  const k = Math.min(1, Math.max(0, t))
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
}

function createHelmetTextures() {
  const width = 1400
  const height = 700
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const glowCanvas = document.createElement('canvas')
  glowCanvas.width = width
  glowCanvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const glowContext = glowCanvas.getContext('2d', { willReadFrequently: true })
  const image = context.createImageData(width, height)
  const glow = glowContext.createImageData(width, height)
  const data = image.data
  const glowData = glow.data

  const shell = [242, 244, 246]
  const shade = [198, 206, 214]
  const visorDeep = [92, 52, 16]
  const visorGold = [214, 138, 42]
  const visorBright = [255, 220, 150]

  for (let py = 0; py < height; py++) {
    const v = 1 - (py + 0.5) / height
    const [radius, y] = sampleProfile(v)
    for (let px = 0; px < width; px++) {
      const u = (px + 0.5) / width
      const phi = PHI_START + u * Math.PI * 2
      const x = radius * Math.sin(phi)
      const z = radius * Math.cos(phi)
      const grain = Math.sin(px * 12.9898 + py * 78.233) * 43758.5453
      const noise = (grain - Math.floor(grain) - 0.5) * 6

      let color = mix(shade, shell, smoothstep(-0.35, 0.65, z) * 0.85 + 0.15)
      color = [color[0] + noise, color[1] + noise, color[2] + noise]
      let emission = 0

      const oval = visorOval(x, y)
      const front = smoothstep(0.02, 0.4, z)
      const visorMask = smoothstep(1.06, 0.84, oval) * front
      const rimMask = smoothstep(0.12, 0.02, Math.abs(oval - 1)) * front
      const streak = Math.exp(-((x * 0.25 + (y - 0.12)) ** 2) / 0.02) * visorMask
      const glint = Math.exp(-((x + 0.18) ** 2) / 0.016 - ((y - 0.14) ** 2) / 0.012) * visorMask
      color = mix(color, visorDeep, visorMask)
      color = mix(color, visorGold, visorMask * smoothstep(0.1, 0.75, z))
      color = mix(color, visorBright, streak * 0.85)
      color = mix(color, [255, 248, 236], glint)
      color = mix(color, [250, 252, 255], rimMask)
      color = mix(color, [120, 128, 136], smoothstep(0.03, 0, Math.abs(oval - 0.98)) * front)

      const ring = Math.exp(-((y - RING_Y) ** 2) / 0.005)
      color = mix(color, [154, 162, 172], ring)
      color = mix(color, [214, 220, 226], ring * smoothstep(0.55, 0.85, Math.abs(Math.sin((Math.atan2(x, z) * 10)))) * 0.45)

      const lamp = Math.exp(-((x - 0.28) ** 2) / 0.006 - ((y - 0.72) ** 2) / 0.005) * smoothstep(0.15, 0.55, z)
      color = mix(color, [255, 214, 150], lamp)
      emission = Math.max(emission, lamp)

      const index = (py * width + px) * 4
      data[index] = Math.min(255, Math.max(0, color[0]))
      data[index + 1] = Math.min(255, Math.max(0, color[1]))
      data[index + 2] = Math.min(255, Math.max(0, color[2]))
      data[index + 3] = 255
      const glowByte = Math.min(255, Math.max(0, emission * 255))
      glowData[index] = glowByte
      glowData[index + 1] = glowByte
      glowData[index + 2] = glowByte
      glowData[index + 3] = 255
    }
  }

  context.putImageData(image, 0, 0)
  glowContext.putImageData(glow, 0, 0)

  const map = new THREE.CanvasTexture(canvas)
  map.colorSpace = THREE.SRGBColorSpace
  map.wrapS = THREE.RepeatWrapping
  map.anisotropy = 8
  map.needsUpdate = true

  const emissiveMap = new THREE.CanvasTexture(glowCanvas)
  emissiveMap.colorSpace = THREE.SRGBColorSpace
  emissiveMap.wrapS = THREE.RepeatWrapping
  emissiveMap.needsUpdate = true

  return { map, emissiveMap }
}

export function createHead(segments = 96, steps = 64) {
  const geometry = new THREE.LatheGeometry(buildPoints(steps), segments, PHI_START, Math.PI * 2)
  const position = geometry.attributes.position

  for (let index = 0; index < position.count; index++) {
    const [x, y, z] = shapeVertex(position.getX(index), position.getY(index), position.getZ(index))
    position.setXYZ(index, x, y, z)
  }

  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.translate(0, -geometry.boundingBox.getCenter(new THREE.Vector3()).y, 0)
  geometry.userData.rest = new Float32Array(position.array)
  geometry.computeBoundingSphere()

  return { geometry, ...createHelmetTextures() }
}
