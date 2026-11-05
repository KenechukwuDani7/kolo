// Builds the landing page as a static site for Vercel (site/), so it has a friendly address.
// /ussd is passed through to the Kolo server by site/vercel.json, so the demo link works there too.
//   npx tsx src/build-site.ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { landingPage } from './landing-page.js'

const WALLET_URL = process.env.JOIN_URL ?? 'https://wallet.84-12-109-77.sslip.io'
const KOLO_URL = process.env.KOLO_URL ?? 'https://kolo.84-12-109-77.sslip.io'
const out = new URL('../../site/', import.meta.url)

mkdirSync(out, { recursive: true })
writeFileSync(new URL('index.html', out), landingPage(WALLET_URL))
writeFileSync(
  new URL('vercel.json', out),
  JSON.stringify({ rewrites: [{ source: '/ussd', destination: `${KOLO_URL}/ussd` }] }, null, 2) + '\n',
)
console.log(`site/ built (wallet ${WALLET_URL}, USSD via ${KOLO_URL})`)
