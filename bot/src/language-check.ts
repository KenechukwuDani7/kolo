// Sends the same kinds of requests in different languages through Kolo with the real AI,
// and prints what Kolo understood and how it replied.   npx tsx src/language-check.ts
import { readIntent, translate } from './intent.js'
import { Kolo, type Incoming, type Member } from './kolo.js'

const members: Member[] = [
  { id: 'ike', name: 'Ike' },
  { id: 'excel', name: 'Excel' },
  { id: 'clinton', name: 'Clinton' },
]
const cases: [string, string][] = [
  ['Igbo', 'Kolo, onye ọ bụla tinye puku abụọ maka project anyị'],
  ['Yoruba', 'Kolo, ṣe gbogbo eniyan san ẹgbẹ̀rún méjì fún project'],
  ['Hausa', 'Kolo, kowa ya biya dubu biyu don aikin mu'],
  ['Chinese', 'Kolo，每人交两千奈拉做项目'],
  ['Italian', 'Kolo, chi non ha ancora pagato?'],
  ['French', 'Kolo, partage 9000 entre moi, Excel et Clinton pour la pizza'],
  ['Pidgin', 'kolo abeg how person go add you for group?'],
  ['English', 'kolo can you lend me 5k till friday'],
]

const pause = () => new Promise((r) => setTimeout(r, 2500)) // stay under Bedrock's rate limit
for (const [label, text] of cases) {
  // A fresh Kolo per message, with a collection running so status questions have an answer.
  const kolo = new Kolo(readIntent, undefined, undefined, translate)
  const msg = (t: string, sender = members[0]): Incoming => ({ chatId: 'g', isGroup: true, sender, members, text: t, mentions: [], mentionsBot: false })
  if (label === 'Italian') await kolo.handle(msg('/dues 2000 Project'))
  try {
    const actions = await kolo.handle(msg(text))
    const said = actions.map((a) => (a.type === 'image' ? `[card] ${a.caption}` : a.type === 'poll' ? `[poll] ${a.question}` : a.text)).join('\n   ---\n')
    console.log(`\n${label}: ${text}\n   ${said.replace(/\n/g, '\n   ')}`)
  } catch (error: any) {
    console.log(`\n${label}: ERROR ${error?.status ?? ''} ${String(error?.message).slice(0, 120)}`)
  }
  await pause()
}
