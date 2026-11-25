import { useEffect, useRef, useState } from 'react'
import { MoreMenu, pillClass } from './components/MoreMenu'
import { applyMeta, locale, t, type Key } from './i18n'
import { startAnalytics, track } from './analytics'
import { SKINS, type Skin, bunFromUrl, landing, live, openSheet, parseName, sharePeak, stats, store, syncBunToUrl, trackLanding } from './share'
import { Tag } from './components/Tag'
import { Hint } from './components/Hint'
import { IconSquish } from './components/Icons'
import { startGame, type GameApi } from './game'

const fmt = new Intl.NumberFormat(locale)
const MILESTONES = [10, 50, 200]
const SWATCH: Record<Skin, string> = {
  mochi: 'radial-gradient(circle at 35% 30%, #FFF8F2, #F7C2B4 70%, #E9A096)',
  baozi: 'radial-gradient(circle at 35% 30%, #FFFFFF, #F1E4D2 70%, #D9C2A4)',
  tangyuan: 'radial-gradient(circle at 35% 30%, #FFFFFF, #EEEDF2 70%, #CFCAD6)',
  paw: 'radial-gradient(circle at 50% 62%, #F79AB0 22%, transparent 24%), radial-gradient(circle at 35% 30%, #FFFFFF, #F6E2DC 70%, #E4C3BC)',
}

const IconSpeaker = ({ off }: { off: boolean }) => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" />
    {off ? <path d="m16 9.5 5 5m0-5-5 5" /> : <><path d="M15.5 9.2a4 4 0 0 1 0 5.6" /><path d="M18 6.8a7.4 7.4 0 0 1 0 10.4" /></>}
  </svg>
)

type LineMsg = { key: Key; vars?: Record<string, string | number>; id: number }

/** The monologue: one line under the bun, cross-faded, gone after a few seconds. */
function Line({ k, y }: { k: LineMsg | null; y: number }) {
  const [prev, setPrev] = useState<LineMsg | null>(null)
  const cur = useRef(k)
  useEffect(() => {
    if (cur.current && k && cur.current.id !== k.id) setPrev(cur.current)
    cur.current = k
  }, [k])
  const cls = 'pointer-events-none fixed inset-x-0 z-10 mx-auto max-w-[30ch] px-3 text-center font-[ui-rounded,system-ui,sans-serif] text-[15px] leading-[22px] text-[#5A3440]/80 text-balance'
  return (
    <>
      {prev && (
        <div key={'p' + prev.id} className={`${cls} mono-out`} style={{ top: y }}>
          {t(prev.key, prev.vars)}
        </div>
      )}
      {k && (
        <div key={k.id} className={`${cls} mono-in`} style={{ top: y }}>
          {t(k.key, k.vars)}
        </div>
      )}
    </>
  )
}

