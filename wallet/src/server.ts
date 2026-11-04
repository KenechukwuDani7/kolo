// Tiny Kolo backend for trying the wallet flow with a REAL passkey in the browser
// (Windows Hello, Touch ID, or a phone). It plays the bot's role: pays gas,
// deploys the wallet, and spends within the permission the user signed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage } from 'node:http'
import { formatEther, isAddress, type Address, type Hex } from 'viem'
import { balanceOf, prepareWithdraw, submitWithdraw } from './withdraw.js'
import { toCoinbaseSmartAccount, toWebAuthnAccount } from 'viem/account-abstraction'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  RPC_URL,
  SPEND_PERMISSION_MANAGER,
  WALLET_FUNDING,
  approveWithSignature,
  nairaToWei,
  weiToNaira,
  bot,
  chain,
  link,
  managerAbi,
  newPermission,
  prepareLocalFork,
  publicClient,
  send,
  spend,
  usedToday,
  revokeAsSpender,
  type SpendPermission,
} from './chain.js'

const PORT = Number(process.env.PORT ?? 3000)
// Read on every request so edits to the page show up without a restart.
const page = () => readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')

// One demo user at a time is enough for a spike.
let permission: SpendPermission | undefined
// The /join token from the user's WhatsApp DM, so Kolo knows whose wallet this is.
let joinToken: string | undefined
// The daily limit the user picked on the page, and the demo payment the bot makes.
let limitNaira = 10_000
const DEMO_PAYMENT_NAIRA = 4_000
const LIMIT_CHOICES = [5_000, 10_000, 20_000]
const BOT_URL = process.env.KOLO_BOT_URL ?? 'http://localhost:3117'

// Every wallet made here, by address, so anyone can check their limit later
// (the page, and /limit in WhatsApp). Saved to data/wallets.json.
const WALLETS_FILE = 'data/wallets.json'
// credentialId + publicKey let the owner sign in with their passkey later, Kolo account or not.
// revoked: Kolo gave up its spend permission (account deleted); the wallet is still the owner's.
type WalletRecord = { permission: SpendPermission; limitNaira: number; credentialId?: string; publicKey?: Hex; revoked?: boolean }
const wallets = new Map<string, WalletRecord>(
  existsSync(WALLETS_FILE)
    ? JSON.parse(readFileSync(WALLETS_FILE, 'utf8')).map(([address, w]: [string, any]) => [
        address,
        { ...w, permission: { ...w.permission, allowance: BigInt(w.permission.allowance), salt: BigInt(w.permission.salt) } },
      ])
    : [],
)
function saveWallets() {
  mkdirSync('data', { recursive: true })
  writeFileSync(WALLETS_FILE, toJson([...wallets]))
}

function byCredential(credentialId: string): [string, WalletRecord] {
  const found = [...wallets].find(([, w]) => w.credentialId && w.credentialId === credentialId)
  if (!found || !found[1].publicKey) throw new Error('no Kolo wallet for this passkey on this device')
  return found
}

// How much of today's limit is spent, what's left, and when the day resets (on-chain truth).
async function usage(address?: string) {
  const w = address ? wallets.get(address.toLowerCase()) : permission && wallets.get(permission.account.toLowerCase())
  if (!w) throw new Error('no Kolo wallet with that address')
  const period = await publicClient.readContract({ address: SPEND_PERMISSION_MANAGER, abi: managerAbi, functionName: 'getCurrentPeriod', args: [w.permission] })
  const used = weiToNaira(period.spend)
  return { used, limit: w.limitNaira, left: Math.max(0, w.limitNaira - used), resetsAt: Number(period.end) * 1000 }
}

// Tell the WhatsApp bot the wallet is ready; it announces it in the group.
async function tellKolo(address: Address) {
  if (!joinToken) return false
  try {
    const res = await fetch(`${BOT_URL}/wallet/registered`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: joinToken, address, dailyLimit: `₦${limitNaira.toLocaleString('en-NG')}` }),
    })
    return res.ok
  } catch {
    return false
  }
}
const chidi = privateKeyToAccount(generatePrivateKey()).address

