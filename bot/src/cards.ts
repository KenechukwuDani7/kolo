// Images Kolo posts in chat. Built as SVG and rasterised to PNG, so the design
// can later be swapped for Ike's Figma templates without touching the bot.
import { Resvg } from '@resvg/resvg-js'

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const naira = (n: number) => `₦${n.toLocaleString('en-NG')}`

export function renderDuesCard({ title, amount, paid, size }: { title: string; amount: number; paid: number; size: number }) {
  const width = 800
  const pct = Math.min(paid / size, 1)
  const barWidth = 680
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="420" viewBox="0 0 ${width} 420">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0a5232"/><stop offset="1" stop-color="#14965c"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="420" rx="36" fill="url(#bg)"/>
  <circle cx="720" cy="70" r="120" fill="#ffffff" opacity="0.06"/>
  <text x="60" y="80" font-family="Segoe UI, Arial" font-size="26" fill="#ffffff" opacity="0.8" letter-spacing="3">KOLO · DUES</text>
  <text x="60" y="140" font-family="Segoe UI, Arial" font-size="44" font-weight="700" fill="#ffffff">${esc(title).slice(0, 34)}</text>
  <text x="60" y="190" font-family="Segoe UI, Arial" font-size="28" fill="#ffffff" opacity="0.85">${naira(amount)} each</text>
  <rect x="60" y="240" width="${barWidth}" height="28" rx="14" fill="#ffffff" opacity="0.2"/>
  <rect x="60" y="240" width="${Math.max(barWidth * pct, pct > 0 ? 28 : 0)}" height="28" rx="14" fill="#f4b400"/>
  <text x="60" y="330" font-family="Segoe UI, Arial" font-size="56" font-weight="700" fill="#ffffff">${paid}/${size} paid</text>
  <text x="60" y="378" font-family="Segoe UI, Arial" font-size="28" fill="#ffffff" opacity="0.85">${naira(paid * amount)} collected</text>
  <text x="740" y="378" text-anchor="end" font-family="Segoe UI, Arial" font-size="48">🐷</text>
</svg>`
  return new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' } }).render().asPng()
}
