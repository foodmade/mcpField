import * as THREE from 'three'
import {
  PAL, at, back, bar, box, bubble, capsule, check, cone, cursor, cyl, folderBack, gear, glass, glow, group, heart, lathe, metal, palette, phase, plastic, poly,
  puck, roundRect, shield, slab, smooth, sphere, star, torus, tube, upArrow,
} from './kit'

/*
 * 卡通 3D 模型：服务分类各一个（键与 lib/categories.ts 的 slug 一致），其他目录的分类按 catalog.ts 映射到这里的模型。
 * 每个模型返回根节点和每帧调用的 update(t)：t 是秒，用来驱动各自的待机动画（眨眼、摆动、弹跳、旋转……）。
 * 整体的上下浮动和左右轻摆由 engine 统一加，这里只管模型自身的小动作。
 */

export type Model = { root: THREE.Object3D; update: (t: number) => void }
type Build = (accent: THREE.Color) => Model

const tint = (c: THREE.Color, k: number) => c.clone().lerp(new THREE.Color('#ffffff'), k)
const shade = (c: THREE.Color, k: number) => c.clone().lerp(new THREE.Color('#000000'), k)
/** 0..1 区间内的一个钟形脉冲，中心 c、宽度 w */
const bump = (x: number, c: number, w: number) => Math.exp(-(((x - c) / w) ** 2))

/** 一个可淡入淡出的发光材质 */
const fade = (color: THREE.ColorRepresentation) => new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false })

function robot(): Model {
  const shell = plastic(PAL.white)
  const accent = plastic(PAL.purple)
  const eyeMat = glow(PAL.cyan, 1.8)
  const cheekMat = glow(PAL.pink, 0.6)
  const head = box(1.6, 1.25, 1.15, 0.44, shell)
  const screen = at(box(1.26, 0.84, 0.12, 0.28, plastic(PAL.ink, { roughness: 0.15, clearcoat: 1 })), [0, -0.02, 0.54])
  const eyeL = at(sphere(0.13, eyeMat), [-0.3, 0.06, 0.61], [0, 0, 0], [1, 1.3, 0.5])
  const eyeR = at(sphere(0.13, eyeMat), [0.3, 0.06, 0.61], [0, 0, 0], [1, 1.3, 0.5])
  const mouth = at(torus(0.13, 0.035, eyeMat, Math.PI), [0, -0.14, 0.61], [0, 0, Math.PI])
  const cheekL = at(sphere(0.07, cheekMat), [-0.46, -0.13, 0.6], [0, 0, 0], [1.3, 0.8, 0.4])
  const cheekR = at(sphere(0.07, cheekMat), [0.46, -0.13, 0.6], [0, 0, 0], [1.3, 0.8, 0.4])
  const earL = at(cyl(0.2, 0.2, 0.2, accent), [-0.86, 0, 0], [0, 0, Math.PI / 2])
  const earR = at(cyl(0.2, 0.2, 0.2, accent), [0.86, 0, 0], [0, 0, Math.PI / 2])
  const ballMat = glow(PAL.pink, 1.2)
  const antenna = at(group(at(cyl(0.035, 0.035, 0.36, metal(PAL.steel)), [0, 0.18, 0]), at(sphere(0.13, ballMat), [0, 0.42, 0])), [0, 0.6, 0])
  const face = group(head, screen, eyeL, eyeR, mouth, cheekL, cheekR, earL, earR, antenna)
  face.position.y = 0.32
  const body = at(box(1.0, 0.62, 0.8, 0.28, accent), [0, -0.66, 0])
  const belly = at(sphere(0.12, glow(PAL.gold, 0.9)), [0, -0.62, 0.4], [0, 0, 0], [1, 1, 0.4])
  const armL = at(group(at(capsule(0.11, 0.34, shell), [0, -0.2, 0])), [-0.6, -0.48, 0], [0, 0, -0.35])
  const armR = at(group(at(capsule(0.11, 0.34, shell), [0, 0.2, 0])), [0.6, -0.5, 0], [0, 0, -0.5])
  const root = at(group(face, body, belly, armL, armR), [0, 0.04, 0], [0, 0, 0], 0.86)
  return {
    root,
    update(t) {
      face.rotation.z = Math.sin(t * 1.4) * 0.08
      face.rotation.y = Math.sin(t * 0.7) * 0.12
      antenna.rotation.z = Math.sin(t * 3.1) * 0.22
      ballMat.emissiveIntensity = 1.1 + Math.sin(t * 4) * 0.6
      const blink = phase(t, 3.4) > 0.95 ? 0.12 : 1
      eyeL.scale.y = eyeR.scale.y = 1.3 * blink
      const look = Math.sin(t * 0.9) * 0.05
      eyeL.position.x = -0.3 + look
      eyeR.position.x = 0.3 + look
      armR.rotation.z = -2.4 + Math.sin(t * 6) * 0.35
    },
  }
}

function lightbulb(accent: THREE.Color): Model {
  const cover = plastic(accent)
  const page = plastic('#FFFDF5', { roughness: 0.55, clearcoat: 0.2 })
  const ink = plastic('#C9D1DC')
  const leaf = (side: 1 | -1, mat: THREE.Material) => {
    const g = group(at(box(1.0, 0.08, 1.24, 0.04, mat), [side * 0.5, 0, 0]))
    for (let i = 0; i < 3; i++) g.add(at(box(0.6 - i * 0.12, 0.02, 0.07, 0.01, ink), [side * 0.5, 0.05, -0.3 + i * 0.25]))
    return g
  }
  const pageL = at(leaf(-1, page), [0, -0.66, 0], [0, 0, 0.14])
  const pageR = at(leaf(1, page), [0, -0.66, 0], [0, 0, -0.14])
  const flipper = at(group(at(box(1.0, 0.04, 1.2, 0.02, page), [0.5, 0, 0])), [0, -0.6, 0])
  const book = group(at(box(2.2, 0.12, 1.42, 0.06, cover), [0, -0.78, 0]), pageL, pageR, flipper)
  const filamentMat = glow(PAL.gold, 2)
  const bulbGlass = new THREE.MeshPhysicalMaterial({ color: '#FFE27A', emissive: '#FFC93D', emissiveIntensity: 0.45, transparent: true, opacity: 0.88, roughness: 0.08, clearcoat: 1 })
  const bulb = group(
    at(sphere(0.52, bulbGlass), [0, 0.5, 0]),
    at(tube([[-0.14, 0.2, 0], [-0.1, 0.52, 0], [0, 0.42, 0], [0.1, 0.52, 0], [0.14, 0.2, 0]], 0.025, filamentMat), [0, 0, 0]),
    at(cyl(0.26, 0.2, 0.2, bulbGlass), [0, 0.04, 0]),
    at(cyl(0.21, 0.21, 0.24, metal(PAL.steel)), [0, -0.16, 0]),
    at(torus(0.21, 0.035, metal(PAL.steel)), [0, -0.1, 0], [Math.PI / 2, 0, 0]),
    at(torus(0.21, 0.035, metal(PAL.steel)), [0, -0.2, 0], [Math.PI / 2, 0, 0]),
    at(sphere(0.1, plastic(PAL.ink)), [0, -0.3, 0]),
  )
  bulb.position.y = 0.12
  const sparkMat = glow(PAL.gold, 1.6)
  const sparks = [0, 1, 2].map(() => new THREE.Mesh(new THREE.OctahedronGeometry(0.08), sparkMat))
  const root = group(book, bulb, ...sparks)
  return {
    root,
    update(t) {
      bulb.position.y = 0.12 + Math.sin(t * 1.8) * 0.06
      filamentMat.emissiveIntensity = 1.6 + Math.sin(t * 5) * 0.5
      bulbGlass.emissiveIntensity = 0.4 + Math.sin(t * 2.5) * 0.12
      const p = phase(t, 4)
      flipper.rotation.z = -0.14 - smooth((p - 0.5) * 3) * (Math.PI - 0.28)
      sparks.forEach((s, i) => {
        const a = t * 1.2 + (i * Math.PI * 2) / 3
        s.position.set(Math.cos(a) * 0.8, 0.62 + Math.sin(a * 2) * 0.12, Math.sin(a) * 0.6)
        s.rotation.y = t * 3
        s.scale.setScalar(0.7 + 0.3 * Math.sin(t * 4 + i))
      })
    },
  }
}

function magnifier(accent: THREE.Color): Model {
  const doc = at(group(at(box(1.1, 1.36, 0.08, 0.1, plastic(PAL.white)), [0, 0, 0])), [-0.38, 0.12, -0.55], [0, 0.25, 0.06])
  ;[0.4, 0.18, -0.04, -0.26].forEach((y, i) => doc.add(at(box([0.7, 0.55, 0.62, 0.4][i], 0.08, 0.04, 0.03, plastic(i === 0 ? PAL.gold : '#CAD2DE')), [-0.1 + (i % 2) * -0.05, y, 0.06])))
  const ring = torus(0.52, 0.13, plastic(accent))
  const lens = at(cyl(0.52, 0.52, 0.05, glass('#BDE6FF', 0.62)), [0, 0, 0], [Math.PI / 2, 0, 0])
  const shine = at(torus(0.34, 0.035, glow('#FFFFFF', 0.8), Math.PI / 2.4), [0, 0, 0.05], [0, 0, 1.9])
  const collar = at(cyl(0.16, 0.16, 0.2, plastic(tint(accent, 0.25))), [0.47, -0.47, 0], [0, 0, Math.PI / 4])
  const handle = at(capsule(0.13, 0.55, plastic(PAL.ink)), [0.78, -0.78, 0], [0, 0, Math.PI / 4])
  const mag = group(ring, lens, shine, collar, handle)
  const root = group(doc, mag)
  return {
    root,
    update(t) {
      mag.position.set(0.12 + Math.sin(t * 1.3) * 0.2, 0.08 + Math.cos(t * 1.3) * 0.14, 0.25)
      mag.rotation.z = Math.sin(t * 1.3) * 0.12
      mag.rotation.y = -0.2 + Math.cos(t * 0.9) * 0.15
    },
  }
}

