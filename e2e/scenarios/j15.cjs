const { start } = require("../harness.cjs");
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 4).join(" | ").slice(0, 600)); } };
(async () => {
  const h = await start({ plan: "pro", expect: ["promotion.save", "checkout"] }); const { page, call, st } = h;
  const txt = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const mk = async (name, price, cost, extra = {}) => (await call("article.save", { data: { name, price, cost, ...extra }, initialQty: 100 }, h.shop)).body.data.id;
  const eau = await mk("Eau", 500, 300, { category: "Boissons", sku: "EAU-1" }), jus = await mk("Jus", 1000, 600, { category: "Boissons", sku: "JUS-1" });
  await step("onglets Pro visibles et déverrouillés", async () => { await page.goto(h.url("promotions")); await page.waitForTimeout(1500); const t = await txt(); for (const x of ["Campagnes", "Calendrier", "Coupons", "Budgets", "Performance", "Magasins", "Conseils", "Réglages", "Journal"]) if (!t.includes(x)) throw new Error("manque " + x); if (t.includes("🔒")) throw new Error("verrou affiché en Pro"); });
  await step("création Prix dégressifs via le formulaire dynamique", async () => {
    await page.getByRole("button", { name: /Nouvelle campagne/ }).click(); await page.getByLabel("Nom de la campagne *").fill("Dégressif Eau"); await page.getByLabel("Type de promotion *").selectOption("tiers");
    await page.getByLabel("Quantité palier 1").fill("3"); await page.getByLabel("Valeur palier 1").fill("10"); await page.getByRole("button", { name: /Ajouter un palier/ }).click(); await page.getByLabel("Quantité palier 2").fill("10"); await page.getByLabel("Valeur palier 2").fill("20");
    await page.locator("[role=dialog]").getByText("Eau", { exact: true }).first().click(); await page.getByRole("button", { name: /Créer/ }).click(); await page.waitForTimeout(1500);
    const p = st.rows("promotions")[0]; if (!p || p.family !== "tiers" || p.status !== "draft") throw new Error("pas créée " + JSON.stringify(p)); if (st.rows("promotion_conditions").length !== 2) throw new Error("paliers " + st.rows("promotion_conditions").length);
    await page.getByText("Dégressif Eau").first().click(); await page.waitForTimeout(600); await page.getByRole("button", { name: "Activer" }).click(); await page.getByRole("button", { name: "Confirmer" }).click(); await page.waitForTimeout(1200); if (st.rows("promotions")[0].status !== "enabled") throw new Error((await txt()).slice(0, 300));
  });
  await step("caisse : palier 3 → −10 %, explication « Pourquoi », puis vente avec instantané", async () => {
    await page.goto(h.url("pos")); await page.waitForTimeout(1500); await page.getByText("Eau", { exact: true }).first().click(); await page.getByLabel("Plus").click(); await page.getByLabel("Plus").click(); await page.waitForTimeout(1800);
    const t = await txt(); if (!/Remises : −150/.test(t)) throw new Error(t.slice(0, 500)); await page.getByText(/Pourquoi ces remises/).click(); if (!/appliquée|Dégressif Eau/.test(await txt())) throw new Error("pas d'explication");
    await page.getByLabel("Montant 1").fill("2000"); await page.getByRole("button", { name: /Encaisser 1\s?350/ }).click(); await page.getByRole("button", { name: "Valider" }).last().click(); await page.waitForTimeout(2500);
    const u = st.rows("promotion_usage")[0]; if (!u || u.family !== "tiers" || !String(u.rules).includes("tiers")) throw new Error("instantané manquant " + JSON.stringify(u));
  });
  await step("coupon : campagne à coupon + création + saisie à la caisse", async () => {
    await call("promotion.save", { data: { name: "VIP Jus", kind: "percent", scope: "items", value: 20, startAt: new Date(Date.now() - 864e5).toISOString(), endAt: new Date(Date.now() + 5 * 864e5).toISOString(), requiresCoupon: true }, productIds: [jus] }, h.shop);
    const id = st.rows("promotions").find((p) => p.name === "VIP Jus").$id; await call("promotion.status", { id, to: "enabled" }, h.shop);
    await page.goto(h.url("promotions")); await page.waitForTimeout(1200); await page.getByRole("button", { name: "Coupons" }).click(); await page.waitForTimeout(800); await page.getByLabel("Campagne liée *").selectOption({ label: "VIP Jus (coupon exigé)" }); await page.getByLabel("Code (généré si vide)").fill("MERCI20"); await page.getByRole("button", { name: "Créer", exact: true }).click(); await page.waitForTimeout(1200);
    if (!/MERCI20/.test(await txt())) throw new Error("coupon non listé"); 
    await page.goto(h.url("pos")); await page.waitForTimeout(1500); await page.getByText("Jus", { exact: true }).first().click(); await page.waitForTimeout(1200); if (/Remises/.test(await txt())) throw new Error("remise sans coupon");
    await page.getByLabel("Coupon").fill("faux1"); await page.getByRole("button", { name: "Appliquer" }).click(); await page.waitForTimeout(1500); if (!/inconnu/.test(await txt())) throw new Error("pas de message coupon inconnu: " + (await txt()).slice(0, 400));
    await page.getByLabel("Coupon").fill("merci20"); await page.getByRole("button", { name: "Appliquer" }).click(); await page.waitForTimeout(1500); if (!/accepté/.test(await txt()) || !/−200/.test(await txt())) throw new Error((await txt()).slice(0, 500));
    await page.getByLabel("Montant 1").fill("1000"); await page.getByRole("button", { name: /Encaisser 8\s?00/ }).click(); await page.getByRole("button", { name: "Valider" }).last().click(); await page.waitForTimeout(2500); const c = st.rows("promotion_coupons")[0]; if (c.usedCount !== 1) throw new Error("coupon non consommé " + JSON.stringify(c));
  });
  await step("calendrier, budgets, performance, conseils, réglages, journal s'ouvrent avec données réelles", async () => {
    await page.goto(h.url("promotions")); await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Calendrier" }).click(); await page.waitForTimeout(600); if (!/Dégressif Eau/.test(await txt())) throw new Error("calendrier");
    await page.getByRole("button", { name: "Performance" }).click(); await page.waitForTimeout(1500); let t = await txt(); if (!/Remises accordées/.test(t) || !/Marge brute/.test(t) || !/causé/.test(t)) throw new Error(t.slice(0, 500));
    await page.getByRole("button", { name: "Conseils" }).click(); await page.waitForTimeout(1500); t = await txt(); if (!/Rien n'est créé/.test(t)) throw new Error(t.slice(0, 300));
    await page.getByRole("button", { name: "Réglages" }).click(); await page.waitForTimeout(800); await page.getByLabel("Par article (% du prix)").fill("40"); await page.getByRole("button", { name: "Enregistrer" }).click(); await page.waitForTimeout(1000); if (st.rows("shops")[0].promoMaxLinePct !== 40) throw new Error("plafond non enregistré " + JSON.stringify(st.rows("shops")[0]));
    await page.getByRole("button", { name: "Journal" }).click(); await page.waitForTimeout(1000); t = await txt(); if (!/Création/.test(t) || !/Activation/.test(t)) throw new Error(t.slice(0, 300));
    await page.getByRole("button", { name: "Budgets" }).click(); await page.waitForTimeout(1200); if (!/Aucune campagne n'a de budget/.test(await txt())) throw new Error("budgets");
  });
  await step("rétrogradation Business : campagnes avancées gelées + onglets verrouillés", async () => {
    const row = st.rows("subscriptions")[0]; row.plan = "business"; await page.reload(); await page.waitForTimeout(2000); await page.goto(h.url("promotions")); await page.waitForTimeout(1800);
    const t = await txt(); if (!/gelée/i.test(t)) throw new Error(t.slice(0, 500));
    await page.getByRole("button", { name: /Coupons/ }).click(); await page.waitForTimeout(500); if (!/Réservé à la formule Pro/.test(await txt())) throw new Error("coupons non verrouillés");
  });
  console.log("ERRORS", h.errors, "\nBAD", h.bad); await h.close();
})();
