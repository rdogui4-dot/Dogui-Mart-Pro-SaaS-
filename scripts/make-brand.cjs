// Génère le logo Dogui Mart Pro (SVG) et ses déclinaisons PNG/ICO à partir d'un seul dessin. Usage : node scripts/make-brand.cjs
const fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const out = path.join(__dirname, "..", "public");

const defs = `<defs>
  <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F7DE8A"/><stop offset=".5" stop-color="#D4AF37"/><stop offset="1" stop-color="#9A7414"/></linearGradient>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#17171A"/><stop offset="1" stop-color="#070708"/></linearGradient>
</defs>`;
// Symbole : chariot (poignée, panier plein avec « D » évidé, deux roues) + flèche de croissance.
const mark = `<g fill="none" stroke="url(#g)" stroke-linecap="round" stroke-linejoin="round">
  <path d="M64 150 H122 L176 330 H408" stroke-width="28"/>
  <polyline points="196 128 262 86 306 112 402 44" stroke-width="22"/>
  <polyline points="352 40 408 36 404 94" stroke-width="22"/>
</g>
<path d="M146 176 H452 L412 308 H182 Z" fill="url(#g)"/>
<path d="M282 204 V282 H306 C344 282 362 262 362 243 C362 224 344 204 306 204 Z" fill="none" stroke="#0B0B0C" stroke-width="20" stroke-linejoin="round"/>
<circle cx="214" cy="378" r="30" fill="url(#g)"/><circle cx="378" cy="378" r="30" fill="url(#g)"/>`;

const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Dogui Mart Pro">${defs}
<rect width="512" height="512" rx="112" fill="url(#bg)"/>
<rect x="6" y="6" width="500" height="500" rx="106" fill="none" stroke="url(#g)" stroke-opacity=".55" stroke-width="4"/>
<g transform="translate(26 30) scale(.9)">${mark}</g></svg>`;
// Maskable : fond plein écran, symbole réduit pour rester dans la zone de sécurité (80 %).
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}<rect width="512" height="512" fill="url(#bg)"/><g transform="translate(76 80) scale(.7)">${mark}</g></svg>`;
// Logo horizontal : symbole + nom + signature.
const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1180 300" role="img" aria-label="Dogui Mart Pro">${defs}
<g transform="translate(10 10) scale(.56)">${icon.replace(/^<svg[^>]*>|<\/svg>$/g, "").replace(defs, "")}</g>
<text x="330" y="150" font-family="Poppins, 'Segoe UI', Arial, sans-serif" font-size="108" font-weight="800" letter-spacing="3" fill="url(#g)">DOGUI MART</text>
<text x="334" y="232" font-family="Poppins, 'Segoe UI', Arial, sans-serif" font-size="70" font-weight="600" letter-spacing="26" fill="#F4F1E8">PRO</text>
<text x="640" y="232" font-family="Arial, sans-serif" font-size="32" letter-spacing="2" fill="#F4F1E8" fill-opacity=".6">Gestion de commerce</text></svg>`;

fs.writeFileSync(path.join(out, "icon.svg"), icon);
fs.writeFileSync(path.join(out, "icon-maskable.svg"), maskable);
fs.writeFileSync(path.join(out, "logo.svg"), logo);

(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const png = async (svg, size, file) => {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body>`);
    fs.writeFileSync(path.join(out, file), await p.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
  };
  await png(icon, 192, "icon-192.png"); await png(icon, 512, "icon-512.png"); await png(maskable, 512, "icon-maskable-512.png");
  await png(maskable, 180, "apple-touch-icon.png"); await png(icon, 32, "favicon-32.png"); await png(icon, 48, "favicon-48.png");
  // favicon.ico : 32 et 48 px en PNG intégré.
  const imgs = [["favicon-32.png", 32], ["favicon-48.png", 48]].map(([f, s]) => [fs.readFileSync(path.join(out, f)), s]);
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(imgs.length, 4);
  let off = 6 + 16 * imgs.length; const dir = [], data = [];
  for (const [buf, s] of imgs) { const e = Buffer.alloc(16); e[0] = s; e[1] = s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(buf.length, 8); e.writeUInt32LE(off, 12); off += buf.length; dir.push(e); data.push(buf); }
  fs.writeFileSync(path.join(out, "favicon.ico"), Buffer.concat([head, ...dir, ...data]));
  // aperçu du logo horizontal (fond sombre)
  await p.setViewportSize({ width: 1180, height: 300 });
  await p.setContent(`<body style="margin:0;background:#0b0b0c">${logo.replace("<svg ", '<svg width="1180" height="300" ')}</body>`);
  fs.writeFileSync(path.join(out, "logo.png"), await p.screenshot());
  await b.close();
})();
