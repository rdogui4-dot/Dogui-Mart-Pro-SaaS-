const { start } = require("../harness.cjs"); const fs = require("fs");
const png = fs.readFileSync(__dirname + "/../.build/site/Dogui-Mart-Pro-SaaS-/icon-192.png");
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n")[0].slice(0, 220)); } };
(async () => {
  const h = await start({ expect: [] }); const { page, st } = h;
  const goto = async (r) => { await page.goto(h.url(r)); await page.waitForTimeout(1200); };
  const txt = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
  await step("articles: création article simple avec photo", async () => {
    await goto("articles"); await page.getByText("Ajouter un article").click();
    await page.getByLabel("Désignation *").fill("Savon Dove"); await page.getByLabel("Prix de vente (FCFA) *").fill("500"); await page.getByLabel("Prix d'achat (FCFA)").fill("300");
    await page.getByLabel("Quantité en stock (initiale)").fill("20");
    await page.locator('input[type=file]').nth(1).setInputFiles({ name: "p.png", mimeType: "image/png", buffer: png });
    await page.getByRole("button", { name: "Créer l'article" }).click(); await page.waitForTimeout(1500);
    const p = st.rows("products").find((x) => x.name === "Savon Dove"); if (!p) throw new Error("article non créé: " + (await txt()).slice(0, 200));
    if (!/^DMP-\d{6}-\d{2}$/.test(p.sku)) throw new Error("sku " + p.sku); if (!p.imageFileId) throw new Error("photo non enregistrée");
  });
  await step("articles: fiche affiche la photo", async () => {
    await goto("articles"); await page.getByText("Savon Dove").first().click(); await page.waitForTimeout(1200);
    const n = await page.locator('[role=dialog] img').count(); if (!n) throw new Error("pas d'image dans la fiche");
    const nat = await page.locator('[role=dialog] img').first().evaluate((i) => i.naturalWidth); if (!nat) throw new Error("image non chargée");
  });
  await step("articles: article par lot → ouverture directe de l'entrée de lot", async () => {
    await goto("articles"); await page.getByText("Ajouter un article").click();
    await page.getByLabel("Désignation *").fill("Yaourt"); await page.getByLabel("Prix de vente (FCFA) *").fill("500"); await page.getByLabel("Prix d'achat (FCFA)").fill("300");
    await page.getByLabel("Suivi du stock").selectOption("lot"); await page.getByRole("button", { name: "Créer l'article" }).click(); await page.waitForTimeout(2000);
    if (!(await txt()).includes("Lots · Yaourt")) throw new Error("écran lots non ouvert: " + (await txt()).slice(0, 200));
    { const y = st.rows("products").find((p) => p.name === "Yaourt"); await st.create("stock_moves", "seedYaourt", y.tenantId, { tenantId: y.tenantId, shopId: y.shopId, productId: y.$id, qty: 12, kind: "purchase" }); } await page.getByRole("button", { name: /Ranger du stock dans un lot/ }).click(); await page.getByPlaceholder("N° de lot *").fill("L1"); await page.getByPlaceholder("Quantité *").fill("12");
    const d = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10); await page.locator('input[type=date]').fill(d);
    await page.getByRole("button", { name: "Enregistrer" }).click(); await page.waitForTimeout(1500);
    if (!(await txt()).includes("Lot L1")) throw new Error("lot non listé: " + (await txt()).slice(0, 300));
  });
  await step("articles: article par série → ajout de numéros", async () => {
    await goto("articles"); await page.getByText("Ajouter un article").click();
    await page.getByLabel("Désignation *").fill("Téléphone X"); await page.getByLabel("Prix de vente (FCFA) *").fill("50000"); await page.getByLabel("Prix d'achat (FCFA)").fill("40000");
    await page.getByLabel("Suivi du stock").selectOption("serial"); await page.getByRole("button", { name: "Créer l'article" }).click(); await page.waitForTimeout(2000);
    if (!(await txt()).includes("Numéros de série · Téléphone X")) throw new Error("écran séries non ouvert");
    await page.getByRole("button", { name: /Ajouter des numéros/ }).click(); await page.getByPlaceholder(/Un numéro par ligne/).fill("SN001\nSN002\nSN003"); await page.getByRole("button", { name: "Enregistrer" }).click(); await page.waitForTimeout(1500);
    if (!(await txt()).includes("SN002")) throw new Error("numéros non listés");
  });
  await step("bundles: création avec composants simple + lot + série", async () => {
    await goto("bundles"); await page.getByRole("button", { name: /Nouveau bundle/ }).click();
    await page.getByLabel("Nom du bundle *").fill("Pack test"); await page.getByLabel("Prix de vente (FCFA) *").fill("55000");
    const sel = page.getByLabel("Composant", { exact: true }); await sel.first().selectOption({ label: "Savon Dove" });
    for (const lab of [/Yaourt/, /Téléphone X/]) { await page.getByRole("button", { name: /Ajouter un composant/ }).click(); await page.getByLabel("Composant", { exact: true }).last().selectOption({ label: (await page.getByLabel("Composant", { exact: true }).last().locator("option").allInnerTexts()).find((t) => lab.test(t)) }); }
    await page.getByRole("button", { name: "Créer le bundle" }).click(); await page.waitForTimeout(2000);
    const b = st.rows("products").find((x) => x.name === "Pack test"); if (!b) throw new Error("bundle non créé: " + (await txt()).slice(0, 300));
    if (st.rows("article_components").filter((c) => c.bundleId === b.$id).length !== 3) throw new Error("composants");
  });
  const sales = () => st.rows("sales");
  await step("caisse: vente d'un article simple (clic, encaissement espèces)", async () => {
    await goto("pos"); await page.getByText("Savon Dove").first().click(); await page.getByRole("button", { name: /Encaisser/ }).click(); await page.waitForTimeout(2500);
    if (sales().length !== 1) throw new Error("vente non enregistrée: " + (await txt()).slice(0, 250));
    const q = st.rows("stock_moves").filter((m) => m.productId === st.rows("products").find((p) => p.name === "Savon Dove").$id).reduce((a, m) => a + (m.kind === "sale" ? -m.qty : m.qty), 0); if (q !== 19) throw new Error("stock " + q);
  });
  await step("caisse: vente du bundle (lot + série + simple) sans saisie de numéro", async () => {
    await goto("pos"); await page.getByText("Pack test").first().click(); await page.getByRole("button", { name: /Encaisser/ }).click(); await page.waitForTimeout(2500);
    if (sales().length !== 2) throw new Error("vente bundle non enregistrée: " + (await txt()).slice(0, 250));
    const sold = st.rows("article_serials").filter((r) => r.status === "sold"); if (sold.length !== 1) throw new Error("série non vendue");
  });
  await step("caisse: vente d'un article par série (numéro automatique)", async () => {
    await goto("pos"); await page.getByText("Téléphone X").first().click(); await page.getByRole("button", { name: /Encaisser/ }).click(); await page.waitForTimeout(2500);
    if (sales().length !== 3) throw new Error("vente série non enregistrée: " + (await txt()).slice(0, 250));
  });
  await step("stock: sélection d'un article et inventaire", async () => {
    await goto("stock"); await page.getByText("Savon Dove").first().click(); await page.waitForTimeout(500);
    await page.getByLabel("Quantité réellement comptée").fill("15"); await page.getByRole("button", { name: /Valider l'inventaire/ }).click(); await page.waitForTimeout(1500);
    const p = st.rows("products").find((x) => x.name === "Savon Dove"); const q = st.rows("stock_moves").filter((m) => m.productId === p.$id).reduce((a, m) => a + (["sale", "loss", "transfer_out"].includes(m.kind) ? -m.qty : m.qty), 0); if (q !== 15) throw new Error("stock " + q);
  });
  await step("tableau de bord", async () => { await goto("tableau"); const t = await txt(); if (!t.includes("Valeur du stock")) throw new Error(t.slice(0, 300)); });
  console.log("ERRORS", h.errors, "\nBAD", h.bad); await h.close();
})();
