// Kolo's public landing page, served at the root of KOLO_URL: what Kolo is, how it works,
// and how to start. Fonts are Roqqu's (Encode Sans for headings, Inter for text); icons are Lucide.
import { icon, type IconName } from './icons.js'
import { FAVICON, LOGO_SPRITE, animatedLogo, logo } from './logo.js'

const KOLO_NUMBER = '+234 904 837 8261'

const box = (name: IconName, title: string, text: string) =>
  `<div class="box"><span class="badge">${icon(name)}</span><h3>${title}</h3><p>${text}</p></div>`

// A WhatsApp group chat (Android, light mode) with Kolo collecting dues.
const time = (t: string, read = false) =>
  `<span class="t">${t}${read ? `<svg class="ticks" viewBox="0 0 16 11" aria-label="Read"><path d="M11.07.65 4.6 7.12 1.93 4.45.88 5.5 4.6 9.22l7.52-7.52zM15.12.65 8.65 7.12l-.83-.83-1.05 1.05 1.88 1.88 7.52-7.52z" fill="currentColor"/></svg>` : ''}</span>`

const WHATSAPP = `
<div class="phone" role="img" aria-label="A WhatsApp group chat where Kolo collects ₦2,000 project dues and ticks people as they pay">
  <div class="screen">
    <div class="sbar"><span>9:41</span><span class="sicons">${icon('signal', 'si')}${icon('wifi', 'si')}${icon('battery-full', 'si')}</span></div>
    <div class="wa-head">
      ${icon('arrow-left', 'hi')}
      <span class="gav">${icon('users', 'gi')}</span>
      <div class="gname"><b>CSC 300L Class</b><small>Ada, Chidi, Kolo, Tobi, You</small></div>
      ${icon('video', 'hi')}${icon('phone', 'hi')}${icon('ellipsis-vertical', 'hi')}
    </div>
    <div class="wa-body">
      <div class="day">Today</div>
      <div class="b out tail">Kolo, everybody drop 2k for the project ${time('10:02', true)}</div>
      <div class="b in tail kolo">
        <span class="who">Kolo</span>
        <div class="dues-img">
          <span class="dl">KOLO · DUES</span>
          <b>Project dues</b>
          <span class="ds">₦2,000 each</span>
          <span class="bar"><i></i></span>
          <b class="dp">41/60 paid</b>
          <span class="ds">₦82,000 collected</span>
        </div>
        <p><b>Kolo</b><br>Project dues started. I've sent everyone their own pay link in DM. I'll tick you here the moment Roqqu confirms your payment.</p>
        ${time('10:02')}
      </div>
      <div class="b in tail"><span class="who ada">Ada</span>Paid ✅ ${time('10:05')}</div>
      <div class="b in tail kolo"><span class="who">Kolo</span><p><b>Kolo</b><br>Ada has paid. 42 of 60 done, ₦84,000 in the group pot.</p>${time('10:05')}</div>
      <div class="b in tail"><span class="who tobi">Tobi</span>Kolo remind the rest abeg 😅 ${time('10:07')}</div>
    </div>
    <div class="wa-input">
      <div class="pill">${icon('smile', 'ii')}<span>Message</span>${icon('paperclip', 'ii')}${icon('camera', 'ii')}</div>
      <span class="mic">${icon('mic', 'mi')}</span>
    </div>
  </div>
</div>`

