# Kolo WhatsApp group bot spike (throwaway, not the hackathon repo)

Proves whether a bot can live inside a normal WhatsApp group: read messages, reply, @mention people,
post images, run polls and read the votes, and DM members. Not under git on purpose.

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
| `src/whatsapp.ts` | Baileys adapter: login, group messages, mentions, images, polls, vote decryption, DMs. |

## Run
```bash
npm install
npm run simulate                              # no phone needed
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
| 3 | `/dues 2000 CSC 301 project fund` | Green progress card image |
| 4 | Each friend sends `paid` | Card updates: 1/N, 2/N… |
| 5 | `@Kolo split 12k shawarma between me @Ada @Chidi` (real @mentions) | Shares posted, mentions highlighted, DMs to Ada and Chidi |
| 6 | `/poll Invest ₦50,000 in MTN stock?` then everyone votes | A WhatsApp poll; Kolo reports Yes/No counts, then "Approved" at 3 yes |
| 7 | Someone changes their vote | Counts update |
| 8 | `/join` | Private DM with the setup link |

Note anything that fails, especially **#5 (mentions)** and **#6–7 (poll votes)**. Those depend on how
WhatsApp addresses people in groups (phone number vs. LID), which can only be checked on a real group.

## AI message reader (`src/intent.ts`)
Messages addressed to Kolo ("Kolo …" / @Kolo) go to **Claude Haiku 4.5 on Amazon Bedrock**, which returns one
structured request (`action`, `amount`, `people`, …) checked against a fixed schema. Kolo's code then validates
it (unknown names, missing amounts, who is actually in the group) and acts. `/commands` skip the AI entirely.
- Credentials: `.env` (`AWS_BEARER_TOKEN_BEDROCK`, `AWS_REGION`, `KOLO_MODEL`). Never commit it.
- Haiku 4.5 is an ARN-versioned Bedrock model, so the client pins `anthropic-version: bedrock-2023-05-31`;
  the SDK default (`2026-10-21`) returns 400 "Invalid API version".
- `npx tsx src/intent-check.ts` scores the reader on 20 realistic English/Pidgin messages: **20/20** (26 Oct).
- `npm run simulate -- --ai` plays a full group chat through the real reader.
- Latency was 6–13 s per message, but that is this laptop's network (a TLS handshake took 5–10 s even to
  Google). Run the bot on a cloud server for the demo.

## Findings so far
- Baileys v7's built-in poll-vote decryption is disabled, so Kolo decrypts votes itself with
  `decryptPollVote` and the poll's `messageSecret`, trying both phone-number and LID ids.
- Connecting to WhatsApp and producing a linking QR works from this machine (checked 26 Oct).
- Meta's 2026 policy bars *general-purpose* AI chatbots from the Business API; Kolo is a task-specific
  payments bot, but this is another reason not to depend on the official API for the demo.
