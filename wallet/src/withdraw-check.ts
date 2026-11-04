// End-to-end check of owner withdrawals on the local fork, with a software passkey:
// create a wallet, fund it, then send everything out signed only by the passkey.
//   npx tsx src/withdraw-check.ts   (needs `npm run fork` running)
import { formatEther, type Address } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { toCoinbaseSmartAccount } from 'viem/account-abstraction'
import { SPEND_PERMISSION_MANAGER, WALLET_FUNDING, prepareLocalFork, publicClient, send } from './chain.js'
import { createSoftPasskey } from './softPasskey.js'
import { balanceOf, prepareWithdraw, submitWithdraw } from './withdraw.js'

await prepareLocalFork()
const passkey = createSoftPasskey()
const wallet = await toCoinbaseSmartAccount({ client: publicClient, owners: [passkey, SPEND_PERMISSION_MANAGER] })
const { factory, factoryData } = await wallet.getFactoryArgs()
await send({ to: factory!, data: factoryData! })
await send({ to: wallet.address, value: WALLET_FUNDING })
const before = await balanceOf(wallet.address)
console.log(`wallet ${wallet.address} holds ${formatEther(before)} ETH`)

const to = privateKeyToAccount(generatePrivateKey()).address as Address
const op = await prepareWithdraw({ id: passkey.id, publicKey: passkey.publicKey }, wallet.address, to, before)
const signature = await wallet.signUserOperation({ ...op, chainId: publicClient.chain!.id })
const { hash } = await submitWithdraw({ ...op, signature })
console.log(`withdrawal tx ${hash}`)
console.log(`wallet now ${formatEther(await balanceOf(wallet.address))} ETH, recipient ${formatEther(await balanceOf(to))} ETH`)