export const landingPage = (walletUrl: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kolo · Money in your group chat</title>
<meta name="description" content="Kolo is a WhatsApp bot that collects, tracks and spends group money, built on Roqqu.">
${FAVICON}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Encode+Sans:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root { color-scheme: light; --ink:#2a141c; --muted:#6b5258; --bg:#fffafb; --tint:#fff0f3; --card:#fff; --line:#f6e4e8; --rose:#f2486e; --rose-top:#ff6f91; --rose-deep:#c92d55; }
  * { box-sizing: border-box }
  html { scroll-behavior: smooth }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 400 17px/1.6 "Inter", system-ui, sans-serif; }
  h1, h2, h3, .brand { font-family: "Encode Sans", system-ui, sans-serif; letter-spacing: -.02em; margin: 0; }
  a { color: inherit }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 0 20px; }
  .eyebrow { font-weight: 700; font-size: 13px; letter-spacing: .12em; text-transform: uppercase; color: var(--rose-deep); }
  .muted { color: var(--muted) }
  .ic { width: 24px; height: 24px; flex: none; }

  nav { position: sticky; top: 0; z-index: 5; background: rgba(255,250,251,.88); backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); }
  nav .wrap { display: flex; align-items: center; justify-content: space-between; gap: 16px; height: 68px; }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 24px; text-decoration: none; }
  .links { display: flex; gap: 24px; font-weight: 600; font-size: 15px; }
  .links a { text-decoration: none; color: var(--muted) }
  .links a:hover { color: var(--ink) }
  .navbtn { display: inline-flex; align-items: center; gap: 8px; padding: 9px 16px; border-radius: 12px; border: 1.5px solid var(--line); background: var(--card); color: var(--rose-deep); font: 700 15px "Inter", sans-serif; text-decoration: none; }
  .navbtn .ic { width: 18px; height: 18px; }

  .btn { display: inline-flex; align-items: center; gap: 8px; border-radius: 16px; padding: 14px 22px; font: 700 16px "Inter", sans-serif; text-decoration: none; border: 0; cursor: pointer; }
  .btn .ic { width: 20px; height: 20px; }
  .btn-main { background: linear-gradient(180deg, var(--rose-top), var(--rose)); color: #fff; box-shadow: 0 14px 30px -14px rgba(242,72,110,.7); }
  .btn-alt { background: var(--card); color: var(--rose-deep); border: 1.5px solid var(--line); }

  .hero { background: radial-gradient(circle at 10% 0%, #ffe3ea, var(--bg) 55%); overflow: hidden; }
  .hero .wrap { display: grid; grid-template-columns: 1.1fr .9fr; gap: 48px; align-items: center; padding-top: 48px; padding-bottom: 80px; }
  .hero .wrap > *, .roqqu > * { min-width: 0; }
  .pig-anim { width: 150px; height: auto; display: block; margin: 0 0 4px -10px; overflow: visible; animation: bob 2.6s ease-in-out infinite; transform-origin: 50% 90%; }
  .pig-anim .logo-coin { animation: drop 2.6s cubic-bezier(.5, 0, .5, 1) infinite; }
  @keyframes drop { 0%, 12% { transform: translateY(-16px); opacity: 0; } 28% { opacity: 1; } 70% { transform: translateY(9px); opacity: 1; } 84%, 100% { transform: translateY(14px); opacity: 0; } }
  @keyframes bob { 0%, 62%, 100% { transform: scale(1); } 74% { transform: scale(1.04, .96); } }
  .hero h1 { font-size: clamp(42px, 6vw, 72px); font-weight: 800; line-height: 1.02; margin: 12px 0 18px; }
  .hero p.lead { font-size: 20px; color: var(--muted); max-width: 540px; margin: 0 0 28px; }
  .ctas { display: flex; flex-wrap: wrap; gap: 12px; }
  .pills { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 26px; }
  .pill-tag { display: inline-flex; align-items: center; gap: 6px; background: var(--card); border: 1px solid var(--line); border-radius: 99px; padding: 6px 14px 6px 10px; font-size: 14px; font-weight: 600; }
  .pill-tag .ic { width: 16px; height: 16px; color: var(--rose); stroke-width: 3; }

  /* ── WhatsApp (Android, light) ── */
  .phone { justify-self: end; width: 100%; max-width: 380px; padding: 11px; border-radius: 46px; background: #1b1b1f; box-shadow: 0 0 0 2px #3a3a40, 0 50px 90px -40px rgba(80,10,30,.55); }
  .screen { border-radius: 36px; overflow: hidden; background: #efeae2; display: flex; flex-direction: column; height: 680px; font-family: Roboto, "Segoe UI", system-ui, sans-serif; }
  .sbar { display: flex; justify-content: space-between; align-items: center; padding: 10px 22px 6px; background: #008069; color: #fff; font: 600 13px system-ui, sans-serif; }
  .sicons { display: flex; gap: 5px } .si { width: 15px; height: 15px; }
  .wa-head { display: flex; align-items: center; gap: 10px; padding: 6px 12px 10px 8px; background: #008069; color: #fff; }
  .hi { width: 21px; height: 21px; flex: none; }
  .gav { width: 38px; height: 38px; border-radius: 50%; background: #dfe5e7; color: #fff; display: grid; place-items: center; flex: none; background: linear-gradient(135deg, #ffb3c4, #f2486e); }
  .gi { width: 20px; height: 20px; }
  .gname { flex: 1; min-width: 0; line-height: 1.25; } .gname b { display: block; font-size: 16px; font-weight: 500; }
  .gname small { display: block; font-size: 12.5px; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .wa-head .hi + .hi { margin-left: 8px; }
  .wa-body { flex: 1; min-height: 0; padding: 10px 10px 6px; display: flex; flex-direction: column; justify-content: flex-end; gap: 3px; overflow: hidden;
    background-color: #efeae2;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' fill='none' stroke='%23e2dacd' stroke-width='1.4' stroke-linecap='round'%3E%3Ccircle cx='18' cy='20' r='7'/%3E%3Cpath d='M70 14l6 6-6 6-6-6z'/%3E%3Cpath d='M98 60c4-6 12-6 12 2 0 6-12 12-12 12s-12-6-12-12c0-8 8-8 12-2z'/%3E%3Cpath d='M20 70h16M28 62v16'/%3E%3Cpath d='M58 92a8 8 0 1 0 16 0'/%3E%3Cpath d='M100 104l8-8M8 104l6 6 8-12'/%3E%3C/svg%3E"); }
  .day { align-self: center; background: #fff; color: #54656f; font-size: 12px; padding: 4px 12px; border-radius: 8px; margin: 2px 0 8px; box-shadow: 0 1px .5px rgba(11,20,26,.13); }
  .b { position: relative; max-width: 84%; padding: 6px 9px 8px; border-radius: 7.5px; font-size: 14.2px; line-height: 1.38; color: #111b21; box-shadow: 0 1px .5px rgba(11,20,26,.13); margin-top: 6px; }
  .b p { margin: 0 }
  .b.in { align-self: flex-start; background: #fff; }
  .b.out { align-self: flex-end; background: #d9fdd3; }
  .b.in.tail { border-top-left-radius: 0; } .b.out.tail { border-top-right-radius: 0; }
  .b.in.tail::before, .b.out.tail::before { content: ""; position: absolute; top: 0; width: 8px; height: 13px; }
  .b.in.tail::before { left: -8px; background: #fff; clip-path: polygon(100% 0, 0 0, 100% 100%); }
  .b.out.tail::before { right: -8px; background: #d9fdd3; clip-path: polygon(0 0, 100% 0, 0 100%); }
  .who { display: block; font-size: 12.8px; font-weight: 500; color: #c92d55; margin-bottom: 2px; }
  .who.ada { color: #1f7aec } .who.tobi { color: #a5620a }
  .t { float: right; display: inline-flex; align-items: center; gap: 3px; margin: 6px 0 -4px 10px; font-size: 11px; color: #667781; }
  .ticks { width: 16px; height: 11px; color: #53bdeb; }
  .dues-img { display: grid; gap: 1px; border-radius: 6px; padding: 14px 16px; margin: 2px -5px 6px; color: #fff; background: linear-gradient(135deg, #ff6f91, #b8264c); }
  .dues-img .dl { font-size: 10px; letter-spacing: .14em; opacity: .85; }
  .dues-img b { font: 700 18px "Encode Sans", sans-serif; } .dues-img .dp { font-size: 22px; margin-top: 8px; }
  .dues-img .ds { font-size: 12px; opacity: .9; }
  .dues-img .bar { height: 7px; border-radius: 99px; background: rgba(255,255,255,.3); margin-top: 8px; overflow: hidden; }
  .dues-img .bar i { display: block; height: 100%; width: 68%; background: #fff; border-radius: 99px; }
  .wa-input { display: flex; align-items: center; gap: 6px; padding: 6px 6px 14px; }
  .wa-input .pill { flex: 1; display: flex; align-items: center; gap: 12px; background: #fff; border-radius: 24px; padding: 11px 14px; color: #8696a0; font-size: 15px; box-shadow: 0 1px .5px rgba(11,20,26,.13); }
  .wa-input .pill span { flex: 1 } .ii { width: 22px; height: 22px; }
  .mic { width: 48px; height: 48px; border-radius: 50%; background: #00a884; color: #fff; display: grid; place-items: center; flex: none; } .mi { width: 22px; height: 22px; }

  section { padding: 88px 0; }
  section.tinted { background: var(--tint); }
  .head { max-width: 720px; margin-bottom: 40px; }
  .head h2 { font-size: clamp(32px, 4vw, 46px); font-weight: 800; line-height: 1.08; margin-top: 10px; }
  .head p { font-size: 19px; color: var(--muted); margin: 14px 0 0; }

  .grid { display: grid; gap: 20px; }
  .g3 { grid-template-columns: repeat(3, 1fr) } .g4 { grid-template-columns: repeat(4, 1fr) } .g5 { grid-template-columns: repeat(5, 1fr) }
  .box { background: var(--card); border: 1px solid var(--line); border-radius: 24px; padding: 28px; box-shadow: 0 24px 48px -36px rgba(242,72,110,.45); }
  .box h3 { font-size: 22px; font-weight: 800; margin: 14px 0 8px; }
  .box p { margin: 0; color: var(--muted); font-size: 16px; }
  .badge { width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center; color: var(--rose-deep); background: linear-gradient(180deg, #fff, var(--tint)); border: 1px solid var(--line); }
  .big { font-family: "Encode Sans", sans-serif; font-weight: 800; font-size: 44px; line-height: 1; color: var(--rose); }
  .step .n { width: 40px; height: 40px; border-radius: 12px; background: var(--rose); color: #fff; display: grid; place-items: center; font: 800 18px "Encode Sans", sans-serif; }
  .step.last { background: linear-gradient(180deg, var(--rose-top), var(--rose)); color: #fff; border: 0; }
  .step.last p { color: #ffe9ef } .step.last .n { background: #fff; color: var(--rose-deep); }

  .flow { display: flex; align-items: stretch; gap: 12px; }
  .flow .box { flex: 1; }
  .arrow { align-self: center; color: var(--rose); }
  .flow .box.hold { border: 2px solid var(--rose); }

  table { width: 100%; border-collapse: collapse; font-size: 16px; }
  th, td { text-align: left; padding: 14px 16px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
  code { font: 600 15px ui-monospace, "Cascadia Code", Consolas, monospace; background: var(--tint); color: var(--rose-deep); padding: 2px 8px; border-radius: 8px; white-space: nowrap; }
  .table { background: var(--card); border: 1px solid var(--line); border-radius: 24px; overflow: hidden; }
  .table tr:last-child td { border-bottom: 0 }

  .roqqu { display: grid; grid-template-columns: .9fr 1.1fr; gap: 48px; align-items: center; }
  .cta { text-align: center; background: linear-gradient(135deg, #d93a62, #8c1a3a); color: #fff8f9; border-radius: 32px; padding: 56px 24px 64px; }
  .cta .pig-anim { margin: 0 auto 8px; width: 120px; }
  .cta h2 { font-size: clamp(32px, 4.4vw, 52px); font-weight: 800; line-height: 1.05; }
  .cta p { font-size: 19px; color: #ffe3ea; margin: 14px auto 28px; max-width: 560px; }
  .cta .btn-main { background: #fff; color: var(--rose-deep); box-shadow: none; }
  .cta .btn-alt { background: transparent; color: #fff; border-color: rgba(255,255,255,.5); }
  .cta .ctas { justify-content: center }
  footer { padding: 36px 0 48px; color: var(--muted); font-size: 14px; }
  footer .wrap { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px; }
  footer .brand { font-size: 16px; }

  @media (max-width: 900px) {
    .hero .wrap, .roqqu { grid-template-columns: 1fr; gap: 40px; }
    .phone { justify-self: center; }
    .g4, .g5 { grid-template-columns: 1fr 1fr } .g3 { grid-template-columns: 1fr }
    .flow { flex-direction: column } .arrow { transform: rotate(90deg) }
    .links { display: none }
  }
  @media (max-width: 560px) {
    .g4, .g5 { grid-template-columns: 1fr }
    section { padding: 64px 0 } .hero .wrap { padding-top: 28px; padding-bottom: 56px; }
    .pig-anim { width: 110px; }
    .btn { width: 100%; justify-content: center; }
    .screen { height: 620px; }
    th, td { padding: 12px; } code { white-space: normal; }
  }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; } }
</style></head>
<body>
${LOGO_SPRITE}
<nav><div class="wrap">
  <a class="brand" href="#top">${logo(36)}Kolo</a>
  <div class="links"><a href="#how">How it works</a><a href="#safe">Safety</a><a href="#start">Get started</a><a href="#roqqu">Roqqu</a></div>
  <a class="navbtn" href="${walletUrl}">${icon('fingerprint')}My wallet</a>
</div></nav>

<header class="hero" id="top"><div class="wrap">
  <div>
    ${animatedLogo()}
    <span class="eyebrow">WhatsApp · Built on Roqqu</span>
    <h1>Money in your group chat.</h1>
    <p class="lead">Kolo is a WhatsApp bot that collects, tracks and spends group money, so the class rep never has to be the bank again.</p>
    <div class="ctas">
      <a class="btn btn-main" href="#start">${icon('user-plus')}Add Kolo to your group</a>
      <a class="btn btn-alt" href="#how">See how it works</a>
    </div>
    <div class="pills">${['No app to install', 'Any language', 'Works on USSD', 'Group votes on spending'].map((p) => `<span class="pill-tag">${icon('check')}${p}</span>`).join('')}</div>
  </div>
  ${WHATSAPP}
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
    ${box('hand-coins', 'Collect dues', 'Personal pay links, automatic ticks and a live progress card. Late payers still reach the pot.')}
    ${box('receipt', 'Split bills', '“Kolo split 9k between me, Ada and Tobi.” Everyone gets a link for their share.')}
    ${box('vote', 'Vote to spend', 'Money leaves the group pot only when the group says yes, with a receipt for all.')}
    ${box('bell-ring', 'Remind and track', 'See who has paid, and nudge the rest without being the bad guy.')}
    ${box('wallet', 'Your own wallet and Kolo ID', 'Top up, cash out, and send to anyone by their Kolo ID, like <code>/send @ada 2k</code>.')}
    ${box('smartphone', 'A web menu', 'Prefer tapping to typing? <code>/app</code> sends you a private menu link.')}
  </div>
</div></section>

<section class="tinted" id="safe"><div class="wrap">
  <div class="head"><span class="eyebrow">Where the money goes</span><h2>Kolo never holds your money or your keys.</h2><p>Kolo is the software in between. Roqqu, a licensed company, holds the funds.</p></div>
  <div class="flow">
    <div class="box"><h3>Your phone</h3><p>Pay from any wallet or exchange.</p></div>
    <span class="arrow">${icon('arrow-right')}</span>
    <div class="box"><h3>Roqqu checkout</h3><p>Priced in naira.</p></div>
    <span class="arrow">${icon('arrow-right')}</span>
    <div class="box hold"><h3>Your group’s account</h3><p>Separate for every group. Never one shared pool.</p></div>
    <span class="arrow">${icon('arrow-right')}</span>
    <div class="box"><h3>Out only by vote</h3><p>Or to your own wallet.</p></div>
  </div>
  <div class="grid g3" style="margin-top:20px">
    ${box('fingerprint', 'Your fingerprint is the key', 'No password, no seed phrase. Your wallet opens with your fingerprint or face.')}
    ${box('shield-check', 'A daily limit Kolo can’t break', 'You set it, and the blockchain enforces it. Even Kolo can’t spend past it.')}
    ${box('ear', 'Only listens when you call it', 'Kolo answers messages meant for it and ignores the rest of your chat.')}
  </div>
</div></section>

<section id="everyone"><div class="wrap">
  <div class="head"><span class="eyebrow">Built for Nigerian groups</span><h2>Nobody gets left out of the group money.</h2></div>
  <div class="grid g3">
    ${box('languages', 'Any language', 'English, Pidgin, Igbo, Yoruba, Hausa and more. Kolo replies in yours.')}
    ${box('wifi-off', 'No data needed', 'Dial USSD and pay with your PIN; the WhatsApp group sees it instantly. <a href="/ussd">Try the USSD demo</a>.')}
    ${box('user-plus', 'Nothing to install', 'Add Kolo’s number to the group like any member. That’s the whole setup.')}
  </div>
</div></section>

<section class="tinted" id="start"><div class="wrap">
  <div class="head"><span class="eyebrow">Get started</span><h2>Three steps, about a minute.</h2></div>
  <div class="grid g3">
    <div class="box step"><div class="n">1</div><h3>Add Kolo</h3><p>Save <b>${KOLO_NUMBER}</b> and add it to your WhatsApp group.</p></div>
    <div class="box step"><div class="n">2</div><h3>Say hi</h3><p>Type <code>/menu</code> to see everything Kolo can do, or just talk to it.</p></div>
    <div class="box step"><div class="n">3</div><h3>Get your wallet</h3><p>Type <code>/join</code>. Your fingerprint makes your wallet, and your Roqqu username becomes your Kolo ID.</p></div>
  </div>
  <div class="table" style="margin-top:28px"><table>
    <tr><th>Type this</th><th>What happens</th></tr>
    <tr><td><code>/dues 2k Class dues</code></td><td>Everyone gets a private pay link, and a progress card appears.</td></tr>
    <tr><td><code>/status</code> · <code>/remind</code></td><td>See who has paid, and nudge the rest.</td></tr>
    <tr><td><code>/split 9k me @Ada @Tobi</code></td><td>Share a bill; everyone pays their part.</td></tr>
    <tr><td><code>/spend 3k @Ada projector</code></td><td>The group votes; if yes wins, Kolo pays and posts a receipt.</td></tr>
    <tr><td><code>/send @ada 1k</code> · <code>/id</code></td><td>Send to anyone by their Kolo ID, and see yours.</td></tr>
    <tr><td><code>/topup 5k</code> · <code>/cashout 2k</code></td><td>Your own balance, answered privately.</td></tr>
    <tr><td><code>/app</code></td><td>A private web menu for everything above.</td></tr>
  </table></div>
  <p class="muted" style="margin-top:18px">Already have a Kolo wallet? <a href="${walletUrl}">Log in with your fingerprint</a>.</p>
</div></section>

<section id="roqqu"><div class="wrap roqqu">
  <div class="head" style="margin:0"><span class="eyebrow">Built on Roqqu</span><h2>Every member of every group becomes a Roqqu user.</h2><p>No app to download. They pay a Roqqu link inside a chat they already use, and their Roqqu username is their Kolo ID.</p></div>
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
    ${animatedLogo()}
    <h2>Stop being the group’s bank.</h2>
    <p>Add Kolo to your WhatsApp group: <b>${KOLO_NUMBER}</b></p>
    <div class="ctas"><a class="btn btn-main" href="#start">Get started</a><a class="btn btn-alt" href="/ussd">Try the USSD demo</a></div>
  </div>
</div></section>

<footer><div class="wrap">
  <span class="brand">${logo(26)}Kolo · money in your group chat</span>
  <span>Kenechukwu Okoye · Ikenna Excel Ikueze · Clinton · Anambra Web3 Conference 3.0</span>
</div></footer>
</body></html>`
