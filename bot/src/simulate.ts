// Runs a scripted group chat through Kolo's logic with no phone or WhatsApp
// account, and saves every image the bot would post to ./out.
//   npm run simulate         commands only, no AI
//   npm run simulate -- --ai uses the real AI message reader (needs .env)
//   npm run simulate -- --pay   pay links from a stand-in Roqqu, confirmed by script
import { mkdirSync, writeFileSync } from 'node:fs'
import { ussd } from './ussd.js'
import { Kolo, type Action, type Incoming, type Member, type Payments, type Reader } from './kolo.js'

const useAi = process.argv.includes('--ai')
const reader: Reader | undefined = useAi ? (await import('./intent.js')).readIntent : undefined
const usePay = process.argv.includes('--pay')
const payments: Payments | undefined = usePay
  ? {
      link: async ({ member }) => ({ reference: `SIM${member.id.toUpperCase()}`, url: `https://checkout-sandbox.roqqu.io/?refId=sim-${member.id}` }),
      payout: async ({ amount }) => ({ reference: 'SIMPAYOUT1', sent: `${(amount / 1375).toFixed(2)} USDT on BSC` }),
    }
  : undefined
const kolo = new Kolo(reader, payments)
const group = 'class-group'
const people = { chinedu: 'Chinedu', ada: 'Ada', chidi: 'Chidi', tobe: 'Tobe' } as const
type Person = keyof typeof people
const members: Member[] = Object.entries(people).map(([id, name]) => ({ id, name }))
const votes: Record<string, Record<string, string[]>> = {}
let images = 0
mkdirSync('out', { recursive: true })

async function say(from: Person, text: string, mentions: Person[] = []) {
  console.log(`\n${people[from]}: ${text}`)
  const msg: Incoming = {
    chatId: group,
    isGroup: true,
    sender: { id: from, name: people[from] },
    members,
    text,
    mentions: mentions.map((m) => ({ id: m, name: people[m] })),
    mentionsBot: text.startsWith('@Kolo'),
  }
  show(await kolo.handle(msg))
}

async function vote(from: Person, pollId: string, option: 'Yes' | 'No') {
  console.log(`\n${people[from]} votes ${option}`)
  // Changing a vote moves the voter, like WhatsApp polls do.
  const tally = (votes[pollId] ??= { Yes: [], No: [] })
  for (const key of Object.keys(tally)) tally[key] = tally[key].filter((id) => id !== from)
  tally[option].push(from)
  show(await kolo.handlePollTally(pollId, tally))
}

const indent = (s: string) => s.replace(/\n/g, '\n                ')
function show(actions: Action[]) {
  for (const a of actions) {
    if (a.type === 'text') console.log(`  Kolo → group${a.reply ? ' (reply)' : ''}: ${indent(a.text)}`)
    if (a.type === 'dm') console.log(`  Kolo → DM ${a.userId}: ${indent(a.text)}`)
    if (a.type === 'poll') console.log(`  Kolo → group POLL [${a.pollId}]: ${a.question} (${a.options.join(' / ')})`)
    if (a.type === 'image') {
      const file = `out/card-${++images}.png`
      writeFileSync(file, a.png)
      console.log(`  Kolo → group IMAGE${a.reply ? ' (reply)' : ''} ${file}: ${a.caption.replace(/\n/g, ' | ')}`)
    }
  }
}

await say('ada', 'lol who dey go library') // ordinary chat: Kolo stays quiet
await say('chinedu', '/dues 2000 CSC 301 project fund')
if (usePay) {
  await say('ada', 'paid') // a message is not proof: Kolo re-sends her link
  console.log('\n[Roqqu confirms Ada and Chidi paid their links]')
  show(kolo.confirmPayment('SIMADA'))
  show(kolo.confirmPayment('SIMCHIDI'))
  show(kolo.confirmPayment('SIMCHIDI')) // a repeat confirmation does nothing
  await say('ada', '/confirm @Tobe', ['tobe']) // only the organiser may
  await say('chinedu', '/confirm @Tobe', ['tobe'])
  await say('ada', '/spend 20k @Chidi projector', ['chidi']) // more than the pot holds
  await say('ada', '/spend 5k @Chidi projector', ['chidi'])
  await vote('ada', 'poll-1', 'Yes')
  await vote('chinedu', 'poll-1', 'Yes')
  await vote('tobe', 'poll-1', 'Yes') // already settled: nothing more happens
  await say('chinedu', '/pot')
  // Chinedu has no data: he pays his dues on USSD, then the group sees it.
  const phone = (p: string) => (p === '2348011111111' ? { id: 'chinedu', name: 'Chinedu' } : undefined)
  const dial = async (text: string, from = '2348011111111') => {
    const out = await ussd(from, text, { kolo, memberByPhone: phone, groupName: () => 'CSC 301 class', perform: async (a) => show(a) })
    console.log(`\n[USSD ${from} "${text}"]\n  ${out.replace(/\n/g, '\n  ')}`)
  }
  await dial('')
  await dial('1')
  await dial('1*1')
  await dial('1*1*0000')
  await dial('1*1*1234')
  await dial('2')
  await dial('3')
  await dial('1')
  await dial('', '2349999999999')
  // Tobe sets up his own passkey wallet from the /join link, then cashes out to it.
  await say('tobe', '/cashout 3k') // no wallet yet
  await say('tobe', '/join')
  const [token] = kolo.snapshot().joinTokens.find(([, who]) => who.memberId === 'tobe')!
  console.log('\n[wallet page: passkey created, daily limit signed]')
  show(kolo.walletReady(token, '0x1234567890abcdef1234567890abcdef12345678', '0.001 ETH'))
  show(kolo.walletReady(token, '0x1234567890abcdef1234567890abcdef12345678', '0.001 ETH')) // a used link does nothing
  await say('tobe', '/cashout 3k')
  await say('tobe', '/cashout 50k') // more than his balance
} else {
  await say('ada', 'paid')
  await say('chidi', 'paid')
  await say('ada', 'paid')
}
await say('chinedu', '/status')
await say('chinedu', '/remind')
await say('ada', '@Kolo split 12k shawarma between me @Chidi @Tobe', ['chidi', 'tobe'])
await say('tobe', '/poll Invest ₦50,000 of the pot in MTN stock?')
const groupPoll = usePay ? 'poll-2' : 'poll-1' // the spend vote above is poll-1 in --pay mode
await vote('ada', groupPoll, 'Yes')
await vote('chidi', groupPoll, 'No')
await vote('chidi', groupPoll, 'Yes')
await vote('tobe', groupPoll, 'Yes')
await say('tobe', '/join')
await say('ada', 'Kolo help')
if (useAi) {
  await say('chinedu', 'Kolo please tell Tobe to pay up his dues')
  await say('ada', 'Kolo who never pay?')
  await say('chidi', 'Kolo split this 9k suya between me, ada and tobe')
  await say('tobe', 'Kolo abeg send Emeka 2k for data')
  await say('ada', 'Kolo make we vote whether we go buy projector')
  await say('chidi', 'Kolo who go win Champions League?')
} else {
  await say('chidi', '@Kolo who go win Champions League?') // no AI: off-point reply
}
