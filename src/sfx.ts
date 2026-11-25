// Squish sounds, all synthesised (design 3 "Audio"): a rubbery creak that follows the
// compression rate, a soft "pff" on release, a wet squelch for the burst, a slurp when the
// filling goes back in, a small boing when it wakes up.
import { audio } from './engine/AudioEngine'

class Sfx {
  private out: GainNode | null = null
  private creakSrc: AudioBufferSourceNode | null = null
  private creakBp: BiquadFilterNode | null = null
  private creakGain: GainNode | null = null
  private noise: AudioBuffer | null = null
  private muted = false

  unlock() {
    audio.unlock()
    const ctx = audio.ctx
    if (!ctx || this.out) return
    const out = ctx.createGain()
    out.gain.value = this.muted ? 0 : 0.9
    out.connect(ctx.destination)
    this.out = out
    const len = ctx.sampleRate * 2
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    // brown-ish noise: softer, more "rubber" than white noise
    let last = 0
    for (let i = 0; i < len; i++) {
      last = (last + 0.06 * (Math.random() * 2 - 1)) / 1.06
      d[i] = last * 3.2
    }
    this.noise = buf
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 400
    bp.Q.value = 2.2
    const g = ctx.createGain()
    g.gain.value = 0
    src.connect(bp).connect(g).connect(out)
    src.start()
    this.creakSrc = src
    this.creakBp = bp
    this.creakGain = g
  }

  /** rate: compression rate (1/s, >= 0); comp: current compression 0..0.6 */
  creak(rate: number, comp: number) {
    const ctx = audio.ctx
    if (!ctx || !this.creakGain || !this.creakBp) return
    const t = ctx.currentTime
    const r = Math.min(1, rate / 1.6)
    this.creakGain.gain.setTargetAtTime(0.08 * r, t, 0.03)
    this.creakBp.frequency.setTargetAtTime(300 + 600 * Math.min(1, comp * 2 + r * 0.3), t, 0.04)
  }

  private burstNoise(dur: number, gain: number, type: BiquadFilterType, f0: number, f1: number, q = 1, delay = 0) {
    const ctx = audio.ctx
    if (!ctx || !this.out || !this.noise) return
    const t0 = ctx.currentTime + delay
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const f = ctx.createBiquadFilter()
    f.type = type
    f.Q.value = q
    f.frequency.setValueAtTime(f0, t0)
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.02, dur * 0.2))
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(f).connect(g).connect(this.out)
    src.start(t0, Math.random())
    src.stop(t0 + dur + 0.02)
  }

  private blip(f0: number, f1: number, dur: number, gain: number, delay = 0) {
    const ctx = audio.ctx
    if (!ctx || !this.out) return
    const t0 = ctx.currentTime + delay
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(f0, t0)
    o.frequency.exponentialRampToValueAtTime(f1, t0 + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    o.connect(g).connect(this.out)
    o.start(t0)
    o.stop(t0 + dur + 0.02)
  }

  release(depth: number) {
    this.burstNoise(0.12, 0.05 + 0.06 * depth, 'lowpass', 900, 200, 0.7)
  }

  grab() {
    this.burstNoise(0.06, 0.03, 'bandpass', 700, 500, 3)
  }

  snap(amount: number) {
    this.blip(420 + 200 * amount, 180, 0.12, 0.08 + 0.08 * amount)
    this.burstNoise(0.08, 0.05, 'lowpass', 1200, 300, 0.8)
  }

  /** Wet squelch: three quick pitch-dropping blips over a band-passed splat. Soup is wetter and lower. */
  burst(kind = 'mochi') {
    const k = kind === 'baozi' ? 0.8 : kind === 'tangyuan' ? 0.9 : 1
    this.blip(400 * k, 260 * k, 0.07, 0.16)
    this.blip(330 * k, 200 * k, 0.07, 0.14, 0.06)
    this.blip(260 * k, 150 * k, 0.09, 0.12, 0.12)
    this.burstNoise(0.28, 0.16, 'bandpass', 900 * k, 250, kind === 'baozi' ? 3 : 1.6)
    if (kind === 'baozi') this.burstNoise(0.4, 0.06, 'bandpass', 2400, 700, 6, 0.1)
  }

  setMuted(m: boolean) {
    this.muted = m
    if (this.out && audio.ctx) this.out.gain.setTargetAtTime(m ? 0 : 0.9, audio.ctx.currentTime, 0.02)
  }

  slurp() {
    this.blip(180, 520, 0.22, 0.08)
    this.burstNoise(0.3, 0.06, 'bandpass', 300, 1100, 4)
  }

  boing() {
    this.blip(300, 620, 0.16, 0.08)
  }

  stop() {
    try {
      this.creakSrc?.stop()
    } catch {
      /* not started */
    }
  }
}

export const sfx = new Sfx()
