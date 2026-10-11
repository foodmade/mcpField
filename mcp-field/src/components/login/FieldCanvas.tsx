import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import fragmentSource from './field.glsl?raw'

/*
 * 登录页背景"光之田"：全屏 WebGL 片段着色器，与设计稿共用 field.glsl（设计稿里同名文件，保持一致）。
 * 着色器的 u_freeze 是"时间覆盖"：≥0 时直接用它作为当前时刻且不循环，这里传入页面打开后的秒数，
 * 开场光带只播一次，之后的闪烁和光点流动继续。
 * 系统开启"减少动态效果"时只画落定后的一帧；不支持 WebGL 时显示同一画面的静态图。
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

    let program: WebGLProgram
    try {
      program = gl.createProgram()!
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX))
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource))
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
