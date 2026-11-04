// Roqqu RAS client: the few endpoints Kolo uses. Test mode only (x-staging-api-key).
// Docs: https://roqqu-api-services.gitbook.io/ras
import https from 'node:https'
import dns from 'node:dns'
import { createDecipheriv } from 'node:crypto'

try {
  process.loadEnvFile('.env')
} catch {
  // no .env: rely on the real environment
}

const BASE = new URL(process.env.ROQQU_BASE ?? 'https://service.roqqu.com/v1')
const KEY = process.env.ROQQU_TEST_PRIVATE_KEY ?? ''
export const roqquEnabled = !!KEY

// Some Nigerian ISP resolvers fail on roqqu.com ("DNS server failure"), so ask
// public resolvers first and fall back to the system lookup.
const resolver = new dns.Resolver()
resolver.setServers(['8.8.8.8', '1.1.1.1'])
const lookup: typeof dns.lookup = ((host: string, options: any, callback: any) => {
  resolver.resolve4(host, (err, addresses) => {
    if (err || !addresses.length) return dns.lookup(host, options, callback)
    if (options?.all) callback(null, addresses.map((address) => ({ address, family: 4 })))
    else callback(null, addresses[0], 4)
  })
}) as any

async function call<T>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<T> {
  const url = new URL(BASE.pathname.replace(/\/$/, '') + path, BASE)
  const payload = body ? JSON.stringify(body) : undefined
  const text = await new Promise<string>((resolve, reject) => {
    const req = https.request(
      url,
      {
        method,
        lookup,
        timeout: 45_000,
        headers: {
          'x-staging-api-key': KEY,
          ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => resolve(data))
      },
    )
    req.on('timeout', () => req.destroy(new Error(`Roqqu ${path} timed out`)))
    req.on('error', reject)
    req.end(payload)
  })
  const json = JSON.parse(text)
  if (json.status !== 'success') throw new Error(`Roqqu ${path}: ${json.message}`)
  return json.data as T
}

export type PaymentLink = { refid: string; reference: string; url: string; addresses: string[] }

// A link priced in naira; the payer chooses BTC or USDT (Tron / BSC) on Roqqu's checkout page.
// Roqqu wants every field as a string, with customer_details and metadata as JSON strings.
export async function createPaymentLink(opts: {
  amountNgn: number
  reference: string // letters and digits, 1–20 characters
  name: string
  email: string
  metadata?: Record<string, string>
  successUrl?: string
}): Promise<PaymentLink> {
  const firstName = opts.name.replace(/[^\p{L}\s]/gu, '').trim().split(/\s+/)[0] || 'Kolo'
  const done = opts.successUrl ?? 'https://example.com/kolo/paid'
  const data = await call<{ refid: string; payment_reference: string; payment_link: string; wallets: { address: string }[] }>('POST', '/payment-links', {
    amount: String(opts.amountNgn),
    amount_currency: 'ngn',
    customer_details: JSON.stringify({ email: opts.email, first_name: firstName, last_name: 'Kolo' }),
    payment_reference: opts.reference,
    success_url: done,
    cancel_url: done.replace(/paid/, 'cancelled'),
    expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
    metadata: JSON.stringify(opts.metadata ?? {}),
    wallets: [
      { network: 'trc20', token: 'USDT' },
      { network: 'bep20', token: 'USDT' },
      { network: 'bitcoin', token: 'BTC' },
    ],
  })
  return { refid: data.refid, reference: data.payment_reference, url: data.payment_link, addresses: data.wallets.map((w) => w.address.toLowerCase()) }
}

export type Deposit = { address: string; value: number; token: string; network: string; hash: string; createdAt: string }

export async function deposits(): Promise<Deposit[]> {
  const rows = await call<any[]>('GET', '/transaction/token-deposit')
  return rows.map((r) => ({ address: String(r.address).toLowerCase(), value: Number(r.value), token: r.token, network: r.network, hash: r.tx_hash, createdAt: r.created_at }))
}

export async function nairaPerDollar(): Promise<number> {
  const rates = await call<{ symbol: string; rate: number }[]>('GET', '/rates')
  return rates.find((r) => r.symbol === 'ngn')?.rate ?? 0
}

// Webhook bodies arrive as { hash } encrypted with aes-256-ctr: key = the first 32
// characters of our API key, iv = the hex in the request's x-api-key header.
export function decryptWebhook(hash: string, ivHex: string): any {
  const decipher = createDecipheriv('aes-256-ctr', KEY.substring(0, 32), Buffer.from(ivHex, 'hex'))
  const text = Buffer.concat([decipher.update(Buffer.from(hash, 'hex')), decipher.final()]).toString()
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
