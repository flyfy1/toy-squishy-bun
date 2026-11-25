// Per-pixel shading of the bun on a small CPU buffer, upscaled into the crisp silhouette clip.
// The silhouette alone cannot show depth, so every frame we build a height field from it
// (a soft dome in polar coordinates around the current centre, minus finger dents), take
// normals and light it: wrap diffuse with a warm subsurface ramp, Fresnel edge colour, a
// pink bounce from the mat, contact occlusion at the table and Blinn specular from a key
// light at the upper left plus a rim light at the right. The highlight therefore stretches,
// slides and breaks up exactly as the skin deforms.

export interface Skin {
  /** colour ramp from deep core shadow to lit, sRGB 0..255 */
  deep: [number, number, number]
  edge: [number, number, number]
  mid: [number, number, number]
  lit: [number, number, number]
  /** translucent edge colour (subsurface) and its strength */
  sss: [number, number, number]
  sssAmt: number
  gloss: number
  /** exponent of the dome profile: higher = flatter top, rounder shoulders */
  flat: number
}

export const MOCHI: Skin = {
  deep: [232, 158, 150],
  edge: [247, 194, 182],
  mid: [255, 228, 216],
  lit: [255, 249, 242],
  sss: [255, 152, 134],
  sssAmt: 0.36,
  gloss: 1,
  flat: 2.3,
}

export const BAOZI: Skin = { deep: [206, 180, 152], edge: [232, 214, 190], mid: [249, 240, 226], lit: [255, 252, 246], sss: [240, 206, 168], sssAmt: 0.25, gloss: 0.5, flat: 2.05 }
export const TANGYUAN: Skin = { deep: [200, 192, 204], edge: [226, 222, 230], mid: [246, 244, 247], lit: [255, 255, 255], sss: [238, 226, 240], sssAmt: 0.3, gloss: 1.1, flat: 2.2 }
export const PAW: Skin = { deep: [226, 184, 178], edge: [244, 216, 208], mid: [255, 241, 234], lit: [255, 252, 248], sss: [255, 196, 186], sssAmt: 0.3, gloss: 0.9, flat: 2.3 }

export interface Dent {
  x: number
  y: number
  depth: number // 0..1
}

const NB = 512 // angular bins of the silhouette radius table
const TAU = Math.PI * 2

export class Shader {
  canvas = document.createElement('canvas')
  private ctx = this.canvas.getContext('2d', { willReadFrequently: true })!
  private img: ImageData | null = null
  private u32: Uint32Array | null = null
  private h = new Float32Array(1)
  rad = new Float32Array(NB)
  private radTmp = new Float32Array(NB)
  private tmpH = new Float32Array(1)
  /** grid: origin (css px) and size of one shading pixel (css px) */
  gx = 0
  gy = 0
  sp = 1
  GW = 1
  GH = 1
  /** last shaded rectangle in grid pixels */
  bx0 = 0
  by0 = 0
  bx1 = 0
  by1 = 0
  /** brightest specular point of the last frame (css px) */
  specX = 0
  specY = 0

  layout(cx: number, cy: number, R: number, floor: number, coarse = 1) {
    const sp = Math.max(1, (4.2 * R) / 300) * coarse
    this.sp = sp
    this.gx = cx - 2.1 * R
    this.gy = cy - 1.9 * R
    this.GW = Math.ceil((4.2 * R) / sp)
    this.GH = Math.ceil((floor + 0.1 * R - this.gy) / sp)
    this.canvas.width = this.GW
    this.canvas.height = this.GH
    this.img = this.ctx.createImageData(this.GW, this.GH)
    this.u32 = new Uint32Array(this.img.data.buffer)
    this.h = new Float32Array(this.GW * this.GH)
    this.tmpH = new Float32Array(this.GW * this.GH)
  }

