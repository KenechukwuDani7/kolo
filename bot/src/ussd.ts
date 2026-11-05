// USSD menu for Kolo, in Africa's Talking's format: each request carries the phone
// number and `text`, every answer so far joined by "*" ("" → menu, "1*2*4821" → pay
// the 2nd due with PIN 4821). Replies start with "CON " (expects input) or "END ".
// Screens stay short: USSD shows about 160 characters at a time.
import type { Action, Kolo, Member } from './kolo.js'

export type UssdDeps = {
  kolo: Kolo
  memberByPhone(digits: string): Member | undefined
  groupName(chatId: string): string
  // Post into the WhatsApp group what happened on USSD.
  perform(actions: Action[]): Promise<void>
}

// Each member creates their own 4-digit PIN the first time they pay. Three wrong tries
// lock paying for 30 minutes. (On a real USSD line the phone number comes from the
// network, so the PIN is the second factor; in the simulator anyone can type a number.)
const tries = new Map<string, { wrong: number; lockedUntil: number }>()
const naira = (n: number) => `N${n.toLocaleString('en-NG')}`

export async function ussd(phoneNumber: string, text: string, deps: UssdDeps): Promise<string> {
  const member = deps.memberByPhone(phoneNumber.replace(/\D/g, ''))
  if (!member) return 'END Kolo: this number is not in any Kolo group yet. Ask your group admin to add you.'

  const steps = text ? text.split('*') : []
  const [choice, pick, pin] = steps

  if (!choice) {
    return `CON Kolo - hi ${member.name.slice(0, 16)}\n1. Pay my dues\n2. My balance\n3. Group pots\n0. Exit`
  }
  if (choice === '0') return 'END Bye from Kolo.'
  if (choice === '2') return `END Your Kolo balance: ${naira(deps.kolo.balanceOf(member.id))}`
  if (choice === '3') {
    const lines = deps.kolo.groupsOf(member.id).map((chatId) => `${deps.groupName(chatId).slice(0, 18)}: ${naira(deps.kolo.potOf(chatId))}`)
    return `END Group pots:\n${lines.length ? lines.join('\n') : 'None yet.'}`
  }
  if (choice !== '1') return 'END Invalid choice. Dial again.'

  const dues = deps.kolo.duesFor(member.id).slice(0, 5)
  if (!dues.length) return 'END You have no unpaid dues. Well done!'
  if (!pick) {
    return `CON Pay which?\n${dues.map((d, i) => `${i + 1}. ${d.title.slice(0, 20)} ${naira(d.amount)}`).join('\n')}`
  }
  const due = dues[Number(pick) - 1]
  if (!due) return 'END Invalid choice. Dial again.'
  const firstTime = !deps.kolo.hasPin(member.id)
  if (!pin) {
    return `CON Pay ${naira(due.amount)} for ${due.title.slice(0, 24)} from your Kolo balance.\n${firstTime ? 'First time: create a 4-digit Kolo PIN:' : 'Enter your Kolo PIN:'}`
  }
  if (!/^\d{4}$/.test(pin)) return 'END A Kolo PIN is 4 digits. Nothing was paid.'
  const t = tries.get(member.id) ?? { wrong: 0, lockedUntil: 0 }
  if (t.lockedUntil > Date.now()) return 'END Too many wrong PINs. Try again in 30 minutes.'
  if (firstTime) {
    if (/^(\d)\1{3}$|^(1234|4321|0000)$/.test(pin)) return 'END That PIN is too easy to guess. Dial again and pick another.'
    deps.kolo.setPin(member.id, pin)
  } else if (!deps.kolo.checkPin(member.id, pin)) {
    t.wrong++
    if (t.wrong >= 3) Object.assign(t, { wrong: 0, lockedUntil: Date.now() + 30 * 60_000 })
    tries.set(member.id, t)
    return t.lockedUntil > Date.now() ? 'END Wrong PIN. Paying is locked for 30 minutes.' : `END Wrong PIN. Nothing was paid. ${3 - t.wrong} tries left.`
  }
  tries.delete(member.id)

  const result = deps.kolo.payFromBalance(due.chatId, member.id)
  if (!result.ok) return `END ${result.reason}`
  await deps.perform(result.actions)
  return `END Paid ${naira(due.amount)} for ${due.title.slice(0, 24)}. Balance: ${naira(deps.kolo.balanceOf(member.id))}. Your group has been told.`
}
