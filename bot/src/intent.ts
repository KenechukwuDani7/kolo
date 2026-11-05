// AI message reader: turns a free-form chat message (in any language) into ONE
// structured Kolo request. The model only proposes; Kolo's code checks the
// request and decides what actually happens, so the AI can never move money.
import AnthropicBedrock from '@anthropic-ai/bedrock-sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'

try {
  process.loadEnvFile('.env')
} catch {
  // no .env: rely on the real environment
}

export const Intent = z.object({
  action: z
    .enum(['dues', 'paid', 'split', 'pay', 'spend', 'cashout', 'topup', 'balance', 'deleteaccount', 'limit', 'poll', 'remind', 'status', 'join', 'app', 'help', 'chat'])
    .describe('The single thing the sender wants Kolo to do'),
  amount: z.number().nullable().describe('Amount in naira as a plain number (2k → 2000), or null'),
  title: z.string().nullable().describe('What the money is for, e.g. "CSC 301 project fund", "shawarma" or "projector", or null'),
  people: z.array(z.string()).describe('Names of the OTHER people involved, exactly as listed in the group members, never the sender'),
  unknownNames: z.array(z.string()).describe('Names mentioned that are NOT group members, as written'),
  includeSender: z.boolean().describe('For split: true if the sender also shares the bill'),
  payee: z
    .string()
    .nullable()
    .describe('For split: the group member who should RECEIVE the money, when it is not the sender (e.g. "split Clinton\'s 6k bill among us" → "Clinton"), else null'),
  question: z.string().nullable().describe('For poll: the yes/no question, cleaned up, or null'),
  topic: z
    .enum(['dues', 'paid', 'status', 'remind', 'split', 'pay', 'spend', 'cashout', 'topup', 'limit', 'poll', 'join'])
    .nullable()
    .describe('For help: the one feature they asked how to use, or null for a general "what can you do"'),
  reply: z
    .string()
    .nullable()
    .describe('Only for chat or help: a short, natural reply in the sender\'s language and style, max 2 sentences'),
  language: z
    .string()
    .describe('The language the message is written in, named in English: "English", "Nigerian Pidgin", "Igbo", "Yoruba", "Hausa", "Chinese", "Italian", "French"…'),
})
export type Intent = z.infer<typeof Intent>

export type IntentContext = {
  sender: string
  members: string[]
  collection?: { title: string; amount: number; unpaid: string[] }
  pot?: number // naira in the group pot
  // When the message is a reply to Kolo: what Kolo said, and the message Kolo was answering.
  replyingTo?: { kolo: string; asked?: string }
}

const SYSTEM = `You are the message reader for Kolo, a money bot inside Nigerian WhatsApp group chats (students, friends, class groups).
Read ONE message that mentions Kolo or replies to Kolo, and choose exactly one action. "kolo" can appear anywhere in the message, and "Kolo account" means the sender's Kolo wallet.
If the message replies to Kolo, combine it with what Kolo said and the earlier message: a short answer like "9k" or "me and Excel" usually completes the earlier request, so return that complete request.

Actions:

- dues: start a group collection ("everybody drop 2k for project", "collect 1500 each for dinner")
- paid: the sender says they have paid the current collection ("I don pay", "sent mine")
- split: share a bill between people ("split 15k suya between me, Excel and Clinton"), or bill/charge someone for something the sender paid ("send Clinton the bill for shawarma", "Ada owes me 3k", "charge Excel for the uber"). When billing someone, includeSender is false and people is just them. If the money should go to someone other than the sender ("split Clinton's 6k diapers bill among all of us", "everybody pay Ada back for the cake"), set payee to that person; people is everyone sharing the bill (the payee too if they share it), and "all of us" / "everyone in this group" means every member listed.
- pay: the sender sends their OWN money to specific people ("abeg send Chidi 2k for data", "pay Ada back her 5k")
- spend: pay someone out of the GROUP POT / treasury / the money we collected ("use 5k from the pot to pay Excel for the projector", "make the pot pay Clinton 3k for printing", "release 10k from our money give Ada for the venue"). people = who receives it, title = what it is for.
- app: wants the Kolo web menu / website / app link, to do things with taps ("send me the kolo website", "open the menu for me")
- poll: start a yes/no group vote ("make we vote whether we go put 50k inside MTN")
- remind: nudge people who haven't paid ("tell Clinton to pay up", "remind everybody wey never pay")
- status: ask who has or hasn't paid, or how much is collected ("who never pay?", "how far the money?")
- topup: add or fund money INTO the sender's own Kolo balance or wallet ("top up 5k", "fund my wallet with 10k", "I wan put 3k for my Kolo")
- balance: asks how much is in their own Kolo balance ("how much I get for Kolo?", "my balance")
- deleteaccount: wants to delete, close or remove their own Kolo account ("delete my account", "I wan comot for Kolo"). Never for deleting a collection or a message.
- cashout: move money from the sender's Kolo balance to their own wallet ("cash out 2k to my wallet", "withdraw my 5k")
- limit: asks how much of their daily wallet limit is spent or left ("how much I fit still spend today?", "wetin remain for my limit")
- join: wants to set up or open their Kolo account / wallet
- help: asks what Kolo can do, or how one feature works ("how does split work?", "explain the dues thing", "wetin be remind?"). Set topic to that feature, or null for a general question. Any "explain", "I don't understand", "how does … work" or "what is …" question about something Kolo does is help, never chat. Questions about sharing food, shawarma, suya, bills or rides mean topic split; about collecting or contributing mean dues; about voting mean poll; about the pot or spending group money mean spend; about withdrawing or cashing out mean cashout; about the wallet or account mean join.
- chat: anything else (greetings, jokes, football, questions unrelated to group money)

Facts about Kolo, for chat replies (never invent others):
- Kolo is a bot on WhatsApp. To get Kolo into a group, save Kolo's number and add it to the group like any other member. Then anyone in the group can talk to it by saying "kolo", replying to its messages, or typing / for the menu.
- It works in any group it has been added to, and only reads messages addressed to it.
- Kolo does not lend money or give out money. Money only leaves a group's pot when the group votes for it (/spend). If someone asks Kolo for money or a loan, say so kindly and suggest asking the group to vote a spend from the pot, or a friend to split.
- Payments go through Roqqu pay links; Kolo ticks people automatically when Roqqu confirms. No data? Members can pay on USSD.

Rules:
- Messages can be in ANY language: English, Nigerian Pidgin, Igbo, Yoruba, Hausa, Chinese, Italian, French, Arabic, Spanish and more, or a mix. Read the meaning, not the words, and fill the same fields; set language to what the sender wrote in. Numbers written in words count too ("puku abụọ" = 2000 in Igbo, "ẹgbẹ̀rún méjì" = 2000 in Yoruba, "dubu biyu" = 2000 in Hausa, "两千" = 2000, "duemila" = 2000).
- Amounts: "2k" = 2000, "15k" = 15000, "1.5k" = 1500, "N2,000" / "₦2000" = 2000, "five thousand" = 5000.
- people: only names from the member list, matched loosely (nicknames, lowercase, missing letters). Never include the sender. "everybody"/"all of una" in remind means the unpaid list: return those names.
- A name that is not a member goes in unknownNames. Still choose the action the sender meant (e.g. pay); Kolo will ask who they mean.
- includeSender: true when the sender says "me", "us", "we", or clearly shares the bill.
- If a needed amount is missing, still pick the action and set amount to null; Kolo will ask.
- For help: leave reply null for a general "what can you do?" or a question about one feature (Kolo shows its own guide). Only when the question is specific but isn't one feature (like how to add Kolo to a group), write a short reply that answers it.
- "Everyone pay 2k" / "kowa ya biya dubu biyu" / "make everybody drop" is starting dues, not paid. paid is only when the sender says they themselves have paid.
- reply is otherwise ONLY for chat (Kolo writes its own help text). Write it in the sender's language, like a helpful friend texting back: plain, calm, one or two short sentences. Actually answer the question using the facts above (e.g. how to add Kolo to a group). No emoji unless it truly fits (never more than one), no stacked exclamation marks, no hype or salesy words, no filler like "Ah" or "Ready to help!". Never be dismissive. Never claim money has moved. Only remind the sender about dues if the sender is in the Unpaid list.
- Never invent members, amounts or payments.`

