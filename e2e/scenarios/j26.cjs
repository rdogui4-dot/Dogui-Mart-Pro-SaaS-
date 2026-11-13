const { start } = require("../harness.cjs");
const fs = require("fs");
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 5).join(" | ").slice(0, 800)); } };
(async () => {
  const h = await start({ plan: "pro", expect: [] }); const { page, st } = h; const T = "t1"; const txt = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const B = (await h.call("shop.create", { name: "Thiès" })).body.data.shopId; const A = h.shop; let n = 0;
  const P = (id, name, cost, min, shop = A, extra = {}) => st.create("products", id, T, { tenantId: T, shopId: shop, name, price: cost * 2, cost, minStock: min, category: "Alimentaire", ...extra });
  const mv = (pid, qty, kind, days, shop = A, extra = {}) => st.create("stock_moves", `m${++n}`, T, { tenantId: T, shopId: shop, productId: pid, qty, kind, userId: "u1", refId: kind === "purchase" ? "BC-X" : "", $createdAt: new Date(Date.now() + days * 864e5).toISOString(), ...extra });
  const sales = async (pid, q, k, shop = A, from = 1) => { for (let i = from; i < from + k; i++) await mv(pid, q, "sale", -i + 0.5, shop); };
  await P("p1", "Riz 25kg", 500, 10); await P("p2", "Huile 5L", 1500, 5); await P("p6", "Café 1kg", 1000, 5); await P("p1b", "Riz 25kg", 500, 5, B, { originId: "p1" });
  await mv("p1", 400, "purchase", -100); await sales("p1", 2, 60); await mv("p2", 10, "purchase", -100); await mv("p6", 420, "purchase", -100); await sales("p6", 5, 80);
  await mv("p1b", 190, "purchase", -100, B); await sales("p1b", 3, 60, B);
  await st.create("suppliers", "s1", T, { tenantId: T, shopId: A, name: "Grossiste Sané" });
  const tab = (nm) => page.getByRole("tab", { name: nm }).click(); const wait = (t) => page.waitForSelector(`text=${t}`, { timeout: 10000 });
  await step("onglets Pro visibles en formule Pro", async () => { await page.goto(h.url("stock")); await wait("Articles suivis"); for (const k of ["Analyse", "Réappro", "Réseau", "Anomalies", "Lots", "Rapports"]) if (!(await page.getByRole("tab", { name: k }).count())) throw new Error("onglet manquant " + k); });
  await step("analyse : surstock et sans vente détectés, ABC, capital immobilisé", async () => {
    await tab("Analyse"); await wait("Classement ABC"); await page.getByRole("button", { name: "Surstock", exact: true }).click(); await wait("Riz 25kg"); const t = await txt(); if (!/Surstock/.test(t) || !/excès/.test(t)) throw new Error(t.slice(0, 700));
    await page.getByRole("button", { name: "Sans vente" }).click(); await wait("Huile 5L"); await page.getByRole("button", { name: "À risque" }).click(); await wait("Café 1kg");
  });
  await step("réappro : prévision avec méthode, confiance et limites ; aucune commande créée sans validation", async () => {
    await tab("Réappro"); await wait("rien n'est commandé sans votre validation"); await wait("Café 1kg"); await page.getByText("Café 1kg").first().click(); await wait("Lissage exponentiel"); const t = await txt(); if (!/confiance élevée/.test(t) || !/jamais une certitude/.test(t) || !/Calcul/.test(t)) throw new Error(t.slice(0, 900));
    if (st.rows("purchase_orders").length) throw new Error("commande créée automatiquement");
  });
  await step("brouillon de commande : sélection explicite, fournisseur choisi, statut brouillon, stock inchangé", async () => {
    await page.getByLabel("Sélectionner Café 1kg").check(); await page.getByRole("button", { name: "Créer un brouillon de commande" }).click(); await page.getByLabel("Fournisseur du brouillon").selectOption({ label: "Grossiste Sané" }); await page.getByRole("button", { name: "Créer le brouillon", exact: true }).click(); await wait("Brouillon BC-");
    const po = st.rows("purchase_orders")[0]; if (!po || po.status !== "draft" || st.rows("stock_moves").filter((m) => m.kind === "purchase" && m.productId === "p6").length !== 1) throw new Error(JSON.stringify(po)); await page.getByRole("button", { name: "Terminer" }).click();
  });
  await step("simulation : scénarios comparés, rupture immédiate chiffrée comme estimation", async () => {
    if (!(await page.getByRole("button", { name: "Simuler" }).count())) await page.getByText("Café 1kg").first().click(); await page.getByRole("button", { name: "Simuler" }).first().click(); await page.getByLabel("Quantité de la commande simulée").fill("300"); await page.getByLabel("Délai de livraison simulé").fill("3"); await page.getByRole("button", { name: "Comparer les scénarios" }).click(); await wait("Rupture immédiate"); await wait("Votre commande"); const t = await txt(); if (!/pas du chiffre d'affaires réalisé/.test(t)) throw new Error(t.slice(0, 600)); await page.getByLabel("Fermer").click();
  });
  await step("réseau : déséquilibre Dakar/Thiès, transfert suggéré préparé (brouillon) sans mouvement de stock", async () => {
    await tab("Réseau"); await wait("Déséquilibres et transferts suggérés"); await wait("Transférer"); const before = st.rows("stock_moves").length; await page.getByRole("button", { name: "Préparer ce transfert" }).first().click(); await wait("préparé vers Thiès");
    const t = st.rows("transfers")[0]; if (!t || t.status !== "draft" || st.rows("stock_moves").length !== before) throw new Error(JSON.stringify(t));
  });
  await step("anomalies : preuves et contrôle recommandé, jamais « fraude »", async () => {
    for (let i = 0; i < 4; i++) await mv("p1", -2, "adjust", -0.01, A, { refId: "" }); await mv("p2", 20, "sale", -0.5);
    await tab("Anomalies"); await wait("mouvements identiques"); const t0 = await txt(); if (!/jamais une qualification de fraude/.test(t0)) throw new Error("avertissement manquant"); await page.getByText(/mouvements identiques rapprochés/).first().click(); await wait("Contrôle recommandé"); await wait("Preuves");
  });
  await step("lots : périmé et FEFO lus du catalogue", async () => {
    await P("pl", "Yaourt", 200, 2, A, { tracking: "lot" }); await st.create("article_lots", "l1", T, { tenantId: T, shopId: A, productId: "pl", lotNo: "L1", expiresAt: new Date(Date.now() - 2 * 864e5).toISOString(), unitCost: 200 }); await mv("pl", 10, "purchase", -20, A, { lotId: "l1" });
    await tab("Lots"); await wait("lot L1"); await wait("Périmé"); await wait("à vendre en premier");
  });
  await step("rapports : aperçu puis exports CSV, Excel et PDF téléchargés", async () => {
    await tab("Rapports"); await wait("Contenu du rapport");
    for (const [label, ext] of [["CSV", ".csv"], ["Excel", ".xlsx"], ["PDF", ".pdf"]]) { const dl = page.waitForEvent("download", { timeout: 20000 }); await page.getByRole("button", { name: label, exact: true }).click(); const d = await dl; const f = await d.path(); const size = fs.statSync(f).size; if (!d.suggestedFilename().endsWith(ext) || size < 200) throw new Error(label + " " + d.suggestedFilename() + " " + size); if (ext === ".csv" && !fs.readFileSync(f, "utf8").includes("Riz 25kg")) throw new Error("CSV sans données"); await page.waitForTimeout(300); }
  });
  await step("retour en Business : onglets Pro retirés, message d'offre, historique intact", async () => {
    const mvCount = st.rows("stock_moves").length; st.rows("subscriptions")[0].plan = "business"; await page.goto(h.url("stock")); await page.reload(); await wait("Articles suivis"); await page.waitForFunction(() => ![...document.querySelectorAll("[role=tab]")].some((e) => e.textContent === "Analyse"), null, { timeout: 8000 }); await wait("formule Pro"); if (st.rows("stock_moves").length !== mvCount) throw new Error("mouvements modifiés");
  });
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close();
})();
