/*
 * 光之田的鼠标互动：把画布上的位置换算成田地里的格子，记录哪些格子正在弹起。
 * 几何参数必须与 field.glsl 一致（CAM、ROW、LEN、格子半尺寸、BOUNCE）。
 */

const CAM = 0.08
const ROW = 0.026
const LEN = 0.034
const HALF_X = ROW * 0.36
const HALF_Z = LEN * 0.34
/** 一次弹跳的总时长（秒），与着色器的 BOUNCE 相同 */
export const BOUNCE = 0.8
/** 同一格子在这段时间内不会被同样或更弱的触发再次弹起，鼠标停在格子上不会一直跳 */
const COOLDOWN = 0.8
/** 格子在屏幕上小于这么多设备像素就不响应（远处雾里的格子） */
const MIN_TILE_PX = 4
/** 涟漪：周围一圈格子稍晚小跳，[列偏移, 行偏移, 延迟秒, 力度] */
const RING: [number, number, number, number][] = [
  [-1, 0, 0.045, 0.5],
  [1, 0, 0.045, 0.5],
  [0, -1, 0.045, 0.5],
  [0, 1, 0.045, 0.5],
  [-1, -1, 0.07, 0.35],
  [1, -1, 0.07, 0.35],
  [-1, 1, 0.07, 0.35],
  [1, 1, 0.07, 0.35],
]

export type Cell = { ix: number; iz: number; X: number; Z: number }

/**
 * 画布上的一点（CSS 像素，左上角为原点）→ 田地坐标与格子编号。
 * 在地平线以上、或格子小到看不清时返回 null。dpr 是画布的设备像素比，用来判断格子在屏幕上的大小。
 */
export function cellAt(x: number, y: number, width: number, height: number, horizon: number, dpr: number): Cell | null {
  const d = y / height - horizon
  if (d <= 0.004 || x < 0 || x > width || y > height) return null
  const xs = (x / width - 0.5) * (width / height)
  const Z = CAM / d
  const X = xs * Z
  const px = 1 / (height * dpr)
  const hx = HALF_X / (Z * px * Math.hypot(1, (xs * Z) / CAM))
  const hz = HALF_Z / (((Z * Z) / CAM) * px)
  if (Math.min(hx, hz) * 2 < MIN_TILE_PX) return null
  return { ix: Math.floor(X / ROW + 0.5), iz: Math.floor(Z / LEN), X, Z }
}

type Hit = { ix: number; iz: number; t0: number; strength: number }

/** 正在弹起的格子。时间单位为秒 */
export class FieldHits {
  private hits: Hit[] = []
  private last = new Map<string, { at: number; strength: number }>()

  private readonly capacity: number

  constructor(capacity: number) {
    this.capacity = capacity
  }

  /** 鼠标进入一个格子：它弹起，周围一圈稍晚小跳 */
  trigger(ix: number, iz: number, now: number) {
    if (!this.fire(ix, iz, now, 1)) return
    for (const [dx, dz, delay, strength] of RING) this.fire(ix + dx, iz + dz, now + delay, strength)
  }

  private fire(ix: number, iz: number, at: number, strength: number): boolean {
    // 中间的小径没有格子
    if (ix === 0) return false
    const key = `${ix},${iz}`
    const prev = this.last.get(key)
    if (prev && at - prev.at < COOLDOWN && prev.strength >= strength) return false
    // 更强的触发（鼠标直接经过刚被涟漪带起的格子）取代原来那次
    this.hits = this.hits.filter((h) => h.ix !== ix || h.iz !== iz)
    this.last.set(key, { at, strength })
    this.hits.push({ ix, iz, t0: at, strength })
    return true
  }

  /** 是否还有格子在跳（或等待涟漪开始） */
  get active() {
    return this.hits.length > 0
  }

  /** 把已经开始的弹跳写进 out（每个格子 4 个数：列、行、已过秒数、力度），返回数量；容量不够时保留最新的 */
  write(out: Float32Array, now: number): number {
    this.hits = this.hits.filter((h) => now - h.t0 < BOUNCE)
    if (this.last.size > 256) for (const [k, v] of this.last) if (now - v.at > COOLDOWN) this.last.delete(k)
    const started = this.hits.filter((h) => now >= h.t0).sort((a, b) => b.t0 - a.t0)
    const n = Math.min(started.length, this.capacity)
    for (let i = 0; i < n; i++) {
      const h = started[i]!
      out.set([h.ix, h.iz, now - h.t0, h.strength], i * 4)
    }
    return n
  }
}
