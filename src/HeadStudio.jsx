import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import spacemanUrl from '../spaceman.glb?url'

const PULL_REACH = 0.16

function createShadowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const context = canvas.getContext('2d')
  const gradient = context.createRadialGradient(128, 128, 16, 128, 128, 120)
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.55)')
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 256, 256)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function createSky() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDirection;
      void main() {
        vec3 dir = normalize(vDirection);
        float lift = dir.y * 0.5 + 0.5;
        vec3 ground = vec3(0.008, 0.010, 0.018);
        vec3 horizon = vec3(0.035, 0.048, 0.086);
        vec3 zenith = vec3(0.008, 0.012, 0.028);
        vec3 color = mix(ground, horizon, smoothstep(0.08, 0.5, lift));
        color = mix(color, zenith, smoothstep(0.5, 1.0, lift));
        float glow = pow(max(dot(dir, vec3(0.0, 0.08, -1.0)), 0.0), 2.2);
        color += vec3(0.03, 0.04, 0.07) * glow;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  })
  const sky = new THREE.Mesh(new THREE.SphereGeometry(42, 32, 20), material)
  sky.renderOrder = -2
  sky.frustumCulled = false
  return sky
}

function createStarfield(count, pixelRatio) {
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const phases = new Float32Array(count)
  const color = new THREE.Color()

  for (let index = 0; index < count; index++) {
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    const radius = 15 + Math.random() * 7
    positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta)
    positions[index * 3 + 1] = radius * Math.cos(phi)
    positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta)

    const roll = Math.random()
    if (roll > 0.93) color.set('#d5e2ff')
    else if (roll > 0.86) color.set('#ffe4c4')
    else color.setScalar(0.78 + Math.random() * 0.22)
    colors[index * 3] = color.r
    colors[index * 3 + 1] = color.g
    colors[index * 3 + 2] = color.b
    sizes[index] = Math.random() < 0.06 ? 2.4 + Math.random() * 1.6 : 0.7 + Math.random() * 1.1
    phases[index] = Math.random() * Math.PI * 2
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: 56 * pixelRatio },
    },
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    vertexShader: `
      attribute float aSize;
      attribute float aPhase;
      varying vec3 vColor;
      varying float vTwinkle;
      uniform float uTime;
      uniform float uSize;
      void main() {
        vColor = color;
        vTwinkle = 0.62 + 0.38 * sin(uTime * (0.45 + aPhase * 0.15) + aPhase);
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uSize * (1.0 / -viewPosition.z) * (0.8 + 0.2 * vTwinkle);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        vec2 point = gl_PointCoord - 0.5;
        float distance = length(point);
        if (distance > 0.5) discard;
        float glow = smoothstep(0.5, 0.05, distance);
        gl_FragColor = vec4(vColor, glow * vTwinkle);
      }
    `,
  })

  const stars = new THREE.Points(geometry, material)
  stars.renderOrder = -1
  stars.frustumCulled = false
  return stars
}

function disposeObject(root) {
  root.traverse((object) => {
    if (!object.isMesh) return
    object.geometry.dispose()
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value && value.isTexture) value.dispose()
      }
      material.dispose()
    }
  })
}

