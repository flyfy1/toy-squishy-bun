// After the build: dist/g/index.html, the same app with a link preview that says something was left for
// you (og:title, og:image og-g.png, og:url /g/). Made from the built index.html, so the rest of the head
// (written by _tools/seo.py) stays as it is; the canonical link still points at the root page.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const GIFT = {
  knock: '有人给你点了一炷香 · Someone lit a stick of incense for you',
  smash: '有人留了块玻璃给你 · Someone left you a pane of glass',
  scratch: '有人给你留了一张刮刮卡 · Someone left you a scratch card',
  squish: '有人把一只团子交给你了 · Someone handed you a bun',
  purr: '有只猫的铲屎官让你代班 · A cat’s human has left you in charge',
}
const html = readFileSync('dist/index.html', 'utf8')
const host = /<link rel="canonical" href="https:\/\/([a-z]+)\.integ\.life\/"/.exec(html)?.[1]
const title = GIFT[host]
if (!title) throw new Error('g-page: no gift title for ' + host)
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const url = `https://${host}.integ.life/`
let out = html
const set = (re, val) => {
  if (!re.test(out)) throw new Error('g-page: not found ' + re)
  out = out.replace(re, val)
}
set(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
set(/(<meta property="og:title" content=")[^"]*/, `$1${esc(title)}`)
set(/(<meta name="twitter:title" content=")[^"]*/, `$1${esc(title)}`)
set(/(<meta property="og:url" content=")[^"]*/, `$1${url}g/`)
set(/(<meta property="og:image" content=")[^"]*/, `$1${url}og-g.png`)
set(/(<meta name="twitter:image" content=")[^"]*/, `$1${url}og-g.png`)
set(/(<meta property="og:image:alt" content=")[^"]*/, `$1${esc(title)}`)
set(/(<meta name="twitter:image:alt" content=")[^"]*/, `$1${esc(title)}`)
mkdirSync('dist/g', { recursive: true })
writeFileSync('dist/g/index.html', out)
console.log('g-page: dist/g/index.html for', host)
