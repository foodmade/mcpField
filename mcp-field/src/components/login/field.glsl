precision highp float;

/*
 * MCP Field 登录页背景：一片"光之田"。
 * 每一格光点代表一个收录条目，按分类颜色成行种植，所有行在地平线中央（登录按钮下方）汇聚。
 * 动画：开场光带从地平线扫向近处逐行点亮；之后风一样的亮带持续掠过田野，行缝里的光一直流向地平线；
 * 悬停按钮时远处变亮、光流更强；点击后所有行亮起一道光。
 * 只画能看清的瓷砖：远处小到只剩几个像素的瓷砖淡入地平线的雾里，画面里出现的东西都是清晰的，不会糊成马赛克。
 */

/** @resolution */
uniform vec2 u_resolution;

/** @time */
uniform float u_time;

/**
 * @label 地平线位置（距顶部比例）
 * @default 0.62
 * @range 0.3, 0.9
 */
uniform float u_horizon;

/**
 * @label 定格时间（秒，-1 为实时播放）
 * @default -1
 * @range -1, 30
 */
uniform float u_freeze;

/**
 * @label 悬停登录按钮
 * @default 0
 * @range 0, 1
 */
uniform float u_hover;

/**
 * @label 点击后连接进度
 * @default 0
 * @range 0, 1
 */
uniform float u_connect;

const float CAM = 0.08;
const float ROW = 0.026;
const float LEN = 0.034;
const float T0 = 0.3;
const float SWEEP = 1.6;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec3 palette(float i) {
  float k = mod(i, 8.0);
  if (k < 0.5) return vec3(0.357, 0.553, 0.937);
  if (k < 1.5) return vec3(0.169, 0.702, 0.639);
  if (k < 2.5) return vec3(0.608, 0.424, 0.878);
  if (k < 3.5) return vec3(0.239, 0.745, 0.431);
  if (k < 4.5) return vec3(0.851, 0.580, 0.290);
  if (k < 5.5) return vec3(0.133, 0.722, 0.851);
  if (k < 6.5) return vec3(0.851, 0.341, 0.494);
  return vec3(0.310, 0.490, 0.851);
}

float easeInOut(float x) {
  x = clamp(x, 0.0, 1.0);
  return x < 0.5 ? 4.0 * x * x * x : 1.0 - pow(-2.0 * x + 2.0, 3.0) / 2.0;
}

