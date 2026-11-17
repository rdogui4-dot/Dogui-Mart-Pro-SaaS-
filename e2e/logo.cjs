/** Captures du nouveau logo (N1) : connexion, barre latérale, bouton et fenêtre MASTER, page de présentation, clair/sombre. Lancement : bash e2e/run.sh logo */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
(async () => {
  const h = await start({ plan: "pro", expect: [] }); const { page } = h;
  const broken = async () => page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src));
  for (const theme of ["light", "dark"]) for (const [w, hh] of [[390, 800], [1280, 800]]) await step(`accueil ${theme} ${w} px : logo et bouton MASTER (images chargées)`, async () => {
    await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url("accueil")); await page.evaluate((t) => { localStorage.setItem("dmp-theme", t); }, theme); await page.reload(); await page.waitForSelector("text=Accueil", { timeout: 15000 }); await page.waitForTimeout(1200);
    const b = await broken(); if (b.length) throw new Error("images cassées : " + b.join(", "));
    if (!(await page.locator('img[src$="icon.svg"]').count())) throw new Error("symbole absent");
    if (w >= 768 && !(await page.getByText("MART PRO", { exact: true }).count())) throw new Error("mot-symbole absent");
    await page.screenshot({ path: path.join(OUT, `logo-accueil-${theme}-${w}.png`) });
    await page.getByRole("button", { name: "MASTER DOGUI", exact: true }).first().click(); await page.waitForTimeout(900); await page.screenshot({ path: path.join(OUT, `logo-master-${theme}-${w}.png`) }); await page.keyboard.press("Escape");
  });
  await step("page de présentation : nouveau logo", async () => { await page.setViewportSize({ width: 1280, height: 800 }); await page.goto(h.url("presentation/")); await page.waitForTimeout(1200); const b = await broken(); if (b.length) throw new Error(b.join(", ")); await page.screenshot({ path: path.join(OUT, "logo-presentation-1280.png") }); });
  await step("manifeste : icônes accessibles", async () => { for (const f of ["icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png", "favicon.ico", "icon.svg", "master-icon.svg", "master-symbol.svg", "logo.png"]) { const r = await page.request.get(h.url(f)); if (r.status() !== 200 || (await r.body()).length < 200) throw new Error(f + " " + r.status()); } });
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
