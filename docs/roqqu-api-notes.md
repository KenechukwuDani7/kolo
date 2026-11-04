# Roqqu API (RAS): notes for Kolo

Source: https://roqqu-api-services.gitbook.io/ras (all 48 pages read 2026-10-28)

## What it is
A wallet service where Roqqu holds the crypto for us. We get one merchant account and one balance.
- We can create a deposit address for each customer, tagged with their email.
- Roqqu tells us through webhooks when money arrives or leaves.
- We can buy, sell and swap crypto from the merchant balance.

- Base URL: `https://service.roqqu.com/v1` (the same for test and live)
- Auth header: `x-staging-api-key` for test, `x-api-key` for live. Keys come from the RAS console under Settings → API Keys and Webhooks.
- Request bodies are mostly `application/x-www-form-urlencoded`.
- An IP whitelist exists (`POST /ip`), so the server needs a fixed IP.

## Networks and coins
| Network code | Tokens |
|---|---|
| bitcoin | btc |
| erc20 | eth (+ usdt in the deposit examples) |
| bep20 | usdt, bnb, shib |
| trc20 | usdt |
| base | **usdc only** |
| solana / ripple / litecoin / dogecoin | sol / xrp / ltc / doge |

No cNGN. No naira bank deposits or withdrawals. No tokenized stocks. No virtual cards.

## Endpoints Kolo would use
| Kolo feature | Roqqu endpoint |
|---|---|
| Collect dues and splits | `POST /payment-links`: the amount is in **NGN** (`amount_currency=ngn`), the person pays in USDT (trc20/bep20) or BTC. `payment_reference` (up to 20 letters and numbers) and `metadata` come back in the webhook. Links expire after 2h by default. |
| Auto-confirm "paid" | Webhooks `payment_link_completed`, `payment_link_completed_overpaid`, `payment_link_failed`. They include the amount received, NGN and USD values, and the tx hash. |
| A personal deposit address per member | `POST /wallets/generate-wallet` {network, customer:{email,first_name,last_name}}. The `token_received` webhook carries the customer. |
| Pay someone or cash out | `POST /wallets/send` {amount, network, to, token}. Returns a `refid`; the `token_sent` webhook confirms. The fee comes out of the token sent. |
| Squad investing (crypto, not stocks) | `POST /trade/buy` {amount, token} is paid from the USDT balance. `sell` and `swap` also exist. These are ledger-only with **no webhook**, so confirm via `POST /balances` or `POST /history`. |
| Show amounts in naira | `GET /rates` (fiat rates) and `GET /prices` (crypto prices) |
| Fees | `GET /transaction/fee?token=&amount=` (the example shows 1%) and `POST /transaction/network-fee` |

## Webhooks
- Configure the URL in the console. The body is encrypted with **aes-256-ctr**:
  - key = the first 32 characters of our API key
  - iv = the `x-api-key` request header (hex)
  - ciphertext = `body.hash` (hex)
- Use `POST /webhooks/retrigger` {transaction_hash} to resend a missed event.
- The URL must be public HTTPS, so the bot needs a cloud server.

## Gaps and quirks to ask about at onboarding or the workshop
1. Does the sandbox actually move testnet coins, or only fake ledger entries? Which testnet networks does it use?
2. Do payment links work in the sandbox? Can we pay one with test USDT?
3. Is there a naira on-ramp or off-ramp (bank deposit or withdrawal) we can use? Tokenized stocks? Virtual cards? (None are in the public docs.)
4. Is the balance one merchant pool, or per customer? (`/balances` and `/history` take an email.)
5. Will payment links support Base USDC? (They currently support BTC, trc20 USDT and bep20 USDT only.)
6. `send`/`swap` say `amount: integer`. Are decimals like 1.5 USDT allowed?
7. Some examples omit the auth header. Does every endpoint need a key?

## Sandbox test results (2026-11-04)
- **Auth:** use the test **private** key (`RASPRIV…`) in the `x-staging-api-key` header. The public key and the `x-api-key` header both return "Invalid API Key". Keys are in `spikes/roqqu/.env`.
- **The laptop's DNS can't resolve `service.roqqu.com`** ("DNS server failure"). Google DNS works. Workarounds: `curl --resolve service.roqqu.com:443:172.67.192.57`, set the PC's DNS to 8.8.8.8, or run from the cloud server.
- **The test key opens a shared sandbox merchant account,** not ours. It holds test balances (10,000 USDT, 1 BTC, ...). Don't drain or delete anything.
- **The webhook URL on that account points to someone else's dev tunnel,** and the API has no endpoint to change it. **So Kolo won't receive "paid" webhooks** until Roqqu points it at us or gives us our own account.
- **Payment link works:** `POST /payment-links` with a **JSON body, every value as a string** (`"amount":"2000"`). `customer_details` and `metadata` are JSON strings; `wallets` is a real array. It returns a link to `checkout-sandbox.roqqu.io` that has **test buttons: Completed / Failed / Underpaid**, with testnet addresses.
- **Payment link status:** `GET /payment-links/:refid` exists, but it says "validation missing in header" (an undocumented extra header). Ask Roqqu.
- **Fees:** `GET /transaction/fee` returns **0.5%** for USDT, not the 1% in the docs example. `GET /rates` returns NGN at **₦1,375/$**, with min deposit ₦100 and min withdraw/transfer ₦1,000.
- `GET /tokens` needs auth; 42 tokens, including usdc.
