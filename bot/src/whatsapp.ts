// WhatsApp adapter for the Kolo spike, using Baileys (unofficial WhatsApp Web
// protocol). The bot runs as a linked device on a SPARE number, never a personal one.
//
//   PAIR_NUMBER=2348012345678 npm run whatsapp   → prints an 8-character pairing code
//   npm run whatsapp                             → prints a QR code instead
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import QRCode from 'qrcode'
import makeWASocket, {
  Browsers,
  BufferJSON,
  DisconnectReason,
  decryptPollVote,
  fetchLatestBaileysVersion,
  isJidGroup,
  jidNormalizedUser,
  normalizeMessageContent,
  useMultiFileAuthState,
  type WAMessage,
  type proto,
} from 'baileys'
import pino from 'pino'
import qrcode from 'qrcode-terminal'
import { Kolo, isAddressed, type Action, type Incoming, type Member, type Payments, type WalletInfo } from './kolo.js'
import { createPaymentLink, decryptWebhook, deposits, generateWallet, nairaPerDollar, roqquEnabled, send, setOutage } from './roqqu.js'
import { APP_PAGE } from './app-page.js'
import { checkoutPage, simLinks, simulatedPayments } from './sim-pay.js'
import { ussd } from './ussd.js'
import { USSD_PAGE } from './ussd-page.js'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

// The AI message reader is on when Bedrock credentials are present (.env), off otherwise.
try {
  process.loadEnvFile('.env')
} catch {
  // no .env
}
const ai = process.env.AWS_BEARER_TOKEN_BEDROCK || process.env.AWS_ACCESS_KEY_ID ? await import('./intent.js') : undefined
const reader = ai?.readIntent

// Roqqu pay links are on when a Roqqu test key is present (.env).
// Pay links not yet confirmed: reference → the link's deposit addresses, when it was made,
// its naira price, who it's for, and whether they were already told it was underpaid.
const pendingLinks = new Map<string, { addresses: string[]; since: number; naira?: number; memberId?: string; short?: boolean }>()
// Each member's Roqqu USDT (BSC) address, made the first time the pot pays them.
const payoutAddresses = new Map<string, string>()
const emailFor = (member: Member) => `${member.id.split('@')[0].replace(/\D/g, '')}@kolo-demo.app`
// live: Roqqu's API. simulate: Kolo's own test checkout (sim-pay.ts), for when Roqqu's
// sandbox can't be used. The rest of Kolo works the same either way.
const SIMULATE = process.env.ROQQU_MODE === 'simulate'
if (SIMULATE) console.log('Payments: Kolo test checkout (ROQQU_MODE=simulate)')
const payments: Payments | undefined = SIMULATE
  ? simulatedPayments
  : roqquEnabled
  ? {
      async link({ chatId, member, amount, title }) {
        const reference = `K${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase()
        const link = await createPaymentLink({
          amountNgn: amount,
          reference,
          name: member.name,
          email: emailFor(member),
          metadata: { group: chatId, member: member.id, title },
        })
        pendingLinks.set(link.reference, { addresses: link.addresses, since: Date.now(), naira: amount, memberId: member.id })
        return { reference: link.reference, url: link.url }
      },
      // The pot is held as USDT on Roqqu; convert the naira amount at Roqqu's live rate.
      async payout({ member, amount, address }) {
        const rate = await nairaPerDollar()
        const usdt = Math.floor((amount / rate) * 100) / 100
        if (usdt < 1) throw new Error(`Roqqu's smallest send is 1 USDT (about ₦${Math.ceil(rate).toLocaleString('en-NG')})`)
        // Cash-out goes to the member's own passkey wallet (an EVM address, the same on BSC).
        let to = address ?? payoutAddresses.get(member.id)
        if (!to) {
          to = await generateWallet('bep20', { email: emailFor(member), name: member.name })
          payoutAddresses.set(member.id, to)
        }
        const reference = await send({ amount: usdt, token: 'usdt', network: 'bep20', to })
        console.log(`payout ${usdt} USDT to ${member.name} (${to}), ref ${reference}`)
        return { reference, sent: `${usdt} USDT on BSC at ₦${rate.toLocaleString('en-NG')}/$` }
      },
      // A Roqqu customer wallet for the group itself: its own address under our parent account.
      async groupAccount({ chatId, name }) {
        const address = await generateWallet('bep20', { email: `group-${chatId.split('@')[0].replace(/\D/g, '')}@kolo-demo.app`, name })
        console.log(`group account for ${chatId}: ${address}`)
        return address
      },
    }
  : undefined

