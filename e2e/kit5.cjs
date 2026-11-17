/** Lot K5 (kit 24 interfaces) : Stocks & Mouvements (écran 11) — en-tête, onglets, 5 indicateurs réels, état des stocks (plus critiques d'abord), derniers mouvements typés, encart MASTER sur les alertes réelles, nouveau transfert, responsive. Lancement : bash e2e/run.sh kit5 */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
(async () => {
  const h = await start({ plan: "pro", expect: [] }); const { page } = h; const A = h.shop;
  const mk = (n, p, c, q, min) => h.call("article.save", { data: { name: n, price: p, cost: c, category: "Alimentaire", minStock: min }, initialQty: q }, A).then((r) => r.body.data.id);
  const riz = await mk("Riz local 25 kg", 18000, 15000, 40, 10); await mk("Huile 1 L", 4000, 3000, 3, 10); await mk("Savon", 500, 300, 0, 5);
  await h.call("checkout", { clientId: "s1" + Math.random().toString(36).slice(2, 9), lines: [{ productId: riz, qty: 2 }], payments: [{ method: "cash", amount: 36000 }] }, A);
  const open = async (w = 1280, hh = 900) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url("stock")); await page.waitForSelector("text=Articles suivis", { timeout: 15000 }); await page.waitForTimeout(1200); };

  await step("en-tête du kit, onglets (Vue du stock, Comptage rapide, Mouvements, Transferts, Alertes) et lien Inventaires", async () => {
    await open(); if (!(await page.getByRole("heading", { name: "Stocks & Mouvements" }).count())) throw new Error("titre");
    for (const t of ["Vue du stock", "Comptage rapide", "Mouvements", "Transferts", /Alertes/]) if (!(await page.getByRole("tab", { name: t }).count())) throw new Error("onglet " + t);
    if (!(await page.getByRole("link", { name: "Inventaires", exact: true }).count())) throw new Error("lien inventaires");
  });
  await step("indicateurs réels : 3 articles suivis, 1 disponible, 1 stock bas, 1 rupture, valeur 579 000 F", async () => {
    const k = (l) => page.getByRole("group", { name: l }).innerText();
    if (!/\b3\b/.test(await k("Articles suivis"))) throw new Error(await k("Articles suivis")); if (!/\b1\b/.test(await k("Disponibles"))) throw new Error(await k("Disponibles"));
    if (!/\b1\b/.test(await k("Stock bas")) || !/\b1\b/.test(await k("En rupture"))) throw new Error("bas/rupture"); if (!/579\s?000/.test(await k("Valeur estimée du stock"))) throw new Error(await k("Valeur estimée du stock"));
  });
  await step("état des stocks : plus critiques d'abord (Savon rupture, puis Huile stock bas, puis Riz)", async () => {
    const rows = await page.locator("table[aria-label='État des stocks'] tbody tr").allInnerTexts(); if (!/Savon/.test(rows[0]) || !/Huile/.test(rows[1]) || !/Riz/.test(rows[2])) throw new Error(rows.join(" | "));
    await page.locator("table[aria-label='État des stocks'] tbody tr", { hasText: "Huile" }).click(); await page.getByText("Réservé").first().waitFor({ timeout: 5000 }); await page.keyboard.press("Escape");
  });
  await step("derniers mouvements : la vente apparaît en sortie (−2) ; encart MASTER sur les alertes réelles", async () => {
    const mv = await page.getByRole("region", { name: "Derniers mouvements" }).innerText(); if (!/Riz local 25 kg/.test(mv) || !/[−-]2/.test(mv)) throw new Error(mv.slice(0, 300));
    const md = await page.getByRole("region", { name: "MASTER DOGUI — Stocks" }).innerText(); if (!/Savon|Huile/.test(md)) throw new Error(md.slice(0, 300)); if (/Appliquer/.test(md)) throw new Error("action automatique");
    await page.screenshot({ path: path.join(OUT, "kit5-stock-1280.png"), fullPage: true });
  });
  await step("formule Pro : « Exporter » mène aux rapports", async () => { await page.getByRole("button", { name: "Exporter" }).click(); await page.waitForTimeout(500); if ((await page.getByRole("tab", { name: "Rapports" }).getAttribute("aria-selected")) !== "true") throw new Error("rapports non ouverts"); });
  for (const [w, theme] of [[1600, "light"], [820, "light"], [390, "light"], [360, "light"], [1280, "dark"]]) await step(`${w} px ${theme} : aucun débordement (captures)`, async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("accueil")); await page.evaluate((t) => localStorage.setItem("dmp-theme", t), theme); await open(w);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o);
    await page.screenshot({ path: path.join(OUT, `kit5-stock-${theme}-${w}.png`), fullPage: true });
  });
  await page.evaluate(() => localStorage.setItem("dmp-theme", "light"));
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
