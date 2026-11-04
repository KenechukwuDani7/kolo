// Live check of the Roqqu sandbox: naira rate, one payment link, deposit count.
//   npx tsx src/roqqu-check.ts
import { createPaymentLink, deposits, nairaPerDollar } from './roqqu.js'

console.log('NGN per $:', await nairaPerDollar())
const link = await createPaymentLink({ amountNgn: 2000, reference: `KCHK${Date.now().toString(36).toUpperCase()}`, name: 'Kolo Check', email: 'kolo-check@example.com' })
console.log('link:', link.url, link.addresses)
console.log('deposits on the shared account:', (await deposits()).length)
