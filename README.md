# Kolo: money in your group chat

**Kolo stops the class rep from being the bank.**

Collecting dues today means dozens of bank transfers, screenshots, a list in someone's notes, weeks of chasing, and the class's money sitting in one person's personal account. Kolo is a bot that lives in the WhatsApp group you already use:

- `kolo everybody drop 2k for project` → everyone gets their own **Roqqu pay link**, priced in naira, payable in USDT or BTC.
- Kolo **ticks each person off automatically** when Roqqu confirms the payment. No screenshots, no "I don pay" on trust.
- **Split bills, remind people, check who has paid, and vote** on how the pot is spent, in plain English or Pidgin.
- **No data? Dial USSD.** Pay your dues from any phone with a PIN, and the WhatsApp group sees it instantly.
- Money sits in a **group pot**, never in someone's personal account, and leaves only when the **group votes yes**, with a receipt. The yes votes must include one of the **WhatsApp group's admins** (not the person being paid), so a few friends can't vote the pot to themselves.
- **Pay any WhatsApp contact:** reply to a contact card with `/send 2k`, send Kolo the contact privately, or type `/send 08031234567 2k`. Someone not on Kolo gets a link to open a free wallet; the money comes off your balance, waits for them, and lands in their Kolo balance when they sign up. Unclaimed after 7 days, it goes back to you.
- **Course rep collections:** a group admin can end a collection with "to me" (`/dues 2k Handouts to me`), and the money goes straight to their own Kolo balance (their Kolo ID) so they can spend it without a vote. Everyone still sees who paid; non-admins can't do this.
- `/join` sets up each member's own **passkey wallet** (fingerprint or face, no seed phrase) with a daily spending limit. Even Kolo can't move more than you allow, and `/cashout` sends your money there through Roqqu.
- Every member gets a **Kolo ID**: their Roqqu username, like `@koda`. Anyone on Kolo can pay them with `/send @koda 2k`, even from another group, with no long wallet address.

Built for the Anambra Web3 Conference 3.0 hackathon (Roqqu track), November 2026. Website: https://kolo.84-12-109-77.sslip.io

## Your Kolo balance and your wallet

Each member has two separate places for money:

| | Kolo balance | Your wallet |
|---|---|---|
| What it is | Money you've put into Kolo, recorded by Kolo and held by Roqqu | Your own account on the blockchain |
| Who controls it | Kolo moves it when you ask in the chat | Only your fingerprint or face. Kolo can only pay group things up to your daily limit, enforced on-chain |
| How money gets in | `/topup` (your Roqqu pay link), `/send` from another member, split pay-backs | `/cashout` from your Kolo balance |
| What it's for | Dues, USSD payments, `/send` to members or Kolo IDs | Keeping your money, or sending it anywhere with your fingerprint (to a Kolo ID or any `0x` address) |
| If you leave Kolo | Cash it out first | Still yours: Kolo's spend permission is revoked on-chain, and you log in with your passkey |

`/cashout 5k` moves money from your Kolo balance to your wallet: Kolo takes ₦5,000 off your balance and Roqqu sends it to your wallet.

**In the hackathon build:** Roqqu's sandbox stopped accepting payment links on 5 November and blocks cloud servers, so the server runs Kolo's own test checkout (`ROQQU_MODE=simulate`). There, `/cashout` takes the money off your Kolo balance and pays the same amount into your wallet on the test chain (a local Base Sepolia fork), so the wallet page shows it straight away. Live, Roqqu would send USDT on BSC, so connecting Roqqu's payouts to the wallets' network is part of going live with Roqqu.

## How it fits together

| Part | Folder | What it does |
|---|---|---|
| WhatsApp bot | [`bot/`](bot) | Group chat logic, AI message reader (English and Pidgin), dues cards, polls, Roqqu pay links and payment confirmation |
| Roqqu client | [`bot/src/roqqu.ts`](bot/src/roqqu.ts) | Payment links, deposits, naira rates and webhook decryption against the Roqqu RAS API |
| Passkey wallet | [`wallet/`](wallet) | Smart wallet with a passkey owner plus a capped spend permission, so a bot can pay within your daily limit and nothing more (Base) |
| Notes | [`docs/`](docs) | What the Roqqu API offers and what we found testing the sandbox |

The AI only **reads** messages and proposes an action. Kolo's code checks it, and no money moves from a chat message alone.

## Run it

```bash
cd bot
npm install
cp .env.example .env   # fill in the keys
npm run simulate -- --pay   # scripted group chat, no phone needed
npm run whatsapp            # link a spare WhatsApp number by QR, then use the group in KOLO_GROUPS
```

Wallet test: see [`wallet/README.md`](wallet/README.md).

Public demo links (free, no account): with the bot on :3117 and the wallet on :3116, run `node scripts/tunnels.mjs path/to/cloudflared`. It opens Cloudflare quick tunnels, prints the wallet link and the USSD phone link, and the bot switches its `/join` links to the public wallet page. The WhatsApp login page is never served through the public link.


## Live deployment

Kolo runs 24/7 on an Oracle Cloud Always Free server (Ubuntu 24.04, Arm), so it works without anyone's laptop:

- Website: https://kolo.84-12-109-77.sslip.io
- Wallet sign-up and log-in: https://wallet.84-12-109-77.sslip.io (`/join` links point here)
- USSD phone: https://kolo.84-12-109-77.sslip.io/ussd

Three systemd services (`kolo-fork`, `kolo-wallet`, `kolo-bot`) restart on their own, and Caddy serves HTTPS with free Let's Encrypt certificates. To set up a new server: install Node 22 and Caddy, allow ports 80 and 443 (cloud firewall and the server's iptables), copy the code, then run `IP_DASHED=<ip-with-dashes> bash scripts/server-setup.sh`. The bot's `.env`, WhatsApp login (`bot/auth`) and state (`bot/data`) are copied separately and never committed. The WhatsApp login page is only served to localhost; use an SSH tunnel to reach it.

## Team

- Kenechukwu Okoye (Koda), team lead: product, design and backend
- Ikenna Excel Ikueze: architecture
- Clinton: pitch and business (value proposition, pricing)
