const { start } = require("../harness.cjs"); const fs = require("fs");
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 4).join(" | ").slice(0, 600)); } };
(async () => {
  const h = await start({ plan: "pro", expect: ["checkout", "pos.simulate"] }); const { page, call, st } = h; const txt = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const mk = async (name, price, cost, qty, extra = {}) => (await call("article.save", { data: { name, price, cost, ...extra }, initialQty: qty }, h.shop)).body.data.id;
  const eau = await mk("Eau", 500, 300, 50); const pain = await mk("Pain", 200, 120, 50); const jus = await mk("Jus", 1000, 600, 50);
  for (let i = 0; i < 4; i++) await call("checkout", { clientId: crypto.randomUUID(), lines: [{ productId: eau, qty: 1 }, { productId: pain, qty: 1 }], payments: [{ method: "cash", amount: 700 }] }, h.shop);
  await step("suggestions réelles : « Pain » proposé avec le nombre de ventes, ajout au panier", async () => {
    await page.goto(h.url("pos")); await page.waitForSelector("button:has-text('Eau')", { timeout: 15000 }); await page.locator("button:has-text('Eau')").first().click();
    await page.waitForSelector("text=Souvent acheté avec ce panier", { timeout: 10000 }); const t = await txt(); if (!/4 ventes sur 4/.test(t)) throw new Error(t.slice(0, 600));
    await page.getByRole("button", { name: /＋ Pain/ }).click(); await page.waitForTimeout(300); if (!(await page.getByLabel("Retirer Pain").count()) && !(await page.getByLabel("Moins").count())) throw new Error("Pain non ajouté");
  });
  await step("simulation : vente sous le coût signalée avant validation (propriétaire : droit « valider », non bloquant)", async () => {
    await page.locator("button:has-text('Jus')").first().click(); await page.getByLabel(/Remise Jus/).fill("50"); await page.waitForSelector("text=vendu sous le coût", { timeout: 10000 });
  });
  await step("encaissement : « en attente de confirmation » puis « confirmée par le serveur » ; stock et journal écrits", async () => {
    const enc = page.getByRole("button", { name: /Encaisser/ }); await page.getByLabel("Montant 1").fill("1200"); await enc.click(); await page.getByText(/Valider la vente de/).waitFor(); await page.getByRole("button", { name: "Valider" }).last().click();
    await page.waitForSelector("[data-sync]", { timeout: 15000 }); await page.waitForSelector("[data-sync='synced']", { timeout: 20000 });
    const sale = st.rows("sales").find((x) => x.total === 1200); if (!sale) throw new Error("vente absente " + JSON.stringify(h.calls.slice(-4))); if (!st.rows("finance_ledger").some((l) => l.kind === "sale" && l.amount === 1200)) throw new Error("journal absent");
  });
  await step("ticket 80 mm avec QR généré", async () => { const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.getByRole("button", { name: "Ticket 80 mm" }).click()]); const b = fs.readFileSync(await dl.path()); if (b.slice(0, 4).toString() !== "%PDF") throw new Error("pas un PDF"); });
  await step("raccourcis et favoris : F2 place le curseur dans la recherche ; favori mémorisé", async () => {
    await page.keyboard.press("F2"); const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label")); if (focused !== "Rechercher") throw new Error("F2 : " + focused);
    await page.getByLabel("Ajouter aux favoris : Eau").click(); await page.getByRole("button", { name: /Favoris \(1\)/ }).click(); const t = await txt(); if (!/Eau/.test(t) || /Jus/.test(t.split("Favoris")[1] ?? "")) throw new Error("filtre favoris");
  });
  await step("Caisse Pro : approbations, journal intègre, intelligence, vérification du ticket", async () => {
    await page.goto(h.url("caisse-pro")); await page.waitForSelector("text=Approbations", { timeout: 15000 });
    await page.getByRole("button", { name: "Journal" }).click(); await page.getByRole("button", { name: /Contrôler l'intégrité/ }).click(); await page.waitForSelector("text=Journal intègre", { timeout: 10000 });
    await page.getByRole("button", { name: "Intelligence" }).click(); await page.waitForSelector("text=Panier moyen", { timeout: 10000 }); const t = await txt(); if (!/Prévision indicative/.test(t) || !/Méthode/.test(t)) throw new Error(t.slice(0, 500));
    const sale = st.rows("sales").find((x) => x.total === 1200); const g = (await call("sale.get", { saleId: sale.$id }, h.shop)).body.data;
    await page.getByRole("button", { name: "Vérifier un ticket" }).click(); await page.getByLabel("Code du ticket").fill(g.verifyCode); await page.getByRole("button", { name: "Vérifier", exact: true }).click(); await page.waitForSelector("text=Ticket authentique", { timeout: 8000 });
    await page.getByLabel("Code du ticket").fill(g.verifyCode.replace(/\.\d+\./, ".9999.")); await page.getByRole("button", { name: "Vérifier", exact: true }).click(); await page.waitForSelector("text=Ticket non valide", { timeout: 8000 });
  });
  await step("vente hors ligne : « en attente de synchronisation », jamais « confirmée » avant le retour réseau ; puis confirmée", async () => {
    await page.goto(h.url("pos")); await page.waitForSelector("button:has-text('Pain')", { timeout: 15000 }); await page.locator("button:has-text('Pain')").first().click(); h.setOffline(true); await page.context().setOffline(true);
    await page.getByLabel("Montant 1").fill("200"); await page.getByRole("button", { name: /Encaisser/ }).click(); await page.getByRole("button", { name: "Valider" }).last().click(); await page.waitForSelector("[data-sync='pending']", { timeout: 10000 });
    await page.waitForTimeout(1500); if (await page.locator("[data-sync='synced']").count()) throw new Error("affichée confirmée hors ligne"); const before = st.rows("sales").length;
    h.setOffline(false); await page.context().setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event("online"))); await page.waitForSelector("[data-sync='synced']", { timeout: 25000 }); if (st.rows("sales").length !== before + 1) throw new Error("vente non enregistrée par le serveur");
  });
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|ERR_INTERNET|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close();
})();
