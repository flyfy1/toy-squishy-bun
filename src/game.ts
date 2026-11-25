// Squishy Bun: one glossy mochi on a pastel desk mat. Press to squeeze, two fingers to pinch,
// drag the edge to stretch. It slowly rises back; its face judges you; squeeze too hard and
// the filling pops out (design section 3).
import { setupCanvas, runLoop, haptic, clamp } from './engine/juice'
import { Body, N } from './body'
import { Shader, MOCHI, type Dent } from './shade'
import { drawFace, type FaceState } from './face'
import { sfx } from './sfx'

export type { FaceState }

export interface GameEvents {
  onFirst(): void
  onSqueeze(n: number): void
  onBurst(n: number): void
  onStretch(pct: number): void
  onFace(state: FaceState): void
}

export interface GameApi {
  dispose(): void
}

interface Ptr {
  id: number
  x: number
  y: number
  x0: number
  y0: number
  t: number
  mode: 'press' | 'grab'
  edge: boolean // started near the edge: may turn into a grab
  d: number // press depth 0..1
  dMax: number
  node: number
  stretch: number
}

interface Blob {
  node: number
  t: number
  r: number
  out: boolean
  tIn: number
}

const DENSE = 4 // outline samples per node segment
const ND = N * DENSE

export function startGame(canvas: HTMLCanvasElement, ev: GameEvents): GameApi {
  const q = new URLSearchParams(location.search)
  const freeze = q.get('freeze') === '1'
  const forcedFace = q.get('face') as FaceState | null
  const pose = q.get('pose')
  const poseT = parseFloat(q.get('t') || '0') || 0
  const statsOn = q.get('stats') === '1'

  const body = new Body()
  const shader = new Shader()
  const bg = document.createElement('canvas')
  const xs = new Float32Array(ND)
  const ys = new Float32Array(ND)
  const dents: (Dent & { v: number; target: number; id: number })[] = []
  const ptrs = new Map<number, Ptr>()
  const ghosts: Ptr[] = []
  let blob: Blob | null = null
  let R = 100
  let started = false
  let squeezes = 0
  let bursts = 0
  let hardT = 0 // seconds of sustained hard squeeze
  let E = 0
  let face: FaceState = 'calm'
  let faceT = 0 // time in the current face state
  let stareUntil = 0
  let idleT = 0
  let time = 0
  let hop = 0 // 0..1 jump animation after waking
  let breath = 0
  let lastShadeKey = ''
  let blink = 0
  let nextBlink = 2.5
  let look = { x: 0, y: 0 } // eye look offset target (-1..1)
  const eye = { x: 0, y: 0 }
  let prevComp = 0
  let hapticAcc = 0
  let workMs = 0
  let restCX = 0
  let restCY = 0
  let restH = 1
  const faceRest = { cx: 0, cy: 0, th: 0, s: 0 }

  const { stage, dispose: disposeCanvas } = setupCanvas(canvas, (s) => {
    // portrait phones are width-limited: a slightly bigger bun (the 1.6 R stretch still fits)
    R = Math.min(s.w * 0.3, s.h * 0.26)
    const cx = s.w / 2
    const cy = s.h * 0.52
    body.layout(cx, cy, R)
    shader.layout(cx, cy, R, body.floor)
    // rest centroid and the face anchor in polar coordinates of the rest silhouette
    let sx = 0,
      sy = 0,
      minY = Infinity,
      maxY = -Infinity
    for (let i = 0; i < N; i++) {
      sx += body.hx[i]
      sy += body.hy[i]
      minY = Math.min(minY, body.hy[i])
      maxY = Math.max(maxY, body.hy[i])
    }
    restH = maxY - minY
    restCX = sx / N
    restCY = sy / N - 0.1 * R
    buildOutline(body.hx, body.hy)
    shader.shade(xs, ys, ND, restCX, restCY, R, body.floor, [], MOCHI)
    faceRest.cx = cx
    faceRest.cy = cy + 0.16 * R
    faceRest.th = Math.atan2(faceRest.cy - restCY, faceRest.cx - restCX)
    faceRest.s = Math.hypot(faceRest.cx - restCX, faceRest.cy - restCY) / shader.radAt(faceRest.th)
    buildBg(s.w, s.h, s.dpr)
    lastShadeKey = ''
  })

  // ---------- background: a pastel desk mat ----------
  function buildBg(w: number, h: number, dpr: number) {
    bg.width = Math.round(w * dpr)
    bg.height = Math.round(h * dpr)
    const g = bg.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    const lin = g.createLinearGradient(0, 0, 0, h)
    lin.addColorStop(0, '#FDEBEE')
    lin.addColorStop(1, '#F7D2DA')
    g.fillStyle = lin
    g.fillRect(0, 0, w, h)
    // window light falling from the upper left
    const L = g.createRadialGradient(w * 0.22, h * 0.12, 0, w * 0.22, h * 0.12, Math.max(w, h) * 0.85)
    L.addColorStop(0, 'rgba(255,252,246,0.75)')
    L.addColorStop(0.45, 'rgba(255,248,240,0.22)')
    L.addColorStop(1, 'rgba(255,248,240,0)')
    g.fillStyle = L
    g.fillRect(0, 0, w, h)
    // afternoon window light falling across the mat from the upper left, four panes
    {
      const m = Math.min(w, h)
      const pw = 3.3 * R
      const ph = pw * 0.8
      g.save()
      g.filter = `blur(${Math.max(4, Math.round(m * 0.012))}px)`
      g.translate(body.cx - 0.35 * R, body.cy - 0.1 * R)
      g.transform(1, 0.3, 0.55, 1, 0, 0)
      g.translate(-pw * 0.62, -ph * 0.62)
      g.fillStyle = 'rgba(255,250,236,0.55)'
      const bar = pw * 0.05
      const cw = (pw - bar) / 2
      const chh = (ph - bar) / 2
      for (const [x, y] of [[0, 0], [cw + bar, 0], [0, chh + bar], [cw + bar, chh + bar]]) g.fillRect(x, y, cw, chh)
      g.restore()
    }
    // soft pool of light on the mat under the bun
    const cx = w / 2
    const fy = body.floor
    g.save()
    g.translate(cx, fy)
    g.scale(1, 0.42)
    const P = g.createRadialGradient(0, 0, 0, 0, 0, R * 2.6)
    P.addColorStop(0, 'rgba(255,250,248,0.55)')
    P.addColorStop(1, 'rgba(255,250,248,0)')
    g.fillStyle = P
    g.beginPath()
    g.arc(0, 0, R * 2.6, 0, Math.PI * 2)
    g.fill()
    g.restore()
    // cutting-mat dot grid, fading toward the edges
    const step = Math.max(18, Math.round(Math.min(w, h) / 22))
    const ox = (w % step) / 2
    const oy = (h % step) / 2
    for (let y = oy; y < h; y += step) {
      for (let x = ox; x < w; x += step) {
        const major = Math.round((x - ox) / step) % 5 === 0 && Math.round((y - oy) / step) % 5 === 0
        g.fillStyle = major ? 'rgba(200,110,134,0.34)' : 'rgba(200,110,134,0.2)'
        g.beginPath()
        g.arc(x, y, (major ? 1.7 : 1.2) * Math.max(1, 1.5 / dpr), 0, Math.PI * 2)
        g.fill()
      }
    }
    // vignette
    const V = g.createRadialGradient(w / 2, h * 0.5, Math.min(w, h) * 0.35, w / 2, h * 0.5, Math.hypot(w, h) * 0.62)
    V.addColorStop(0, 'rgba(214,120,146,0)')
    V.addColorStop(1, 'rgba(214,120,146,0.16)')
    g.fillStyle = V
    g.fillRect(0, 0, w, h)
  }

  // ---------- geometry helpers ----------
  function buildOutline(px: ArrayLike<number>, py: ArrayLike<number>) {
    for (let i = 0; i < N; i++) {
      const a = (i + N - 1) % N
      const b = (i + 1) % N
      const c = (i + 2) % N
      const c1x = px[i] + (px[b] - px[a]) / 6
      const c1y = py[i] + (py[b] - py[a]) / 6
      const c2x = px[b] - (px[c] - px[i]) / 6
      const c2y = py[b] - (py[c] - py[i]) / 6
      for (let k = 0; k < DENSE; k++) {
        const t = k / DENSE
        const u = 1 - t
        const o = i * DENSE + k
        xs[o] = u * u * u * px[i] + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * px[b]
        ys[o] = u * u * u * py[i] + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * py[b]
      }
    }
  }

  function bodyPath(ctx: CanvasRenderingContext2D) {
    const { px, py } = body
    ctx.beginPath()
    ctx.moveTo(px[0], py[0])
    for (let i = 0; i < N; i++) {
      const a = (i + N - 1) % N
      const b = (i + 1) % N
      const c = (i + 2) % N
      ctx.bezierCurveTo(px[i] + (px[b] - px[a]) / 6, py[i] + (py[b] - py[a]) / 6, px[b] - (px[c] - px[i]) / 6, py[b] - (py[c] - py[i]) / 6, px[b], py[b])
    }
    ctx.closePath()
  }

  function inside(x: number, y: number): boolean {
    let c = false
    for (let i = 0, j = ND - 1; i < ND; j = i++) {
      if (ys[i] > y !== ys[j] > y && x < ((xs[j] - xs[i]) * (y - ys[i])) / (ys[j] - ys[i]) + xs[i]) c = !c
    }
    return c
  }

  function nearestNode(x: number, y: number): { i: number; d: number } {
    let best = 0
    let bd = Infinity
    for (let i = 0; i < N; i++) {
      const d = Math.hypot(body.px[i] - x, body.py[i] - y)
      if (d < bd) {
        bd = d
        best = i
      }
    }
    return { i: best, d: bd }
  }

  function edgeDist(x: number, y: number): number {
    let bd = Infinity
    for (let i = 0; i < ND; i++) bd = Math.min(bd, (xs[i] - x) ** 2 + (ys[i] - y) ** 2)
    return Math.sqrt(bd)
  }

  function centroid(): [number, number] {
    let sx = 0,
      sy = 0
    for (let i = 0; i < N; i++) {
      sx += body.px[i]
      sy += body.py[i]
    }
    return [sx / N, sy / N]
  }

  // ---------- input ----------
  function down(id: number, x: number, y: number) {
    sfx.unlock()
    if (!started) {
      started = true
      ev.onFirst()
    }
    const ins = inside(x, y)
    const ed = edgeDist(x, y)
    if (!ins && ed > 0.4 * R) return
    if (face === 'doze') wake()
    idleT = 0
    const nn = nearestNode(x, y)
    const p: Ptr = { id, x, y, x0: x, y0: y, t: 0, mode: ins ? 'press' : 'grab', edge: ins && ed < 0.2 * R, d: 0, dMax: 0, node: nn.i, stretch: 0 }
    if (p.mode === 'grab') sfx.grab()
    ptrs.set(id, p)
    if (p.mode === 'press') dents.push({ id, x, y, depth: 0, v: 0, target: 0 })
  }

  function move(id: number, x: number, y: number) {
    const p = ptrs.get(id)
    if (!p) {
      // hover: the eyes follow the cursor
      look = { x: clamp((x - body.cx) / (2.5 * R), -1, 1), y: clamp((y - body.cy) / (2.5 * R), -1, 1) }
      return
    }
    p.x = x
    p.y = y
    look = { x: clamp((x - body.cx) / (2.5 * R), -1, 1), y: clamp((y - body.cy) / (2.5 * R), -1, 1) }
    // a press that starts near the edge and is dragged outward becomes a stretch
    if (p.mode === 'press' && p.edge && p.d < 0.6) {
      const [cx, cy] = centroid()
      const out = (x - p.x0) * (p.x0 - cx) + (y - p.y0) * (p.y0 - cy)
      const dist = Math.hypot(x - p.x0, y - p.y0)
      if (out > 0 && dist > 0.12 * R) {
        p.mode = 'grab'
        p.node = nearestNode(p.x0, p.y0).i
        const dd = dents.find((d) => d.id === id)
        if (dd) dd.target = 0
        sfx.grab()
      }
    }
  }

  function up(id: number) {
    const p = ptrs.get(id)
    if (!p) return
    ptrs.delete(id)
    const dd = dents.find((d) => d.id === id)
    if (dd) {
      dd.target = 0
      dd.id = -1
    }
    // slow rise: a released press keeps holding the shape and lets go like memory foam
    if (p.mode === 'press' && p.d > 0.05) ghosts.push({ ...p, id: -1 })
    const counted = (p.mode === 'press' && p.dMax > 0.15) || (p.mode === 'grab' && p.stretch > 1.12)
    if (counted) {
      squeezes++
      ev.onSqueeze(squeezes)
    }
    if (p.mode === 'grab' && p.stretch > 1.12) {
      ev.onStretch(Math.round(p.stretch * 100))
      sfx.snap(clamp((p.stretch - 1) / 0.6, 0, 1))
      haptic(12)
    } else if (p.mode === 'press' && p.dMax > 0.1) sfx.release(p.dMax)
    if (ptrs.size === 0 && (p.dMax > 0.3 || p.stretch > 1.2) && !blob) stareUntil = time + 0.4 + Math.min(0.5, p.dMax * 0.2)
    idleT = 0
  }

  function wake() {
    hop = 1e-6
    face = 'surprised'
    faceT = 0
    ev.onFace(face)
    sfx.boing()
    haptic(10)
  }

  const onDown = (e: PointerEvent) => {
    e.preventDefault()
    canvas.setPointerCapture?.(e.pointerId)
    down(e.pointerId, e.clientX, e.clientY)
  }
  const onMove = (e: PointerEvent) => move(e.pointerId, e.clientX, e.clientY)
  const onUp = (e: PointerEvent) => up(e.pointerId)
  const onLeave = (e: PointerEvent) => {
    if (!ptrs.has(e.pointerId)) look = { x: 0, y: 0 }
  }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)
  canvas.addEventListener('pointerleave', onLeave)

  // ---------- simulation ----------
  function update(dt: number) {
    time += dt
    idleT += dt
    const { hx, hy, tx, ty, tk } = body
    const floor = body.floor
    // press depth: a tap is a poke, holding sinks in further
    let presses: Ptr[] = []
    let grab: Ptr | null = null
    for (const p of ptrs.values()) {
      p.t += dt
      if (p.mode === 'press') {
        p.d += (1 - p.d) * (1 - Math.exp(-dt / 0.42))
        p.dMax = Math.max(p.dMax, p.d)
        presses.push(p)
      } else if (!grab) grab = p
    }
    for (let i = ghosts.length - 1; i >= 0; i--) {
      ghosts[i].d *= Math.exp(-dt / 0.62)
      if (ghosts[i].d < 0.01) ghosts.splice(i, 1)
    }
    // real fingers first; a released press only shapes the bun while nothing else does
    if (presses.length === 0 && !grab && ghosts.length) presses.push(ghosts[ghosts.length - 1])
    else ghosts.length = 0
    presses = presses.slice(0, 2)
    // dents follow their finger, then rise slowly once it lifts (memory foam)
    for (let i = dents.length - 1; i >= 0; i--) {
      const d = dents[i]
      const p = d.id >= 0 ? ptrs.get(d.id) : undefined
      if (p && p.mode === 'press') {
        d.x += (p.x - d.x) * Math.min(1, dt * 30)
        d.y += (p.y - d.y) * Math.min(1, dt * 30)
        d.target = p.d
      }
      const rising = d.target < d.depth
      // fast in, slow out
      const k = rising ? 9 : 160
      const c = rising ? 2 * Math.sqrt(k) * 1.05 : 2 * Math.sqrt(k) * 0.8
      d.v += (k * (d.target - d.depth) - c * d.v) * dt
      d.depth = Math.max(0, d.depth + d.v * dt)
      if (d.id < 0 && d.depth < 0.003 && Math.abs(d.v) < 0.01) dents.splice(i, 1)
    }

    // targets: rest shape, squashed / pinched / stretched by the fingers
    const kS = body.kShape
    for (let i = 0; i < N; i++) {
      tx[i] = hx[i]
      ty[i] = hy[i]
      tk[i] = kS
      body.stick[i] = hy[i] > floor - 0.02 * R ? 1 : 0
    }
    let comp = 0
    let areaTarget = 1
    if (presses.length === 1) {
      const p = presses[0]
      const s = p.d * 0.34
      comp = s
      const xf = body.cx + (p.x - body.cx) * 0.35
      const topY = body.cy - 0.9 * R
      const near = 0.55 + 0.45 * clamp(1 - (p.y - topY) / (1.2 * R), 0, 1)
      for (let i = 0; i < N; i++) {
        const gx = (hx[i] - p.x) / (0.9 * R)
        const w = Math.exp(-gx * gx)
        const si = s * (0.62 + 0.38 * w)
        tx[i] = xf + (hx[i] - xf) * (1 + si * 0.62)
        ty[i] = floor - (floor - hy[i]) * (1 - si)
        const upper = clamp((body.cy - hy[i]) / (0.55 * R), 0, 1)
        const gd = (hx[i] - p.x) / (0.36 * R)
        ty[i] += p.d * 0.2 * R * Math.exp(-gd * gd) * upper * near
        tk[i] = kS + 170 * Math.min(1, p.d * 4)
      }
    } else if (presses.length === 2) {
      const [a, b] = presses
      let ux = b.x - a.x
      let uy = b.y - a.y
      const l = Math.hypot(ux, uy) || 1
      ux /= l
      uy /= l
      const vx = -uy
      const vy = ux
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      const dd = (a.d + b.d) / 2
      const s0 = dd * 0.24 * clamp(l / (0.4 * R), 0.4, 1)
      comp = s0
      for (let i = 0; i < N; i++) {
        const rx = hx[i] - mx
        const ry = hy[i] - my
        const au = rx * ux + ry * uy
        const av = rx * vx + ry * vy
        // the base stays on the table; the squeeze acts on the body above it
        const lift = clamp((floor - hy[i]) / (0.45 * R), 0.25, 1)
        const s = s0 * lift
        tx[i] = mx + ux * au * (1 - s) + vx * av * (1 + s * 0.7)
        ty[i] = my + uy * au * (1 - s) + vy * av * (1 + s * 0.7)
        // vertical growth is anchored on the table, not on the fingers: it rises, it does not sink
        ty[i] -= Math.max(0, floor - my) * vy * vy * s * 0.7 * 0.5
        tk[i] = kS + 170 * Math.min(1, dd * 4)
      }
    }
    if (grab) {
      const g = grab
      // the grabbed node follows the finger, limited to 1.6 R from the centre with a rubbery give
      const hxg = hx[g.node]
      const hyg = hy[g.node]
      let dx = g.x - g.x0
      let dy = g.y - g.y0
      const ox = hxg - body.cx
      const oy = hyg - (body.cy - 0.05 * R)
      let qx = ox + dx
      let qy = oy + dy
      let r = Math.hypot(qx, qy)
      const r0 = 1.25 * R
      const rmax = 1.6 * R
      if (r > r0) {
        const rr = r0 + (rmax - r0) * (1 - Math.exp(-(r - r0) / (rmax - r0)))
        qx *= rr / r
        qy *= rr / r
        r = rr
      }
      // nothing goes through the table
      const fy = floor - (body.cy - 0.05 * R)
      if (qy > fy) qy = fy
      dx = qx - ox
      dy = qy - oy
      g.stretch = r / Math.hypot(ox, oy)
      for (let i = 0; i < N; i++) {
        let k = Math.abs(i - g.node)
        k = Math.min(k, N - k)
        const w = Math.exp(-((k / 3.2) ** 2))
        // nodes resting on the table stay planted unless they are the ones being pulled
        const planted = hy[i] > floor - 0.02 * R ? 1 - w : 0
        body.stick[i] = planted
        tx[i] += dx * (w * 0.98 + 0.03)
        ty[i] += dy * w * 0.98 * (1 - planted)
        tk[i] = Math.max(tk[i], kS + 300 * w)
      }
      comp = Math.max(comp, (g.stretch - 1) * 0.5)
      areaTarget = 1 + 0.55 * Math.max(0, g.stretch - 1)
    } else areaTarget = 1
    // the extra area of a stretched lobe is given back gradually, or the release would suck the sides in
    body.areaScale += (areaTarget - body.areaScale) * Math.min(1, dt * (areaTarget > body.areaScale ? 20 : 2.5))

    body.step(dt)
    // safety net: a few seconds after release the shape must be home, folds included
    if (ptrs.size === 0 && idleT > 2.2) body.settle(1 - Math.exp(-dt * 2.5))

    // deformation energy → face state
    const disp = body.rmsDisp()
    let press = 0
    for (const p of presses) if (p.id >= 0) press = Math.max(press, p.d)
    const eTarget = clamp(Math.max(disp / 0.26, press * 0.92 * (presses.length > 1 ? 1.08 : 1), grab ? (grab.stretch - 1) / 0.75 : 0), 0, 1)
    E += (eTarget - E) * Math.min(1, dt * 10)
    if (E > 0.7 && ptrs.size > 0) hardT += dt
    else hardT = Math.max(0, hardT - dt * 2)
    if (hardT > 1.2 && !blob) burst()

    // audio + haptics follow the compression rate
    const rate = (comp - prevComp) / Math.max(dt, 1e-3)
    prevComp = comp
    sfx.creak(Math.max(0, rate), comp)
    hapticAcc += Math.abs(rate) * dt
    if (hapticAcc > 0.06) {
      hapticAcc = 0
      haptic(6)
    }

    // the custard blob
    if (blob) {
      blob.t += dt
      if (blob.out && ptrs.size === 0) {
        blob.out = false
        blob.tIn = 0
        sfx.slurp()
      }
      if (!blob.out) {
        blob.tIn += dt
        if (blob.tIn > 0.9) blob = null
      }
    }

    // face
    faceT += dt
    let next: FaceState = face
    if (forcedFace) next = forcedFace
    else if (blob) next = 'burst'
    else if (face === 'surprised' && faceT < 0.7) next = 'surprised'
    else if (ptrs.size > 0) next = E > 0.5 ? 'dizzy' : E > 0.25 ? 'wince' : face === 'doze' ? 'doze' : 'calm'
    else if (time < stareUntil) next = 'stare'
    else if (idleT > 10) next = 'doze'
    else next = 'calm'
    if (next !== face) {
      face = next
      faceT = 0
      ev.onFace(face)
    }
    // blinks
    if (face === 'calm' && !freeze) {
      nextBlink -= dt
      if (nextBlink < 0) {
        blink = 0.16
        nextBlink = 2.5 + Math.random() * 3.5
      }
    }
    blink = Math.max(0, blink - dt)
    eye.x += (look.x - eye.x) * Math.min(1, dt * 8)
    eye.y += (look.y - eye.y) * Math.min(1, dt * 8)
    if (hop > 0) {
      hop += dt / 0.55
      if (hop >= 1) hop = 0
    }
    breath += dt * ((Math.PI * 2) / (face === 'doze' ? 4.6 : 3.6))
  }

  function burst() {
    // the filling oozes out of the shoulder away from the finger, where you can see it
    let fx = body.cx
    for (const p of ptrs.values()) fx = p.x
    const target = fx <= body.cx ? -0.09 : -0.41 // angle in turns: upper-right or upper-left shoulder
    let best = 0
    let bv = Infinity
    for (let i = 0; i < N; i++) {
      const a = Math.atan2(body.hy[i] - body.cy, body.hx[i] - body.cx) / (Math.PI * 2)
      let e = Math.abs(a - target)
      e = Math.min(e, 1 - e)
      if (e < bv) {
        bv = e
        best = i
      }
    }
    blob = { node: best, t: 0, r: 0, out: true, tIn: 0 }
    bursts++
    hardT = 0
    ev.onBurst(bursts)
    sfx.burst()
    haptic(25)
  }

  // ---------- render ----------
  function render() {
    const t0 = performance.now()
    const { ctx, w, h, dpr } = stage
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.drawImage(bg, 0, 0, w, h)

    buildOutline(body.px, body.py)
    let [cx, cy] = centroid()
    let minY = Infinity,
      maxY = -Infinity,
      minX = Infinity,
      maxX = -Infinity
    for (let i = 0; i < ND; i++) {
      minY = Math.min(minY, ys[i])
      maxY = Math.max(maxY, ys[i])
      minX = Math.min(minX, xs[i])
      maxX = Math.max(maxX, xs[i])
    }
    const hNow = maxY - minY
    cy -= 0.1 * R * (hNow / restH)

    // reshade only when the skin or a dent moved
    let key = ''
    for (let i = 0; i < N; i += 3) key += ((body.px[i] * 4) | 0) + ',' + ((body.py[i] * 4) | 0) + ';'
    for (const d of dents) key += `${(d.x * 2) | 0},${(d.y * 2) | 0},${(d.depth * 300) | 0};`
    if (key !== lastShadeKey) {
      shader.shade(xs, ys, ND, cx, cy, R, body.floor, dents, MOCHI)
      lastShadeKey = key
    }

    // breathing and the wake-up hop are a transform about the base, so they cost no reshade
    const b = Math.sin(breath) * (face === 'doze' ? 0.016 : 0.009)
    let hopY = 0,
      hsx = 1,
      hsy = 1
    if (hop > 0) {
      const t = hop
      hopY = -Math.sin(Math.min(1, t / 0.7) * Math.PI) * 0.16 * R
      const st = t < 0.12 ? -t / 0.12 : t < 0.7 ? Math.sin(((t - 0.12) / 0.58) * Math.PI) * 0.6 : -Math.sin(((t - 0.7) / 0.3) * Math.PI) * 0.7
      hsy = 1 + st * 0.07
      hsx = 1 - st * 0.05
    }
    const fx = (minX + maxX) / 2
    const fy = body.floor

    drawShadows(ctx, minX, maxX, hopY)

    ctx.save()
    ctx.translate(fx, fy + hopY)
    ctx.scale(hsx * (1 - b * 0.4), hsy * (1 + b))
    ctx.translate(-fx, -fy)

    // the filling comes out from behind the skin edge, so the skin overlaps its base softly
    if (blob) drawBlob(ctx, 'behind')

    // a faint occlusion halo round the silhouette, so the lit side still separates from the sunlit mat
    bodyPath(ctx)
    ctx.lineJoin = 'round'
    for (const [wd, a] of [[0.07, 0.018], [0.04, 0.024], [0.02, 0.03]] as const) {
      ctx.lineWidth = wd * R
      ctx.strokeStyle = `rgba(168,92,96,${a})`
      ctx.stroke()
    }

    // body
    ctx.save()
    bodyPath(ctx)
    ctx.clip()
    shader.draw(ctx)
    drawGloss(ctx)
    // fingertip dents: a soft dark core so the press reads even under a thumb
    for (const d of dents) {
      if (d.depth < 0.02) continue
      const rr = 0.2 * R
      const g = ctx.createRadialGradient(d.x + 0.02 * R, d.y + 0.03 * R, 0, d.x, d.y, rr)
      g.addColorStop(0, `rgba(196,96,100,${0.1 * d.depth * clamp((body.floor - d.y) / R - 0.5, 0, 1)})`)
      g.addColorStop(1, 'rgba(196,96,100,0)')
      ctx.fillStyle = g
      ctx.fillRect(d.x - rr, d.y - rr, rr * 2, rr * 2)
    }
    // face, attached to the skin
    const faceInfo = faceFrame(cx, cy)
    drawFace(ctx, face, faceT, {
      ...faceInfo,
      R,
      blink: blink > 0 ? 1 - Math.abs(blink - 0.08) / 0.08 : 0,
      lookX: eye.x,
      lookY: eye.y,
      E,
      time,
    })
    ctx.restore()

    if (blob) drawBlob(ctx, 'front')
    ctx.restore()

    if (statsOn) {
      ctx.fillStyle = 'rgba(80,40,50,0.7)'
      ctx.font = '12px ui-monospace, monospace'
      ctx.fillText(`E ${E.toFixed(2)} hard ${hardT.toFixed(2)} work ${workMs.toFixed(2)}ms face ${face}`, 12, 20)
    }
    workMs = workMs * 0.9 + (performance.now() - t0) * 0.1
  }

  /** Face anchor: rest polar position mapped onto the current silhouette, plus the local stretch. */
  function faceFrame(cx: number, cy: number) {
    const rr = shader.radAt(faceRest.th)
    let x = cx + Math.cos(faceRest.th) * faceRest.s * rr
    let y = cy + Math.sin(faceRest.th) * faceRest.s * rr
    // affine fit of the current shape to the rest shape gives the local squash and shear
    let hcx = 0,
      hcy = 0,
      pcx = 0,
      pcy = 0
    for (let i = 0; i < N; i++) {
      hcx += body.hx[i]
      hcy += body.hy[i]
      pcx += body.px[i]
      pcy += body.py[i]
    }
    hcx /= N
    hcy /= N
    pcx /= N
    pcy /= N
    let a = 0,
      bb = 0,
      c = 0,
      q11 = 0,
      q12 = 0,
      q21 = 0,
      q22 = 0
    for (let i = 0; i < N; i++) {
      const hx = body.hx[i] - hcx
      const hy = body.hy[i] - hcy
      const px = body.px[i] - pcx
      const py = body.py[i] - pcy
      a += hx * hx
      bb += hx * hy
      c += hy * hy
      q11 += px * hx
      q12 += px * hy
      q21 += py * hx
      q22 += py * hy
    }
    const det = a * c - bb * bb || 1
    const i11 = c / det,
      i12 = -bb / det,
      i22 = a / det
    let m11 = q11 * i11 + q12 * i12
    let m12 = q11 * i12 + q12 * i22
    let m21 = q21 * i11 + q22 * i12
    let m22 = q21 * i12 + q22 * i22
    // features stretch less than the whole body (they are small and near the middle)
    m11 = 1 + (m11 - 1) * 0.8
    m22 = 1 + (m22 - 1) * 0.8
    m12 *= 0.6
    m21 *= 0.6
    // a finger pressing near the face pushes the features away from it
    for (const d of dents) {
      const ex = x - d.x
      const ey = y - d.y
      const e = Math.hypot(ex, ey) || 1
      const f = d.depth * 0.05 * R * Math.exp(-(e * e) / (2 * (0.3 * R) ** 2))
      x += (ex / e) * f
      y += (ey / e) * f
    }
    return { x, y, m11, m12, m21, m22 }
  }

  /** Crisp window reflection on top of the shaded gloss, at the brightest specular point. */
  const gl = { x: 0, y: 0, init: false }
  function drawGloss(ctx: CanvasRenderingContext2D) {
    if (!gl.init) {
      gl.x = shader.specX
      gl.y = shader.specY
      gl.init = true
    }
    gl.x += (shader.specX - gl.x) * 0.5
    gl.y += (shader.specY - gl.y) * 0.5
    ctx.save()
    ctx.translate(gl.x - 0.01 * R, gl.y - 0.005 * R)
    ctx.rotate(-0.55)
    ctx.scale(1, 0.5)
    const r = 0.11 * R
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
    g.addColorStop(0, 'rgba(255,255,255,0.9)')
    g.addColorStop(0.55, 'rgba(255,255,255,0.7)')
    g.addColorStop(0.8, 'rgba(255,255,255,0.18)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    // the small second window
    const dx = gl.x + 0.13 * R
    const dy = gl.y + 0.05 * R
    const g2 = ctx.createRadialGradient(dx, dy, 0, dx, dy, 0.03 * R)
    g2.addColorStop(0, 'rgba(255,255,255,0.85)')
    g2.addColorStop(0.6, 'rgba(255,255,255,0.5)')
    g2.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g2
    ctx.beginPath()
    ctx.arc(dx, dy, 0.03 * R, 0, Math.PI * 2)
    ctx.fill()
  }

  function drawShadows(ctx: CanvasRenderingContext2D, minX: number, maxX: number, hopY: number) {
    const fy = body.floor
    // base width: nodes that sit on the table
    let bl = Infinity,
      br = -Infinity
    for (let i = 0; i < ND; i++) {
      if (ys[i] > fy - 0.06 * R) {
        bl = Math.min(bl, xs[i])
        br = Math.max(br, xs[i])
      }
    }
    if (!Number.isFinite(bl)) {
      bl = minX + 0.3 * R
      br = maxX - 0.3 * R
    }
    const lift = clamp(-hopY / (0.16 * R), 0, 1)
    const half = (maxX - minX) / 2
    const mid = (minX + maxX) / 2
    const ell = (x: number, y: number, rx: number, ry: number, col: string, a: number, inner = 0) => {
      ctx.save()
      ctx.translate(x, y)
      ctx.scale(1, ry / rx)
      const g = ctx.createRadialGradient(0, 0, rx * inner, 0, 0, rx)
      g.addColorStop(0, `rgba(${col},${a})`)
      g.addColorStop(0.55, `rgba(${col},${a * 0.45})`)
      g.addColorStop(1, `rgba(${col},0)`)
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(0, 0, rx, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    // cast shadow, offset away from the light (upper left)
    ell(mid + 0.2 * R, fy + 0.04 * R, half * 1.12 + 0.1 * R, 0.22 * R, '170,78,104', 0.2 * (1 - lift * 0.5))
    // ambient occlusion under the whole body
    ell(mid + 0.04 * R, fy + 0.01 * R, half * 1.02, 0.11 * R, '160,72,88', 0.26 * (1 - lift * 0.7))
    // contact core where skin meets the mat
    const bm = (bl + br) / 2
    const bh = Math.max(0.2 * R, (br - bl) / 2)
    ell(bm + 0.03 * R, fy + 0.004 * R, bh * 1.08, 0.04 * R, '134,56,66', 0.42 * (1 - lift))
  }

  function drawBlob(ctx: CanvasRenderingContext2D, layer: 'behind' | 'front') {
    const bl = blob!
    const i = bl.node
    const nrm = (k: number) => {
      const a = (k + N - 1) % N
      const b = (k + 1) % N
      const nx = body.py[b] - body.py[a]
      const ny = -(body.px[b] - body.px[a])
      const l = Math.hypot(nx, ny) || 1
      return [nx / l, ny / l]
    }
    const [nx, ny] = nrm(i)
    let grow: number
    if (bl.out) {
      const t = Math.min(1, bl.t / 0.5)
      grow = 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2) // outBack
      grow *= 1 + 0.06 * Math.sin(bl.t * 19) * Math.exp(-bl.t * 3)
    } else {
      const t = Math.min(1, bl.tIn / 0.9)
      grow = (1 - t * t) * (1 + 0.08 * Math.sin(t * 20))
    }
    grow = Math.max(0, grow)
    const r = 0.27 * R * grow
    if (r < 0.5) return
    // the split in the skin: two points either side of the node
    const cx = body.px[i] + nx * r * 0.45
    const cy = body.py[i] + ny * r * 0.45
    const custard = (path: () => void) => {
      const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.45, r * 0.05, cx, cy, r * 1.25)
      g.addColorStop(0, '#FFF3B8')
      g.addColorStop(0.35, '#FFD963')
      g.addColorStop(0.85, '#F2B23C')
      g.addColorStop(1, '#E39C2E')
      ctx.fillStyle = g
      path()
      ctx.fill()
    }
    if (layer === 'behind') {
      custard(() => {
        ctx.beginPath()
        const M = 28
        for (let k = 0; k <= M; k++) {
          const th = (k / M) * Math.PI * 2
          const wob = 1 + 0.05 * Math.sin(th * 3 + bl.t * 7) + 0.03 * Math.sin(th * 5 - bl.t * 11)
          const x = cx + Math.cos(th) * r * wob
          const y = cy + Math.sin(th) * r * wob
          if (k) ctx.lineTo(x, y)
          else ctx.moveTo(x, y)
        }
        ctx.closePath()
      })
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      ctx.beginPath()
      ctx.ellipse(cx + nx * r * 0.3 - r * 0.22, cy + ny * r * 0.3 - r * 0.28, r * 0.2, r * 0.1, -0.6, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.beginPath()
      ctx.arc(cx + nx * r * 0.3 + r * 0.1, cy + ny * r * 0.3 - r * 0.42, r * 0.045, 0, Math.PI * 2)
      ctx.fill()
      return
    }
    ctx.save()
    // a smear of filling on the skin round the split
    ctx.save()
    bodyPath(ctx)
    ctx.clip()
    const sm = ctx.createRadialGradient(body.px[i], body.py[i], 0, body.px[i], body.py[i], r * 0.9)
    sm.addColorStop(0, 'rgba(250,196,80,0.75)')
    sm.addColorStop(0.5, 'rgba(250,196,80,0.3)')
    sm.addColorStop(1, 'rgba(250,196,80,0)')
    ctx.fillStyle = sm
    ctx.fillRect(body.px[i] - r, body.py[i] - r, r * 2, r * 2)
    ctx.restore()
    // a drip running down the outside of the bun along its contour
    const dripLen = bl.out ? Math.min(1, Math.max(0, (bl.t - 0.25) / 1.3)) : Math.max(0, 1 - bl.tIn / 0.35)
    if (dripLen > 0.02) {
      const side = nx >= 0 ? 1 : -1
      const steps = 1 + dripLen * 4.5
      const pts: [number, number][] = []
      for (let k = 0; k <= 12; k++) {
        const f = 1.2 + (k / 12) * (steps - 1)
        const j0 = Math.floor(f)
        const ff = f - j0
        const j1 = (i + side * j0 + N * 4) % N
        const j2 = (i + side * (j0 + 1) + N * 4) % N
        const [n1x, n1y] = nrm(j1)
        const x = body.px[j1] + (body.px[j2] - body.px[j1]) * ff + n1x * 0.045 * R
        const y = body.py[j1] + (body.py[j2] - body.py[j1]) * ff + n1y * 0.045 * R
        pts.push([x, y])
      }
      const [ex, ey] = pts[pts.length - 1]
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = '#EFB13E'
      ctx.lineWidth = 0.05 * R * Math.max(0.4, grow)
      ctx.beginPath()
      pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.stroke()
      ctx.fillStyle = '#EFB13E'
      ctx.beginPath()
      ctx.arc(ex, ey + 0.012 * R, 0.062 * R * (0.5 + 0.5 * dripLen), 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,246,200,0.9)'
      ctx.beginPath()
      ctx.arc(ex - 0.022 * R, ey - 0.006 * R, 0.016 * R, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  // ---------- harness (deterministic poses for stills) ----------
  const api = {
    ready: false,
    get R() {
      return R
    },
    get cx() {
      return body.cx
    },
    get cy() {
      return body.cy
    },
    get floor() {
      return body.floor
    },
    get E() {
      return E
    },
    get face() {
      return face
    },
    get debug() {
      return { ptrs: ptrs.size, disp: body.rmsDisp(), dents: dents.length, blob: !!blob }
    },
    get workMs() {
      return workMs
    },
    advance(dt: number) {
      const steps = Math.ceil(dt / (1 / 60))
      for (let i = 0; i < steps; i++) update(dt / steps)
      render()
    },
    down,
    move,
    up,
  }
  ;(window as unknown as { __bun: typeof api }).__bun = api

  if (pose) {
    const P = (fx: number, fy: number) => [body.cx + fx * R, body.cy + fy * R] as const
    const run = (sec: number) => {
      const steps = Math.round(sec * 60)
      for (let i = 0; i < steps; i++) update(1 / 60)
    }
    if (pose === 'press' || pose === 'max' || pose === 'rise') {
      const [x, y] = P(0.08, -0.25)
      down(1, x, y)
      run(pose === 'press' ? poseT || 0.3 : pose === 'max' ? poseT || 1.0 : 1.0)
      if (pose === 'rise') {
        up(1)
        run(poseT || 0.5)
      }
    } else if (pose === 'pinch') {
      const [ax, ay] = P(-0.55, 0.05)
      const [bx, by] = P(0.55, 0.05)
      down(1, ax, ay)
      down(2, bx, by)
      run(poseT || 0.8)
    } else if (pose === 'stretch') {
      const [x, y] = P(1.05, -0.1)
      down(1, x, y)
      for (let i = 1; i <= 20; i++) {
        move(1, x + (i / 20) * 0.6 * R, y - (i / 20) * 0.15 * R)
        run(0.02)
      }
      run(poseT || 0.3)
    } else if (pose === 'burst') {
      const [x, y] = P(0.0, -0.2)
      down(1, x, y)
      run(poseT || 2.6)
    } else if (pose === 'doze') {
      run(poseT || 11)
    } else run(poseT || 0.5)
    render()
  }

  api.ready = true
  const stop = runLoop((dt) => {
    if (!freeze) update(dt)
    render()
  })

  return {
    dispose() {
      stop()
      disposeCanvas()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('pointerleave', onLeave)
      sfx.stop()
    },
  }
}
