import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

/*
 * 分类 3D 图标的建模工具：卡通塑料质感的材质、圆润的基础几何体、常用的 2D 轮廓（挤出成厚片）。
 * 坐标约定：模型放在半径约 1.2 的范围内，地面在 y = -1.05 左右，正面朝 +z。
 */

/** 卡通配色：高饱和、偏亮，和分类色搭配使用 */
export const PAL = {
  white: '#F4F6FA',
  ink: '#262B36',
  gold: '#FFC53D',
  pink: '#FF6B9A',
  red: '#FF5A5F',
  cyan: '#3FD4F5',
  green: '#3DDC97',
  purple: '#8B6CFF',
  orange: '#FF9A3D',
  blue: '#4D8DFF',
  steel: '#C7CEDA',
}

type Mat = THREE.Material
type Color = THREE.ColorRepresentation

/** 微光泽的塑料：卡通 3D 图标的主材质 */
export const plastic = (color: Color, o: THREE.MeshPhysicalMaterialParameters = {}) =>
  new THREE.MeshPhysicalMaterial({ color, roughness: 0.36, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.22, ...o })
export const metal = (color: Color, o: THREE.MeshPhysicalMaterialParameters = {}) =>
  new THREE.MeshPhysicalMaterial({ color, roughness: 0.28, metalness: 0.75, clearcoat: 0.6, clearcoatRoughness: 0.15, ...o })
/** 自发光：屏幕上的眼睛、指示灯、光点 */
export const glow = (color: Color, intensity = 1.4) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 })
/** 半透明玻璃（不用 transmission，几个场景共用一个渲染器时更稳） */
export const glass = (color: Color = '#CFEFFF', opacity = 0.32) =>
  new THREE.MeshPhysicalMaterial({ color, roughness: 0.05, metalness: 0, transparent: true, opacity, clearcoat: 1, envMapIntensity: 1.6, depthWrite: false })

const mesh = (geo: THREE.BufferGeometry, mat: Mat) => new THREE.Mesh(geo, mat)

export const box = (w: number, h: number, d: number, r: number, mat: Mat) => mesh(new RoundedBoxGeometry(w, h, d, 5, Math.min(r, w / 2, h / 2, d / 2) * 0.999), mat)
export const sphere = (r: number, mat: Mat, seg = 40) => mesh(new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75)), mat)
export const cyl = (rTop: number, rBottom: number, h: number, mat: Mat, seg = 48) => mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg), mat)
export const capsule = (r: number, len: number, mat: Mat) => mesh(new THREE.CapsuleGeometry(r, len, 12, 28), mat)
export const torus = (R: number, r: number, mat: Mat, arc = Math.PI * 2) => mesh(new THREE.TorusGeometry(R, r, 20, 72, arc), mat)
export const cone = (r: number, h: number, mat: Mat) => mesh(new THREE.ConeGeometry(r, h, 48), mat)

/** 边缘圆润的扁圆柱（硬币、数据库盘片、底座），沿 y 轴 */
export const puck = (r: number, h: number, bevel: number, mat: Mat, seg = 64) => {
  const hh = h / 2
  const pts = [new THREE.Vector2(0, -hh)]
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * (Math.PI / 2)
    pts.push(new THREE.Vector2(r - bevel + Math.cos(a) * bevel, -hh + bevel + Math.sin(a) * bevel))
  }
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2)
    pts.push(new THREE.Vector2(r - bevel + Math.cos(a) * bevel, hh - bevel + Math.sin(a) * bevel))
  }
  pts.push(new THREE.Vector2(0, hh))
  return mesh(new THREE.LatheGeometry(pts, seg), mat)
}

/** 旋转体：points 是 [半径, 高度] 的轮廓（烧瓶、灯泡这类器皿） */
export const lathe = (points: [number, number][], mat: Mat, seg = 64) => mesh(new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), seg), mat)

/** 底部对齐原点的圆角柱（柱状图的柱子：沿 y 缩放时底部不动） */
export const bar = (w: number, h: number, d: number, r: number, mat: Mat) => {
  const g = new RoundedBoxGeometry(w, h, d, 5, r)
  g.translate(0, h / 2, 0)
  return mesh(g, mat)
}

