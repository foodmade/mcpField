/*
 * 首屏背景"手电筒"：横幅里铺满极暗的服务名和 Skill 名，一行行缓慢流动（相邻两行方向相反），
 * 鼠标是手电筒，照到的名字显出分类色；鼠标进入横幅时整片缓缓停住，方便选中。
 * 在某个名字上停一下（或点它），名字处冒出一个带图标的气泡，沿弧线飞进推荐卡的图标位置，
 * 推荐卡随之换成这个条目（由 onArrive 通知页面）。点空白处放出一圈光波。
 *
 * 只依赖 DOM 和 Canvas 2D，不依赖 React：每行文字预先画成首尾相接的长条，每帧按偏移拼到画布上，
 * 不重画文字。横幅滚出视口时停止渲染；系统开启"减少动态效果"时名字不流动、光圈静止、没有气泡和光波。
 */

export type FieldEntry = {
  key: string
  name: string
  color: string
  iconUrl: string | null
}

type Box = { x0: number; x: number; y: number; w: number; r: number; e: FieldEntry; a: number }
type Rect = { x: number; y: number; w: number; h: number }

export type FlashlightOptions = {
  canvas: HTMLCanvasElement
  /** 横幅：坐标都相对它计算，指针事件也挂在它上面 */
  host: HTMLElement
  /** 推荐卡和它的图标（气泡的落点）；窄屏隐藏时返回 null */
  card: () => HTMLElement | null
  icon: () => HTMLElement | null
  onLit?: (n: number) => void
  /** 气泡起飞：页面可以借这段时间预取详情、让卡片旧内容退半步 */
  onLaunch?: (e: FieldEntry) => void
  /** 气泡落进卡片：页面切换卡片内容 */
  onArrive: (e: FieldEntry) => void
  /** 用户选中了某个条目（鼠标停留或点击），轮播应停下 */
  onSelect?: (e: FieldEntry) => void
}

const FONT = '500 11.5px "Geist Mono Variable", ui-monospace, monospace'
const FONT_HOVER = '600 13px "Geist Mono Variable", ui-monospace, monospace'
const LH = 20 // 行高
const GAP = 24 // 名字最小间距
const R = 200 // 光圈半径
const HOT = 0.34 // 白色热点占光圈的比例
const WAVE_MS = 1100
const DWELL = 110 // 在名字上停这么久才算选中，扫过去不会一路触发
const SPEED: [number, number] = [10, 22] // 每行流动速度（像素/秒）
const STOP = 0.09 // 鼠标进入时刹停的快慢
const START = 0.03 // 离开后起步的快慢
const POP = 240, FLY = 480, MERGE = 200 // 气泡：冒出、飞行、融入（毫秒）
const TRAIL = 5

/** 固定种子的伪随机：每次打开排布一致 */
function rng(seed: number) {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

const springOut = (x: number) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2)
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)

export class Flashlight {
  private readonly o: FlashlightOptions
  private readonly ctx: CanvasRenderingContext2D
  private readonly layers = { dim: document.createElement('canvas'), color: document.createElement('canvas'), white: document.createElement('canvas') }
  private readonly buf = document.createElement('canvas')
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

  private entries: FieldEntry[] = []
  private W = 0
  private H = 0
  private L = 0
  private dpr = 1
  private boxes: Box[] = []
  private rows: Box[][] = []
  private off: number[] = []
  private vel: number[] = []
  private flow: number
  private cardBox: Rect | null = null
  private iconPos: { x: number; y: number } | null = null

  private inside = false
  private sx = 0
  private sy = 0
  private tx = 0
  private ty = 0
  private I = 0
  private targetI = 0.55
  private fade = 0 // 名字整体淡入（数据到达后的一次性入场）
  private hovered: Box | null = null
  private selected: Box | null = null
  private currentKey: string | null = null
  private wave: { x: number; y: number; t0: number; max: number } | null = null
  private flash = 0
  private readonly lit = new Set<Box>()
  private flight: { abort: () => void } | null = null
  private dwell = 0
  private raf = 0
  private last = 0
  private visible = true
  private readonly io: IntersectionObserver
  private readonly ro: ResizeObserver
  private readonly off$: (() => void)[] = []

