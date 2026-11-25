// Soft body: a ring of nodes around a centre (design 3). Verlet with fixed substeps, edge and
// bending springs, an area (pressure) constraint, weak shape matching toward the rest shape
// (the slow rise), a table the nodes cannot pass through, and per-node press targets.

export const N = 40
const SUB = 1 / 240 // fixed substep

export class Body {
  px = new Float32Array(N)
  py = new Float32Array(N)
  ox = new Float32Array(N)
  oy = new Float32Array(N)
  /** rest (home) positions, absolute css px */
  hx = new Float32Array(N)
  hy = new Float32Array(N)
  /** per-frame targets and their stiffness (1/s^2) */
  tx = new Float32Array(N)
  ty = new Float32Array(N)
  tk = new Float32Array(N)
  /** 0..1 per node: how strongly it sticks to the table (set per frame) */
  stick = new Float32Array(N)
  len1 = new Float32Array(N)
  len2 = new Float32Array(N)
  area0 = 0
  /** area target multiplier (a stretched lobe adds area instead of starving the rest) */
  areaScale = 1
  cx = 0
  cy = 0
  R = 1
  floor = 0
  /** spring constants (design values are starting points; tuned by eye) */
  kEdge = 520
  kBend = 140
  kShape = 14
  areaGain = 0.22
  damp = 0.9 // per frame at 60 fps
  private acc = 0

  layout(cx: number, cy: number, R: number) {
    const first = this.R === 1 && this.cx === 0
    const sx = cx - this.cx
    const sy = cy - this.cy
    const k = R / this.R
    this.cx = cx
    this.cy = cy
    this.R = R
    this.floor = cy + 0.62 * R
    restShape(cx, cy, R, this.floor, this.hx, this.hy)
    for (let i = 0; i < N; i++) {
      if (first) {
        this.px[i] = this.ox[i] = this.hx[i]
        this.py[i] = this.oy[i] = this.hy[i]
      } else {
        // keep the current deformation, rescaled to the new size
        const ex = (this.px[i] - (this.cx - sx)) * k + cx
        const ey = (this.py[i] - (this.cy - sy)) * k + cy
        this.px[i] = this.ox[i] = ex
        this.py[i] = this.oy[i] = ey
      }
      this.tx[i] = this.hx[i]
      this.ty[i] = this.hy[i]
      this.tk[i] = this.kShape
    }
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N
      const l = (i + 2) % N
      this.len1[i] = Math.hypot(this.hx[j] - this.hx[i], this.hy[j] - this.hy[i])
      this.len2[i] = Math.hypot(this.hx[l] - this.hx[i], this.hy[l] - this.hy[i])
    }
    this.area0 = area(this.hx, this.hy)
  }

  /** Advance by dt seconds in fixed substeps. */
  step(dt: number) {
    this.acc = Math.min(this.acc + dt, 0.05)
    while (this.acc >= SUB) {
      this.acc -= SUB
      this.sub()
    }
  }

  /** Untangle: pull every node straight toward its home (used only when nothing touches it and
   *  the ring has stayed deformed for too long, e.g. folded over itself after wild input). */
  settle(f: number) {
    for (let i = 0; i < N; i++) {
      const dx = (this.hx[i] - this.px[i]) * f
      const dy = (this.hy[i] - this.py[i]) * f
      this.px[i] += dx
      this.py[i] += dy
      this.ox[i] += dx
      this.oy[i] += dy
    }
  }

  /** Reset to the rest shape (NaN guard). */
  reset() {
    for (let i = 0; i < N; i++) {
      this.px[i] = this.ox[i] = this.hx[i]
      this.py[i] = this.oy[i] = this.hy[i]
    }
  }

  private ax = new Float32Array(N)
  private ay = new Float32Array(N)

  private sub() {
    const { px, py, ox, oy, ax, ay, tx, ty, tk } = this
    ax.fill(0)
    ay.fill(0)
    // target springs (shape matching toward rest, or toward the pressed shape)
    for (let i = 0; i < N; i++) {
      ax[i] += tk[i] * (tx[i] - px[i])
      if (this.stick[i] > 0) ay[i] += this.stick[i] * 400 * (this.floor - py[i])
      ay[i] += tk[i] * (ty[i] - py[i])
    }
    // edge and bending springs
    spring(px, py, ax, ay, this.len1, 1, this.kEdge)
    spring(px, py, ax, ay, this.len2, 2, this.kBend)
    // Verlet
    const d = Math.pow(this.damp, 60 * SUB)
    const dt2 = SUB * SUB
    const vmax = 0.12 * this.R
    for (let i = 0; i < N; i++) {
      let vx = (px[i] - ox[i]) * d
      let vy = (py[i] - oy[i]) * d
      const v = Math.hypot(vx, vy)
      if (v > vmax) {
        vx *= vmax / v
        vy *= vmax / v
      }
      ox[i] = px[i]
      oy[i] = py[i]
      px[i] += vx + ax[i] * dt2
      py[i] += vy + ay[i] * dt2
    }
    // area (pressure): move every node along its normal by the same amount
    const A = area(px, py)
    let per = 0
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N
      per += Math.hypot(px[j] - px[i], py[j] - py[i])
    }
    const delta = (this.areaGain * (this.area0 * this.areaScale - A)) / Math.max(1, per)
    for (let i = 0; i < N; i++) {
      const a = (i + N - 1) % N
      const b = (i + 1) % N
      // ring runs clockwise on screen (y down): outward normal of (dx, dy) is (dy, -dx)
      let nx = py[b] - py[a]
      let ny = -(px[b] - px[a])
      const l = Math.hypot(nx, ny) || 1
      nx /= l
      ny /= l
      px[i] += nx * delta
      py[i] += ny * delta
    }
    // the table: nodes cannot sink into it, and slide on it with friction
    const fl = this.floor
    for (let i = 0; i < N; i++) {
      if (py[i] > fl) {
        py[i] = fl
        oy[i] = Math.max(oy[i], fl)
        ox[i] = px[i] - (px[i] - ox[i]) * 0.9
      }
    }
    // NaN guard
    if (!Number.isFinite(px[0] + py[N >> 1])) this.reset()
  }

  /** RMS displacement from the rest shape, in units of R. */
  rmsDisp(): number {
    let s = 0
    for (let i = 0; i < N; i++) {
      const dx = this.px[i] - this.hx[i]
      const dy = this.py[i] - this.hy[i]
      s += dx * dx + dy * dy
    }
    return Math.sqrt(s / N) / this.R
  }

  /** Mean speed of the nodes, css px per substep (rest detection). */
  motion(): number {
    let s = 0
    for (let i = 0; i < N; i++) s += Math.abs(this.px[i] - this.ox[i]) + Math.abs(this.py[i] - this.oy[i])
    return s / N
  }
}

