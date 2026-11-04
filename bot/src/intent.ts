// AI message reader: turns a free-form chat message (English or Pidgin) into ONE
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
    .enum(['dues', 'paid', 'split', 'pay', 'spend', 'cashout', 'poll', 'remind', 'status', 'join', 'help', 'chat'])
    .describe('The single thing the sender wants Kolo to do'),
  amount: z.number().nullable().describe('Amount in naira as a plain number (2k → 2000), or null'),
  title: z.string().nullable().describe('What the money is for, e.g. "CSC 301 project fund", "shawarma" or "projector", or null'),
  people: z.array(z.string()).describe('Names of the OTHER people involved, exactly as listed in the group members, never the sender'),
  unknownNames: z.array(z.string()).describe('Names mentioned that are NOT group members, as written'),
  includeSender: z.boolean().describe('For split: true if the sender also shares the bill'),
  question: z.string().nullable().describe('For poll: the yes/no question, cleaned up, or null'),
  topic: z
    .enum(['dues', 'paid', 'status', 'remind', 'split', 'pay', 'spend', 'cashout', 'poll', 'join'])
    .nullable()
    .describe('For help: the one feature they asked how to use, or null for a general "what can you do"'),
  reply: z
    .string()
    .nullable()
    .describe('Only for chat or help: a short, friendly reply in the sender\'s style (Pidgin if they used Pidgin), max 2 sentences'),
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
- split: share a bill between people ("split 15k suya between me, Excel and Clinton"), or bill/charge someone for something the sender paid ("send Clinton the bill for shawarma", "Ada owes me 3k", "charge Excel for the uber"). When billing someone, includeSender is false and people is just them.
- pay: the sender sends their OWN money to specific people ("abeg send Chidi 2k for data", "pay Ada back her 5k")
- spend: pay someone out of the GROUP POT / treasury / the money we collected ("use 5k from the pot to pay Excel for the projector", "make the pot pay Clinton 3k for printing", "release 10k from our money give Ada for the venue"). people = who receives it, title = what it is for.
- poll: start a yes/no group vote ("make we vote whether we go put 50k inside MTN")
- remind: nudge people who haven't paid ("tell Clinton to pay up", "remind everybody wey never pay")
- status: ask who has or hasn't paid, or how much is collected ("who never pay?", "how far the money?")
- cashout: move money from the sender's Kolo balance to their own wallet ("cash out 2k to my wallet", "withdraw my 5k")
- join: wants to set up or open their Kolo account / wallet
- help: asks what Kolo can do, or how one feature works ("how does split work?", "explain the dues thing", "wetin be remind?"). Set topic to that feature, or null for a general question. Any "explain", "I don't understand", "how does … work" or "what is …" question about something Kolo does is help, never chat. Questions about sharing food, shawarma, suya, bills or rides mean topic split; about collecting or contributing mean dues; about voting mean poll; about the pot or spending group money mean spend; about withdrawing or cashing out mean cashout; about the wallet or account mean join.
- chat: anything else (greetings, jokes, football, questions unrelated to group money)

Rules:
- Understand Nigerian English and Pidgin. Amounts: "2k" = 2000, "15k" = 15000, "1.5k" = 1500, "N2,000" / "₦2000" = 2000, "five thousand" = 5000.
- people: only names from the member list, matched loosely (nicknames, lowercase, missing letters). Never include the sender. "everybody"/"all of una" in remind means the unpaid list: return those names.
- A name that is not a member goes in unknownNames. Still choose the action the sender meant (e.g. pay); Kolo will ask who they mean.
- includeSender: true when the sender says "me", "us", "we", or clearly shares the bill.
- If a needed amount is missing, still pick the action and set amount to null; Kolo will ask.
- reply is ONLY for chat (Kolo writes its own help text). Keep it short, warm and on-brand; for chat, gently steer back to what Kolo does. Never claim money has moved. Only remind the sender about dues if the sender is in the Unpaid list.
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
