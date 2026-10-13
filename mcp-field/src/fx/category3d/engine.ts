import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { MODELS, type Model } from './models'

/*
 * 分类 3D 图标的渲染引擎（按需加载）：页面上所有图标共用一个 WebGL 渲染器，
 * 每帧依次把各个场景画进共享画布左下角，再拷贝到各自的 2D 画布上——只占一个 WebGL 上下文，着色器也只编译一次。
 * 画布不在视口内时不画；系统要求减弱动效时只画静止的第一帧。
 * 悬停（setActive）时图标先跳起来转一圈，之后动作加快、浮动和摆动幅度加大，移开后再平滑回落。
 */

/** 共享画布的边长：单个图标的像素尺寸不会超过它 */
const MAX = 512

type View = {
  ctx: CanvasRenderingContext2D
  px: number
  scene: THREE.Scene
  model: Model
  float: THREE.Group
  shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  visible: boolean
  io: IntersectionObserver
  /** 模型自己的时间（秒）：从 0 开始，和静态图那一帧接上；悬停时走得更快 */
  clock: number
  /** 上一帧的时刻 */
  last: number
  /** 悬停的活跃度：0 平时，1 悬停，两者之间平滑过渡 */
  energy: number
  target: number
  /** 悬停瞬间那一下跳跃加转圈的进度 0..1，没有在播时为 -1 */
  pop: number
  /** 整体浮动的相位，按分类错开，几个图标不会一起上下 */
  off: number
}

export type ViewHandle = { dispose: () => void; setActive: (on: boolean) => void }

let renderer: THREE.WebGLRenderer | null = null
let env: THREE.Texture | null = null
let shadowTex: THREE.Texture | null = null
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50)
camera.position.set(0, 1.05, 6.6)
camera.lookAt(0, -0.06, 0)
const views = new Set<View>()
const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
let raf = 0

const offsetOf = (slug: string) => (Array.from(slug).reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 997, 7) % 40) / 10

function setup() {
  if (renderer) return renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
  renderer.setPixelRatio(1)
  renderer.setSize(MAX, MAX, false)
  renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  const pmrem = new THREE.PMREMGenerator(renderer)
  env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  pmrem.dispose()
  // 地面上的柔和影子：径向渐变贴图
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(0,0,0,0.55)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  shadowTex = new THREE.CanvasTexture(c)
  return renderer
}

function buildScene(id: string) {
  const scene = new THREE.Scene()
  scene.environment = env
  scene.environmentIntensity = 0.75
  const key = new THREE.DirectionalLight('#FFF4E2', 2.1)
  key.position.set(-2.6, 4.2, 3.6)
  key.castShadow = true
  key.shadow.mapSize.set(512, 512)
  key.shadow.radius = 4
  key.shadow.bias = -0.0008
  Object.assign(key.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 1, far: 12 })
  const rim = new THREE.DirectionalLight('#BFD8FF', 1.1)
  rim.position.set(3, 2.2, -3)
  scene.add(key, rim, new THREE.HemisphereLight('#FFFFFF', '#3B4252', 0.55))

  const entry = MODELS[id] ?? MODELS.other
  const model = entry.build(new THREE.Color(entry.color))
  model.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true
  })
  const float = new THREE.Group()
  float.add(model.root)
  float.rotation.y = -0.32
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }))
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = -1.2
  scene.add(float, shadow)
  return { scene, model, float, shadow }
}

/** 推进一帧的时间：活跃度向目标靠拢，模型时间按活跃度加速 */
function advance(v: View, now: number) {
  const dt = Math.min(0.05, (now - v.last) / 1000)
  v.last = now
  v.energy += (v.target - v.energy) * (1 - Math.exp(-dt * 5))
  v.clock += dt * (1 + 1.5 * v.energy)
  if (v.pop >= 0) v.pop = v.pop + dt / 0.9 >= 1 ? -1 : v.pop + dt / 0.9
}

function draw(v: View) {
  const r = renderer!
  const t = v.clock
  const e = v.energy
  v.model.update(t)
  // 整体上下浮动、左右摆动（悬停时幅度更大、略微放大），悬停瞬间跳起来转一圈；地面影子随高度缩放
  const p = v.pop >= 0 ? v.pop : 0
  const jump = v.pop >= 0 ? Math.sin(Math.PI * p) * 0.28 : 0
  const spin = v.pop >= 0 ? (1 - (1 - p) ** 3) * Math.PI * 2 : 0
  const bob = Math.sin((t + v.off) * 1.5)
  const lift = bob * (0.06 + 0.05 * e) + 0.06 * e + jump
  v.float.position.y = lift
  v.float.rotation.y = -0.32 * (1 - 0.5 * e) + Math.sin((t + v.off) * 0.6) * (0.16 + 0.14 * e) + spin
  v.float.scale.setScalar(1 + 0.06 * e)
  v.shadow.scale.setScalar(1 - lift * 0.9)
  v.shadow.material.opacity = 0.8 - lift * 1.3
  r.setViewport(0, 0, v.px, v.px)
  r.setScissor(0, 0, v.px, v.px)
  r.setScissorTest(true)
  r.clear()
  r.render(v.scene, camera)
  v.ctx.clearRect(0, 0, v.px, v.px)
  v.ctx.drawImage(r.domElement, 0, MAX - v.px, v.px, v.px, 0, 0, v.px, v.px)
}

function loop() {
  raf = 0
  const now = performance.now()
  let any = false
  for (const v of views) {
    if (!v.visible) continue
    advance(v, now)
    draw(v)
    any = true
  }
  if (any && !reduce) raf = requestAnimationFrame(loop)
}

const kick = () => {
  if (!raf && !reduce) raf = requestAnimationFrame(loop)
}

/**
 * 在画布上挂载一个 3D 图标（MODELS 的键）并开始播放；WebGL 不可用时返回 null（调用方保留静态图）。
 * canvas 的 width / height 需要事先按显示尺寸 × 设备像素比设好。
 */
export function mountView(canvas: HTMLCanvasElement, id: string): ViewHandle | null {
  try {
    setup()
  } catch {
    return null
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const px = Math.min(canvas.width, MAX)
  canvas.width = canvas.height = px
  const { scene, model, float, shadow } = buildScene(id)
  const io = new IntersectionObserver(([e]) => {
    view.visible = e.isIntersecting
    if (view.visible) kick()
  })
  const view: View = { ctx, px, scene, model, float, shadow, visible: true, io, ...rest(id) }
  views.add(view)
  draw(view)
  io.observe(canvas)
  kick()
  return {
    setActive(on) {
      if (reduce) return
      view.target = on ? 1 : 0
      if (on && view.pop < 0) view.pop = 0
      kick()
    },
    dispose() {
      io.disconnect()
      views.delete(view)
      scene.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        m.geometry.dispose()
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose()
      })
    },
  }
}

/** 新视图的时间状态：从 t = 0、平时状态开始 */
const rest = (id: string) => ({ clock: 0, last: performance.now(), energy: 0, target: 0, pop: -1, off: offsetOf(id) })

/** 渲染 t = 0 时的一帧并返回 webp（scripts/category-icons/render.py 生成服务端渲染用的静态图） */
export function snapshot(id: string, px: number): string {
  setup()
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = px
  const ctx = canvas.getContext('2d')!
  const { scene, model, float, shadow } = buildScene(id)
  const view: View = { ctx, px, scene, model, float, shadow, visible: false, io: new IntersectionObserver(() => {}), ...rest(id) }
  draw(view)
  return canvas.toDataURL('image/webp', 0.9)
}
