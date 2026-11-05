// Kolo's public landing page, served at the root of KOLO_URL: what Kolo is, how it works,
// and how to start. Fonts are Roqqu's (Encode Sans for headings, Inter for text).
const KOLO_NUMBER = '+234 904 837 8261'

export const landingPage = (walletUrl: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kolo · Money in your group chat</title>
<meta name="description" content="Kolo is a WhatsApp bot that collects, tracks and spends group money, built on Roqqu.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Encode+Sans:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root { color-scheme: light; --ink:#2a141c; --muted:#6b5258; --bg:#fffafb; --tint:#fff0f3; --card:#fff; --line:#f6e4e8; --rose:#f2486e; --rose-top:#ff6f91; --rose-deep:#c92d55; --wa:#e7f6df; --wa-ink:#1d3b1f; }
  * { box-sizing: border-box }
  html { scroll-behavior: smooth }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 400 17px/1.6 "Inter", system-ui, sans-serif; }
  h1, h2, h3, .brand { font-family: "Encode Sans", system-ui, sans-serif; letter-spacing: -.02em; margin: 0; }
  a { color: inherit }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 0 20px; }
  .eyebrow { font-weight: 700; font-size: 13px; letter-spacing: .12em; text-transform: uppercase; color: var(--rose-deep); }
  .muted { color: var(--muted) }

  nav { position: sticky; top: 0; z-index: 5; background: rgba(255,250,251,.88); backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); }
  nav .wrap { display: flex; align-items: center; justify-content: space-between; height: 64px; }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 22px; text-decoration: none; }
  .links { display: flex; gap: 24px; font-weight: 600; font-size: 15px; }
  .links a { text-decoration: none; color: var(--muted) }
  .links a:hover { color: var(--ink) }

  .btn { display: inline-flex; align-items: center; gap: 8px; border-radius: 16px; padding: 14px 22px; font: 700 16px "Inter", sans-serif; text-decoration: none; border: 0; cursor: pointer; }
  .btn-main { background: linear-gradient(180deg, var(--rose-top), var(--rose)); color: #fff; box-shadow: 0 14px 30px -14px rgba(242,72,110,.7); }
  .btn-alt { background: var(--card); color: var(--rose-deep); border: 1.5px solid var(--line); }

  .hero { background: radial-gradient(circle at 10% 0%, #ffe3ea, var(--bg) 55%); }
  .hero .wrap { display: grid; grid-template-columns: 1.1fr .9fr; gap: 56px; align-items: center; padding-top: 72px; padding-bottom: 88px; }
  .hero h1 { font-size: clamp(42px, 6vw, 72px); font-weight: 800; line-height: 1.02; margin: 14px 0 18px; }
  .hero p.lead { font-size: 20px; color: var(--muted); max-width: 540px; margin: 0 0 28px; }
  .ctas { display: flex; flex-wrap: wrap; gap: 12px; }
  .pills { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 26px; }
  .pill { background: var(--card); border: 1px solid var(--line); border-radius: 99px; padding: 6px 14px; font-size: 14px; font-weight: 600; }

  .phone { background: #fff; border-radius: 32px; padding: 14px; box-shadow: 0 40px 80px -40px rgba(120,20,50,.45); border: 1px solid var(--line); max-width: 420px; justify-self: end; width: 100%; }
  .chat-head { display: flex; align-items: center; gap: 10px; padding: 8px 8px 12px; border-bottom: 1px solid #eef0ec; }
  .avatar { width: 38px; height: 38px; border-radius: 50%; background: var(--tint); display: grid; place-items: center; font-size: 20px; }
  .chat-head b { display: block; font-size: 15px } .chat-head small { color: #7a8a7a; font-size: 12px }
  .chat { background: #f4efe7; border-radius: 18px; padding: 14px 12px; margin-top: 12px; display: flex; flex-direction: column; gap: 8px; font-size: 14px; line-height: 1.45; }
  .msg { max-width: 86%; padding: 8px 12px; border-radius: 14px; background: #fff; }
  .msg .who { display: block; font-weight: 700; font-size: 12px; color: #c26a00; }
  .msg.me { align-self: flex-end; background: var(--wa); color: var(--wa-ink); }
  .msg.kolo .who { color: var(--rose-deep) }
  .card { margin-top: 6px; border-radius: 12px; background: linear-gradient(135deg, var(--rose-top), var(--rose-deep)); color: #fff; padding: 12px; }
  .card .bar { height: 8px; border-radius: 99px; background: rgba(255,255,255,.35); margin: 8px 0 4px; overflow: hidden }
  .card .bar i { display: block; height: 100%; width: 66%; background: #fff; border-radius: 99px }

  section { padding: 88px 0; }
  section.tinted { background: var(--tint); }
  .head { max-width: 720px; margin-bottom: 40px; }
  .head h2 { font-size: clamp(32px, 4vw, 46px); font-weight: 800; line-height: 1.08; margin-top: 10px; }
  .head p { font-size: 19px; color: var(--muted); margin: 14px 0 0; }

  .grid { display: grid; gap: 20px; }
  .g3 { grid-template-columns: repeat(3, 1fr) } .g4 { grid-template-columns: repeat(4, 1fr) } .g5 { grid-template-columns: repeat(5, 1fr) } .g2 { grid-template-columns: 1fr 1fr }
  .box { background: var(--card); border: 1px solid var(--line); border-radius: 24px; padding: 28px; box-shadow: 0 24px 48px -36px rgba(242,72,110,.45); }
  .box h3 { font-size: 22px; font-weight: 800; margin: 12px 0 8px; }
  .box p { margin: 0; color: var(--muted); font-size: 16px; }
  .big { font-family: "Encode Sans", sans-serif; font-weight: 800; font-size: 44px; line-height: 1; color: var(--rose); }
  .icon { font-size: 30px; }
  .step .n { width: 40px; height: 40px; border-radius: 12px; background: var(--rose); color: #fff; display: grid; place-items: center; font: 800 18px "Encode Sans", sans-serif; }
  .step.last { background: linear-gradient(180deg, var(--rose-top), var(--rose)); color: #fff; border: 0; }
  .step.last p { color: #ffe9ef } .step.last .n { background: #fff; color: var(--rose-deep); }

  .flow { display: flex; align-items: stretch; gap: 12px; }
  .flow .box { flex: 1; }
  .arrow { align-self: center; color: var(--rose); font-size: 26px; font-weight: 800; }
  .flow .box.hold { border: 2px solid var(--rose); }

  table { width: 100%; border-collapse: collapse; font-size: 16px; }
  th, td { text-align: left; padding: 14px 16px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
  code { font: 600 15px ui-monospace, "Cascadia Code", Consolas, monospace; background: var(--tint); color: var(--rose-deep); padding: 2px 8px; border-radius: 8px; white-space: nowrap; }
  .table { background: var(--card); border: 1px solid var(--line); border-radius: 24px; overflow: hidden; }
  .table tr:last-child td { border-bottom: 0 }

  .roqqu { display: grid; grid-template-columns: .9fr 1.1fr; gap: 48px; align-items: center; }
  .cta { text-align: center; background: linear-gradient(135deg, #d93a62, #8c1a3a); color: #fff8f9; border-radius: 32px; padding: 64px 24px; }
  .cta h2 { font-size: clamp(32px, 4.4vw, 52px); font-weight: 800; line-height: 1.05; }
  .cta p { font-size: 19px; color: #ffe3ea; margin: 14px auto 28px; max-width: 560px; }
  .cta .btn-main { background: #fff; color: var(--rose-deep); box-shadow: none; }
  .cta .btn-alt { background: transparent; color: #fff; border-color: rgba(255,255,255,.5); }
  .cta .ctas { justify-content: center }
  footer { padding: 36px 0 48px; color: var(--muted); font-size: 14px; }
  footer .wrap { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; }

  @media (max-width: 900px) {
    .hero .wrap, .roqqu { grid-template-columns: 1fr; gap: 40px; }
    .phone { justify-self: stretch; max-width: none; }
    .g4, .g5 { grid-template-columns: 1fr 1fr } .g3 { grid-template-columns: 1fr }
    .flow { flex-direction: column } .arrow { transform: rotate(90deg) }
    .links { display: none }
  }
  @media (max-width: 560px) {
    .g4, .g5, .g2 { grid-template-columns: 1fr }
    section { padding: 64px 0 } .hero .wrap { padding-top: 40px; padding-bottom: 56px; }
    .btn { width: 100%; justify-content: center; }
    th, td { padding: 12px; } code { white-space: normal; }
  }
</style></head>
<body>
<nav><div class="wrap">
  <a class="brand" href="#top">🐷 Kolo</a>
  <div class="links"><a href="#how">How it works</a><a href="#safe">Safety</a><a href="#start">Get started</a><a href="#roqqu">Roqqu</a></div>
</div></nav>

<header class="hero" id="top"><div class="wrap">
  <div>
    <span class="eyebrow">WhatsApp · Built on Roqqu</span>
    <h1>Money in your group chat.</h1>
    <p class="lead">Kolo is a WhatsApp bot that collects, tracks and spends group money, so the class rep never has to be the bank again.</p>
    <div class="ctas">
      <a class="btn btn-main" href="#start">Add Kolo to your group</a>
      <a class="btn btn-alt" href="#how">See how it works</a>
    </div>
    <div class="pills"><span class="pill">No app to install</span><span class="pill">Any language</span><span class="pill">Works on USSD</span><span class="pill">Group votes on spending</span></div>
  </div>
  <div class="phone" aria-label="A WhatsApp group chat where Kolo collects dues">
    <div class="chat-head"><span class="avatar">👥</span><div><b>CSC 300 Level</b><small>Ada, Tobi, Chidi, Kolo and 56 others</small></div></div>
    <div class="chat">
      <div class="msg me">Kolo, everybody drop 2k for the project 🙏</div>
      <div class="msg kolo"><span class="who">🐷 Kolo</span>Done. I've sent everyone a personal pay link. I'll tick you here the moment you pay.
        <div class="card"><b>Project dues · ₦2,000 each</b><div class="bar"><i></i></div><small>40 of 60 paid · ₦80,000 collected</small></div>
      </div>
      <div class="msg"><span class="who">Tobi</span>Paid 😎</div>
      <div class="msg kolo"><span class="who">🐷 Kolo</span>✅ Tobi has paid. 19 to go.</div>
    </div>
  </div>
</div></header>

<section id="problem"><div class="wrap">
  <div class="head"><span class="eyebrow">The problem</span><h2>Every group has an unpaid, unaudited bank: the class rep.</h2></div>
  <div class="grid g4">
    <div class="box"><div class="big">60</div><h3>separate transfers</h3><p>Each one checked against a screenshot, by hand.</p></div>
    <div class="box"><div class="big">Weeks</div><h3>of chasing people</h3><p>“I don pay” on trust, and reminders nobody reads.</p></div>
    <div class="box"><div class="big">1</div><h3>personal account</h3><p>Everyone’s money mixed with one person’s own.</p></div>
    <div class="box"><div class="big">?</div><h3>“Where the money go?”</h3><p>No record, no proof, and a fight at the end.</p></div>
  </div>
  <p class="muted" style="margin-top:24px">Same story in fellowships, associations, trips, ajo and esusu, and every shared bill.</p>
</div></section>

<section class="tinted" id="how"><div class="wrap">
  <div class="head"><span class="eyebrow">How it works</span><h2>From one message to a paid-up group.</h2><p>Kolo sits in your WhatsApp group like any member. Talk to it normally; it does the counting.</p></div>
  <div class="grid g5">
    <div class="box step"><div class="n">1</div><h3>Ask</h3><p>“Kolo, everybody drop 2k for project.”</p></div>
    <div class="box step"><div class="n">2</div><h3>Pay</h3><p>Everyone gets a private pay link, priced in naira.</p></div>
    <div class="box step"><div class="n">3</div><h3>Tick</h3><p>Kolo ticks each person in the group when Roqqu confirms.</p></div>
    <div class="box step"><div class="n">4</div><h3>Vote</h3><p>Spending the group pot needs a group vote.</p></div>
    <div class="box step last"><div class="n">5</div><h3>Receipt</h3><p>Yes wins, Roqqu pays out, everyone sees the receipt.</p></div>
  </div>
</div></section>

<section id="features"><div class="wrap">
  <div class="head"><span class="eyebrow">What Kolo does</span><h2>Everything a group does with money.</h2></div>
  <div class="grid g3">
    <div class="box"><div class="icon">📥</div><h3>Collect dues</h3><p>Personal pay links, automatic ticks and a live progress card. Late payers still reach the pot.</p></div>
    <div class="box"><div class="icon">🧾</div><h3>Split bills</h3><p>“Kolo split 9k between me, Ada and Tobi.” Everyone gets a link for their share.</p></div>
    <div class="box"><div class="icon">🗳️</div><h3>Vote to spend</h3><p>Money leaves the group pot only when the group says yes, with a receipt for all.</p></div>
    <div class="box"><div class="icon">🔔</div><h3>Remind and track</h3><p>See who has paid, and nudge the rest without being the bad guy.</p></div>
    <div class="box"><div class="icon">👛</div><h3>Your own wallet</h3><p>Top up, send to a member, cash out, and pay dues from your balance.</p></div>
    <div class="box"><div class="icon">📱</div><h3>A web menu</h3><p>Prefer tapping to typing? <code>/app</code> sends you a private menu link.</p></div>
  </div>
</div></section>

<section class="tinted" id="safe"><div class="wrap">
  <div class="head"><span class="eyebrow">Where the money goes</span><h2>Kolo never holds your money or your keys.</h2><p>Kolo is the software in between. Roqqu, a licensed company, holds the funds.</p></div>
  <div class="flow">
    <div class="box"><h3>Your phone</h3><p>Pay from any wallet or exchange.</p></div>
    <span class="arrow">→</span>
    <div class="box"><h3>Roqqu checkout</h3><p>Priced in naira.</p></div>
    <span class="arrow">→</span>
    <div class="box hold"><h3>Your group’s account</h3><p>Separate for every group. Never one shared pool.</p></div>
    <span class="arrow">→</span>
    <div class="box"><h3>Out only by vote</h3><p>Or to your own wallet.</p></div>
  </div>
  <div class="grid g3" style="margin-top:20px">
    <div class="box"><div class="icon">🔑</div><h3>Your fingerprint is the key</h3><p>No password, no seed phrase. Your wallet opens with your fingerprint or face.</p></div>
    <div class="box"><div class="icon">⛓️</div><h3>A daily limit Kolo can’t break</h3><p>You set it, and the blockchain enforces it. Even Kolo can’t spend past it.</p></div>
    <div class="box"><div class="icon">🤫</div><h3>Only listens when you call it</h3><p>Kolo answers messages meant for it and ignores the rest of your chat.</p></div>
  </div>
</div></section>

<section id="everyone"><div class="wrap">
  <div class="head"><span class="eyebrow">Built for Nigerian groups</span><h2>Nobody gets left out of the group money.</h2></div>
  <div class="grid g3">
    <div class="box"><div class="icon">💬</div><h3>Any language</h3><p>English, Pidgin, Igbo, Yoruba, Hausa and more. Kolo replies in yours.</p></div>
    <div class="box"><div class="icon">📶</div><h3>No data needed</h3><p>Dial USSD and pay with your PIN; the WhatsApp group sees it instantly. <a href="/ussd">Try the USSD demo</a>.</p></div>
    <div class="box"><div class="icon">➕</div><h3>Nothing to install</h3><p>Add Kolo’s number to the group like any member. That’s the whole setup.</p></div>
  </div>
</div></section>

<section class="tinted" id="start"><div class="wrap">
  <div class="head"><span class="eyebrow">Get started</span><h2>Three steps, about a minute.</h2></div>
  <div class="grid g3">
    <div class="box step"><div class="n">1</div><h3>Add Kolo</h3><p>Save <b>${KOLO_NUMBER}</b> and add it to your WhatsApp group.</p></div>
    <div class="box step"><div class="n">2</div><h3>Say hi</h3><p>Type <code>/menu</code> to see everything Kolo can do, or just talk to it.</p></div>
    <div class="box step"><div class="n">3</div><h3>Get your wallet</h3><p>Type <code>/join</code>. Kolo DMs you a link; your fingerprint makes your wallet.</p></div>
  </div>
  <div class="table" style="margin-top:28px"><table>
    <tr><th>Type this</th><th>What happens</th></tr>
    <tr><td><code>/dues 2k Class dues</code></td><td>Everyone gets a private pay link, and a progress card appears.</td></tr>
    <tr><td><code>/status</code> · <code>/remind</code></td><td>See who has paid, and nudge the rest.</td></tr>
    <tr><td><code>/split 9k me @Ada @Tobi</code></td><td>Share a bill; everyone pays their part.</td></tr>
    <tr><td><code>/spend 3k @Ada projector</code></td><td>The group votes; if yes wins, Kolo pays and posts a receipt.</td></tr>
    <tr><td><code>/topup 5k</code> · <code>/send @Ada 1k</code> · <code>/cashout 2k</code></td><td>Your own balance, answered privately.</td></tr>
    <tr><td><code>/app</code></td><td>A private web menu for everything above.</td></tr>
  </table></div>
  <p class="muted" style="margin-top:18px">Already have a Kolo wallet? <a href="${walletUrl}">Open it with your fingerprint</a>.</p>
</div></section>

<section id="roqqu"><div class="wrap roqqu">
  <div class="head" style="margin:0"><span class="eyebrow">Built on Roqqu</span><h2>Every member of every group becomes a Roqqu user.</h2><p>No app to download. They pay a Roqqu link inside a chat they already use.</p></div>
  <div class="table"><table>
    <tr><th>Roqqu</th><th>What Kolo does with it</th></tr>
    <tr><td>Payment links</td><td>A pay link per member, priced in naira</td></tr>
    <tr><td>Deposits</td><td>Ticks payers in the group automatically</td></tr>
    <tr><td>Customer wallets</td><td>Each group’s own account</td></tr>
    <tr><td>Send</td><td>Pays out approved votes and cash-outs</td></tr>
    <tr><td>Rates</td><td>Live naira prices</td></tr>
  </table></div>
</div></section>

<section style="padding-top:0"><div class="wrap">
  <div class="cta">
    <h2>Stop being the group’s bank.</h2>
    <p>Add Kolo to your WhatsApp group: <b>${KOLO_NUMBER}</b></p>
    <div class="ctas"><a class="btn btn-main" href="#start">Get started</a><a class="btn btn-alt" href="/ussd">Try the USSD demo</a></div>
  </div>
</div></section>

<footer><div class="wrap">
  <span>🐷 Kolo · money in your group chat</span>
  <span>Kenechukwu Okoye · Ikenna Excel Ikueze · Clinton · Anambra Web3 Conference 3.0</span>
</div></footer>
</body></html>`
