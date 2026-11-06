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

// Kolo IDs: the Roqqu username typed at sign-up becomes the ID; a taken one falls back to the name.
await kolo.handle(say(ike, '/join'))
let joinToken = [...(kolo as any).joinTokens].find(([, w]: any) => w.memberId === ike.id)[0]
out = kolo.walletReady(joinToken, '0x' + '1'.repeat(40), '₦10,000', '@Koda')
expect(kolo.koloIdOf(ike.id) === 'koda' && words(out).includes('@koda'), "Koda's Roqqu username becomes the Kolo ID @koda", words(out))
await kolo.handle(say(clinton, '/join'))
joinToken = [...(kolo as any).joinTokens].find(([, w]: any) => w.memberId === clinton.id)[0]
out = kolo.walletReady(joinToken, '0x' + '2'.repeat(40), '₦10,000', 'koda')
expect(/^clinton\d+$/.test(kolo.koloIdOf(clinton.id) ?? '') && words(out).includes('already taken'), 'a taken username gets an ID from the name instead', words(out))
const outsider: Member = { id: 'other@s', name: 'Ada' }
out = await kolo.handle({ chatId: 'other@g.us', isGroup: true, sender: outsider, members: [outsider], text: '/send @koda 500', mentions: [], mentionsBot: false })
expect(words(out).includes('not enough'), 'someone in another group can find @koda (and needs a balance to pay)', words(out))
;(kolo as any).balances.set(outsider.id, 1000)
const kodaBefore = kolo.balanceOf(ike.id)
out = await kolo.handle({ chatId: 'other@g.us', isGroup: true, sender: outsider, members: [outsider], text: '/send @koda 500', mentions: [], mentionsBot: false })
expect(kolo.balanceOf(ike.id) === kodaBefore + 500, '/send @koda 500 pays Koda from another group', words(out))
out = await kolo.handle(say(ike, '/send @nobody99 500'))
expect(words(out).includes("don't know the Kolo ID"), 'an unknown Kolo ID is refused', words(out))
out = await kolo.handle(say(ike, '/id kodaa'))
expect(kolo.koloIdOf(ike.id) === 'kodaa' && kolo.walletOfKoloId('@kodaa') === '0x' + '1'.repeat(40), '/id kodaa changes the ID, and the wallet page can find it', words(out))

// Pot spends need a group admin's yes as well as the majority (Koda is the only admin here).
const guarded = new Kolo(undefined, payments)
guarded.restore(JSON.parse(JSON.stringify(kolo.snapshot())))
const potBefore = guarded.potOf(group)
const asAdminGroup = (sender: Member, text: string, mentions: Member[] = []): Incoming => ({ ...say(sender, text, mentions), admins: [ike.id] })
out = await guarded.handle(asAdminGroup(excel, '/spend 1k @Clinton snacks', [clinton]))
const spendPoll = out.find((a) => a.type === 'poll') as { pollId: string } | undefined
expect(!!spendPoll && words(out).includes('including a group admin (Koda)'), 'a spend vote says an admin must say yes', words(out))
out = await guarded.handlePollTally(spendPoll!.pollId, { Yes: [excel.id, clinton.id], No: [] })
expect(guarded.potOf(group) === potBefore && words(out).includes('also has to vote yes'), 'two friends voting yes without an admin pays nothing', words(out))
out = await guarded.handlePollTally(spendPoll!.pollId, { Yes: [excel.id, clinton.id, ike.id], No: [] })
expect(guarded.potOf(group) === potBefore - 1000, "with the admin's yes, the pot pays", words(out))
out = await guarded.handle(asAdminGroup(excel, '/spend 1k @Koda snacks', [ike]))
expect(!words(out).includes('including a group admin'), "the admin being paid can't approve their own payment", words(out))

// "to me" collections: a group admin (the course rep) collects into their own Kolo balance.
const repGroup = new Kolo(undefined, payments)
repGroup.restore(JSON.parse(JSON.stringify(kolo.snapshot())))
await repGroup.handle(asAdminGroup(ike, '/close'))
out = await repGroup.handle(asAdminGroup(excel, '/dues 1k Handouts to me'))
expect(words(out).includes('Only a group admin'), 'only an admin can collect to themselves', words(out))
const potBeforeRep = repGroup.potOf(group)
const kodaBeforeRep = repGroup.balanceOf(ike.id)
out = await repGroup.handle(asAdminGroup(ike, '/dues 1k Handouts to me'))
expect(words(out).includes("straight to Koda's Kolo balance (@kodaa)"), 'the card says the money goes to the rep', words(out))
const repLink = [...(repGroup as any).references].find(([, r]: any) => r.title === 'Handouts' && r.memberId === excel.id)[0]
repGroup.confirmPayment(repLink)
expect(repGroup.balanceOf(ike.id) === kodaBeforeRep + 1000 && repGroup.potOf(group) === potBeforeRep, "Excel's ₦1,000 lands in Koda's balance, not the pot")
out = await repGroup.handle(asAdminGroup(ike, '/close'))
const lateLink = [...(repGroup as any).references].find(([, r]: any) => r.title === 'Handouts' && r.memberId === clinton.id)[0]
repGroup.confirmPayment(lateLink)
expect(repGroup.balanceOf(ike.id) === kodaBeforeRep + 2000 && repGroup.potOf(group) === potBeforeRep, 'a late payment after /close still goes to the rep')