  constructor(o: FlashlightOptions) {
    this.o = o
    this.ctx = o.canvas.getContext('2d')!
    this.flow = this.reduced ? 0 : 1
    this.io = new IntersectionObserver(([e]) => {
      const was = this.visible
      this.visible = e.isIntersecting
      if (this.visible && !was) this.loop()
    })
    this.io.observe(o.host)
    this.ro = new ResizeObserver(() => this.layout())
    this.ro.observe(o.host)
    this.listen()
    this.layout()
    this.loop()
  }

  /** 换一批名字（数据到达、切换语言时） */
  setEntries(entries: FieldEntry[]) {
    this.entries = entries
    this.fade = this.reduced ? 1 : 0
    this.layout()
  }

  /** 卡片当前展示的条目：同一个条目不再起飞，并在背景里给它留一道下划线 */
  setCurrent(key: string | null) {
    this.currentKey = key
    this.selected = key ? this.visibleBox(key) : null
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    clearTimeout(this.dwell)
    this.flight?.abort()
    this.io.disconnect()
    this.ro.disconnect()
    for (const f of this.off$) f()
  }

  /* ---------- 布局 ---------- */

  private layout() {
    const host = this.o.host.getBoundingClientRect()
    if (!host.width) return
    this.W = host.width
    this.H = host.height
    this.dpr = Math.min(devicePixelRatio || 1, 2)
    for (const c of [this.o.canvas, this.buf]) {
      c.width = Math.round(this.W * this.dpr)
      c.height = Math.round(this.H * this.dpr)
      c.getContext('2d')!.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    }
    const card = this.o.card()?.getBoundingClientRect()
    this.cardBox = card?.width ? { x: card.left - host.left, y: card.top - host.top, w: card.width, h: card.height } : null
    const icon = this.o.icon()?.getBoundingClientRect()
    this.iconPos = icon?.width ? { x: icon.left - host.left + icon.width / 2, y: icon.top - host.top + icon.height / 2 } : null
    this.buildRows()
  }

  /** 每行是一条首尾相接的循环带，长度 L 比横幅宽一截，保证同一个名字不会同时出现两次 */
  private buildRows() {
    const keep = this.currentKey
    this.boxes = []
    this.rows = []
    this.off = []
    this.vel = []
    this.lit.clear()
    this.o.onLit?.(0)
    if (!this.entries.length || !this.W) return
    this.L = Math.ceil(this.W + 340)
    const nRows = Math.ceil((this.H + LH) / LH)
    for (const c of Object.values(this.layers)) {
      c.width = Math.round(this.L * this.dpr)
      c.height = Math.round(nRows * LH * this.dpr)
      c.getContext('2d')!.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    }
    const m = this.layers.dim.getContext('2d')!
    m.font = FONT
    const rand = rng(11)
    let k = 0
    for (let r = 0; r < nRows; r++) {
      const pick: [FieldEntry, number][] = []
      let sum = 0
      for (let guard = 0; guard < this.entries.length; guard++) {
        const e = this.entries[k % this.entries.length]
        const w = m.measureText(e.name).width
        if (sum + w + (pick.length + 1) * GAP > this.L) break
        pick.push([e, w])
        sum += w
        k++
      }
      const gap = (this.L - sum) / Math.max(1, pick.length)
      const row: Box[] = []
      let x = 0
      for (const [e, w] of pick) {
        const b: Box = { x0: x, x, y: 16 + r * LH, w, r, e, a: 0.028 + rand() * 0.038 }
        row.push(b)
        this.boxes.push(b)
        x += w + gap
      }
      this.rows.push(row)
      this.off.push(rand() * this.L)
      this.vel.push((r % 2 ? -1 : 1) * (SPEED[0] + (((r * 7) % 9) / 8) * (SPEED[1] - SPEED[0])))
    }
    this.place()
    this.paint(this.layers.dim, (b) => `rgba(255,255,255,${b.a})`)
    this.paint(this.layers.color, (b) => b.e.color)
    this.paint(this.layers.white, () => '#ffffff')
    if (!this.sx) {
      this.sx = this.tx = this.W * 0.62
      this.sy = this.ty = this.H * 0.55
    }
    this.selected = keep ? this.visibleBox(keep) : null
  }

