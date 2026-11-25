// Desk props in the same soft light as the bun (window light from the upper left): a cup of tea
// with live steam and a sticky note in handwriting. Baked into the background except the steam.

export const HAND =
  '"Bradley Hand", "Segoe Print", "Chalkboard SE", "Marker Felt", "Comic Sans MS", "Kaiti SC", "STKaiti", "KaiTi", "Klee", cursive'

export interface PropLayout {
  cup: { x: number; y: number; w: number }
  note: { x: number; y: number; w: number; rot: number }
}

export function propLayout(w: number, h: number, cx: number, floor: number, R: number): PropLayout {
  if (w < h * 0.8) {
    // portrait phone: tea in the upper right, the note in the lower left, clear of the bun and UI
    return {
      cup: { x: w * 0.83, y: Math.max(h * 0.2, floor - 2.5 * R), w: Math.min(w * 0.16, 80) },
      note: { x: w * 0.23, y: Math.min(h * 0.78, floor + 1.25 * R), w: Math.min(w * 0.25, 120), rot: -0.1 },
    }
  }
  return {
    cup: { x: cx + 2.3 * R, y: floor - 0.28 * R, w: 0.46 * R },
    note: { x: cx - 2.35 * R, y: floor - 0.2 * R, w: 0.62 * R, rot: -0.12 },
  }
}

/** A teacup on a saucer, seen from the front and above, lit from the upper left. */
export function drawCup(g: CanvasRenderingContext2D, x: number, y: number, w: number) {
  const s = w
  g.save()
  g.translate(x, y)
  // shadow on the mat, away from the light
  sh(g, s * 0.12, s * 0.42, s * 0.78, s * 0.2, 'rgba(160,78,98,0.22)')
  // saucer
  ell(g, 0, s * 0.32, s * 0.7, s * 0.2, lin(g, -s * 0.7, 0, s * 0.7, 0, [[0, '#FFFDF9'], [1, '#EFD9D6']]))
  ell(g, 0, s * 0.3, s * 0.52, s * 0.14, lin(g, -s * 0.5, 0, s * 0.5, 0, [[0, '#F7EAE6'], [1, '#E7CFCB']]))
  g.strokeStyle = 'rgba(214,140,150,0.55)'
  g.lineWidth = Math.max(1, s * 0.02)
  g.beginPath()
  g.ellipse(0, s * 0.32, s * 0.66, s * 0.185, 0, 0, Math.PI * 2)
  g.stroke()
  // handle
  g.strokeStyle = '#EAD3CF'
  g.lineWidth = s * 0.075
  g.beginPath()
  g.ellipse(s * 0.47, s * 0.02, s * 0.15, s * 0.14, 0, -1.3, 1.5)
  g.stroke()
  g.strokeStyle = 'rgba(255,255,255,0.7)'
  g.lineWidth = s * 0.02
  g.beginPath()
  g.ellipse(s * 0.47, s * 0.01, s * 0.15, s * 0.13, 0, -1.1, 0.4)
  g.stroke()
  // cup body: tapered, cream porcelain with a pink band
  g.beginPath()
  g.moveTo(-s * 0.46, -s * 0.18)
  g.bezierCurveTo(-s * 0.46, s * 0.12, -s * 0.32, s * 0.3, 0, s * 0.3)
  g.bezierCurveTo(s * 0.32, s * 0.3, s * 0.46, s * 0.12, s * 0.46, -s * 0.18)
  g.closePath()
  g.fillStyle = lin(g, -s * 0.46, 0, s * 0.46, 0, [[0, '#FFFFFF'], [0.35, '#FFF8F4'], [1, '#E2C7C3']])
  g.fill()
  g.save()
  g.clip()
  g.fillStyle = 'rgba(244,150,166,0.55)'
  g.fillRect(-s, s * 0.02, s * 2, s * 0.06)
  g.fillStyle = 'rgba(255,255,255,0.75)'
  g.fillRect(-s * 0.36, -s * 0.12, s * 0.06, s * 0.3)
  g.restore()
  // rim and tea
  ell(g, 0, -s * 0.18, s * 0.46, s * 0.12, '#FFFDFB')
  ell(g, 0, -s * 0.17, s * 0.4, s * 0.095, lin(g, -s * 0.4, 0, s * 0.4, 0, [[0, '#B8743E'], [1, '#D99A5B']]))
  ell(g, -s * 0.12, -s * 0.19, s * 0.13, s * 0.03, 'rgba(255,240,220,0.55)')
  g.restore()
}

