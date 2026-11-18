/** Lot K13 (kit 24 interfaces) : IProj-Invest — Investissements & Projections (écran 19) — en-tête et « Nouveau projet », 5 indicateurs réels (scénario central), onglets du kit, projection, indicateurs du portefeuille, répartition par type, scénarios, analyse Pro, MASTER, responsive. Lancement : bash e2e/run.sh kit13 */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
const rid = () => `k${Math.random().toString(36).slice(2, 14)}`; const day = (o = 0) => new Date(Date.now() + o * 864e5).toISOString().slice(0, 10);
(async () => {
  const h = await start({ plan: "pro", expect: [] }); const { page } = h; const A = h.shop;
  const ok = async (a, p) => { const r = await h.call(a, p, A); if (r.status !== 200) throw new Error(a + " " + JSON.stringify(r.body)); return r.body.data; };
  const HYP = (o = {}) => ({ months: 24, monthlySales: 1500000, marginPct: 30, fixedCosts: 150000, growthPct: 0, delayMonths: 1, residualValue: 0, extras: [], ...o });
  const big = (await ok("inv.item.save", { kind: "project", requestKey: rid(), name: "Second magasin", budget: 5000000, startOn: day(-40), objective: "Ouvrir un second point de vente", type: "Nouveau magasin" })).id;
  for (const [n, o] of [["prudent", { monthlySales: 1000000 }], ["central", {}], ["optimistic", { growthPct: 2 }]]) await ok("inv.scenario.save", { id: big, name: n, ...HYP(o) });
  await ok("inv.item.status", { id: big, status: "approved" });
  await ok("inv.item.save", { kind: "project", requestKey: rid(), name: "Camion de livraison", budget: 2000000, startOn: day(-10), objective: "Livrer les clients", type: "Véhicule" });
  const open = async (w = 1440, hh = 1000) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url("investissements")); await page.getByRole("heading", { name: "IProj-Invest — Investissements & Projections" }).waitFor({ timeout: 15000 }); await page.waitForTimeout(1500); };
  const tab = async (n) => { await page.getByRole("tab", { name: n }).first().click(); await page.waitForTimeout(1000); };

  await step("en-tête du kit, « Nouveau projet » ouvre la saisie, onglets du kit et seconde ligne", async () => {
    await open(); await page.getByRole("button", { name: "Nouveau projet" }).first().click(); await page.getByRole("dialog", { name: "Nouveau projet" }).waitFor({ timeout: 5000 }); await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    for (const t of ["Vue d'ensemble", "Projets d'investissement", "Simulations & projections", "Plan de financement", "Suivi & rentabilité", "Placements", "Portefeuille", "Profil de risque", "Réglages Pro"]) if (!(await page.getByRole("tab", { name: t }).count())) throw new Error("onglet " + t);
  });
  await step("5 indicateurs réels : 5 000 000 F en cours, 1 projet actif sur 2, ROI / gain / retour sur 1 projet à scénario central", async () => {
    const k = (l) => page.getByRole("group", { name: l }).innerText();
    if (!/5\s?000\s?000/.test(await k("Investissements en cours"))) throw new Error(await k("Investissements en cours")); const a = await k("Projets actifs"); if (!/\b1\b/.test(a) || !/sur 2/.test(a)) throw new Error(a);
    for (const l of ["ROI moyen (central)", "Gain annuel estimé", "Délai moyen de retour"]) { const t = await k(l); if (/—/.test(t)) throw new Error(l + " : " + t); }
    if (!/1 projet\(s\) avec scénario central/.test(await k("ROI moyen (central)"))) throw new Error("périmètre du ROI non affiché");
  });
  await step("vue d'ensemble : projection, indicateurs, répartition par type, 3 scénarios, analyse Pro (coût du capital à définir), MASTER", async () => {
    if (!(await page.getByRole("region", { name: "Projection — Second magasin" }).locator("svg").count())) throw new Error("projection");
    if (!/ROI global/.test(await page.getByRole("region", { name: "Indicateurs du portefeuille" }).innerText())) throw new Error("indicateurs");
    const r = await page.getByRole("region", { name: "Répartition par type" }).innerText(); if (!/Nouveau magasin/.test(r) || !/Véhicule/.test(r)) throw new Error("répartition " + r);
    if ((await page.getByRole("table", { name: "Comparaison des scénarios" }).locator("tbody tr").count()) !== 3) throw new Error("scénarios");
    if (!/Coût du capital non défini/.test(await page.getByRole("region", { name: "Analyse Pro" }).innerText())) throw new Error("analyse Pro");
    if (!/Scénario central manquant : Camion de livraison/.test(await page.getByRole("region", { name: "MASTER DOGUI — IProj-Invest" }).innerText())) throw new Error("MASTER");
    await page.screenshot({ path: path.join(OUT, "kit13-invest-1440.png"), fullPage: true });
  });
  await step("coût du capital défini → VAN, TRI et indice de profitabilité affichés", async () => {
    await ok("ip.config.save", { discountRatePct: 10 }); await open(); const t = await page.getByRole("region", { name: "Analyse Pro" }).innerText(); for (const x of ["VAN (10 %)", "TRI annuel", "Indice de profitabilité"]) if (!t.includes(x)) throw new Error(x + " : " + t);
  });
  await step("simulations : courbe, 3 scénarios et sensibilité ; financement Pro ; suivi en tableau ; projets en tableau", async () => {
    await tab("Simulations & projections"); await page.getByRole("region", { name: "Trésorerie cumulée projetée" }).locator("svg").waitFor({ timeout: 8000 }); if ((await page.getByRole("region", { name: "Scénarios et hypothèses" }).getByRole("button", { name: "Modifier" }).count()) !== 3) throw new Error("scénarios modifiables");
    await tab("Plan de financement"); await page.getByText("IProj-Invest Pro").first().waitFor({ timeout: 8000 });
    await tab("Suivi & rentabilité"); const rows = await page.getByRole("table", { name: "Suivi des projets" }).locator("tbody tr").count(); if (rows !== 2) throw new Error("suivi " + rows);
    await tab("Projets d'investissement"); await page.waitForSelector("table", { timeout: 8000 }); if (await page.getByRole("button", { name: "Nouveau projet" }).count() !== 1) throw new Error("bouton « Nouveau projet » en double");
  });
  for (const [w, theme] of [[1600, "light"], [1280, "light"], [820, "light"], [390, "light"], [360, "light"], [1280, "dark"]]) await step(`${w} px ${theme} : aucun débordement (captures)`, async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("accueil")); await page.evaluate((t) => localStorage.setItem("dmp-theme", t), theme); await open(w, 900);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o); await page.screenshot({ path: path.join(OUT, `kit13-invest-${theme}-${w}.png`), fullPage: true });
  });
  await page.evaluate(() => localStorage.setItem("dmp-theme", "light"));
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
