// Runs the AI message reader over realistic group messages and scores it.
// Each call costs a fraction of a cent on Claude Haiku 4.5.
import { readIntent, type Intent, type IntentContext } from './intent.js'

const ctx: IntentContext = {
  sender: 'Koda',
  members: ['Koda', 'Excel', 'Clinton', 'Ginaa', 'Ada'],
  collection: { title: 'CSC 301 project fund', amount: 2000, unpaid: ['Clinton', 'Ginaa'] },
}

type Expect = Partial<Pick<Intent, 'action' | 'amount' | 'includeSender'>> & { people?: string[] }
const cases: [string, Expect][] = [
  ['Kolo please tell Clinton to pay up his dues', { action: 'remind', people: ['Clinton'] }],
  ['abeg remind everybody wey never pay', { action: 'remind', people: ['Clinton', 'Ginaa'] }],
  ['who never pay?', { action: 'status' }],
  ['how far the money, how much we don gather?', { action: 'status' }],
  ['abeg send Chidi 2k for data', { action: 'pay', amount: 2000, people: [] }], // Chidi isn't a member
  ['pay Ada back her 5k', { action: 'pay', amount: 5000, people: ['Ada'] }],
  ['split this 15k suya between me, Excel and Clinton', { action: 'split', amount: 15000, includeSender: true, people: ['Excel', 'Clinton'] }],
  ['make excel and ginaa share the 6k uber', { action: 'split', amount: 6000, includeSender: false, people: ['Excel', 'Ginaa'] }],
  ['everybody drop 1.5k for Clinton birthday cake', { action: 'dues', amount: 1500 }],
  ['collect two thousand naira each for the department dinner', { action: 'dues', amount: 2000 }],
  ['I don pay my own o', { action: 'paid' }],
  ['sent mine just now', { action: 'paid' }],
  ['make we vote whether we go put 50k inside MTN stock', { action: 'poll' }],
  ['should we buy the projector? put am for vote', { action: 'poll' }],
  ['how I go take open my kolo account?', { action: 'join' }],
  ['wetin you fit do?', { action: 'help' }],
  ['who go win Champions League this year', { action: 'chat' }],
  ['Kolo you too sabi abeg 😂', { action: 'chat' }],
  ['split 12k between me and clint', { action: 'split', amount: 12000, includeSender: true, people: ['Clinton'] }],
  ['tell gina say make she pay before friday', { action: 'remind', people: ['Ginaa'] }],
  ['send Clinton bills for shawarma', { action: 'split', includeSender: false, people: ['Clinton'] }],
  ['Ada owes me 3k for the uber', { action: 'split', amount: 3000, includeSender: false, people: ['Ada'] }],
  ["I don't understand this, can you explain the shawarma part", { action: 'help' }],
  ['how does the dues thing work?', { action: 'help' }],
  ['what can you do', { action: 'help' }],
]

const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((x, i) => x.toLowerCase() === [...b].sort()[i].toLowerCase())

let passed = 0
const started = Date.now()
for (const [text, expect] of cases) {
  const t = Date.now()
  try {
    const got = await readIntent(text, ctx)
    const problems = [
      expect.action && got.action !== expect.action && `action ${got.action}≠${expect.action}`,
      expect.amount !== undefined && got.amount !== expect.amount && `amount ${got.amount}≠${expect.amount}`,
      expect.includeSender !== undefined && got.includeSender !== expect.includeSender && `includeSender ${got.includeSender}`,
      expect.people && !same(got.people, expect.people) && `people [${got.people}]≠[${expect.people}]`,
    ].filter(Boolean)
    if (!problems.length) passed++
    const extra = got.reply ? `  reply: "${got.reply}"` : ''
    console.log(`${problems.length ? '❌' : '✅'} ${String(Date.now() - t).padStart(5)}ms  ${text}\n      → ${got.action} ₦${got.amount ?? '-'} [${got.people}]${got.includeSender ? ' +me' : ''}${got.question ? ` q:"${got.question}"` : ''}${got.unknownNames.length ? ` unknown:[${got.unknownNames}]` : ''}${extra}${problems.length ? `\n      ${problems.join('; ')}` : ''}`)
  } catch (error: any) {
    console.log(`💥 ${text}\n      ${error?.status ?? ''} ${String(error?.message).slice(0, 200)}`)
  }
}
console.log(`\n${passed}/${cases.length} correct · ${((Date.now() - started) / cases.length / 1000).toFixed(1)}s average`)
