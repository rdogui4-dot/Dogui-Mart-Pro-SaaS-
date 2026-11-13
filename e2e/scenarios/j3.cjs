const { start } = require("../harness.cjs");
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n")[0].slice(0, 260)); } };
(async () => {
  const h = await start({ expect: [] }); const { page, st, call } = h;
  const goto = async (r) => { await page.goto(h.url(r)); await page.waitForTimeout(1200); };
  const txt = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const mk = async (name, extra = {}, qty = 0) => (await call("article.save", { data: { name, price: 1000, cost: 500, ...extra }, ...(qty ? { initialQty: qty } : {}) }, h.shop)).body.data.id;
  const riz = await mk("Riz 25kg", { price: 15000, cost: 10000 }, 10); await mk("Savon", {}, 30);
  const shop2 = (await call("shop.create", { name: "Thiès" })).body.data.shopId;
  await step("achats: fournisseur + commande + réception + facture", async () => {
    await goto("achats"); await page.getByRole("button", { name: /Fournisseurs/ }).click(); await page.getByPlaceholder("Fournisseur").fill("Grossiste A"); await page.getByRole("button", { name: "Ajouter le fournisseur" }).click(); await page.waitForTimeout(1000);
    if (!st.rows("suppliers").length) throw new Error("fournisseur non créé");
    await page.getByRole("button", { name: "Commandes" }).click(); await page.getByRole("button", { name: "Nouvelle commande" }).click();
    await page.locator("main select").first().selectOption({ label: "Grossiste A" }); await page.locator("main select").nth(1).selectOption({ label: (await page.locator("main select").nth(1).locator("option").allInnerTexts()).find((t) => /Riz/.test(t)) });
    await page.getByPlaceholder("Qté").first().fill("5"); await page.getByPlaceholder("Prix HT").first().fill("9800"); await page.getByRole("button", { name: /^Commander/ }).click(); await page.waitForTimeout(1500);
    if (!st.rows("purchase_orders").length) throw new Error("commande non créée: " + (await txt()).slice(0, 300));
    await page.getByRole("button", { name: "Réceptionner" }).click(); await page.getByRole("button", { name: "Confirmer la réception" }).click(); await page.waitForTimeout(1500);
    if (st.rows("purchase_orders")[0].status !== "received") throw new Error("pas reçue: " + st.rows("purchase_orders")[0].status + " " + (await txt()).slice(0, 200));
    page.once("dialog", (d) => d.accept("F-001")); await page.getByRole("button", { name: "Enregistrer la facture" }).click(); await page.waitForTimeout(1500);
    if (!st.rows("invoices").length) throw new Error("facture non créée");
  });
  await step("compta: onglets chargent", async () => { await goto("compta"); for (const t of ["Factures", "Rapports", "Journal"]) { await page.getByRole("button", { name: t }).first().click(); await page.waitForTimeout(700); } });
  await step("réglages: fiche boutique + méthode de valorisation + politique lots", async () => {
    await goto("reglages"); await page.getByPlaceholder("Nom commercial").fill("DOGUI MART Plateau"); await page.getByPlaceholder("Ville").fill("Dakar"); await page.getByRole("button", { name: "Enregistrer" }).first().click(); await page.waitForTimeout(1000);
    if (!st.rows("shops").some((s) => s.name === "DOGUI MART Plateau")) throw new Error("fiche non enregistrée");
    await page.getByLabel("Méthode de valorisation").selectOption("last"); await page.waitForTimeout(800); await page.getByLabel("Politique des lots périmés").selectOption("allow"); await page.waitForTimeout(800);
  });
  await step("réglages: liens QR (Wave) enregistrement", async () => {
    await goto("reglages"); await page.getByRole("button", { name: "Paiements QR" }).click(); await page.getByPlaceholder(/Modèle de lien Wave/).fill("https://pay.wave.com/m/M_sn_abc/c/sn/?amount=1000"); await page.getByRole("button", { name: "Enregistrer" }).click(); await page.waitForTimeout(1200);
    if (!(await txt()).includes("configuré")) throw new Error((await txt()).slice(0, 300));
  });
  await step("stock: transfert vers l'autre boutique (UI)", async () => {
    await goto("stock"); await page.getByRole("button", { name: /Transférer vers/ }).click(); await page.locator("main select").filter({ hasText: "Boutique de destination" }).selectOption({ label: "Thiès" });
    await page.locator("main select").filter({ hasText: "Produit…" }).first().selectOption({ index: 1 }); await page.getByPlaceholder("Qté").first().fill("5"); await page.getByRole("button", { name: "Transférer", exact: true }).click(); await page.waitForTimeout(1500);
    if (!(await txt()).includes("effectué")) throw new Error((await txt()).slice(0, 300)); if (!st.rows("transfers").length) throw new Error("pas de transfert");
  });
  await step("clients: création et fiche", async () => { await goto("clients"); await page.getByPlaceholder(/Nom/).first().fill("Awa Diop"); await page.getByRole("button", { name: /Ajouter le client/ }).click(); await page.waitForTimeout(1000); if (!st.rows("customers").length) throw new Error("client non créé"); });
  await step("hors ligne: vente mise en file puis synchronisée", async () => {
    await goto("pos"); await page.getByText("Riz 25kg").first().click(); h.setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    const before = st.rows("sales").length; await page.getByRole("button", { name: /Encaisser/ }).click(); await page.waitForTimeout(1500);
    if (st.rows("sales").length !== before) throw new Error("vente passée hors ligne ?!"); const t1 = await txt(); if (!/Hors ligne|Synchronisation/.test(t1)) throw new Error("pas d'indicateur hors ligne: " + t1.slice(0, 200));
    h.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event("online"))); await page.waitForTimeout(3000);
    if (st.rows("sales").length !== before + 1) throw new Error("vente non synchronisée");
  });
  console.log("ERRORS", h.errors, "\nBAD", h.bad); await h.close();
})();
