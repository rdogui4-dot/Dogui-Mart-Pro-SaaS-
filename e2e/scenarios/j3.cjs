const { start } = require("../harness.cjs");
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n")[0].slice(0, 260)); } };
(async () => {
  const h = await start({ expect: [] }); const { page, st, call } = h;
  const goto = async (r) => { await page.goto(h.url(r)); await page.waitForTimeout(1200); };
  const txt = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const mk = async (name, extra = {}, qty = 0) => (await call("article.save", { data: { name, price: 1000, cost: 500, ...extra }, ...(qty ? { initialQty: qty } : {}) }, h.shop)).body.data.id;
  const riz = await mk("Riz 25kg", { price: 15000, cost: 10000 }, 10); await mk("Savon", {}, 30);
  const shop2 = (await call("shop.create", { name: "Thiès" })).body.data.shopId;
  // « achats: fournisseur + commande + réception + facture » retiré : couvert par j22, achats-depenses.cjs.
  // « compta: onglets chargent » retiré : couvert par compta-finance.cjs.
  await step("réglages: fiche boutique + méthode de valorisation + politique lots", async () => {
    await goto("reglages"); await page.getByPlaceholder("Nom commercial").fill("DOGUI MART Plateau"); await page.getByPlaceholder("Ville").fill("Dakar"); await page.getByRole("button", { name: "Enregistrer" }).first().click(); await page.waitForTimeout(1000);
    if (!st.rows("shops").some((s) => s.name === "DOGUI MART Plateau")) throw new Error("fiche non enregistrée");
    await page.getByRole("tab", { name: "Règles de gestion" }).click(); await page.getByLabel("Méthode de valorisation").selectOption("last"); await page.waitForTimeout(800); await page.getByLabel("Politique des lots périmés").selectOption("allow"); await page.waitForTimeout(800);
  });
  await step("réglages: liens QR (Wave) enregistrement", async () => {
    await goto("reglages"); await page.getByRole("tab", { name: "Paiements QR" }).click(); await page.getByPlaceholder(/Modèle de lien Wave/).fill("https://pay.wave.com/m/M_sn_abc/c/sn/?amount=1000"); await page.getByRole("button", { name: "Enregistrer" }).click(); await page.waitForTimeout(1200);
    if (!(await txt()).includes("configuré")) throw new Error((await txt()).slice(0, 300));
  });
  // « stock: transfert vers l'autre boutique (UI) » retiré : couvert par j25.
  // « clients: création et fiche » retiré : couvert par j27, clients-promotions.cjs.
  await step("hors ligne: vente mise en file puis synchronisée", async () => {
    await goto("pos"); await page.getByText("Riz 25kg").first().click(); h.setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    const before = st.rows("sales").length; await (async () => { const f = page.getByPlaceholder(/montant reçu/i).first(); if ((await f.count()) && !(await f.inputValue())) await f.fill("1000000"); await page.getByRole("button", { name: /Encaisser/ }).click(); const v = page.getByRole("button", { name: "Valider la vente" }); await v.waitFor({ timeout: 4000 }).catch(() => {}); if (await v.count()) await v.click(); })(); await page.waitForTimeout(1500);
    if (st.rows("sales").length !== before) throw new Error("vente passée hors ligne ?!"); const t1 = await txt(); if (!/Hors ligne|Synchronisation/.test(t1)) throw new Error("pas d'indicateur hors ligne: " + t1.slice(0, 200));
    h.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event("online"))); await page.waitForTimeout(3000);
    if (st.rows("sales").length !== before + 1) throw new Error("vente non synchronisée");
  });
  console.log("ERRORS", h.errors, "\nBAD", h.bad); await h.close();
})();