// The passkey wallet service (wallet/), asked for a member's on-chain daily limit usage.
const WALLET_URL = process.env.WALLET_URL ?? 'http://localhost:3116'
const walletInfo: WalletInfo = {
  async usage(address) {
    const res = await fetch(`${WALLET_URL}/api/usage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address }) })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error)
    return json
  },
  async revoke(address) {
    const res = await fetch(`${WALLET_URL}/internal/revoke`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address }) })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error)
    return json.revoked
  },
}
const kolo = new Kolo(reader, payments, walletInfo, ai?.translate)

// Collections, the pot and open pay links survive restarts in data/state.json (private, not in git).
const STATE_FILE = 'data/state.json'
if (existsSync(STATE_FILE)) {
  const saved = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  kolo.restore(saved.kolo)
  for (const [ref, link] of saved.pendingLinks ?? []) pendingLinks.set(ref, link)
  for (const [id, address] of saved.payoutAddresses ?? []) payoutAddresses.set(id, address)
  for (const [ref, link] of saved.simLinks ?? []) simLinks.set(ref, link)
  console.log(`Restored ${saved.kolo.collections.length} collection(s) and ${pendingLinks.size} open pay link(s)`)
}
function saveState() {
  mkdirSync('data', { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify({ kolo: kolo.snapshot(), pendingLinks: [...pendingLinks], payoutAddresses: [...payoutAddresses], simLinks: [...simLinks], polls: savedPolls() }, null, 1))
}

// USSD: a caller's phone number → their member id in the group, and group names for menus.
const memberIdByPhone = new Map<string, string>()
const groupNames = new Map<string, string>()
const phoneDigits = (raw: string) => {
  const d = raw.replace(/\D/g, '')
  return d.length === 11 && d.startsWith('0') ? `234${d.slice(1)}` : d // 0803… → 234803…
}

// Kolo's own WhatsApp number (digits), known once connected.
let koloNumber: string | undefined

// Public links from scripts/tunnels.mjs: /join DMs use the public wallet page when it's up.
const PUBLIC_URLS = 'data/public-urls.json'
function loadPublicUrls() {
  try {
    const { wallet } = JSON.parse(readFileSync(PUBLIC_URLS, 'utf8'))
    if (wallet && process.env.JOIN_URL !== wallet) {
      process.env.JOIN_URL = wallet
      console.log(`Public wallet link: ${wallet}`)
    }
  } catch {
    // no tunnel running: links stay on localhost
  }
}
loadPublicUrls()
setInterval(loadPublicUrls, 10_000)

// How far back Kolo answers messages it missed while offline.
const CATCH_UP_MS = Number(process.env.CATCH_UP_MINUTES ?? 15) * 60_000

// Set by start(): sends Kolo's actions on the live socket (it changes on reconnect).
let performNow: ((actions: Action[]) => Promise<void>) | undefined

async function paymentConfirmed(reference: string, via: string) {
  if (!pendingLinks.delete(reference)) return
  console.log(`payment confirmed for ${reference} via ${via}`)
  await performNow?.(kolo.confirmPayment(reference))
  saveState()
}

// Roqqu's webhook for the shared sandbox account points elsewhere, so also watch the
// account's deposits: a deposit to one of a link's addresses means that link was paid.
// Deposits sent straight to a group's own account are credited to that group's pot once.
const creditedDeposits = new Set<string>()
const watchStarted = Date.now()
setInterval(async () => {
  if (SIMULATE || (!pendingLinks.size && !kolo.snapshot().groupAccounts.length)) return
  try {
    const seen = await deposits()
    const rate = await nairaPerDollar()
    for (const [reference, link] of pendingLinks) {
      const landed = seen.filter((d) => link.addresses.includes(d.address) && Date.parse(d.createdAt) >= link.since - 60_000)
      if (!landed.length) continue
      // Dollar coins are checked against the price: an underpaid link is not a payment.
      // (BTC is taken as paid for now; its naira value needs a BTC rate.)
      const dollars = landed.filter((d) => ['usdt', 'usdc'].includes(d.token.toLowerCase()))
      const got = Math.round(dollars.reduce((sum, d) => sum + d.value, 0) * rate)
      if (link.naira && dollars.length === landed.length && got < link.naira * 0.97) {
        if (!link.short && link.memberId) {
          link.short = true
          const missing = `₦${(link.naira - got).toLocaleString('en-NG')}`
          await performNow?.([{ type: 'dm', userId: link.memberId, text: `🐷 *Kolo*\nRoqqu shows ₦${got.toLocaleString('en-NG')} of ₦${link.naira.toLocaleString('en-NG')} on your link, so I haven't ticked you yet. Send the remaining ${missing} to the same link and I'll tick you then.` }])
          saveState()
        }
        continue
      }
      await paymentConfirmed(reference, 'deposit watch')
    }
    for (const d of seen) {
      if (creditedDeposits.has(d.hash) || Date.parse(d.createdAt) < watchStarted - 60_000) continue
      // USDT/USDC are dollars; other coins are left out of the naira pot for now.
      if (!['usdt', 'usdc'].includes(d.token)) continue
      const actions = kolo.depositToGroup(d.address, Math.round(d.value * rate), d.hash)
      if (!actions.length) continue
      creditedDeposits.add(d.hash)
      await performNow?.(actions)
      saveState()
    }
  } catch (error) {
    console.warn('deposit watch:', (error as Error).message)
  }
}, Number(process.env.ROQQU_POLL_MS ?? 15_000))

// Requests kept while Roqqu wasn't answering (pay links, top-ups, cash-outs, pot payments)
// go out as soon as it answers again. One retry run at a time: a Roqqu timeout is 45s.
let retrying = false
setInterval(async () => {
  if (retrying || !kolo.waitingCount() || !performNow) return
  retrying = true
  try {
    const actions = await kolo.retryWaiting()
    if (actions.length) console.log(`Roqqu is back: sent ${actions.length} kept message(s), ${kolo.waitingCount()} still waiting`)
    await performNow(actions)
    saveState()
  } catch (error) {
    console.warn('retrying kept requests:', (error as Error).message)
  } finally {
    retrying = false
  }
}, Number(process.env.ROQQU_RETRY_MS ?? 30_000))
const logger = pino({ level: process.env.LOG_LEVEL ?? 'warn' })

// Poll creation messages Kolo sent: needed to decrypt votes, which arrive encrypted.
const polls = new Map<string, { pollId: string; message: proto.IMessage; options: string[]; votes: Map<string, string[]> }>()
// Saved with the rest of the state (the poll's secret key is binary, hence BufferJSON),
// so a spend vote still counts after a restart.
const savedPolls = () => JSON.parse(JSON.stringify([...polls].map(([id, p]) => [id, { ...p, votes: [...p.votes] }]), BufferJSON.replacer))
if (existsSync(STATE_FILE)) {
  const saved = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  for (const [id, p] of JSON.parse(JSON.stringify(saved.polls ?? []), BufferJSON.reviver)) polls.set(id, { ...p, votes: new Map(p.votes) })
}
// Group member ids, and the display names people have shown while chatting.
const groupMembers = new Map<string, string[]>()
const names = new Map<string, string>()
// Ids of messages Kolo itself sent, so it never answers its own replies.
const sentIds = new Set<string>()
// What Kolo said in each message it sent, and what it was answering, so a reply
// to Kolo ("9k" under "How much is the whole bill?") can be read in context.
const sentContext = new Map<string, { kolo: string; asked?: string }>()
const stripLabel = (s: string) => s.replace(/^🐷 \*Kolo\*\n/, '')
const textOf = (m?: proto.IMessage | null) => {
  const c = m ? normalizeMessageContent(m) : undefined
  return c?.conversation ?? c?.extendedTextMessage?.text ?? c?.imageMessage?.caption ?? c?.pollCreationMessageV3?.name ?? c?.pollCreationMessage?.name ?? undefined
}

// Safety for testing: Kolo only reads and replies in these groups (comma-separated
// group ids or exact group names). Everything else on the linked account is ignored
// and never logged. With nothing set, it only lists the groups it can see.
const ALLOWED = (process.env.KOLO_GROUPS ?? '').split(',').map((s) => s.trim()).filter(Boolean)

// Login page: shows the current linking QR (WhatsApp rotates it about every 20s) and
// the connection status, so the QR can be scanned from a browser instead of a terminal.
let loginState: { qr?: string; status: string } = { status: 'Starting…' }
const QR_PORT = Number(process.env.QR_PORT ?? 3117)
createServer(async (req, res) => {
  // USSD: the simulator page (GET) and the Africa's Talking-style callback (POST).
  if (req.url === '/ussd' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(USSD_PAGE)
    return
  }
  if (req.url === '/ussd' && req.method === 'POST') {
    let body = ''
    for await (const chunk of req) body += chunk
    const form = new URLSearchParams(body)
    const reply = await ussd(form.get('phoneNumber') ?? '', form.get('text') ?? '', {
      kolo,
      memberByPhone: (raw) => {
        const id = memberIdByPhone.get(phoneDigits(raw))
        return id ? { id, name: names.get(id) ?? 'friend' } : undefined
      },
      groupName: (chatId) => groupNames.get(chatId) ?? 'Your group',
      perform: async (actions) => {
        await performNow?.(actions)
        saveState()
      },
    }).catch((error) => {
      console.error('ussd failed:', error)
      return 'END Kolo is busy. Please try again.'
    })
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(reply)
    return
  }
  // Kolo's web menu (/app): the page, what it shows, and actions run as the link's owner.
  const app = req.url?.match(/^\/app\/([a-f0-9]{32})(\/state|\/do)?$/)
  if (app) {
    const session = kolo.appSession(app[1])
    if (!app[2]) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(APP_PAGE)
      return
    }
    if (!session) {
      res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'This link has expired. Type /app in your group for a fresh one.' }))
      return
    }
    const { chatId, member } = session
    const others = (groupMembers.get(chatId) ?? []).filter((id) => id !== member.id).map((id) => ({ id, name: names.get(id) ?? id.split('@')[0] }))
    if (app[2] === '/state') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ name: member.name, group: groupNames.get(chatId) ?? 'Your group', members: others, ...kolo.appSummary(chatId, member.id) }))
      return
    }
    let body = ''
    for await (const chunk of req) body += chunk
    try {
      const { action, amount, text, people } = JSON.parse(body) as { action: string; amount?: string; text?: string; people?: string[] }
      let actions: Action[]
      if (action === 'paydues') {
        const paid = kolo.payFromBalance(chatId, member.id)
        if (!paid.ok) throw new Error(paid.reason)
        actions = paid.actions
      } else {
        // The same commands as typing in the group, so everything behaves (and shows) the same.
        const words: Record<string, string> = {
          topup: `/topup ${amount}`, send: `/send ${amount}`, split: `/split ${amount} me`, spend: `/spend ${amount} ${text}`,
          cashout: `/cashout ${amount}`, dues: `/dues ${amount} ${text}`, poll: `/poll ${text}`,
          remind: '/remind', status: '/status', limit: '/limit', close: '/close', balance: '/balance',
        }
        if (!words[action]) throw new Error('Unknown action')
        const mentions = others.filter((m) => people?.includes(m.id))
        actions = await kolo.handle({ chatId, isGroup: true, sender: member, members: [member, ...others], text: words[action], mentions, mentionsBot: false })
      }
      await performNow?.(actions)
      saveState()
      // Show the person what Kolo said to them or to the group.
      const replies = actions
        .filter((a) => (a.type === 'dm' ? a.userId === member.id : a.type !== 'poll' && a.chatId === chatId))
        .map((a) => stripLabel(a.type === 'image' ? a.caption : (a as { text: string }).text))
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ replies }))
    } catch (error) {
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: (error as Error).message }))
    }
    return
  }
  // Kolo's test checkout (ROQQU_MODE=simulate): the page, and its Completed / Underpaid / Failed buttons.
  const pay = req.url?.match(/^\/pay\/([A-Z0-9]+)$/)
  if (pay && req.method === 'GET') {
    const page = checkoutPage(pay[1], kolo.balanceOfLink(pay[1]))
    res.writeHead(page ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' }).end(page ?? 'This payment link does not exist.')
    return
  }
  if (pay && req.method === 'POST') {
    let body = ''
    for await (const chunk of req) body += chunk
    const link = simLinks.get(pay[1])
    const result = (() => { try { return JSON.parse(body).result } catch { return '' } })()
    if (!link || link.state === 'paid' || !['completed', 'underpaid', 'failed', 'balance'].includes(result)) {
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: link?.state === 'paid' ? 'This one is already paid.' : 'Unknown payment link.' }))
      return
    }
    const dm = (text: string) => performNow?.([{ type: 'dm', userId: link.memberId, text: `🐷 *Kolo*\n${text}` }])
    if (result === 'balance') {
      const paid = kolo.payLinkFromBalance(pay[1])
      if (!paid.ok) {
        res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: paid.reason }))
        return
      }
      link.state = 'paid'
      console.log(`test checkout paid from Kolo balance: ${pay[1]}`)
      await performNow?.(paid.actions)
    } else if (result === 'completed') {
      link.state = 'paid'
      console.log(`test checkout paid: ${pay[1]}`)
      await performNow?.(kolo.confirmPayment(pay[1], 'Roqqu (test checkout)'))
    } else if (result === 'underpaid') {
      link.state = 'underpaid'
      const got = Math.round(link.naira / 2)
      await dm(`Roqqu shows ₦${got.toLocaleString('en-NG')} of ₦${link.naira.toLocaleString('en-NG')} on your link, so I haven't ticked you yet. Send the remaining ₦${(link.naira - got).toLocaleString('en-NG')} to the same link and I'll tick you then.`)
    } else {
      link.state = 'failed'
      await dm(`Your payment for ${link.title} didn't go through, and nothing was taken. Your link still works: ${process.env.KOLO_URL ?? ''}/pay/${pay[1]}`)
    }
    saveState()
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
    return
  }
  // The wallet page asks who a /join link is for, to greet them by name, and for Kolo's
  // number so "Back to WhatsApp" opens the chat with Kolo.
  if (req.url?.startsWith('/wallet/invite') && req.method === 'GET') {
    const who = kolo.invite(new URL(req.url, 'http://x').searchParams.get('t') ?? '')
    const body = { kolo: koloNumber, ...(who && { name: who.name, group: groupNames.get(who.chatId) ?? 'your group' }) }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body))
    return
  }
  // The wallet page shows the owner's name and Kolo balance: ?address=0x…
  if (req.url?.startsWith('/wallet/balance') && req.method === 'GET') {
    const owner = kolo.ownerOfWallet(new URL(req.url, 'http://x').searchParams.get('address') ?? '')
    res.writeHead(owner ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify(owner ? { name: owner.name, balance: owner.balance } : {}))
    return
  }
  // The wallet page's Top up button: { address, amount } → a personal Roqqu pay link.
  if (req.url === '/wallet/topup' && req.method === 'POST') {
    let body = ''
    for await (const chunk of req) body += chunk
    try {
      const { address, amount } = JSON.parse(body)
      const owner = kolo.ownerOfWallet(String(address))
      const naira = Math.round(Number(amount))
      if (!owner) throw new Error('unknown wallet')
      if (!(naira >= 1500 && naira <= 200_000)) throw new Error('amount must be between ₦1,500 and ₦200,000')
      const member = { id: owner.memberId, name: owner.name }
      let reply
      try {
        reply = { url: await kolo.topupLink(member, owner.chatId, naira) }
      } catch (error) {
        if (!(error as { down?: boolean }).down) throw error
        // Roqqu isn't answering: keep it, and the link comes on WhatsApp once it's back.
        kolo.topupLater(member, owner.chatId, naira)
        reply = { queued: "Roqqu, the payment service, isn't answering right now. Your top-up is saved and Kolo will send the link to your WhatsApp the moment it's back." }
      }
      saveState()
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(reply))
    } catch (error) {
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: (error as Error).message }))
    }
    return
  }
  // The wallet page reports a finished /join: { token, address, dailyLimit }.
  if (req.url === '/wallet/registered' && req.method === 'POST') {
    let body = ''
    for await (const chunk of req) body += chunk
    try {
      const { token, address, dailyLimit } = JSON.parse(body)
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('bad address')
      const actions = kolo.walletReady(String(token), address, String(dailyLimit))
      if (!actions.length) throw new Error('unknown or used link')
      await performNow?.(actions)
      saveState()
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
    } catch (error) {
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: (error as Error).message }))
    }
    return
  }
  // Roqqu webhook (needs a public HTTPS address pointing here). Body: { hash }, iv in x-api-key.
  if (req.method === 'POST' && req.url === '/roqqu/webhook') {
    let body = ''
    for await (const chunk of req) body += chunk
    res.writeHead(200).end('ok')
    try {
      const event = decryptWebhook(JSON.parse(body).hash, String(req.headers['x-api-key'] ?? ''))
      console.log(`roqqu webhook: ${event?.event_type}`)
      const reference = event?.meta_data?.payment_reference
      if (reference && String(event.event_type).startsWith('payment_link_completed')) await paymentConfirmed(reference, 'webhook')
    } catch (error) {
      console.warn('bad roqqu webhook:', (error as Error).message)
    }
    return
  }
  // The login QR and status are for this machine only. Through a public link (a tunnel),
  // the host is the public name: send people to the USSD phone instead, never the QR,
  // or anyone could link their phone and take over the bot's WhatsApp number.
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host ?? '')
  if (!local) {
    res.writeHead(302, { location: '/ussd' }).end()
    return
  }
  // Outage drill, for demos and tests: /outage?on=1 makes every Roqqu call fail as if
  // Roqqu were down, /outage?on=0 brings it back. Local only, like the login page.
  if (req.url?.startsWith('/outage')) {
    const on = new URL(req.url, 'http://x').searchParams.get('on') === '1'
    setOutage(on)
    console.log(`Roqqu outage drill ${on ? 'ON' : 'OFF'}`)
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ outage: on, waiting: kolo.waitingCount() }))
    return
  }
  if (req.url === '/state') {
    const qr = loginState.qr ? await QRCode.toDataURL(loginState.qr, { width: 320, margin: 1 }) : undefined
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ qr, status: loginState.status }))
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(LOGIN_PAGE)
}).listen(QR_PORT, () => console.log(`Login page: http://localhost:${QR_PORT}`))

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth')
  const { version } = await fetchLatestBaileysVersion()
  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: Browsers.macOS('Chrome'),
    // Don't echo Kolo's own sends back as incoming messages.
    emitOwnEvents: false,
    getMessage: async (key) => (key.id ? polls.get(key.id)?.message : undefined),
  })
  sock.ev.on('creds.update', saveCreds)
  performNow = (actions) => perform(actions)

  const pairNumber = process.env.PAIR_NUMBER
  let pairingRequested = false

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr && pairNumber && !pairingRequested) {
      pairingRequested = true
      const code = await sock.requestPairingCode(pairNumber.replace(/\D/g, ''))
      console.log(`\nOn the bot phone: WhatsApp → Linked devices → Link a device → "Link with phone number instead"\nEnter code: ${code}\n`)
    } else if (qr && !pairNumber) {
      loginState = { qr, status: 'Scan with the spare phone' }
      console.log(`\nOn the bot phone: WhatsApp → Linked devices → Link a device, then scan (or open http://localhost:${QR_PORT}):`)
      qrcode.generate(qr, { small: true })
    }
    if (connection === 'open') {
      loginState = { status: `✅ Connected as ${sock.user?.id}` }
      console.log(`✅ Kolo connected as ${sock.user?.id}`)
      koloNumber = sock.user?.id.split(/[:@]/)[0]
      const groups = Object.values(await sock.groupFetchAllParticipating())
      allowedIds.clear()
      for (const g of groups) if (ALLOWED.includes(g.id) || ALLOWED.includes(g.subject)) allowedIds.add(g.id)
      // Load members now so USSD callers are recognised before anyone types in the group.
      for (const id of allowedIds) await membersOf(id).catch(() => undefined)
      if (allowedIds.size) console.log(`Active only in: ${groups.filter((g) => allowedIds.has(g.id)).map((g) => g.subject).join(', ')} · ${memberIdByPhone.size} phone numbers known for USSD`)
      else console.log(`No KOLO_GROUPS set, so Kolo will stay silent. Groups it can see:\n${groups.map((g) => `  ${g.subject}  (${g.id})`).join('\n')}`)
    }
    if (connection === 'close') {
      const code = (lastDisconnect?.error as any)?.output?.statusCode
      if (code === DisconnectReason.loggedOut) {
        loginState = { status: 'Logged out. Delete ./auth and restart to link again.' }
        console.log('Logged out. Delete ./auth and link again.')
      } else {
        loginState = { status: 'Reconnecting…' }
        start() // network blips and the post-pairing restart are normal
      }
    }
  })

  const allowedIds = new Set<string>()
  const me = () => [sock.user?.id, sock.user?.lid].filter(Boolean).map((j) => jidNormalizedUser(j!))
  const isMe = (jid?: string | null) => !!jid && me().includes(jidNormalizedUser(jid))

  const nameOf = (id: string) => names.get(id) ?? id.split('@')[0]

  // Everyone in the group except Kolo itself, named by the names they've shown in chat.
  async function membersOf(chatId: string): Promise<Member[]> {
    if (!groupMembers.has(chatId)) {
      const { subject, participants } = await sock.groupMetadata(chatId)
      groupNames.set(chatId, subject)
      groupMembers.set(chatId, participants.map((p) => p.id).filter((id) => !isMe(id)))
      // Groups address people by LID; remember their phone numbers for USSD callers.
      for (const p of participants) {
        for (const jid of [p.phoneNumber, p.id]) if (jid?.endsWith('@s.whatsapp.net')) memberIdByPhone.set(phoneDigits(jid.split('@')[0]), p.id)
        if (!names.has(p.id) && p.notify) names.set(p.id, p.notify)
      }
    }
    return groupMembers.get(chatId)!.map((id) => ({ id, name: nameOf(id) }))
  }

  // Membership changes (someone added or removed) refresh the list on the next message.
  sock.ev.on('group-participants.update', ({ id }) => {
    groupMembers.delete(id)
    if (allowedIds.has(id)) void membersOf(id).catch(() => undefined)
  })

  // origin: the message being answered; replies marked `reply` quote it, like a swipe-to-reply.
  async function perform(actions: Action[], origin?: WAMessage) {
    for (const a of actions) {
      let sent
      const quote = 'reply' in a && a.reply && origin ? { quoted: origin } : undefined
      if (a.type === 'text') sent = await sock.sendMessage(a.chatId, { text: a.text, mentions: a.mentions }, quote)
      if (a.type === 'image') sent = await sock.sendMessage(a.chatId, { image: a.png, caption: a.caption }, quote)
      if (a.type === 'dm') sent = await sock.sendMessage(a.userId, { text: a.text })
      if (a.type === 'poll') {
        sent = await sock.sendMessage(a.chatId, { poll: { name: a.question, values: a.options, selectableCount: 1 } })
        if (sent?.key.id && sent.message) polls.set(sent.key.id, { pollId: a.pollId, message: sent.message, options: a.options, votes: new Map() })
      }
      if (sent?.key.id) {
        sentIds.add(sent.key.id)
        const said = textOf(sent.message)
        if (said && a.type !== 'dm') sentContext.set(sent.key.id, { kolo: stripLabel(said), asked: textOf(origin?.message) })
      }
    }
    if (actions.length) saveState()
  }

  // A swipe-reply to one of Kolo's messages, even without the word "kolo".
  function replyToKolo(content: proto.IMessage | undefined): Incoming['replyTo'] {
    const info = content?.extendedTextMessage?.contextInfo
    if (!info?.stanzaId) return undefined
    const known = sentContext.get(info.stanzaId)
    if (known) return known
    // Kolo restarted since it sent that message: fall back to the quoted text.
    if (isMe(info.participant)) {
      const quoted = textOf(info.quotedMessage)
      return quoted ? { kolo: stripLabel(quoted) } : undefined
    }
    return undefined
  }

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const msg of messages) {
      // Messages that arrived while Kolo was offline (a restart, a network drop) come in as
      // 'append'. Answer the recent ones so nobody is ignored; skip anything older.
      const ageMs = Date.now() - Number(msg.messageTimestamp ?? 0) * 1000
      const missedRecently = type === 'append' && ageMs < CATCH_UP_MS
      // Messages typed on the account's own phone can arrive as 'append' rather than 'notify'.
      if (type !== 'notify' && !missedRecently && !(msg.key.fromMe && process.env.TEST_OWN_MESSAGES)) continue
      try {
        if (!msg.message || !allowedIds.has(msg.key.remoteJid ?? '')) continue
        const content = normalizeMessageContent(msg.message)
        // Skip Kolo's own replies. On a shared test account, messages typed on the
        // phone are also fromMe; with TEST_OWN_MESSAGES=1 those are handled too.
        if (msg.key.fromMe && (sentIds.has(msg.key.id!) || !process.env.TEST_OWN_MESSAGES)) continue
        if (content?.pollUpdateMessage) {
          await perform(await onVote(msg, content.pollUpdateMessage))
          continue
        }
        const text = content?.conversation ?? content?.extendedTextMessage?.text
        // Never answer one of Kolo's own messages (after a restart their ids are forgotten).
        if (!text || text.startsWith('🐷 *Kolo*')) continue
        const chatId = msg.key.remoteJid!
        const group = !!isJidGroup(chatId)
        const mentioned = content?.extendedTextMessage?.contextInfo?.mentionedJid ?? []
        const senderId = group ? (msg.key.participant ?? jidNormalizedUser(sock.user!.id)) : chatId
        const senderName = msg.pushName ?? (msg.key.fromMe ? sock.user?.name : undefined)
        if (senderName) names.set(senderId, senderName)
        console.log(`${group ? 'group' : 'dm'} ${nameOf(senderId)}: ${text}`)
        const incoming: Incoming = {
          chatId,
          isGroup: group,
          sender: { id: senderId, name: nameOf(senderId) },
          members: group ? await membersOf(chatId) : [],
          text,
          mentionsBot: mentioned.some(isMe),
          mentions: mentioned.filter((j) => !isMe(j)).map((id) => ({ id, name: nameOf(id) })),
          replyTo: replyToKolo(content),
        }
        // Show "typing…" while the AI reads the message (it can take a few seconds).
        if (isAddressed(incoming)) await sock.sendPresenceUpdate('composing', chatId)
        const actions = await kolo.handle(incoming)
        await sock.sendPresenceUpdate('paused', chatId)
        await perform(actions, msg)
      } catch (error) {
        console.error('failed to handle message', error)
      }
    }
  })

  async function onVote(msg: WAMessage, update: proto.Message.IPollUpdateMessage): Promise<Action[]> {
    const creationId = update.pollCreationMessageKey?.id
    const poll = creationId ? polls.get(creationId) : undefined
    const secret = poll?.message.messageContextInfo?.messageSecret
    if (!poll || !secret || !update.vote) return []
    const voter = msg.key.participant ?? msg.key.remoteJid!
    // Votes are encrypted with the creator's and voter's ids. Groups may address
    // people by phone number or by LID, so try each form until one decrypts.
    const voterIds = [voter, (msg.key as any).participantAlt].filter(Boolean)
    for (const creator of me()) {
      for (const voterJid of voterIds) {
        try {
          const vote = decryptPollVote(update.vote, { pollEncKey: secret, pollCreatorJid: creator, pollMsgId: creationId!, voterJid })
          const chosen = (vote.selectedOptions ?? []).map((hash) =>
            poll.options.find((o) => createHash('sha256').update(o).digest().equals(Buffer.from(hash))),
          )
          poll.votes.set(voter, chosen.filter(Boolean) as string[])
          const tally: Record<string, string[]> = Object.fromEntries(poll.options.map((o) => [o, [] as string[]]))
          for (const [who, options] of poll.votes) for (const o of options) tally[o].push(who)
          console.log(`vote from ${voter}: ${chosen.join(', ') || '(removed)'}`)
          // Returned, not awaited: a failure while paying out must not look like a failed
          // decryption, or the next id combination would count the vote (and pay) again.
          return kolo.handlePollTally(poll.pollId, tally)
        } catch {
          // wrong id combination; try the next
        }
      }
    }
    console.warn(`could not decrypt a vote from ${voter}`)
    return []
  }
}