/** 2D 轮廓挤出成圆润的厚片，几何中心居中 */
export const slab = (shape: THREE.Shape, depth: number, mat: Mat, bevel = 0.06) => {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 8, curveSegments: 40 })
  g.center()
  return mesh(g, mat)
}

/** 沿一串点的圆管 */
export const tube = (points: [number, number, number][], r: number, mat: Mat, closed = false) =>
  mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed), 96, r, 16, closed), mat)

export const group = (...children: THREE.Object3D[]) => {
  const g = new THREE.Group()
  if (children.length) g.add(...children)
  return g
}

/** 设定位置、旋转、缩放，返回对象本身 */
export function at<T extends THREE.Object3D>(o: T, [x, y, z]: [number, number, number], rot: [number, number, number] = [0, 0, 0], scale: number | [number, number, number] = 1): T {
  o.position.set(x, y, z)
  o.rotation.set(...rot)
  if (typeof scale === 'number') o.scale.setScalar(scale)
  else o.scale.set(...scale)
  return o
}

/* ---------- 2D 轮廓 ---------- */

export function roundRect(w: number, h: number, r: number) {
  const s = new THREE.Shape()
  const x = -w / 2
  const y = -h / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r)
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h)
  s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  return s
}

export function circlePath(r: number, cx = 0, cy = 0) {
  const p = new THREE.Path()
  p.absarc(cx, cy, r, 0, Math.PI * 2, true)
  return p
}

export function heart(size = 1) {
  const s = new THREE.Shape()
  const k = size
  s.moveTo(0, -0.95 * k)
  s.bezierCurveTo(-0.35 * k, -0.62 * k, -1.0 * k, -0.25 * k, -1.0 * k, 0.25 * k)
  s.bezierCurveTo(-1.0 * k, 0.72 * k, -0.48 * k, 0.95 * k, 0, 0.55 * k)
  s.bezierCurveTo(0.48 * k, 0.95 * k, 1.0 * k, 0.72 * k, 1.0 * k, 0.25 * k)
  s.bezierCurveTo(1.0 * k, -0.25 * k, 0.35 * k, -0.62 * k, 0, -0.95 * k)
  return s
}

export function shield(w = 1.5, h = 1.8) {
  const s = new THREE.Shape()
  const hw = w / 2
  const top = h / 2
  s.moveTo(0, top)
  s.bezierCurveTo(hw * 0.45, top - h * 0.08, hw * 0.8, top - h * 0.06, hw, top - h * 0.1)
  s.bezierCurveTo(hw, top - h * 0.55, hw * 0.75, -top + h * 0.18, 0, -top)
  s.bezierCurveTo(-hw * 0.75, -top + h * 0.18, -hw, top - h * 0.55, -hw, top - h * 0.1)
  s.bezierCurveTo(-hw * 0.8, top - h * 0.06, -hw * 0.45, top - h * 0.08, 0, top)
  return s
}

/** 对话气泡：圆角矩形，左下角带一个小尾巴（要尾巴朝右时把网格 scale.x 设为 -1） */
export function bubble(w: number, h: number, r: number) {
  const s = new THREE.Shape()
  const x = -w / 2
  const y = -h / 2
  const tx = x + w * 0.26
  s.moveTo(x + r, y)
  s.lineTo(tx - 0.12, y)
  s.lineTo(tx - 0.3, y - 0.34)
  s.lineTo(tx + 0.18, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r)
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h)
  s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  return s
}

/** 齿轮：teeth 个齿，中间一个圆孔 */
export function gear(R = 0.6, teeth = 8, hole = 0.2) {
  const s = new THREE.Shape()
  const inner = R * 0.78
  const step = (Math.PI * 2) / teeth
  for (let i = 0; i < teeth; i++) {
    const a = i * step
    const pts: [number, number][] = [
      [inner, a - step * 0.5],
      [inner, a - step * 0.28],
      [R, a - step * 0.18],
      [R, a + step * 0.18],
      [inner, a + step * 0.28],
    ]
    pts.forEach(([r, ang], k) => {
      const px = Math.cos(ang) * r
      const py = Math.sin(ang) * r
      if (i === 0 && k === 0) s.moveTo(px, py)
      else s.lineTo(px, py)
    })
  }
  s.closePath()
  s.holes.push(circlePath(hole))
  return s
}