function browserWindow(accent: THREE.Color): Model {
  const frame = box(2.15, 1.6, 0.16, 0.2, plastic(PAL.white))
  const barMesh = at(box(2.15, 0.36, 0.2, 0.17, plastic(accent)), [0, 0.62, 0])
  const dots = [PAL.red, PAL.gold, PAL.green].map((c, i) => at(sphere(0.07, plastic(c)), [-0.84 + i * 0.2, 0.62, 0.11]))
  const hero = at(box(0.82, 0.6, 0.06, 0.08, plastic(tint(accent, 0.45))), [-0.47, -0.12, 0.09])
  const sun = at(sphere(0.09, plastic(PAL.gold)), [-0.32, 0.02, 0.13])
  const hill = at(cone(0.24, 0.28, plastic(shade(accent, 0.1))), [-0.58, -0.24, 0.12], [0, 0, 0], [1, 1, 0.3])
  const lines = [0.82, 0.62, 0.72].map((w, i) => at(box(w, 0.1, 0.05, 0.04, plastic(i === 0 ? PAL.ink : '#CFD6E0')), [0.06 + w / 2, 0.08 - i * 0.2, 0.09]))
  const btn = at(box(0.5, 0.18, 0.08, 0.09, plastic(PAL.pink)), [0.31, -0.48, 0.1])
  const win = group(frame, barMesh, ...dots, hero, sun, hill, ...lines, btn)
  const pointer = group(at(slab(cursor(0.5), 0.08, plastic('#FFFFFF'), 0.04), [0, 0, 0]), at(slab(cursor(0.36), 0.08, plastic(PAL.ink), 0.03), [-0.015, 0.03, 0.06]))
  const rippleMat = fade(PAL.pink)
  const ripple = at(torus(0.16, 0.025, rippleMat), [0.31, -0.48, 0.18])
  const root = group(win, pointer, ripple)
  return {
    root,
    update(t) {
      const p = phase(t, 2.8)
      const travel = smooth(p * 2.2)
      const fromX = -0.2
      const fromY = 0.3
      pointer.position.set(fromX + (0.45 - fromX) * travel, fromY + (-0.62 - fromY) * travel, 0.32)
      const press = bump(p, 0.55, 0.05)
      pointer.scale.setScalar(1 - press * 0.18)
      btn.position.z = 0.1 - press * 0.04
      const r = Math.max(0, (p - 0.55) / 0.35)
      ripple.scale.setScalar(1 + r * 2.4)
      rippleMat.opacity = r > 0 && r < 1 ? 1 - r : 0
    },
  }
}

function barChart(accent: THREE.Color): Model {
  const base = at(box(2.2, 0.16, 1.3, 0.08, plastic(PAL.white)), [0, -0.86, 0])
  const colors = [accent, new THREE.Color(PAL.purple), new THREE.Color(PAL.pink), new THREE.Color(PAL.gold)]
  const bars = colors.map((c, i) => at(bar(0.36, 1.5, 0.36, 0.1, plastic(c)), [-0.72 + i * 0.48, -0.78, 0]))
  const ballMat = glow(PAL.cyan, 1.3)
  const ball = sphere(0.1, ballMat)
  const root = group(base, ...bars, ball)
  const heights = [0.45, 0.7, 0.55, 0.95]
  return {
    root,
    update(t) {
      let top = { i: 0, h: 0 }
      bars.forEach((b, i) => {
        const h = heights[i] * (0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 1.7 + i * 1.3)))
        b.scale.y = h
        if (h > top.h) top = { i, h }
      })
      ball.position.set(-0.72 + top.i * 0.48, -0.78 + top.h * 1.5 + 0.18 + Math.sin(t * 6) * 0.03, 0)
    },
  }
}

function terminal(accent: THREE.Color): Model {
  const body = box(2.05, 1.5, 0.18, 0.18, plastic('#1F2431', { roughness: 0.3 }))
  const strip = at(box(2.05, 0.3, 0.2, 0.15, plastic('#2E3546')), [0, 0.6, 0])
  const dots = [PAL.red, PAL.gold, PAL.green].map((c, i) => at(sphere(0.06, plastic(c)), [-0.84 + i * 0.18, 0.6, 0.11]))
  const promptMat = glow(PAL.green, 1.4)
  const armA = at(capsule(0.045, 0.16, promptMat), [-0.72, 0.24, 0.12], [0, 0, Math.PI / 4])
  const armB = at(capsule(0.045, 0.16, promptMat), [-0.72, 0.08, 0.12], [0, 0, -Math.PI / 4])
  const caret = at(box(0.2, 0.06, 0.05, 0.025, promptMat), [-0.4, 0.04, 0.12])
  const lineColors = [accent, new THREE.Color(PAL.pink), new THREE.Color(PAL.gold), new THREE.Color(PAL.cyan)]
  const widths = [1.1, 0.7, 0.9, 0.5]
  const lines = lineColors.map((c, i) => {
    const g = new THREE.Mesh(new THREE.BoxGeometry(widths[i], 0.07, 0.04).translate(widths[i] / 2, 0, 0), glow(c, 0.7))
    return at(g, [-0.8 + (i % 2) * 0.16, -0.16 - i * 0.15, 0.11])
  })
  const screen = group(body, strip, ...dots, armA, armB, caret, ...lines)
  const big = at(slab(gear(0.46, 9, 0.15), 0.18, metal(PAL.gold, { metalness: 0.55 }), 0.04), [0.86, -0.62, 0.34])
  const small = at(slab(gear(0.28, 7, 0.09), 0.16, plastic(accent), 0.035), [0.38, -0.95, 0.3])
  const root = group(screen, big, small)
  return {
    root,
    update(t) {
      big.rotation.z = t * 0.9
      small.rotation.z = -t * 1.45 + 0.2
      caret.visible = phase(t, 1) < 0.55
      const p = phase(t, 5)
      lines.forEach((l, i) => (l.scale.x = Math.max(0.001, smooth(p * 5 - i * 0.8))))
    },
  }
}

function branchGraph(accent: THREE.Color): Model {
  const lineMat = plastic(PAL.white)
  const main = tube([[-0.55, -0.95, 0], [-0.55, 0, 0], [-0.55, 0.95, 0]], 0.09, lineMat)
  const pts: [number, number, number][] = [[-0.55, -0.5, 0], [-0.5, -0.1, 0], [0.05, 0.12, 0], [0.52, 0.32, 0], [0.56, 0.72, 0]]
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)))
  const branch = tube(pts, 0.09, lineMat)
  const node = (c: THREE.ColorRepresentation) => group(at(sphere(0.23, plastic(c)), [0, 0, 0]), at(torus(0.27, 0.055, plastic(PAL.white)), [0, 0, 0]))
  const nodes = [
    at(node(accent), [-0.55, -0.85, 0]),
    at(node(PAL.blue), [-0.55, 0.85, 0]),
    at(node(PAL.pink), [0.56, 0.78, 0]),
  ]
  const beadMat = glow(PAL.gold, 1.8)
  const bead = sphere(0.11, beadMat)
  const root = group(main, branch, ...nodes, bead)
  return {
    root,
    update(t) {
      const p = phase(t, 2.6)
      bead.position.copy(curve.getPointAt(smooth(p)))
      bead.position.z = 0.1
      nodes.forEach((n, i) => n.scale.setScalar(1 + 0.16 * bump(phase(t, 2.6, -i * 0.5), 0.5, 0.08)))
      nodes[2].scale.setScalar(1 + 0.25 * bump(p, 0.98, 0.06) + 0.25 * bump(p, 0.02, 0.06))
    },
  }
}

function clipboard(accent: THREE.Color): Model {
  const board = box(1.62, 2.02, 0.14, 0.18, plastic(accent))
  const paper = at(box(1.34, 1.62, 0.06, 0.08, plastic(PAL.white)), [0, -0.1, 0.09])
  const clip = at(box(0.7, 0.28, 0.22, 0.1, metal(PAL.steel)), [0, 0.93, 0.08])
  const hole = at(torus(0.08, 0.03, metal(PAL.steel)), [0, 1.08, 0.08])
  const rows = [0, 1, 2].map((i) => {
    const y = 0.36 - i * 0.48
    return group(at(box(0.32, 0.32, 0.07, 0.08, plastic('#E3E8EF')), [-0.36, y, 0.14]), at(box(0.5, 0.1, 0.05, 0.04, plastic('#C3CBD7')), [0.2, y, 0.13]))
  })
  const checks = [0, 1, 2].map((i) => at(slab(check(0.38, 0.13), 0.08, plastic(PAL.green), 0.03), [-0.34, 0.38 - i * 0.48, 0.24]))
  const root = group(board, paper, clip, hole, ...rows, ...checks)
  return {
    root,
    update(t) {
      const p = phase(t, 4.6) * 4.6
      checks.forEach((c, i) => {
        const on = back((p - 0.4 - i * 0.7) / 0.45)
        const off = smooth((p - 4.0) / 0.4)
        c.scale.setScalar(Math.max(0.001, on * (1 - off)))
      })
      root.rotation.z = Math.sin(t * 1.1) * 0.05
    },
  }
}

