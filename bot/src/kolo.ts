// Kolo's chat logic, independent of WhatsApp or Telegram. An adapter turns
// platform events into `Incoming` messages and performs the returned actions.
//
// Two ways in, one set of handlers:
//   /commands        parsed by code, instant, no AI
//   "Kolo …" / @Kolo read by the AI message reader (if one is configured), which
//                    only proposes an Intent; the handlers below check it and act.
import { createHash } from 'node:crypto'
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
  // In a private chat with Kolo: the Kolo group the sender belongs to.
  groupId?: string
}

export type Action =
  | { type: 'text'; chatId: string; text: string; mentions?: string[]; reply?: boolean }
  | { type: 'image'; chatId: string; png: Buffer; caption: string; reply?: boolean }
  | { type: 'poll'; chatId: string; pollId: string; question: string; options: string[] }
  | { type: 'dm'; userId: string; text: string }
  // A quiet reaction on the message being answered (a personal request answered in DM).
  | { type: 'react'; chatId: string; emoji: string }

export type Reader = (text: string, ctx: IntentContext) => Promise<Intent>
// Puts Kolo's replies into another language (same number of texts back, same order).
export type Translator = (texts: string[], language: string) => Promise<string[]>

// Makes a personal pay link for one member's share (Roqqu payment links in the real
// adapter). Kolo is told about payments later through confirmPayment(reference).
export type Payments = {
  link(opts: { chatId: string; member: Member; amount: number; title: string }): Promise<{ reference: string; url: string }>
  // Pays a member out of the group pot, or to `address` (their own wallet) on cash-out;
  // `sent` describes what actually moved ("3.63 USDT on BSC").
  payout(opts: { chatId: string; member: Member; amount: number; purpose: string; address?: string }): Promise<{ reference: string; sent: string }>
  // The group's own account under Kolo's Roqqu parent account, so groups' money is never one pool.
  groupAccount(opts: { chatId: string; name: string }): Promise<string>
}

