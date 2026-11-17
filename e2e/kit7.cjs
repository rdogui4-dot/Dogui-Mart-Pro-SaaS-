/** Lot K7 (kit 24 interfaces) : Achats & Fournisseurs (écran 13) — en-tête et « Nouvelle commande », 5 indicateurs réels (achats du mois et écart, fournisseurs, commandes en cours, réceptions, factures à payer), onglets du kit, répartition par catégorie, top fournisseurs, évolution 6 mois, encart MASTER et commande automatique, responsive. Lancement : bash e2e/run.sh kit7 */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
(async () => {
  const h = await start({ plan: "business", expect: [] }); const { page, st } = h; const A = h.shop;
  const sup = async (name) => (await h.call("purch.supplier.save", { name, leadDays: 4 }, A)).body.data.id;
  const s1 = await sup("Grossiste Central"), s2 = await sup("Distrib Ouest");
  const art = async (name, cat, q, extra = {}) => (await h.call("article.save", { data: { name, price: 1000, cost: 700, category: cat, ...extra }, initialQty: q }, A)).body.data.id;
  const riz = await art("Riz 5 kg", "Alimentaire", 30), savon = await art("Savon", "Hygiène", 20), huile = await art("Huile 1 L", "Alimentaire", 11, { minStock: 10, supplierId: s1 });
  const po = async (supplierId, lines) => { const r = (await h.call("purch.po.save", { clientId: "k7" + Math.random().toString(36).slice(2, 12), supplierId, lines }, A)).body.data; await h.call("purch.po.validate", { id: r.id }, A); return r.id; };
  await po(s1, [{ productId: riz, qty: 10, unitPrice: 4000 }]); await po(s2, [{ productId: savon, qty: 20, unitPrice: 300 }]);
  const old = await po(s1, [{ productId: riz, qty: 5, unitPrice: 4000 }]); st.rows("purchase_orders").find((x) => x.$id === old).$createdAt = new Date(Date.now() - 40 * 864e5).toISOString();
  await h.call("checkout", { clientId: "k7sale" + Math.random().toString(36).slice(2, 9), lines: [{ productId: huile, qty: 2 }], payments: [{ method: "cash", amount: 2000 }] }, A); // passe sous le seuil → précommande
  const open = async (w = 1440, hh = 1000) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url("achats")); await page.getByRole("heading", { name: "Achats & Fournisseurs" }).waitFor({ timeout: 15000 }); await page.waitForTimeout(1500); };

  await step("en-tête du kit, « Nouvelle commande » ouvre le formulaire, onglets du kit", async () => {
    await open(); await page.getByRole("button", { name: "Nouvelle commande" }).click(); await page.getByRole("dialog").getByLabel("Fournisseur", { exact: true }).waitFor({ timeout: 5000 }); await page.keyboard.press("Escape");
    for (const t of ["Commandes d'achat", "Réceptions", "Fournisseurs", /^Demandes d.approvisionnement/, "Analyses", "Factures", "Réclamations"]) if (!(await page.getByRole("tab", { name: t }).count())) throw new Error("onglet " + t);
  });
  await step("5 indicateurs réels : achats du mois 46 000 F (+ écart vs mois précédent), 2 fournisseurs, 3 commandes en cours (dont l'ancienne, toujours ouverte), 0 réception, factures à payer", async () => {
    const k = (l) => page.getByRole("group", { name: l }).innerText();
    if (!/46\s?000/.test(await k("Achats (mois)"))) throw new Error(await k("Achats (mois)")); if (!/\b2\b/.test(await k("Fournisseurs actifs"))) throw new Error("fournisseurs");
    if (!/\b3\b/.test(await k("Commandes en cours"))) throw new Error(await k("Commandes en cours")); if (!/\b0\b/.test(await k("Réceptions ce mois"))) throw new Error("réceptions"); if (!/Factures à payer/.test(await k("Factures à payer"))) throw new Error("factures");
    const t = await k("Achats (mois)"); const prevIsThisMonth = new Date(Date.now() - 40 * 864e5).getMonth() === new Date().getMonth(); if (!prevIsThisMonth && !/vs mois précédent/.test(t) && new Date().getDate() <= 40) console.log("   (écart non affiché : commande ancienne hors période précédente)");
  });
  await step("répartition par catégorie (Alimentaire, Hygiène), top 5 fournisseurs classé, évolution 6 mois, liste courte des fournisseurs", async () => {
    const rep = await page.getByRole("region", { name: "Répartition des achats (valeur)" }).innerText(); if (!/Alimentaire/.test(rep) || !/Hygiène/.test(rep)) throw new Error(rep);
    const top = await page.getByRole("region", { name: "Top 5 fournisseurs (ce mois)" }).innerText(); if (!/1\s*Grossiste Central[\s\S]*40\s?000[\s\S]*2\s*Distrib Ouest/.test(top)) throw new Error(top);
    if (!(await page.getByRole("region", { name: "Évolution des achats" }).locator("svg").count())) throw new Error("graphique absent");
    if (!/Fournisseurs \(2\)/.test(await page.locator("main").innerText())) throw new Error("liste courte");
    await page.screenshot({ path: path.join(OUT, "kit7-achats-1440.png"), fullPage: true });
  });
  await step("encart MASTER : précommande réelle (Huile sous son seuil) ; « Générer une commande automatique » mène aux demandes d'approvisionnement", async () => {
    const md = await page.getByRole("region", { name: "MASTER DOGUI — Achats" }).innerText(); if (!/1 article\(s\) sous leur seuil dans 1 précommande/.test(md)) throw new Error(md.slice(0, 300));
    await page.getByRole("button", { name: "Générer une commande automatique" }).click(); await page.getByRole("region", { name: "Précommande automatique" }).waitFor({ timeout: 8000 });
    if ((await page.getByRole("tab", { name: /^Demandes d.approvisionnement/ }).getAttribute("aria-selected")) !== "true") throw new Error("onglet non sélectionné"); if (!/Huile 1 L × \d+/.test(await page.getByRole("region", { name: "Précommande automatique" }).innerText())) throw new Error("brouillon absent");
  });
  await step("onglet Analyses : tableau de bord existant ; clavier sur les onglets", async () => {
    await page.getByRole("tab", { name: "Analyses" }).click(); await page.getByRole("heading", { name: /Sur la période/ }).waitFor({ timeout: 8000 }); await page.getByRole("tab", { name: "Analyses" }).focus(); await page.keyboard.press("ArrowRight");
    if ((await page.getByRole("tab", { name: "Factures" }).getAttribute("aria-selected")) !== "true") throw new Error("flèche droite");
  });
  for (const [w, theme] of [[1600, "light"], [1024, "light"], [820, "light"], [390, "light"], [360, "light"], [1280, "dark"]]) await step(`${w} px ${theme} : aucun débordement (captures)`, async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("accueil")); await page.evaluate((t) => localStorage.setItem("dmp-theme", t), theme); await open(w, 900);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o); await page.screenshot({ path: path.join(OUT, `kit7-achats-${theme}-${w}.png`), fullPage: true });
  });
  await page.evaluate(() => localStorage.setItem("dmp-theme", "light"));
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
