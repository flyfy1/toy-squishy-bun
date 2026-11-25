// The bun's tiny face (design 3): two dot eyes 0.3 R apart, a small "w" mouth and blush.
// It reacts with increasing betrayal: calm → >_< → spirals and a sweat drop → shock when the
// filling pops; a flat unimpressed stare after you let go; closed eyes when it dozes.

export type FaceState = 'calm' | 'wince' | 'dizzy' | 'burst' | 'stare' | 'doze' | 'surprised'

export interface FaceFrame {
  x: number
  y: number
  m11: number
  m12: number
  m21: number
  m22: number
  R: number
  blink: number // 0..1
  lookX: number
  lookY: number
  E: number
  time: number
}

const INK = '#4A2A2E'
const EX = 0.15 // half eye spacing (R)
const ER = 0.042 // eye radius (R)

export function drawFace(ctx: CanvasRenderingContext2D, state: FaceState, t: number, f: FaceFrame) {
  const { R } = f
  ctx.save()
  ctx.translate(f.x, f.y)
  ctx.transform(f.m11, f.m21, f.m12, f.m22, 0, 0)
  ctx.scale(R, R)
  const px = 1 / R // one css pixel in local units
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // blush: soft ovals, redder when it hurts
  const hot = state === 'wince' || state === 'dizzy' || state === 'burst' ? 1 : state === 'surprised' ? 0.7 : 0.45
  for (const s of [-1, 1]) {
    ctx.save()
    ctx.translate(s * 0.265, 0.085)
    ctx.scale(1, 0.58)
    const r = 0.085 + hot * 0.02
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
    g.addColorStop(0, `rgba(255,140,146,${0.42 + hot * 0.3})`)
    g.addColorStop(0.6, `rgba(255,150,154,${0.22 + hot * 0.15})`)
    g.addColorStop(1, 'rgba(255,158,158,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  ctx.strokeStyle = INK
  ctx.fillStyle = INK
  const lw = Math.max(1.5 * px, 0.017)
  ctx.lineWidth = lw

  // eyes
  const lx = f.lookX * 0.014
  const ly = f.lookY * 0.01
  for (const s of [-1, 1]) {
    ctx.save()
    ctx.translate(s * EX, 0)
    switch (state) {
      case 'calm': {
        const open = 1 - f.blink
        if (open < 0.25) {
          ctx.beginPath()
          ctx.moveTo(-ER * 1.1, 0)
          ctx.quadraticCurveTo(0, ER * 0.7, ER * 1.1, 0)
          ctx.stroke()
        } else {
          dotEye(ctx, lx, ly, ER, open)
        }
        break
      }
      case 'wince': {
        // >_<
        const w = 0.05
        ctx.lineWidth = lw * 1.1
        ctx.beginPath()
        ctx.moveTo(s * w, -w * 0.85)
        ctx.lineTo(-s * w * 0.75, 0)
        ctx.lineTo(s * w, w * 0.85)
        ctx.stroke()
        break
      }
      case 'dizzy': {
        ctx.lineWidth = lw * 0.85
        ctx.beginPath()
        const turns = 2.4
        const a0 = -t * 9 * s
        for (let k = 0; k <= 48; k++) {
          const u = k / 48
          const a = a0 + u * turns * Math.PI * 2 * s
          const r = 0.008 + u * 0.056
          const x = Math.cos(a) * r
          const y = Math.sin(a) * r
          if (k === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
        break
      }
      case 'burst': {
        // shock: wide ring eyes with a tiny pupil
        ctx.lineWidth = lw * 0.9
        ctx.fillStyle = '#FFFFFF'
        ctx.beginPath()
        ctx.arc(0, 0, 0.058, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = INK
        ctx.beginPath()
        ctx.arc(lx * 0.5, ly * 0.5 + 0.004 * Math.sin(t * 40), 0.019, 0, Math.PI * 2)
        ctx.fill()
        break
      }
      case 'stare': {
        // unimpressed: heavy flat lid over a half dot
        ctx.save()
        ctx.beginPath()
        ctx.rect(-0.08, 0.004, 0.16, 0.08)
        ctx.clip()
        ctx.beginPath()
        ctx.arc(0, 0.002, ER * 1.05, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
        ctx.beginPath()
        ctx.moveTo(-ER * 1.55, 0)
        ctx.lineTo(ER * 1.55, 0)
        ctx.stroke()
        break
      }
      case 'doze': {
        // closed: soft downward arcs
        ctx.beginPath()
        ctx.moveTo(-ER * 1.2, -0.004)
        ctx.quadraticCurveTo(0, ER * 0.95, ER * 1.2, -0.004)
        ctx.stroke()
        break
      }
      case 'surprised': {
        const k = Math.min(1, t / 0.08)
        dotEye(ctx, 0, -0.004, ER * (1 + 0.45 * k), 1)
        break
      }
    }
    ctx.restore()
  }

  // sweat drop (dizzy): slides down the cheek, then starts again
  if (state === 'dizzy') {
    const k = (t * 0.6) % 1
    const sx = 0.34
    const sy = -0.2 + k * 0.1
    const a = Math.min(1, k * 6) * Math.min(1, (1 - k) * 5)
    ctx.save()
    ctx.globalAlpha = a
    ctx.translate(sx, sy)
    const g = ctx.createLinearGradient(0, -0.07, 0, 0.05)
    g.addColorStop(0, '#DDF3FF')
    g.addColorStop(1, '#8CCBF2')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(0, -0.075)
    ctx.bezierCurveTo(0.018, -0.035, 0.042, -0.005, 0.042, 0.018)
    ctx.arc(0, 0.018, 0.042, 0, Math.PI)
    ctx.bezierCurveTo(-0.042, -0.005, -0.018, -0.035, 0, -0.075)
    ctx.fill()
    ctx.strokeStyle = 'rgba(80,140,190,0.55)'
    ctx.lineWidth = Math.max(1 * px, 0.008)
    ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.beginPath()
    ctx.ellipse(-0.014, 0.012, 0.009, 0.016, 0.3, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  // mouth
  ctx.lineWidth = Math.max(1.3 * px, 0.015)
  ctx.strokeStyle = INK
  ctx.fillStyle = INK
  const my = 0.068
  switch (state) {
    case 'calm':
    case 'doze': {
      // ω
      const w = 0.036
      ctx.beginPath()
      ctx.moveTo(-w * 1.05, my - 0.006)
      ctx.quadraticCurveTo(-w * 0.55, my + w * 0.95, 0, my + 0.002)
      ctx.quadraticCurveTo(w * 0.55, my + w * 0.95, w * 1.05, my - 0.006)
      ctx.stroke()
      break
    }
    case 'wince': {
      // tight wobbly line
      ctx.beginPath()
      for (let k = 0; k <= 12; k++) {
        const u = k / 12
        const x = (u - 0.5) * 0.08
        const y = my + 0.006 + Math.sin(u * Math.PI * 3) * 0.007
        if (k === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      break
    }
    case 'dizzy': {
      const wob = 1 + 0.12 * Math.sin(t * 13)
      openMouth(ctx, 0, my + 0.012, 0.026 * wob, 0.022 / wob)
      break
    }
    case 'burst':
      openMouth(ctx, 0, my + 0.016, 0.034, 0.038)
      break
    case 'surprised':
      openMouth(ctx, 0, my + 0.012, 0.02, 0.024)
      break
    case 'stare': {
      ctx.beginPath()
      ctx.moveTo(-0.03, my + 0.008)
      ctx.lineTo(0.03, my + 0.008)
      ctx.stroke()
      break
    }
  }
  ctx.restore()
}

function dotEye(ctx: CanvasRenderingContext2D, lx: number, ly: number, r: number, open: number) {
  ctx.save()
  ctx.translate(lx, ly)
  ctx.scale(1, open)
  ctx.fillStyle = INK
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.fill()
  // catchlights, same side as the key light
  ctx.fillStyle = 'rgba(255,255,255,0.95)'
  ctx.beginPath()
  ctx.arc(-r * 0.36, -r * 0.38, r * 0.34, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.beginPath()
  ctx.arc(r * 0.38, r * 0.34, r * 0.15, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function openMouth(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) {
  ctx.save()
  ctx.fillStyle = '#7A3440'
  ctx.beginPath()
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.save()
  ctx.clip()
  ctx.fillStyle = '#E8707E'
  ctx.beginPath()
  ctx.ellipse(x, y + ry * 0.9, rx * 0.8, ry * 0.6, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  ctx.stroke()
  ctx.restore()
}