  private paint(c: HTMLCanvasElement, fill: (b: Box) => string) {
    const g = c.getContext('2d')!
    g.clearRect(0, 0, this.L, this.rows.length * LH)
    g.font = FONT
    for (const b of this.boxes) {
      g.fillStyle = fill(b)
      g.fillText(b.e.name, b.x0, b.r * LH + 15)
    }
  }

  /** 按当前偏移算出每个名字在屏幕上的位置 */
  private place() {
    for (const b of this.boxes) {
      let x = b.x0 - this.off[b.r]
      if (x + b.w < 0) x += this.L
      b.x = x
    }
  }

  /** 把某一层的各行按当前偏移拼到画布上（每行画两段，接缝处无缝衔接） */
  private drawRows(c: CanvasRenderingContext2D, src: HTMLCanvasElement) {
    const sh = LH * this.dpr
    for (let r = 0; r < this.rows.length; r++) {
      const top = 1 + r * LH
      const o = this.off[r]
      c.drawImage(src, 0, r * sh, src.width, sh, -o, top, this.L, LH)
      c.drawImage(src, 0, r * sh, src.width, sh, this.L - o, top, this.L, LH)
    }
  }

  /* ---------- 绘制 ---------- */

  private loop = () => {
    cancelAnimationFrame(this.raf)
    if (this.visible) this.raf = requestAnimationFrame(this.frame)
  }

  private frame = (now: number) => {
    if (!this.visible) return
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000)
    this.last = now
    const { ctx, W, H } = this
    if (!this.reduced) {
      this.flow += ((this.inside ? 0 : 1) - this.flow) * (this.inside ? STOP : START)
      if (this.flow > 0.002 && this.rows.length) {
        for (let r = 0; r < this.rows.length; r++) this.off[r] = (((this.off[r] + this.vel[r] * this.flow * dt) % this.L) + this.L) % this.L
        this.place()
      }
      // 没人操作时光圈自己巡游
      if (!this.inside) {
        const t = now / 1000
        this.tx = W * (0.66 + 0.2 * Math.sin(t * 0.23))
        this.ty = H * (0.5 + 0.3 * Math.sin(t * 0.31 + 1.2))
      }
    }
    const k = this.reduced ? 1 : 0.13
    this.sx += (this.tx - this.sx) * k
    this.sy += (this.ty - this.sy) * k
    this.I += (this.targetI - this.I) * (this.reduced ? 1 : 0.08)
    this.fade = Math.min(1, this.fade + dt / 1.2)

    ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(0, 0, W, H)
    if (this.rows.length) {
      ctx.globalAlpha = this.fade
      this.drawRows(ctx, this.layers.dim)
      const I = this.I
      // 推荐卡背后常驻一小片光，卡片像站在光里
      const cb = this.cardBox
      if (cb) this.reveal(this.layers.color, (c) => this.radial(c, cb.x + cb.w / 2, cb.y + cb.h / 2, cb.w * 0.78, [[0, 0.24], [0.6, 0.13], [1, 0]]), false)
      this.reveal(this.layers.color, (c) => this.radial(c, this.sx, this.sy, R, [[0, I], [0.45, I * 0.75], [0.8, I * 0.2], [1, 0]]))
      this.reveal(this.layers.white, (c) => this.radial(c, this.sx, this.sy, R * HOT, [[0, I * 0.95], [0.6, I * 0.45], [1, 0]]))
      this.drawWave(now)
      ctx.globalAlpha = 1

      ctx.globalCompositeOperation = 'lighter'
      const glow = ctx.createRadialGradient(this.sx, this.sy, 0, this.sx, this.sy, R * 1.25)
      glow.addColorStop(0, `rgba(61,220,151,${0.07 * I})`)
      glow.addColorStop(1, 'rgba(61,220,151,0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, W, H)
      ctx.globalCompositeOperation = 'source-over'

      const s = this.selected
      if (s && s !== this.hovered && (this.inside || this.clear(s))) {
        this.erase(s)
        ctx.font = FONT
        ctx.fillStyle = '#ffffffcc'
        ctx.fillText(s.e.name, s.x, s.y)
        ctx.fillStyle = s.e.color
        ctx.fillRect(s.x, s.y + 4, s.w, 1.5)
      }
      if (this.hovered) this.drawHover(this.hovered)
      if (this.inside) this.countRing(this.sx, this.sy, 0, R * 0.42)
    }
    this.lightCard()
    this.raf = requestAnimationFrame(this.frame)
  }

