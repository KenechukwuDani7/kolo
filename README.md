# Kolo: money in your group chat

**Kolo stops the class rep from being the bank.**

Collecting dues today means dozens of bank transfers, screenshots, a list in someone's notes, weeks of chasing, and the class's money sitting in one person's personal account. Kolo is a bot that lives in the WhatsApp group you already use:

- `kolo everybody drop 2k for project` → everyone gets their own **Roqqu pay link**, priced in naira, payable in USDT or BTC.
- Kolo **ticks each person off automatically** when Roqqu confirms the payment. No screenshots, no "I don pay" on trust.
- **Split bills, remind people, check who has paid, and vote** on how the pot is spent, in plain English or Pidgin.
- **No data? Dial USSD.** Pay your dues from any phone with a PIN, and the WhatsApp group sees it instantly.
- Money sits in a **group pot**, never in someone's personal account, and leaves only when the **group votes yes**, with a receipt.
- Each member's own **passkey wallet** (fingerprint or face) has a daily spending limit. Even Kolo can't move more than you allow.

Built for the Anambra Web3 Conference 3.0 hackathon (Roqqu track), November 2026.

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

## Team

- Kenechukwu Okoye, team lead, product and design
- Ikenna Excel Ikueze
- Clinton
