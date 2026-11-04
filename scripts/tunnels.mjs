// Free public HTTPS links for the demo, through Cloudflare quick tunnels (no account):
//   wallet page (port 3116) → https://<random>.trycloudflare.com   used by /join links
//   Kolo (port 3117)        → https://<random>.trycloudflare.com/ussd   the USSD phone
// Writes both to bot/data/public-urls.json, which the bot picks up within 10 seconds.
// The links change every time this restarts.
//   node scripts/tunnels.mjs [path-to-cloudflared]
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cloudflared = process.argv[2] ?? 'cloudflared'
const out = join(root, 'bot', 'data', 'public-urls.json')
const urls = {}

function tunnel(name, port) {
  const child = spawn(cloudflared, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] })
  const scan = (chunk) => {
    const text = String(chunk)
    for (const line of text.split('\n')) if (/\bERR\b/.test(line)) console.log(`${name}: ${line.trim()}`)
    // The tunnel's own address, never api.trycloudflare.com (which shows up in error lines).
    const url = [...text.matchAll(/https:\/\/([a-z0-9-]+)\.trycloudflare\.com/g)].find((m) => m[1] !== 'api')?.[0]
    if (!url || urls[name] === url) return
    urls[name] = url
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, JSON.stringify(urls, null, 1))
    console.log(`${name}: ${url}${name === 'kolo' ? '/ussd' : ''}`)
  }
  child.stdout.on('data', scan)
  child.stderr.on('data', scan)
  child.on('exit', (code) => {
    console.log(`${name} tunnel stopped (${code}); restarting in 5s`)
    delete urls[name]
    setTimeout(() => tunnel(name, port), 5000)
  })
}

// One at a time: asking Cloudflare for two quick tunnels at once can get both refused.
tunnel('wallet', 3116)
setTimeout(() => tunnel('kolo', 3117), 8000)