function databaseStack(accent: THREE.Color): Model {
  const disks = [0, 1, 2].map((i) => at(puck(0.85, 0.42, 0.12, plastic(i === 1 ? tint(accent, 0.15) : accent)), [0, -0.66 + i * 0.52, 0]))
  const ringMats = [0, 1].map(() => glow(PAL.cyan, 0.4))
  const rings = ringMats.map((m, i) => at(torus(0.8, 0.035, m), [0, -0.4 + i * 0.52, 0], [Math.PI / 2, 0, 0]))
  const ledMats = [0, 1, 2].map(() => glow(PAL.green, 1.5))
  const leds = ledMats.flatMap((m, i) => [0.35, 0.6].map((a) => at(sphere(0.055, m), [Math.sin(a) * 0.86, -0.66 + i * 0.52, Math.cos(a) * 0.86])))
  const cap = at(torus(0.42, 0.05, plastic(tint(accent, 0.4))), [0, 0.43, 0], [Math.PI / 2, 0, 0])
  const root = group(...disks, ...rings, ...leds, cap)
  return {
    root,
    update(t) {
      ringMats.forEach((m, i) => (m.emissiveIntensity = 0.3 + 1.8 * bump(phase(t, 1.6), 0.25 + i * 0.35, 0.12)))
      ledMats.forEach((m, i) => (m.emissiveIntensity = phase(t * (1 + i * 0.37), 0.9) < 0.5 ? 1.8 : 0.25))
      cap.rotation.z = t * 0.8
    },
  }
}

function cloud(accent: THREE.Color): Model {
  const mat = plastic('#FFFFFF', { roughness: 0.5, clearcoat: 0.3 })
  const puffs: [number, number, number, number][] = [
    [-0.62, -0.05, 0, 0.46],
    [-0.12, 0.26, 0, 0.62],
    [0.5, 0.08, 0, 0.5],
    [0.15, -0.18, 0.25, 0.45],
    [-0.42, -0.2, 0.22, 0.4],
    [0.92, -0.14, 0, 0.32],
    [-1.02, -0.2, 0, 0.3],
  ]
  const balls = puffs.map(([x, y, z, r]) => at(sphere(r, mat), [x, y, z]))
  const body = group(...balls)
  body.position.y = 0.25
  const arrowMat = plastic(accent, { transparent: true })
  const arrow = slab(upArrow(0.55, 0.62), 0.16, arrowMat, 0.05)
  const sparkMat = glow(PAL.gold, 1.5)
  const sparks = [0, 1].map(() => new THREE.Mesh(new THREE.OctahedronGeometry(0.07), sparkMat))
  const root = group(body, arrow, ...sparks)
  return {
    root,
    update(t) {
      balls.forEach((b, i) => b.scale.setScalar(1 + Math.sin(t * 2 + i) * 0.025))
      const p = phase(t, 2)
      arrow.position.set(0.05, -1.0 + smooth(p) * 0.9, 0.55)
      arrowMat.opacity = Math.min(1, p * 4) * (1 - smooth((p - 0.7) / 0.3))
      sparks.forEach((s, i) => {
        const a = t * 1.5 + i * Math.PI
        s.position.set(Math.cos(a) * 1.15, 0.55 + Math.sin(a * 1.3) * 0.25, Math.sin(a) * 0.5)
        s.rotation.y = t * 3
      })
    },
  }
}

function folder(accent: THREE.Color): Model {
  const backPanel = at(slab(folderBack(2.0, 1.5), 0.1, plastic(shade(accent, 0.18)), 0.05), [0, 0.02, -0.22])
  const paperA = box(1.62, 1.12, 0.04, 0.05, plastic(PAL.white))
  const paperB = at(box(1.5, 1.02, 0.04, 0.05, plastic('#FFF1CF')), [0, 0, 0], [0, 0, 0.05])
  const sheetA = group(paperA)
  const sheetB = group(paperB)
  ;[0.3, 0.12, -0.06].forEach((y, i) => sheetA.add(at(box(1.0 - i * 0.2, 0.07, 0.03, 0.02, plastic('#C9D1DC')), [-0.12, y, 0.03])))
  const flap = at(group(at(box(2.02, 1.18, 0.12, 0.13, plastic(accent)), [0, 0.59, 0]), at(box(0.5, 0.14, 0.06, 0.06, plastic(tint(accent, 0.5))), [0, 0.86, 0.07])), [0, -0.78, 0.1])
  const root = group(backPanel, sheetA, sheetB, flap)
  return {
    root,
    update(t) {
      const a = 0.5 + 0.5 * Math.sin(t * 1.8)
      const b = 0.5 + 0.5 * Math.sin(t * 1.8 + 2)
      sheetA.position.set(0, -0.02 + a * 0.38, -0.12)
      sheetB.position.set(0.04, -0.06 + b * 0.3, -0.05)
      flap.rotation.x = -0.12 - Math.max(a, b) * 0.22
    },
  }
}

function chatBubbles(accent: THREE.Color): Model {
  const big = at(slab(bubble(1.65, 1.15, 0.42), 0.3, plastic(accent), 0.08), [-0.32, 0.32, -0.25])
  const lines = [0.75, 0.5].map((w, i) => at(box(w, 0.11, 0.06, 0.05, plastic(PAL.white)), [-0.32 - (0.75 - w) / 2, 0.45 - i * 0.24, -0.03]))
  const bigGroup = group(big, ...lines)
  const small = at(slab(bubble(1.35, 0.92, 0.38), 0.3, plastic(PAL.white), 0.08), [0, 0, 0], [0, 0, 0], [-1, 1, 1])
  const dotMat = plastic(PAL.ink)
  const dots = [-0.32, 0, 0.32].map((x) => at(sphere(0.1, dotMat), [x, 0.02, 0.24]))
  const smallGroup = at(group(small, ...dots), [0.42, -0.4, 0.32])
  const root = group(bigGroup, smallGroup)
  return {
    root,
    update(t) {
      bigGroup.position.y = Math.sin(t * 1.6) * 0.05
      smallGroup.position.y = -0.4 + Math.sin(t * 1.6 + 1.6) * 0.05
      dots.forEach((d, i) => (d.position.y = 0.02 + 0.12 * Math.max(0, Math.sin(t * 6 - i * 0.9))))
    },
  }
}

function paintPalette(accent: THREE.Color): Model {
  const board = slab(palette(), 0.14, plastic('#FFE3BA', { roughness: 0.5, clearcoat: 0.4 }), 0.05)
  const blobs = ([
    [-0.55, 0.52, PAL.red],
    [0.0, 0.66, PAL.gold],
    [0.52, 0.44, PAL.green],
    [0.72, -0.12, PAL.cyan],
    [0.32, -0.56, PAL.purple],
  ] as const).map(([x, y, c]) => at(sphere(0.18, plastic(c, { roughness: 0.2 })), [x, y, 0.12], [0, 0, 0], [1, 1, 0.5]))
  const pal = at(group(board, ...blobs), [0, -0.3, 0], [-1.05, 0, 0.12])
  const tipMat = plastic(PAL.red, { roughness: 0.2 })
  const brush = group(
    at(capsule(0.075, 0.95, plastic(accent)), [0, 0.72, 0]),
    at(cyl(0.09, 0.09, 0.2, metal(PAL.steel)), [0, 0.12, 0]),
    at(cone(0.1, 0.3, tipMat), [0, -0.12, 0], [Math.PI, 0, 0]),
  )
  const root = group(pal, brush)
  const tips = [PAL.red, PAL.gold, PAL.green, PAL.cyan, PAL.purple]
  return {
    root,
    update(t) {
      const p = phase(t, 1.4)
      const k = Math.floor(t / 1.4) % tips.length
      tipMat.color.set(tips[k])
      brush.position.set(0.35 + Math.sin(t * 0.9) * 0.25, -0.05 + 0.32 * (1 - bump(p, 0.5, 0.18)), 0.35)
      brush.rotation.set(0.35, 0, -0.55 + Math.sin(t * 0.9) * 0.1)
    },
  }
}

function coins(): Model {
  const gold = metal(PAL.gold, { metalness: 0.55, roughness: 0.32 })
  const goldDeep = metal('#E7A623', { metalness: 0.6, roughness: 0.35 })
  const stack = [0, 1, 2, 3].map((i) => at(puck(0.46, 0.15, 0.05, i % 2 ? goldDeep : gold), [-0.5 + (i % 2) * 0.04, -0.94 + i * 0.16, 0.15]))
  const topRing = at(torus(0.32, 0.03, goldDeep), [-0.5, -0.38, 0.15], [Math.PI / 2, 0, 0])
  const spin = group(at(puck(0.42, 0.13, 0.05, gold), [0, 0, 0], [Math.PI / 2, 0, 0]), at(torus(0.28, 0.035, goldDeep), [0, 0, 0.07]), at(torus(0.28, 0.035, goldDeep), [0, 0, -0.07]))
  spin.position.set(0.62, -0.42, 0.35)
  const green = plastic(PAL.green)
  const pts: [number, number, number][] = [[-1.0, -0.15, -0.35], [-0.5, 0.25, -0.35], [-0.08, 0.0, -0.35], [0.55, 0.7, -0.35]]
  const line = tube(pts, 0.08, green)
  const head = cone(0.2, 0.34, green)
  const dir = new THREE.Vector3(...pts[3]).sub(new THREE.Vector3(...pts[2])).normalize()
  head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
  head.position.set(...pts[3]).addScaledVector(dir, 0.1)
  const arrow = group(line, head)
  const root = group(...stack, topRing, spin, arrow)
  return {
    root,
    update(t) {
      spin.rotation.y = t * 2.4
      spin.position.y = -0.42 + Math.sin(t * 2.4) * 0.06
      arrow.position.y = Math.sin(t * 1.6) * 0.06
      arrow.scale.setScalar(1 + 0.04 * Math.sin(t * 3.2))
    },
  }
}

function shieldBadge(accent: THREE.Color): Model {
  const outer = slab(shield(1.55, 1.85), 0.32, plastic(accent), 0.08)
  const inner = at(slab(shield(1.12, 1.36), 0.1, plastic(PAL.white), 0.05), [0, 0.02, 0.22])
  const mark = at(slab(check(0.7, 0.22), 0.12, plastic(PAL.green), 0.04), [0, 0.02, 0.35])
  const badge = group(outer, inner, mark)
  const haloMat = plastic(PAL.cyan, { transparent: true, opacity: 0.55 })
  const halo = torus(1.18, 0.025, haloMat)
  const orb = sphere(0.09, glow(PAL.cyan, 1.8))
  const orbit = at(group(halo, at(orb, [1.18, 0, 0])), [0, -0.05, 0], [1.25, 0, 0.2])
  const root = group(badge, orbit)
  return {
    root,
    update(t) {
      badge.rotation.y = Math.sin(t * 1.1) * 0.35
      mark.scale.setScalar(1 + 0.12 * bump(phase(t, 2.4), 0.5, 0.08))
      orbit.rotation.z = 0.2 + t * 1.2
    },
  }
}

