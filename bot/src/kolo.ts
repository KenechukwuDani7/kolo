// Kolo's chat logic, independent of WhatsApp or Telegram. An adapter turns
// platform events into `Incoming` messages and performs the returned actions.
//
// Two ways in, one set of handlers:
//   /commands        parsed by code, instant, no AI
//   "Kolo …" / @Kolo read by the AI message reader (if one is configured), which
//                    only proposes an Intent; the handlers below check it and act.
import { renderDuesCard } from './cards.js'
import type { Intent, IntentContext } from './intent.js'

export type Member = { id: string; name: string }

export type Incoming = {
  chatId: string
  isGroup: boolean
  sender: Member
  // Everyone else in the group (not Kolo itself), with display names where known.
  members: Member[]
  text: string
  mentions: Member[]
  mentionsBot: boolean
  // Set when the message is a reply to one of Kolo's own messages.
  replyTo?: { kolo: string; asked?: string }
}

export type Action =
  | { type: 'text'; chatId: string; text: string; mentions?: string[]; reply?: boolean }
  | { type: 'image'; chatId: string; png: Buffer; caption: string; reply?: boolean }
  | { type: 'poll'; chatId: string; pollId: string; question: string; options: string[] }
  | { type: 'dm'; userId: string; text: string }

export type Reader = (text: string, ctx: IntentContext) => Promise<Intent>

// Makes a personal pay link for one member's share (Roqqu payment links in the real
// adapter). Kolo is told about payments later through confirmPayment(reference).
export type Payments = {
  link(opts: { chatId: string; member: Member; amount: number; title: string }): Promise<{ reference: string; url: string }>
  // Pays a member out of the group pot, or to `address` (their own wallet) on cash-out;
  // `sent` describes what actually moved ("3.63 USDT on BSC").
  payout(opts: { chatId: string; member: Member; amount: number; purpose: string; address?: string }): Promise<{ reference: string; sent: string }>
}

// A spend from the pot waiting on the group's vote.
type Spend = { amount: number; to: Member; purpose: string; by: Member }

type Collection = {
  title: string
  amount: number
  organiser: Member
  members: Member[]
  paid: Map<string, string>
  links: Map<string, string> // member id → their pay link
}
type Poll = { chatId: string; question: string; needed: number; settled: boolean; spend?: Spend }

const JOIN_URL = process.env.JOIN_URL ?? 'http://localhost:3116'
const naira = (n: number) => `₦${n.toLocaleString('en-NG')}`
// WhatsApp renders "@<number>" as the person's name when their id is in `mentions`.
const tag = (m: Member) => `@${m.id.split('@')[0]}`
const DEMO_CREDIT = 10_000
const potLine = (pot: number) => `🏦 Group pot: ${naira(pot)}`
const payLinkText =(m: Member, c: Collection, url: string) =>
  `Hi ${m.name}! Your share of *${c.title}* is ${naira(c.amount)}.\nPay here (USDT or BTC, via Roqqu): ${url}\nI'll tick you in the group as soon as it lands.`

// "2k", "12.5k", "₦2,000", "2000" → number of naira
export function parseAmount(raw: string): number | undefined {
  const m = raw.replace(/[₦,\s]/g, '').toLowerCase().match(/^(\d+(?:\.\d+)?)(k|m)?$/)
  if (!m) return undefined
  return Math.round(Number(m[1]) * (m[2] === 'k' ? 1_000 : m[2] === 'm' ? 1_000_000 : 1))
}

// Kolo answers: a /command, "paid", "kolo" anywhere in the message, an @mention,
// or a reply to one of its own messages. Everything else in a group is ignored.
export function isAddressed(msg: Incoming) {
  const text = msg.text.trim()
  return !msg.isGroup || text.startsWith('/') || /^paid\b/i.test(text) || /\bkolo\b/i.test(text) || msg.mentionsBot || !!msg.replyTo
}

export class Kolo {
  private collections = new Map<string, Collection>()
  private polls = new Map<string, Poll>()
  private pollCount = 0
  // Pay-link reference → whose share it pays.
  private references: Map<string, { chatId: string; memberId: string }> = new Map<string, { chatId: string; memberId: string }>()
  // The group pot: naira collected and not yet spent, per chat.
  private pots = new Map<string, number>()
  // Each member's Kolo balance, used by USSD (prototype: everyone starts with demo credit).
  private balances = new Map<string, number>()
  // /join links: one-time token → who asked, and each member's own passkey wallet address.
  private joinTokens = new Map<string, { chatId: string; memberId: string; name: string }>()
  private wallets = new Map<string, string>()

