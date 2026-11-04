# Kolo WhatsApp group bot

Kolo lives inside a normal WhatsApp group. It reads messages addressed to it, collects dues through personal
Roqqu pay links, ticks people off when Roqqu confirms the money, splits bills, reminds people, and lets the
group vote before anything is spent from the shared pot.

## Why not the official API
Meta's WhatsApp Groups API (Cloud API) only allows **8 participants per group** and requires an
**Official Business Account** (verified badge). A 60-person class group is impossible there. The demo
therefore uses **Baileys**, an unofficial library that links the bot as a "linked device" on a spare number.
This breaks WhatsApp's terms and the number can be banned, so: **use a spare SIM, never a personal number**,
and say so if judges ask. Telegram (full group-bot support) stays the fallback.

## Files
| File | What it is |
|---|---|
| `src/kolo.ts` | Kolo's chat logic. Knows nothing about WhatsApp, so Telegram can reuse it. |
| `src/cards.ts` | The dues progress card (SVG → PNG). Swap in Ike's Figma design later. |
| `src/simulate.ts` | Scripted group chat with no phone needed. Cards are saved to `out/`. |
| `src/whatsapp.ts` | Baileys adapter: login, group messages, mentions, images, polls, vote decryption, DMs, Roqqu payment watch and webhook. |
| `src/roqqu.ts` | Roqqu RAS client: payment links, deposits, member wallets, sends, naira rate, webhook decryption. |
| `src/intent.ts` | AI message reader (English and Pidgin) that turns a message into one structured request. |
| `src/ussd.ts`, `src/ussd-page.ts` | USSD menu in Africa's Talking format, and an on-screen phone to demo it at `/ussd`. |
| `src/roqqu-check.ts` | Live check against the Roqqu sandbox. |

## Run
```bash
npm install
npm run simulate                              # no phone needed
npm run simulate -- --pay                     # with pay links, confirmations and a pot spend
PAIR_NUMBER=2348012345678 npm run whatsapp    # link the spare number with an 8-character code
npm run whatsapp                              # or link by scanning a QR code
```
**Safety settings:**
- `KOLO_GROUPS="Kolo Test"` (group names or ids, comma-separated): Kolo only reads and replies in these
  groups and ignores and never logs every other chat on the account. With it unset, Kolo stays silent and
  just lists the groups it can see.
- `TEST_OWN_MESSAGES=1`: also obey commands typed from the linked account itself. Only needed if you test
  with the same account you type from (not recommended; see below).

On the spare phone: **WhatsApp → Linked devices → Link a device** (choose "Link with phone number instead"
for the code). The session is saved in `./auth` (keep it private; delete it to unlink).

## Test checklist in a real group
Add the spare number to a test group with 2–3 friends, then try:

| # | Send in the group | Expected |
|---|---|---|
| 1 | `lol who dey go library` | Kolo stays silent |
| 2 | `/help` | List of commands |
| 3 | `/dues 2000 CSC 301 project fund` | Progress card, and each member gets a Roqqu pay link by DM |
| 4 | Open your link, pick USDT, tap **Completed** (sandbox) | Within ~15 s: "X paid ✅ (confirmed by Roqqu)" and the card updates |
| 4b | Organiser: `/confirm @name` | Ticks someone who paid cash; nobody else can do this |
| 4c | `/spend 1500 @name printing`, then the group votes | Majority yes → Kolo pays them from the pot through Roqqu and posts a receipt |
| 4d | Open http://localhost:3117/ussd, enter your WhatsApp number, dial, PIN 1234 | Pay dues over USSD; the group gets "paid ✅ by USSD" |
| 5 | `@Kolo split 12k shawarma between me @Ada @Chidi` (real @mentions) | Shares posted, mentions highlighted, DMs to Ada and Chidi |
| 6 | `/poll Invest ₦50,000 in MTN stock?` then everyone votes | A WhatsApp poll; Kolo reports Yes/No counts, then "Approved" at 3 yes |
| 7 | Someone changes their vote | Counts update |
| 8 | `/join`, open the DM link on the laptop (wallet runs on :3116), create passkey, approve limit | Group gets "🔐 X set up their own Kolo wallet" |
| 9 | `/cashout 2k` | Roqqu sends USDT to your own wallet address, with a receipt |

Note anything that fails, especially **#5 (mentions)** and **#6–7 (poll votes)**. Those depend on how
WhatsApp addresses people in groups (phone number vs. LID), which can only be checked on a real group.

## AI message reader (`src/intent.ts`)
Messages addressed to Kolo ("Kolo …" / @Kolo) go to **Claude Haiku 4.5 on Amazon Bedrock**, which returns one
structured request (`action`, `amount`, `people`, …) checked against a fixed schema. Kolo's code then validates
it (unknown names, missing amounts, who is actually in the group) and acts. `/commands` skip the AI entirely.
- Credentials: `.env` (`AWS_BEARER_TOKEN_BEDROCK`, `AWS_REGION`, `KOLO_MODEL`). Never commit it.
- Haiku 4.5 is an ARN-versioned Bedrock model, so the client pins `anthropic-version: bedrock-2023-05-31`;
  the SDK default (`2026-10-21`) returns 400 "Invalid API version".
- `npx tsx src/intent-check.ts` scores the reader on 20 realistic English/Pidgin messages: **25/25** (27 Oct), now 29 cases with "spend from the pot".
- `npm run simulate -- --ai` plays a full group chat through the real reader.
- Latency was 6–13 s per message, but that is this laptop's network (a TLS handshake took 5–10 s even to
  Google). Run the bot on a cloud server for the demo.

## Findings so far
- Baileys v7's built-in poll-vote decryption is disabled, so Kolo decrypts votes itself with
  `decryptPollVote` and the poll's `messageSecret`, trying both phone-number and LID ids.
- Connecting to WhatsApp and producing a linking QR works from this machine (checked 26 Oct).
- Meta's 2026 policy bars *general-purpose* AI chatbots from the Business API; Kolo is a task-specific
  payments bot, but this is another reason not to depend on the official API for the demo.
