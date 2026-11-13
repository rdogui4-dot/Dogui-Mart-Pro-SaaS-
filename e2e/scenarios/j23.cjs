const { start } = require("../harness.cjs");
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 4).join(" | ").slice(0, 700)); } };
(async () => {
  const h = await start({ plan: "business", expect: [] }); const { page, st } = h; const T = "t1"; const txt = async () => (await page.locator("body").innerText()).replace(/\s+/g, " "); const wait = (t) => page.waitForSelector(`text=${t}`, { timeout: 10000 });
  const P = (id, name, cost, extra = {}) => st.create("products", id, T, { tenantId: T, shopId: h.shop, name, price: 1000, cost, category: "Alimentaire", barcode: `B${id}`, sku: `S${id}`, ...extra });
  await P("p1", "Riz 25kg", 500); await P("p2", "Huile", 1500); await P("p3", "Savon", 200, { category: "Hygiène" });
  const old = new Date(Date.now() - 3600e3).toISOString(); for (const [p, q] of [["p1", 100], ["p2", 50], ["p3", 20]]) await st.create("stock_moves", `m${p}`, T, { tenantId: T, shopId: h.shop, productId: p, qty: q, kind: "purchase", $createdAt: old });
  const stock = (p) => st.rows("stock_moves").filter((m) => m.productId === p).reduce((a, m) => a + (m.kind === "sale" ? -Math.abs(m.qty) : Number(m.qty)), 0);
  const count = async (name, qty) => { await page.getByLabel("Scanner ou rechercher").fill(name); await page.getByRole("button", { name: new RegExp(name) }).first().click(); await page.getByLabel("Quantité constatée").fill(String(qty)); await page.getByRole("button", { name: "Enregistrer", exact: true }).click(); await page.waitForSelector('[aria-label="Quantité constatée"]', { state: "detached", timeout: 8000 }); await page.getByLabel("Scanner ou rechercher").fill(""); };
  await step("inventaire complet créé depuis l'interface (brouillon, 3 lignes)", async () => {
    await page.goto(h.url("inventaire")); await page.getByRole("button", { name: /Nouveau/ }).click(); await page.getByRole("button", { name: "Créer le brouillon" }).click(); await wait("INV-");
    const inv = st.rows("inventories")[0]; if (!inv || inv.status !== "draft" || st.rows("inventory_lines").length !== 3) throw new Error(JSON.stringify(inv));
  });
  await step("lancement du comptage ; comptage à l'aveugle : aucune quantité théorique affichée", async () => {
    await page.getByText(/INV-/).first().click(); await page.getByRole("button", { name: "Lancer le comptage" }).click(); await wait("Comptage à l'aveugle"); const t = await txt(); if (/Théorique \d/.test(t) || /Restants \(3\)/.test(t) === false) throw new Error(t.slice(0, 500));
  });
  await step("saisie des quantités (recherche) ; ressaisie exige une confirmation, l'ancienne valeur reste dans l'historique", async () => {
    await count("Riz", 90); await wait("Restants (2)"); await page.getByRole("button", { name: /Comptés/ }).click(); await page.getByRole("button", { name: /Riz/ }).first().click(); await page.getByLabel("Quantité constatée").fill("91"); await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await page.getByRole("button", { name: "Confirmer le remplacement" }).waitFor({ timeout: 8000 }); await page.getByRole("button", { name: "Confirmer le remplacement" }).click(); await page.waitForSelector('[aria-label="Quantité constatée"]', { state: "detached", timeout: 8000 });
    await page.getByRole("button", { name: /Restants/ }).click(); await count("Huile", 52); await count("Savon", 0); if (st.rows("inventory_events").filter((e) => e.kind === "count").length !== 4) throw new Error("historique " + st.rows("inventory_events").map((e) => e.kind));
  });
  await step("scan d'un code inconnu : signalé, jamais ignoré", async () => {
    await page.getByLabel("Scanner ou rechercher").fill("INCONNU-9"); await page.getByLabel("Scanner ou rechercher").press("Enter"); await wait("Code inconnu"); await page.getByRole("button", { name: "Signaler ce code" }).click(); await wait("1 code(s) inconnu(s)");
  });
  await step("fin du comptage puis vérification : écarts, valeurs, écart important signalé", async () => {
    await page.getByRole("button", { name: "Terminer le comptage" }).click(); await page.getByRole("button", { name: "Confirmer" }).click(); await wait("Vérifier les écarts"); await page.getByRole("button", { name: "Vérifier les écarts" }).click(); await wait("Théorique 100 → compté 91");
    const t = await txt(); if (!/ÉCART IMPORTANT/.test(t) || !/Théorique 20 → compté 0/.test(t) || !/-4\s?000/.test(t)) throw new Error(t.slice(0, 900));
  });
  await step("écart important : approbation exige un motif détaillé (sans second comptage) ; petits écarts approuvés en bloc", async () => {
    await page.getByRole("button", { name: "Approuver", exact: true }).last().click(); await page.getByLabel("Motif").fill("court"); if (!(await page.getByRole("button", { name: "Confirmer" }).isEnabled())) { /* motif trop court côté UI uniquement à 3 car. : le serveur refuse < 10 */ }
    await page.getByRole("button", { name: "Confirmer" }).click(); await wait("motif détaillé"); await page.getByLabel("Motif").fill("Rayon vidé : palette retirée, constat photo joint"); await page.getByRole("button", { name: "Confirmer" }).click(); await page.waitForSelector('[aria-label="Motif"]', { state: "detached", timeout: 8000 });
    await page.getByRole("button", { name: "Approuver les petits écarts" }).click(); await page.getByLabel("Motif").fill("Petites pertes constatées"); await page.getByRole("button", { name: "Confirmer" }).click(); await page.waitForSelector('[aria-label="Motif"]', { state: "detached", timeout: 8000 });
    const lines = st.rows("inventory_lines"); const ok = lines.filter((l) => l.status === "approved").length; if (ok < 2) throw new Error(JSON.stringify(lines.map((l) => [l.name, l.status, l.reason])));
  });
  await step("validation : seuls les écarts approuvés créent des mouvements ; stock = compté ; rejouer ne double rien", async () => {
    await page.getByRole("button", { name: "Valider l'inventaire" }).click(); await page.getByRole("button", { name: "Confirmer" }).click(); await wait("ajustement(s) créé(s)");
    const adj = st.rows("stock_moves").filter((m) => String(m.refId).startsWith("inventaire:")); if (adj.length !== 3 || stock("p1") !== 91 || stock("p2") !== 52 || stock("p3") !== 0) throw new Error(`${adj.length} ${stock("p1")} ${stock("p2")} ${stock("p3")}`); if (st.rows("stock_moves").some((m) => m.$id === "mp1" && m.qty !== 100)) throw new Error("ancien mouvement modifié");
  });
  await step("rapport affiché et exports PDF / Excel / CSV disponibles sans erreur", async () => {
    await wait("Surplus"); for (const f of ["CSV", "XLSX", "PDF"]) { await page.getByRole("button", { name: f, exact: true }).click(); await page.waitForTimeout(700); } const t = await txt(); if (/Impossible|Erreur/.test(t)) throw new Error(t.slice(-400));
  });
  await step("clôture : plus aucun bouton de modification ; Starter : page verrouillée", async () => {
    await page.getByRole("button", { name: "Clôturer" }).click(); await page.getByRole("button", { name: "Confirmer" }).click(); await page.waitForFunction(() => !document.body.innerText.includes("Clôturer"), null, { timeout: 8000 }); if (st.rows("inventories")[0].status !== "closed") throw new Error("non clôturé"); const t = await txt(); if (/Valider l'inventaire|Approuver|Recompter|Annuler/.test(t)) throw new Error("actions encore visibles");
    st.rows("subscriptions")[0].plan = "starter"; await page.goto(h.url("inventaire")); await page.reload(); await wait("Silent Count : formule Business");
  });
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close();
})();
