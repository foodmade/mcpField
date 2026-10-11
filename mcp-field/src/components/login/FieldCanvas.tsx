import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import fragmentSource from './field.glsl?raw'
import { cellAt, FieldHits } from './fieldHits'

/*
 * 登录页背景"光之田"：全屏 WebGL 片段着色器，与设计稿共用 field.glsl（设计稿里同名文件，保持一致）。
 * 着色器的 u_freeze 是"时间覆盖"：≥0 时直接用它作为当前时刻且不循环，这里传入页面打开后的秒数，
 * 开场光带只播一次，之后的闪烁和光点流动继续。
 * 鼠标（或手指）划过田地时，经过的格子弹起、周围一圈跟着小跳，鼠标处的地面有一圈光（fieldHits.ts 负责换算和记录）。
 * 系统开启"减少动态效果"时只画落定后的一帧，格子不跳、只保留光圈；不支持 WebGL 时显示同一画面的静态图。
 */

const VERTEX = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}'
/** 开场动画结束后的时刻（秒） */
const SETTLED = 4
const HOVER_IN = 0.25
const HOVER_OUT = 0.4
const CONNECT = 0.6
/** 按设备像素比渲染（最高 2 倍）；低于这个分辨率远处的田会发虚 */
const MAX_DPR = 2
/** 开场之后连续这么多帧都超过 SLOW_FRAME 秒，就降到 1 倍分辨率（低端集显） */
const SLOW_FRAMES = 45
const SLOW_FRAME = 0.028
/** 同时弹起的格子最多这么多，再受显卡的 uniform 容量限制 */
const MAX_HITS = 48
/** 鼠标移动很快时，每隔这么多 CSS 像素取一个点，中间经过的格子都会被触发 */
const TRACE_STEP = 6

type Props = {
  /** 地平线距顶部的比例，登录内容就压在地平线上方 */
  horizon: number
  /** 鼠标悬停或聚焦在登录按钮上：远处的田亮起来，光线沿行流向地平线 */
  hover: boolean
  /** 已发起登录：一道光沿所有行冲向地平线 */
  connecting: boolean
  className?: string
}

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compile failed')
  return shader
}

