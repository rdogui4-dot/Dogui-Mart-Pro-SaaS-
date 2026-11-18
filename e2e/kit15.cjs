/** Lot K15 (kit 24 interfaces) : Rapports & Analyses (écran 21) — en-tête, 5 indicateurs réels (CA, quantités, marge nette, rotation, résultat net = marge − dépenses validées), onglets du kit, vue d'ensemble (évolution 6 mois, catégories, top 5, performance mensuelle, charges, tendance, rapports disponibles « Voir », export, MASTER), rapports clients, responsive. Lancement : bash e2e/run.sh kit15 */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
const nb = (t) => t.replace(/[\s  ]/g, "");
let n = 0; const cid = () => `vente-${String(++n).padStart(8, "0")}`;
(async () => {
  const h = await start({ plan: "pro", expect: [] }); const { page, st } = h; const A = h.shop; const T = st.rows("shops")[0].tenantId;
  const ok = async (a, p) => { const r = await h.call(a, p, A); if (r.status !== 200) throw new Error(a + " " + JSON.stringify(r.body)); return r.body.data; };
  const riz = (await ok("article.save", { data: { name: "Riz local 25 kg", price: 2000, cost: 1500, category: "Alimentation" }, initialQty: 100 })).id;
  const savon = (await ok("article.save", { data: { name: "Savon", price: 500, cost: 300, category: "Hygiène" }, initialQty: 100 })).id;
  const awa = (await ok("entity.save", { table: "customers", data: { name: "Awa Koné", creditLimit: 100000 } })).id;
  await ok("checkout", { clientId: cid(), lines: [{ productId: riz, qty: 3 }], payments: [{ method: "cash", amount: 6000 }], customerId: awa });
  await ok("checkout", { clientId: cid(), lines: [{ productId: savon, qty: 4 }], payments: [{ method: "cash", amount: 2000 }] });
  await st.create("expenses", "kexp1", T, { tenantId: T, shopId: A, number: "D-1", label: "Loyer", category: "Loyer", amount: 1000, status: "approved", spentOn: new Date().toISOString().slice(0, 10) });
  const open = async (w = 1440, hh = 1000) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url("pilotage")); await page.getByRole("heading", { name: "Rapports & Analyses" }).waitFor({ timeout: 15000 }); await page.waitForTimeout(2000); };
  const kpi = (l) => page.getByRole("group", { name: l }).innerText();

  await step("en-tête, onglets du kit et seconde ligne, vue d'ensemble par défaut", async () => {
    await open(); for (const t of ["Vue d'ensemble", "Rapports de ventes", "Rapports de stocks", "Rapports financiers", "Rapports clients", "Analyses avancées", "Activité", "Vue exécutive", "Exports"]) if (!(await page.getByRole("tab", { name: t, exact: true }).count())) throw new Error("onglet " + t);
    if ((await page.getByRole("tab", { name: "Vue d'ensemble" }).getAttribute("aria-selected")) !== "true") throw new Error("vue par défaut");
  });
  await step("5 indicateurs réels : CA 8 000 F, 7 unités, résultat net = marge brute HT − 1 000 F de dépenses", async () => {
    if (!nb(await kpi("Chiffre d'affaires")).includes("8000")) throw new Error(await kpi("Chiffre d'affaires")); if (!/\b7\b/.test(await kpi("Quantités vendues"))) throw new Error(await kpi("Quantités vendues"));
    const net = nb(await kpi("Résultat net")); if (!/dépenses1000/.test(net)) throw new Error(net); if (/—/.test(await kpi("Marge nette"))) throw new Error("marge nette non calculée");
  });
  await step("vue d'ensemble : évolution, catégories, top 5, performance, charges (Loyer), tendance prudente, MASTER", async () => {
    if (!(await page.getByRole("region", { name: "Évolution du chiffre d'affaires" }).locator("svg").count())) throw new Error("évolution");
    const cat = await page.getByRole("region", { name: "Ventes par catégorie" }).innerText(); if (!/Alimentation/.test(cat) || !/Hygiène/.test(cat)) throw new Error(cat);
    if (!/Riz local 25 kg/.test(await page.getByRole("table", { name: "Top 5 articles" }).innerText())) throw new Error("top 5");
    if (!/Loyer/.test(await page.getByRole("region", { name: "Répartition des charges" }).innerText())) throw new Error("charges");
    if (!/Historique insuffisant/.test(await page.getByRole("region", { name: "Tendances & prévisions" }).innerText())) throw new Error("aucune prévision fragile attendue");
    if (!/Article le plus vendu/.test(await page.getByRole("region", { name: "MASTER DOGUI — Rapports" }).innerText())) throw new Error("MASTER");
    await page.screenshot({ path: path.join(OUT, "kit15-rapports-1440.png"), fullPage: true });
  });
  await step("rapports disponibles : « Voir » le rapport clients (contenu réel) ; export PDF téléchargé", async () => {
    await page.getByRole("button", { name: "Voir le rapport clients" }).click(); const dlg = page.getByRole("dialog", { name: "Rapport clients" }); await dlg.waitFor({ timeout: 10000 }); if (!/Awa Koné/.test(await dlg.innerText())) throw new Error("contenu"); await page.keyboard.press("Escape");
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.getByRole("button", { name: "Générer le rapport" }).click()]); const b = fs.readFileSync(await dl.path()); if (b.slice(0, 4).toString() !== "%PDF") throw new Error("PDF");
  });
  await step("rapports clients : 1 client acheteur, comptoir à part, meilleur client Awa Koné", async () => {
    await page.getByRole("tab", { name: "Rapports clients" }).click(); await page.waitForTimeout(2000); const t = nb(await page.locator("main").innerText());
    if (!/Clientsacheteurs(commercial)?1/.test(t) || !/Ventesaucomptoir\(sansclient\)(commercial)?1vente/.test(t) || !t.includes("AwaKoné")) throw new Error(t.slice(t.indexOf("Clients"), t.indexOf("Clients") + 400));
  });
  for (const [w, theme] of [[1600, "light"], [1280, "light"], [820, "light"], [390, "light"], [1280, "dark"]]) await step(`${w} px ${theme} : aucun débordement (captures)`, async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("accueil")); await page.evaluate((t) => localStorage.setItem("dmp-theme", t), theme); await open(w, 900);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o); await page.screenshot({ path: path.join(OUT, `kit15-${theme}-${w}.png`), fullPage: true });
  });
  await page.evaluate(() => localStorage.setItem("dmp-theme", "light"));
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
