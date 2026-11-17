/** Lot K9 (kit 24 interfaces) : Promotions & Offres (écran 15) — en-tête et « Créer une promotion », 5 indicateurs réels, onglets du kit, performance par promotion, ventes en promotion par semaine, cartes de création, encart MASTER, responsive. Lancement : bash e2e/run.sh kit9 */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
(async () => {
  const h = await start({ plan: "pro", expect: [] }); const { page } = h; const A = h.shop; const iso = (d) => new Date(Date.now() + d * 864e5).toISOString();
  const art = async (name, price) => (await h.call("article.save", { data: { name, price, cost: Math.round(price * 0.5), category: "Alimentaire" }, initialQty: 100 }, A)).body.data.id;
  const riz = await art("Riz local 5 kg", 5000), huile = await art("Huile 1 L", 2000); await art("Sel", 200);
  const promo = async (name, ids, value) => { const id = (await h.call("promotion.save", { data: { name, kind: "percent", scope: "items", value, startAt: iso(-1), endAt: iso(10) }, productIds: ids }, A)).body.data.id; await h.call("promotion.status", { id, to: "enabled" }, A); return id; };
  await promo("Promo Riz", [riz], 10); await promo("Huile en fête", [huile], 15);
  const cu = (await h.call("entity.save", { table: "customers", data: { name: "Awa" } }, A)).body.data.id;
  const sell = (lines, total, extra = {}) => h.call("checkout", { clientId: "k9" + Math.random().toString(36).slice(2, 12), lines, payments: [{ method: "cash", amount: total }], ...extra }, A);
  await sell([{ productId: riz, qty: 2 }], 9000, { customerId: cu }); await sell([{ productId: huile, qty: 1 }], 1700);
  const open = async (w = 1440, hh = 1000) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url("promotions")); await page.getByRole("heading", { name: "Promotions & Offres Commerciales" }).waitFor({ timeout: 15000 }); await page.waitForTimeout(1500); };

  await step("en-tête du kit, « Créer une promotion » ouvre le formulaire, onglets du kit", async () => {
    await open(); await page.getByRole("button", { name: "Créer une promotion" }).click(); await page.getByLabel("Nom de la campagne *").waitFor({ timeout: 5000 }); await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    for (const t of ["Promotions actives", "Offres groupées", "Coupons", "Programmes de fidélité", "Analyses"]) if (!(await page.getByRole("tab", { name: t }).count())) throw new Error("onglet " + t);
  });
  await step("5 indicateurs réels : ventes en promo 10 700 F, 2 actives, 2 articles, 1 client, remises 1 300 F", async () => {
    const k = (l) => page.getByRole("group", { name: l }).innerText();
    if (!/10\s?700/.test(await k("Ventes en promo"))) throw new Error(await k("Ventes en promo")); if (!/\b2\b/.test(await k("Promotions actives"))) throw new Error("actives");
    if (!/\b2\b/.test(await k("Articles en promotion"))) throw new Error(await k("Articles en promotion")); if (!/\b1\b/.test(await k("Clients concernés"))) throw new Error(await k("Clients concernés")); if (!/1\s?300/.test(await k("Remises accordées"))) throw new Error(await k("Remises accordées"));
  });
  await step("performance par promotion (Promo Riz, Huile en fête), ventes en promotion par semaine, liste « Promotions en cours (2) »", async () => {
    const p = await page.getByRole("region", { name: "Performance des promotions" }).innerText(); if (!/Promo Riz/.test(p) || !/Huile en fête/.test(p)) throw new Error(p);
    if (!(await page.getByRole("region", { name: "Ventes en promotion par semaine" }).locator("svg").count())) throw new Error("courbe absente");
    if (!(await page.getByRole("region", { name: "Promotions en cours (2)" }).count())) throw new Error("titre de liste");
    await page.screenshot({ path: path.join(OUT, "kit9-promotions-1440.png"), fullPage: true });
  });
  await step("carte « Offre groupée (pack) » ouvre le formulaire pré-réglé sur Pack ; « Coupon » mène aux coupons", async () => {
    await page.getByRole("button", { name: "Offre groupée (pack)" }).click(); await page.getByLabel("Type de promotion *").waitFor({ timeout: 5000 }); if ((await page.getByLabel("Type de promotion *").inputValue()) !== "combo") throw new Error("type non pré-réglé"); await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Coupon / code promo" }).click(); if ((await page.getByRole("tab", { name: "Coupons" }).getAttribute("aria-selected")) !== "true") throw new Error("coupons");
  });
  await step("encart MASTER (constats et recommandations réels) ; Programmes de fidélité renvoie vers Clients", async () => {
    await page.getByRole("tab", { name: "Promotions actives" }).click(); await page.getByRole("region", { name: "MASTER DOGUI — Promotions" }).waitFor({ timeout: 8000 });
    await page.getByRole("tab", { name: "Programmes de fidélité" }).click(); if (!(await page.getByRole("link", { name: "Ouvrir Clients (CRM)" }).count())) throw new Error("lien CRM");
  });
  for (const [w, theme] of [[1600, "light"], [1024, "light"], [820, "light"], [390, "light"], [360, "light"], [1280, "dark"]]) await step(`${w} px ${theme} : aucun débordement (captures)`, async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("accueil")); await page.evaluate((t) => localStorage.setItem("dmp-theme", t), theme); await open(w, 900);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o); await page.screenshot({ path: path.join(OUT, `kit9-promotions-${theme}-${w}.png`), fullPage: true });
  });
  await page.evaluate(() => localStorage.setItem("dmp-theme", "light"));
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
