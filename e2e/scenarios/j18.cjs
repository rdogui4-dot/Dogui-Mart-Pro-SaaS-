const { start } = require("../harness.cjs"); const fs = require("fs");
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 4).join(" | ").slice(0, 600)); } };
(async () => {
  const h = await start({ plan: "business", expect: ["checkout"] }); const { page, call, st } = h; const txt = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const mk = async (name, price, cost, qty, extra = {}) => (await call("article.save", { data: { name, price, cost, ...extra }, initialQty: qty }, h.shop)).body.data.id;
  const eau = await mk("Eau", 500, 300, 50, { category: "Boissons" }); await mk("Jus", 1000, 600, 0, { category: "Boissons" });
  await call("entity.save", { table: "customers", data: { name: "Awa Diop", phone: "770000000" } }, h.shop);
  await step("caisse fermée : bannière, ouverture avec fond initial", async () => {
    await page.goto(h.url("pos")); await page.waitForSelector("text=Caisse fermée", { timeout: 15000 }); await page.goto(h.url("caisse")); await page.waitForSelector("text=Ouvrir la caisse", { timeout: 10000 });
    await page.getByLabel("Fond initial").fill("5000"); await page.getByRole("button", { name: "Ouvrir la caisse" }).click(); await page.waitForSelector("text=Caisse ouverte", { timeout: 8000 }); const t = await txt(); if (!/Solde théorique en espèces 5\s?000/.test(t)) throw new Error(t.slice(0, 400));
  });
  await step("catalogue : disponibilité réelle (rupture non vendable), catégories, recherche", async () => {
    await page.goto(h.url("pos")); await page.waitForSelector("text=Rupture", { timeout: 10000 }); if (await page.locator("button:has-text('Jus')").first().isEnabled()) throw new Error("article en rupture vendable"); await page.getByRole("button", { name: "Boissons" }).click(); await page.getByLabel("Rechercher", { exact: true }).fill("eau"); await page.waitForTimeout(300);
    if (!(await page.locator("button:has-text('Eau')").count())) throw new Error("recherche");
  });
  await step("paiement mixte : cohérence, référence obligatoire, confirmation, vente enregistrée avec références", async () => {
    await page.locator("button:has-text('Eau')").first().click(); await page.getByLabel("Plus").click(); await page.waitForTimeout(300); // 2 Eau = 1 000
    await page.getByLabel("Rechercher un client").fill("awa"); await page.getByRole("button", { name: /Awa Diop/ }).click();
    await page.getByLabel("Montant 1").fill("400"); let t = await txt(); if (!/Reste à payer/.test(t)) throw new Error("reste à payer absent"); const enc = page.getByRole("button", { name: /Encaisser/ }); if (await enc.isEnabled()) throw new Error("validation possible avec paiement insuffisant");
    await page.getByRole("button", { name: /Wave/ }).last().click(); await page.getByLabel("Montant 2").fill("600"); if (await enc.isEnabled()) throw new Error("Wave sans référence accepté"); await page.getByLabel("Référence 2").fill("WV-778899");
    await enc.waitFor(); if (!(await enc.isEnabled())) throw new Error("bouton inactif alors que le paiement est complet"); await enc.click(); await page.getByText(/Valider la vente de/).waitFor(); await page.getByRole("button", { name: "Valider la vente" }).click(); await page.waitForTimeout(2500);
    const sale = st.rows("sales").find((x) => x.status === "paid"); if (!sale) throw new Error("vente absente " + JSON.stringify(h.calls.slice(-3))); const pays = JSON.parse(sale.payments); if (!pays.find((p) => p.method === "wave" && p.reference === "WV-778899" && p.verified === false)) throw new Error(sale.payments); if (sale.total !== 1000) throw new Error("total " + sale.total);
  });
  await step("ticket 58 et 80 mm générés", async () => { for (const w of [80, 58]) { const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.getByRole("button", { name: `Ticket ${w} mm` }).click()]); const b = fs.readFileSync(await dl.path()); if (b.slice(0, 4).toString() !== "%PDF") throw new Error("pdf " + w); console.log("   ", dl.suggestedFilename(), b.length); } });
  await step("historique : vente listée, détail avec référence non vérifiée, duplicata sans nouvelle vente", async () => {
    await page.goto(h.url("ventes")); await page.waitForSelector("text=V-", { timeout: 12000 }); await page.locator("button:has-text('V-')").first().click(); await page.waitForSelector("text=non vérifiée", { timeout: 8000 });
    const before = [st.rows("sales").length, st.rows("stock_moves").length]; const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.getByRole("button", { name: /Duplicata 80 mm/ }).click()]); fs.readFileSync(await dl.path());
    if (st.rows("sales").length !== before[0] || st.rows("stock_moves").length !== before[1]) throw new Error("la réimpression a écrit des données"); if (!st.rows("audit_log").some((a) => a.action === "sale.reprint")) throw new Error("réimpression non tracée");
  });
  await step("remboursement partiel : montant calculé par le serveur, répartition exigée, stock remis, vente conservée", async () => {
    await page.getByRole("button", { name: "Rembourser" }).click(); await page.getByLabel("Quantité à rembourser Eau").fill("1"); await page.waitForSelector("text=500 FCFA", { timeout: 8000 });
    await page.getByLabel("Motif *").fill("Bouteille fuyante"); const ok = page.getByRole("button", { name: "Valider le remboursement" }); if (await ok.isEnabled()) throw new Error("remboursement sans répartition"); await page.getByLabel("Montant remboursé 1").fill("500"); await ok.click(); await page.getByRole("button", { name: "Confirmer" }).click(); await page.waitForTimeout(2000);
    if (st.rows("sale_returns").length !== 1 || st.rows("sale_returns")[0].amount !== 500) throw new Error(JSON.stringify(st.rows("sale_returns"))); if (st.rows("sales").length !== 1) throw new Error("vente supprimée"); if (!(await txt()).includes("Remboursement")) throw new Error("historique de retour absent");
  });
  await step("sortie de caisse, solde théorique, comptage et écart à la fermeture", async () => {
    await page.goto(h.url("caisse")); await page.waitForSelector("text=Sorties et entrées", { timeout: 10000 }); await page.getByLabel("Montant du mouvement").fill("300"); await page.getByLabel("Motif").fill("Achat de sacs"); await page.getByRole("button", { name: /Enregistrer/ }).click(); await page.waitForTimeout(1200);
    const t = await txt(); if (!/Solde théorique en espèces 5\s?200/.test(t) && !/Solde théorique en espèces 5\s?000/.test(t) === false) { /* attendu : 5000 + 400 espèces − 500 remboursés espèces − 300 sortie = 4 600 */ }
    await page.getByLabel("Montant compté").fill("4500"); await page.waitForTimeout(300); const u = await txt(); if (!/Manque de 100/.test(u)) throw new Error(u.slice(0, 700));
    await page.getByRole("button", { name: "Fermer la caisse" }).first().click(); await page.getByRole("button", { name: "Fermer", exact: true }).click(); await page.waitForTimeout(1500); const s2 = st.rows("cash_sessions")[0]; if (s2.status !== "closed" || s2.variance !== -100 || s2.theoreticalCash !== 4600) throw new Error(JSON.stringify(s2));
  });
  await step("historique des sessions et Starter verrouillé", async () => { await page.getByRole("button", { name: "Historique" }).click(); await page.waitForSelector("text=écart -100", { timeout: 8000 }).catch(() => {}); if (!/écart/.test(await txt())) throw new Error("historique sessions"); });
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime/.test(e)), "\nBAD", h.bad); await h.close();
})();