export default function App() {
  const ref = useRef<HTMLCanvasElement>(null)
  const api = useRef<GameApi | null>(null)
  const [touched, setTouched] = useState(false)
  const [count, setCount] = useState(0)
  const [bump, setBump] = useState(0)
  const [initial] = useState(() => bunFromUrl())
  const [name, setName] = useState(initial.name)
  const [skin, setSkin] = useState<Skin>(initial.skin)
  const [panel, setPanel] = useState(false)
  const [muted, setMuted] = useState(false)
  const [line, setLine] = useState<LineMsg | null>(null)
  const [lineY, setLineY] = useState(0)
  const [chip, setChip] = useState(false)
  const lineTimer = useRef<number | undefined>(undefined)
  const nameTimer = useRef<number | undefined>(undefined)
  const gaTimer = useRef<number | undefined>(undefined)
  const ui = new URLSearchParams(location.search).get('ui') !== '0'

  useEffect(() => {
    applyMeta('squish')
    // a link with something in it: the title (what WeChat shows when it is forwarded) says so
    if (landing.recipient) document.title = initial.name ? t('sq_tag', { name: parseName(initial.name) }) : t('sq_tag0')
    startAnalytics('squish')
    stats.name = initial.name
    stats.skin = initial.skin
    trackLanding({ skin: initial.skin })
    let n = 0
    let maxes = 0
    let lineId = 0
    const g = startGame(
      ref.current!,
      {
        onFirst() {
          setTouched(true)
          track('play_start')
        },
        onSqueeze(total) {
          n = total
          stats.n = total
          setCount(total)
          setBump((b) => b + 1)
          if (MILESTONES.includes(total)) track('squeeze_milestone', { n: total })
        },
        onMax() {
          maxes++
          stats.k = maxes
          // the peak: the bun gives up; the slip comes as it rises again (the forgiveness is the joke)
          const peak = { snap: null, data: { n, k: maxes } }
          if (maxes === 1) {
            track('max_squeeze')
            sharePeak('squish', peak)
          } else store.peak = peak
        },
        onStretch(pct) {
          track('stretch_max', { pct: Math.min(200, Math.round(pct / 10) * 10) })
        },
        onFace() {},
        onLine(key, vars) {
          setLine({ key, vars, id: ++lineId })
          if (api.current) setLineY(api.current.lineY())
          window.clearTimeout(lineTimer.current)
          lineTimer.current = window.setTimeout(() => setLine(null), 3600)
        },
      },
      { skin: initial.skin, name: initial.name },
    )
    api.current = g
    setLineY(g.lineY())
    const onResize = () => setLineY(g.lineY())
    window.addEventListener('resize', onResize)
    const onHide = () => {
      if (document.visibilityState === 'hidden' && n > 0) track('session_squeezes', { n })
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onHide)
      g.dispose()
    }
  }, [initial])

  const onName = (v: string) => {
    setName(v)
    const clean = parseName(v)
    stats.name = clean
    window.clearTimeout(nameTimer.current)
    nameTimer.current = window.setTimeout(() => {
      api.current?.setName(clean)
      syncBunToUrl(clean, skin)
    }, 250)
    window.clearTimeout(gaTimer.current)
    if (clean) gaTimer.current = window.setTimeout(() => track('name_set', { len: clean.length }), 1500)
  }

  // a recipient answering: the name box opens empty, with its own placeholder; done typing, the sheet comes back
  const [ph, setPh] = useState('')
  live.reply = () => {
    onName('')
    setPh(t('sq_reply_ph'))
    setPanel(true)
  }
  const sendReply = () => {
    if (!ph || !parseName(name)) return
    setPh('')
    setPanel(false)
    window.clearTimeout(nameTimer.current)
    api.current?.setName(parseName(name))
    syncBunToUrl(parseName(name), skin)
    openSheet('reply')
  }

  const pickSkin = (s: Skin) => {
    setSkin(s)
    stats.skin = s
    api.current?.setSkin(s)
    syncBunToUrl(parseName(name), s)
    track('skin_set', { skin: s })
    if (s === 'paw') setChip(true)
  }

  const toggleMute = () => {
    setMuted((m) => {
      api.current?.setMuted(!m)
      return !m
    })
  }

  if (!ui) return <canvas ref={ref} />

  return (
    <>
      <canvas ref={ref} />
      <div className="pointer-events-none fixed inset-x-0 top-[max(1.25rem,5vh)] z-10 select-none text-center" style={{ color: 'rgba(122,62,76,0.82)', fontFamily: 'ui-rounded, system-ui, sans-serif' }}>
        <div key={bump % 2} className="sq-bump text-4xl font-semibold tabular-nums leading-tight">
          {fmt.format(count)}
        </div>
        <div className="mt-0.5 text-[13px] font-medium opacity-70">
          {t('sq_count')}
        </div>
      </div>
      <Line k={line} y={lineY} />
      <Hint text={t('hint_squish')} hidden={touched || !!line} toy="squish" />
      {landing.recipient && (
        <Tag
          text={initial.name ? t('sq_tag', { name: parseName(initial.name) }) : t('sq_tag0')}
          className="top-[calc(max(1.25rem,5vh)+4.6rem)]"
          paper="bg-[#FFFBF3] text-[#6B4A2E] font-medium"
        />
      )}
      {chip && skin === 'paw' && (
        <a
          href="https://purr.integ.life"
          onPointerDown={(e) => e.stopPropagation()}
          className="mono-in fixed bottom-[4.5rem] left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full border border-[#5A3440]/15 bg-[#FFF8F6]/85 px-4 py-2 text-sm font-medium text-[#5A3440] backdrop-blur-md"
        >
          {t('sq_paw_chip')}
        </a>
      )}
      <div className="fixed left-3 top-3 z-20 select-none" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" aria-label={t('sq_skin')} onClick={() => setPanel((p) => !p)} className={`${pillClass('squish')} ${name ? '' : '!w-11 justify-center !px-0'}`}>
          <IconSquish />
          {name ? <span className="max-w-[9rem] truncate">{parseName(name)}</span> : null}
        </button>
        {panel && (
          <div className="mt-2 w-64 rounded-2xl border border-[#5A3440]/15 bg-[#FFF8F6]/92 p-3 text-[#5A3440] shadow-lg backdrop-blur-md">
            <input
              value={name}
              maxLength={12}
              autoFocus={!!ph}
              onBlur={sendReply}
              placeholder={ph || t('sq_name_ph')}
              enterKeyHint="done"
              onChange={(e) => onName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              className="w-full rounded-full border border-[#5A3440]/20 bg-white/70 px-3.5 py-1.5 text-base outline-none placeholder-[#5A3440]/40 focus:border-[#5A3440]/45"
            />
            <div className="mt-3 mb-1.5 text-xs font-semibold uppercase tracking-widest opacity-60">{t('sq_skin')}</div>
            <div className="grid grid-cols-4 gap-1.5">
              {SKINS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => pickSkin(c)}
                  className={`flex min-h-[44px] flex-col items-center gap-1 rounded-xl px-1 py-1.5 text-[11px] leading-tight ${c === skin ? 'bg-[#5A3440]/10 font-semibold' : 'hover:bg-[#5A3440]/5'}`}
                >
                  <span className="h-6 w-6 rounded-full border border-[#5A3440]/20" style={{ background: SWATCH[c] }} />
                  {t(`skin_${c}`)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="fixed right-3 top-3 z-20 select-none" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" onClick={toggleMute} aria-label={muted ? t('sound_off') : t('sound_on')} title={muted ? t('sound_off') : t('sound_on')} className={`${pillClass('squish')} !w-11 justify-center !px-0`}>
          <IconSpeaker off={muted} />
        </button>
      </div>
      <MoreMenu current="squish" />
    </>
  )
}