  /**
   * Shade the silhouette given by the dense outline (xs, ys) around centre (cx, cy).
   * R: bun radius; floor: table line (css px); dents: finger presses.
   */
  shade(xs: Float32Array, ys: Float32Array, n: number, cx: number, cy: number, R: number, floor: number, dents: Dent[], skin: Skin) {
    const { GW, GH, sp, gx, gy, rad, h } = this
    const u32 = this.u32!
    // 1. radius of the silhouette by angle around (cx, cy)
    rad.fill(-1)
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity
    for (let i = 0; i < n; i++) {
      const x = xs[i]
      const y = ys[i]
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      const j = (i + 1) % n
      const a0 = Math.atan2(y - cy, x - cx)
      let a1 = Math.atan2(ys[j] - cy, xs[j] - cx)
      const r0 = Math.hypot(x - cx, y - cy)
      const r1 = Math.hypot(xs[j] - cx, ys[j] - cy)
      if (a1 - a0 > Math.PI) a1 -= TAU
      if (a0 - a1 > Math.PI) a1 += TAU
      const b0 = ((a0 + Math.PI) / TAU) * NB
      const b1 = ((a1 + Math.PI) / TAU) * NB
      const lo = Math.ceil(Math.min(b0, b1))
      const hi = Math.floor(Math.max(b0, b1))
      for (let b = lo; b <= hi; b++) {
        const f = b1 === b0 ? 0 : (b - b0) / (b1 - b0)
        const r = r0 + (r1 - r0) * f
        const k = ((b % NB) + NB) % NB
        if (r > rad[k]) rad[k] = r
      }
    }
    for (let k = 0; k < NB; k++) if (rad[k] < 0) rad[k] = rad[(k + NB - 1) % NB] > 0 ? rad[(k + NB - 1) % NB] : R
    // smooth the radius table a little: corners of the silhouette must not crease the dome
    {
      const tmp = this.radTmp
      const W = 4
      for (let k = 0; k < NB; k++) {
        let acc = 0
        for (let j = -W; j <= W; j++) acc += rad[(k + j + NB) % NB]
        tmp[k] = acc / (2 * W + 1)
      }
      rad.set(tmp)
    }

    // 2. bounding box in grid pixels, with a margin for the bilinear edge
    const bx0 = Math.max(1, Math.floor((minX - gx) / sp) - 3)
    const by0 = Math.max(1, Math.floor((minY - gy) / sp) - 3)
    const bx1 = Math.min(GW - 2, Math.ceil((maxX - gx) / sp) + 3)
    const by1 = Math.min(GH - 2, Math.ceil((maxY - gy) / sp) + 3)
    this.bx0 = bx0
    this.by0 = by0
    this.bx1 = bx1
    this.by1 = by1

    // 3. height field (grid units). The dome is taller than wide is deep: a soft mound.
    const H = (0.95 * R) / sp
    const pf = skin.flat
    const dn = dents.filter((d) => d.depth > 0.004)
    const dsig = 0.2 * R
    const dInv = 1 / (2 * dsig * dsig)
    const dAmp = (0.4 * R) / sp
    const rb = Math.max(1, Math.round((0.045 * R) / sp))
    const ex0 = Math.max(0, bx0 - 1 - 2 * rb)
    const ex1 = Math.min(GW - 1, bx1 + 1 + 2 * rb)
    const ey0 = Math.max(0, by0 - 1 - 2 * rb)
    const ey1 = Math.min(GH - 1, by1 + 1 + 2 * rb)
    for (let y = ey0; y <= ey1; y++) {
      const wy = gy + (y + 0.5) * sp
      const dy = wy - cy
      let o = y * GW + ex0
      for (let x = ex0; x <= ex1; x++, o++) {
        const wx = gx + (x + 0.5) * sp
        const dx = wx - cx
        const r = Math.sqrt(dx * dx + dy * dy)
        let fb = ((fastAtan2(dy, dx) + Math.PI) / TAU) * NB
        if (fb >= NB) fb -= NB
        const b = fb | 0
        const f = fb - b
        const rr = rad[b] + (rad[(b + 1) % NB] - rad[b]) * f
        const s = r / rr
        let hv: number
        if (s < 1) hv = H * Math.pow(1 - Math.pow(s, pf), 0.5)
        else hv = -(s - 1) * H * 3
        for (let k = 0; k < dn.length; k++) {
          const ex = wx - dn[k].x
          const ey = wy - dn[k].y
          const e2 = ex * ex + ey * ey
          if (e2 < 16 * dsig * dsig) hv += dn[k].depth * dAmp * (0.5 * Math.exp(-e2 * dInv * 0.4) - 1.2 * Math.exp(-e2 * dInv)) * edgeFade(s)
        }
        h[o] = hv
      }
    }
    // two box-blur passes (≈ gaussian): a soft body has no creases
    for (let pass = 0; pass < 2; pass++) {
      boxH(h, this.tmpH, GW, ex0, ex1, ey0, ey1, rb)
      boxV(this.tmpH, h, GW, ex0, ex1, ey0, ey1, rb)
    }

    // 4. light it
    // key light from the upper left and in front; rim light from the right and behind
    const L = norm3(-0.52, -0.68, 0.52)
    const Hk = norm3(L[0], L[1], L[2] + 1)
    const L2 = norm3(0.85, -0.3, 0.12)
    const H2 = norm3(L2[0], L2[1], L2[2] + 1)
    const [dr, dg, db] = skin.deep
    const [er, eg, eb] = skin.edge
    const [mr, mg, mb] = skin.mid
    const [lr, lg, lb] = skin.lit
    const [sr, sg, sb] = skin.sss
    const gloss = skin.gloss
    let best = -1
    let bestX = 0,
      bestY = 0
    for (let y = by0; y <= by1; y++) {
      const wy = gy + (y + 0.5) * sp
      const aoY = (floor - wy) / R
      const ao = aoY < 0.26 ? 1 - 0.13 * sq(1 - Math.max(0, aoY) / 0.26) : 1
      let o = y * GW + bx0
      for (let x = bx0; x <= bx1; x++, o++) {
        const hx = (h[o + 1] - h[o - 1]) * 0.5
        const hy = (h[o + GW] - h[o - GW]) * 0.5
        const il = 1 / Math.sqrt(hx * hx + hy * hy + 1)
        const nx = -hx * il
        const ny = -hy * il
        const nz = il
        const ndl = nx * L[0] + ny * L[1] + nz * L[2]
        // wrap diffuse: light bleeds past the terminator like it does in a soft translucent body
        const w = Math.min(1, Math.max(0, (ndl + 0.42) / 1.42))
        let r: number, g: number, b: number
        if (w < 0.42) {
          const t = w / 0.42
          r = dr + (er - dr) * t
          g = dg + (eg - dg) * t
          b = db + (eb - db) * t
        } else if (w < 0.74) {
          const t = (w - 0.42) / 0.32
          r = er + (mr - er) * t
          g = eg + (mg - eg) * t
          b = eb + (mb - eb) * t
        } else {
          const t = (w - 0.74) / 0.26
          r = mr + (lr - mr) * t
          g = mg + (lg - mg) * t
          b = mb + (lb - mb) * t
        }
        // Fresnel edge: thin skin at grazing angles lets the warm inside show through
        const fr = (1 - nz) * (1 - nz)
        const sa = skin.sssAmt * fr
        r += (sr - r) * sa
        g += (sg - g) * sa
        b += (sb - b) * sa
        // pink bounce from the mat on surfaces facing down
        if (ny > 0) {
          const bo = ny * fr * 0.5
          r += 10 * bo
          g -= 6 * bo
          b += 2 * bo
        }
        r *= ao
        g *= ao * 0.985
        b *= ao * 0.99
        // gloss: tight key highlight + broad sheen + rim light
        const nh = nx * Hk[0] + ny * Hk[1] + nz * Hk[2]
        const nh2 = nx * H2[0] + ny * H2[1] + nz * H2[2]
        let spec = 0
        if (nh > 0) {
          const p8 = pow8(nh)
          const p16 = p8 * p8
          const p128 = pow8(p16)
          spec = (p128 * 0.95 + p16 * 0.16 + p8 * 0.05) * gloss
          if (nh > best) {
            best = nh
            bestX = x
            bestY = y
          }
        }
        if (nh2 > 0) {
          const q = pow8(nh2)
          spec += q * 0.45 * gloss
        }
        if (spec > 1) spec = 1
        r += (255 - r) * spec
        g += (255 - g) * spec
        b += (255 - b) * spec
        u32[o] = 0xff000000 | (clampByte(b) << 16) | (clampByte(g) << 8) | clampByte(r)
      }
    }
    this.specX = gx + (bestX + 0.5) * sp
    this.specY = gy + (bestY + 0.5) * sp
    this.ctx.putImageData(this.img!, 0, 0, bx0, by0, bx1 - bx0 + 1, by1 - by0 + 1)
  }