// Reads a member's passkey wallet: how much of today's limit is spent and left (on-chain).
export type WalletInfo = {
  usage(address: string): Promise<{ used: number; limit: number; left: number; resetsAt: number }>
  // Kolo gives up its spending permission on this wallet, on-chain. Returns a tx link,
  // or null when Kolo holds no permission for it (nothing to cancel).
  revoke(address: string): Promise<string | null>
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

// Read on every use: the public wallet link can change while Kolo runs (see scripts/tunnels.mjs).
const joinUrl = () => process.env.JOIN_URL ?? 'http://localhost:3116'
const naira = (n: number) => `₦${n.toLocaleString('en-NG')}`
// WhatsApp renders "@<number>" as the person's name when their id is in `mentions`.
const tag = (m: Member) => `@${m.id.split('@')[0]}`
// Starting balance before any top-up (0: money only comes in through a real top-up).
const DEMO_CREDIT = Number(process.env.DEMO_CREDIT ?? 0)
// kind: a top-up of the member's own balance, or their share of a split (paid back to payeeId).
// Dues links carry amount + title so a payment that lands after the collection closed still counts.
type PayRef = { chatId: string; memberId: string; kind?: 'topup' | 'split'; amount?: number; title?: string; name?: string; payeeId?: string; payeeName?: string }
const potLine = (pot: number) => `Group pot: ${naira(pot)}`
const payLinkText =(m: Member, c: Collection, url: string) =>
  `Hi ${m.name}! Your share of *${c.title}* is ${naira(c.amount)}.\nPay here (USDT or BTC, via Roqqu): ${url}\nI'll tick you in the group as soon as it lands.`
const topupText = (amount: number, url: string) =>
  `Top up ${naira(amount)} into your Kolo balance: ${url}\nPay with USDT or BTC through Roqqu. I'll message you as soon as it lands.`

// A Roqqu request kept while Roqqu wasn't answering. Retried, oldest first, until it goes through.
type Waiting =
  | { kind: 'link'; chatId: string; member: Member }
  | { kind: 'topup'; chatId: string; member: Member; amount: number }
  | { kind: 'cashout'; chatId: string; member: Member; amount: number }
  | { kind: 'spend'; chatId: string; spend: Spend; yes: number }
// The payment adapter marks "Roqqu didn't answer" errors with down: true (see roqqu.ts).
const isDown = (error: unknown) => (error as { down?: boolean } | undefined)?.down === true
const DOWN = "Roqqu, the payment service I use, isn't answering right now."

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
  // Pay-link reference → whose share it pays, or whose Kolo balance it tops up.
  private references = new Map<string, PayRef>()
  // The group pot: naira collected and not yet spent, per chat.
  private pots = new Map<string, number>()
  // Each member's Kolo balance: filled by top-ups, spent by USSD and cash-outs.
  private balances = new Map<string, number>()
  // /join links: one-time token → who asked, and each member's own passkey wallet address.
  private joinTokens = new Map<string, { chatId: string; memberId: string; name: string }>()
  private wallets = new Map<string, string>()
  // Who owns each wallet (member id → name and the group they joined from).
  private owners = new Map<string, { name: string; chatId: string }>()
  // Kolo IDs: member id → a short handle ("koda", shown as @koda) used instead of a 0x address.
  private koloIds = new Map<string, string>()
  // /app links: private token → who may use the Kolo web menu, for which group, until when.
  private appTokens = new Map<string, { chatId: string; member: Member; expires: number }>()
  // Members who asked to delete their account: member id → when the request expires.
  private pendingDeletes = new Map<string, number>()
  // Each group's own Roqqu account address.
  private groupAccounts = new Map<string, string>()
  // Requests kept while Roqqu was down, sent by retryWaiting() once it answers again.
  private waiting: Waiting[] = []

  // Everything Kolo must remember across restarts, as plain JSON.
  snapshot() {
    return {
      collections: [...this.collections].map(([chatId, c]) => ({ chatId, ...c, paid: [...c.paid], links: [...c.links] })),
      pots: [...this.pots],
      references: [...this.references],
      balances: [...this.balances],
      joinTokens: [...this.joinTokens],
      wallets: [...this.wallets],
      owners: [...this.owners],
      koloIds: [...this.koloIds],
      groupAccounts: [...this.groupAccounts],
      waiting: this.waiting,
      // Open votes, so a spend vote still counts after a restart.
      polls: [...this.polls],
      pollCount: this.pollCount,
      pins: [...this.pins],
    }
  }

  restore(s: ReturnType<Kolo['snapshot']>) {
    for (const { chatId, paid, links, ...c } of s.collections) this.collections.set(chatId, { ...c, paid: new Map(paid), links: new Map(links) })
    this.pots = new Map(s.pots)
    this.references = new Map(s.references)
    this.balances = new Map(s.balances ?? [])
    this.joinTokens = new Map(s.joinTokens ?? [])
    this.wallets = new Map(s.wallets ?? [])
    this.owners = new Map(s.owners ?? [])
    this.koloIds = new Map(s.koloIds ?? [])
    this.groupAccounts = new Map(s.groupAccounts ?? [])
    this.waiting = s.waiting ?? []
    this.polls = new Map(s.polls ?? [])
    this.pollCount = s.pollCount ?? 0
    this.pins = new Map(s.pins ?? [])
  }

  // ── USSD PINs: each member sets their own on first use (stored hashed, never shown) ──

  private pins = new Map<string, string>()
  private pinHash = (memberId: string, pin: string) => createHash('sha256').update(`kolo-pin:${memberId}:${pin}`).digest('hex')
  hasPin = (memberId: string) => this.pins.has(memberId)
  setPin(memberId: string, pin: string) {
    this.pins.set(memberId, this.pinHash(memberId, pin))
  }
  checkPin = (memberId: string, pin: string) => this.pins.get(memberId) === this.pinHash(memberId, pin)

  waitingCount = () => this.waiting.length

  // Send what was kept while Roqqu was down, oldest first. Stops at the first request
  // Roqqu still doesn't answer, so the rest keep their place in the queue.
  async retryWaiting(): Promise<Action[]> {
    const out: Action[] = []
    const linksSent = new Map<string, string[]>() // chat → who got their pay link
    while (this.waiting.length) {
      const job = this.waiting[0]
      try {
        const actions = await this.runWaiting(job)
        if (job.kind === 'link' && actions.length) linksSent.set(job.chatId, [...(linksSent.get(job.chatId) ?? []), job.member.name])
        out.push(...actions)
      } catch (error) {
        if (isDown(error)) break
        console.error('kept request failed:', error)
        out.push(this.refused(job, error))
      }
      this.waiting.shift()
    }
    for (const [chatId, who] of linksSent) {
      out.push({ type: 'text', chatId, text: `Roqqu is back. I've just sent the pay links I owed to ${who.join(', ')}. Check your DMs.` })
    }
    return out.map(sign)
  }

  private runWaiting(job: Waiting): Promise<Action[]> {
    switch (job.kind) {
      case 'link':
        return this.payLink(job.chatId, job.member)
      case 'topup':
        return this.topupLink(job.member, job.chatId, job.amount).then((url) => [{ type: 'dm', userId: job.member.id, text: `Roqqu is back. ${topupText(job.amount, url)}` }])
      case 'cashout':
        return this.sendCashout(job.chatId, job.member, job.amount)
      case 'spend':
        return this.sendSpend(job.chatId, job.spend, job.yes)
    }
  }

  // Roqqu answered the retry, but with a "no" (e.g. an amount below its minimum).
  private refused(job: Waiting, error: unknown): Action {
    const what =
      job.kind === 'link' ? `${job.member.name}'s pay link`
      : job.kind === 'topup' ? `${job.member.name}'s ${naira(job.amount)} top-up link`
      : job.kind === 'cashout' ? `${job.member.name}'s ${naira(job.amount)} cash-out`
      : `the ${naira(job.spend.amount)} payment to ${job.spend.to.name}`
    return { type: 'text', chatId: job.chatId, text: `Roqqu is answering again, but it turned down ${what}: ${(error as Error).message}. No money moved.` }
  }

  // What the web menu shows at the top: your balance, the pot, and the collection running.
  appSummary(chatId: string, memberId: string) {
    const c = this.collections.get(chatId)
    return {
      balance: this.balanceOf(memberId),
      pot: this.pot(chatId),
      wallet: this.wallets.get(memberId),
      dues: c && { title: c.title, amount: c.amount, paid: c.paid.size, of: c.members.length, youPaid: c.paid.has(memberId), youOwe: c.members.some((m) => m.id === memberId) && !c.paid.has(memberId) },
    }
  }

  // Log out of the web menu: the link stops working at once.
  endAppSession(token: string) {
    this.appTokens.delete(token)
  }

  // Who an /app link belongs to, while it's valid (30 minutes).
  appSession(token: string) {
    const s = this.appTokens.get(token)
    if (!s || s.expires < Date.now()) return undefined
    return s
  }

  // The wallet page's top-up button while Roqqu is down: keep it and DM the link later.
  topupLater(member: Member, chatId: string, amount: number) {
    this.waiting.push({ kind: 'topup', chatId, member, amount })
  }

  // Who a /join link is for, so the wallet page can greet them by name.
  invite(token: string) {
    const who = this.joinTokens.get(token)
    return who && { name: who.name, chatId: who.chatId }
  }

  // The wallet page finished: passkey created, wallet deployed, daily limit signed.
  // roqquUsername: what they typed on the page; it becomes their Kolo ID if it's free.
  walletReady(token: string, address: string, dailyLimit: string, roqquUsername?: string): Action[] {
    const who = this.joinTokens.get(token)
    if (!who) return []
    this.joinTokens.delete(token)
    this.wallets.set(who.memberId, address)
    this.owners.set(who.memberId, { name: who.name, chatId: who.chatId })
    const id = this.claimKoloId(who.memberId, roqquUsername, who.name)
    const asked = cleanKoloId(roqquUsername ?? '')
    const note = asked && asked !== id ? `\n(@${asked} was already taken, so ${who.name} is @${id}. They can change it with /id [new name].)` : ''
    return [
      {
        type: 'text',
        chatId: who.chatId,
        text: `${who.name} just set up their own Kolo wallet. Their Kolo ID is *@${id}*: anyone can send them money with /send @${id} [amount].\nOnly their fingerprint or face can control the wallet, and I can't spend more than ${dailyLimit} a day from it. That limit is enforced on the blockchain, not by me.${note}`,
      },
    ].map(sign)
  }

  // ── Kolo IDs: a short handle in place of a 0x address (their Roqqu username when they give one) ──

  koloIdOf = (memberId: string) => this.koloIds.get(memberId)

  // Their wanted ID if it's valid and free, else one made from their name ("koda27").
  private claimKoloId(memberId: string, wanted: string | undefined, name: string) {
    const taken = (id: string) => [...this.koloIds].some(([m, v]) => v === id && m !== memberId)
    const want = cleanKoloId(wanted ?? '')
    let id = want.length >= 3 && !taken(want) ? want : ''
    const base = cleanKoloId(name).replace(/[._]/g, '').slice(0, 12) || 'kolo'
    for (let digits = 2; !id; digits++) {
      for (let i = 0; i < 20 && !id; i++) {
        const tryId = `${base}${Math.floor(10 ** (digits - 1) + Math.random() * 9 * 10 ** (digits - 1))}`
        if (!taken(tryId)) id = tryId
      }
    }
    this.koloIds.set(memberId, id)
    return id
  }

  // Whoever has this Kolo ID (with or without the @).
  memberByKoloId(id: string): Member | undefined {
    const k = cleanKoloId(id)
    const memberId = [...this.koloIds].find(([, v]) => v === k)?.[0]
    const owner = memberId && this.owners.get(memberId)
    return owner ? { id: memberId, name: owner.name } : undefined
  }

  // The wallet behind a Kolo ID, so the wallet page can send to @koda instead of 0x….
  walletOfKoloId(id: string) {
    const member = this.memberByKoloId(id)
    return member && this.wallets.get(member.id)
  }

  // "/id": show your Kolo ID. "/id koda": change it, if it's free.
  private koloId(msg: Incoming, wanted: string | undefined): Action[] {
    if (!this.wallets.has(msg.sender.id)) return [this.text(msg, `You get a Kolo ID when you set up your wallet. Send /join to start.`)]
    const current = this.koloIds.get(msg.sender.id) ?? this.claimKoloId(msg.sender.id, undefined, msg.sender.name)
    if (!wanted) return [this.text(msg, `${msg.sender.name}, your Kolo ID is *@${current}*.\nAnyone on Kolo can send you money with /send @${current} [amount], even from another group.`)]
    const want = cleanKoloId(wanted)
    if (want.length < 3) return [this.text(msg, 'A Kolo ID needs at least 3 letters or numbers, like /id koda.')]
    if (want === current) return [this.text(msg, `You're already @${current}.`)]
    if (this.memberByKoloId(want)) return [this.text(msg, `@${want} is taken. Try another, like /id ${want}${Math.floor(10 + Math.random() * 90)}.`)]
    this.koloIds.set(msg.sender.id, want)
    return [this.text(msg, `Done. Your Kolo ID is now *@${want}*.`)]
  }

  // ── USSD: the same group money, from any phone with no data ──

  potOf = (chatId: string) => this.pot(chatId)
  balanceOf = (memberId: string) => this.balances.get(memberId) ?? DEMO_CREDIT

  // The wallet page knows only the wallet address; find its owner.
  ownerOfWallet(address: string) {
    const memberId = [...this.wallets].find(([, a]) => a.toLowerCase() === address.toLowerCase())?.[0]
    const owner = memberId && this.owners.get(memberId)
    return owner ? { memberId, ...owner, balance: this.balanceOf(memberId), koloId: this.koloIds.get(memberId) } : undefined
  }

  // A personal Roqqu pay link that adds money to this member's Kolo balance.
  async topupLink(member: Member, chatId: string, amount: number): Promise<string> {
    if (!this.payments) throw new Error('top-ups need Roqqu')
    const { reference, url } = await this.payments.link({ chatId, member, amount, title: 'Kolo top-up' })
    this.references.set(reference, { chatId, memberId: member.id, kind: 'topup', amount })
    return url
  }

  // Groups this member belongs to (any group that has run a collection with them in it).
  // "Group pot: ₦6,000 (own account 0xab…cd)"
  potText(chatId: string) {
    const account = this.groupAccounts.get(chatId)
    return `Group pot: ${naira(this.pot(chatId))}${account ? ` (own account ${account.slice(0, 6)}…${account.slice(-4)})` : ''}`
  }

  // Money sent straight to a group's own account (not through a pay link) goes into its pot.
  depositToGroup(address: string, amount: number, hash: string): Action[] {
    const chatId = [...this.groupAccounts].find(([, a]) => a.toLowerCase() === address.toLowerCase())?.[0]
    if (!chatId) return []
    this.credit(chatId, amount)
    const text = `${naira(amount)} just came into the group's account.\n${this.potText(chatId)}`
    return [{ type: 'text' as const, chatId, text }].map(sign)
  }

  groupAccountOf = (chatId: string) => this.groupAccounts.get(chatId)

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
    const done = c.paid.size === c.members.length ? "\nThat's everyone. All paid." : ''
    return { ok: true, actions: [this.duesCard(chatId, c, `${member.name} paid by USSD (no data needed).${done}`)].map(sign) }
  }

  constructor(
    private read?: Reader,
    private payments?: Payments,
    private walletInfo?: WalletInfo,
    private translate?: Translator,
  ) {}

  // The payment provider confirmed a pay link was paid: tick that member off.
  confirmPayment(reference: string, via = 'Roqqu'): Action[] {
    const ref = this.references.get(reference)
    if (ref?.kind === 'topup') {
      // A top-up: credit the member's balance once, and tell them privately.
      this.references.delete(reference)
      const balance = this.balanceOf(ref.memberId) + (ref.amount ?? 0)
      this.balances.set(ref.memberId, balance)
      return [{ type: 'dm' as const, userId: ref.memberId, text: `Top-up received: ${naira(ref.amount ?? 0)} is now in your Kolo balance. Balance: ${naira(balance)}.` }].map(sign)
    }
    if (ref?.kind === 'split') {
      // A split share: the money goes to the person who paid the bill, as Kolo balance.
      this.references.delete(reference)
      const amount = ref.amount ?? 0
      const payerName = ref.name ?? 'Someone'
      this.balances.set(ref.payeeId!, this.balanceOf(ref.payeeId!) + amount)
      return [
        { type: 'text' as const, chatId: ref.chatId, text: `${payerName} paid ${ref.payeeName} back ${naira(amount)} for the split. Confirmed by ${via}.` },
        { type: 'dm' as const, userId: ref.payeeId!, text: `${payerName} paid you back ${naira(amount)}. It's in your Kolo balance: ${naira(this.balanceOf(ref.payeeId!))}. Cash out anytime with /cashout.` },
      ].map(sign)
    }
    const c = ref && this.collections.get(ref.chatId)
    if (ref && ref.amount && (!c || c.title !== ref.title)) {
      // That collection was closed or replaced before this payment landed: the money still
      // belongs to the group, so it goes into the pot.
      this.references.delete(reference)
      this.credit(ref.chatId, ref.amount)
      return [{ type: 'text' as const, chatId: ref.chatId, text: `A late payment of ${naira(ref.amount)} for *${ref.title}* (already closed) just landed. I've added it to the pot.\n${this.potText(ref.chatId)}` }].map(sign)
    }
    const member = c?.members.find((m) => m.id === ref!.memberId)
    if (!ref || !c || !member || c.paid.has(member.id)) return []
    c.paid.set(member.id, member.name)
    this.credit(ref.chatId, c.amount)
    const done = c.paid.size === c.members.length ? "\nThat's everyone. All paid." : ''
    return [this.duesCard(ref.chatId, c, `${member.name} has paid. Confirmed by ${via}.${done}`)].map(sign)
  }

  // Everything Kolo posts back into the same chat is sent as a reply to the message that triggered it.
  async handle(msg: Incoming): Promise<Action[]> {
    const heard: { language?: string; personal?: boolean } = {}
    let actions = await this.respond(msg, heard)
    // Personal things (your balance, top-ups, your wallet) are answered privately, never in
    // the group: the reply goes to your DM and your message just gets a 👍.
    if (heard.personal && msg.isGroup) {
      actions = actions.map((a): Action => (a.type === 'text' && a.chatId === msg.chatId ? { type: 'dm', userId: msg.sender.id, text: a.text } : a))
      actions.push({ type: 'react', chatId: msg.chatId, emoji: '👍' })
    }
    actions = actions.map((a) => ((a.type === 'text' || a.type === 'image') && a.chatId === msg.chatId ? { ...a, reply: true } : a))
    return (await this.inLanguage(actions, msg, heard.language)).map(sign)
  }

  // Reply in the language the person wrote in. Only the replies meant for them are
  // translated (group replies and their own DMs); other people's DMs stay as they are.
  private async inLanguage(actions: Action[], msg: Incoming, language?: string): Promise<Action[]> {
    if (!this.translate || !language || /^(english|nigerian pidgin|pidgin|nigerian english)$/i.test(language.trim())) return actions
    const mine = (a: Action) => (a.type === 'text' || a.type === 'image' ? a.chatId === msg.chatId : a.type === 'dm' && a.userId === msg.sender.id)
    const picked = actions.filter(mine)
    if (!picked.length) return actions
    try {
      const out = await this.translate(picked.map((a) => (a.type === 'image' ? a.caption : (a as { text: string }).text)), language)
      const done = new Map(picked.map((a, i) => [a, out[i]]))
      return actions.map((a) => {
        const t = done.get(a)
        if (t === undefined) return a
        return a.type === 'image' ? { ...a, caption: t } : { ...a, text: t }
      })
    } catch (error) {
      console.error('translation failed, replying in English:', error)
      return actions
    }
  }

  // tally: option name → ids of everyone currently voting for it
  async handlePollTally(pollId: string, tally: Record<string, string[]>): Promise<Action[]> {
    return (await this.tallyPoll(pollId, tally)).map(sign)
  }

  private pot = (chatId: string) => this.pots.get(chatId) ?? 0
  private credit(chatId: string, amount: number) {
    this.pots.set(chatId, this.pot(chatId) + amount)
  }

  private async respond(msg: Incoming, heard: { language?: string; personal?: boolean }): Promise<Action[]> {
    if (!isAddressed(msg)) return [] // in groups Kolo ignores ordinary chat
    const text = msg.text.trim()
    // Group things asked in a private chat point back to the group; personal ones are marked
    // so handle() answers them privately.
    const route = (verb: string, run: () => Action[] | Promise<Action[]>) => {
      if (!msg.isGroup && GROUP_ONLY.has(verb)) return [this.text(msg, "That one happens in your group, so everyone sees it. Send it there and I'll do it.")]
      heard.personal = PERSONAL.has(verb)
      return run()
    }
    const verbOf = (command: string) => command.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    if (/^paid\b/i.test(text)) return route('paid', () => this.markPaid(msg))
    if (text.startsWith('/')) return route(verbOf(text.slice(1)), () => this.command(msg, text.slice(1)))

    const body = stripMention(text)
    if (!body) return [this.text(msg, HELP)]
    if (!this.read) return route(verbOf(body), () => this.command(msg, body))
    try {
      const intent = await this.read(body, this.context(msg))
      heard.language = intent.language
      return route(intent.action === 'pay' ? 'send' : intent.action, () => this.fromIntent(msg, intent))
    } catch (error) {
      console.error('AI reader failed, falling back to commands:', error)
      return route(verbOf(body), () => this.command(msg, body))
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
      case 'close':
        return this.close(msg)
      case 'app':
      case 'web':
        return this.appLink(msg)
      case 'send': {
        // "/send @Excel 2k" (a WhatsApp tag) or "/send @koda 2k" (a Kolo ID, any group);
        // the amount can come before or after. WhatsApp tags are @ and digits, IDs start with a letter.
        // A tag that names someone already tagged is that person; else a Kolo ID; else a group member's name.
        const amount = args.map(parseAmount).find((n) => n !== undefined)
        const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
        const tagged = new Set(msg.mentions.map((m) => key(m.name)))
        const ids = args.filter((w) => /^@[a-z][a-z0-9._]{2,}$/i.test(w) && !tagged.has(key(w)))
        const found = ids.map((w) => this.memberByKoloId(w) ?? msg.members.find((m) => key(m.name) === key(w)))
        const missing = ids.filter((_, i) => !found[i])
        if (missing.length) return [this.text(msg, `I don't know the Kolo ID ${missing.join(', ')}. Check the spelling, or ask them to send /id to see theirs.`)]
        return this.pay(msg, amount, [...msg.mentions, ...(found as Member[])], [])
      }
      case 'id':
      case 'username':
        return this.koloId(msg, args[0])
      case 'spend':
        // "/spend 5k @Excel projector"
        return this.startSpend(msg, parseAmount(args[0] ?? ''), msg.mentions, args.slice(1).filter((w) => !w.startsWith('@')).join(' '))
      case 'pot':
        return [this.text(msg, this.potText(msg.chatId))]
      case 'cashout':
        return this.cashout(msg, parseAmount(args[0] ?? ''))
      case 'limit':
        return this.limit(msg)
      case 'topup':
        return this.topup(msg, parseAmount(args[0] ?? ''))
      case 'deleteaccount':
        return /^yes$/i.test(args[0] ?? '') ? this.deleteAccount(msg) : this.askToDelete(msg)
      case 'balance':
        return [this.text(msg, `${msg.sender.name}, your Kolo balance is ${naira(this.balanceOf(msg.sender.id))}. Add money with ${FEATURES.topup.say}`)]
      case '':
      case 'kolo': // "/kolo" on its own: show the menu
      case 'menu':
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
        return this.split(msg, intent.amount ?? undefined, people, intent.includeSender, intent.payee ? this.resolve(msg, [intent.payee])[0] ?? msg.members.find((m) => m.id === msg.sender.id) : undefined)
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
      case 'app':
        return this.appLink(msg)
      case 'cashout':
        return this.cashout(msg, intent.amount ?? undefined)
      case 'limit':
        return this.limit(msg)
      case 'topup':
        return this.topup(msg, intent.amount ?? undefined)
      case 'deleteaccount':
        // The AI can only start a deletion; confirming always takes the exact command.
        return this.askToDelete(msg)
      case 'balance':
        return [this.text(msg, `${msg.sender.name}, your Kolo balance is ${naira(this.balanceOf(msg.sender.id))}. Add money with ${FEATURES.topup.say}`)]
      case 'help':
        // Explanations come from FEATURES, never from the AI, so they are always accurate.
        if (intent.topic) return [this.text(msg, explain(intent.topic))]
        // A specific question that isn't one feature (e.g. "how do I add you to a group?")
        // gets a straight answer; a general "what can you do?" gets the menu.
        return [this.text(msg, intent.reply ? `${intent.reply}\nType / to see everything I can do.` : HELP)]
      case 'chat':
        return [this.text(msg, intent.reply ?? offPoint(msg.sender.name))]
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
    // One collection per group at a time: never wipe one that people are still paying.
    const open = this.collections.get(msg.chatId)
    if (open && open.paid.size < open.members.length) {
      return [this.text(msg, `*${open.title}* is still open (${open.paid.size} of ${open.members.length} paid). ${open.organiser.name} can close it with /close first, so nobody's payment gets lost.`)]
    }
    const members = msg.members.length ? msg.members : [msg.sender]
    const collection: Collection = { title: title || 'Group dues', amount, organiser: msg.sender, members, paid: new Map(), links: new Map() }
    this.collections.set(msg.chatId, collection)
    // Links still waiting for an older collection here are replaced by this one's.
    this.waiting = this.waiting.filter((w) => !(w.kind === 'link' && w.chatId === msg.chatId))
    if (!this.payments) {
      return [this.duesCard(msg.chatId, collection, `New collection: ${collection.title}\n${naira(amount)} each · reply "paid" when done\n(Test mode: "paid" is trusted.)`)]
    }

    // The group's own account under Kolo's Roqqu parent account (made once).
    if (!this.groupAccounts.has(msg.chatId)) {
      try {
        this.groupAccounts.set(msg.chatId, await this.payments.groupAccount({ chatId: msg.chatId, name: collection.title }))
      } catch (error) {
        console.error('group account failed:', error)
      }
    }
    const account = this.groupAccounts.get(msg.chatId)

    // One personal pay link per member, so each payment says exactly who paid.
    const made = await Promise.allSettled(members.map((member) => this.payLink(msg.chatId, member)))
    const dms = made.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    const failed = made.flatMap((r, i) => (r.status === 'rejected' ? [{ member: members[i], reason: r.reason }] : []))
    for (const f of failed) console.error('pay link failed:', f.reason)
    // Roqqu not answering: keep those links and send them when it's back.
    const kept = failed.filter((f) => isDown(f.reason)).map((f) => f.member)
    for (const member of kept) this.waiting.push({ kind: 'link', chatId: msg.chatId, member })
    const missing = failed.filter((f) => !isDown(f.reason)).map((f) => f.member)
    const names = (ms: Member[]) => ms.map((m) => m.name).join(', ')
    return [
      this.duesCard(
        msg.chatId,
        collection,
        `New collection: ${collection.title}, ${naira(amount)} each.\n${
          dms.length ? `I've sent ${failed.length ? 'people' : 'everyone'} their own pay link in DM. Once Roqqu confirms your payment, I'll tick you here, no screenshots needed.` : ''
        }${
          account ? `\nThe money goes into this group's own account (${account.slice(0, 6)}…${account.slice(-4)}), not a shared pool.` : ''
        }${
          kept.length
            ? `\n${DOWN} I've saved ${dms.length ? `the links for ${names(kept)}` : "everyone's pay links"} and I'll DM them the moment it's back. Nothing is lost. If you pay ${msg.sender.name} directly meanwhile, they can /confirm you.`
            : ''
        }${
          missing.length ? `\nRoqqu wouldn't make a link for ${names(missing)}. Pay ${msg.sender.name} directly and they can /confirm you.` : ''
        }`.replace(/\n\n/, '\n'),
      ),
      ...dms,
    ]
  }

  // One member's personal pay link for the group's running collection, as a DM.
  // Throws if Roqqu fails (the caller decides whether to keep it for later).
  private async payLink(chatId: string, member: Member): Promise<Action[]> {
    const c = this.collections.get(chatId)
    // The collection may have closed or been paid by hand while the link waited.
    if (!c || c.paid.has(member.id) || !c.members.some((m) => m.id === member.id)) return []
    const { reference, url } = await this.payments!.link({ chatId, member, amount: c.amount, title: c.title })
    this.references.set(reference, { chatId, memberId: member.id, amount: c.amount, title: c.title })
    c.links.set(member.id, url)
    return [{ type: 'dm', userId: member.id, text: payLinkText(member, c, url) }]
  }

  private markPaid(msg: Incoming): Action[] {
    const collection = this.collections.get(msg.chatId)
    // Never go quiet when someone talks to Kolo.
    if (!collection) return [this.text(msg, `There's no collection running right now, ${msg.sender.name}. Start one with ${FEATURES.dues.say}`)]
    if (collection.paid.has(msg.sender.id)) return [this.text(msg, `${msg.sender.name}, you've already paid for this one.`)]
    // With pay links, a message is never proof: Kolo waits for Roqqu's confirmation.
    const link = collection.links.get(msg.sender.id)
    if (this.payments && link) {
      return [
        this.text(msg, `${msg.sender.name}, I'll tick you as soon as Roqqu confirms it. I've resent your pay link in DM in case you need it.`),
        { type: 'dm', userId: msg.sender.id, text: payLinkText(msg.sender, collection, link) },
      ]
    }
    if (this.payments) {
      const waiting = this.waiting.some((w) => w.kind === 'link' && w.chatId === msg.chatId && w.member.id === msg.sender.id)
      return [
        this.text(
          msg,
          waiting
            ? `${msg.sender.name}, your pay link is still on its way. ${DOWN} I'll DM it the moment it's back. If you paid ${collection.organiser.name} directly, they can /confirm you.`
            : `${msg.sender.name}, I don't have a pay link for you on this one. If you paid ${collection.organiser.name} directly, they can /confirm you.`,
        ),
      ]
    }
    collection.paid.set(msg.sender.id, msg.sender.name)
    this.credit(msg.chatId, collection.amount)
    return [this.duesCard(msg.chatId, collection, `${msg.sender.name} has paid.`)]
  }

  // "/app": DM a private link to Kolo's web menu, where everything here works with taps.
  private appLink(msg: Incoming): Action[] {
    const chatId = msg.isGroup ? msg.chatId : msg.groupId
    if (!chatId) return [this.text(msg, 'Type /app in your group, so I know which group the menu is for.')]
    for (const [t, s] of this.appTokens) if (s.member.id === msg.sender.id || s.expires < Date.now()) this.appTokens.delete(t)
    const token = crypto.randomUUID().replace(/-/g, '')
    this.appTokens.set(token, { chatId, member: msg.sender, expires: Date.now() + 30 * 60_000 })
    const base = (process.env.KOLO_URL ?? `http://localhost:${process.env.QR_PORT ?? 3117}`).replace(/\/$/, '')
    return [
      { type: 'dm', userId: msg.sender.id, text: `Your Kolo menu: ${base}/app/${token}\nPay dues, top up, send, split and more with a tap. The link is only for you and works for 30 minutes. Don't share it.` },
    ]
  }

  // "/close": the organiser ends the collection. Payments that land later still go to the pot.
  private close(msg: Incoming): Action[] {
    const c = this.collections.get(msg.chatId)
    if (!c) return [this.text(msg, 'No collection is running, so there is nothing to close.')]
    if (c.organiser.id !== msg.sender.id) return [this.text(msg, `Only ${c.organiser.name}, who started *${c.title}*, can close it.`)]
    this.collections.delete(msg.chatId)
    this.waiting = this.waiting.filter((w) => !(w.kind === 'link' && w.chatId === msg.chatId))
    const unpaid = this.unpaid(c)
    return [
      this.text(
        msg,
        `Closed *${c.title}*: ${c.paid.size} of ${c.members.length} paid, ${naira(c.paid.size * c.amount)} collected.${
          unpaid.length ? `\nDidn't pay: ${unpaid.map((m) => m.name).join(', ')}. If their payment lands later, it still goes into the pot.` : ''
        }\n${this.potText(msg.chatId)}`,
      ),
    ]
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
    return [this.duesCard(msg.chatId, c, `${who.map((m) => c.paid.get(m.id)).join(', ')} paid ${c.organiser.name} directly. Marked as paid.`)]
  }

  private remind(msg: Incoming, who?: Member[]): Action[] {
    const c = this.collections.get(msg.chatId)
    if (!c) return [this.text(msg, `No collection is running yet.\nStart one with: ${FEATURES.dues.say}`)]
    const targets = (who ?? this.unpaid(c)).filter((m) => !c.paid.has(m.id))
    if (!targets.length) return [this.text(msg, who ? `${who.map((m) => m.name).join(', ')} already paid.` : 'Everyone has paid. Nobody to remind.')]
    return [
      {
        type: 'text',
        chatId: msg.chatId,
        text: `Gentle reminder ${targets.map(tag).join(' ')}: your ${naira(c.amount)} for ${c.title} is still outstanding. ${c.paid.size} of ${c.members.length} have paid so far.`,
        mentions: targets.map((m) => m.id),
      },
    ]
  }

  private status(msg: Incoming): Action[] {
    const c = this.collections.get(msg.chatId)
    if (!c) return [this.text(msg, `No collection is running yet.\nStart one with: ${FEATURES.dues.say}`)]
    const unpaid = this.unpaid(c)
    const paid = [...c.paid.values()]
    const kept = this.waiting.filter((w) => w.chatId === msg.chatId).length
    return [
      this.text(
        msg,
        `*${c.title}*, ${naira(c.amount)} each\n${c.paid.size} of ${c.members.length} paid, ${naira(c.paid.size * c.amount)} collected\nPaid: ${paid.join(', ') || 'nobody yet'}\nNot yet: ${unpaid.map((m) => m.name).join(', ') || 'nobody'}\n${this.potText(msg.chatId)}${
          kept ? `\nWaiting on Roqqu: ${kept} request${kept === 1 ? '' : 's'}, sent automatically when it's back.` : ''
        }`,
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

  // Each person who owes gets their own pay link; what they pay lands in the payee's Kolo
  // balance. The payee is whoever paid the bill: the sender, unless they name someone else
  // ("split Clinton's 6k diapers bill among us" → everyone else pays Clinton, the sender too).
  private async split(msg: Incoming, amount: number | undefined, others: Member[], includeSender: boolean, payee: Member = msg.sender): Promise<Action[]> {
    if (!amount) return [this.text(msg, `How much is the whole bill?\nSay it like: ${FEATURES.split.say}`)]
    const people = [...new Map([...(includeSender ? [msg.sender] : []), ...others].map((p) => [p.id, p])).values()]
    const owing = people.filter((p) => p.id !== payee.id)
    if (!owing.length) return [this.text(msg, `Who shared it? Name them or tag them with @.\nSay it like: ${FEATURES.split.say}`)]
    const share = Math.ceil(amount / people.length)
    const lines = owing.map((p) => `• ${tag(p)} owes ${payee.name} ${naira(share)}`).join('\n')
    const forWhom = payee.id === msg.sender.id ? '' : ` for ${payee.name}`
    const dms = await Promise.all(
      owing.map(async (p): Promise<Action> => {
        const ask = `${msg.sender.name} split ${naira(amount)}${forWhom} with you. Your share: ${naira(share)}.`
        if (!this.payments) return { type: 'dm', userId: p.id, text: `${ask} Pay ${payee.name} directly.` }
        try {
          const { reference, url } = await this.payments.link({ chatId: msg.chatId, member: p, amount: share, title: `Split: pay ${payee.name}` })
          this.references.set(reference, { chatId: msg.chatId, memberId: p.id, kind: 'split', amount: share, name: p.name, payeeId: payee.id, payeeName: payee.name })
          return { type: 'dm', userId: p.id, text: `${ask}\nPay here: ${url}\nIt goes straight to ${payee.name}'s Kolo balance, and I'll tell the group once it lands.` }
        } catch (error) {
          console.error('split link failed:', error)
          return { type: 'dm', userId: p.id, text: `${ask} I couldn't make a pay link just now, so pay ${payee.name} directly.` }
        }
      }),
    )
    return [
      {
        type: 'text',
        chatId: msg.chatId,
        text: `${naira(amount)}${forWhom} split ${people.length} way${people.length === 1 ? '' : 's'} is ${naira(share)} each.\n${lines}\nI've sent each of you your own pay link in DM. It goes straight to ${payee.name}.`,
        mentions: owing.map((p) => p.id),
      },
      ...dms,
    ]
  }

  // A pay link paid from the payer's Kolo balance instead of crypto (the checkout page's
  // "Pay from my Kolo balance"). Top-up links can't be: they fill that balance.
  payLinkFromBalance(reference: string): { ok: true; actions: Action[] } | { ok: false; reason: string } {
    const ref = this.references.get(reference)
    if (!ref) return { ok: false, reason: 'This link is already paid or no longer open.' }
    if (ref.kind === 'topup' || !ref.amount) return { ok: false, reason: "This link can't be paid from a Kolo balance." }
    const balance = this.balanceOf(ref.memberId)
    if (balance < ref.amount) return { ok: false, reason: `Your Kolo balance is ${naira(balance)}, not enough for ${naira(ref.amount)}.` }
    const actions = this.confirmPayment(reference, 'their Kolo balance')
    if (!actions.length) return { ok: false, reason: 'This one is already paid.' }
    this.balances.set(ref.memberId, this.balanceOf(ref.memberId) - ref.amount)
    return { ok: true, actions }
  }

  balanceOfLink = (reference: string) => {
    const ref = this.references.get(reference)
    return ref && ref.kind !== 'topup' ? this.balanceOf(ref.memberId) : undefined
  }

  // "Kolo send Excel 2k": move money from the sender's Kolo balance to another member's, instantly.
  private pay(msg: Incoming, amount: number | undefined, to: Member[], unknown: string[]): Action[] {
    if (unknown.length) return [this.askWho(msg, unknown)]
    if (!to.length) return [this.text(msg, `Who should I pay?\nSay it like: ${FEATURES.pay.say}`)]
    if (!amount) return [this.text(msg, `How much should I send ${to.map((m) => m.name).join(' and ')}?\nSay it like: ${FEATURES.pay.say}`)]
    const people = to.filter((m) => m.id !== msg.sender.id)
    if (!people.length) return [this.text(msg, "You can't send money to yourself. Tag who should get it.")]
    const total = amount * people.length
    const balance = this.balanceOf(msg.sender.id)
    if (total > balance) return [this.text(msg, `${msg.sender.name}, your Kolo balance is ${naira(balance)}, not enough to send ${naira(total)}. Add money with ${FEATURES.topup.say}`)]
    this.balances.set(msg.sender.id, balance - total)
    for (const p of people) this.balances.set(p.id, this.balanceOf(p.id) + amount)
    return [
      this.text(msg, `Sent. ${msg.sender.name} paid ${people.map((p) => `${p.name} ${naira(amount)}`).join(', ')} from their Kolo balance.\n${msg.sender.name}'s balance: ${naira(balance - total)}`),
      ...people.map((p): Action => ({ type: 'dm', userId: p.id, text: `${msg.sender.name} sent you ${naira(amount)}. It's in your Kolo balance: ${naira(this.balanceOf(p.id))}. Cash out anytime with /cashout.` })),
    ]
  }

  private join(msg: Incoming): Action[] {
    const existing = this.wallets.get(msg.sender.id)
    if (existing) {
      const id = this.koloIds.get(msg.sender.id) ?? this.claimKoloId(msg.sender.id, undefined, msg.sender.name)
      return [this.text(msg, `${msg.sender.name}, you already have a Kolo wallet. Your Kolo ID is @${id}.\nWant your Roqqu username instead? Send /id [your Roqqu username].`)]
    }
    // A one-time token ties the wallet page back to this person and group.
    const token = crypto.randomUUID().replace(/-/g, '')
    this.joinTokens.set(token, { chatId: msg.chatId, memberId: msg.sender.id, name: msg.sender.name })
    return [
      {
        type: 'dm',
        userId: msg.sender.id,
        text: `Hi ${msg.sender.name}! Tap to set up your own Kolo wallet with your fingerprint or face (about 20 seconds): ${joinUrl()}/?t=${token}\nNo password, no seed phrase. Only your device can approve big payments.`,
      },
    ]
  }

  // "How much can Kolo still spend for me today?", read from the wallet's on-chain limit.
  private async limit(msg: Incoming): Promise<Action[]> {
    const address = this.wallets.get(msg.sender.id)
    if (!address) return [this.text(msg, `You don't have a Kolo wallet yet. Set one up with /join and pick your daily limit.`)]
    if (!this.walletInfo) return [this.text(msg, "I can't reach the wallet service right now. Try again soon.")]
    try {
      const u = await this.walletInfo.usage(address)
      const hours = Math.max(0, Math.round((u.resetsAt - Date.now()) / 3_600_000))
      const filled = Math.min(10, Math.round((u.used / u.limit) * 10))
      return [
        this.text(
          msg,
          `${msg.sender.name}, you've used ${naira(u.used)} of your ${naira(u.limit)} daily limit. *${naira(u.left)} left* for today.\n${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)}\nIt resets in about ${hours}h. Anything above it needs your fingerprint.`,
        ),
      ]
    } catch (error) {
      console.error('limit lookup failed:', error)
      return [this.text(msg, "I couldn't read your wallet just now. Try again soon.")]
    }
  }

  // "/topup 5k": DM a personal Roqqu pay link; when it's paid, the balance goes up.
  private async topup(msg: Incoming, amount: number | undefined): Promise<Action[]> {
    if (!amount) return [this.text(msg, `How much do you want to add? Say it like: ${FEATURES.topup.say}`)]
    if (amount < TOPUP_MIN || amount > TOPUP_MAX) return [this.text(msg, `Top-ups are from ${naira(TOPUP_MIN)} to ${naira(TOPUP_MAX)} at a time.`)]
    if (!this.payments) {
      this.balances.set(msg.sender.id, this.balanceOf(msg.sender.id) + amount)
      return [this.text(msg, `Added ${naira(amount)} (test mode, no money moved). Balance: ${naira(this.balanceOf(msg.sender.id))}`)]
    }
    try {
      const url = await this.topupLink(msg.sender, msg.chatId, amount)
      return [
        { type: 'dm', userId: msg.sender.id, text: topupText(amount, url) },
      ]
    } catch (error) {
      console.error('top-up link failed:', error)
      if (isDown(error)) {
        this.topupLater(msg.sender, msg.chatId, amount)
        return [this.text(msg, `${msg.sender.name}, ${DOWN} I've saved your ${naira(amount)} top-up and I'll DM your link the moment it's back.`)]
      }
      return [this.text(msg, "I couldn't make a top-up link right now. Try again in a minute.")]
    }
  }

  // Step 1 of deleting: explain what happens and ask for the exact confirmation.
  private askToDelete(msg: Incoming): Action[] {
    const balance = this.balanceOf(msg.sender.id)
    if (balance > 0) {
      return [this.text(msg, `${msg.sender.name}, you still have ${naira(balance)} in your Kolo balance. Cash it out first with ${FEATURES.cashout.say}, then ask again, so none of your money is lost.`)]
    }
    this.pendingDeletes.set(msg.sender.id, Date.now() + 5 * 60_000)
    const wallet = this.wallets.get(msg.sender.id)
    return [
      this.text(
        msg,
        `${msg.sender.name}, deleting your Kolo account will:\n• erase your name, balance record and wallet link from Kolo\n${wallet ? '• cancel my permission to spend from your wallet, on the blockchain\n' : ''}${wallet ? 'Your wallet itself stays yours, controlled by your fingerprint. ' : ''}Past group records (like dues you paid) stay so the group's books add up.\n\nTo confirm, type /deleteaccount yes within 5 minutes.`,
      ),
    ]
  }

  // Step 2: revoke Kolo's spending permission, then erase the member's data.
  private async deleteAccount(msg: Incoming): Promise<Action[]> {
    const asked = this.pendingDeletes.get(msg.sender.id)
    if (!asked || asked < Date.now()) {
      this.pendingDeletes.delete(msg.sender.id)
      return [this.text(msg, `To delete your account, start with /deleteaccount first. I'll explain what happens, then you confirm.`)]
    }
    this.pendingDeletes.delete(msg.sender.id)
    const balance = this.balanceOf(msg.sender.id)
    if (balance > 0) return [this.text(msg, `You have ${naira(balance)} in your Kolo balance now. Cash it out first, then try again.`)]
    const wallet = this.wallets.get(msg.sender.id)
    let revoked: string | null = null
    if (wallet) {
      if (!this.walletInfo) return [this.text(msg, "I can't reach the wallet service right now, so nothing was deleted. Try again soon.")]
      try {
        revoked = await this.walletInfo.revoke(wallet)
      } catch (error) {
        console.error('revoke failed:', error)
        return [this.text(msg, `I couldn't cancel my spending permission on your wallet just now, so nothing was deleted. Try again soon.`)]
      }
    }
    const id = msg.sender.id
    this.wallets.delete(id)
    this.owners.delete(id)
    this.koloIds.delete(id)
    this.balances.delete(id)
    for (const [token, who] of this.joinTokens) if (who.memberId === id) this.joinTokens.delete(token)
    for (const [ref, r] of this.references) if (r.memberId === id && r.kind === 'topup') this.references.delete(ref)
    return [
      this.text(
        msg,
        `Done, ${msg.sender.name}. Your Kolo account is deleted.${
          wallet
            ? revoked
              ? ` I can no longer spend from your wallet ${wallet.slice(0, 6)}…${wallet.slice(-4)}; that's now recorded on the blockchain. The wallet is still yours.`
              : ` I had no spending permission left on your wallet ${wallet.slice(0, 6)}…${wallet.slice(-4)}, so there was nothing to cancel. The wallet is still yours.`
            : ''
        } You can come back anytime with /join.`,
      ),
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
      return [this.text(msg, `Sent ${naira(amount)} to your wallet (test mode, no money moved). Balance: ${naira(balance - amount)}`)]
    }
    try {
      return await this.sendCashout(msg.chatId, msg.sender, amount)
    } catch (error) {
      console.error('cash-out failed:', error)
      if (isDown(error)) {
        this.waiting.push({ kind: 'cashout', chatId: msg.chatId, member: msg.sender, amount })
        return [this.text(msg, `${msg.sender.name}, ${DOWN} I've saved your ${naira(amount)} cash-out and I'll send it the moment it's back. Your balance stays ${naira(balance)} until then.`)]
      }
      return [this.text(msg, `Roqqu couldn't send it: ${(error as Error).message}. Your balance is unchanged.`)]
    }
  }

  // Throws if Roqqu fails; balance and wallet are checked again, since a kept cash-out runs later.
  private async sendCashout(chatId: string, member: Member, amount: number): Promise<Action[]> {
    const say = (text: string): Action[] => [{ type: 'text', chatId, text }]
    const address = this.wallets.get(member.id)
    const balance = this.balanceOf(member.id)
    if (!address) return say(`${member.name}, your ${naira(amount)} cash-out was cancelled: you no longer have a Kolo wallet to send it to.`)
    if (amount > balance) return say(`${member.name}, your ${naira(amount)} cash-out was cancelled: your Kolo balance is now ${naira(balance)}.`)
    const { reference, sent } = await this.payments!.payout({ chatId, member, amount, purpose: 'cash-out', address })
    this.balances.set(member.id, balance - amount)
    return say(
      `Done, ${member.name}. ${naira(amount)} (${sent}) is on its way to your wallet ${address.slice(0, 6)}…${address.slice(-4)}.\nRoqqu ref: ${reference}\nKolo balance: ${naira(balance - amount)}`,
    )
  }

  private askWho(msg: Incoming, names: string[]): Action {
    return this.text(msg, `I can't find ${names.join(' or ')} in this group. Tag them with @ so I know who you mean.`)
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
      this.text(msg, `${msg.sender.name} wants to spend ${naira(amount)} from the pot (${naira(pot)} in it). Vote below. Once ${needed} people say yes, I'll pay ${spend.to.name}.`),
      { type: 'poll', chatId: msg.chatId, pollId, question: `${question} (needs ${needed} yes)`, options: ['Yes', 'No'] },
    ]
  }

  private async paySpend(poll: Poll, spend: Spend, yes: number): Promise<Action[]> {
    const say = (text: string): Action[] => [{ type: 'text', chatId: poll.chatId, text }]
    const pot = this.pot(poll.chatId)
    if (spend.amount > pot) return say(`The vote passed, but the pot only has ${naira(pot)} now, so nothing was sent.`)
    if (!this.payments) {
      this.pots.set(poll.chatId, pot - spend.amount)
      return say(`Approved (${yes} yes). ${naira(spend.amount)} paid to ${spend.to.name} for ${spend.purpose} (test mode, no money moved).\n${this.potText(poll.chatId)}`)
    }
    try {
      return await this.sendSpend(poll.chatId, spend, yes)
    } catch (error) {
      console.error('payout failed:', error)
      if (isDown(error)) {
        this.waiting.push({ kind: 'spend', chatId: poll.chatId, spend, yes })
        return say(`The vote passed (${yes} yes). ${DOWN} I've saved the ${naira(spend.amount)} payment to ${spend.to.name} and I'll send it the moment it's back, with the receipt. The pot stays ${naira(pot)} until then.`)
      }
      return say(`The vote passed, but Roqqu couldn't send it: ${(error as Error).message}. The pot is unchanged (${naira(pot)}).`)
    }
  }

  // Throws if Roqqu fails; the pot is checked again, since a kept payment runs later.
  private async sendSpend(chatId: string, spend: Spend, yes: number): Promise<Action[]> {
    const say = (text: string): Action[] => [{ type: 'text', chatId, text }]
    const pot = this.pot(chatId)
    if (spend.amount > pot) return say(`The ${naira(spend.amount)} payment to ${spend.to.name} was cancelled: the pot only has ${naira(pot)} now.`)
    const { reference, sent } = await this.payments!.payout({ chatId, member: spend.to, amount: spend.amount, purpose: spend.purpose })
    this.pots.set(chatId, pot - spend.amount)
    return say(
      `Approved with ${yes} yes votes, so I've paid it.\n*Receipt*\n${naira(spend.amount)} (${sent}) to ${spend.to.name}\nFor: ${spend.purpose}\nAsked by: ${spend.by.name}\nRoqqu ref: ${reference}\n${this.potText(chatId)}`,
    )
  }

  private async tallyPoll(pollId: string, tally: Record<string, string[]>): Promise<Action[]> {
    const poll = this.polls.get(pollId)
    if (!poll || poll.settled) return []
    const yes = tally['Yes']?.length ?? 0
    const no = tally['No']?.length ?? 0
    if (yes >= poll.needed) {
      poll.settled = true
      if (poll.spend) return this.paySpend(poll, poll.spend, yes)
      return [{ type: 'text', chatId: poll.chatId, text: `The vote passed (${yes} yes): "${poll.question}"` }]
    }
    if (no >= poll.needed) {
      poll.settled = true
      return [{ type: 'text', chatId: poll.chatId, text: `The group voted no: "${poll.question}"` }]
    }
    return [{ type: 'text', chatId: poll.chatId, text: `"${poll.question}" so far: ${yes} yes, ${no} no. Needs ${poll.needed}.` }]
  }

  private text(msg: Incoming, text: string): Action {
    return { type: 'text', chatId: msg.chatId, text }
  }
}

