// Kolo's web menu: everything Kolo does in the group, with taps. Opened from the private
// link /app DMs (KOLO_URL/app/<token>); the token says who you are and which group.
// What you do here is posted in the group like normal, so the group always sees it.
import { icon } from './icons.js'
import { FAVICON, LOGO_SPRITE, logo } from './logo.js'

export const APP_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kolo Menu</title>
${FAVICON}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Encode+Sans:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root { color-scheme: light; --ink:#2a141c; --muted:#7d5a66; --bg:#fff6f8; --card:#fff; --line:#f6d9e1; --rose:#f2486e; --rose-top:#ff6f91; --rose-deep:#c92d55; --tint:#ffe9ef; --ok:#1f8a4c; }
  * { box-sizing: border-box }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 500 16px/1.5 "Inter", system-ui, sans-serif; }
  main { max-width: 460px; margin: 0 auto; padding: 18px 16px 40px; }
  .top { display: flex; align-items: center; justify-content: space-between; }
  .brand { font: 800 20px "Encode Sans", system-ui, sans-serif; display: flex; gap: 8px; align-items: center; }
  .group { font-size: 14px; color: var(--muted); font-weight: 600; }
  h1 { font: 800 26px/1.15 "Encode Sans", system-ui, sans-serif; margin: 18px 0 12px; }
  .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .stat { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 14px; }
  .label { font-size: 13px; color: var(--muted); font-weight: 600; }
  .num { font: 800 24px "Encode Sans", system-ui, sans-serif; }
  .dues { margin-top: 10px; background: linear-gradient(180deg, var(--rose-top), var(--rose)); color: #fff; border-radius: 20px; padding: 16px; }
  .dues .label { color: #ffe3ea; }
  .dues button { margin-top: 10px; background: #fff; color: var(--rose-deep); }
  .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 18px; }
  .tile { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 14px 6px; text-align: center; font: 700 14px "Inter", sans-serif; color: var(--ink); cursor: pointer; }
  .tile b { display: block; font-size: 24px; margin-bottom: 4px; }
  .tile[aria-pressed="true"] { border-color: var(--rose); background: var(--tint); }
  .panel { background: var(--card); border: 1px solid var(--line); border-radius: 20px; padding: 16px; margin-top: 14px; }
  .panel h2 { font: 800 18px "Encode Sans", sans-serif; margin: 0 0 4px; }
  .field { width: 100%; border: 1.5px solid var(--line); border-radius: 14px; padding: 12px 14px; font: inherit; margin-top: 10px; background: #fff; }
  .people { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .person { border: 1.5px solid var(--line); border-radius: 99px; padding: 7px 14px; background: #fff; font: 600 14px inherit; cursor: pointer; }
  .person[aria-pressed="true"] { background: var(--rose); border-color: var(--rose); color: #fff; }
  button.go { width: 100%; border: 0; border-radius: 16px; padding: 14px; font: 700 16px "Inter", sans-serif; background: linear-gradient(180deg, var(--rose-top), var(--rose)); color: #fff; margin-top: 12px; cursor: pointer; }
  button.go:disabled { opacity: .6; }
  .reply { white-space: pre-wrap; background: var(--tint); border-radius: 16px; padding: 12px 14px; margin-top: 12px; font-size: 15px; }
  .muted { color: var(--muted); font-size: 14px; }
  .hint { margin-top: 18px; text-align: center; }
  [hidden] { display: none !important; }
  .tile .ti { display: block; width: 28px; height: 28px; margin: 2px auto 6px; color: var(--rose-deep); }
  .right { display: flex; align-items: center; gap: 10px; }
  .out { display: inline-flex; align-items: center; gap: 6px; border: 1.5px solid var(--line); background: var(--card); color: var(--ink); border-radius: 12px; padding: 7px 11px; font: 700 14px "Inter", sans-serif; cursor: pointer; }
  .out .ic { width: 17px; height: 17px; }
  .bye { text-align: center; padding: 40px 8px; }
  .bye a { display: flex; align-items: center; justify-content: center; gap: 8px; text-decoration: none; border-radius: 16px; padding: 14px; margin-top: 18px; font: 700 16px "Inter", sans-serif; color: #fff; background: linear-gradient(180deg, var(--rose-top), var(--rose)); }
  .bye .ic { width: 20px; height: 20px; }
</style></head>
<body>${LOGO_SPRITE}<main>
  <div class="top"><div class="brand">${logo(30)}Kolo</div><div class="right"><div class="group" id="group"></div><button class="out" id="logout">${icon('log-out')}Log out</button></div></div>
  <div class="bye" id="bye" hidden>
    <h1>You're logged out</h1>
    <p class="muted">This menu link no longer works, even if someone else has it. To come back, send <b>/app</b> to Kolo on WhatsApp and you'll get a fresh private link.</p>
    <a class="go" id="back" href="https://wa.me/">${icon('message-circle')}Open Kolo on WhatsApp</a>
  </div>
  <div id="menu">
  <h1 id="hello">Loading…</h1>
  <div class="stats">
    <div class="stat"><div class="label">Your Kolo balance</div><div class="num" id="bal">₦0</div></div>
    <div class="stat"><div class="label">Group pot</div><div class="num" id="pot">₦0</div></div>
  </div>
  <div class="dues" id="dues" hidden>
    <div class="label" id="dues-label"></div>
    <div class="num" id="dues-title"></div>
    <button class="go" id="paydues">Pay from my Kolo balance</button>
  </div>
  <div class="tiles" id="tiles"></div>
  <div class="panel" id="panel" hidden>
    <h2 id="p-title"></h2>
    <div class="muted" id="p-help"></div>
    <input class="field" id="p-amount" inputmode="numeric" placeholder="Amount in naira, e.g. 2000">
    <input class="field" id="p-text" placeholder="">
    <div class="people" id="p-people"></div>
    <button class="go" id="p-go">Do it</button>
  </div>
  <div class="reply" id="reply" hidden></div>
  <p class="muted hint">This link is only for you and works for 30 minutes. Everything you do here also shows in the group.</p>
  </div>
</main>
<script>
  const $ = (id) => document.getElementById(id)
  const naira = (n) => '₦' + Number(n).toLocaleString('en-NG')
  const base = location.pathname.replace(/\\/$/, '')
  // need: which inputs the action takes. people: 'many' | 'one'.
  const ACTIONS = [
    { id: 'topup', icon: '${icon('circle-plus', 'ti')}', name: 'Top up', help: 'Get a pay link that adds money to your Kolo balance.', amount: true },
    { id: 'send', icon: '${icon('send', 'ti')}', name: 'Send', help: 'Send money from your Kolo balance to someone in the group.', amount: true, people: 'many' },
    { id: 'split', icon: '${icon('receipt', 'ti')}', name: 'Split a bill', help: 'You paid for something shared. Pick who shared it; each gets a link to pay you back.', amount: true, people: 'many' },
    { id: 'spend', icon: '${icon('landmark', 'ti')}', name: 'Spend pot', help: 'Pay someone from the group pot. The group votes first.', amount: true, people: 'one', text: 'What is it for? e.g. projector' },
    { id: 'cashout', icon: '${icon('banknote', 'ti')}', name: 'Cash out', help: 'Move money from your Kolo balance to your own wallet.', amount: true },
    { id: 'dues', icon: '${icon('hand-coins', 'ti')}', name: 'Start dues', help: 'Everyone in the group pays the same amount. Each gets their own pay link.', amount: true, text: 'What is it for? e.g. Class dues' },
    { id: 'poll', icon: '${icon('vote', 'ti')}', name: 'Group vote', help: 'Start a yes/no vote in the group.', text: 'The question, e.g. Should we buy a projector?' },
    { id: 'remind', icon: '${icon('bell-ring', 'ti')}', name: 'Remind', help: 'Tag everyone who has not paid the current dues.' },
    { id: 'status', icon: '${icon('list-checks', 'ti')}', name: 'Who paid', help: 'See who has paid and who has not.' },
    { id: 'limit', icon: '${icon('gauge', 'ti')}', name: 'My limit', help: "How much of your wallet's daily limit is left today." },
    { id: 'close', icon: '${icon('circle-check', 'ti')}', name: 'Close dues', help: 'Organiser only: end the current collection.' },
    { id: 'balance', icon: '${icon('wallet', 'ti')}', name: 'Balance', help: 'Your Kolo balance.' },
  ]
  let state, current, picked = new Set()

  async function load() {
    const res = await fetch(base + '/state')
    if (!res.ok) { $('hello').textContent = 'This link has expired.'; document.querySelector('.stats').hidden = true; $('logout').hidden = true; $('tiles').innerHTML = '<p class="muted" style="grid-column:1/-1">Type /app in your group and Kolo will DM you a fresh one.</p>'; return }
    state = await res.json()
    $('group').textContent = state.group
    $('hello').textContent = 'Hi ' + state.name.split(' ')[0] + ', what do you want to do?'
    $('bal').textContent = naira(state.balance)
    $('pot').textContent = naira(state.pot)
    const d = state.dues
    $('dues').hidden = !(d && d.youOwe)
    if (d && d.youOwe) {
      $('dues-label').textContent = 'You owe for ' + d.title + ' · ' + d.paid + ' of ' + d.of + ' paid'
      $('dues-title').textContent = naira(d.amount)
      $('paydues').disabled = state.balance < d.amount
      $('paydues').textContent = state.balance < d.amount ? 'Top up first to pay from balance' : 'Pay ' + naira(d.amount) + ' from my Kolo balance'
    }
  }

  function open(a) {
    current = a; picked = new Set()
    document.querySelectorAll('.tile').forEach((t) => t.setAttribute('aria-pressed', t.dataset.id === a.id))
    $('panel').hidden = false
    $('p-title').textContent = a.name
    $('p-help').textContent = a.help
    $('p-amount').hidden = !a.amount; $('p-amount').value = ''
    $('p-text').hidden = !a.text; $('p-text').placeholder = a.text || ''; $('p-text').value = ''
    $('p-people').hidden = !a.people
    $('p-people').innerHTML = ''
    for (const m of state.members) {
      const b = Object.assign(document.createElement('button'), { className: 'person', textContent: m.name })
      b.setAttribute('aria-pressed', 'false')
      b.onclick = () => {
        if (a.people === 'one') { picked = new Set(); document.querySelectorAll('.person').forEach((x) => x.setAttribute('aria-pressed', 'false')) }
        picked.has(m.id) ? picked.delete(m.id) : picked.add(m.id)
        b.setAttribute('aria-pressed', picked.has(m.id))
      }
      $('p-people').append(b)
    }
    $('p-go').textContent = a.amount || a.text || a.people ? 'Do it' : 'Show me'
    $('panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  async function run(body, button) {
    button.disabled = true
    try {
      const res = await fetch(base + '/do', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json()
      $('reply').hidden = false
      $('reply').textContent = res.ok ? json.replies.join('\\n\\n') || 'Done.' : json.error
      $('reply').scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      await load()
    } finally { button.disabled = false }
  }

  $('p-go').onclick = () => {
    const amount = $('p-amount').value.trim()
    if (current.amount && !amount) return $('p-amount').focus()
    if (current.people && !picked.size) { $('reply').hidden = false; $('reply').textContent = 'Pick who, above.'; return }
    run({ action: current.id, amount, text: $('p-text').value.trim(), people: [...picked] }, $('p-go'))
  }
  $('paydues').onclick = () => run({ action: 'paydues' }, $('paydues'))

  // Log out: the server forgets this link, so it stops working everywhere.
  function loggedOut(number) {
    $('menu').hidden = true
    $('logout').hidden = true
    $('bye').hidden = false
    if (number) $('back').href = 'https://wa.me/' + number
  }
  $('logout').onclick = async () => {
    $('logout').disabled = true
    try {
      const res = await fetch(base + '/logout', { method: 'POST' })
      loggedOut((await res.json()).kolo || (state && state.kolo))
    } catch { $('logout').disabled = false }
  }

  for (const a of ACTIONS) {
    const t = Object.assign(document.createElement('button'), { className: 'tile', innerHTML: a.icon + a.name })
    t.dataset.id = a.id
    t.onclick = () => open(a)
    $('tiles').append(t)
  }
  load()
</script>
</body></html>`
