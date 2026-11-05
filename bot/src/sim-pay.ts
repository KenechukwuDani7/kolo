// Kolo's own test checkout, standing in for Roqqu's sandbox checkout when Roqqu can't be
// used (its sandbox stopped accepting payment links, and it blocks cloud servers).
// Same flow as Roqqu's: a personal link per payer, and a checkout page with
// Completed / Underpaid / Failed buttons. No money moves; it's labelled as a test.
//   ROQQU_MODE=simulate   (KOLO_URL = this bot's public address, for the links)
import type { Member, Payments } from './kolo.js'
import { nairaPerDollar, notAnswering, outageOn } from './roqqu.js'

export type SimLink = { naira: number; title: string; memberId: string; name: string; state: 'open' | 'paid' | 'underpaid' | 'failed' }
export const simLinks = new Map<string, SimLink>()

const koloUrl = () => (process.env.KOLO_URL ?? `http://localhost:${process.env.QR_PORT ?? 3117}`).replace(/\/$/, '')
const ref = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase()

export const simulatedPayments: Payments = {
  async link({ member, amount, title }) {
    if (outageOn()) throw notAnswering('Roqqu /payment-links')
    const reference = ref('S')
    simLinks.set(reference, { naira: amount, title, memberId: member.id, name: member.name, state: 'open' })
    return { reference, url: `${koloUrl()}/pay/${reference}` }
  },
  async payout({ member, amount }: { member: Member; amount: number }) {
    if (outageOn()) throw notAnswering('Roqqu /wallets/send')
    const rate = await nairaPerDollar()
    const usdt = Math.floor((amount / rate) * 100) / 100
    if (usdt < 1) throw new Error(`Roqqu's smallest send is 1 USDT (about ₦${Math.ceil(rate).toLocaleString('en-NG')})`)
    console.log(`test payout ${usdt} USDT to ${member.name}`)
    return { reference: ref('SP'), sent: `${usdt} USDT on BSC at ₦${rate.toLocaleString('en-NG')}/$, test mode` }
  },
  async groupAccount() {
    throw new Error('group accounts need the live Roqqu API')
  },
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const naira = (n: number) => `₦${n.toLocaleString('en-NG')}`

// balance: the payer's Kolo balance, when this link can be paid from it (not a top-up).
export function checkoutPage(reference: string, balance?: number): string | undefined {
  const l = simLinks.get(reference)
  if (!l) return undefined
  const done =
    l.state === 'paid' ? 'Paid. Kolo has ticked you in the group.'
    : l.state === 'failed' ? 'Payment failed. Nothing was taken. You can try again.'
    : l.state === 'underpaid' ? 'Underpaid. Kolo has told you what is left to send.'
    : ''
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kolo Test Checkout</title>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@700;800&family=Plus+Jakarta+Sans:wght@500;600;700&display=swap" rel="stylesheet">
<style>
  :root { --ink:#2a1418; --muted:#7a5a60; --bg:#fff7f8; --card:#fff; --line:#f3d5da; --pink:#e8506a; --ok:#1f8a4c; --bad:#c0392b; color-scheme: light; }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--ink); font:500 16px/1.5 "Plus Jakarta Sans", system-ui, sans-serif; }
  main { max-width:420px; margin:0 auto; padding:24px 16px; }
  .tag { display:inline-block; font-size:12px; font-weight:600; color:var(--pink); background:#fde8ec; padding:3px 10px; border-radius:99px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:20px; padding:22px; margin-top:14px; box-shadow:0 10px 30px -18px rgba(232,80,106,.45); }
  h1 { font:800 22px "Bricolage Grotesque", system-ui, sans-serif; margin:10px 0 2px; }
  .amount { font:800 40px "Bricolage Grotesque", system-ui, sans-serif; letter-spacing:-.02em; margin:6px 0; }
  .muted { color:var(--muted); font-size:14px; }
  button { width:100%; border:0; border-radius:14px; padding:14px; font:inherit; font-weight:650; margin-top:10px; cursor:pointer; }
  .ok { background:var(--pink); color:#fff; } .half { background:#fde8ec; color:var(--ink); } .no { background:#f4f1f2; color:var(--muted); }
  #done { font-weight:600; margin-top:14px; }
</style></head>
<body><main>
  <span class="tag">Test checkout · no real money</span>
  <div class="card">
    <div class="muted">Kolo payment for ${esc(l.name)}</div>
    <h1>${esc(l.title)}</h1>
    <div class="amount">${naira(l.naira)}</div>
    <div class="muted">Pays in USDT or BTC through Roqqu in the live version. Roqqu's sandbox is unavailable, so this page plays its part.</div>
    <div id="buttons"${l.state === 'paid' ? ' hidden' : ''}>
      ${balance !== undefined && balance >= l.naira ? `<button class="ok" data-r="balance">Pay from my Kolo balance (${naira(balance)})</button><div class="muted" style="margin-top:14px">Or test a Roqqu crypto payment:</div>` : ''}
      <button class="${balance !== undefined && balance >= l.naira ? 'half' : 'ok'}" data-r="completed">Completed</button>
      <button class="half" data-r="underpaid">Underpaid (send half)</button>
      <button class="no" data-r="failed">Failed</button>
    </div>
    <p id="done">${done}</p>
  </div>
</main>
<script>
  document.querySelectorAll('[data-r]').forEach((b) => b.onclick = async () => {
    document.querySelectorAll('[data-r]').forEach((x) => x.disabled = true)
    const res = await fetch(location.pathname, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ result: b.dataset.r }) })
    if (res.ok) return location.reload()
    document.getElementById('done').textContent = (await res.json().catch(() => ({}))).error || 'That did not work. Try again.'
    document.querySelectorAll('[data-r]').forEach((x) => x.disabled = false)
  })
</script>
</body></html>`
}
