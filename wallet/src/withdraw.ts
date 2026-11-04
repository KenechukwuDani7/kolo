// Withdrawals signed by the wallet's owner (the passkey), with or without a Kolo
// account. The page builds nothing on-chain itself: the server prepares an ERC-4337
// user operation, the passkey signs it in the browser, and the server submits it to
// the EntryPoint, paying the network fee (the user operation itself asks for none).
import { encodeFunctionData, type Address, type Hex } from 'viem'
import { entryPoint06Abi, entryPoint06Address, toCoinbaseSmartAccount, toWebAuthnAccount } from 'viem/account-abstraction'
import { SPEND_PERMISSION_MANAGER, bot, publicClient, send } from './chain.js'

export type UserOp = {
  sender: Address
  nonce: bigint
  initCode: Hex
  callData: Hex
  callGasLimit: bigint
  verificationGasLimit: bigint
  preVerificationGas: bigint
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
  paymasterAndData: Hex
  signature: Hex
}

export const walletFor = (credential: { id: string; publicKey: Hex }, address: Address) =>
  toCoinbaseSmartAccount({
    client: publicClient,
    owners: [toWebAuthnAccount({ credential }), SPEND_PERMISSION_MANAGER],
    address,
  })

// A user operation that sends `value` (wei) from the wallet to `to`. Gas price is zero
// because Kolo submits it and pays; P256 passkey checks need a roomy verification limit.
export async function prepareWithdraw(credential: { id: string; publicKey: Hex }, address: Address, to: Address, value: bigint): Promise<UserOp> {
  const wallet = await walletFor(credential, address)
  return {
    sender: address,
    nonce: await wallet.getNonce(),
    initCode: '0x',
    callData: await wallet.encodeCalls([{ to, value, data: '0x' }]),
    callGasLimit: 150_000n,
    verificationGasLimit: 1_500_000n,
    preVerificationGas: 80_000n,
    maxFeePerGas: 0n,
    maxPriorityFeePerGas: 0n,
    paymasterAndData: '0x',
    signature: '0x',
  }
}

// Submit a signed user operation through the EntryPoint (Kolo is the bundler).
export async function submitWithdraw(op: UserOp) {
  return send({
    to: entryPoint06Address,
    data: encodeFunctionData({ abi: entryPoint06Abi, functionName: 'handleOps', args: [[op], bot.address] }),
  })
}

export const balanceOf = (address: Address) => publicClient.getBalance({ address })
