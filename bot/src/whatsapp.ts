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
import { Kolo, isAddressed, type Action, type Incoming, type Member, type Payments } from './kolo.js'
import { createPaymentLink, decryptWebhook, deposits, roqquEnabled } from './roqqu.js'

// The AI message reader is on when Bedrock credentials are present (.env), off otherwise.
try {
  process.loadEnvFile('.env')
} catch {
  // no .env
}
const reader = process.env.AWS_BEARER_TOKEN_BEDROCK || process.env.AWS_ACCESS_KEY_ID ? (await import('./intent.js')).readIntent : undefined

// Roqqu pay links are on when a Roqqu test key is present (.env).
// Pay links not yet confirmed: reference → the link's deposit addresses and when it was made.
const pendingLinks = new Map<string, { addresses: string[]; since: number }>()
const payments: Payments | undefined = roqquEnabled
  ? {
      async link({ chatId, member, amount, title }) {
        const reference = `K${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase()
        const link = await createPaymentLink({
          amountNgn: amount,
          reference,
          name: member.name,
          email: `${member.id.split('@')[0].replace(/\D/g, '')}@kolo-demo.app`,
          metadata: { group: chatId, member: member.id, title },
        })
        pendingLinks.set(link.reference, { addresses: link.addresses, since: Date.now() })
        return { reference: link.reference, url: link.url }
      },
    }
  : undefined
const kolo = new Kolo(reader, payments)

// Set by start(): sends Kolo's actions on the live socket (it changes on reconnect).
let performNow: ((actions: Action[]) => Promise<void>) | undefined

async function paymentConfirmed(reference: string, via: string) {
  if (!pendingLinks.delete(reference)) return
  console.log(`payment confirmed for ${reference} via ${via}`)
  await performNow?.(kolo.confirmPayment(reference))
}

// Roqqu's webhook for the shared sandbox account points elsewhere, so also watch the
// account's deposits: a deposit to one of a link's addresses means that link was paid.
setInterval(async () => {
  if (!pendingLinks.size) return
  try {
    const seen = await deposits()
    for (const [reference, link] of pendingLinks) {
      const paid = seen.some((d) => link.addresses.includes(d.address) && Date.parse(d.createdAt) >= link.since - 60_000)
      if (paid) await paymentConfirmed(reference, 'deposit watch')
    }
  } catch (error) {
    console.warn('deposit watch:', (error as Error).message)
  }
}, Number(process.env.ROQQU_POLL_MS ?? 15_000))
const logger = pino({ level: process.env.LOG_LEVEL ?? 'warn' })

// Poll creation messages Kolo sent: needed to decrypt votes, which arrive encrypted.
const polls = new Map<string, { pollId: string; message: proto.IMessage; options: string[]; votes: Map<string, string[]> }>()
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
      const groups = Object.values(await sock.groupFetchAllParticipating())
      allowedIds.clear()
      for (const g of groups) if (ALLOWED.includes(g.id) || ALLOWED.includes(g.subject)) allowedIds.add(g.id)
      if (allowedIds.size) console.log(`Active only in: ${groups.filter((g) => allowedIds.has(g.id)).map((g) => g.subject).join(', ')}`)
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
      const { participants } = await sock.groupMetadata(chatId)
      groupMembers.set(chatId, participants.map((p) => p.id).filter((id) => !isMe(id)))
    }
    return groupMembers.get(chatId)!.map((id) => ({ id, name: nameOf(id) }))
  }

  // Membership changes (someone added or removed) refresh the list on the next message.
  sock.ev.on('group-participants.update', ({ id }) => groupMembers.delete(id))

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
      // Messages typed on the account's own phone can arrive as 'append' rather than 'notify'.
      if (type !== 'notify' && !(msg.key.fromMe && process.env.TEST_OWN_MESSAGES)) continue
      try {
        if (!msg.message || !allowedIds.has(msg.key.remoteJid ?? '')) continue
        const content = normalizeMessageContent(msg.message)
        // Skip Kolo's own replies. On a shared test account, messages typed on the
        // phone are also fromMe; with TEST_OWN_MESSAGES=1 those are handled too.
        if (msg.key.fromMe && (sentIds.has(msg.key.id!) || !process.env.TEST_OWN_MESSAGES)) continue
        if (content?.pollUpdateMessage) {
          await perform(onVote(msg, content.pollUpdateMessage))
          continue
        }
        const text = content?.conversation ?? content?.extendedTextMessage?.text
        if (!text) continue
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

  function onVote(msg: WAMessage, update: proto.Message.IPollUpdateMessage): Action[] {
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
