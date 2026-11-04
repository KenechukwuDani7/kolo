// Kolo wallet spike: passkey smart wallet + capped bot allowance on Base Sepolia.
//
// What this proves:
//   1. A user wallet controlled by a passkey (no seed phrase) can be created with gas paid by Kolo.
//   2. The user signs ONE permission with their passkey: "the bot may spend up to X per day".
//   3. The bot can pay within that cap without asking the user again.
//   4. The bot is blocked on-chain from going over the cap, and nobody else can use the permission.
//
// Run against a local fork (default) or real Base Sepolia (set RPC_URL + BOT_PRIVATE_KEY).
import { formatEther } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { toCoinbaseSmartAccount } from 'viem/account-abstraction'
import {
  DAILY_CAP,
  PAYMENT,
  RPC_URL,
  SPEND_PERMISSION_MANAGER,
  WALLET_FUNDING,
  approveWithSignature,
  bot,
  isLocal,
  link,
  managerAbi,
  newPermission,
  permissionTypedData,
  prepareLocalFork,
  publicClient,
  send,
  spend,
  usedToday,
} from './chain.js'
import { createSoftPasskey } from './softPasskey.js'

const step = (n: number, text: string) => console.log(`\n[${n}] ${text}`)

async function main() {
  await prepareLocalFork()
  console.log(`Network: ${isLocal ? 'local Base Sepolia fork' : 'Base Sepolia'} (${RPC_URL})`)
  console.log(`Bot (spender + gas payer): ${bot.address}  balance ${formatEther(await publicClient.getBalance({ address: bot.address }))} ETH`)

  const code = await publicClient.getCode({ address: SPEND_PERMISSION_MANAGER })
  if (!code || code === '0x') throw new Error('SpendPermissionManager not found on this network')

  step(1, 'User creates a passkey (fingerprint / face unlock on a phone)')
  const passkey = createSoftPasskey()
  console.log(`    passkey public key: ${passkey.publicKey.slice(0, 22)}…`)

  step(2, "Kolo creates the user's smart wallet. Owners: [user passkey, SpendPermissionManager]")
  const wallet = await toCoinbaseSmartAccount({
    client: publicClient,
    owners: [passkey, SPEND_PERMISSION_MANAGER],
    ownerIndex: 0,
  })
  const { factory, factoryData } = await wallet.getFactoryArgs()
  const deploy = await send({ to: factory!, data: factoryData! })
  console.log(`    wallet: ${wallet.address}`)
  console.log(`    deployed, gas paid by Kolo (${deploy.gasUsed} gas): ${link(deploy.hash)}`)

  const fund = await send({ to: wallet.address, value: WALLET_FUNDING })
  console.log(`    funded with ${formatEther(WALLET_FUNDING)} ETH (stands in for a Roqqu top-up): ${link(fund.hash)}`)

  step(3, `User signs ONE permission with their passkey: bot may spend ${formatEther(DAILY_CAP)} ETH per day`)
  const permission = newPermission(wallet.address)
  const signature = await wallet.signTypedData(permissionTypedData(permission))
  const approve = await approveWithSignature(permission, signature)
  const approved = await publicClient.readContract({
    address: SPEND_PERMISSION_MANAGER,
    abi: managerAbi,
    functionName: 'isApproved',
    args: [permission],
  })
  console.log(`    passkey signature verified on-chain, permission approved = ${approved}: ${link(approve.hash)}`)

  const chidi = privateKeyToAccount(generatePrivateKey()).address
  for (const n of [1, 2]) {
    step(3 + n, `Bot pays Chidi ${formatEther(PAYMENT)} ETH ("send Chidi 2k for data") without asking the user again`)
    const spent = await spend(permission, PAYMENT)
    // The spike forwards from the bot; the real build uses a router contract that spends and forwards in one transaction.
    const forward = await send({ to: chidi, value: PAYMENT })
    console.log(`    spent: ${link(spent.hash)}`)
    console.log(`    delivered to Chidi: ${link(forward.hash)}`)
    console.log(`    used today: ${formatEther(await usedToday(permission))} / ${formatEther(DAILY_CAP)} ETH`)
  }

  step(6, `Bot tries a third ${formatEther(PAYMENT)} ETH payment, which would go over the daily cap`)
  await expectRevert(() =>
    publicClient.simulateContract({
      account: bot,
      address: SPEND_PERMISSION_MANAGER,
      abi: managerAbi,
      functionName: 'spend',
      args: [permission, PAYMENT],
    }),
  )

  step(7, 'An attacker who copies the permission tries to use it')
  const attacker = privateKeyToAccount(generatePrivateKey())
  await expectRevert(() =>
    publicClient.simulateContract({
      account: attacker,
      address: SPEND_PERMISSION_MANAGER,
      abi: managerAbi,
      functionName: 'spend',
      args: [permission, 1n],
    }),
  )

  console.log('\nBalances')
  console.log(`    user wallet: ${formatEther(await publicClient.getBalance({ address: wallet.address }))} ETH`)
  console.log(`    Chidi:       ${formatEther(await publicClient.getBalance({ address: chidi }))} ETH`)
  console.log('\nSpike passed ✅')
}

async function expectRevert(fn: () => Promise<unknown>) {
  try {
    await fn()
  } catch (error: any) {
    const reason = error?.cause?.data?.errorName ?? error?.cause?.reason ?? error?.shortMessage ?? 'reverted'
    console.log(`    ❌ blocked on-chain as expected: ${reason}`)
    return
  }
  throw new Error('expected the contract to reject this, but it succeeded')
}

main().catch((error) => {
  console.error('\nSpike failed:', error)
  process.exit(1)
})