/** 多边形（按顺序给出顶点） */
export function poly(points: [number, number][]) {
  const s = new THREE.Shape()
  points.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)))
  s.closePath()
  return s
}

/** 星形：n 个角，外径 R、内径 r */
export function star(n = 5, R = 0.5, r = 0.22) {
  const pts: [number, number][] = []
  for (let i = 0; i < n * 2; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / n
    const k = i % 2 ? r : R
    pts.push([Math.cos(a) * k, Math.sin(a) * k])
  }
  return poly(pts)
}

/** 对勾 */
export function check(size = 1, stroke = 0.22) {
  const s = new THREE.Shape()
  const k = size
  const t = stroke
  s.moveTo(-0.5 * k, 0.05 * k)
  s.lineTo(-0.5 * k + t * 0.7, 0.05 * k + t * 0.7)
  s.lineTo(-0.15 * k, -0.28 * k + t * 0.55)
  s.lineTo(0.5 * k - t * 0.7, 0.45 * k + t * 0.1)
  s.lineTo(0.5 * k, 0.45 * k - t * 0.6)
  s.lineTo(-0.15 * k, -0.32 * k - t * 0.2)
  s.closePath()
  return s
}

/** 鼠标指针箭头 */
export function cursor(size = 1) {
  const s = new THREE.Shape()
  const k = size
  s.moveTo(0, 0)
  s.lineTo(0, -1.0 * k)
  s.lineTo(0.26 * k, -0.76 * k)
  s.lineTo(0.44 * k, -1.12 * k)
  s.lineTo(0.6 * k, -1.04 * k)
  s.lineTo(0.42 * k, -0.68 * k)
  s.lineTo(0.76 * k, -0.68 * k)
  s.closePath()
  return s
}

/** 向上的箭头 */
export function upArrow(w = 0.8, h = 1.0) {
  const s = new THREE.Shape()
  const sw = w * 0.36
  s.moveTo(0, h / 2)
  s.lineTo(w / 2, 0)
  s.lineTo(sw / 2, 0)
  s.lineTo(sw / 2, -h / 2)
  s.lineTo(-sw / 2, -h / 2)
  s.lineTo(-sw / 2, 0)
  s.lineTo(-w / 2, 0)
  s.closePath()
  return s
}

/** 文件夹后板（带左上角的标签） */
export function folderBack(w = 2, h = 1.4) {
  const s = new THREE.Shape()
  const x = -w / 2
  const y = -h / 2
  const r = 0.12
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - 0.2 - r)
  s.quadraticCurveTo(x + w, y + h - 0.2, x + w - r, y + h - 0.2)
  s.lineTo(x + w * 0.46, y + h - 0.2)
  s.lineTo(x + w * 0.38, y + h)
  s.lineTo(x + r, y + h)
  s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  return s
}

/** 调色板：圆润的不规则椭圆，带一个拇指孔 */
export function palette() {
  const s = new THREE.Shape()
  s.moveTo(-1.0, 0.1)
  s.bezierCurveTo(-1.05, 0.75, -0.3, 1.0, 0.35, 0.85)
  s.bezierCurveTo(1.0, 0.7, 1.15, 0.05, 0.9, -0.45)
  s.bezierCurveTo(0.7, -0.85, 0.15, -0.95, -0.15, -0.7)
  s.bezierCurveTo(-0.35, -0.52, -0.2, -0.3, -0.45, -0.28)
  s.bezierCurveTo(-0.8, -0.26, -0.98, -0.32, -1.0, 0.1)
  s.holes.push(circlePath(0.16, -0.5, 0.18))
  return s
}

/* ---------- 动画小工具 ---------- */

/** 0→1 的平滑插值 */
export const smooth = (x: number) => {
  const c = Math.min(1, Math.max(0, x))
  return c * c * (3 - 2 * c)
}
/** 回弹：0→1，略冲过头再回来 */
export const back = (x: number) => {
  const c = Math.min(1, Math.max(0, x))
  const k = 1.9
  return 1 + (k + 1) * Math.pow(c - 1, 3) + k * Math.pow(c - 1, 2)
}
/** 周期内的相位 0..1 */
export const phase = (t: number, period: number, offset = 0) => (((t + offset) % period) + period) % period / period
