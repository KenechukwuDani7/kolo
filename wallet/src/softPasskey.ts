// Software passkey for running the spike headlessly.
// It produces the same assertion shape a phone's WebAuthn authenticator
// returns, so the on-chain verification path is identical to a real passkey.
import { p256 } from '@noble/curves/p256'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, type Hex } from 'viem'
import { toWebAuthnAccount, type WebAuthnAccount } from 'viem/account-abstraction'

const base64url = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function createSoftPasskey(rpId = 'localhost', origin = 'http://localhost:3000'): WebAuthnAccount {
  const privateKey = p256.utils.randomPrivateKey()
  // Uncompressed point is 0x04 || x || y; the smart wallet stores x || y.
  const publicKey = bytesToHex(p256.getPublicKey(privateKey, false).slice(1)) as Hex
  const id = base64url(crypto.getRandomValues(new Uint8Array(16)))
  let signCount = 0

  const getFn = async (options: any) => {
    const challenge = new Uint8Array(options.publicKey.challenge)
    const clientDataJSON = JSON.stringify({
      type: 'webauthn.get',
      challenge: base64url(challenge),
      origin,
      crossOrigin: false,
    })
    const clientData = new TextEncoder().encode(clientDataJSON)

    // rpIdHash (32) || flags (UP | UV) || signCount (4, big-endian)
    const authenticatorData = new Uint8Array(37)
    authenticatorData.set(sha256(new TextEncoder().encode(rpId)), 0)
    authenticatorData[32] = 0x05
    new DataView(authenticatorData.buffer).setUint32(33, ++signCount)

    const payload = new Uint8Array([...authenticatorData, ...sha256(clientData)])
    // WebAuthn signs sha256(payload); noble returns low-s, which the wallet requires.
    const signature = p256.sign(sha256(payload), privateKey).toDERRawBytes()

    return {
      id,
      type: 'public-key',
      response: {
        clientDataJSON: clientData.buffer,
        authenticatorData: authenticatorData.buffer,
        signature: signature.buffer,
      },
    }
  }

  return toWebAuthnAccount({ credential: { id, publicKey }, getFn, rpId })
}