/** Steam from the cup: three soft wisps that rise, sway and fade. */
export function drawSteam(g: CanvasRenderingContext2D, x: number, y: number, w: number, t: number) {
  g.save()
  g.lineCap = 'round'
  for (let k = 0; k < 3; k++) {
    const ph = t * 0.55 + k * 0.33
    const u = ph % 1
    const a = Math.sin(u * Math.PI) * 0.32
    const bx = x + (k - 1) * w * 0.14
    const by = y - w * 0.22 - u * w * 0.5
    g.strokeStyle = `rgba(255,255,255,${a})`
    g.lineWidth = w * (0.07 - 0.03 * u)
    g.beginPath()
    for (let j = 0; j <= 8; j++) {
      const v = j / 8
      const xx = bx + Math.sin(v * 4 + t * 1.6 + k * 2) * w * 0.07 * (0.4 + v)
      const yy = by - v * w * 0.55
      if (j) g.lineTo(xx, yy)
      else g.moveTo(xx, yy)
    }
    g.stroke()
  }
  g.restore()
}

/** A square sticky note, slightly curled at the lower corner, with a handwritten line. */
export function drawNote(g: CanvasRenderingContext2D, x: number, y: number, w: number, rot: number, big: string, small: string) {
  g.save()
  g.translate(x, y)
  g.rotate(rot)
  const h = w
  // shadow: tight under the glued top, larger under the curled bottom
  g.save()
  g.filter = `blur(${Math.max(2, w * 0.05)}px)`
  g.fillStyle = 'rgba(150,72,96,0.24)'
  g.beginPath()
  g.moveTo(-w / 2 + 2, -h / 2 + 3)
  g.lineTo(w / 2 + 2, -h / 2 + 3)
  g.lineTo(w / 2 + w * 0.06, h / 2 + w * 0.07)
  g.lineTo(-w / 2 + w * 0.04, h / 2 + w * 0.05)
  g.fill()
  g.restore()
  g.beginPath()
  g.moveTo(-w / 2, -h / 2)
  g.lineTo(w / 2, -h / 2)
  g.lineTo(w / 2, h / 2 - h * 0.1)
  g.quadraticCurveTo(w / 2 - w * 0.02, h / 2 - h * 0.01, w / 2 - w * 0.14, h / 2)
  g.lineTo(-w / 2, h / 2)
  g.closePath()
  g.fillStyle = lin(g, 0, -h / 2, 0, h / 2, [[0, '#FFF6B8'], [0.2, '#FFF1A6'], [1, '#F8E38C']])
  g.fill()
  // glue strip and the curl's shading
  g.fillStyle = 'rgba(214,180,70,0.12)'
  g.fillRect(-w / 2, -h / 2, w, h * 0.16)
  g.fillStyle = lin(g, w / 2 - w * 0.2, h / 2 - h * 0.2, w / 2, h / 2, [[0, 'rgba(255,255,255,0)'], [1, 'rgba(206,168,70,0.35)']])
  g.fill()
  // handwriting
  g.fillStyle = 'rgba(64,72,140,0.88)'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const fit = (txt: string, size: number, maxW: number) => {
    let fs = size
    g.font = `600 ${fs}px ${HAND}`
    while (fs > 8 && g.measureText(txt).width > maxW) {
      fs -= 1
      g.font = `600 ${fs}px ${HAND}`
    }
    return fs
  }
  const maxW = w * 0.82
  if (big) {
    const fs = fit(big, w * 0.24, maxW)
    g.fillText(big, 0, -h * 0.06)
    g.strokeStyle = 'rgba(64,72,140,0.6)'
    g.lineWidth = Math.max(1, w * 0.012)
    const tw = Math.min(maxW, g.measureText(big).width)
    g.beginPath()
    g.moveTo(-tw / 2, -h * 0.06 + fs * 0.55)
    g.quadraticCurveTo(0, -h * 0.06 + fs * 0.7, tw / 2, -h * 0.06 + fs * 0.5)
    g.stroke()
    fit(small, w * 0.12, maxW)
    g.fillText(small, 0, h * 0.25)
  } else {
    const words = small.split(' ')
    const lines = words.length > 1 && small.length > 9 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [small]
    const fs = Math.min(...lines.map((l) => fit(l, w * 0.18, maxW)))
    g.font = `600 ${fs}px ${HAND}`
    lines.forEach((l, i) => g.fillText(l, 0, (i - (lines.length - 1) / 2) * fs * 1.15))
  }
  g.restore()
}

function lin(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) {
  const l = g.createLinearGradient(x0, y0, x1, y1)
  for (const [o, c] of stops) l.addColorStop(o, c)
  return l
}
function ell(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string | CanvasGradient) {
  g.fillStyle = fill
  g.beginPath()
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
  g.fill()
}
function sh(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, col: string) {
  g.save()
  g.translate(x, y)
  g.scale(1, ry / rx)
  const r = g.createRadialGradient(0, 0, 0, 0, 0, rx)
  r.addColorStop(0, col)
  r.addColorStop(1, 'rgba(160,78,98,0)')
  g.fillStyle = r
  g.beginPath()
  g.arc(0, 0, rx, 0, Math.PI * 2)
  g.fill()
  g.restore()
}
