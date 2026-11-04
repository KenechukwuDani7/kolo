// Tiny Kolo backend for trying the wallet flow with a REAL passkey in the browser
// (Windows Hello, Touch ID, or a phone). It plays the bot's role: pays gas,
// deploys the wallet, and spends within the permission the user signed.
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage } from 'node:http'
import { formatEther, type Address, type Hex } from 'viem'
import { toCoinbaseSmartAccount, toWebAuthnAccount } from 'viem/account-abstraction'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  DAILY_CAP,
  PAYMENT,
  RPC_URL,
  SPEND_PERMISSION_MANAGER,
  WALLET_FUNDING,
  approveWithSignature,
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
  type SpendPermission,
} from './chain.js'

const PORT = Number(process.env.PORT ?? 3000)
// Read on every request so edits to the page show up without a restart.
const page = () => readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')

// One demo user at a time is enough for a spike.
let permission: SpendPermission | undefined
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
      args: [permission, PAYMENT],
    })
  } catch (error: any) {
    const reason = error?.cause?.data?.errorName
    if (!reason) throw error
    return { ok: false, reason, used: formatEther(await usedToday(permission)) }
  }
  const spent = await spend(permission, PAYMENT)
  const forward = await send({ to: chidi as Address, value: PAYMENT })
  return { ok: true, spent: link(spent.hash), forward: link(forward.hash), used: formatEther(await usedToday(permission)) }
}

const toJson = (value: unknown) => JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v))

async function readBody(req: IncomingMessage) {
  let body = ''
  for await (const chunk of req) body += chunk
  return body ? JSON.parse(body) : {}
}

const routes: Record<string, (body: any) => Promise<unknown>> = {
  async '/api/wallet'({ id, publicKey }: { id: string; publicKey: Hex }) {
    // The passkey's credential id + public key are all the backend ever sees.
    const passkey = toWebAuthnAccount({ credential: { id, publicKey } })
    const wallet = await toCoinbaseSmartAccount({ client: publicClient, owners: [passkey, SPEND_PERMISSION_MANAGER] })
    const { factory, factoryData } = await wallet.getFactoryArgs()
    const deploy = await send({ to: factory!, data: factoryData! })
    const fund = await send({ to: wallet.address, value: WALLET_FUNDING })
    permission = newPermission(wallet.address)
    return {
      address: wallet.address,
      deploy: link(deploy.hash),
      fund: link(fund.hash),
      permission,
      chainId: chain.id,
      manager: SPEND_PERMISSION_MANAGER,
      cap: formatEther(DAILY_CAP),
      payment: formatEther(PAYMENT),
    }
  },

  async '/api/approve'({ signature }: { signature: Hex }) {
    if (!permission) throw new Error('create a wallet first')
    const approve = await approveWithSignature(permission, signature)
    return { approve: link(approve.hash) }
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