const stripMention = (text: string) => text.replace(/^@?kolo\b[,:]?\s*/i, '').replace(/^@\S+\s*/, '').trim()

const OFF_POINT = [
  (name: string) => `${name}, I can only help with group money: dues, splits, votes and your Kolo wallet. Type / to see what I can do.`,
  (name: string) => `Sorry ${name}, that's not something I can do. I handle group money, like collecting dues or splitting a bill. Type / for the menu.`,
  (name: string) => `I didn't quite get that, ${name}. Try asking about dues, a split or a vote, or type / for the menu.`,
]
let offPointTurn = 0
const offPoint = (name: string) => OFF_POINT[offPointTurn++ % OFF_POINT.length](name)

// Every message Kolo sends opens with this label, so the group can tell Kolo apart
// from a person typing on the same number. It also means no reply starts with
// "/", "Kolo" or "paid", so Kolo can't trigger itself.
const LABEL = '🐷 *Kolo*'

// About one person, so answered in their DM (with a 👍 on the group message), never in the group.
const PERSONAL = new Set(['balance', 'topup', 'cashout', 'limit', 'join', 'app', 'web', 'deleteaccount', 'send', 'id', 'username'])
// A Kolo ID as stored: lower case letters, digits, dots and underscores, no @, at most 20.
const cleanKoloId = (s: string) => s.trim().toLowerCase().replace(/^@/, '').replace(/[^a-z0-9._]/g, '').slice(0, 20)
// About the group, so only done in the group.
const GROUP_ONLY = new Set(['dues', 'paid', 'confirm', 'close', 'split', 'spend', 'pot', 'poll', 'remind', 'status'])
// Top-ups per request (the wallet page uses ₦1,500 to ₦200,000).
const TOPUP_MIN = 500
const TOPUP_MAX = 200_000
function sign(a: Action): Action {
  if (a.type === 'text' || a.type === 'dm') return { ...a, text: `${LABEL}\n${a.text}` }
  if (a.type === 'image') return { ...a, caption: `${LABEL}\n${a.caption}` }
  if (a.type === 'react') return a
  return { ...a, question: `Kolo vote: ${a.question}` }
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
    say: 'paid, /confirm @[name], or /close',
    short: 'Pay with your link and I tick you automatically. The organiser can /confirm cash payments.',
    long: 'You don\'t need to tell me you paid: I tick you when Roqqu confirms your pay link. Saying "paid" just re-sends your link. If someone paid the organiser directly (cash or transfer), the organiser types /confirm @[name]. When the collection is done, the organiser types /close; payments that land after that still go into the pot.',
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
    short: 'I divide a bill equally and DM each person a link to pay you back.',
    long: 'Use it when one person paid for something the group shared, like food or a ride. Tell me the total and who shared it (say "me" if you are included). I divide it equally, post who owes what, and DM each person their own pay link. What they pay lands in your Kolo balance, and I tell the group.',
  },
  pay: {
    icon: '💸',
    name: 'Pay someone',
    say: '/send @[name or Kolo ID] [amount], or Kolo send [name] [amount]',
    short: 'Send money from your Kolo balance to someone in the group, or to any Kolo ID, instantly.',
    long: 'Moves money from your Kolo balance to theirs straight away, and DMs them. Tag someone in the group, or use their Kolo ID (like @koda) to pay anyone on Kolo, even in another group. They can spend it on dues, send it on, or cash it out to their own wallet. Top up first with /topup if your balance is low.',
  },
  id: {
    icon: '🪪',
    name: 'Your Kolo ID',
    say: '/id, or /id [new name] to change it',
    short: 'Your short Kolo ID, like @koda, so people can pay you without a long wallet address.',
    long: 'Your Kolo ID is your Roqqu username if you gave it when you set up your wallet, or one made from your name. Anyone on Kolo can send you money with /send @[your ID] [amount], even from another group. Change it any time with /id [new name] if the name is free.',
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
  limit: {
    icon: '📉',
    name: 'Your daily limit',
    say: '/limit',
    short: 'See how much of your daily limit is spent and how much is left.',
    long: 'Shows how much Kolo has spent from your own wallet today, how much of your daily limit is left, and when it resets. The limit lives on the blockchain, so even Kolo cannot go over it.',
  },
  topup: {
    icon: '➕',
    name: 'Top up',
    say: '/topup [amount]',
    short: 'Add money to your Kolo balance with your own Roqqu pay link.',
    long: 'I DM you your own Roqqu pay link for the amount you choose. Once Roqqu confirms it, the money is in your Kolo balance, ready for dues on USSD or a cash-out. /balance shows what you have.',
  },
  app: {
    icon: '📱',
    name: 'Kolo menu',
    say: '/app',
    short: 'Get a private link to do all of this with taps instead of typing.',
    long: 'I DM you a private link to the Kolo menu: pay your dues, top up, send money, split a bill, spend from the pot and more, with taps. It only works for you, for 30 minutes. What you do there shows in the group like normal.',
  },
  deleteaccount: {
    icon: '🗑️',
    name: 'Delete your account',
    say: '/deleteaccount',
    short: 'Erase your Kolo account. I ask you to confirm first.',
    long: 'Erases your name, balance record and wallet link from Kolo, and cancels my permission to spend from your wallet on the blockchain. Your wallet itself stays yours. Cash out any balance first. Past group records stay so the books add up.',
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
Want me in another group? Save my number and add me like any other member.

${Object.values(FEATURES)
  .map((f) => `*${f.name}*: ${f.say}\n${f.short}`)
  .join('\n')}

Want more on one? Type /help [feature], e.g. /help split`

// "/help split", "/help bill", "/help vote" → the feature they mean
const ALIASES: Record<string, Feature> = { username: 'id', tag: 'id', handle: 'id', web: 'app', website: 'app', menu: 'app', delete: 'deleteaccount', leave: 'deleteaccount', fund: 'topup', deposit: 'topup', balance: 'topup', withdrawal: 'cashout', cash: 'cashout', pot: 'spend', treasury: 'spend', withdraw: 'spend', bill: 'split', share: 'split', vote: 'poll', voting: 'poll', account: 'join', wallet: 'join', send: 'pay', collect: 'dues', collection: 'dues', reminder: 'remind', progress: 'status' }
function featureFor(word: string): Feature | undefined {
  const w = word.trim().toLowerCase().replace(/^\//, '').split(/\s+/)[0]
  if (!w) return undefined
  return w in FEATURES ? (w as Feature) : ALIASES[w]
}

const explain = (f: Feature) => {
  const x = FEATURES[f]
  return `*${x.name}*\nHow to ask: ${x.say}\n\n${x.long}\n\nType / for everything I can do.`
}
