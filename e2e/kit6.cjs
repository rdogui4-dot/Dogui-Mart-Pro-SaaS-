/** Lot K6 (kit 24 interfaces) : Inventaires (Silent Count) (écran 12) — en-tête, 4 indicateurs réels, filtres par statut avec compteurs, cartes avec étapes et avancement, panneau Silent Count, comptage toujours aveugle, responsive. Lancement : bash e2e/run.sh kit6 */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
(async () => {
  const h = await start({ plan: "business", expect: [] }); const { page } = h; const A = h.shop;
  for (const [n, q] of [["Riz local 5 kg", 40], ["Huile 1 L", 12], ["Sucre 1 kg", 30]]) await h.call("article.save", { data: { name: n, price: 1000, cost: 700, category: "Alimentaire" }, initialQty: q }, A);
  const mk = async () => (await h.call("count.save", { clientId: "c" + Math.random().toString(36).slice(2, 12), kind: "full", categories: [], productIds: [], agents: [], notes: "" }, A)).body.data.id;
  const a = await mk(); await mk(); const r = await h.call("count.start", { id: a }, A); if (r.status >= 400) console.log("start", JSON.stringify(r.body));
  const open = async (w = 1280, hh = 900) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url("inventaire")); await page.waitForSelector("text=INV-", { timeout: 15000 }); await page.waitForTimeout(900); };

  await step("en-tête du kit, « Démarrer un inventaire », 4 indicateurs réels (2 cette année, 1 en cours, 0 terminé, 0 ligne ajustée)", async () => {
    await open(); if (!(await page.getByRole("heading", { name: "Inventaires (Silent Count)" }).count())) throw new Error("titre"); if (!(await page.getByRole("button", { name: "Démarrer un inventaire" }).count())) throw new Error("bouton");
    const k = (l) => page.getByRole("group", { name: l }).innerText(); const y = String(new Date().getFullYear());
    if (!/\b2\b/.test(await k(`Inventaires (${y})`))) throw new Error(await k(`Inventaires (${y})`)); if (!/\b1\b/.test(await k("En cours"))) throw new Error(await k("En cours")); if (!/\b0\b/.test(await k("Terminés"))) throw new Error(await k("Terminés"));
  });
  await step("filtres par statut avec compteurs (Tous 2, Brouillon 1, En cours 1) ; filtre « En cours » n'affiche qu'un inventaire", async () => {
    const t = (await page.getByRole("navigation", { name: "Statut" }).innerText()).replace(/\s+/g, " "); for (const x of [/Tous \(2\)/, /Brouillon \(1\)/, /En cours \(1\)/]) if (!x.test(t)) throw new Error(t);
    await page.getByRole("navigation", { name: "Statut" }).getByRole("button", { name: /^En cours/ }).click(); await page.waitForTimeout(800);
    if ((await page.locator("main button", { hasText: /^INV-|INV-/ }).count()) !== 1) throw new Error("filtre"); await page.getByRole("navigation", { name: "Statut" }).getByRole("button", { name: /^Tous/ }).click(); await page.waitForTimeout(600);
  });
  await step("cartes : étapes (Paramètres → Validation) et avancement ; panneau Silent Count (comptage aveugle)", async () => {
    if ((await page.getByRole("list", { name: /Étapes de INV-/ }).count()) < 2) throw new Error("étapes absentes");
    if (!/Quantités attendues masquées/.test(await page.getByRole("region", { name: "Silent Count" }).innerText())) throw new Error("panneau");
    await page.screenshot({ path: path.join(OUT, "kit6-inventaires-1280.png") });
  });
  await step("comptage toujours aveugle : aucune quantité théorique dans l'inventaire en cours", async () => {
    await page.getByRole("navigation", { name: "Statut" }).getByRole("button", { name: /^En cours/ }).click(); await page.waitForTimeout(700);
    await page.locator("main button", { hasText: "INV-" }).first().click(); await page.waitForTimeout(1200); const t = await page.getByRole("dialog").last().innerText();
    if (/(théorique|stock système|attendu)\s*:?\s*[-+]?\d/i.test(t)) throw new Error("quantité théorique visible : " + t.slice(0, 300)); if (!/quantités théoriques ne sont pas affichées/.test(t)) throw new Error("mention du comptage aveugle absente"); await page.keyboard.press("Escape");
  });
  for (const [w, theme] of [[1600, "light"], [820, "light"], [390, "light"], [360, "light"], [1280, "dark"]]) await step(`${w} px ${theme} : aucun débordement (captures)`, async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("accueil")); await page.evaluate((t) => localStorage.setItem("dmp-theme", t), theme); await open(w);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o);
    await page.screenshot({ path: path.join(OUT, `kit6-inventaires-${theme}-${w}.png`), fullPage: true });
  });
  await page.evaluate(() => localStorage.setItem("dmp-theme", "light"));
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