function balanceScale(): Model {
  const gold = metal('#F2B84B', { metalness: 0.65, roughness: 0.28 })
  const wood = plastic('#9A6440', { roughness: 0.45 })
  const base = at(puck(0.58, 0.18, 0.07, wood), [0, -0.98, 0])
  const foot = at(puck(0.32, 0.14, 0.05, gold), [0, -0.83, 0])
  const pole = at(cyl(0.06, 0.08, 1.5, gold), [0, -0.05, 0])
  const knob = at(sphere(0.13, gold), [0, 0.78, 0])
  const beam = box(2.1, 0.1, 0.1, 0.05, gold)
  const panGeo = new THREE.SphereGeometry(0.38, 40, 20, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)
  const hanger = (x: number, load: THREE.Object3D) => {
    const g = group(
      tube([[0, 0, 0], [-0.3, -0.62, 0]], 0.015, gold),
      tube([[0, 0, 0], [0.3, -0.62, 0]], 0.015, gold),
      at(new THREE.Mesh(panGeo, gold), [0, -0.62, 0], [0, 0, 0], [1, 0.45, 1]),
      at(load, [0, -0.5, 0]),
    )
    g.position.x = x
    return g
  }
  const left = hanger(-0.98, at(puck(0.2, 0.1, 0.03, plastic(PAL.pink)), [0, 0, 0]))
  const right = hanger(0.98, at(box(0.28, 0.24, 0.28, 0.07, plastic(PAL.cyan)), [0, 0.06, 0]))
  const pivot = at(group(beam, left, right), [0, 0.62, 0])
  const root = at(group(base, foot, pole, knob, pivot), [0, 0.05, 0])
  return {
    root,
    update(t) {
      pivot.rotation.z = Math.sin(t * 1.3) * 0.16
      left.rotation.z = right.rotation.z = -pivot.rotation.z
    },
  }
}

function briefcase(accent: THREE.Color): Model {
  const body = box(1.95, 1.35, 0.72, 0.2, plastic(accent))
  const dark = plastic(shade(accent, 0.3))
  const seam = at(box(1.97, 0.1, 0.74, 0.05, dark), [0, 0.3, 0])
  const handle = at(torus(0.3, 0.075, dark, Math.PI), [0, 0.66, 0])
  const straps = [-0.55, 0.55].map((x) => at(box(0.14, 1.37, 0.74, 0.05, dark), [x, 0, 0]))
  const clasps = [-0.55, 0.55].map((x) => at(box(0.24, 0.18, 0.1, 0.05, metal(PAL.gold, { metalness: 0.6 })), [x, 0.3, 0.38]))
  const bag = at(group(body, seam, handle, ...straps, ...clasps), [0, -0.3, 0])
  const coin = group(at(puck(0.24, 0.07, 0.025, metal(PAL.gold, { metalness: 0.55 })), [0, 0, 0], [Math.PI / 2, 0, 0]))
  const sparkMat = glow(PAL.gold, 1.6)
  const spark = new THREE.Mesh(new THREE.OctahedronGeometry(0.08), sparkMat)
  const root = group(bag, coin, spark)
  return {
    root,
    update(t) {
      bag.rotation.z = Math.sin(t * 1.6) * 0.05
      const p = phase(t, 2.2)
      coin.position.set(0.25, 0.25 + Math.sin(p * Math.PI) * 0.75, 0.15)
      coin.rotation.y = t * 6
      coin.scale.setScalar(Math.min(1, p * 6) * (1 - smooth((p - 0.85) / 0.15)) + 0.001)
      spark.position.set(-0.7, 0.75 + Math.sin(t * 2) * 0.08, 0.3)
      spark.scale.setScalar(0.6 + 0.4 * Math.abs(Math.sin(t * 3)))
      spark.rotation.y = t * 2
    },
  }
}

function people(accent: THREE.Color): Model {
  const person = (c: THREE.ColorRepresentation) => {
    const m = plastic(c)
    const eye = plastic(PAL.ink)
    return group(
      at(sphere(0.28, m), [0, 0.52, 0]),
      at(sphere(0.04, eye), [-0.09, 0.56, 0.26]),
      at(sphere(0.04, eye), [0.09, 0.56, 0.26]),
      at(sphere(0.42, m), [0, -0.12, 0], [0, 0, 0], [1, 0.82, 0.86]),
    )
  }
  const crew = [at(person(PAL.pink), [-0.72, -0.15, -0.25], [0, 0.3, 0], 0.82), at(person(PAL.gold), [0.72, -0.15, -0.25], [0, -0.3, 0], 0.82), at(person(accent), [0, -0.1, 0.25], [0, 0, 0], 1)]
  const heartMat = plastic(PAL.red, { transparent: true })
  const love = slab(heart(0.2), 0.1, heartMat, 0.04)
  const root = group(...crew, love)
  const baseY = [-0.15, -0.15, -0.1]
  return {
    root,
    update(t) {
      crew.forEach((p, i) => {
        const h = Math.max(0, Math.sin(t * 3.2 - i * 1.1))
        p.position.y = baseY[i] + h * 0.18
        p.scale.y = (i === 2 ? 1 : 0.82) * (1 - 0.06 * (1 - h) * (1 - h))
      })
      const p = phase(t, 3)
      love.position.set(0, 0.7 + p * 0.5, 0.3)
      heartMat.opacity = Math.sin(p * Math.PI)
      love.scale.setScalar(0.6 + p * 0.5)
    },
  }
}

function mapPin(accent: THREE.Color): Model {
  const panels = [0, 1, 2].map((i) => {
    const g = group(at(box(0.72, 1.5, 0.06, 0.04, plastic(i % 2 ? '#D3ECFF' : '#DFF5E6')), [0, 0, 0]))
    g.add(at(box(0.36, 0.5, 0.03, 0.04, plastic(i % 2 ? '#9FD3FF' : '#9FE3B8')), [i === 1 ? 0.1 : -0.08, i * 0.3 - 0.3, 0.04]))
    return at(g, [-0.7 + i * 0.7, 0, 0], [0, (i % 2 ? -1 : 1) * 0.3, 0])
  })
  const route = tube([[-0.9, -0.45, 0.1], [-0.4, 0.1, 0.12], [0.2, -0.2, 0.12], [0.62, 0.3, 0.1]], 0.025, plastic(PAL.pink))
  const map = at(group(...panels, route), [0, -0.62, 0], [-1.15, 0, 0])
  const pinMat = plastic(accent)
  const pin = group(at(sphere(0.32, pinMat), [0, 0.6, 0]), at(cone(0.3, 0.6, pinMat), [0, 0.22, 0], [Math.PI, 0, 0]), at(sphere(0.13, plastic(PAL.white)), [0, 0.62, 0.24]))
  const rippleMat = fade(accent)
  const ripple = at(torus(0.2, 0.025, rippleMat), [0.15, -0.72, 0.1], [Math.PI / 2, 0, 0])
  const root = group(map, pin, ripple)
  return {
    root,
    update(t) {
      const p = phase(t, 1.6)
      const h = Math.abs(Math.sin(p * Math.PI))
      pin.position.set(0.15, -0.78 + h * 0.6, 0.1)
      const squash = p < 0.12 || p > 0.88 ? 0.12 : 0
      pin.scale.set(1 + squash * 0.6, 1 - squash, 1 + squash * 0.6)
      const r = p < 0.5 ? p * 2 : 1
      ripple.scale.setScalar(1 + r * 2.2)
      rippleMat.opacity = 1 - r
    },
  }
}

function heartbeat(accent: THREE.Color): Model {
  const red = new THREE.Color(PAL.red).lerp(accent, 0.35)
  const shape = slab(heart(0.95), 0.5, plastic(red), 0.16)
  const cross = group(at(box(0.46, 0.15, 0.12, 0.06, plastic(PAL.white)), [0, 0, 0]), at(box(0.15, 0.46, 0.12, 0.06, plastic(PAL.white)), [0, 0, 0]))
  cross.position.set(0, 0.08, 0.42)
  const pulse = group(shape, cross)
  const plusMat = glow(PAL.pink, 1.2)
  const pluses = [0, 1, 2].map(() => group(at(box(0.16, 0.05, 0.05, 0.02, plusMat), [0, 0, 0]), at(box(0.05, 0.16, 0.05, 0.02, plusMat), [0, 0, 0])))
  const root = group(pulse, ...pluses)
  return {
    root,
    update(t) {
      const p = phase(t, 1.1)
      pulse.scale.setScalar(1 + 0.09 * bump(p, 0.1, 0.06) + 0.06 * bump(p, 0.3, 0.06))
      pluses.forEach((s, i) => {
        const q = phase(t, 2.4, i * 0.8)
        s.position.set(Math.cos(i * 2.1) * 1.05, 0.2 + q * 0.8, 0.2)
        s.scale.setScalar(Math.sin(q * Math.PI) + 0.001)
        s.rotation.z = q * 2
      })
    },
  }
}