  /** 左侧文案区光线减弱：0 ~ 38% 宽度只保留 45%（窄屏文案铺满，整体减弱） */
  private dampen(c: CanvasRenderingContext2D) {
    c.globalCompositeOperation = 'destination-in'
    if (this.W < 1024) {
      c.fillStyle = 'rgba(0,0,0,0.6)'
    } else {
      const g = c.createLinearGradient(0, 0, this.W, 0)
      g.addColorStop(0, 'rgba(0,0,0,0.45)')
      g.addColorStop(0.38, 'rgba(0,0,0,0.45)')
      g.addColorStop(0.55, 'rgba(0,0,0,1)')
      g.addColorStop(1, 'rgba(0,0,0,1)')
      c.fillStyle = g
    }
    c.fillRect(0, 0, this.W, this.H)
  }

  /** 把某一层按遮罩画到主画布上 */
  private reveal(src: HTMLCanvasElement, mask: (c: CanvasRenderingContext2D) => void, damp = true) {
    const b = this.buf.getContext('2d')!
    b.globalCompositeOperation = 'source-over'
    b.clearRect(0, 0, this.W, this.H)
    this.drawRows(b, src)
    b.globalCompositeOperation = 'destination-in'
    mask(b)
    if (damp) this.dampen(b)
    b.globalCompositeOperation = 'source-over'
    this.ctx.drawImage(this.buf, 0, 0, this.W, this.H)
  }

  private radial(c: CanvasRenderingContext2D, x: number, y: number, r: number, stops: [number, number][]) {
    const g = c.createRadialGradient(x, y, 0, x, y, r)
    for (const [p, a] of stops) g.addColorStop(p, `rgba(0,0,0,${a})`)
    c.fillStyle = g
    c.fillRect(0, 0, this.W, this.H)
  }

  /** 点击光波：一圈亮带扫过整个横幅，同时全场短暂亮一下 */
  private drawWave(now: number) {
    const w = this.wave
    if (!w) return
    const p = (now - w.t0) / WAVE_MS
    if (p >= 1) {
      this.wave = null
      return
    }
    const r = (1 - Math.pow(1 - p, 3)) * w.max
    const fade = 1 - p
    this.reveal(this.layers.color, (c) => {
      const g = c.createRadialGradient(w.x, w.y, 0, w.x, w.y, r + 16)
      const band = Math.max(0, (r - 110) / (r + 16))
      g.addColorStop(0, `rgba(0,0,0,${0.22 * fade})`)
      g.addColorStop(band, `rgba(0,0,0,${0.22 * fade})`)
      g.addColorStop(Math.max(band, r / (r + 16)), `rgba(0,0,0,${0.95 * fade})`)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      c.fillStyle = g
      c.fillRect(0, 0, this.W, this.H)
    })
    this.countRing(w.x, w.y, r - 110, r)
  }

  /** 重绘名字前先擦掉原来那一行字，避免重影 */
  private erase(b: Box) {
    const { ctx } = this
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = '#000'
    ctx.fillRect(b.x - 2, b.y - 11, b.w + 4, 16)
    ctx.restore()
  }

  /** 悬停的名字：放大、发光、下划线 */
  private drawHover(b: Box) {
    const { ctx } = this
    this.erase(b)
    ctx.save()
    ctx.font = FONT_HOVER
    const w = ctx.measureText(b.e.name).width
    const x = b.x - (w - b.w) / 2
    ctx.shadowColor = b.e.color
    ctx.shadowBlur = 14
    ctx.fillStyle = '#ffffff'
    ctx.fillText(b.e.name, x, b.y + 1)
    ctx.shadowBlur = 0
    ctx.fillStyle = b.e.color
    ctx.fillRect(x, b.y + 5, w, 1.5)
    ctx.restore()
  }

