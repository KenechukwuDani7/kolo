// On-screen phone that dials Kolo's USSD menu, for demos without a telco shortcode.
// It posts to /ussd exactly as Africa's Talking would.
export const USSD_CODE = '*347*565#'

export const USSD_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kolo USSD</title>
<style>
  :root { --bg:#eef2ef; --ink:#14201a; --muted:#5b6b62; --phone:#101512; --screen:#f7f9f8; --dialog:#ffffff; --line:#d6dfd9; --accent:#1f8a4c; --accent-ink:#ffffff; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#0c120f; --ink:#e6eee9; --muted:#9aaba1; --phone:#000; --screen:#151c18; --dialog:#1d2621; --line:#2c3a32; --accent:#34b36b; --accent-ink:#06130b; } }
  :root[data-theme="dark"] { --bg:#0c120f; --ink:#e6eee9; --muted:#9aaba1; --phone:#000; --screen:#151c18; --dialog:#1d2621; --line:#2c3a32; --accent:#34b36b; --accent-ink:#06130b; }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; background:var(--bg); color:var(--ink); font:15px/1.45 "Segoe UI", system-ui, sans-serif; display:flex; align-items:center; justify-content:center; padding:24px 16px; }
  .wrap { display:flex; gap:40px; align-items:center; flex-wrap:wrap; justify-content:center; max-width:900px; }
  .intro { max-width:340px; }
  .intro h1 { font-size:26px; margin:0 0 8px; }
  .intro p { color:var(--muted); margin:0 0 12px; }
  .intro code { background:var(--dialog); border:1px solid var(--line); border-radius:6px; padding:1px 6px; }
  .phone { width:300px; height:600px; background:var(--phone); border-radius:40px; padding:14px; box-shadow:0 20px 50px rgba(0,0,0,.25); }
  .screen { position:relative; height:100%; background:var(--screen); border-radius:28px; overflow:hidden; display:flex; flex-direction:column; }
  .bar { display:flex; justify-content:space-between; padding:10px 20px 0; font-size:12px; color:var(--muted); }
  .dialer { flex:1; display:flex; flex-direction:column; justify-content:flex-end; padding:16px; gap:10px; }
  label { font-size:12px; color:var(--muted); }
  input { width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--line); background:var(--dialog); color:var(--ink); font-size:16px; }
  #code { font-size:28px; text-align:center; letter-spacing:1px; border:none; background:transparent; }
  button { border:0; border-radius:999px; padding:12px; font-size:15px; font-weight:600; cursor:pointer; }
  .call { background:var(--accent); color:var(--accent-ink); }
  .overlay { position:absolute; inset:0; background:rgba(0,0,0,.45); display:none; align-items:center; justify-content:center; padding:18px; }
  .overlay.open { display:flex; }
  .dialog { width:100%; background:var(--dialog); border-radius:14px; padding:16px; box-shadow:0 8px 30px rgba(0,0,0,.3); }
  .dialog pre { margin:0 0 12px; white-space:pre-wrap; font:inherit; }
  .actions { display:flex; justify-content:flex-end; gap:8px; margin-top:12px; }
  .ghost { background:transparent; color:var(--accent); padding:8px 14px; }
  .send { background:var(--accent); color:var(--accent-ink); padding:8px 18px; }
</style></head>
<body><div class="wrap">
  <div class="intro">
    <h1>Kolo on USSD 🐷</h1>
    <p>No data, low battery or no smartphone? Dial Kolo like a bank code and still pay your group dues. The WhatsApp group sees it instantly.</p>
    <p>Enter the WhatsApp number you use in the group, dial <code>${USSD_CODE}</code>, and create your own 4-digit PIN the first time you pay.</p>
    <p style="font-size:13px">Prototype: a live shortcode needs a telco or Africa's Talking. This screen talks to Kolo the same way they would.</p>
  </div>
  <div class="phone"><div class="screen">
    <div class="bar"><span>MTN NG</span><span>12:00</span></div>
    <div class="dialer">
      <label for="msisdn">Your number</label>
      <input id="msisdn" inputmode="tel" placeholder="2348012345678">
      <input id="code" value="${USSD_CODE}" aria-label="USSD code">
      <button class="call" id="dial">Call</button>
    </div>
    <div class="overlay" id="overlay"><div class="dialog">
      <pre id="text"></pre>
      <input id="reply" inputmode="numeric" autocomplete="off">
      <div class="actions"><button class="ghost" id="cancel">Cancel</button><button class="send" id="send">Send</button></div>
    </div></div>
  </div></div>
</div>
<script>
  const $ = (id) => document.getElementById(id)
  let session = '', answers = []
  try { $('msisdn').value = localStorage.getItem('kolo-msisdn') || '' } catch {}
  async function ask() {
    $('text').textContent = 'Running USSD code…'
    $('reply').style.display = 'none'; $('send').style.display = 'none'
    $('overlay').classList.add('open')
    try {
      const body = new URLSearchParams({ sessionId: session, phoneNumber: $('msisdn').value, serviceCode: $('code').value, text: answers.join('*') })
      const res = await (await fetch('/ussd', { method: 'POST', body })).text()
      const more = res.startsWith('CON ')
      $('text').textContent = res.slice(4)
      $('reply').style.display = more ? '' : 'none'
      $('send').style.display = more ? '' : 'none'
      $('cancel').textContent = more ? 'Cancel' : 'OK'
      $('reply').value = ''
      if (more) $('reply').focus()
    } catch { $('text').textContent = 'Connection problem or invalid MMI code.'; $('cancel').textContent = 'OK' }
  }
  $('dial').onclick = () => {
    if (!$('msisdn').value.trim()) { $('msisdn').focus(); return }
    try { localStorage.setItem('kolo-msisdn', $('msisdn').value) } catch {}
    session = 'sim-' + Date.now(); answers = []; ask()
  }
  $('send').onclick = () => { answers.push($('reply').value.trim()); ask() }
  $('reply').onkeydown = (e) => { if (e.key === 'Enter') $('send').click() }
  $('cancel').onclick = () => $('overlay').classList.remove('open')
</script>
</body></html>`