function gamepad(accent: THREE.Color): Model {
  const m = plastic(accent)
  const body = at(capsule(0.5, 0.95, m), [0, 0.05, 0], [0, 0, Math.PI / 2], [1, 1, 0.55])
  const grips = [-1, 1].map((s) => at(capsule(0.32, 0.36, m), [s * 0.66, -0.42, 0], [0, 0, s * 0.45], [1, 1, 0.75]))
  const ink = plastic(PAL.ink)
  const dpad = group(box(0.42, 0.13, 0.08, 0.04, ink), box(0.13, 0.42, 0.08, 0.04, ink))
  dpad.position.set(-0.55, 0.08, 0.28)
  const btnColors = [PAL.gold, PAL.green, PAL.red, PAL.cyan]
  const offs: [number, number][] = [[0, 0.16], [0.16, 0], [0, -0.16], [-0.16, 0]]
  const btnMats = btnColors.map((c) => glow(c, 0.25))
  const btns = btnMats.map((mat, i) => at(sphere(0.085, mat), [0.55 + offs[i][0], 0.08 + offs[i][1], 0.27], [0, 0, 0], [1, 1, 0.6]))
  const sticks = [-0.22, 0.22].map((x) => at(cyl(0.12, 0.14, 0.12, ink), [x, -0.22, 0.27], [Math.PI / 2, 0, 0]))
  const pad = group(body, ...grips, dpad, ...btns, ...sticks)
  const root = group(pad)
  return {
    root,
    update(t) {
      pad.rotation.z = Math.sin(t * 1.5) * 0.1
      pad.rotation.x = Math.sin(t * 1.1) * 0.12
      const k = Math.floor(t * 2.6) % 4
      btns.forEach((b, i) => {
        b.position.z = i === k ? 0.22 : 0.27
        btnMats[i].emissiveIntensity = i === k ? 1.6 : 0.25
      })
      dpad.rotation.z = Math.sin(t * 2.2) * 0.12
    },
  }
}

function atom(accent: THREE.Color): Model {
  const nucleus = group()
  const spots: [number, number, number][] = [[0, 0, 0], [0.18, 0.08, 0.06], [-0.16, 0.1, 0.05], [0.04, -0.17, 0.08], [0.05, 0.12, -0.16], [-0.12, -0.08, -0.12], [0.16, -0.1, -0.1]]
  spots.forEach((p, i) => nucleus.add(at(sphere(0.17, plastic(i % 2 ? PAL.pink : accent)), p)))
  const orbitMat = plastic(PAL.white, { transparent: true, opacity: 0.75 })
  const eMat = glow(PAL.cyan, 1.8)
  const orbits = [0, 1, 2].map((i) => {
    const e = sphere(0.12, eMat)
    const g = group(torus(1.05, 0.035, orbitMat), e)
    g.rotation.set(Math.PI / 2 + (i - 1) * 0.15, (i * Math.PI) / 3, 0)
    return { g, e, speed: 1.6 + i * 0.35, off: i * 2 }
  })
  const root = group(nucleus, ...orbits.map((o) => o.g))
  return {
    root,
    update(t) {
      nucleus.rotation.set(t * 0.6, t * 0.8, 0)
      orbits.forEach((o) => {
        const a = t * o.speed + o.off
        o.e.position.set(Math.cos(a) * 1.05, Math.sin(a) * 1.05, 0)
      })
    },
  }
}

function moreDots(accent: THREE.Color): Model {
  const pill = slab(roundRect(2.0, 0.95, 0.47), 0.4, plastic(tint(accent, 0.55)), 0.1)
  const colors = [PAL.purple, PAL.cyan, PAL.pink]
  const dots = colors.map((c, i) => at(sphere(0.19, plastic(c)), [-0.55 + i * 0.55, 0, 0.36]))
  const root = group(pill, ...dots)
  return {
    root,
    update(t) {
      dots.forEach((d, i) => {
        const h = Math.max(0, Math.sin(t * 4.5 - i * 0.8))
        d.position.y = h * 0.26
        d.position.z = 0.36 + h * 0.1
      })
    },
  }
}

/** MCP 服务器机架：目录页没选分类时的图标。三层机箱指示灯闪烁、轮流微微推出，一根线缆连着插头上下浮动 */
function serverRack(accent: THREE.Color): Model {
  const shell = plastic(PAL.white)
  const face = plastic('#1F2431', { roughness: 0.3 })
  const vent = plastic('#3A4152')
  const ledColors = [PAL.green, PAL.cyan, PAL.gold]
  const ledMats: THREE.MeshStandardMaterial[] = []
  const stripMats: THREE.MeshStandardMaterial[] = []
  const blades = [0, 1, 2].map((i) => {
    const g = group(box(1.9, 0.42, 1.0, 0.13, shell), at(box(1.62, 0.26, 0.06, 0.08, face), [0, 0, 0.5]))
    ledColors.forEach((c, k) => {
      const m = glow(c, 1.4)
      ledMats.push(m)
      g.add(at(sphere(0.045, m), [-0.62 + k * 0.15, 0, 0.55]))
    })
    for (let k = 0; k < 4; k++) g.add(at(box(0.05, 0.15, 0.03, 0.02, vent), [0.08 + k * 0.11, 0, 0.54]))
    const strip = glow(accent, 0.5)
    stripMats.push(strip)
    g.add(at(box(0.3, 0.06, 0.03, 0.03, strip), [0.6, 0, 0.54]))
    g.position.y = 0.4 - i * 0.5
    return g
  })
  const cable = tube([[0.5, 0.6, -0.1], [0.74, 1.02, 0], [1.06, 1.1, 0.2], [1.2, 0.84, 0.32]], 0.05, plastic(PAL.ink))
  const plugBody = plastic(accent)
  const sparkMat = glow(PAL.gold, 2)
  const plug = group(
    box(0.3, 0.34, 0.26, 0.08, plugBody),
    at(box(0.05, 0.16, 0.05, 0.02, metal(PAL.steel)), [-0.07, -0.24, 0]),
    at(box(0.05, 0.16, 0.05, 0.02, metal(PAL.steel)), [0.07, -0.24, 0]),
    at(new THREE.Mesh(new THREE.OctahedronGeometry(0.07), sparkMat), [0, -0.42, 0]),
  )
  const spark = plug.children[3]
  const root = at(group(...blades, cable, plug), [-0.1, -0.08, 0])
  return {
    root,
    update(t) {
      blades.forEach((b, i) => (b.position.z = 0.06 * Math.max(0, Math.sin(t * 1.6 - i * 1.1))))
      ledMats.forEach((m, i) => (m.emissiveIntensity = phase(t * (0.8 + (i % 4) * 0.23), 0.8, i * 0.13) < 0.55 ? 1.8 : 0.25))
      stripMats.forEach((m, i) => (m.emissiveIntensity = 0.4 + 1.6 * bump(phase(t, 1.8), 0.2 + i * 0.3, 0.12)))
      plug.position.set(1.2, 0.66 + Math.sin(t * 2) * 0.04, 0.32)
      plug.rotation.z = Math.sin(t * 2) * 0.08
      spark.scale.setScalar(phase(t, 0.5) < 0.5 ? 1 : 0.3)
      spark.rotation.y = t * 4
    },
  }
}

/** 左对齐、可沿 x 伸缩的细条（逐行“打字”的代码行） */
const line = (w: number, h: number, mat: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.04).translate(w / 2, 0, 0), mat)

/** 用短圆柱拼出的“< / >”：编辑器徽标 */
function codeGlyph(mat: THREE.Material) {
  const arm = (x: number, y: number, rz: number) => at(capsule(0.035, 0.12, mat), [x, y, 0], [0, 0, rz])
  return group(arm(-0.15, 0.06, -Math.PI / 4), arm(-0.15, -0.06, Math.PI / 4), arm(0.15, 0.06, Math.PI / 4), arm(0.15, -0.06, -Math.PI / 4), at(capsule(0.035, 0.26, mat), [0, 0, 0], [0, 0, -0.35]))
}

function codeEditor(accent: THREE.Color): Model {
  const frame = box(2.15, 1.55, 0.16, 0.18, plastic(PAL.white))
  const barMesh = at(box(2.15, 0.3, 0.2, 0.15, plastic('#E4E9F1')), [0, 0.63, 0])
  const dots = [PAL.red, PAL.gold, PAL.green].map((c, i) => at(sphere(0.06, plastic(c)), [-0.86 + i * 0.18, 0.63, 0.11]))
  const side = at(box(0.5, 1.1, 0.05, 0.06, plastic('#EEF2F7')), [-0.74, -0.13, 0.09])
  const files = [0.3, 0.22, 0.3, 0.18].map((w, i) => at(box(w, 0.08, 0.03, 0.03, plastic(i === 1 ? tint(accent, 0.3) : '#CBD3DE')), [-0.86 + w / 2, 0.28 - i * 0.18, 0.12]))
  const colors = [PAL.purple, accent, PAL.pink, PAL.green, PAL.gold]
  const widths = [0.9, 0.62, 1.0, 0.7, 0.48]
  const lines = colors.map((c, i) => at(line(widths[i], 0.08, glow(c, 0.35)), [-0.38 + (i % 3 ? 0.14 : 0), 0.3 - i * 0.17, 0.1]))
  const badge = at(group(box(0.62, 0.62, 0.18, 0.17, plastic(accent)), at(codeGlyph(plastic(PAL.white)), [0, 0, 0.11])), [0.84, -0.56, 0.4])
  const root = group(frame, barMesh, ...dots, side, ...files, ...lines, badge)
  return {
    root,
    update(t) {
      const p = phase(t, 5)
      lines.forEach((l, i) => (l.scale.x = Math.max(0.001, smooth(p * 5 - i * 0.7))))
      badge.position.y = -0.56 + Math.sin(t * 2.2) * 0.06
      badge.rotation.set(Math.sin(t * 1.3) * 0.15, -0.3 + Math.sin(t * 1.1) * 0.25, 0)
    },
  }
}