let payQueue: Promise<unknown> = Promise.resolve()

async function pay() {
  if (!permission) throw new Error('create a wallet first')
  // Check against the contract first so a cap rejection is reported as exactly that.
  try {
    await publicClient.simulateContract({
      account: bot,
      address: SPEND_PERMISSION_MANAGER,
      abi: managerAbi,
      functionName: 'spend',
      args: [permission, nairaToWei(DEMO_PAYMENT_NAIRA)],
    })
  } catch (error: any) {
    const reason = error?.cause?.data?.errorName
    if (!reason) throw error
    return { ok: false, reason, used: weiToNaira(await usedToday(permission)) }
  }
  const value = nairaToWei(DEMO_PAYMENT_NAIRA)
  const spent = await spend(permission, value)
  const forward = await send({ to: chidi as Address, value })
  return { ok: true, spent: link(spent.hash), forward: link(forward.hash), used: weiToNaira(await usedToday(permission)) }
}

const toJson = (value: unknown) => JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v))

async function readBody(req: IncomingMessage) {
  let body = ''
  for await (const chunk of req) body += chunk
  return body ? JSON.parse(body) : {}
}

const routes: Record<string, (body: any) => Promise<unknown>> = {
  // Who this link is for, so the page can greet them: { name, group } from the bot.
  async '/api/invite'({ token }: { token?: string }) {
    try {
      const res = await fetch(`${BOT_URL}/wallet/invite?t=${encodeURIComponent(token ?? '')}`)
      return res.ok ? await res.json() : {}
    } catch {
      return {}
    }
  },

  async '/api/wallet'({ id, publicKey, token, limit }: { id: string; publicKey: Hex; token?: string; limit?: number }) {
    joinToken = token || undefined
    limitNaira = LIMIT_CHOICES.includes(Number(limit)) ? Number(limit) : 10_000
    // The passkey's credential id + public key are all the backend ever sees.
    const passkey = toWebAuthnAccount({ credential: { id, publicKey } })
    const wallet = await toCoinbaseSmartAccount({ client: publicClient, owners: [passkey, SPEND_PERMISSION_MANAGER] })
    const { factory, factoryData } = await wallet.getFactoryArgs()
    const deploy = await send({ to: factory!, data: factoryData! })
    const fund = await send({ to: wallet.address, value: WALLET_FUNDING })
    permission = newPermission(wallet.address, nairaToWei(limitNaira))
    wallets.set(wallet.address.toLowerCase(), { permission, limitNaira, credentialId: id, publicKey })
    saveWallets()
    return {
      address: wallet.address,
      deploy: link(deploy.hash),
      fund: link(fund.hash),
      permission,
      chainId: chain.id,
      manager: SPEND_PERMISSION_MANAGER,
      limit: limitNaira,
      payment: DEMO_PAYMENT_NAIRA,
    }
  },

  async '/api/approve'({ signature }: { signature: Hex }) {
    if (!permission) throw new Error('create a wallet first')
    const approve = await approveWithSignature(permission, signature)
    return { approve: link(approve.hash), toldKolo: await tellKolo(permission.account) }
  },

  // Owner's name and Kolo balance, and top-up links, come from the bot.
  async '/api/balance'({ address }: { address: string }) {
    const res = await fetch(`${BOT_URL}/wallet/balance?address=${encodeURIComponent(address)}`)
    return res.ok ? res.json() : {}
  },

  async '/api/topup'({ address, amount }: { address: string; amount: number }) {
    const res = await fetch(`${BOT_URL}/wallet/topup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address, amount }) })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error)
    return json
  },

  // ── The owner's own wallet, signed in with their passkey (works after leaving Kolo) ──

  async '/api/me'({ credentialId }: { credentialId: string }) {
    const [address, w] = byCredential(credentialId)
    const balance = await balanceOf(address as Address)
    return { address, publicKey: w.publicKey, balance: weiToNaira(balance), balanceEth: formatEther(balance), linkedToKolo: !w.revoked }
  },

  async '/api/withdraw/prepare'({ credentialId, to }: { credentialId: string; to: string }) {
    if (!isAddress(to)) throw new Error('that is not a valid wallet address')
    const [address, w] = byCredential(credentialId)
    const value = await balanceOf(address as Address)
    if (value === 0n) throw new Error('this wallet is empty')
    return prepareWithdraw({ id: credentialId, publicKey: w.publicKey! }, address as Address, to as Address, value)
  },

  async '/api/withdraw/submit'({ credentialId, op }: { credentialId: string; op: Record<string, string> }) {
    const [address] = byCredential(credentialId)
    if (String(op.sender).toLowerCase() !== address) throw new Error('that operation is for another wallet')
    const big = (k: string) => BigInt(op[k])
    const { hash } = await submitWithdraw({
      sender: op.sender as Address, nonce: big('nonce'), initCode: op.initCode as Hex, callData: op.callData as Hex,
      callGasLimit: big('callGasLimit'), verificationGasLimit: big('verificationGasLimit'), preVerificationGas: big('preVerificationGas'),
      maxFeePerGas: big('maxFeePerGas'), maxPriorityFeePerGas: big('maxPriorityFeePerGas'), paymasterAndData: op.paymasterAndData as Hex, signature: op.signature as Hex,
    })
    return { tx: link(hash), balance: weiToNaira(await balanceOf(address as Address)) }
  },

  '/api/usage'({ address }: { address?: string }) {
    return usage(address)
  },

  '/api/pay'() {
    // One payment at a time, so the cap check below sees every earlier spend.
    const run = payQueue.then(pay)
    payQueue = run.catch(() => {})
    return run
  },

  // The page signs with the wallet's replay-safe domain, which needs a read-only RPC.
  async '/rpc'(body) {
    const res = await fetch(RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return res.json()
  },
}

await prepareLocalFork()

createServer(async (req, res) => {
  // Revoking is for the bot on this machine only. Anything through the public HTTPS
  // proxy carries X-Forwarded-For, so it can never revoke someone else's permission.
  if (req.method === 'POST' && req.url === '/internal/revoke') {
    if (req.headers['x-forwarded-for']) {
      res.writeHead(403).end()
      return
    }
    try {
      const { address } = await readBody(req)
      const w = wallets.get(String(address).toLowerCase())
      if (!w) {
        // Not made on this network (e.g. before a move): Kolo holds no permission to revoke.
        res.writeHead(200, { 'content-type': 'application/json' }).end(toJson({ revoked: null }))
        return
      }
      const tx = await revokeAsSpender(w.permission)
      wallets.set(String(address).toLowerCase(), { ...w, revoked: true })
      saveWallets()
      res.writeHead(200, { 'content-type': 'application/json' }).end(toJson({ revoked: link(tx.hash) }))
    } catch (error: any) {
      res.writeHead(400, { 'content-type': 'application/json' }).end(toJson({ error: error?.shortMessage ?? String(error?.message ?? error) }))
    }
    return
  }
  const route = routes[req.url ?? '']
  if (req.method === 'POST' && route) {
    try {
      const result = await route(await readBody(req))
      res.writeHead(200, { 'content-type': 'application/json' }).end(toJson(result))
    } catch (error: any) {
      res.writeHead(500, { 'content-type': 'application/json' }).end(toJson({ error: error?.shortMessage ?? String(error) }))
    }
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page())
}).listen(PORT, () => {
  console.log(`Kolo wallet spike: http://localhost:${PORT}  (bot ${bot.address}, RPC ${RPC_URL})`)
})