  /** 推荐卡边缘受光：光圈靠近时朝向光的一段亮；新条目飞入时整圈闪一下 */
  private lightCard() {
    const card = this.o.card()
    const cb = this.cardBox
    if (!card || !cb) return
    const dx = Math.max(cb.x - this.sx, 0, this.sx - (cb.x + cb.w))
    const dy = Math.max(cb.y - this.sy, 0, this.sy - (cb.y + cb.h))
    const near = Math.max(0, 1 - Math.hypot(dx, dy) / (R * 1.1)) * this.I
    this.flash *= 0.94
    const useFlash = this.flash > near && this.iconPos
    const ox = useFlash ? this.iconPos!.x - cb.x : this.sx - cb.x
    const oy = useFlash ? this.iconPos!.y - cb.y : this.sy - cb.y
    card.style.setProperty('--mx', `${ox.toFixed(0)}px`)
    card.style.setProperty('--my', `${oy.toFixed(0)}px`)
    card.style.setProperty('--edge', Math.max(near, this.flash).toFixed(3))
  }

  /** 圆环 [r0, r1] 内的名字记为"已照亮" */
  private countRing(x: number, y: number, r0: number, r1: number) {
    const before = this.lit.size
    const a = Math.max(0, this.rowAt(y - r1))
    const z = Math.min(this.rows.length - 1, this.rowAt(y + r1))
    for (let i = a; i <= z; i++) {
      for (const b of this.rows[i]) {
        const d = Math.hypot(b.x + b.w / 2 - x, b.y - 4 - y)
        if (d >= r0 && d <= r1) this.lit.add(b)
      }
    }
    if (this.lit.size !== before) this.o.onLit?.(this.lit.size)
  }

  private rowAt(y: number) {
    return Math.floor((y - 16 + LH * 0.75) / LH)
  }

  private hitTest(x: number, y: number): Box | null {
    const row = this.rows[this.rowAt(y)]
    if (!row) return null
    for (const b of row) if (x >= b.x - 3 && x <= b.x + b.w + 3) return b
    return null
  }

  /** 不在左侧文案区、也不被推荐卡挡住的位置 */
  private clear(b: Box) {
    const cb = this.cardBox
    return (
      b.x > this.W * 0.42 && b.x + b.w < this.W - 8 && b.y > 30 && b.y < this.H - 8 &&
      !(cb && b.x + b.w > cb.x - 8 && b.y > cb.y - 4 && b.y < cb.y + cb.h + 12)
    )
  }

  private visibleBox(key: string) {
    return this.boxes.find((b) => b.e.key === key && this.clear(b)) ?? this.boxes.find((b) => b.e.key === key) ?? null
  }

  /* ---------- 交互 ---------- */

  private listen() {
    const host = this.o.host
    const local = (e: PointerEvent) => {
      const r = host.getBoundingClientRect()
      return [e.clientX - r.left, e.clientY - r.top] as const
    }
    // 链接、按钮和推荐卡上不触发选中
    const solid = (t: EventTarget | null) => t instanceof Element && !!t.closest('a, button, [data-fx-solid]')
    const move = (e: PointerEvent) => {
      const [x, y] = local(e)
      this.inside = true
      this.targetI = 1
      this.tx = x
      this.ty = y
      const b = solid(e.target) ? null : this.hitTest(x, y)
      if (b === this.hovered) return
      this.hovered = b
      host.style.cursor = b ? 'pointer' : ''
      clearTimeout(this.dwell)
      if (b && b.e.key !== this.currentKey) this.dwell = window.setTimeout(() => this.hovered === b && this.launch(b), DWELL)
    }
    const leave = () => {
      this.inside = false
      this.targetI = 0.5
      this.hovered = null
      clearTimeout(this.dwell)
      host.style.cursor = ''
    }
    const down = (e: PointerEvent) => {
      if (solid(e.target)) return
      const [x, y] = local(e)
      const b = this.hitTest(x, y)
      if (b) {
        clearTimeout(this.dwell)
        if (b.e.key !== this.currentKey) this.launch(b)
        return
      }
      if (!this.reduced) this.wave = { x, y, t0: performance.now(), max: Math.hypot(Math.max(x, this.W - x), Math.max(y, this.H - y)) + 60 }
    }
    host.addEventListener('pointermove', move)
    host.addEventListener('pointerleave', leave)
    host.addEventListener('pointerdown', down)
    this.off$.push(() => {
      host.removeEventListener('pointermove', move)
      host.removeEventListener('pointerleave', leave)
      host.removeEventListener('pointerdown', down)
    })
  }