function desktopApp(accent: THREE.Color): Model {
  const bezel = box(2.1, 1.4, 0.14, 0.16, plastic(PAL.ink))
  const screen = at(box(1.92, 1.22, 0.04, 0.1, plastic(tint(accent, 0.5), { roughness: 0.3 })), [0, 0, 0.07])
  const neck = at(box(0.3, 0.42, 0.12, 0.05, plastic(PAL.steel)), [0, -0.88, -0.04])
  const base = at(puck(0.55, 0.08, 0.03, plastic(PAL.steel)), [0, -1.08, 0], [0, 0, 0], [1, 1, 0.6])
  const win = (c: THREE.ColorRepresentation) => {
    const g = group(box(0.86, 0.6, 0.05, 0.07, plastic(PAL.white)), at(box(0.86, 0.13, 0.06, 0.06, plastic(c)), [0, 0.24, 0.005]))
    ;[0.6, 0.42].forEach((w, i) => g.add(at(box(w, 0.06, 0.03, 0.03, plastic('#CBD3DE')), [-0.33 + w / 2, 0.04 - i * 0.14, 0.03])))
    return g
  }
  const wins = [at(win(PAL.purple), [-0.42, 0.14, 0.12]), at(win(PAL.pink), [0.36, -0.1, 0.17])]
  const dockColors = [PAL.blue, PAL.green, PAL.gold, PAL.red]
  const dock = dockColors.map((c, i) => at(box(0.13, 0.13, 0.05, 0.04, plastic(c)), [-0.3 + i * 0.2, -0.47, 0.11]))
  const root = at(group(bezel, screen, neck, base, ...wins, ...dock), [0, 0.18, 0])
  return {
    root,
    update(t) {
      const p = phase(t, 4) * 4
      wins.forEach((w, i) => w.scale.setScalar(Math.max(0.001, back((p - 0.2 - i * 0.6) / 0.5) * (1 - smooth((p - 3.4) / 0.4)))))
      dock.forEach((d, i) => (d.position.y = -0.47 + 0.08 * Math.max(0, Math.sin(t * 4 - i * 0.9))))
    },
  }
}

function layers(accent: THREE.Color): Model {
  const colors = [accent, new THREE.Color(PAL.purple), new THREE.Color(PAL.pink)]
  const slabs = colors.map((c, i) => at(box(1.45, 0.24, 1.45, 0.2, plastic(c)), [0, 0.42 - i * 0.42, 0], [0, Math.PI / 4, 0]))
  const gem = at(sphere(0.12, glow(PAL.gold, 1.2)), [0, 0.7, 0])
  const root = group(...slabs, gem)
  return {
    root,
    update(t) {
      const spread = 1 + 0.18 * Math.sin(t * 2)
      slabs.forEach((sl, i) => {
        sl.position.y = (0.42 - i * 0.42) * spread
        sl.rotation.y = Math.PI / 4 + Math.sin(t * 1.4 + i * 0.7) * 0.18
      })
      gem.position.y = 0.42 * spread + 0.3 + Math.sin(t * 3) * 0.05
      gem.rotation.y = t * 2
    },
  }
}

function clapper(accent: THREE.Color): Model {
  const ink = plastic(PAL.ink)
  const white = plastic(PAL.white)
  const body = box(1.8, 1.15, 0.16, 0.12, ink)
  const rows = [1.3, 0.8, 1.05].map((w, i) => at(box(w, 0.09, 0.03, 0.04, i === 0 ? plastic(accent) : plastic('#5A6274')), [-0.72 + w / 2, 0.22 - i * 0.26, 0.09]))
  const stripe = () => slab(poly([[-0.12, -0.12], [0.04, -0.12], [0.12, 0.12], [-0.04, 0.12]]), 0.02, ink, 0.01)
  const stick = () => {
    const g = group(box(1.8, 0.26, 0.16, 0.06, white))
    for (let i = 0; i < 4; i++) g.add(at(stripe(), [-0.6 + i * 0.4, 0, 0.085]))
    return g
  }
  const lower = at(stick(), [0, 0.72, 0])
  const upper = stick()
  upper.position.x = 0.9
  const hinge = at(group(upper), [-0.9, 0.88, 0])
  const root = at(group(body, ...rows, lower, hinge), [0, -0.15, 0])
  return {
    root,
    update(t) {
      const p = phase(t, 1.8)
      hinge.rotation.z = p < 0.72 ? smooth(p / 0.72) * 0.55 : 0.55 * (1 - smooth((p - 0.72) / 0.07))
      root.scale.setScalar(1 + 0.04 * bump(p, 0.8, 0.04))
    },
  }
}

function workflow(accent: THREE.Color): Model {
  const pos = [new THREE.Vector3(-0.78, 0.52, 0), new THREE.Vector3(0.78, 0.3, 0), new THREE.Vector3(-0.1, -0.62, 0.15)]
  const colors = [accent, new THREE.Color(PAL.purple), new THREE.Color(PAL.gold)]
  const nodes = pos.map((v, i) => at(group(box(0.6, 0.6, 0.3, 0.17, plastic(colors[i])), at(box(0.26, 0.08, 0.04, 0.04, plastic(PAL.white)), [0, 0.06, 0.16]), at(box(0.16, 0.08, 0.04, 0.04, plastic(PAL.white)), [-0.05, -0.08, 0.16])), [v.x, v.y, v.z]))
  const white = plastic(PAL.white)
  const tokenMat = glow(PAL.cyan, 1.8)
  const edges = [[0, 1], [1, 2], [2, 0]].map(([a, b]) => {
    const from = pos[a].clone()
    const to = pos[b].clone()
    const dir = to.clone().sub(from).normalize()
    const start = from.clone().addScaledVector(dir, 0.4)
    const end = to.clone().addScaledVector(dir, -0.48)
    const mid = start.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 0, 0.35))
    const curve = new THREE.CatmullRomCurve3([start, mid, end])
    const pipe = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.04, 12), white)
    const head = cone(0.1, 0.2, white)
    const tangent = curve.getTangentAt(1)
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent)
    head.position.copy(end).addScaledVector(tangent, 0.06)
    const token = sphere(0.08, tokenMat)
    return { curve, group: group(pipe, head, token), token }
  })
  const root = group(...nodes, ...edges.map((e) => e.group))
  return {
    root,
    update(t) {
      const k = Math.floor(t / 1.1) % 3
      const p = phase(t, 1.1)
      edges.forEach((e, i) => {
        e.token.visible = i === k
        if (i === k) e.token.position.copy(e.curve.getPointAt(smooth(p)))
      })
      nodes.forEach((n, i) => n.scale.setScalar(1 + 0.14 * bump(p, 0.08, 0.08) * (i === k ? 1 : 0) + 0.06 * Math.sin(t * 2 + i)))
    },
  }
}

function flask(accent: THREE.Color): Model {
  const glassBody = lathe([[0.001, -0.9], [0.62, -0.9], [0.74, -0.84], [0.78, -0.72], [0.32, 0.16], [0.24, 0.34], [0.24, 0.74], [0.3, 0.8], [0.3, 0.86], [0.001, 0.86]], glass('#E2F6FF', 0.32))
  const liquidMat = plastic(accent, { emissive: accent, emissiveIntensity: 0.25, roughness: 0.2 })
  const liquid = lathe([[0.001, -0.86], [0.6, -0.86], [0.7, -0.8], [0.73, -0.7], [0.46, -0.18], [0.001, -0.18]], liquidMat)
  const cork = at(puck(0.27, 0.2, 0.05, plastic('#C68A55', { roughness: 0.6 })), [0, 0.94, 0])
  const bubbleMat = plastic(PAL.white, { transparent: true, opacity: 0.85 })
  const bubbles = [0, 1, 2, 3, 4].map(() => sphere(0.07, bubbleMat))
  const sparkMat = glow(PAL.gold, 1.6)
  const sparks = [0, 1].map(() => new THREE.Mesh(new THREE.OctahedronGeometry(0.07), sparkMat))
  const root = at(group(glassBody, liquid, cork, ...bubbles, ...sparks), [0, -0.05, 0])
  return {
    root,
    update(t) {
      bubbles.forEach((b, i) => {
        const q = phase(t, 1.6, i * 0.32)
        b.position.set(Math.sin(q * 9 + i) * 0.12 + (i - 2) * 0.12 * (1 - q), -0.75 + q * 0.6, 0.1 * Math.cos(i))
        b.scale.setScalar((0.6 + q * 0.8) * (q < 0.9 ? 1 : 1 - (q - 0.9) * 10))
      })
      root.rotation.z = Math.sin(t * 1.4) * 0.06
      sparks.forEach((sp, i) => {
        const q = phase(t, 2, i)
        sp.position.set((i ? 0.4 : -0.35) + Math.sin(q * 6) * 0.05, 0.9 + q * 0.4, 0.2)
        sp.scale.setScalar(Math.sin(q * Math.PI) + 0.001)
        sp.rotation.y = t * 3
      })
    },
  }
}

function megaphone(accent: THREE.Color): Model {
  const m = plastic(accent)
  const bell = at(cyl(0.62, 0.22, 1.05, m), [0.05, 0, 0], [0, 0, -Math.PI / 2])
  const rim = at(torus(0.62, 0.06, plastic(PAL.white)), [0.58, 0, 0], [0, Math.PI / 2, 0])
  const mouth = at(cyl(0.57, 0.57, 0.02, plastic(shade(accent, 0.45))), [0.58, 0, 0], [0, 0, -Math.PI / 2])
  const back = at(cyl(0.27, 0.27, 0.34, plastic(PAL.white)), [-0.62, 0, 0], [0, 0, Math.PI / 2])
  const cap = at(sphere(0.27, plastic(PAL.white)), [-0.78, 0, 0], [0, 0, 0], [0.5, 1, 1])
  const handle = at(box(0.17, 0.52, 0.22, 0.07, plastic(PAL.ink)), [-0.32, -0.42, 0], [0, 0, 0.22])
  const horn = group(bell, rim, mouth, back, cap, handle)
  const waveMats = [0, 1, 2].map(() => plastic(tint(accent, 0.25), { transparent: true, depthWrite: false, emissive: accent, emissiveIntensity: 0.35 }))
  const waves = waveMats.map((mat, i) => at(torus(0.32 + i * 0.22, 0.04, mat, 1.3), [0.72, 0, 0], [0, 0, -0.65]))
  const root = at(group(horn, ...waves), [-0.18, 0.05, 0], [0, 0, 0.12])
  return {
    root,
    update(t) {
      horn.rotation.z = Math.sin(t * 2) * 0.05
      horn.scale.setScalar(1 + 0.04 * bump(phase(t, 1.2), 0.1, 0.06))
      waves.forEach((w, i) => {
        const q = phase(t, 1.2, -i * 0.25)
        w.scale.setScalar(0.8 + q * 0.5)
        waveMats[i].opacity = Math.sin(q * Math.PI)
      })
    },
  }
}

