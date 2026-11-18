/** Lot K11 (kit 24 interfaces) : FinI Finance Intelligente (écran 17) — en-tête, 5 indicateurs réels (CA, charges, résultat, marge nette, trésorerie), onglets du kit, vue d'ensemble (évolution, flux, charges, trésorerie, résultat, indicateurs, opérations, budget, MASTER), résultats et rentabilité mensuels, responsive. Lancement : bash e2e/run.sh kit11 */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
(async () => {
  const h = await start({ plan: "business", expect: [] }); const { page } = h; const A = h.shop; const day = new Date().toISOString().slice(0, 10);
  const riz = (await h.call("article.save", { data: { name: "Riz local 5 kg", price: 5000, cost: 3000, category: "Alimentaire" }, initialQty: 100 }, A)).body.data.id;
  await h.call("fin.account.save", { requestKey: "acc" + Math.random().toString(36).slice(2, 10), name: "Caisse", kind: "cash", methods: ["cash"], openingBalance: 10000, openingDate: day }, A);
  for (let i = 0; i < 2; i++) await h.call("checkout", { clientId: "k11" + Math.random().toString(36).slice(2, 12), lines: [{ productId: riz, qty: 2 }], payments: [{ method: "cash", amount: 10000 }] }, A);
  await h.call("expense.create", { requestId: crypto.randomUUID(), label: "Loyer boutique", category: "loyer", amount: 3000, spentOn: day, method: "transfer", source: "external", reference: "R-LOYER" }, A);
  const open = async (w = 1440, hh = 1000) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url("finance")); await page.getByRole("heading", { name: "FinI — Finance Intelligente" }).waitFor({ timeout: 15000 }); await page.waitForTimeout(1500); };

  await step("en-tête du kit, « Enregistrer une opération », onglets du kit et seconde ligne", async () => {
    await open(); for (const t of ["Vue d'ensemble", "Trésorerie", "Flux de caisse", "Résultats", "Rentabilité", "Budgets", "Prévisions", "Comptes", "Virements", "Échéances", "Rapports"]) if (!(await page.getByRole("tab", { name: t, exact: true }).count())) throw new Error("onglet " + t);
  });
  await step("5 indicateurs réels : CA 20 000 F, charges 3 000 F, résultat calculé, marge nette, trésorerie configurée", async () => {
    const k = (l) => page.getByRole("group", { name: l }).innerText();
    if (!/20\s?000/.test(await k("Chiffre d'affaires (mois)"))) throw new Error(await k("Chiffre d'affaires (mois)")); if (!/3\s?000/.test(await k("Charges totales"))) throw new Error(await k("Charges totales"));
    const r = await k("Résultat net"); if (!/FCFA|Non calculable/.test(r)) throw new Error(r); if (!/%|—/.test(await k("Marge nette"))) throw new Error("marge"); if (!/FCFA/.test(await k("Trésorerie disponible"))) throw new Error(await k("Trésorerie disponible"));
  });
  await step("vue d'ensemble : évolution, flux 30 j, répartition des charges (Loyer), trésorerie par compte, indicateurs clés, opérations récentes, MASTER", async () => {
    for (const r of ["Évolution du chiffre d'affaires et du résultat", "Flux de trésorerie (30 jours)", "Répartition des charges", "Trésorerie", "Résultat & Rentabilité", "Indicateurs clés", "Opérations récentes", "Budget du mois", "MASTER DOGUI — FinI"]) if (!(await page.getByRole("region", { name: r, exact: true }).count())) throw new Error("bloc " + r);
    if (!/Loyer/.test(await page.getByRole("region", { name: "Répartition des charges" }).innerText())) throw new Error("charges"); if (!/Caisse/.test(await page.getByRole("region", { name: "Trésorerie", exact: true }).innerText())) throw new Error("compte");
    if (!/Panier moyen[\s\S]*10\s?000/.test(await page.getByRole("region", { name: "Indicateurs clés" }).innerText())) throw new Error("panier moyen");
    await page.screenshot({ path: path.join(OUT, "kit11-finance-1440.png"), fullPage: true });
  });
  await step("Résultats : tableau mensuel (6 mois) ; Rentabilité : taux par mois ; « Enregistrer une opération » mène aux virements", async () => {
    await page.getByRole("tab", { name: "Résultats", exact: true }).click(); if ((await page.locator("table[aria-label='Résultats mensuels'] tbody tr").count()) !== 6) throw new Error("6 mois");
    await page.getByRole("tab", { name: "Rentabilité" }).click(); await page.getByText("Taux de marge brute").first().waitFor({ timeout: 5000 });
    await page.getByRole("button", { name: "Enregistrer une opération" }).click(); if ((await page.getByRole("tab", { name: "Virements" }).getAttribute("aria-selected")) !== "true") throw new Error("virements");
  });
  for (const [w, theme] of [[1600, "light"], [1280, "light"], [820, "light"], [390, "light"], [360, "light"], [1280, "dark"]]) await step(`${w} px ${theme} : aucun débordement (captures)`, async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("accueil")); await page.evaluate((t) => localStorage.setItem("dmp-theme", t), theme); await open(w, 900);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o); await page.screenshot({ path: path.join(OUT, `kit11-finance-${theme}-${w}.png`), fullPage: true });
  });
  await page.evaluate(() => localStorage.setItem("dmp-theme", "light"));
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