// Haiku 4.5 is an ARN-versioned Bedrock model: it rejects the SDK's default API
// version (2026-10-21), so pin Bedrock's own version for it.
const client = new AnthropicBedrock({ defaultHeaders: { 'anthropic-version': 'bedrock-2023-05-31' } })
const MODEL = process.env.KOLO_MODEL ?? 'global.anthropic.claude-haiku-4-5-20251001-v1:0'

export async function readIntent(text: string, ctx: IntentContext): Promise<Intent> {
  const context = [
    `Sender: ${ctx.sender}`,
    `Group members: ${ctx.members.join(', ') || '(unknown)'}`,
    ctx.collection
      ? `Current collection: "${ctx.collection.title}", ₦${ctx.collection.amount} each. Unpaid: ${ctx.collection.unpaid.join(', ') || 'nobody'}`
      : 'Current collection: none',
    `Group pot: ₦${ctx.pot ?? 0}`,
    ...(ctx.replyingTo
      ? [
          `This message is a reply to Kolo, who had said: "${ctx.replyingTo.kolo}"`,
          ...(ctx.replyingTo.asked ? [`(Kolo was answering this earlier message: "${ctx.replyingTo.asked}")`] : []),
        ]
      : []),
  ].join('\n')

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{ role: 'user', content: `${context}\n\nMessage: ${text}` }],
    output_config: { format: zodOutputFormat(Intent) },
  })
  if (!response.parsed_output) throw new Error(`could not read intent (stop_reason ${response.stop_reason})`)
  return response.parsed_output
}

const Translation = z.object({ texts: z.array(z.string()) })

// Kolo's own replies are written in English; this puts them into the sender's language,
// keeping names, amounts, links, @mentions, /commands and formatting exactly as they are.
export async function translate(texts: string[], language: string): Promise<string[]> {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 2048,
    system: `Translate each message from Kolo, a WhatsApp group-money bot, fully into ${language}. Sound like a native speaker texting a friend: natural, plain and calm, not formal and not robotic. Translate every ordinary word, including words like "collection", "each", "paid", "collected", "reply", "pot"; don't leave English words in the sentence. Keep exactly as they are only: people's names, @mentions, amounts like ₦2,000, numbers like 0/3, links, /commands, the word "paid" when it's in quotes (it's a command people type), wallet addresses, references, *bold* markers and line breaks. Don't add emoji or anything that isn't in the original. Return the same number of texts, in the same order.`,
    messages: [{ role: 'user', content: JSON.stringify(texts) }],
    output_config: { format: zodOutputFormat(Translation) },
  })
  const out = response.parsed_output?.texts
  if (!out || out.length !== texts.length) throw new Error('translation came back incomplete')
  return out
}
