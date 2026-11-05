// Checks for split pay-backs, /send, /close (with a late payment), the open-collection
// guard and personal USSD PINs, with a fake payments adapter.
//   npx tsx src/features-check.ts
import { Kolo, type Action, type Incoming, type Member, type Payments } from './kolo.js'
import { ussd } from './ussd.js'

let refs = 0
const payments: Payments = {
  async link() {
    const reference = `R${++refs}`
    return { reference, url: `https://pay.example/${reference}` }
  },
  async payout() {
    return { reference: `P${++refs}`, sent: 'test' }
  },
  async groupAccount() {
    throw new Error('none')
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
const words = (actions: Action[]) => actions.map((a) => (a.type === 'image' ? a.caption : a.type === 'poll' ? a.question : a.text)).join('\n')
let failures = 0
const expect = (ok: boolean, what: string, detail?: string) => {
  console.log(`${ok ? '✓' : '✗'} ${what}${!ok && detail ? `\n    ${detail.replace(/\n/g, '\n    ')}` : ''}`)
  if (!ok) failures++
}

// Split: Koda paid 9k for food shared by three.
let out = await kolo.handle(say(ike, '/split 9k me @Excel @Clinton', [excel, clinton]))
expect(out.filter((a) => a.type === 'dm').length === 2 && words(out).includes('https://pay.example/'), 'split DMs Excel and Clinton a real pay link', words(out))
out = kolo.confirmPayment('R1')
expect(kolo.balanceOf(ike.id) === 3000, "Excel's ₦3,000 share lands in Koda's balance", words(out))

// /send from that balance.
out = await kolo.handle(say(ike, '/send @Clinton 1k', [clinton]))
expect(kolo.balanceOf(ike.id) === 2000 && kolo.balanceOf(clinton.id) === 1000, '/send moves ₦1,000 from Koda to Clinton', words(out))
out = await kolo.handle(say(clinton, '/send @Excel 5k', [excel]))
expect(kolo.balanceOf(clinton.id) === 1000 && words(out).includes('not enough'), "can't send more than your balance", words(out))

// Dues, the open-collection guard, /close and a late payment.
await kolo.handle(say(ike, '/dues 2k Class dues'))
out = await kolo.handle(say(excel, '/dues 5k Party'))
expect(words(out).includes('still open'), 'a second /dues does not wipe the open one', words(out))
out = await kolo.handle(say(excel, '/close'))
expect(words(out).includes('Only Koda'), 'only the organiser can /close', words(out))
kolo.confirmPayment('R4') // Excel pays Class dues
out = await kolo.handle(say(ike, '/close'))
expect(words(out).includes('1 of 3 paid'), '/close sums it up', words(out))
out = kolo.confirmPayment('R5') // Clinton pays after it closed
expect(kolo.potOf(group) === 4000 && words(out).includes('late payment'), 'a payment after /close still reaches the pot', words(out))

// USSD: personal PINs. Koda owes a new collection and has ₦2,000.
await kolo.handle(say(ike, '/dues 1k Snacks'))
const deps = { kolo, memberByPhone: () => ike, groupName: () => 'Kolo Test', perform: async () => {} }
let screen = await ussd('2348000000000', '1*1', deps)
expect(screen.includes('create a 4-digit'), 'first payment asks Koda to create a PIN', screen)
screen = await ussd('2348000000000', '1*1*1234', deps)
expect(screen.includes('too easy'), '1234 is refused as a PIN', screen)
screen = await ussd('2348000000000', '1*1*4821', deps)
expect(screen.startsWith('END Paid'), 'pays with the new PIN', screen)
await kolo.handle(say(excel, '/topup 5k'))
kolo.confirmPayment(`R${refs}`)
await kolo.handle(say(ike, '/close'))
await kolo.handle(say(excel, '/dues 1k Drinks'))
const asExcel = { ...deps, memberByPhone: () => excel }
await ussd('2348000000001', '1*1*7777', asExcel) // Excel's first PIN: 7777 is refused, so set 5940
await ussd('2348000000001', '1*1*5940', asExcel)
await kolo.handle(say(excel, '/close'))
await kolo.handle(say(ike, '/dues 1k Water'))
for (const pin of ['1111', '2222']) await ussd('2348000000001', `1*1*${pin}`, asExcel)
screen = await ussd('2348000000001', '1*1*3333', asExcel)
expect(screen.includes('locked'), 'three wrong PINs lock paying', screen)
screen = await ussd('2348000000001', '1*1*5940', asExcel)
expect(screen.includes('Too many'), 'even the right PIN waits out the lock', screen)

// Split for someone else: "split Clinton's 6k diapers bill among all of us" (as the AI reads it).
;(kolo as any).balances.set(ike.id, 5000) // Koda topped up earlier
const before = { ike: kolo.balanceOf(ike.id), clinton: kolo.balanceOf(clinton.id) }
out = await (kolo as any).split(say(ike, ''), 6000, [excel, clinton], true, clinton)
const linked = out.filter((a) => a.type === 'dm').map((a) => (a as { userId: string }).userId).sort()
expect(linked.join() === [excel.id, ike.id].sort().join() && words(out).includes('owes Clinton ₦2,000'), 'Koda and Excel each owe Clinton ₦2,000; Clinton gets no link', words(out))

// Paying a link from the Kolo balance (the checkout's "Pay from my Kolo balance").
const ikeLinkRef = [...(kolo as any).references].find(([, r]: any) => r.kind === 'split' && r.memberId === ike.id && r.payeeId === clinton.id)[0]
expect(kolo.balanceOfLink(ikeLinkRef) === before.ike, 'checkout sees Koda can pay from balance')
const paidFromBalance = kolo.payLinkFromBalance(ikeLinkRef)
expect(paidFromBalance.ok && kolo.balanceOf(ike.id) === before.ike - 2000 && kolo.balanceOf(clinton.id) === before.clinton + 2000, "Koda's balance pays Clinton ₦2,000", JSON.stringify(paidFromBalance))
const again = kolo.payLinkFromBalance(ikeLinkRef)
expect(!again.ok && again.reason.includes('already'), "the same link can't be paid twice", JSON.stringify(again))

// /app: a private menu link for the sender, for this group, that expires.
out = await kolo.handle(say(excel, '/app'))
const token = words(out).match(/\/app\/([a-f0-9]{32})/)?.[1] ?? ''
expect(out.some((a) => a.type === 'dm' && a.userId === excel.id) && kolo.appSession(token)?.member.id === excel.id, '/app DMs Excel a private menu link', words(out))
expect(!kolo.appSession('0'.repeat(32)), 'a made-up menu link opens nothing')
const summary = kolo.appSummary(group, excel.id)
expect(summary.dues?.title === 'Water' && summary.dues.youOwe, 'the menu shows the dues Excel owes', JSON.stringify(summary))
await kolo.handle(say(excel, '/app'))
expect(!kolo.appSession(token), 'asking again replaces the old link')

// Personal requests are answered privately: nothing in the group but a 👍.
out = await kolo.handle(say(excel, '/balance'))
expect(!out.some((a) => (a.type === 'text' || a.type === 'image') && a.chatId === group) && out.some((a) => a.type === 'dm' && a.userId === excel.id) && out.some((a) => a.type === 'react'), '/balance in the group replies in DM with a 👍', JSON.stringify(out))
out = await kolo.handle(say(excel, '/topup 2000000'))
expect(words(out).includes('₦200,000'), 'a ₦2,000,000 top-up is refused', words(out))
// A private chat with Kolo: personal things work, group things point back to the group.
const dmChat = 'excel-dm@lid'
const inDm = (text: string): Incoming => ({ chatId: dmChat, isGroup: false, sender: excel, members: [], text, mentions: [], mentionsBot: false, groupId: group })
out = await kolo.handle(inDm('/balance'))
expect(out.length === 1 && out[0].type === 'text' && out[0].chatId === dmChat && words(out).includes('balance'), '/balance works in a private chat', words(out))
out = await kolo.handle(inDm('/dues 2k'))
expect(words(out).includes('in your group'), '/dues in a private chat points back to the group', words(out))
out = await kolo.handle(inDm('/app'))
expect(/\/app\/[a-f0-9]{32}/.test(words(out)), '/app in a private chat gives a menu link for their group', words(out))

// State survives a restart (snapshot → restore).
const restored = new Kolo(undefined, payments)
restored.restore(JSON.parse(JSON.stringify(kolo.snapshot())))
expect(restored.checkPin(ike.id, '4821') && restored.balanceOf(clinton.id) === 3000, 'PINs and balances survive a restart')

console.log(failures ? `\n${failures} check(s) failed` : '\nAll feature checks passed')
process.exit(failures ? 1 : 0)
