const { start } = require("../harness.cjs");
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 5).join(" | ").slice(0, 800)); } };
(async () => {
  const h = await start({ plan: "business", expect: [] }); const { page, st } = h; const T = "t1"; const txt = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
  await st.create("products", "p1", T, { tenantId: T, shopId: h.shop, name: "Riz 25kg", price: 1000, cost: 500 }); await st.create("stock_moves", "m0", T, { tenantId: T, shopId: h.shop, productId: "p1", qty: 10, kind: "purchase" });
  const stock = () => st.rows("stock_moves").filter((m) => m.productId === "p1").reduce((a, m) => a + Number(m.qty), 0);
  const tab = (n) => page.getByRole("button", { name: n, exact: true }).click(); const wait = (t) => page.waitForSelector(`text=${t}`, { timeout: 10000 });
  await step("fournisseur créé depuis l'interface (fiche complète) puis retrouvé par la recherche", async () => {
    await page.goto(h.url("achats")); await tab("Fournisseurs"); await page.getByRole("button", { name: /Nouveau/ }).click();
    await page.getByLabel("Nom commercial").fill("Grossiste Sané"); await page.getByLabel("Raison sociale").fill("Sané & Fils SARL"); await page.getByLabel("Personne de contact").fill("Awa Sané"); await page.getByLabel("Téléphone").fill("770001122"); await page.getByLabel("Identifiant fiscal").fill("NINEA 12345"); await page.getByLabel("Catégories d'articles").fill("Alimentaire, Boissons"); await page.getByLabel("Conditions de paiement").fill("30 jours"); await page.getByLabel("Délai habituel").fill("3");
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click(); await wait("Grossiste Sané");
    const r = st.rows("suppliers").find((x) => x.name === "Grossiste Sané"); if (!r || r.taxId !== "NINEA 12345" || r.leadDays !== 3) throw new Error(JSON.stringify(r));
    await page.getByLabel("Rechercher un fournisseur").fill("sané"); await wait("Awa Sané");
  });
  await step("doublon de nom signalé avec confirmation explicite", async () => {
    await page.getByRole("button", { name: /Nouveau/ }).click(); await page.getByLabel("Nom commercial").fill("grossiste sané"); await page.getByRole("button", { name: "Enregistrer", exact: true }).click(); await wait("porte déjà ce nom");
    if (st.rows("suppliers").length !== 1) throw new Error("doublon écrit sans confirmation"); await page.getByLabel("Fermer").click();
  });
  await step("commande créée (brouillon) avec ligne, remise, frais de transport ; stock inchangé", async () => {
    await tab("Commandes"); await page.getByRole("button", { name: /Nouvelle/ }).click(); await page.getByRole("dialog").getByLabel("Fournisseur", { exact: true }).selectOption({ label: "Grossiste Sané" });
    await await page.getByRole("option", { name: /Riz 25kg/ }).click(); await page.getByLabel("Quantité Riz 25kg").fill("10"); await page.getByLabel("Prix Riz 25kg").fill("700"); await page.getByLabel("Remise Riz 25kg").fill("10"); await page.getByLabel("Frais de transport").fill("1000");
    await wait("Aucune taxe configurée").catch(() => {}); await page.getByRole("button", { name: "Enregistrer le brouillon" }).click(); await page.waitForSelector("text=Aucune commande", { state: "detached", timeout: 10000 }).catch(() => {});
    const po = st.rows("purchase_orders")[0]; if (!po || po.status !== "draft" || po.total !== 6300 + 1000) throw new Error(JSON.stringify(po)); if (stock() !== 10) throw new Error("stock modifié par une commande");
  });
  await step("brouillon → soumis → validé ; le stock reste inchangé", async () => {
    await page.getByText(/BC-/).first().click(); await wait("Soumettre à validation"); await page.getByRole("button", { name: "Soumettre à validation" }).click(); await wait("Valider la commande"); await page.getByRole("button", { name: "Valider la commande" }).click(); await wait("Réceptionner");
    if (st.rows("purchase_orders")[0].status !== "validated" || stock() !== 10) throw new Error("statut/stock " + st.rows("purchase_orders")[0].status + " " + stock());
  });
  await step("réception partielle : 6 acceptées, 2 endommagées ; BL obligatoire ; stock créé seulement à la validation", async () => {
    await page.getByRole("button", { name: "Réceptionner" }).click(); await page.getByLabel("Acceptée Riz 25kg").fill("6"); await page.getByLabel("Endommagée Riz 25kg").fill("2");
    if (!(await page.getByRole("button", { name: "Enregistrer la réception" }).isDisabled())) throw new Error("bouton actif sans BL"); await page.getByLabel("Numéro du bon de livraison").fill("BL-001"); await page.getByRole("button", { name: "Enregistrer la réception" }).click();
    await page.waitForFunction(() => window.location.pathname.endsWith("/achats"), null, { timeout: 8000 }); await page.waitForTimeout(800); if (stock() !== 10) throw new Error("stock créé avant validation"); if (st.rows("purchase_receipts").length !== 1) throw new Error("réception non enregistrée");
  });
  await step("validation de la réception : stock +6 (pas les endommagés), commande « Partiellement reçue »", async () => {
    await tab("Réceptions"); await page.getByText(/BR-/).first().click(); await wait("endommagée 2"); await page.getByRole("button", { name: /Valider \(crée le stock\)/ }).click(); await page.getByRole("button", { name: "Valider", exact: true }).click(); await wait("mouvement(s) de stock");
    if (stock() !== 16) throw new Error("stock " + stock()); if (st.rows("purchase_orders")[0].status !== "partial") throw new Error(st.rows("purchase_orders")[0].status);
    await page.getByLabel("Fermer").click(); await page.getByRole("button", { name: "Valider", exact: true }).count();
  });
  await step("facture reçue (non payée), doublon de référence refusé", async () => {
    await tab("Factures"); await page.getByRole("button", { name: /Facture reçue/ }).click(); await page.getByRole("dialog").getByLabel("Fournisseur", { exact: true }).selectOption({ label: "Grossiste Sané" }); await page.getByLabel("Référence de la facture").fill("FA-2026-1"); await page.getByLabel("Montant de la facture").fill("7300"); await page.getByRole("button", { name: "Enregistrer la facture" }).click();
    await wait("FA-2026-1"); if (st.rows("invoices").filter((i) => i.kind === "supplier" && !i.provisional).length !== 1 || st.rows("cash_movements").length) throw new Error("facture/décaissement");
    await page.getByRole("button", { name: /Facture reçue/ }).click(); await page.getByRole("dialog").getByLabel("Fournisseur", { exact: true }).selectOption({ label: "Grossiste Sané" }); await page.getByLabel("Référence de la facture").fill("fa-2026-1"); await page.getByLabel("Montant de la facture").fill("9000"); await page.getByRole("button", { name: "Enregistrer la facture" }).click(); await wait("existe déjà");
    if (st.rows("invoices").filter((i) => i.kind === "supplier" && !i.provisional).length !== 1) throw new Error("doublon créé"); await page.getByLabel("Fermer").click();
  });
  await step("paiement partiel 3 000 puis dépassement refusé ; reste dû 4 300", async () => {
    await page.getByText("FA-2026-1").first().click(); await wait("Enregistrer un paiement"); await page.getByLabel("Montant du paiement").fill("3000"); await page.getByRole("button", { name: "Payer", exact: true }).click(); await page.waitForFunction(() => /4\s?300/.test(document.body.innerText), null, { timeout: 8000 });
    await page.getByLabel("Montant du paiement").fill("9000"); await page.getByRole("button", { name: "Payer", exact: true }).click(); await wait("dépasse le solde"); const i = st.rows("invoices").find((x) => x.kind === "supplier" && !x.provisional); if (i.paid !== 3000 || i.status !== "partial") throw new Error(JSON.stringify(i));
    if (st.rows("expenses").length) throw new Error("paiement fournisseur compté comme dépense"); await page.getByLabel("Fermer").click();
  });
  await step("tableau de bord : commandé / reçu / facturé / payé séparés, solde à payer", async () => {
    await tab("Tableau"); await wait("Sur la période"); await page.waitForFunction(() => /Commandé/.test(document.body.innerText) && /Facturé/.test(document.body.innerText), null, { timeout: 8000 }); const t = await txt();
    if (!/ne les additionnez pas/.test(t) || !/4\s?300/.test(t) || !/3\s?000/.test(t)) throw new Error(t.slice(0, 1400));
  });
  await step("fournisseur avec historique : suppression refusée (archivage proposé), archivage conserve l'historique", async () => {
    await tab("Fournisseurs"); await page.getByText("Grossiste Sané").first().click(); await wait("Solde dû"); await page.getByRole("button", { name: "Supprimer" }).click(); await page.getByRole("button", { name: "Supprimer" }).last().click(); await wait("historique commercial"); if (!st.rows("suppliers").length) throw new Error("fournisseur supprimé");
    await page.getByRole("button", { name: "Archiver" }).click(); await page.getByLabel("Motif d'archivage").fill("Plus utilisé"); await page.getByRole("button", { name: "Archiver" }).last().click(); await page.waitForFunction(() => document.body.innerText.includes("Fournisseur archivé"), null, { timeout: 8000 }); if (st.rows("suppliers")[0].archived !== true) throw new Error("non archivé");
  });
  await step("Starter : page verrouillée avec message formule Business", async () => {
    st.rows("subscriptions")[0].plan = "starter"; await page.goto(h.url("achats")); await page.reload(); await wait("formule Business");
  });
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close();
})();
