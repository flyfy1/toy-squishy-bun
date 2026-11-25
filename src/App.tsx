import { useEffect, useRef, useState } from 'react'
import { MoreMenu } from './components/MoreMenu'
import { applyMeta, locale, t } from './i18n'
import { startAnalytics, track } from './analytics'
import { bunFromUrl, stats } from './share'
import { Hint } from './components/Hint'
import { startGame } from './game'

const fmt = new Intl.NumberFormat(locale)
const MILESTONES = [10, 50, 200]

export default function App() {
  const ref = useRef<HTMLCanvasElement>(null)
  const [touched, setTouched] = useState(false)
  const [count, setCount] = useState(0)
  const [bursts, setBursts] = useState(0)
  const [bump, setBump] = useState(0)
  const [initial] = useState(() => bunFromUrl())
  const ui = new URLSearchParams(location.search).get('ui') !== '0'

  useEffect(() => {
    applyMeta('squish')
    startAnalytics('squish')
    stats.name = initial.name
    stats.skin = initial.skin
    if (initial.name || initial.skin !== 'mochi') track('shared_open', { skin: initial.skin })
    let n = 0
    const g = startGame(ref.current!, {
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
      onBurst(total) {
        setBursts(total)
        track('burst', { n: total })
      },
      onStretch(pct) {
        track('stretch_max', { pct: Math.min(200, Math.round(pct / 10) * 10) })
      },
      onFace() {},
    })
    const onHide = () => {
      if (document.visibilityState === 'hidden' && n > 0) track('session_squeezes', { n })
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      g.dispose()
    }
  }, [initial])

  return (
    <>
      <canvas ref={ref} />
      {ui && (
        <>
          <div className="pointer-events-none fixed inset-x-0 top-[max(1.5rem,6vh)] z-10 select-none text-center" style={{ color: 'rgba(122,62,76,0.82)', fontFamily: 'ui-rounded, system-ui, sans-serif' }}>
            <div key={bump % 2} className="sq-bump text-4xl font-semibold tabular-nums leading-tight">
              {fmt.format(count)}
            </div>
            <div className="mt-0.5 text-[13px] font-medium opacity-70">{t('name_squish')}{bursts > 0 ? ` · ${bursts}` : ''}</div>
          </div>
          <Hint text={t('hint_squish')} hidden={touched} toy="squish" />
          <MoreMenu current="squish" />
        </>
      )}
    </>
  )
}
