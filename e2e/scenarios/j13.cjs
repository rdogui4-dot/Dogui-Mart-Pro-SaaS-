const { start } = require("../harness.cjs");
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 4).join(" | ").slice(0, 500)); } };
(async () => {
  const h = await start({ plan: "business", expect: ["promotion.save"] }); const { page, call, st } = h;
  const txt = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const eau = (await call("article.save", { data: { name: "Eau", price: 500, cost: 300, category: "Boissons" }, initialQty: 50 }, h.shop)).body.data.id;
  await call("article.save", { data: { name: "Jus", price: 1000, cost: 600, category: "Boissons" }, initialQty: 50 }, h.shop);
  await step("liste vide : aucune promotion fictive", async () => { await page.goto(h.url("promotions")); await page.waitForTimeout(1500); const t = await txt(); if (!t.includes("Aucune promotion")) throw new Error(t.slice(0, 200)); if (st.rows("promotions").length) throw new Error("promotion préexistante"); });
  await step("création refusée sous la marge (message du serveur)", async () => {
    await page.getByRole("button", { name: /Nouvelle promotion/ }).click(); await page.getByLabel("Nom de la promotion *").fill("Casse"); await page.getByLabel(/Pourcentage \(1/).fill("60");
    await page.locator("[role=dialog]").getByText("Eau", { exact: true }).click(); await page.getByRole("button", { name: /Créer/ }).click(); await page.waitForTimeout(1200); if (!/marge minimale/.test(await txt())) throw new Error((await txt()).slice(0, 300));
  });
  await step("création valide (brouillon) puis activation", async () => {
    await page.getByLabel(/Pourcentage \(1/).fill("20"); await page.getByLabel("Nom de la promotion *").fill("Rentrée Eau"); await page.getByRole("button", { name: /Créer/ }).click(); await page.waitForTimeout(1500);
    const p = st.rows("promotions")[0]; if (!p || p.status !== "draft" || p.discountValue !== 20) throw new Error("pas créée: " + JSON.stringify(p));
    await page.getByText("Rentrée Eau").first().click(); await page.waitForTimeout(500); await page.getByRole("button", { name: "Activer" }).click(); await page.getByRole("button", { name: "Confirmer" }).click(); await page.waitForTimeout(1200);
    if (st.rows("promotions")[0].status !== "enabled") throw new Error("non activée: " + (await txt()).slice(0, 250));
  });
  await step("caisse : aperçu serveur (prix initial, remise, prix final) puis vente", async () => {
    await page.goto(h.url("pos")); await page.waitForTimeout(1500); await page.getByText("Eau", { exact: true }).first().click(); await page.getByLabel("Plus").click(); await page.waitForTimeout(1500);
    const t = await txt(); if (!/Promotion : Rentrée Eau/.test(t) || !/−200/.test(t)) throw new Error(t.slice(0, 500)); const btn = page.getByRole("button", { name: /Encaisser 800/ }); await btn.waitFor({ timeout: 4000 });
    await page.getByLabel("Montant reçu").fill("1000"); await btn.click(); await page.waitForTimeout(2500);
    const sale = st.rows("sales")[0]; if (!sale || sale.total !== 800) throw new Error("vente " + JSON.stringify(sale?.total)); if (st.rows("promotion_usage").length !== 1) throw new Error("utilisation non enregistrée");
  });
  await step("détail : historique des utilisations et résultats", async () => {
    await page.goto(h.url("promotions")); await page.waitForTimeout(1500); await page.getByText("Rentrée Eau").first().click(); await page.waitForTimeout(1200); const t = await txt(); if (!/Historique des utilisations/.test(t) || !/V-/.test(t)) throw new Error(t.slice(0, 400));
    await page.getByLabel("Fermer").click(); await page.getByRole("button", { name: "Résultats" }).click(); await page.waitForTimeout(1500); const r = await txt(); if (!/pas un bénéfice/.test(r) || !/200 FCFA/.test(r)) throw new Error(r.slice(0, 400));
  });
  await step("code promo regroupant 2 articles : appliqué automatiquement, aucun champ de saisie", async () => {
    const jus = st.rows("products").find((p) => p.name === "Jus").$id;
    await call("promotion.save", { data: { name: "Rentrée", kind: "amount", scope: "items", code: "RENTREE26", value: 100, startAt: new Date(Date.now() - 864e5).toISOString(), endAt: new Date(Date.now() + 5 * 864e5).toISOString(), allowBelowMargin: true }, productIds: [jus, eau] }, h.shop);
    const id = st.rows("promotions").find((p) => p.code === "RENTREE26").$id; await call("promotion.status", { id, to: "enabled" }, h.shop);
    await page.goto(h.url("pos")); await page.waitForTimeout(1500); await page.getByText("Jus", { exact: true }).first().click(); await page.waitForTimeout(1500);
    const t = await txt(); if (!/RENTREE26/.test(t)) throw new Error(t.slice(0, 500)); if (await page.getByLabel("Code promo").count()) throw new Error("champ code encore présent");
  });
  console.log("ERRORS", h.errors, "\nBAD", h.bad); await h.close();
})();