export function FieldCanvas({ horizon, hover, connecting, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // 逐帧读取最新的参数，不因参数变化重建 WebGL 上下文
  const props = useRef({ horizon, hover, connecting })
  const redraw = useRef<() => void>(() => {})
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    props.current = { horizon, hover, connecting }
  }, [horizon, hover, connecting])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: false })
    if (!gl) return setFailed(true)

    // 片段着色器的 uniform 容量因显卡而异（手机可能只有 64 个 vec4），按容量决定能同时弹起多少格子
    const maxHits = Math.max(1, Math.min(MAX_HITS, (gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) as number) - 16))
    let program: WebGLProgram
    try {
      program = gl.createProgram()!
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX))
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, `#define MAX_HITS ${maxHits}\n${fragmentSource}`))
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link failed')
    } catch (error) {
      console.error('光之田着色器初始化失败', error)
      return setFailed(true)
    }
    gl.useProgram(program)
    // 一个覆盖整个画面的三角形
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(program, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    const u = (name: string) => gl.getUniformLocation(program, name)
    const uRes = u('u_resolution')
    const uTime = u('u_time')
    const uHorizon = u('u_horizon')
    const uFreeze = u('u_freeze')
    const uHover = u('u_hover')
    const uConnect = u('u_connect')
    const uHits = u('u_hits')
    const uHitCount = u('u_hitCount')
    const uMouse = u('u_mouse')
    const hitData = new Float32Array(maxHits * 4)
    const hits = new FieldHits(maxHits)
    // 鼠标在田地上的位置；glow 是光圈当前强度，鼠标离开田地后渐隐
    const mouse = { X: 0, Z: 0, on: false, glow: 0, prev: null as { x: number; y: number } | null, key: '' }

    const reduce = matchMedia('(prefers-reduced-motion: reduce)')
    const start = performance.now()
    let last = start
    let hoverV = 0
    let connectV = 0
    let raf = 0
    let slow = 0
    let reduced = false

    const resize = () => {
      const dpr = reduced ? 1 : Math.min(window.devicePixelRatio || 1, MAX_DPR)
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
        gl.viewport(0, 0, w, h)
      }
    }

    const draw = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const p = props.current
      const still = reduce.matches
      if (!still && !reduced && now - start > (SETTLED + 1) * 1000) {
        slow = dt > SLOW_FRAME ? slow + 1 : Math.max(0, slow - 1)
        reduced = slow > SLOW_FRAMES
      }
      hoverV = still ? 0 : p.hover ? Math.min(1, hoverV + dt / HOVER_IN) : Math.max(0, hoverV - dt / HOVER_OUT)
      connectV = still ? 0 : p.connecting ? Math.min(1, connectV + dt / CONNECT) : 0
      resize()
      gl.uniform2f(uRes, canvas.width, canvas.height)
      gl.uniform1f(uTime, 0)
      gl.uniform1f(uHorizon, p.horizon)
      gl.uniform1f(uFreeze, still ? SETTLED : (now - start) / 1000)
      gl.uniform1f(uHover, hoverV * hoverV * (3 - 2 * hoverV))
      gl.uniform1f(uConnect, connectV * connectV)
      mouse.glow = still ? Number(mouse.on) : mouse.glow + (Number(mouse.on) - mouse.glow) * Math.min(1, dt * (mouse.on ? 10 : 4))
      gl.uniform3f(uMouse, mouse.X, mouse.Z, mouse.glow)
      gl.uniform1f(uHitCount, still ? 0 : hits.write(hitData, now / 1000))
      gl.uniform4fv(uHits, hitData)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    const loop = (now: number) => {
      draw(now)
      if (!reduce.matches) raf = requestAnimationFrame(loop)
    }
    const restart = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(loop)
    }
    redraw.current = () => {
      if (reduce.matches) restart()
    }
    restart()

    const observer = new ResizeObserver(() => redraw.current())
    observer.observe(canvas)
    reduce.addEventListener('change', restart)

    // 从上一个位置到当前位置沿途取点，进入新格子就触发一次弹跳
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      const dpr = canvas.width / Math.max(1, rect.width)
      const to = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      const from = mouse.prev ?? to
      const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / TRACE_STEP))
      const now = performance.now() / 1000
      let cell = null
      for (let i = 1; i <= steps; i++) {
        const k = i / steps
        cell = cellAt(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k, rect.width, rect.height, props.current.horizon, dpr)
        const key = cell ? `${cell.ix},${cell.iz}` : ''
        if (cell && key !== mouse.key && !reduce.matches) hits.trigger(cell.ix, cell.iz, now)
        mouse.key = key
      }
      mouse.prev = to
      mouse.on = !!cell
      if (cell) {
        mouse.X = cell.X
        mouse.Z = cell.Z
      }
      redraw.current()
    }
    const onLeave = (e: PointerEvent) => {
      if (e.relatedTarget) return
      mouse.on = false
      mouse.prev = null
      mouse.key = ''
      redraw.current()
    }
    const onBlur = () => {
      mouse.on = false
      mouse.prev = null
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onMove, { passive: true })
    window.addEventListener('pointerout', onLeave)
    window.addEventListener('blur', onBlur)
    const lost = (e: Event) => {
      e.preventDefault()
      cancelAnimationFrame(raf)
      setFailed(true)
    }
    canvas.addEventListener('webglcontextlost', lost)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      reduce.removeEventListener('change', restart)
      canvas.removeEventListener('webglcontextlost', lost)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onMove)
      window.removeEventListener('pointerout', onLeave)
      window.removeEventListener('blur', onBlur)
      redraw.current = () => {}
    }
  }, [])

  // 减少动态效果时没有逐帧循环，地平线位置变化后要手动重画一帧
  useEffect(() => redraw.current(), [horizon])

  if (failed) {
    return (
      <div
        aria-hidden
        className={clsx('bg-cover bg-[position:center_72%] bg-[url(/login-field-mobile.webp)] sm:bg-[position:center_62%] sm:bg-[url(/login-field.webp)]', className)}
      />
    )
  }
  return <canvas ref={canvasRef} aria-hidden className={className} />
}