  /** Silhouette radius at angle a (radians) around the centre used by the last shade(). */
  radAt(a: number): number {
    let fb = ((a + Math.PI) / TAU) * NB
    fb = ((fb % NB) + NB) % NB
    const b = fb | 0
    const f = fb - b
    return this.rad[b] + (this.rad[(b + 1) % NB] - this.rad[b]) * f
  }

  /** Draw the last shaded rectangle into ctx (caller sets the clip). */
  draw(ctx: CanvasRenderingContext2D) {
    const { bx0, by0, bx1, by1, sp, gx, gy } = this
    const w = bx1 - bx0 + 1
    const hh = by1 - by0 + 1
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(this.canvas, bx0, by0, w, hh, gx + bx0 * sp, gy + by0 * sp, w * sp, hh * sp)
  }
}

function boxH(src: Float32Array, dst: Float32Array, GW: number, x0: number, x1: number, y0: number, y1: number, r: number) {
  const inv = 1 / (2 * r + 1)
  for (let y = y0; y <= y1; y++) {
    const row = y * GW
    let acc = 0
    for (let k = -r; k <= r; k++) acc += src[row + Math.min(x1, Math.max(x0, x0 + k))]
    for (let x = x0; x <= x1; x++) {
      dst[row + x] = acc * inv
      acc += src[row + Math.min(x1, x + r + 1)] - src[row + Math.max(x0, x - r)]
    }
  }
}
function boxV(src: Float32Array, dst: Float32Array, GW: number, x0: number, x1: number, y0: number, y1: number, r: number) {
  const inv = 1 / (2 * r + 1)
  for (let x = x0; x <= x1; x++) {
    let acc = 0
    for (let k = -r; k <= r; k++) acc += src[Math.min(y1, Math.max(y0, y0 + k)) * GW + x]
    for (let y = y0; y <= y1; y++) {
      dst[y * GW + x] = acc * inv
      acc += src[Math.min(y1, y + r + 1) * GW + x] - src[Math.max(y0, y - r) * GW + x]
    }
  }
}
/** dents fade out toward the silhouette: a side press must not paint a bruise on the rim */
const edgeFade = (s: number) => {
  const t = Math.min(1, Math.max(0, (0.95 - s) / 0.35))
  return t * t * (3 - 2 * t)
}
const sq = (v: number) => v * v
const pow8 = (v: number) => {
  const a = v * v
  const b = a * a
  return b * b
}
const clampByte = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v | 0)
function norm3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z)
  return [x / l, y / l, z / l]
}

/** atan2 with max error ~0.0015 rad, plenty for an angular table lookup. */
function fastAtan2(y: number, x: number): number {
  const ax = Math.abs(x)
  const ay = Math.abs(y)
  const mx = Math.max(ax, ay)
  if (mx === 0) return 0
  const a = Math.min(ax, ay) / mx
  const s = a * a
  let r = ((-0.0464964749 * s + 0.15931422) * s - 0.327622764) * s * a + a
  if (ay > ax) r = 1.57079637 - r
  if (x < 0) r = 3.14159274 - r
  if (y < 0) r = -r
  return r
}