  // Everything Kolo must remember across restarts, as plain JSON.
  snapshot() {
    return {
      collections: [...this.collections].map(([chatId, c]) => ({ chatId, ...c, paid: [...c.paid], links: [...c.links] })),
      pots: [...this.pots],
      references: [...this.references],
      balances: [...this.balances],
      joinTokens: [...this.joinTokens],
      wallets: [...this.wallets],
    }
  }

  restore(s: ReturnType<Kolo['snapshot']>) {
    for (const { chatId, paid, links, ...c } of s.collections) this.collections.set(chatId, { ...c, paid: new Map(paid), links: new Map(links) })
    this.pots = new Map(s.pots)
    this.references = new Map(s.references)
    this.balances = new Map(s.balances ?? [])
    this.joinTokens = new Map(s.joinTokens ?? [])
    this.wallets = new Map(s.wallets ?? [])
  }

  // Who a /join link is for, so the wallet page can greet them by name.
  invite(token: string) {
    const who = this.joinTokens.get(token)
    return who && { name: who.name, chatId: who.chatId }
  }

  // The wallet page finished: passkey created, wallet deployed, daily limit signed.
  walletReady(token: string, address: string, dailyLimit: string): Action[] {
    const who = this.joinTokens.get(token)
    if (!who) return []
    this.joinTokens.delete(token)
    this.wallets.set(who.memberId, address)
    const short = `${address.slice(0, 6)}…${address.slice(-4)}`
    return [
      {
        type: 'text',
        chatId: who.chatId,
        text: `🔐 ${who.name} set up their own Kolo wallet (${short}).\nOnly ${who.name}'s fingerprint or face controls it, and Kolo can spend at most ${dailyLimit} a day from it. The blockchain enforces that limit, not Kolo.\nCash out to it anytime: /cashout [amount]`,
      },
    ].map(sign)
  }

  // ── USSD: the same group money, from any phone with no data ──

  potOf = (chatId: string) => this.pot(chatId)
  balanceOf = (memberId: string) => this.balances.get(memberId) ?? DEMO_CREDIT

  // Groups this member belongs to (any group that has run a collection with them in it).
  groupsOf = (memberId: string) => [...this.collections].filter(([, c]) => c.members.some((m) => m.id === memberId)).map(([chatId]) => chatId)

  // Collections this member still owes, across every group.
  duesFor(memberId: string) {
    return [...this.collections]
      .filter(([, c]) => c.members.some((m) => m.id === memberId) && !c.paid.has(memberId))
      .map(([chatId, c]) => ({ chatId, title: c.title, amount: c.amount }))
  }

  // Pay a collection from the member's Kolo balance (USSD), and tell the group.
  payFromBalance(chatId: string, memberId: string): { ok: true; actions: Action[] } | { ok: false; reason: string } {
    const c = this.collections.get(chatId)
    const member = c?.members.find((m) => m.id === memberId)
    if (!c || !member) return { ok: false, reason: 'That collection is closed.' }
    if (c.paid.has(memberId)) return { ok: false, reason: 'You have already paid this one.' }
    const balance = this.balanceOf(memberId)
    if (balance < c.amount) return { ok: false, reason: `Your Kolo balance is ${naira(balance)}, not enough for ${naira(c.amount)}.` }
    this.balances.set(memberId, balance - c.amount)
    c.paid.set(memberId, member.name)
    this.credit(chatId, c.amount)
    const done = c.paid.size === c.members.length ? '\n🎉 Everybody don pay!' : ''
    return { ok: true, actions: [this.duesCard(chatId, c, `${member.name} paid ✅ by USSD (no data needed)${done}`)].map(sign) }
  }

  constructor(
    private read?: Reader,
    private payments?: Payments,
  ) {}

  // The payment provider confirmed a pay link was paid: tick that member off.
  confirmPayment(reference: string, via = 'Roqqu'): Action[] {
    const ref = this.references.get(reference)
    const c = ref && this.collections.get(ref.chatId)
    const member = c?.members.find((m) => m.id === ref!.memberId)
    if (!ref || !c || !member || c.paid.has(member.id)) return []
    c.paid.set(member.id, member.name)
    this.credit(ref.chatId, c.amount)
    const done = c.paid.size === c.members.length ? '\n🎉 Everybody don pay!' : ''
    return [this.duesCard(ref.chatId, c, `${member.name} paid ✅ (confirmed by ${via})${done}`)].map(sign)
  }

  // Everything Kolo posts back into the same chat is sent as a reply to the message that triggered it.
  async handle(msg: Incoming): Promise<Action[]> {
    const actions = await this.respond(msg)
    return actions
      .map((a) => ((a.type === 'text' || a.type === 'image') && a.chatId === msg.chatId ? { ...a, reply: true } : a))
      .map(sign)
  }

