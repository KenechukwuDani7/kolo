# Kolo wallet spike (throwaway, not the hackathon repo)

Practice code to prove the riskiest part of Kolo before the build window opens on 2 Nov:
**a passkey-controlled smart wallet where the bot can only spend within a daily limit the user signed.**
Not under git on purpose. The real repo is created on 2 Nov.

## How it works

| Piece | What it is |
|---|---|
| User wallet | Coinbase Smart Wallet (factory `0x0BA5…F428a`, deployed on Base Sepolia). Owners: the user's passkey + the SpendPermissionManager. |
| Daily limit | Coinbase `SpendPermissionManager` (`0xf852…67Ad`). The user signs one `SpendPermission` (spender, token, allowance per period, start/end) with their passkey. |
| Bot | An EOA that pays gas, calls `approveWithSignature` once, then `spend` for each payment. Going over the allowance, or anyone else calling `spend`, reverts on-chain. |
| Gas | The bot deploys the wallet and sends every transaction, so the user never holds gas. |

Amounts are in Base Sepolia ETH as a stand-in: 0.001 ETH per day ≈ the ₦20,000 cap, 0.0004 ETH per payment.

## Run it

```bash
npm install
npm run fork      # terminal 1: local fork of Base Sepolia on :8545 (no testnet funds needed)
npm run spike     # terminal 2: headless run with a software passkey
npm run serve     # or: open http://localhost:3000 (PORT=3116 via the app launch entry) and use a real passkey (Windows Hello / phone)
```

Against live Base Sepolia instead of the fork, set `RPC_URL=https://sepolia.base.org` and
`BOT_PRIVATE_KEY=<key funded from a Base Sepolia faucet>`; transactions then print Basescan links.

## Findings to carry into the real build

- **Router contract:** `spend` sends funds to the spender (the bot). Kolo should make the spender a small
  `KoloPayRouter` contract that calls `spend` and forwards to the recipient in the same transaction, so
  funds never sit with the bot.
- **The same primitive covers Module B (Squad Subscriptions):** a monthly `period` with a capped `allowance`
  is exactly a recurring pull payment.
- **Payments above the cap** need a passkey-signed user operation through a bundler (not covered here).
- Use cNGN or a mock cNGN ERC-20 as the `token` instead of native ETH in the real build.
- **One bot key means one nonce sequence.** Overlapping payments collided on the nonce until transactions were
  queued. The real backend needs a transaction queue (or one key per worker).
- **Check before spending.** Simulate `spend` first so a cap rejection (`ExceededSpendPermission`) is reported to
  the user as "over your daily limit", not as a generic failure. Payments for the same wallet must run one at a
  time so the check sees earlier spends.
- Hardhat refuses calls on the forked block itself; mine one block first (`prepareLocalFork`).