// Paying a WhatsApp contact who isn't on Kolo: the money waits for them, then lands when they join.
const contacts = new Kolo(undefined, payments)
contacts.restore(JSON.parse(JSON.stringify(kolo.snapshot())))
;(contacts as any).balances.set(ike.id, 5000)
out = await contacts.handle({ ...say(ike, '/send 2k'), contact: { name: 'Ada', phone: '2348031234567' } })
const adaJid = '2348031234567@s.whatsapp.net'
const adaLink = words(out).match(/\?t=([a-f0-9]{32})/)?.[1]
expect(contacts.balanceOf(ike.id) === 3000 && out.some((a) => a.type === 'dm' && a.userId === adaJid) && !!adaLink, 'replying /send 2k to a contact card DMs Ada a wallet link and holds ₦2,000', words(out))
out = await contacts.handle(say(ike, '/send 08031234567 500'))
expect(contacts.balanceOf(ike.id) === 2500 && words(out).includes('waiting for'), 'a typed phone number works too, and reuses her link', words(out))
out = contacts.walletReady(adaLink!, '0x' + '4'.repeat(40), '₦10,000')
expect(contacts.balanceOf(adaJid) === 2500 && words(out).includes('received ₦2,500 from Koda'), 'when Ada sets up her wallet, the ₦2,500 lands in her Kolo balance', words(out))
expect(contacts.privateMember(adaJid)?.groupId === group, 'Ada can now talk to Kolo privately')
await contacts.handle({ ...say(ike, '/send 1k'), contact: { name: 'Bayo', phone: '2348099999999' } })
out = contacts.expireClaims(Date.now() + 8 * 86_400_000)
expect(contacts.balanceOf(ike.id) === 2500 && words(out).includes("wasn't claimed"), 'an unclaimed payment goes back after 7 days', words(out))
out = await contacts.handle({ ...say(ike, '/send 1k'), contact: { name: 'Excel', phone: '2348000000001', memberId: excel.id } })
expect(words(out).includes('Sent.') && !words(out).includes('waiting for'), "a contact who's already a member is paid straight away", words(out))

// Money requests: ask a member, a Kolo ID or a contact; they pay by balance or link, or decline.
const asks = new Kolo(undefined, payments)
asks.restore(JSON.parse(JSON.stringify(kolo.snapshot())))
;(asks as any).balances.set(clinton.id, 5000)
;(asks as any).koloIds.set(excel.id, 'excel')
const kodaAsks = asks.balanceOf(ike.id)
out = await asks.handle(say(ike, '/request 2k for jollof', [clinton]))
const clintonDm = out.find((a) => a.type === 'dm' && a.userId === clinton.id)
const code = words(out).match(/\/pay (R\d{3})/)?.[1]
expect(!!clintonDm && !!code && words(out).includes('asking you for ₦2,000 for jollof') && words(out).includes('Or pay with Roqqu'), '/request DMs Clinton the amount, a /pay code and a Roqqu link', words(out))
out = await asks.handle({ ...say(clinton, `/pay ${code}`), chatId: 'clinton-dm', isGroup: false, groupId: group })
expect(asks.balanceOf(clinton.id) === 3000 && asks.balanceOf(ike.id) === kodaAsks + 2000, '/pay moves ₦2,000 from Clinton to Koda', words(out))
expect(out.some((a) => a.type === 'text' && a.chatId === group && a.text.includes('Clinton paid Koda ₦2,000 for jollof')), 'the group sees the request was paid', words(out))
out = await asks.handle({ ...say(clinton, `/pay ${code}`), chatId: 'clinton-dm', isGroup: false, groupId: group })
expect(words(out).includes("can't find"), 'a request can only be paid once', words(out))
out = await asks.handle(say(ike, '/request @excel 1500 uber'))
const excelRef = [...(asks as any).references].find(([, r]: any) => r.kind === 'request' && r.memberId === excel.id)?.[0]
expect(!!excelRef && words(out).includes('for uber'), 'a Kolo ID works for /request, with a pay link', words(out))
const kodaBeforeLink = asks.balanceOf(ike.id)
out = asks.confirmPayment(excelRef)
expect(asks.balanceOf(ike.id) === kodaBeforeLink + 1500 && words(out).includes('Excel paid your request'), 'paying the Roqqu link lands in the asker’s balance', words(out))
out = await asks.handle({ ...say(ike, '/request 3k'), contact: { name: 'Bisi', phone: '2348077777777' } })
const bisiDm = out.find((a) => a.type === 'dm' && a.userId === '2348077777777@s.whatsapp.net')
expect(!!bisiDm && words([bisiDm!]).includes('no account or app needed') && !words([bisiDm!]).includes('/pay R'), 'a contact not on Kolo gets just the pay link', words(out))
await asks.handle(say(ike, '/request 1k data', [clinton]))
out = await asks.handle({ ...say(clinton, '/decline'), chatId: 'clinton-dm', isGroup: false, groupId: group })
expect(words(out).includes('declined') && out.some((a) => a.type === 'dm' && a.userId === ike.id), '/decline tells the asker', words(out))
out = await asks.handle(say(ike, '/pay @Excel 500'))
expect(words(out).includes('Sent.'), '/pay @someone [amount] still sends money', words(out))
out = asks.expireClaims(Date.now() + 8 * 86_400_000)
expect(words(out).includes("wasn't paid in 7 days") && ![...(asks as any).requests].length, 'unpaid requests close after 7 days', words(out))