  // tally: option name → ids of everyone currently voting for it
  async handlePollTally(pollId: string, tally: Record<string, string[]>): Promise<Action[]> {
    return (await this.tallyPoll(pollId, tally)).map(sign)
  }

  private pot = (chatId: string) => this.pots.get(chatId) ?? 0
  private credit(chatId: string, amount: number) {
    this.pots.set(chatId, this.pot(chatId) + amount)
  }

  private async respond(msg: Incoming): Promise<Action[]> {
    if (!isAddressed(msg)) return [] // in groups Kolo ignores ordinary chat
    const text = msg.text.trim()
    if (/^paid\b/i.test(text)) return this.markPaid(msg)
    if (text.startsWith('/')) return this.command(msg, text.slice(1))

    const body = stripMention(text)
    if (!body) return [this.text(msg, HELP)]
    if (!this.read) return this.command(msg, body)
    try {
      return this.fromIntent(msg, await this.read(body, this.context(msg)))
    } catch (error) {
      console.error('AI reader failed, falling back to commands:', error)
      return this.command(msg, body)
    }
  }

  // Fixed commands: "/dues [amount] [what for]", "split [amount] between me @[name]", …
  private command(msg: Incoming, command: string): Action[] | Promise<Action[]> {
    const words = command.trim().split(/\s+/)
    const verb = words[0]?.toLowerCase() ?? ''
    const args = words.slice(1)
    switch (verb) {
      case 'dues':
        return this.startDues(msg, parseAmount(args[0] ?? ''), args.slice(1).join(' '))
      case 'split':
        return this.split(msg, parseAmount(args[0] ?? ''), msg.mentions, args.some((w) => /^me$/i.test(w)))
      case 'poll':
        return this.startPoll(msg, args.join(' '))
      case 'remind':
        return this.remind(msg, msg.mentions.length ? msg.mentions : undefined)
      case 'status':
        return this.status(msg)
      case 'join':
        return this.join(msg)
      case 'confirm':
        return this.confirmByHand(msg)
      case 'spend':
        // "/spend 5k @Excel projector"
        return this.startSpend(msg, parseAmount(args[0] ?? ''), msg.mentions, args.slice(1).filter((w) => !w.startsWith('@')).join(' '))
      case 'pot':
        return [this.text(msg, potLine(this.pot(msg.chatId)))]
      case 'cashout':
        return this.cashout(msg, parseAmount(args[0] ?? ''))
      case '':
      case 'help': {
        const topic = featureFor(args.join(' '))
        return [this.text(msg, topic ? explain(topic) : HELP)]
      }
      default:
        return [this.text(msg, offPoint(msg.sender.name))]
    }
  }

  private fromIntent(msg: Incoming, intent: Intent): Action[] | Promise<Action[]> {
    const people = this.resolve(msg, intent.people)
    const unknown = intent.unknownNames.filter(Boolean)
    switch (intent.action) {
      case 'dues':
        return this.startDues(msg, intent.amount ?? undefined, intent.title ?? '')
      case 'paid':
        return this.markPaid(msg)
      case 'split':
        if (unknown.length) return [this.askWho(msg, unknown)]
        return this.split(msg, intent.amount ?? undefined, people, intent.includeSender)
      case 'pay':
        return this.pay(msg, intent.amount ?? undefined, people, unknown)
      case 'poll':
        return this.startPoll(msg, intent.question ?? '')
      case 'spend':
        if (unknown.length) return [this.askWho(msg, unknown)]
        return this.startSpend(msg, intent.amount ?? undefined, people, intent.title ?? '')
      case 'remind':
        return this.remind(msg, people.length ? people : undefined)
      case 'status':
        return this.status(msg)
      case 'join':
        return this.join(msg)
      case 'cashout':
        return this.cashout(msg, intent.amount ?? undefined)
      case 'help':
        // Explanations come from FEATURES, never from the AI, so they are always accurate.
        return [this.text(msg, intent.topic ? explain(intent.topic) : HELP)]
      case 'chat':
        return [this.text(msg, `${intent.reply ?? offPoint(msg.sender.name)}\n\n_Type / for what I can do._`)]
    }
  }

  private context(msg: Incoming): IntentContext {
    const c = this.collections.get(msg.chatId)
    return {
      sender: msg.sender.name,
      members: [msg.sender.name, ...msg.members.filter((m) => m.id !== msg.sender.id).map((m) => m.name)],
      collection: c && { title: c.title, amount: c.amount, unpaid: this.unpaid(c).map((m) => m.name) },
      pot: this.pot(msg.chatId),
      replyingTo: msg.replyTo,
    }
  }