void main() {
  vec2 res = u_resolution;
  vec2 uv = gl_FragCoord.xy / res;
  float px = 1.0 / res.y;
  float xs = (uv.x - 0.5) * res.x / res.y;
  float d = (1.0 - uv.y) - u_horizon;
  float t = u_freeze >= 0.0 ? u_freeze : u_time;
  float dMax = 1.0 - u_horizon;

  float sweepK = easeInOut((t - T0) / SWEEP);
  float front = sweepK * (dMax + 0.08);
  float sweeping = smoothstep(T0, T0 + 0.1, t) * (1.0 - smoothstep(T0 + SWEEP, T0 + SWEEP + 0.6, t));
  float dawn = smoothstep(T0, T0 + SWEEP, t);
  float c = clamp(u_connect, 0.0, 1.0);

  float sky = clamp(1.0 + d / u_horizon, 0.0, 1.0);
  vec3 horizonTone = vec3(0.075, 0.110, 0.200);
  vec3 col = mix(vec3(0.027, 0.035, 0.063), horizonTone, pow(sky, 3.0) * (0.55 + 0.45 * dawn));

  if (d > 0.0) {
    float dd = max(d, 0.0008);
    float Z = CAM / dd;
    float X = xs * Z;
    // 一个像素覆盖的田地宽度：两侧的行接近水平，竖直方向上的变化也要算进去，否则行的边缘会出现摩尔纹
    float dXp = Z * px * sqrt(1.0 + (xs * Z / CAM) * (xs * Z / CAM));
    float dZp = Z * Z / CAM * px;
    float fog = smoothstep(0.0, 0.035, d);

    col = mix(horizonTone * (0.55 + 0.45 * dawn), vec3(0.039, 0.047, 0.071), smoothstep(0.0, 0.12, d));
    // 地平线下的薄雾：远处看不清的田在这里化成一层柔和的光
    col += vec3(0.07, 0.12, 0.22) * exp(-d * 24.0) * (0.5 + 0.5 * dawn);

    float gx = X / ROW + 0.5;
    float ix = floor(gx);
    float fx = fract(gx);
    float gz = Z / LEN;
    float iz = floor(gz);
    float fz = fract(gz);
    float planted = abs(ix) > 0.5 ? 1.0 : 0.0;

    float h = hash(vec2(ix, iz));
    float h2 = hash(vec2(iz, ix) + 7.1);
    vec3 tint = palette(ix + (ix < 0.0 ? 3.0 : 0.0));

    vec2 hs = vec2(ROW * 0.36, LEN * 0.34);
    vec2 scale = vec2(dXp, dZp);
    vec2 lp = abs(vec2((fx - 0.5) * ROW, (fz - 0.5) * LEN)) / scale;
    vec2 hp = hs / scale;
    float r = min(hp.x, hp.y) * 0.4;
    vec2 q = lp - hp + r;
    float sdf = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
    float mask = clamp(0.5 - sdf, 0.0, 1.0);
    float rim = mask * (1.0 - smoothstep(0.0, 2.5, -sdf));
    float halo = exp(-max(sdf, 0.0) / (2.0 + min(hp.x, hp.y) * 0.25)) * (1.0 - mask);
    // vis：瓷砖在两个方向上都有几个像素大才画，再小就淡入雾里（两侧的行接近水平，会更早淡出）
    float vis = smoothstep(2.0, 8.0, min(hp.x, hp.y) * 2.0);
    float present = step(0.14, h) * planted * vis;
    float m = mask * present;
    float rimM = rim * present;
    float haloM = halo * present;

    float dTile = CAM / ((iz + 0.5) * LEN);
    float lit = step(dTile, front);
    float flash = lit * exp(-(front - dTile) * 25.0) * sweeping;
    float twinkle = step(0.94, h2) * (0.5 + 0.5 * sin(t * 2.3 + h * 50.0));
    float level = 0.08 + lit * (0.7 + 0.6 * h2 * h2 + twinkle * 1.2) + flash * 2.6;
    float lz = log(Z);
    // 风吹过田：一道道亮带不停地从近处推向地平线，带子微微弯曲
    float wave = 0.5 + 0.5 * sin(lz * 2.6 - t * 0.9 + sin(X * 7.0 + t * 0.35) * 0.7);
    level *= 0.78 + 0.62 * wave * wave * wave * dawn;
    level *= mix(1.15, 0.5, smoothstep(0.04, dMax, d));
    level *= exp(-abs(xs) * 0.7);
    level *= 1.0 + u_hover * 1.4 * exp(-d * 14.0) + c * 0.6;

    col += tint * level * (m * 0.5 + rimM * 0.8 + haloM * 0.35) * fog;

    float lineFade = smoothstep(6.0, 14.0, ROW / dXp);
    float gutterPx = min(fx, 1.0 - fx) * ROW / dXp;
    float line = clamp(1.6 - gutterPx, 0.0, 1.0) * lineFade * planted;
    float s = fract(lz * 1.4 - t * 0.7 + hash(vec2(ix, 3.0)) * 5.0);
    float streak = smoothstep(0.0, 0.03, s) * smoothstep(0.35, 0.03, s);
    float headZ = mix(log(CAM / dMax), log(CAM / 0.004), c);
    float connectLines = c * (step(lz, headZ) * 0.6 + exp(-abs(lz - headZ) * 5.0) * 2.6);
    col += mix(tint, vec3(0.85, 0.95, 1.0), 0.5) * line * (streak * (0.45 + u_hover * 1.8) * dawn + connectLines) * fog;

    float aisle = clamp(1.0 - abs(X) / dXp, 0.0, 1.0);
    float ps = fract(lz * 1.1 - t * 0.5);
    float pulse = smoothstep(0.0, 0.04, ps) * smoothstep(0.3, 0.04, ps);
    col += vec3(0.24, 0.86, 0.59) * aisle * (0.25 + pulse * 0.9 + c * 0.8) * dawn * fog;

    col += vec3(0.95, 0.92, 0.85) * exp(-abs(d - front) * 90.0) * 0.18 * sweeping;
  }

  float horizon = exp(-abs(d) * 260.0) * (0.25 + 0.75 * exp(-abs(xs) * 2.2));
  float vp = exp(-length(vec2(xs * 0.9, d * 3.0)) * 5.0);
  float glowK = (0.35 + 0.65 * dawn) * (1.0 + u_hover * 0.6 + c * 1.5);
  col += vec3(0.70, 0.86, 1.0) * horizon * 0.9 * glowK;
  col += mix(vec3(0.24, 0.86, 0.59), vec3(0.17, 0.50, 1.0), 0.55) * vp * 0.42 * glowK;

  col = 1.0 - exp(-col * 1.25);
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
