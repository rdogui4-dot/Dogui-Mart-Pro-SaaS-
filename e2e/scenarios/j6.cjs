const { start } = require("../harness.cjs");
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n")[0].slice(0, 260)); } };
(async () => {
  const h = await start(); const { page, call, st } = h;
  const goto = async (r) => { await page.goto(h.url(r)); await page.waitForTimeout(1300); };
  const txt = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const mk = async (name, extra = {}, qty = 0) => (await call("article.save", { data: { name, price: 1000, cost: 500, ...extra }, ...(qty ? { initialQty: qty } : {}) }, h.shop)).body.data.id;
  const tee = await mk("Tee-shirt", { price: 5000, cost: 3000 }); const jus = await mk("Jus", {}, 20); const pain = await mk("Pain", { price: 200, cost: 100 }, 10);
  const yaourt = await mk("Yaourt", { tracking: "lot" }); await call("lot.receive", { productId: yaourt, lotNo: "A", qty: 10, expiresAt: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) }, h.shop);
  const tel = await mk("Tel", { tracking: "serial" }); await call("serial.add", { productId: tel, serials: "SN1 SN2 SN3" }, h.shop);
  const open = async (name) => { await goto("articles"); await page.getByText(name, { exact: false }).first().click(); await page.waitForTimeout(800); };
  await step("variantes: ajout d'une variante (UI)", async () => {
    await open("Tee-shirt"); await page.getByRole("button", { name: /Gérer/ }).first().click(); await page.getByRole("button", { name: /Ajouter une variante/ }).click();
    await page.getByPlaceholder(/Valeur/).first().fill("M").catch(async () => { throw new Error("champ valeur: " + (await txt()).slice(0, 200)); });
  });
  await step("conditionnements: éditeur", async () => { await open("Jus"); await page.getByText("Conditionnements").first().waitFor({ timeout: 3000 }); await page.getByRole("button", { name: "Modifier" }).nth(0).click().catch(() => {}); });
  await step("tarifs: fiche article ouvre l'éditeur de tarifs", async () => { await open("Jus"); await page.getByText("Tarifs spéciaux").waitFor({ timeout: 3000 }); });
  await step("fournisseurs & coûts: ouverture", async () => { await open("Jus"); await page.getByText("Fournisseurs & coûts").waitFor({ timeout: 3000 }); });
  await step("lots: mise au rebut d'un lot", async () => {
    await open("Yaourt"); await page.getByRole("button", { name: /Lots & péremption/ }).click(); await page.waitForTimeout(800); await page.getByRole("button", { name: /Mettre au rebut/ }).first().click();
    await page.getByLabel("Quantité à retirer").fill("2"); await page.getByPlaceholder(/Motif/).fill("Cassé"); await page.getByRole("button", { name: "Retirer" }).click(); await page.waitForTimeout(1200);
    if (!st.rows("stock_moves").some((m) => m.kind === "loss")) throw new Error("pas de perte: " + (await txt()).slice(0, 200));
  });
  await step("séries: changement de statut (défectueux)", async () => {
    await open("Tel"); await page.getByRole("button", { name: /Numéros de série/ }).click(); await page.waitForTimeout(800); await page.getByRole("button", { name: "Défectueux" }).first().click(); await page.getByRole("button", { name: "Confirmer" }).click(); await page.waitForTimeout(1200);
    if (!st.rows("article_serials").some((r) => r.status === "defective")) throw new Error("statut inchangé");
  });
  await step("bundles: création kit physique + assemblage + démontage (UI)", async () => {
    await goto("bundles"); await page.getByRole("button", { name: /Nouveau bundle/ }).click(); await page.getByLabel("Type de bundle").selectOption("kit");
    await page.getByLabel("Nom du bundle *").fill("Coffret"); await page.getByLabel("Prix de vente (FCFA) *").fill("3000");
    await page.getByLabel("Composant", { exact: true }).first().selectOption({ label: "Jus" }); await page.getByRole("button", { name: /Ajouter un composant/ }).click(); await page.getByLabel("Composant", { exact: true }).last().selectOption({ label: "Pain" });
    await page.getByRole("button", { name: "Créer le bundle" }).click(); await page.waitForTimeout(1800);
    await page.getByText("Coffret").first().click(); await page.waitForTimeout(800); await page.getByRole("button", { name: /Assembler \/ démonter/ }).click(); await page.waitForTimeout(500);
    await page.getByLabel("Nombre de kits").fill("3").catch(async () => { await page.locator('input[inputmode=numeric]').last().fill("3"); }); await page.getByRole("button", { name: "Assembler", exact: true }).click(); await page.waitForTimeout(1500);
    if (!st.rows("assembly_orders").some((o) => o.type === "assemble" && o.status === "done")) throw new Error("assemblage non enregistré: " + (await txt()).slice(0, 300));
    await page.getByRole("button", { name: "Démonter", exact: true }).click(); await page.waitForTimeout(1500); if (st.rows("assembly_orders").length !== 2) throw new Error("démontage non enregistré");
  });
  await step("tableau de bord: alerte lot proche + accusé de lecture", async () => {
    await goto("tableau"); const t = await txt(); if (!/Péremption proche/.test(t)) throw new Error(t.slice(0, 300)); await page.getByRole("button", { name: "Lu" }).first().click(); await page.waitForTimeout(1000); if (!st.rows("article_alerts").some((a) => a.status === "read")) throw new Error("pas d'accusé");
  });
  await step("articles: recherche, archivage, suppression", async () => {
    await goto("articles"); await page.getByPlaceholder(/Rechercher/).first().fill("Pain"); await page.waitForTimeout(800); if (!(await txt()).includes("Pain")) throw new Error("recherche");
    await page.getByText("Pain").first().click(); await page.getByRole("button", { name: /Archiver/ }).click(); await page.getByRole("button", { name: "Archiver" }).last().click(); await page.waitForTimeout(1200);
    if (!st.rows("products").find((p) => p.name === "Pain").archived) throw new Error("non archivé");
  });
  console.log("ERRORS", h.errors, "\nBAD", h.bad); await h.close();
})();