  /** 气泡：从名字处冒出，沿弧线飞进卡片图标的位置 */
  private launch(b: Box) {
    const e = b.e
    this.flight?.abort()
    this.selected = b
    this.currentKey = e.key
    this.o.onSelect?.(e)
    const target = this.iconPos
    if (this.reduced || !target) {
      this.o.onArrive(e)
      return
    }
    this.o.onLaunch?.(e)

    const host = this.o.host
    const el = this.bubble(e)
    const trail = Array.from({ length: TRAIL }, () => {
      const t = document.createElement('div')
      t.className = 'fx-trail'
      t.style.background = e.color
      t.style.opacity = '0'
      host.append(t)
      return t
    })
    host.append(el)

    const p0 = { x: b.x + b.w / 2, y: b.y - 6 }
    const p2 = target
    const p1 = { x: (p0.x + p2.x) / 2 + (p2.x > p0.x ? -40 : 40), y: Math.min(p0.y, p2.y) - 90 }
    const at = (t: number) => ({
      x: (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x,
      y: (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y,
    })
    const t0 = performance.now()
    let arrived = false
    let raf = 0
    const cleanup = () => {
      el.remove()
      for (const t of trail) t.remove()
    }
    const step = (now: number) => {
      const t = now - t0
      if (t < POP) {
        // 冒出：在名字上方弹出来，带一点过冲
        el.style.transform = `translate(${p0.x}px, ${p0.y - 10 * (t / POP)}px) scale(${0.2 + 0.8 * springOut(t / POP)})`
        el.style.opacity = String(Math.min(1, t / 90))
      } else if (t < POP + FLY) {
        const f = easeInOut((t - POP) / FLY)
        const p = at(f)
        el.style.transform = `translate(${p.x}px, ${p.y - 10 * (1 - f)}px) scale(${1 - 0.06 * Math.sin(f * Math.PI)})`
        trail.forEach((d, i) => {
          const q = at(Math.max(0, f - (i + 1) * 0.045))
          d.style.transform = `translate(${q.x}px, ${q.y}px) scale(${1 - i * 0.16})`
          d.style.opacity = String((0.5 - i * 0.09) * Math.sin(Math.min(1, f * 1.4) * Math.PI))
        })
      } else if (t < POP + FLY + MERGE) {
        // 落进卡片：气泡胀开变淡，卡片内容同时浮现
        if (!arrived) {
          arrived = true
          this.flash = 1
          for (const d of trail) d.style.opacity = '0'
          this.o.onArrive(e)
        }
        const f = (t - POP - FLY) / MERGE
        el.style.transform = `translate(${p2.x}px, ${p2.y}px) scale(${1 + 0.45 * f})`
        el.style.opacity = String(1 - f)
      } else {
        cleanup()
        this.flight = null
        return
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    this.flight = {
      abort: () => {
        cancelAnimationFrame(raf)
        for (const t of trail) t.remove()
        el.animate([{ opacity: el.style.opacity || '1' }, { opacity: 0 }], { duration: 140 }).onfinish = () => el.remove()
      },
    }
  }

  private bubble(e: FieldEntry) {
    const el = document.createElement('div')
    el.className = 'fx-bubble'
    el.style.background = `linear-gradient(${e.color}47, ${e.color}47), #0c1118`
    el.style.border = `1px solid ${e.color}80`
    el.style.boxShadow = `0 0 0 4px ${e.color}1f, 0 10px 30px ${e.color}55`
    el.style.color = e.color
    el.textContent = (e.name.replace(/^[^A-Za-z0-9]+/, '')[0] ?? '?').toUpperCase()
    if (e.iconUrl) {
      const img = document.createElement('img')
      img.src = e.iconUrl
      img.alt = ''
      img.referrerPolicy = 'no-referrer'
      img.onerror = () => img.remove()
      el.append(img)
    }
    return el
  }
}