function documentSheet(accent: THREE.Color): Model {
  const page = poly([[-0.65, -0.85], [0.65, -0.85], [0.65, 0.52], [0.32, 0.85], [-0.65, 0.85]])
  const sheet = slab(page, 0.08, plastic(PAL.white), 0.04)
  const fold = at(slab(poly([[0.32, 0.85], [0.32, 0.52], [0.65, 0.52]]), 0.03, plastic('#D9DFE8'), 0.015), [0.4, 0.62, 0.07])
  const behind = at(slab(page, 0.06, plastic(tint(accent, 0.55)), 0.03), [-0.2, 0.12, -0.22], [0, 0, 0.12])
  const header = at(box(0.6, 0.13, 0.04, 0.05, plastic(accent)), [-0.27, 0.6, 0.08])
  const widths = [1.0, 0.8, 0.95, 0.6, 0.85]
  const lines = widths.map((w, i) => at(line(w, 0.07, plastic('#C3CBD7')), [-0.5, 0.32 - i * 0.2, 0.08]))
  const pencil = group(
    at(capsule(0.07, 0.62, plastic(PAL.gold)), [0, 0.5, 0]),
    at(cyl(0.075, 0.075, 0.12, plastic(PAL.pink)), [0, 0.88, 0]),
    at(cone(0.072, 0.18, plastic('#F2D3A6')), [0, 0.09, 0], [Math.PI, 0, 0]),
    at(cone(0.03, 0.07, plastic(PAL.ink)), [0, -0.01, 0], [Math.PI, 0, 0]),
  )
  pencil.rotation.z = -0.55
  const root = group(behind, sheet, fold, header, ...lines, pencil)
  return {
    root,
    update(t) {
      const p = phase(t, 5) * 5
      lines.forEach((l, i) => (l.scale.x = Math.max(0.001, smooth(p - i * 0.85))))
      const k = Math.min(widths.length - 1, Math.max(0, Math.floor(p / 0.85)))
      const along = smooth(p - k * 0.85)
      pencil.position.set(-0.5 + widths[k] * along + 0.08, 0.32 - k * 0.2 + 0.04 + Math.abs(Math.sin(t * 18)) * 0.02, 0.3)
    },
  }
}

function cycleArrows(accent: THREE.Color): Model {
  const R = 0.78
  const arc = Math.PI * 0.74
  const arrow = (c: THREE.ColorRepresentation, start: number) => {
    const m = plastic(c)
    const ring = torus(R, 0.13, m, arc)
    const tangent = new THREE.Vector3(-Math.sin(arc), Math.cos(arc), 0)
    const head = cone(0.27, 0.4, m)
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent)
    head.position.set(Math.cos(arc) * R, Math.sin(arc) * R, 0).addScaledVector(tangent, 0.14)
    return at(group(ring, head), [0, 0, 0], [0, 0, start])
  }
  const spin = group(arrow(accent, 0.25), arrow(PAL.cyan, Math.PI + 0.25))
  const hubMat = glow(PAL.white, 0.2)
  const hub = group(at(puck(0.34, 0.2, 0.07, plastic(PAL.white)), [0, 0, 0], [Math.PI / 2, 0, 0]), at(slab(check(0.34, 0.12), 0.06, plastic(accent), 0.025), [0, 0, 0.12]))
  const root = group(spin, hub)
  return {
    root,
    update(t) {
      spin.rotation.z = t * 1.3
      hub.scale.setScalar(1 + 0.08 * bump(phase(t, 1.2), 0.5, 0.1))
      hubMat.emissiveIntensity = 0.2
    },
  }
}

function medal(accent: THREE.Color): Model {
  const gold = metal(PAL.gold, { metalness: 0.55, roughness: 0.3 })
  const goldDeep = metal('#E7A623', { metalness: 0.6, roughness: 0.35 })
  const ribbonL = at(box(0.34, 0.95, 0.06, 0.04, plastic(accent)), [-0.2, 0.42, -0.08], [0, 0, 0.32])
  const ribbonR = at(box(0.34, 0.95, 0.06, 0.04, plastic(PAL.blue)), [0.2, 0.42, -0.1], [0, 0, -0.32])
  const disc = group(
    at(puck(0.6, 0.16, 0.06, gold), [0, 0, 0], [Math.PI / 2, 0, 0]),
    at(torus(0.46, 0.035, goldDeep), [0, 0, 0.085]),
    at(slab(star(5, 0.3, 0.13), 0.08, plastic(PAL.white), 0.03), [0, 0, 0.12]),
  )
  disc.position.y = -0.25
  const swing = at(group(ribbonL, ribbonR, disc), [0, 0, 0])
  const sparkMat = glow(PAL.gold, 1.8)
  const sparks = [0, 1, 2].map(() => new THREE.Mesh(new THREE.OctahedronGeometry(0.07), sparkMat))
  const root = group(swing, ...sparks)
  return {
    root,
    update(t) {
      swing.rotation.z = Math.sin(t * 1.6) * 0.08
      disc.rotation.y = Math.sin(t * 1.2) * 0.55
      sparks.forEach((sp, i) => {
        const q = phase(t, 1.8, i * 0.6)
        const a = i * 2.1 + 0.6
        sp.position.set(Math.cos(a) * 0.85, -0.25 + Math.sin(a) * 0.75, 0.3)
        sp.scale.setScalar(Math.sin(q * Math.PI) + 0.001)
        sp.rotation.y = t * 3
      })
    },
  }
}

function parcel(accent: THREE.Color): Model {
  const kraft = plastic('#D9A066', { roughness: 0.55, clearcoat: 0.2 })
  const body = at(box(1.6, 1.0, 1.2, 0.08, kraft), [0, -0.5, 0])
  const tape = at(box(0.32, 0.03, 1.22, 0.01, plastic('#F2D29A')), [0, 0.0, 0])
  const label = at(box(0.56, 0.32, 0.03, 0.04, plastic(PAL.white)), [0.32, -0.55, 0.61])
  const labelLines = [0.36, 0.24].map((w, i) => at(box(w, 0.05, 0.02, 0.02, plastic(i ? '#C3CBD7' : accent)), [0.32 - (0.36 - w) / 2, -0.5 - i * 0.11, 0.63]))
  const flapGeo = () => box(1.6, 0.05, 0.6, 0.02, kraft)
  const front = at(group(at(flapGeo(), [0, 0, -0.3])), [0, 0.0, 0.6])
  const backFlap = at(group(at(flapGeo(), [0, 0, 0.3])), [0, 0.0, -0.6])
  const cubeColors = [accent, new THREE.Color(PAL.pink), new THREE.Color(PAL.gold)]
  const cubes = cubeColors.map((c) => box(0.3, 0.3, 0.3, 0.08, plastic(c)))
  const root = at(group(body, tape, label, ...labelLines, front, backFlap, ...cubes), [0, 0.1, 0])
  return {
    root,
    update(t) {
      const p = phase(t, 3.2) * 3.2
      const open = smooth(p / 0.4) * (1 - smooth((p - 2.6) / 0.4))
      front.rotation.x = open * 2.1
      backFlap.rotation.x = -open * 2.1
      tape.visible = open < 0.05
      cubes.forEach((c, i) => {
        const q = Math.min(1, Math.max(0, (p - 0.4 - i * 0.3) / 1.6))
        c.position.set((i - 1) * 0.42, -0.25 + Math.sin(q * Math.PI) * 0.95, 0)
        c.rotation.set(q * 4, q * 5 + i, 0)
        c.scale.setScalar(q > 0 && q < 1 ? 1 : 0.001)
      })
    },
  }
}

function phoneAssistant(accent: THREE.Color): Model {
  const body = box(1.05, 1.9, 0.16, 0.2, plastic(PAL.ink))
  const screen = at(box(0.92, 1.74, 0.04, 0.15, plastic(tint(accent, 0.5), { roughness: 0.3 })), [0, 0, 0.08])
  const notch = at(capsule(0.035, 0.18, plastic(PAL.ink)), [0, 0.78, 0.11], [0, 0, Math.PI / 2])
  const ink = plastic(PAL.ink)
  const eyes = [-0.18, 0.18].map((x) => at(sphere(0.08, ink), [x, 0.32, 0.12], [0, 0, 0], [1, 1.3, 0.5]))
  const smile = at(torus(0.16, 0.035, ink, Math.PI), [0, 0.12, 0.12], [0, 0, Math.PI])
  const cheeks = [-0.3, 0.3].map((x) => at(sphere(0.06, glow(PAL.pink, 0.5)), [x, 0.16, 0.11], [0, 0, 0], [1.3, 0.8, 0.4]))
  const barMat = plastic(PAL.white)
  const bars = [0, 1, 2, 3, 4].map((i) => at(bar(0.08, 0.3, 0.05, 0.03, barMat), [-0.24 + i * 0.12, -0.55, 0.12]))
  const phone = group(body, screen, notch, ...eyes, smile, ...cheeks, ...bars)
  const chat = at(group(slab(bubble(0.7, 0.46, 0.2), 0.12, plastic(PAL.white), 0.04), ...[-0.18, 0, 0.18].map((x) => at(sphere(0.055, plastic(accent)), [x, 0.02, 0.1]))), [0.78, 0.62, 0.3])
  const root = group(phone, chat)
  return {
    root,
    update(t) {
      phone.rotation.z = Math.sin(t * 1.2) * 0.06
      const blink = phase(t, 3) > 0.94 ? 0.15 : 1
      eyes.forEach((e) => (e.scale.y = 1.3 * blink))
      bars.forEach((b, i) => (b.scale.y = 0.35 + 0.65 * Math.abs(Math.sin(t * 5 + i * 0.9))))
      const q = phase(t, 2.6)
      chat.scale.setScalar(Math.max(0.001, back(q / 0.18) * (1 - smooth((q - 0.85) / 0.15))))
      chat.position.y = 0.62 + Math.sin(t * 2) * 0.04
    },
  }
}

