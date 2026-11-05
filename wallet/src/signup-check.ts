// Drives the running wallet server's sign-up API the way the page does, with software
// passkeys: two people sign up at the same time, then each one's limit is checked.
//   npx tsx src/signup-check.ts [http://localhost:3116]
// Run it again after restarting the test chain to see the wallets come back.
import { type Hex } from 'viem'
import { toCoinbaseSmartAccount } from 'viem/account-abstraction'
import { publicClient } from './chain.js'
import { createSoftPasskey } from './softPasskey.js'

const BASE = process.argv[2] ?? 'http://localhost:3116'
const api = async (path: string, body: unknown) => {
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json()
  if (!res.ok) throw new Error(`${path}: ${json.error}`)
  return json
}

async function signUp(limit: number) {
  const passkey = createSoftPasskey()
  const w = await api('/api/wallet', { id: passkey.id, publicKey: passkey.publicKey, limit })
  return { passkey, w }
}

async function approve({ passkey, w }: Awaited<ReturnType<typeof signUp>>) {
  const account = await toCoinbaseSmartAccount({ client: publicClient, owners: [passkey, w.manager], address: w.address })
  const p = w.permission
  const signature: Hex = await account.signTypedData({
    domain: { name: 'Spend Permission Manager', version: '1', chainId: w.chainId, verifyingContract: w.manager },
    types: {
      SpendPermission: [
        { name: 'account', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'token', type: 'address' },
        { name: 'allowance', type: 'uint160' }, { name: 'period', type: 'uint48' }, { name: 'start', type: 'uint48' },
        { name: 'end', type: 'uint48' }, { name: 'salt', type: 'uint256' }, { name: 'extraData', type: 'bytes' },
      ],
    },
    primaryType: 'SpendPermission',
    message: { ...p, allowance: BigInt(p.allowance), salt: BigInt(p.salt) },
  })
  return api('/api/approve', { address: w.address, signature })
}

// Both create wallets before either approves: the old server kept only the last one.
const a = await signUp(5_000)
const b = await signUp(20_000)
await approve(a)
await approve(b)
for (const [who, s, limit] of [['A', a, 5_000], ['B', b, 20_000]] as const) {
  const u = await api('/api/usage', { address: s.w.address })
  console.log(`${who} ${s.w.address}: limit ₦${u.limit} ${u.limit === limit ? '✓' : '✗ expected ' + limit}`)
}
const paid = await api('/api/pay', { address: a.w.address })
console.log(`demo pay from A: ${paid.ok ? '✓ paid' : '✗ ' + paid.reason}, A used ₦${paid.used}`)
console.log(`\nAddresses to recheck after a chain restart: ${a.w.address} ${b.w.address}`)