export default function HeadStudio({ variant = 'studio' }) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    const studio = variant === 'studio'
    let alive = true

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x070b16, 1)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.12

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50)
    camera.position.set(0, 0.16, studio ? 5.45 : 4.35)

    const sky = createSky()
    scene.add(sky)
    const stars = createStarfield(studio ? 980 : 520, renderer.getPixelRatio())
    scene.add(stars)

    const pose = new THREE.Group()
    pose.rotation.y = studio ? 0.2 : 0.45
    const float = new THREE.Group()
    float.add(pose)
    scene.add(float)

    const shadowTexture = createShadowTexture()
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.72, 48),
      new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }),
    )
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = -1.15
    scene.add(shadow)

    scene.add(new THREE.AmbientLight(0xf4f7fb, 0.7))
    const key = new THREE.DirectionalLight(0xfff8f0, 2.6)
    key.position.set(2.4, 3.6, 4.4)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xc5d4e8, 0.85)
    fill.position.set(-3.2, 1.1, 2.2)
    scene.add(fill)
    const rim = new THREE.DirectionalLight(0xffffff, 0.9)
    rim.position.set(-1.6, 2.2, -3.2)
    scene.add(rim)

    const parts = []
    let modelRoot = null
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const plane = new THREE.Plane()
    const planeNormal = new THREE.Vector3()
    const hitPoint = new THREE.Vector3()
    const startPoint = new THREE.Vector3()
    const dragPoint = new THREE.Vector3()
    const localHit = new THREE.Vector3()
    const grabModel = new THREE.Vector3()
    const modelDelta = new THREE.Vector3()
    const scratch = new THREE.Vector3()
    const scratchStart = new THREE.Vector3()

    let pulling = false
    let turning = false
    let holding = false
    let lastX = 0
    let lastY = 0
    let bob = 0
    let roll = 0
    let bobHold = 0
    let rollHold = 0
    let previous = performance.now()

    function resize() {
      const width = container.clientWidth
      const height = container.clientHeight
      if (!width || !height) return
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
    }

    function setPointer(event) {
      const rect = canvas.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    }

    function partFromMesh(mesh) {
      return parts.find((part) => part.mesh === mesh) || null
    }

    function nearestVertex(part, localPoint) {
      const { position } = part
      let best = 0
      let bestDistance = Infinity
      for (let index = 0; index < position.count; index++) {
        const dx = position.getX(index) - localPoint.x
        const dy = position.getY(index) - localPoint.y
        const dz = position.getZ(index) - localPoint.z
        const distance = dx * dx + dy * dy + dz * dz
        if (distance < bestDistance) {
          bestDistance = distance
          best = index
        }
      }
      return best
    }

    function captureModelPositions(part, into) {
      for (let index = 0; index < part.position.count; index++) {
        scratch.fromBufferAttribute(part.position, index).applyMatrix4(part.meshInModel)
        const offset = index * 3
        into[offset] = scratch.x
        into[offset + 1] = scratch.y
        into[offset + 2] = scratch.z
      }
    }

    function spring(dt) {
      const hold = pulling && modelRoot
      const stiffness = hold ? 86 : 18
      const damping = hold ? 20 : 4.4
      const decay = Math.exp(-damping * dt)
      const sigma = PULL_REACH
      const gx = grabModel.x
      const gy = grabModel.y
      const gz = grabModel.z

      for (const part of parts) {
        if (!hold && !part.awake) continue

        const { position, rest, velocity, geometry, restInModel, modelToLocal, dragStartModel } = part
        let moved = false

        for (let index = 0; index < position.count; index++) {
          const offset = index * 3
          let targetX = rest[offset]
          let targetY = rest[offset + 1]
          let targetZ = rest[offset + 2]

          if (hold && dragStartModel) {
            const mx = restInModel[offset]
            const my = restInModel[offset + 1]
            const mz = restInModel[offset + 2]
            const dx = mx - gx
            const dy = my - gy
            const dz = mz - gz
            const weight = Math.exp(-(dx * dx + dy * dy + dz * dz) / (sigma * sigma))
            scratch.set(
              mx + (dragStartModel[offset] - mx + modelDelta.x) * weight,
              my + (dragStartModel[offset + 1] - my + modelDelta.y) * weight,
              mz + (dragStartModel[offset + 2] - mz + modelDelta.z) * weight,
            ).applyMatrix4(modelToLocal)
            targetX = scratch.x
            targetY = scratch.y
            targetZ = scratch.z
          }

          const x = position.getX(index)
          const y = position.getY(index)
          const z = position.getZ(index)
          const vx = (velocity[offset] + (targetX - x) * stiffness * dt) * decay
          const vy = (velocity[offset + 1] + (targetY - y) * stiffness * dt) * decay
          const vz = (velocity[offset + 2] + (targetZ - z) * stiffness * dt) * decay
          velocity[offset] = vx
          velocity[offset + 1] = vy
          velocity[offset + 2] = vz
          if (vx * vx + vy * vy + vz * vz > 1e-8) moved = true
          position.setXYZ(index, x + vx * dt, y + vy * dt, z + vz * dt)
        }

        part.awake = moved || hold
        if (!part.awake) continue
        position.needsUpdate = true
        geometry.computeVertexNormals()
        if (hold) geometry.computeBoundingSphere()
      }
    }

    function onPointerDown(event) {
      if (!studio || event.button !== 0 || parts.length === 0) return
      try {
        canvas.setPointerCapture(event.pointerId)
      } catch {
        // Synthetic or already-released pointers cannot be captured.
      }
      setPointer(event)
      lastX = event.clientX
      lastY = event.clientY
      holding = true
      bobHold = bob
      rollHold = roll
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(parts.map((part) => part.mesh), false)[0]

      if (hit) {
        const part = partFromMesh(hit.object)
        pulling = true
        turning = false
        modelDelta.set(0, 0, 0)
        for (const piece of parts) {
          piece.dragStartModel = new Float32Array(piece.restInModel.length)
          piece.awake = true
          captureModelPositions(piece, piece.dragStartModel)
        }
        hitPoint.copy(hit.point)
        camera.getWorldDirection(planeNormal)
        plane.setFromNormalAndCoplanarPoint(planeNormal, hitPoint)
        startPoint.copy(hitPoint)
        localHit.copy(hit.point)
        part.mesh.worldToLocal(localHit)
        part.grabIndex = nearestVertex(part, localHit)
        const grabOffset = part.grabIndex * 3
        grabModel.set(
          part.restInModel[grabOffset],
          part.restInModel[grabOffset + 1],
          part.restInModel[grabOffset + 2],
        )
        canvas.dataset.cursor = 'grabbing'
        return
      }

      pulling = false
      turning = true
      canvas.dataset.cursor = 'grabbing'
    }

    function onPointerMove(event) {
      if (!studio) return
      setPointer(event)
      if (!pulling && !turning) {
        if (parts.length === 0) return
        raycaster.setFromCamera(pointer, camera)
        const hovering = raycaster.intersectObjects(parts.map((part) => part.mesh), false).length > 0
        canvas.dataset.cursor = hovering ? 'grab' : ''
        return
      }

      if (pulling && modelRoot) {
        raycaster.setFromCamera(pointer, camera)
        if (!raycaster.ray.intersectPlane(plane, dragPoint)) return
        modelRoot.updateWorldMatrix(true, false)
        scratch.copy(dragPoint)
        scratchStart.copy(startPoint)
        modelRoot.worldToLocal(scratch)
        modelRoot.worldToLocal(scratchStart)
        modelDelta.copy(scratch).sub(scratchStart)
        return
      }

      const dx = event.clientX - lastX
      const dy = event.clientY - lastY
      lastX = event.clientX
      lastY = event.clientY
      pose.rotation.y += dx * 0.008
      pose.rotation.x = Math.min(0.9, Math.max(-0.9, pose.rotation.x + dy * 0.006))
    }

    function onPointerUp(event) {
      if (!pulling && !turning) return
      for (const part of parts) {
        part.dragStartModel = null
        if (part.awake) part.geometry.computeBoundingSphere()
      }
      pulling = false
      turning = false
      holding = false
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
      canvas.dataset.cursor = ''
    }

    function onWheel(event) {
      if (!studio) return
      event.preventDefault()
      camera.position.z = Math.min(8.2, Math.max(3.15, camera.position.z + event.deltaY * 0.004))
    }

    function onContextMenu(event) {
      event.preventDefault()
    }

    const loader = new GLTFLoader()
    loader.load(spacemanUrl, (gltf) => {
      if (!alive) {
        disposeObject(gltf.scene)
        return
      }

      const model = gltf.scene
      model.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(model)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      const fitted = new THREE.Group()
      model.position.sub(center)
      fitted.scale.setScalar(1.9 / Math.max(size.y, 0.001))
      fitted.add(model)
      pose.add(fitted)
      model.updateMatrixWorld(true)
      modelRoot = model
      const modelInverse = new THREE.Matrix4().copy(model.matrixWorld).invert()

      model.traverse((object) => {
        if (!object.isMesh) return
        const geometry = object.geometry
        const position = geometry.attributes.position
        const meshInModel = new THREE.Matrix4().multiplyMatrices(modelInverse, object.matrixWorld)
        const restInModel = new Float32Array(position.count * 3)
        for (let index = 0; index < position.count; index++) {
          scratch.fromBufferAttribute(position, index).applyMatrix4(meshInModel)
          const offset = index * 3
          restInModel[offset] = scratch.x
          restInModel[offset + 1] = scratch.y
          restInModel[offset + 2] = scratch.z
        }
        parts.push({
          mesh: object,
          geometry,
          position,
          rest: new Float32Array(position.array),
          restInModel,
          meshInModel,
          modelToLocal: meshInModel.clone().invert(),
          velocity: new Float32Array(position.count * 3),
          dragStartModel: null,
          grabIndex: 0,
          awake: false,
        })
      })
    })

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)
    resize()

    if (studio) {
      canvas.addEventListener('pointerdown', onPointerDown)
      canvas.addEventListener('pointermove', onPointerMove)
      canvas.addEventListener('pointerup', onPointerUp)
      canvas.addEventListener('pointercancel', onPointerUp)
      canvas.addEventListener('wheel', onWheel, { passive: false })
      canvas.addEventListener('contextmenu', onContextMenu)
    }

    let frame = 0
    const started = performance.now()
    function animate(now) {
      frame = requestAnimationFrame(animate)
      const dt = Math.min(0.033, (now - previous) / 1000 || 0.016)
      previous = now
      const time = (now - started) / 1000
      camera.lookAt(0, 0.08, 0)
      stars.rotation.y = time * 0.012
      stars.material.uniforms.uTime.value = time
      spring(dt)
      if (!studio) {
        float.position.y = Math.sin(time * 1.15) * 0.07
      } else {
        const bobTarget = holding ? bobHold : Math.sin(time * 1.12) * 0.07
        const rollTarget = holding ? rollHold : Math.sin(time * 0.65) * 0.018
        bob += (bobTarget - bob) * 0.08
        roll += (rollTarget - roll) * 0.08
        float.position.y = bob
        float.rotation.z = roll
      }
      shadow.position.x = pose.position.x
      shadow.position.z = pose.position.z * 0.2
      const lift = pose.position.y + float.position.y
      shadow.scale.setScalar(Math.min(1.35, Math.max(0.72, 1.05 - lift * 0.12)))
      renderer.render(scene, camera)
    }
    animate(performance.now())

    return () => {
      alive = false
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      if (studio) {
        canvas.removeEventListener('pointerdown', onPointerDown)
        canvas.removeEventListener('pointermove', onPointerMove)
        canvas.removeEventListener('pointerup', onPointerUp)
        canvas.removeEventListener('pointercancel', onPointerUp)
        canvas.removeEventListener('wheel', onWheel)
        canvas.removeEventListener('contextmenu', onContextMenu)
      }
      if (pose.children.length > 0) disposeObject(pose)
      sky.geometry.dispose()
      sky.material.dispose()
      stars.geometry.dispose()
      stars.material.dispose()
      shadow.geometry.dispose()
      shadow.material.dispose()
      shadowTexture.dispose()
      renderer.dispose()
    }
  }, [variant])

  if (variant === 'card') {
    return (
      <div className="head-studio is-card" ref={containerRef}>
        <canvas ref={canvasRef} aria-hidden="true" />
      </div>
    )
  }

  return (
    <div className="astro64-stage" ref={containerRef}>
      <canvas ref={canvasRef} aria-label="Floating astronaut. Drag the suit to pull it. It springs back." />
    </div>
  )
}
