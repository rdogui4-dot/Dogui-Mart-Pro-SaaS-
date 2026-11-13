const { start } = require("../harness.cjs");
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 5).join(" | ").slice(0, 800)); } };
(async () => {
  const h = await start({ plan: "business", expect: [] }); const { page, st } = h; const T = "t1"; const txt = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const B = (await h.call("shop.create", { name: "Thiès" })).body.data.shopId;
  await st.create("products", "p1", T, { tenantId: T, shopId: h.shop, name: "Riz 25kg", price: 1000, cost: 500, minStock: 5 }); await st.create("stock_moves", "m1", T, { tenantId: T, shopId: h.shop, productId: "p1", qty: 10, kind: "purchase" });
  await st.create("products", "p2", T, { tenantId: T, shopId: h.shop, name: "Huile 5L", price: 3000, cost: 0, minStock: 5 }); await st.create("stock_moves", "m2", T, { tenantId: T, shopId: h.shop, productId: "p2", qty: 3, kind: "purchase" });
  const stock = (shop, pid) => st.rows("stock_moves").filter((m) => m.shopId === shop && m.productId === pid).reduce((a, m) => a + (m.kind === "transfer_out" || m.kind === "sale" ? -1 : 1) * Number(m.qty), 0);
  const tab = (n) => page.getByRole("tab", { name: n }).click(); const wait = (t) => page.waitForSelector(`text=${t}`, { timeout: 10000 });
  await step("tableau de bord : articles suivis, valeur, coûts manquants, alertes", async () => {
    await page.goto(h.url("stock")); await wait("Articles suivis"); await wait("Valeur estimée du stock"); await wait("sans coût");
    const t = await txt(); if (!/5\s?000/.test(t) || !/Stock bas\s*1/.test(t)) throw new Error(t.slice(0, 900));
  });
  await step("fiche de stock : quantités distinctes (stock, disponible, réservé, en commande, transit)", async () => {
    await tab("Articles"); await page.getByLabel("Fiche de stock Riz 25kg").click(); await wait("En stock (théorique)"); const t = await txt();
    for (const k of ["Disponible", "Réservé", "En commande", "En transit (reçu bientôt)", "En transit (expédié)", "Seuils"]) if (!t.includes(k)) throw new Error("manque " + k);
  });
  await step("correction : motif obligatoire, puis −2 enregistré comme mouvement tracé", async () => {
    await page.getByRole("button", { name: "Corriger le stock" }).click(); await page.getByLabel("Quantité de correction").fill("-2");
    if (!(await page.getByRole("button", { name: "Enregistrer la correction" }).isDisabled())) throw new Error("actif sans motif");
    await page.getByLabel("Motif de la correction").fill("casse constatée"); await page.getByRole("button", { name: "Enregistrer la correction" }).click(); await page.waitForSelector("text=Correction motivée", { timeout: 8000 });
    if (stock(h.shop, "p1") !== 8) throw new Error("stock " + stock(h.shop, "p1")); const mv = st.rows("stock_moves").find((m) => m.refId === "correction"); if (!mv || mv.note !== "casse constatée" || !mv.userId) throw new Error(JSON.stringify(mv));
  });
  await step("seuils et emplacement enregistrés", async () => {
    await page.getByRole("button", { name: "Seuils et emplacement" }).click(); await page.getByLabel("Emplacement").fill("Rayon A"); await page.getByLabel("Seuil d'alerte").fill("9"); await page.getByRole("button", { name: "Enregistrer", exact: true }).click(); await page.waitForFunction(() => document.body.innerText.includes("Rayon A"), null, { timeout: 8000 });
    const p = st.rows("products").find((x) => x.$id === "p1"); if (p.location !== "Rayon A" || p.alertStock !== 9) throw new Error(JSON.stringify(p)); await page.getByLabel("Fermer").click();
  });
  await step("journal : filtre Ajustements", async () => {
    await tab("Mouvements"); await wait("Réception d'achat"); await page.getByLabel("Type de mouvement").selectOption("adjust"); await wait("Correction motivée"); const t = await txt(); if (t.includes("Réception d'achat")) throw new Error("filtre ignoré");
  });
  await step("alertes : rupture/stock bas listés, sous seuil d'alerte", async () => {
    await tab(/Alertes/); await wait("Huile 5L : stock minimum atteint"); await wait("Riz 25kg : sous le seuil d'alerte");
  });
  let xid;
  await step("transfert préparé puis départ validé : stock source −5, en transit", async () => {
    await tab("Transferts"); await page.getByRole("button", { name: "Nouveau transfert" }).click(); await page.getByLabel("Boutique de destination").selectOption({ label: "Thiès" }); await page.getByLabel("Article 1").selectOption({ label: "Riz 25kg (8)" }); await page.getByLabel("Quantité 1").fill("5");
    await page.getByRole("button", { name: /Enregistrer le transfert/ }).click(); await wait("Valider le départ"); const t = st.rows("transfers")[0]; xid = t.$id; if (t.status !== "draft" || stock(h.shop, "p1") !== 8 && stock(h.shop, "p2") !== 3) throw new Error(JSON.stringify(t));
    await page.getByRole("button", { name: "Valider le départ", exact: true }).first().click(); await page.getByRole("button", { name: "Valider le départ" }).last().click(); await wait("Expédié"); if (st.rows("transfers")[0].status !== "shipped") throw new Error(st.rows("transfers")[0].status);
    if (!st.rows("stock_moves").some((m) => m.kind === "transfer_out")) throw new Error("pas de sortie"); await page.getByLabel("Fermer").click();
  });
  await step("boutique de destination : réception partielle, reste en transit", async () => {
    await page.getByLabel("Boutique", { exact: true }).selectOption({ label: "Thiès" }); await page.getByRole("tab", { name: "Transferts" }).click(); await page.getByText(/TR-/).first().click(); await wait("Confirmer la réception"); await page.getByRole("button", { name: "Confirmer la réception" }).click();
    const inp = page.locator("input[aria-label^='Reçu ']").first(); await inp.fill("3"); await page.getByRole("button", { name: "Enregistrer la réception" }).click(); await page.waitForSelector("text=Partiellement", { timeout: 8000 });
    const t = st.rows("transfers")[0]; if (t.status !== "partial") throw new Error(t.status); if (!st.rows("stock_moves").some((m) => m.kind === "transfer_in" && m.shopId === B && Number(m.qty) === 3)) throw new Error("entrée manquante");
  });
  await step("clôture avec écart : manquants retournent au stock de départ, motif obligatoire", async () => {
    await page.getByRole("button", { name: "Clôturer avec écart" }).click(); if (!(await page.getByRole("button", { name: "Clôturer le transfert" }).isDisabled())) throw new Error("actif sans motif"); await page.getByLabel("Motif de clôture").fill("colis perdu"); await page.getByRole("button", { name: "Clôturer le transfert" }).click(); await page.waitForSelector("text=Retour au stock de départ", { timeout: 8000 });
    if (st.rows("transfers")[0].status !== "closed") throw new Error(st.rows("transfers")[0].status); if (!st.rows("stock_moves").some((m) => m.kind === "transfer_in" && m.shopId === h.shop && Number(m.qty) === 2)) throw new Error("retour manquant");
  });
  await step("Starter : page Stock simple (pas de hub)", async () => {
    st.rows("subscriptions")[0].plan = "starter"; await page.goto(h.url("stock")); await page.reload(); await wait("Valeur du stock"); if (await page.getByRole("tab", { name: "Transferts" }).count()) throw new Error("hub visible en Starter");
  });
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close();
})();