function spring(px: Float32Array, py: Float32Array, ax: Float32Array, ay: Float32Array, rest: Float32Array, off: number, k: number) {
  for (let i = 0; i < N; i++) {
    const j = (i + off) % N
    const dx = px[j] - px[i]
    const dy = py[j] - py[i]
    const l = Math.hypot(dx, dy) || 1e-6
    const f = (k * (l - rest[i])) / l
    ax[i] += f * dx
    ay[i] += f * dy
    ax[j] -= f * dx
    ay[j] -= f * dy
  }
}

export function area(x: ArrayLike<number>, y: ArrayLike<number>): number {
  let a = 0
  const n = x.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    a += x[i] * y[j] - x[j] * y[i]
  }
  return a / 2
}

/** Rest silhouette of a mochi sitting on a table, seen from the front and a little above:
 *  a round dome on top (0.88 R), a fuller, flatter belly below that sits on the table.
 *  Sampled densely, then resampled to N nodes evenly spaced by arc length, starting at the top. */
function restShape(cx: number, cy: number, R: number, floor: number, outX: Float32Array, outY: Float32Array) {
  const M = 720
  const xs = new Float64Array(M + 1)
  const ys = new Float64Array(M + 1)
  for (let k = 0; k <= M; k++) {
    const th = -Math.PI / 2 + (2 * Math.PI * k) / M
    const c = Math.cos(th)
    const s = Math.sin(th)
    let x: number, y: number
    if (s < 0) {
      // dome: slightly squarer than a circle so the shoulders are full
      const p = 2.05
      x = R * Math.sign(c) * Math.pow(Math.abs(c), 2 / p)
      y = 0.84 * R * Math.sign(s) * Math.pow(Math.abs(s), 2 / p)
    } else {
      // belly: superellipse that bulges, then the table cuts it flat
      const p = 2.2
      x = R * Math.sign(c) * Math.pow(Math.abs(c), 2 / p)
      y = 0.74 * R * Math.pow(s, 2 / p)
    }
    xs[k] = cx + x
    ys[k] = Math.min(cy + y, floor)
  }
  const cum = new Float64Array(M + 1)
  for (let k = 1; k <= M; k++) cum[k] = cum[k - 1] + Math.hypot(xs[k] - xs[k - 1], ys[k] - ys[k - 1])
  const total = cum[M]
  let k = 0
  for (let i = 0; i < N; i++) {
    const target = (total * i) / N
    while (k < M - 1 && cum[k + 1] < target) k++
    const f = (target - cum[k]) / Math.max(1e-9, cum[k + 1] - cum[k])
    outX[i] = xs[k] + (xs[k + 1] - xs[k]) * f
    outY[i] = ys[k] + (ys[k + 1] - ys[k]) * f
  }
}