const LOGIN_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kolo Bot Login</title>
<style>
  :root { --ink:#13201a; --muted:#55655c; --bg:#f6f8f7; --card:#fff; --line:#dfe6e1; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --ink:#e7efe9; --muted:#9db0a4; --bg:#0e1612; --card:#15201a; --line:#2a3a31; } }
  :root[data-theme="dark"] { --ink:#e7efe9; --muted:#9db0a4; --bg:#0e1612; --card:#15201a; --line:#2a3a31; }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 "Segoe UI", system-ui, sans-serif; }
  main { max-width:420px; margin:0 auto; padding:24px 16px; text-align:center; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:20px; }
  img { width:100%; max-width:320px; background:#fff; border-radius:12px; padding:8px; box-sizing:border-box; }
  ol { text-align:left; color:var(--muted); padding-left:20px; }
  #status { font-weight:600; margin:12px 0 0; }
</style></head>
<body><main>
  <h1>Link Kolo 🐷</h1>
  <div class="card">
    <img id="qr" alt="WhatsApp linking QR code" hidden>
    <p id="status">Starting…</p>
  </div>
  <ol>
    <li>On the <b>spare</b> phone open WhatsApp.</li>
    <li>Tap ⋮ (Android) or Settings (iPhone) → <b>Linked devices</b> → <b>Link a device</b>.</li>
    <li>Point the camera at this QR. It refreshes by itself.</li>
  </ol>
</main>
<script>
  async function tick() {
    try {
      const s = await (await fetch('/state')).json()
      const img = document.getElementById('qr')
      img.hidden = !s.qr
      if (s.qr) img.src = s.qr
      document.getElementById('status').textContent = s.status
    } catch {}
    setTimeout(tick, 2000)
  }
  tick()
</script>
</body></html>`

start()
