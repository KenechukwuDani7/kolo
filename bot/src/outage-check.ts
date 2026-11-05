// Roqqu outage drill without WhatsApp or Roqqu: a fake payments adapter that stops
// answering, then comes back. Checks Kolo keeps every request and sends it afterwards.
//   npx tsx src/outage-check.ts
import { Kolo, type Action, type Incoming, type Member, type Payments } from './kolo.js'

let down = false
let refs = 0
const fail = () => Object.assign(new Error('Roqqu not answering'), { down: true })
const payments: Payments = {
  async link() {
    if (down) throw fail()
    const reference = `R${++refs}`
    return { reference, url: `https://pay.example/${reference}` }
  },
  async payout({ amount }) {
    if (down) throw fail()
    return { reference: `P${++refs}`, sent: `${amount / 1375} USDT` }
  },
  async groupAccount() {
    if (down) throw fail()
    return '0x1111111111111111111111111111111111111111'
  },
}
const kolo = new Kolo(undefined, payments)

const group = 'group@g.us'
const ike: Member = { id: 'ike@s', name: 'Koda' }
const excel: Member = { id: 'excel@s', name: 'Excel' }
const clinton: Member = { id: 'clinton@s', name: 'Clinton' }
const say = (sender: Member, text: string, mentions: Member[] = []): Incoming => ({
  chatId: group, isGroup: true, sender, members: [ike, excel, clinton], text, mentions, mentionsBot: false,
})
const show = (label: string, actions: Action[]) => {
  console.log(`\n── ${label}`)
  for (const a of actions) {
    const where = a.type === 'dm' ? `DM ${a.userId}` : a.type
    const text = a.type === 'image' ? a.caption : a.type === 'poll' ? a.question : a.text
    console.log(`[${where}] ${text.replace(/^🐷 \*Kolo\*\n/, '')}`)
  }
}
let failures = 0
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`)
  if (!ok) failures++
}

// 1. Roqqu goes down, then a collection starts.
down = true
let out = await kolo.handle(say(ike, '/dues 2k Class dues'))
show('Roqqu down: /dues 2k', out)
expect(!out.some((a) => a.type === 'dm'), 'no pay links sent while down')
expect(kolo.waitingCount() === 3, 'three pay links kept')

out = await kolo.handle(say(excel, 'paid'))
show('Excel says "paid" while down', out)
expect(!out.some((a) => a.type === 'image'), 'Excel is not ticked on their word alone')

out = await kolo.handle(say(excel, '/topup 5k'))
show('Excel tops up while down', out)
expect(kolo.waitingCount() === 4, 'top-up kept')

out = await kolo.handle(say(ike, '/status'))
show('/status while down', out)

// 2. Retrying while still down sends nothing and keeps everything.
out = await kolo.retryWaiting()
expect(out.length === 0 && kolo.waitingCount() === 4, 'retry while still down keeps all 4')

// 3. Roqqu is back.
down = false
out = await kolo.retryWaiting()
show('Roqqu back: retry', out)
expect(out.filter((a) => a.type === 'dm').length === 4, '3 pay links + 1 top-up link sent by DM')
expect(kolo.waitingCount() === 0, 'nothing left waiting')

// 4. A paid link ticks as normal.
out = kolo.confirmPayment('R1')
show('Koda pays their link', out)
expect(out.some((a) => a.type === 'image'), 'Koda ticked')
kolo.confirmPayment('R2')
kolo.confirmPayment('R3')

// 5. A pot spend passes its vote while Roqqu is down.
await kolo.handle(say(ike, '/spend 3k @Clinton projector', [clinton]))
down = true
out = await kolo.handlePollTally('poll-1', { Yes: [ike.id, excel.id], No: [] })
show('Vote passes while down', out)
expect(kolo.potOf(group) === 6000, 'pot untouched (₦6,000)')
down = false
out = await kolo.retryWaiting()
show('Roqqu back: retry', out)
expect(kolo.potOf(group) === 3000, 'pot paid out once Roqqu is back (₦3,000 left)')

console.log(failures ? `\n${failures} check(s) failed` : '\nAll outage checks passed')
process.exit(failures ? 1 : 0)
