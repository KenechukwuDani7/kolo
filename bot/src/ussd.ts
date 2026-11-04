// USSD menu for Kolo, in Africa's Talking's format: each request carries the phone
// number and `text`, every answer so far joined by "*" ("" → menu, "1*2*1234" → pay
// the 2nd due with PIN 1234). Replies start with "CON " (expects input) or "END ".
// Screens stay short: USSD shows about 160 characters at a time.
import type { Action, Kolo, Member } from './kolo.js'

export type UssdDeps = {
  kolo: Kolo
  memberByPhone(digits: string): Member | undefined
  groupName(chatId: string): string
  // Post into the WhatsApp group what happened on USSD.
  perform(actions: Action[]): Promise<void>
}

// Prototype PIN. A real build would set it on first use and lock after 3 wrong tries.
export const DEMO_PIN = '1234'
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
  if (!pin) return `CON Pay ${naira(due.amount)} for ${due.title.slice(0, 24)} from your Kolo balance.\nEnter PIN:`
  if (pin !== DEMO_PIN) return 'END Wrong PIN. Nothing was paid.'

  const result = deps.kolo.payFromBalance(due.chatId, member.id)
  if (!result.ok) return `END ${result.reason}`
  await deps.perform(result.actions)
  return `END Paid ${naira(due.amount)} for ${due.title.slice(0, 24)}. Balance: ${naira(deps.kolo.balanceOf(member.id))}. Your group has been told.`
}