function globeSpin(accent: THREE.Color): Model {
  const earth = group(sphere(0.78, plastic('#4DA8FF', { roughness: 0.4 })))
  const land = plastic(PAL.green, { roughness: 0.5 })
  ;([[0.5, 0.3, 0.32], [-0.2, 1.4, 0.38], [0.15, 2.6, 0.3], [-0.55, 3.6, 0.28], [0.7, 4.4, 0.22], [-0.1, 5.3, 0.34]] as const).forEach(([lat, lon, r]) => {
    const dir = new THREE.Vector3(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon))
    const blob = sphere(r, land)
    blob.position.copy(dir).multiplyScalar(0.72)
    blob.lookAt(dir.clone().multiplyScalar(3))
    blob.scale.set(1, 0.8, 0.4)
    earth.add(blob)
  })
  const ringMat = plastic(PAL.white, { transparent: true, opacity: 0.85 })
  earth.add(at(torus(0.8, 0.018, ringMat), [0, 0, 0], [Math.PI / 2, 0, 0]))
  const orbitRing = torus(1.12, 0.025, plastic(accent, { transparent: true, opacity: 0.8 }))
  const sat = group(box(0.18, 0.18, 0.18, 0.05, plastic(PAL.white)), at(box(0.34, 0.03, 0.14, 0.01, plastic(PAL.blue)), [0, 0, 0]))
  const orbit = at(group(orbitRing, sat), [0, 0, 0], [1.2, 0.3, 0])
  const root = group(earth, orbit)
  return {
    root,
    update(t) {
      earth.rotation.y = t * 0.6
      const a = t * 1.4
      sat.position.set(Math.cos(a) * 1.12, Math.sin(a) * 1.12, 0)
      sat.rotation.z = a
    },
  }
}

function retroTerminal(accent: THREE.Color): Model {
  const beige = plastic('#EDE6D8', { roughness: 0.5 })
  const monitor = at(box(1.8, 1.35, 0.9, 0.26, beige), [0, 0.22, -0.1])
  const screen = at(box(1.42, 0.98, 0.06, 0.15, plastic('#14211B', { roughness: 0.2, clearcoat: 1 })), [0, 0.26, 0.36])
  const green = glow(accent, 1.4)
  const armA = at(capsule(0.04, 0.13, green), [-0.5, 0.48, 0.4], [0, 0, Math.PI / 4])
  const armB = at(capsule(0.04, 0.13, green), [-0.5, 0.34, 0.4], [0, 0, -Math.PI / 4])
  const caret = at(box(0.16, 0.05, 0.03, 0.02, green), [-0.24, 0.32, 0.4])
  const textMat = glow(accent, 0.6)
  const widths = [0.9, 0.6, 0.75]
  const lines = widths.map((w, i) => at(line(w, 0.06, textMat), [-0.58, 0.12 - i * 0.15, 0.4]))
  const keyboard = at(box(1.9, 0.14, 0.62, 0.07, beige), [0, -0.74, 0.42], [0.14, 0, 0])
  const keyMat = plastic('#FBF8F1')
  const keys: THREE.Mesh[] = []
  for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) keys.push(at(box(0.17, 0.07, 0.13, 0.03, keyMat), [-0.74 + c * 0.21, -0.65 - r * 0.02, 0.24 + r * 0.17], [0.14, 0, 0]))
  const root = at(group(monitor, screen, armA, armB, caret, ...lines, keyboard, ...keys), [0, 0.05, 0])
  return {
    root,
    update(t) {
      caret.visible = phase(t, 0.9) < 0.55
      const p = phase(t, 4.5) * 4.5
      lines.forEach((l, i) => (l.scale.x = Math.max(0.001, smooth(p - 0.3 - i))))
      const k = Math.floor(t * 9) % keys.length
      const k2 = (k * 7 + 3) % keys.length
      keys.forEach((key, i) => (key.position.y = -0.65 - Math.floor(i / 8) * 0.02 - (i === k || i === k2 ? 0.035 : 0)))
    },
  }
}

function toolbox(accent: THREE.Color): Model {
  const red = plastic(PAL.red)
  const body = at(box(1.8, 0.85, 0.9, 0.12, red), [0, -0.62, 0])
  const latch = at(box(0.26, 0.16, 0.06, 0.04, metal(PAL.gold, { metalness: 0.6 })), [0, -0.3, 0.46])
  const lid = group(at(box(1.82, 0.2, 0.92, 0.1, plastic(shade(new THREE.Color(PAL.red), 0.12))), [0, 0.1, 0.46]), at(torus(0.3, 0.06, plastic(PAL.ink), Math.PI), [0, 0.2, 0.46]))
  const hinge = at(group(lid), [0, -0.2, -0.46])
  const steel = metal(PAL.steel)
  const wrench = group(at(capsule(0.08, 0.75, steel), [0, 0, 0]), at(torus(0.17, 0.07, steel, Math.PI * 1.55), [0, 0.58, 0], [0, 0, -Math.PI * 0.27]))
  const driver = group(at(capsule(0.11, 0.3, plastic(accent)), [0, -0.2, 0]), at(cyl(0.035, 0.035, 0.5, steel), [0, 0.22, 0]), at(cone(0.05, 0.1, steel), [0, 0.5, 0]))
  const sparkMat = glow(PAL.gold, 1.8)
  const spark = new THREE.Mesh(new THREE.OctahedronGeometry(0.08), sparkMat)
  const root = group(body, latch, hinge, wrench, driver, spark)
  return {
    root,
    update(t) {
      const p = phase(t, 3.4) * 3.4
      const open = smooth(p / 0.45) * (1 - smooth((p - 2.8) / 0.4))
      hinge.rotation.x = -open * 1.25
      const rise = (d: number) => Math.max(0, Math.min(1, (p - 0.35 - d) / 0.5)) * (1 - smooth((p - 2.6) / 0.4))
      const w = back(rise(0))
      wrench.position.set(-0.32, -0.6 + w * 0.95, 0.05)
      wrench.rotation.set(0, 0, 0.35 + Math.sin(t * 2) * 0.1)
      wrench.scale.setScalar(Math.max(0.001, Math.min(1, w * 1.2)))
      const d = back(rise(0.2))
      driver.position.set(0.38, -0.6 + d * 0.9, 0.05)
      driver.rotation.set(0, t * 2, -0.3)
      driver.scale.setScalar(Math.max(0.001, Math.min(1, d * 1.2)))
      spark.position.set(0.05, 0.75 + Math.sin(t * 3) * 0.05, 0.3)
      spark.scale.setScalar(open * (0.6 + 0.4 * Math.abs(Math.sin(t * 4))) + 0.001)
      spark.rotation.y = t * 3
    },
  }
}

/** 全部模型：键 → 主色（传给模型做强调色，静态图也按它渲染）和构建函数 */
export const MODELS: Record<string, { color: string; build: Build }> = {
  // 服务分类（与 lib/categories.ts 的 serverCategories 同名同色）
  'ai-agents': { color: '#8B93A7', build: robot },
  memory: { color: '#3DBE6E', build: lightbulb },
  search: { color: '#9B6CE0', build: magnifier },
  browser: { color: '#2BB3A3', build: browserWindow },
  analytics: { color: '#22B8D9', build: barChart },
  'dev-tools': { color: '#5B8DEF', build: terminal },
  vcs: { color: '#D9622B', build: branchGraph },
  productivity: { color: '#B8C23A', build: clipboard },
  database: { color: '#4F7DD9', build: databaseStack },
  cloud: { color: '#22B8D9', build: cloud },
  storage: { color: '#D9944A', build: folder },
  communication: { color: '#D9577E', build: chatBubbles },
  media: { color: '#D9944A', build: paintPalette },
  finance: { color: '#B8C23A', build: coins },
  security: { color: '#E5484D', build: shieldBadge },
  'legal-gov': { color: '#8B7355', build: balanceScale },
  business: { color: '#D9944A', build: briefcase },
  social: { color: '#4F7DD9', build: people },
  travel: { color: '#2BB3A3', build: mapPin },
  health: { color: '#D9577E', build: heartbeat },
  entertainment: { color: '#9B6CE0', build: gamepad },
  science: { color: '#22B8D9', build: atom },
  other: { color: '#8B93A7', build: moreDots },
  // 其他目录的分类和各目录“全部”（映射见 catalog.ts）
  servers: { color: '#3DDC97', build: serverRack },
  editor: { color: '#5B8DEF', build: codeEditor },
  desktop: { color: '#D97757', build: desktopApp },
  layers: { color: '#22B8D9', build: layers },
  film: { color: '#9B6CE0', build: clapper },
  workflow: { color: '#3DBE6E', build: workflow },
  flask: { color: '#2BB3A3', build: flask },
  megaphone: { color: '#D9577E', build: megaphone },
  document: { color: '#5B8DEF', build: documentSheet },
  cycle: { color: '#3DDC97', build: cycleArrows },
  medal: { color: '#3DBE6E', build: medal },
  parcel: { color: '#5B8DEF', build: parcel },
  phone: { color: '#22B8D9', build: phoneAssistant },
  globe: { color: '#B8C23A', build: globeSpin },
  console: { color: '#3DDC97', build: retroTerminal },
  toolbox: { color: '#9B6CE0', build: toolbox },
}
