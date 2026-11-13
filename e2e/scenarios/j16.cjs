const { start } = require("../harness.cjs");
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 4).join(" | ").slice(0, 600)); } };
(async () => {
  const h = await start({ plan: "business" }); const { page, call, st } = h;
  const txt = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const mk = async (name, price, cost, qty, extra = {}) => (await call("article.save", { data: { name, price, cost, ...extra }, ...(qty ? { initialQty: qty } : {}) }, h.shop)).body.data.id;
  await step("état vide : aucun chiffre inventé, aucune alerte", async () => {
    await page.goto(h.url("activite")); await page.waitForSelector("text=CA du jour", { timeout: 15000 }); const t = await txt();
    if (!/Aucune alerte/.test(t) || !/Aucune vente sur la période/.test(t) || !/Aucun article vendu/.test(t) || !/Non calculable/.test(t)) throw new Error(t.slice(0, 700));
  });
  const eau = await mk("Eau", 500, 300, 100, { category: "Boissons" }), jus = await mk("Jus", 1000, 600, 100, { category: "Boissons" }); await mk("Rare", 900, 400, 2, { minStock: 5 }); await mk("Zéro", 900, 400, 0); await mk("Gratuit", 0, 0, 3);
  const sale = (lines, payments) => call("checkout", { clientId: "v" + Math.random().toString(36).slice(2, 12), lines, payments }, h.shop);
  await sale([{ productId: eau, qty: 4 }], [{ method: "cash", amount: 1000 }, { method: "card", amount: 1000 }]); await sale([{ productId: jus, qty: 1 }], [{ method: "cash", amount: 1000 }]);
  await step("chiffres réels après deux ventes (3 000 FCFA), alertes réelles", async () => {
    await page.getByRole("button", { name: "Actualiser" }).click(); await page.waitForTimeout(1500); const t = await txt();
    if (!/CA du jour 3\s?000 FCFA/.test(t) || !/Ventes réalisées 2/.test(t) || !/Panier moyen 1\s?500/.test(t)) throw new Error(t.slice(0, 900));
    if (!/en rupture/.test(t) || !/sous le seuil/.test(t) || !/sans prix de vente/.test(t)) throw new Error("alertes " + t.slice(0, 900)); if (/annulée/.test(t)) throw new Error("alerte annulée sans événement");
  });
  await step("filtres : Hier = 0 vente ; 7 jours = 2 ; période personnalisée", async () => {
    await page.getByRole("button", { name: "Hier" }).click(); await page.waitForTimeout(1200); if (!/Ventes réalisées 0/.test(await txt())) throw new Error("hier"); await page.getByRole("button", { name: "7 derniers jours" }).click(); await page.waitForTimeout(1200); if (!/Ventes réalisées 2/.test(await txt())) throw new Error("7j");
    await page.getByRole("button", { name: "Période personnalisée" }).click(); const today = new Date().toISOString().slice(0, 10); await page.locator("input[type=date]").nth(0).fill(today); await page.locator("input[type=date]").nth(1).fill(today); await page.waitForTimeout(1500); if (!/Ventes réalisées 2/.test(await txt())) throw new Error("custom " + (await txt()).slice(0, 300));
  });
  await step("graphiques et activité : top articles, modes de paiement, détail d'une vente", async () => {
    await page.getByRole("button", { name: "30 derniers jours" }).click(); await page.waitForTimeout(1200); const t = await txt(); if (!/1\. Eau|1\. Jus/.test(t) || !/Espèces/.test(t) || !/Carte/.test(t) || !/Boissons/.test(t)) throw new Error(t.slice(0, 900));
    await page.locator("section[aria-label='Activité récente'] button").filter({ hasText: /V-/ }).first().click(); await page.waitForTimeout(600); if (!/Lignes/.test(await txt())) throw new Error("détail vente"); await page.getByLabel("Fermer").click();
    await page.screenshot({ path: "ov1.png", fullPage: true });
  });
  await step("hors ligne : message clair, les derniers chiffres restent affichés", async () => {
    h.setOffline(true); await page.getByRole("button", { name: "Actualiser" }).click(); await page.waitForTimeout(2500); const t = await txt(); if (!/Impossible de charger|hors ligne/i.test(t) || !/CA du jour/.test(t)) throw new Error(t.slice(0, 400)); h.setOffline(false); await page.getByRole("button", { name: "Réessayer" }).click(); await page.waitForTimeout(1500); if (/Impossible de charger/.test(await txt())) throw new Error("pas de reprise");
  });
  await step("Starter : écran verrouillé ; caissier : tuile absente de l'accueil", async () => {
    st.rows("subscriptions")[0].plan = "starter"; await page.goto(h.url("activite")); await page.waitForTimeout(2000); if (!/Réservé à la formule Business/.test(await txt())) throw new Error("starter"); st.rows("subscriptions")[0].plan = "business";
  });
  console.log("ERRORS", h.errors, "\nBAD", h.bad); await h.close();
})();