// Said casually ("Kolo abeg send 08031234567 2k", "Kolo ask @excel for 1k"): the AI reads the
// action and amount; numbers, Kolo IDs and contact cards are found like /send does.
const reads = (action: 'pay' | 'request', amount: number, unknownNames: string[] = [], title: string | null = null) =>
  async () => ({ action, amount, title, people: [], unknownNames, includeSender: false, payee: null, question: null, topic: null, reply: null, language: 'English' })
const casual = (reader: () => Promise<any>) => {
  const k = new Kolo(reader as any, payments)
  k.restore(JSON.parse(JSON.stringify(asks.snapshot())))
  ;(k as any).balances.set(ike.id, 5000)
  return k
}
let chat = casual(reads('pay', 2000, ['08031234567']))
out = await chat.handle(say(ike, 'Kolo abeg send 08031234567 2k for data'))
expect(words(out).includes('waiting for') && chat.balanceOf(ike.id) === 3000, '"Kolo send 0803… 2k" pays a phone number', words(out))
chat = casual(reads('pay', 1000, ['excel']))
out = await chat.handle(say(ike, 'Kolo send @excel 1k'))
expect(words(out).includes('Sent.') && chat.balanceOf(excel.id) === asks.balanceOf(excel.id) + 1000, '"Kolo send @excel 1k" pays a Kolo ID', words(out))
chat = casual(reads('request', 1500, [], 'the cake'))
out = await chat.handle({ ...say(ike, 'Kolo ask her for 1500 for the cake'), contact: { name: 'Bisi', phone: '2348077777777' } })
expect(words(out).includes('asking you for ₦1,500 for the cake') && out.some((a) => a.type === 'dm' && a.userId === '2348077777777@s.whatsapp.net'), '"Kolo ask her for 1500" on a contact card requests from that contact', words(out))
chat = casual(reads('request', 3000, ['Tunde']))
out = await chat.handle(say(ike, 'Kolo Tunde owes me 3k'))
expect(words(out).includes('Tunde') && !words(out).includes('Request sent'), 'an unknown name still gets asked who they mean', words(out))

// A wallet made before the wallet service kept records: /join sets up a new one, keeping balance and ID.
const oldWallets = new Kolo(undefined, payments, {
  usage: async () => { throw new Error('no Kolo wallet with that address') },
  revoke: async () => null,
})
oldWallets.restore(JSON.parse(JSON.stringify(kolo.snapshot())))
const kodaBalance = oldWallets.balanceOf(ike.id)
out = await oldWallets.handle(say(ike, '/join'))
const newToken = [...(oldWallets as any).joinTokens].find(([, w]: any) => w.memberId === ike.id)?.[0]
expect(!!newToken && words(out).includes('earlier version'), '/join with an unreachable old wallet sends a fresh sign-up link', words(out))
oldWallets.walletReady(newToken, '0x' + '3'.repeat(40), '₦10,000')
expect(oldWallets.koloIdOf(ike.id) === 'kodaa' && oldWallets.balanceOf(ike.id) === kodaBalance, 'the new wallet keeps the Kolo ID and balance')

// State survives a restart (snapshot → restore).
const restored = new Kolo(undefined, payments)
restored.restore(JSON.parse(JSON.stringify(kolo.snapshot())))
expect(restored.checkPin(ike.id, '4821') && restored.balanceOf(clinton.id) === 3000 && restored.koloIdOf(ike.id) === 'kodaa', 'PINs, balances and Kolo IDs survive a restart')

console.log(failures ? `\n${failures} check(s) failed` : '\nAll feature checks passed')
process.exit(failures ? 1 : 0)
