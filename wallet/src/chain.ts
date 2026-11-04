// Shared chain setup for the wallet spike: clients, contract addresses and the
// SpendPermissionManager calls Kolo's backend (the "bot") makes.
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseEther,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

export const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
export const isLocal = RPC_URL.includes('127.0.0.1') || RPC_URL.includes('localhost')
// Hardhat's first default dev account; only ever used against the local fork.
const LOCAL_DEV_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const BOT_PRIVATE_KEY = (process.env.BOT_PRIVATE_KEY ?? (isLocal ? LOCAL_DEV_KEY : undefined)) as Hex | undefined
if (!BOT_PRIVATE_KEY) throw new Error('Set BOT_PRIVATE_KEY (a funded Base Sepolia key) to run against a live network')

export const SPEND_PERMISSION_MANAGER: Address = '0xf85210B21cC50302F477BA56686d2019dC9b67Ad'
export const NATIVE_TOKEN: Address = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

// Spike stand-ins for naira amounts: 0.001 ETH plays the role of the ₦20,000 daily cap.
export const DAILY_CAP = parseEther('0.001')
export const PAYMENT = parseEther('0.0004')
export const WALLET_FUNDING = parseEther('0.003')
// The same stand-in scale for the sign-up page's naira amounts: 0.001 ETH = ₦20,000.
export const NAIRA_PER_ETH = 20_000_000
export const nairaToWei = (naira: number) => parseEther((naira / NAIRA_PER_ETH).toFixed(18))
export const weiToNaira = (wei: bigint) => Math.round(Number(wei) / 1e18 * NAIRA_PER_ETH)

export const spendPermissionComponents = [
  { name: 'account', type: 'address' },
  { name: 'spender', type: 'address' },
  { name: 'token', type: 'address' },
  { name: 'allowance', type: 'uint160' },
  { name: 'period', type: 'uint48' },
  { name: 'start', type: 'uint48' },
  { name: 'end', type: 'uint48' },
  { name: 'salt', type: 'uint256' },
  { name: 'extraData', type: 'bytes' },
] as const

const permissionInput = { name: 'spendPermission', type: 'tuple', components: spendPermissionComponents } as const

export const managerAbi = [
  {
    type: 'error',
    name: 'ExceededSpendPermission',
    inputs: [
      { name: 'value', type: 'uint256' },
      { name: 'allowance', type: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidSender',
    inputs: [
      { name: 'sender', type: 'address' },
      { name: 'expected', type: 'address' },
    ],
  },
  { type: 'error', name: 'UnauthorizedSpendPermission', inputs: [] },
  { type: 'error', name: 'InvalidSignature', inputs: [] },
  {
    type: 'function',
    name: 'approveWithSignature',
    stateMutability: 'nonpayable',
    inputs: [permissionInput, { name: 'signature', type: 'bytes' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'spend',
    stateMutability: 'nonpayable',
    inputs: [permissionInput, { name: 'value', type: 'uint160' }],
    outputs: [],
  },
  { type: 'function', name: 'isApproved', stateMutability: 'view', inputs: [permissionInput], outputs: [{ type: 'bool' }] },
  // Called by the spender (Kolo) to give up its own permission for good.
  { type: 'function', name: 'revokeAsSpender', stateMutability: 'nonpayable', inputs: [permissionInput], outputs: [] },
  {
    type: 'function',
    name: 'getCurrentPeriod',
    stateMutability: 'view',
    inputs: [permissionInput],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'start', type: 'uint48' },
          { name: 'end', type: 'uint48' },
          { name: 'spend', type: 'uint160' },
        ],
      },
    ],
  },
] as const

export type SpendPermission = {
  account: Address
  spender: Address
  token: Address
  allowance: bigint
  period: number
  start: number
  end: number
  salt: bigint
  extraData: Hex
}

export const chain = { ...baseSepolia, rpcUrls: { default: { http: [RPC_URL] } } }
export const publicClient = createPublicClient({ chain, transport: http(RPC_URL) })
export const bot = privateKeyToAccount(BOT_PRIVATE_KEY)
const botClient = createWalletClient({ account: bot, chain, transport: http(RPC_URL) })

// Hardhat refuses calls against the forked block itself, so move past it once.
export async function prepareLocalFork() {
  if (isLocal) await publicClient.request({ method: 'hardhat_mine' as any, params: ['0x1'] as any })
}

export const link = (hash: Hex) => (isLocal ? hash : `https://sepolia.basescan.org/tx/${hash}`)

// The bot signs every transaction from one key, so overlapping requests would
// race for the same nonce. Queue them; the real backend needs the same guarantee.
let queue: Promise<unknown> = Promise.resolve()

export function send(tx: { to: Address; data?: Hex; value?: bigint }) {
  const run = queue.then(async () => {
    const hash = await botClient.sendTransaction(tx)
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error(`tx reverted: ${hash}`)
    return { hash, gasUsed: receipt.gasUsed }
  })
  queue = run.catch(() => {})
  return run
}

export function newPermission(account: Address, allowance = DAILY_CAP): SpendPermission {
  const now = Math.floor(Date.now() / 1000)
  return {
    account,
    spender: bot.address,
    token: NATIVE_TOKEN,
    allowance,
    period: 86_400,
    start: now - 60,
    end: now + 30 * 86_400,
    salt: BigInt(now),
    extraData: '0x',
  }
}

export const permissionTypedData = (permission: SpendPermission) =>
  ({
    domain: {
      name: 'Spend Permission Manager',
      version: '1',
      chainId: chain.id,
      verifyingContract: SPEND_PERMISSION_MANAGER,
    },
    types: { SpendPermission: spendPermissionComponents },
    primaryType: 'SpendPermission',
    message: permission,
  }) as const

export const approveWithSignature = (permission: SpendPermission, signature: Hex) =>
  send({
    to: SPEND_PERMISSION_MANAGER,
    data: encodeFunctionData({ abi: managerAbi, functionName: 'approveWithSignature', args: [permission, signature] }),
  })

export const revokeAsSpender = (permission: SpendPermission) =>
  send({
    to: SPEND_PERMISSION_MANAGER,
    data: encodeFunctionData({ abi: managerAbi, functionName: 'revokeAsSpender', args: [permission] }),
  })

export const spend = (permission: SpendPermission, value: bigint) =>
  send({
    to: SPEND_PERMISSION_MANAGER,
    data: encodeFunctionData({ abi: managerAbi, functionName: 'spend', args: [permission, value] }),
  })

export const usedToday = async (permission: SpendPermission) =>
  (
    await publicClient.readContract({
      address: SPEND_PERMISSION_MANAGER,
      abi: managerAbi,
      functionName: 'getCurrentPeriod',
      args: [permission],
    })
  ).spend
