/** Lot K13b : IProj Marchés & connaissances — change (parité exacte), économies africaines (année affichée), BRVM Pro désactivée par défaut puis activée (source communautaire, fractionnement ajusté, fiche titre), contexte mondial sans clé, liens projets, connaissances, sources, responsive. Faux réseau : aucune source réelle appelée. Lancement : bash e2e/run.sh kit13b */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const { setMarketFetch } = require("./.build/server.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
const COURS = ["date,ticker,ouverture,haut,bas,cloture,volume_titres,volume_fcfa", "2025-11-03,SNTS,26100.0,,,26100.0,100.0,2610000.0", "2026-10-23,SNTS,42500.0,,,43850.0,35656.0,1563515600.0", "2026-10-26,SNTS,4710.0,,,4700.0,323351.0,1519749700.0", "2026-11-17,SNTS,4145.0,,,4110.0,1000.0,4110000.0", "2026-11-14,ORAC,19000.0,,,19500.0,10.0,195000.0", "2026-11-17,ORAC,19500.0,,,19800.0,20.0,396000.0"].join("\n");
const FILES = { "cours.csv": COURS, "referentiel.csv": "ticker,nom,secteur,premiere_vue,derniere_vue\nSNTS,SONATEL SENEGAL,Télécommunications,2015,2026\nORAC,ORANGE COTE D'IVOIRE,Télécommunications,2015,2026\n", "dividendes.csv": "ticker,date_detachement,montant,exercice\nSNTS,2026-05-22,1740.0,2025.0\n", "fractionnements.csv": 'ticker,date,rapport,note\nSNTS,2026-10-26,10.0,"1 ancienne = 10 nouvelles"\n' };
const FX = [{ date: "2026-10-20", base: "EUR", quote: "USD", rate: 1.12 }, { date: "2026-11-18", base: "EUR", quote: "USD", rate: 1.0999 }, { date: "2026-11-18", base: "EUR", quote: "NGN", rate: 1490.08 }];
const wb = (ind) => [{ page: 1 }, [{ country: { id: "SN" }, countryiso3code: "SEN", date: ind === "FR.INR.LEND" ? "2016" : "2025", value: ind === "FP.CPI.TOTL.ZG" ? 1.459 : ind === "FR.INR.LEND" ? 5.3 : 6.68 }, { country: { id: "NG" }, countryiso3code: "NGA", date: "2025", value: ind === "FP.CPI.TOTL.ZG" ? 23.01 : 18.45 }]];
const res = (body, status = 200, h = {}) => Promise.resolve({ ok: status < 300, status, text: () => Promise.resolve(body), headers: { get: (k) => h[k.toLowerCase()] ?? null } });
setMarketFetch((url, init) => { const u = new URL(url); if (u.host === "api.frankfurter.dev") return res(JSON.stringify(FX)); if (u.host === "api.worldbank.org") return res(JSON.stringify(wb(url.split("/indicator/")[1].split("?")[0])));
  if (u.host === "raw.githubusercontent.com") { const f = url.split("/").pop(); return init?.method === "HEAD" ? res("", 200, { "content-length": String(FILES[f].length) }) : res(FILES[f]); } return Promise.reject(new Error("hôte inattendu " + u.host)); });
(async () => {
  const h = await start({ plan: "pro", expect: [] }); const { page } = h; const A = h.shop;
  const ok = async (a, p) => { const r = await h.call(a, p, A); if (r.status !== 200) throw new Error(a + " " + JSON.stringify(r.body)); return r.body.data; };
  await ok("inv.item.save", { kind: "placement", requestKey: "kplacemente2e001", asset: "Obligation Etat", amount: 1000000, boughtOn: "2026-01-10", horizonMonths: 36, fees: 0, expectedRatePct: 6.5, risk: "low", riskNotes: "Risque de défaut de l'émetteur" });
  const open = async (w = 1440, hh = 1000) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url("investissements")); await page.getByRole("heading", { name: "IProj-Invest — Investissements & Projections" }).waitFor({ timeout: 15000 }); await page.getByRole("tab", { name: "Marchés & connaissances" }).click(); await page.waitForTimeout(1200); };
  const sub = async (n) => { await page.getByRole("tablist", { name: "Rubriques des marchés" }).getByRole("tab", { name: n }).click(); await page.waitForTimeout(1000); };

  await step("change : 1 EUR = 655,957 FCFA (parité fixe), dollar calculé, convertisseur, source et date", async () => {
    await open(); const t = await page.getByRole("table", { name: "Taux de change en FCFA" }).innerText(); if (!/655,957/.test(t) || !/parité fixe/.test(t)) throw new Error(t.slice(0, 300)); if (!/596,3/.test(t)) throw new Error("USD " + t.slice(0, 300));
    await page.getByLabel("Montant à convertir").fill("596374"); await page.waitForTimeout(300); const c = (await page.getByRole("region", { name: "Convertisseur" }).innerText()).replace(/[\s\u202f\u00a0]+/g, " "); if (!/(999,9\d|1 000) USD/.test(c)) throw new Error(c);
    if (!/Frankfurter/.test(await page.locator("main").innerText())) throw new Error("source absente"); await page.screenshot({ path: path.join(OUT, "kit13b-change-1440.png"), fullPage: true });
  });
  await step("économies : valeurs avec année, « non publié », pays de référence, liens projets (taux de 2016 jugé trop ancien, rendement réel du placement)", async () => {
    await sub("Économies africaines"); const t = await page.getByRole("table", { name: "Indicateurs économiques par pays" }).innerText(); if (!/1,46 %/.test(t) || !/2016/.test(t) || !/non publié/.test(t)) throw new Error(t.slice(0, 400));
    await page.getByLabel("Pays de référence", { exact: true }).selectOption("SN"); await page.waitForTimeout(1500); const l = await page.getByRole("region", { name: "Pour vos projets et placements" }).innerText();
    if (!/trop ancien/.test(l) || !/réel \+5,04 %/.test(l)) throw new Error(l);
    await page.getByLabel("Pays de référence", { exact: true }).selectOption("NG"); await page.waitForTimeout(1500); await page.getByRole("button", { name: /Utiliser 18,45 % comme coût du capital/ }).click(); await page.getByText("Coût du capital mis à jour").waitFor({ timeout: 5000 });
    const cfg = await ok("ip.config", {}); if (cfg.config.discountRatePct !== 18.45) throw new Error("coût du capital " + cfg.config.discountRatePct);
  });
  await step("BRVM : désactivée par défaut → activation dans Sources → cours ajustés (Sonatel +57 % sur un an), avertissement non officiel, fiche titre", async () => {
    await sub("BRVM"); await page.getByText(/désactivée/).first().waitFor({ timeout: 5000 }); await page.getByRole("button", { name: "Voir les sources" }).click(); await page.waitForTimeout(600);
    await page.locator("div.rounded-xl", { hasText: "Cours de la BRVM" }).getByRole("button", { name: "Activer" }).click(); await page.waitForTimeout(1200); await sub("BRVM");
    const t = await page.getByRole("table", { name: "Cours BRVM" }).innerText(); if (!/SNTS/.test(t) || !/\+57,47 %/.test(t)) throw new Error(t.slice(0, 400)); if (!/non officielle/.test(await page.locator("main").innerText())) throw new Error("avertissement");
    if (!/1 en hausse|en hausse/.test(await page.getByRole("region", { name: "Séance", exact: true }).innerText())) throw new Error("séance");
    await page.getByRole("table", { name: "Cours BRVM" }).getByText("SNTS").click(); await page.getByRole("dialog").getByText("Dividendes détachés").waitFor({ timeout: 8000 }); const d = await page.getByRole("dialog").innerText(); if (!/rapport 10/.test(d)) throw new Error(d.slice(0, 400));
    await page.screenshot({ path: path.join(OUT, "kit13b-brvm-1440.png"), fullPage: true }); await page.keyboard.press("Escape");
  });
  await step("contexte mondial sans clé FRED : message clair, aucun chiffre ; connaissances avec recherche", async () => {
    await sub("Contexte mondial"); await page.getByText("Contexte mondial non disponible").waitFor({ timeout: 5000 });
    await sub("Connaissances"); await page.getByLabel("Rechercher dans les connaissances").fill("SGI"); const t = await page.locator("main").innerText(); if (!/société de gestion et d'intermédiation/.test(t)) throw new Error("recherche");
  });
  await step("Business : change visible, BRVM et monde verrouillés", async () => {
    h.st.rows("subscriptions")[0].plan = "business"; await open(); await page.getByRole("table", { name: "Taux de change en FCFA" }).waitFor({ timeout: 8000 }); await sub("BRVM"); await page.getByText(/formule Pro/).first().waitFor({ timeout: 8000 }); h.st.rows("subscriptions")[0].plan = "pro";
  });
  for (const [w, theme] of [[1280, "light"], [820, "light"], [390, "light"], [360, "light"], [1280, "dark"]]) await step(`${w} px ${theme} : aucun débordement (captures)`, async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("accueil")); await page.evaluate((t) => localStorage.setItem("dmp-theme", t), theme); await open(w, 900); await sub("BRVM");
    const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o); await page.screenshot({ path: path.join(OUT, `kit13b-${theme}-${w}.png`), fullPage: true });
  });
  await page.evaluate(() => localStorage.setItem("dmp-theme", "light"));
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