  // The AI returns member names; map them back to real ids and drop anything it made up.
  // WhatsApp names carry dots, emoji and capitals ("Clinton.", "~ Ginaa💎"), so compare
  // letters and digits only, then allow a nickname that starts the full name ("clint").
  private resolve(msg: Incoming, names: string[]): Member[] {
    const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
    const find = (n: string) => {
      const k = key(n)
      if (!k) return undefined
      return msg.members.find((m) => key(m.name) === k) ?? msg.members.find((m) => key(m.name).startsWith(k) || k.startsWith(key(m.name)))
    }
    const found = names.map(find).filter((m): m is Member => !!m && m.id !== msg.sender.id)
    return [...new Map(found.map((m) => [m.id, m])).values()]
  }

  private async startDues(msg: Incoming, amount: number | undefined, title: string): Promise<Action[]> {
    if (!amount) return [this.text(msg, `How much should each person pay?\nSay it like: ${FEATURES.dues.say}`)]
    const members = msg.members.length ? msg.members : [msg.sender]
    const collection: Collection = { title: title || 'Group dues', amount, organiser: msg.sender, members, paid: new Map(), links: new Map() }
    this.collections.set(msg.chatId, collection)
    if (!this.payments) {
      return [this.duesCard(msg.chatId, collection, `New collection: ${collection.title}\n${naira(amount)} each · reply "paid" when done\n(Test mode: "paid" is trusted.)`)]
    }

    // One personal pay link per member, so each payment says exactly who paid.
    const made = await Promise.allSettled(
      members.map(async (member) => {
        const { reference, url } = await this.payments!.link({ chatId: msg.chatId, member, amount, title: collection.title })
        this.references.set(reference, { chatId: msg.chatId, memberId: member.id })
        collection.links.set(member.id, url)
        return { member, url }
      }),
    )
    const links = made.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    for (const r of made) if (r.status === 'rejected') console.error('pay link failed:', r.reason)
    const missing = members.filter((m) => !collection.links.has(m.id))
    return [
      this.duesCard(
        msg.chatId,
        collection,
        `New collection: ${collection.title}\n${naira(amount)} each\n📩 I've sent each person a pay link. Pay with USDT or BTC through Roqqu, and I'll tick you here automatically.${
          missing.length ? `\n⚠️ Couldn't make a link for ${missing.map((m) => m.name).join(', ')}. Try /status later.` : ''
        }`,
      ),
      ...links.map(({ member, url }): Action => ({ type: 'dm', userId: member.id, text: payLinkText(member, collection, url) })),
    ]
  }

  private markPaid(msg: Incoming): Action[] {
    const collection = this.collections.get(msg.chatId)
    if (!collection) return []
    if (collection.paid.has(msg.sender.id)) return [this.text(msg, `${msg.sender.name}, you've already paid ✅`)]
    // With pay links, a message is never proof: Kolo waits for Roqqu's confirmation.
    const link = collection.links.get(msg.sender.id)
    if (this.payments && link) {
      return [
        this.text(msg, `${msg.sender.name}, I go tick you as soon as Roqqu confirms the payment 👀 Your pay link is in your DM.`),
        { type: 'dm', userId: msg.sender.id, text: payLinkText(msg.sender, collection, link) },
      ]
    }
    collection.paid.set(msg.sender.id, msg.sender.name)
    this.credit(msg.chatId, collection.amount)
    return [this.duesCard(msg.chatId, collection, `${msg.sender.name} paid ✅`)]
  }

  // "/confirm @Excel": the organiser records a payment made outside Kolo (cash, transfer).
  private confirmByHand(msg: Incoming): Action[] {
    const c = this.collections.get(msg.chatId)
    if (!c) return [this.text(msg, `No collection is running yet.\nStart one with: ${FEATURES.dues.say}`)]
    if (c.organiser.id !== msg.sender.id) return [this.text(msg, `Only ${c.organiser.name}, who started *${c.title}*, can confirm payments by hand.`)]
    const who = msg.mentions.filter((m) => c.members.some((x) => x.id === m.id) && !c.paid.has(m.id))
    if (!who.length) return [this.text(msg, 'Tag who paid you directly, like: /confirm @Excel')]
    for (const m of who) c.paid.set(m.id, c.members.find((x) => x.id === m.id)!.name)
    this.credit(msg.chatId, c.amount * who.length)
    return [this.duesCard(msg.chatId, c, `${who.map((m) => c.paid.get(m.id)).join(', ')} paid ✅ (confirmed by ${c.organiser.name})`)]
  }

  private remind(msg: Incoming, who?: Member[]): Action[] {
    const c = this.collections.get(msg.chatId)
    if (!c) return [this.text(msg, `No collection is running yet.\nStart one with: ${FEATURES.dues.say}`)]
    const targets = (who ?? this.unpaid(c)).filter((m) => !c.paid.has(m.id))
    if (!targets.length) return [this.text(msg, who ? `${who.map((m) => m.name).join(', ')} don pay already ✅` : 'Everybody don pay 🎉')]
    return [
      {
        type: 'text',
        chatId: msg.chatId,
        text: `⏰ ${targets.map(tag).join(' ')} your ${naira(c.amount)} for *${c.title}* still dey wait 👀\n${c.paid.size}/${c.members.length} paid so far.`,
        mentions: targets.map((m) => m.id),
      },
    ]
  }

  private status(msg: Incoming): Action[] {
    const c = this.collections.get(msg.chatId)
    if (!c) return [this.text(msg, `No collection is running yet.\nStart one with: ${FEATURES.dues.say}`)]
    const unpaid = this.unpaid(c)
    const paid = [...c.paid.values()]
    return [
      this.text(
        msg,
        `📊 *${c.title}* · ${naira(c.amount)} each\n${c.paid.size}/${c.members.length} paid · ${naira(c.paid.size * c.amount)} collected\n✅ ${paid.join(', ') || 'nobody yet'}\n⏳ ${unpaid.map((m) => m.name).join(', ') || 'nobody'}\n${potLine(this.pot(msg.chatId))}`,
      ),
    ]
  }

  private unpaid(c: Collection) {
    return c.members.filter((m) => !c.paid.has(m.id))
  }

  private duesCard(chatId: string, c: Collection, caption: string): Action {
    const png = renderDuesCard({ title: c.title, amount: c.amount, paid: c.paid.size, size: c.members.length })
    return { type: 'image', chatId, png, caption: `${caption}\n${c.paid.size}/${c.members.length} paid · ${naira(c.paid.size * c.amount)} collected` }
  }

  private split(msg: Incoming, amount: number | undefined, others: Member[], includeSender: boolean): Action[] {
    if (!amount) return [this.text(msg, `How much is the whole bill?\nSay it like: ${FEATURES.split.say}`)]
    const people = [...(includeSender ? [msg.sender] : []), ...others.filter((p) => p.id !== msg.sender.id)]
    if (people.length < 2) return [this.text(msg, `Who shared it? Name them or tag them with @.\nSay it like: ${FEATURES.split.say}`)]
    const share = Math.ceil(amount / people.length)
    const owing = people.filter((p) => p.id !== msg.sender.id)
    const lines = owing.map((p) => `• ${tag(p)} owes ${naira(share)}`).join('\n')
    return [
      {
        type: 'text',
        chatId: msg.chatId,
        text: `🍔 ${naira(amount)} split ${people.length} ways = ${naira(share)} each\n${lines}\nTap your pay request in DM.`,
        mentions: owing.map((p) => p.id),
      },
      ...owing.map((p): Action => ({ type: 'dm', userId: p.id, text: `${msg.sender.name} split ${naira(amount)} with you. Your share: ${naira(share)}. Pay: ${JOIN_URL}` })),
    ]
  }

  private pay(msg: Incoming, amount: number | undefined, to: Member[], unknown: string[]): Action[] {
    if (unknown.length) return [this.askWho(msg, unknown)]
    if (!to.length) return [this.text(msg, `Who should I pay?\nSay it like: ${FEATURES.pay.say}`)]
    if (!amount) return [this.text(msg, `How much should I send ${to.map((m) => m.name).join(' and ')}?\nSay it like: ${FEATURES.pay.say}`)]
    // Sending money needs the sender's own approval; the bot only prepares it.
    return [
      { type: 'text', chatId: msg.chatId, text: `💸 ${msg.sender.name}, I've sent you a private link to confirm ${naira(amount)} to ${to.map((m) => m.name).join(', ')}.` },
      { type: 'dm', userId: msg.sender.id, text: `Confirm ${naira(amount)} to ${to.map((m) => m.name).join(', ')}: ${JOIN_URL}\n(Within your daily limit it goes through instantly; above it, you'll confirm with your fingerprint.)` },
    ]
  }

  private join(msg: Incoming): Action[] {
    const existing = this.wallets.get(msg.sender.id)
    if (existing) return [this.text(msg, `${msg.sender.name}, you already have a Kolo wallet (${existing.slice(0, 6)}…${existing.slice(-4)}) ✅`)]
    // A one-time token ties the wallet page back to this person and group.
    const token = crypto.randomUUID().replace(/-/g, '')
    this.joinTokens.set(token, { chatId: msg.chatId, memberId: msg.sender.id, name: msg.sender.name })
    return [
      {
        type: 'dm',
        userId: msg.sender.id,
        text: `Hi ${msg.sender.name}! Tap to set up your own Kolo wallet with your fingerprint or face (about 20 seconds): ${JOIN_URL}/?t=${token}\nNo password, no seed phrase. Only your device can approve big payments.`,
      },
      this.text(msg, `📩 ${msg.sender.name}, I've sent you a private link.`),
    ]
  }

  // Move money from your Kolo balance to your own passkey wallet, through Roqqu.
  private async cashout(msg: Incoming, amount: number | undefined): Promise<Action[]> {
    const address = this.wallets.get(msg.sender.id)
    if (!address) return [this.text(msg, `Set up your own Kolo wallet first with /join, then cash out to it.`)]
    if (!amount) return [this.text(msg, `How much? Say it like: ${FEATURES.cashout.say}`)]
    const balance = this.balanceOf(msg.sender.id)
    if (amount > balance) return [this.text(msg, `Your Kolo balance is ${naira(balance)}, so you can't cash out ${naira(amount)}.`)]
    if (!this.payments) {
      this.balances.set(msg.sender.id, balance - amount)
      return [this.text(msg, `💸 ${naira(amount)} sent to your wallet (test mode, no money moved). Balance: ${naira(balance - amount)}`)]
    }
    try {
      const { reference, sent } = await this.payments.payout({ chatId: msg.chatId, member: msg.sender, amount, purpose: 'cash-out', address })
      this.balances.set(msg.sender.id, balance - amount)
      return [
        this.text(
          msg,
          `💸 Cashed out ${naira(amount)} (${sent}) to your own wallet ${address.slice(0, 6)}…${address.slice(-4)}.\nRoqqu ref: ${reference}\nKolo balance left: ${naira(balance - amount)}`,
        ),
      ]
    } catch (error) {
      console.error('cash-out failed:', error)
      return [this.text(msg, `Roqqu couldn't send it: ${(error as Error).message}. Your balance is unchanged.`)]
    }
  }

  private askWho(msg: Incoming, names: string[]): Action {
    return this.text(msg, `🤔 I no see ${names.join(' or ')} for this group. Tag them with @ so I know who you mean.`)
  }

  private startPoll(msg: Incoming, question: string): Action[] {
    if (!question) return [this.text(msg, `What should the group vote on?\nSay it like: ${FEATURES.poll.say}`)]
    const pollId = `poll-${++this.pollCount}`
    const needed = Math.min(3, Math.max(msg.members.length, 1))
    this.polls.set(pollId, { chatId: msg.chatId, question, needed, settled: false })
    return [{ type: 'poll', chatId: msg.chatId, pollId, question: `${question} (needs ${needed} yes)`, options: ['Yes', 'No'] }]
  }

  // "Spend 5k from the pot on a projector, pay Excel": the money only moves if the group votes yes.
  private startSpend(msg: Incoming, amount: number | undefined, to: Member[], purpose: string): Action[] {
    if (!to.length) return [this.text(msg, `Who should the pot pay? Tag them with @.\nSay it like: ${FEATURES.spend.say}`)]
    if (to.length > 1) return [this.text(msg, 'One person per spend, so the receipt is clear. Ask again for each person.')]
    if (!amount) return [this.text(msg, `How much from the pot?\nSay it like: ${FEATURES.spend.say}`)]
    const pot = this.pot(msg.chatId)
    if (amount > pot) return [this.text(msg, `The pot only has ${naira(pot)}, so I can't spend ${naira(amount)}. Collect more with /dues first.`)]
    const spend: Spend = { amount, to: to[0], purpose: purpose || 'group expense', by: msg.sender }
    const pollId = `poll-${++this.pollCount}`
    // A spend needs a majority of the group, the person asking included.
    const needed = Math.floor(Math.max(msg.members.length, 1) / 2) + 1
    const question = `Spend ${naira(amount)} from the pot: pay ${spend.to.name} for ${spend.purpose}?`
    this.polls.set(pollId, { chatId: msg.chatId, question, needed, settled: false, spend })
    return [
      this.text(msg, `🗳️ ${msg.sender.name} wants to spend ${naira(amount)} of the pot (${naira(pot)}). The group decides: ${needed} yes and I pay ${spend.to.name} straight away.`),
      { type: 'poll', chatId: msg.chatId, pollId, question: `${question} (needs ${needed} yes)`, options: ['Yes', 'No'] },
    ]
  }

  private async paySpend(poll: Poll, spend: Spend, yes: number): Promise<Action[]> {
    const say = (text: string): Action[] => [{ type: 'text', chatId: poll.chatId, text }]
    const pot = this.pot(poll.chatId)
    if (spend.amount > pot) return say(`✅ Approved, but the pot now has only ${naira(pot)}. Nothing was sent.`)
    if (!this.payments) {
      this.pots.set(poll.chatId, pot - spend.amount)
      return say(`✅ Approved ${yes}/${poll.needed}. ${naira(spend.amount)} paid to ${spend.to.name} for ${spend.purpose} (test mode, no money moved).\n${potLine(this.pot(poll.chatId))}`)
    }
    try {
      const { reference, sent } = await this.payments.payout({ chatId: poll.chatId, member: spend.to, amount: spend.amount, purpose: spend.purpose })
      this.pots.set(poll.chatId, pot - spend.amount)
      return say(
        `✅ Approved ${yes}/${poll.needed}. Paid!\n🧾 *Receipt*\n${naira(spend.amount)} (${sent}) → ${spend.to.name}\nFor: ${spend.purpose}\nAsked by: ${spend.by.name}\nRoqqu ref: ${reference}\n${potLine(this.pot(poll.chatId))}`,
      )
    } catch (error) {
      console.error('payout failed:', error)
      return say(`✅ Approved, but Roqqu couldn't send it: ${(error as Error).message}. The pot is unchanged (${naira(pot)}).`)
    }
  }

  private async tallyPoll(pollId: string, tally: Record<string, string[]>): Promise<Action[]> {
    const poll = this.polls.get(pollId)
    if (!poll || poll.settled) return []
    const yes = tally['Yes']?.length ?? 0
    const no = tally['No']?.length ?? 0
    if (yes >= poll.needed) {
      poll.settled = true
      if (poll.spend) return this.paySpend(poll, poll.spend, yes)
      return [{ type: 'text', chatId: poll.chatId, text: `✅ Approved ${yes}/${poll.needed}: "${poll.question}"` }]
    }
    if (no >= poll.needed) {
      poll.settled = true
      return [{ type: 'text', chatId: poll.chatId, text: `❌ Rejected: "${poll.question}"` }]
    }
    return [{ type: 'text', chatId: poll.chatId, text: `🗳️ "${poll.question}" · Yes ${yes} · No ${no} · needs ${poll.needed}` }]
  }

  private text(msg: Incoming, text: string): Action {
    return { type: 'text', chatId: msg.chatId, text }
  }
}

const stripMention = (text: string) => text.replace(/^@?kolo\b[,:]?\s*/i, '').replace(/^@\S+\s*/, '').trim()

const OFF_POINT = [
  (name: string) => `😅 ${name}, you dey talk off point. I only sabi money matters: dues, splits, polls and your Kolo account. Type / to see wetin I fit do.`,
  (name: string) => `🐷 Abeg ${name}, na money I dey handle, no be gist 😂 Try "/dues", "split" or "/poll". Type / for the menu.`,
  (name: string) => `🤔 I no understand that one, ${name}. I fit collect dues, split bills and run polls. Type / for the menu.`,
]
let offPointTurn = 0
const offPoint = (name: string) => OFF_POINT[offPointTurn++ % OFF_POINT.length](name)

// Every message Kolo sends opens with this label, so the group can tell Kolo apart
// from a person typing on the same number. It also means no reply starts with
// "/", "Kolo" or "paid", so Kolo can't trigger itself.
const LABEL = '🐷 *Kolo*'
function sign(a: Action): Action {
  if (a.type === 'text' || a.type === 'dm') return { ...a, text: `${LABEL}\n${a.text}` }
  if (a.type === 'image') return { ...a, caption: `${LABEL}\n${a.caption}` }
  return { ...a, question: `🐷 Kolo poll: ${a.question}` }
}

// Feature guide: what each thing does and how to ask for it. [brackets] are blanks
// to fill in, never made-up people or amounts. The menu and /help <topic> both use it.
export const FEATURES = {
  dues: {
    icon: '💰',
    name: 'Collect dues',
    say: '/dues [amount] [what it is for]',
    short: 'Everyone pays the same amount. I DM each person a pay link and tick them as payments land.',
    long: 'Use it when everybody in the group owes the same amount, like class dues or a contribution. I DM each person their own Roqqu pay link, tick them on the group card the moment Roqqu confirms the money, and keep the list so nobody has to check screenshots or chase anyone.',
  },
  paid: {
    icon: '✅',
    name: 'Payments',
    say: 'paid, or /confirm @[name]',
    short: 'Pay with your link and I tick you automatically. The organiser can /confirm cash payments.',
    long: 'You don\'t need to tell me you paid: I tick you when Roqqu confirms your pay link. Saying "paid" just re-sends your link. If someone paid the organiser directly (cash or transfer), the organiser types /confirm @[name].',
  },
  status: {
    icon: '📊',
    name: 'Check progress',
    say: '/status',
    short: 'See who has paid and who has not.',
    long: 'Shows the collection that is running: how many have paid, how much is in, and the names of who has and has not paid.',
  },
  remind: {
    icon: '⏰',
    name: 'Remind people',
    say: '/remind, or Kolo remind [name]',
    short: 'I tag everyone who has not paid, or just the person you name.',
    long: 'Saves you from chasing people. /remind tags everybody who has not paid the current collection. "Kolo remind [name]" tags only that person.',
  },
  split: {
    icon: '🍔',
    name: 'Split a bill',
    say: 'Kolo split [amount] between me and [names]',
    short: 'I divide a bill equally and DM each person their share.',
    long: 'Use it when one person paid for something the group shared, like food or a ride. Tell me the total and who shared it (say "me" if you are included). I divide it equally, post who owes what, and DM each person their share so they can pay you back.',
  },
  pay: {
    icon: '💸',
    name: 'Pay someone',
    say: 'Kolo send [name] [amount]',
    short: 'I DM you a private link to confirm the payment.',
    long: 'I never move money from a group message alone. I DM you a private link; small payments within your daily limit go through with one tap, bigger ones need your fingerprint.',
  },
  poll: {
    icon: '🗳️',
    name: 'Group vote',
    say: '/poll [yes/no question]',
    short: 'Starts a yes/no vote. It passes at 3 yes.',
    long: 'For decisions about group money, like spending from the pot or investing it. I post a WhatsApp poll and announce the result when it reaches 3 yes (or 3 no).',
  },
  spend: {
    icon: '🏦',
    name: 'Spend from the pot',
    say: '/spend [amount] @[name] [what for]',
    short: 'Pay someone from the group pot. The group votes first.',
    long: 'Money everyone paid in sits in the group pot, not in anybody\'s personal account. To spend it, ask me who to pay, how much and what for. I start a vote, and only when the majority says yes do I pay them through Roqqu and post a receipt. /pot shows what is in it.',
  },
  join: {
    icon: '🔐',
    name: 'Your Kolo account',
    say: '/join',
    short: 'Get your private link to set up your own Kolo wallet with your fingerprint or face.',
    long: 'Sets up your own Kolo wallet. It is protected by your phone\'s fingerprint or face unlock, and nobody else, not even Kolo, can spend more than the limit you choose.',
  },
  cashout: {
    icon: '💸',
    name: 'Cash out',
    say: '/cashout [amount]',
    short: 'Move money from your Kolo balance to your own wallet.',
    long: 'Sends money from your Kolo balance to the wallet only your fingerprint or face controls, through Roqqu. Set the wallet up first with /join.',
  },
} as const
export type Feature = keyof typeof FEATURES

const HELP = `I keep track of your group's money so nobody has to chase anybody.
Talk to me normally, starting with "Kolo", or use a shortcut. [brackets] are what you fill in.
➕ Want me in another group? Save my number and add me like any member.

${Object.values(FEATURES)
  .map((f) => `${f.icon} *${f.name}*\n   ${f.say}\n   _${f.short}_`)
  .join('\n')}

Want more on one? Type /help [feature], e.g. /help split`

// "/help split", "/help bill", "/help vote" → the feature they mean
const ALIASES: Record<string, Feature> = { withdrawal: 'cashout', cash: 'cashout', pot: 'spend', treasury: 'spend', withdraw: 'spend', bill: 'split', share: 'split', vote: 'poll', voting: 'poll', account: 'join', wallet: 'join', send: 'pay', collect: 'dues', collection: 'dues', reminder: 'remind', progress: 'status' }
function featureFor(word: string): Feature | undefined {
  const w = word.trim().toLowerCase().replace(/^\//, '').split(/\s+/)[0]
  if (!w) return undefined
  return w in FEATURES ? (w as Feature) : ALIASES[w]
}

const explain = (f: Feature) => {
  const x = FEATURES[f]
  return `${x.icon} *${x.name}*\nHow to ask: ${x.say}\n\n${x.long}\n\n_Type / for everything I can do._`
}
