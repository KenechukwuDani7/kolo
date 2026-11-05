// Kolo's logo: a glossy piggy bank with a naira coin going into the slot.
// LOGO_SPRITE goes once at the top of <body>; logo(size) then draws it anywhere on the page.
const PIG = `
<ellipse cx="33" cy="58.5" rx="21" ry="2.6" fill="#7a1d3a" opacity=".18"/>
<rect x="41" y="43" width="7" height="13" rx="3.2" fill="url(#kl-leg)"/>
<rect x="18" y="43" width="7" height="13" rx="3.2" fill="url(#kl-leg)"/>
<rect x="41" y="53" width="7" height="3" rx="1.5" fill="#a83558"/>
<rect x="18" y="53" width="7" height="3" rx="1.5" fill="#a83558"/>
<path d="M54 32c4.5-1.6 7 1.8 5 4.2-1.8 2.2-4.6.6-3-1.6" fill="none" stroke="#d9577a" stroke-width="2.2" stroke-linecap="round"/>
<path d="M18.5 24 18 12.5 26 19z" fill="#c94a6c"/>
<g class="logo-coin"><circle cx="41.6" cy="13.4" r="6.6" fill="#b06e00"/><circle cx="41" cy="12.8" r="6.6" fill="url(#kl-coin)"/>
<text x="41" y="15.6" text-anchor="middle" font-family="Encode Sans, Arial, sans-serif" font-weight="800" font-size="8" fill="#8a5300">₦</text></g>
<ellipse cx="34" cy="35" rx="21.5" ry="16.5" fill="url(#kl-body)"/>
<ellipse cx="35" cy="45.5" rx="17" ry="5.5" fill="#a83558" opacity=".16"/>
<path d="M22 22.5 23.5 9.5l8.5 9.5z" fill="url(#kl-ear)"/>
<path d="M23.6 20.2 24.4 13l4.8 5.4z" fill="#ffc7d3"/>
<ellipse cx="13.6" cy="36" rx="5.4" ry="6.6" fill="url(#kl-snout)"/>
<ellipse cx="11" cy="36" rx="3.3" ry="5" fill="#f07a96"/>
<ellipse cx="10.2" cy="34.2" rx=".95" ry="1.4" fill="#9e2f50"/>
<ellipse cx="10.2" cy="37.9" rx=".95" ry="1.4" fill="#9e2f50"/>
<ellipse cx="22.5" cy="28.6" rx="2.1" ry="2.7" fill="#2a141c"/>
<circle cx="23.2" cy="27.7" r=".8" fill="#fff"/>
<ellipse cx="21.5" cy="36.2" rx="3.6" ry="2" fill="#ff6f91" opacity=".35"/>
<rect x="35" y="19.4" width="12" height="2.8" rx="1.4" fill="#8f2a4a"/>
<ellipse cx="31" cy="25.5" rx="11" ry="4.6" fill="#fff" opacity=".38" transform="rotate(-14 31 25.5)"/>`

const DEFS = `
<radialGradient id="kl-body" cx="34%" cy="28%" r="78%"><stop offset="0" stop-color="#ffe3ea"/><stop offset=".45" stop-color="#ff98b0"/><stop offset="1" stop-color="#cf4a70"/></radialGradient>
<radialGradient id="kl-snout" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="#ffc2d0"/><stop offset="1" stop-color="#e2668a"/></radialGradient>
<linearGradient id="kl-ear" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9fb5"/><stop offset="1" stop-color="#d9577a"/></linearGradient>
<linearGradient id="kl-leg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f27d9a"/><stop offset="1" stop-color="#c94a6c"/></linearGradient>
<radialGradient id="kl-coin" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#fff1b8"/><stop offset=".5" stop-color="#f7b733"/><stop offset="1" stop-color="#c27c00"/></radialGradient>`

// Not display:none, so the gradients inside stay usable by every logo on the page.
export const LOGO_SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${DEFS}</defs><symbol id="kolo-pig" viewBox="0 0 64 64">${PIG}</symbol></svg>`

export const logo = (size = 32, cls = 'logo') => `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 64 64" role="img" aria-label="Kolo"><use href="#kolo-pig"/></svg>`

// The logo drawn inline (not through <use>) so a page can animate it: the coin (.logo-coin)
// drops behind the body, so it looks like it goes into the slot. Extra room on top for the drop.
export const animatedLogo = (cls = 'pig-anim') =>
  `<svg class="${cls}" viewBox="0 -14 64 78" role="img" aria-label="A naira coin dropping into the Kolo piggy bank">${PIG}</svg>`

// The same logo as one self-contained file, for the browser tab icon.
const LOGO_FILE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>${DEFS}</defs>${PIG}</svg>`
export const FAVICON = `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(LOGO_FILE)}">`
