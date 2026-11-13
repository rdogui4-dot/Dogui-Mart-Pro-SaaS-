const { start } = require("../harness.cjs"); const { handle } = require("../.build/server.cjs"); const fs = require("fs");
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 4).join(" | ").slice(0, 700)); } };
(async () => {
  const h = await start({ plan: "business", expect: [] }); const { page, call, st } = h; const txt = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
  await call("article.save", { data: { name: "Eau", price: 500, cost: 300 }, initialQty: 50 }, h.shop);
  const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(400, 65)]);
  await step("session ouverte (fond 20 000) puis page Dépenses visible depuis l'accueil", async () => {
    await page.goto(h.url("caisse")); await page.waitForSelector("text=Ouvrir la caisse", { timeout: 15000 }); await page.getByLabel("Fond initial").fill("20000"); await page.getByRole("button", { name: "Ouvrir la caisse" }).click(); await page.waitForSelector("text=Caisse ouverte", { timeout: 8000 });
    await page.goto(h.url("accueil")); await page.waitForSelector("text=Dépenses", { timeout: 10000 });
  });
  await step("dépense payée en caisse : confirmation, justificatif PDF, sortie déduite du solde", async () => {
    await page.goto(h.url("depenses")); await page.getByRole("button", { name: /Nouvelle/ }).click(); await page.getByLabel("Libellé").fill("Transport marchandises"); await page.getByLabel("Montant").fill("3000"); await page.getByLabel("Bénéficiaire").fill("Moussa Fall");
    const b = page.getByRole("button", { name: "Enregistrer la dépense" }); await b.click(); await page.getByText(/Confirmer la dépense/).waitFor({ timeout: 5000 });
    if (st.rows("expenses").length) throw new Error("écrit avant confirmation"); await page.getByRole("button", { name: "Confirmer", exact: true }).click(); await page.waitForSelector("text=Transport marchandises", { timeout: 10000 });
    const e = st.rows("expenses")[0]; if (!e || e.status !== "approved" || e.source !== "till") throw new Error(JSON.stringify(e)); if (st.rows("cash_movements").length !== 1) throw new Error("sortie absente");
    await page.goto(h.url("caisse")); await page.waitForSelector("text=dont", { timeout: 10000 }); const t = await txt(); if (!/17\s?000/.test(t)) throw new Error(t.slice(0, 600));
  });
  await step("sortie de caisse simple : bénéficiaire, confirmation avant écriture", async () => {
    await page.getByLabel("Montant du mouvement").fill("500"); await page.getByLabel("Motif").fill("Achat de sacs"); await page.getByLabel("Bénéficiaire").fill("Boutique Ndiaye"); await page.getByRole("button", { name: /Enregistrer/ }).click(); await page.getByText(/Confirmer la sortie/).waitFor({ timeout: 5000 });
    if (st.rows("cash_movements").length !== 1) throw new Error("écrit avant confirmation"); await page.getByRole("button", { name: "Confirmer", exact: true }).click(); await page.waitForSelector("text=Boutique Ndiaye", { timeout: 8000 }); if (st.rows("cash_movements").length !== 2) throw new Error("sortie non écrite");
  });
  await step("détail : historique, justificatif ; annulation tracée avec motif → solde rétabli, dépense conservée", async () => {
    await page.goto(h.url("depenses")); await page.locator("button:has-text('Transport marchandises')").first().click(); await page.waitForSelector("text=Historique", { timeout: 8000 }); let t = await txt(); if (!/Enregistrée/.test(t)) throw new Error(t.slice(0, 500));
    await page.getByRole("button", { name: "Annuler", exact: true }).click(); const c = page.getByRole("button", { name: "Confirmer l'annulation" }); if (await c.isEnabled()) throw new Error("annulation sans motif"); await page.getByLabel("Motif de l'annulation").fill("Saisie en double"); await c.click(); await page.waitForFunction(() => document.body.innerText.includes("Annulée") && /Motif d.annulation/.test(document.body.innerText), null, { timeout: 8000 });
    const e = st.rows("expenses")[0]; if (e.status !== "cancelled" || st.rows("expenses").length !== 1) throw new Error("dépense supprimée ou non annulée"); if (!st.rows("cash_movements").some((m) => m.kind === "in" && m.expenseId)) throw new Error("régularisation absente"); if (st.rows("expense_events").length < 3) throw new Error("historique incomplet");
  });
  await step("liste filtrée, rapport réel, export CSV", async () => {
    await page.goto(h.url("depenses")); await page.getByLabel("Statut").selectOption("cancelled"); await page.waitForSelector("button:has-text('Transport marchandises')", { timeout: 8000 }); await page.getByLabel("Statut").selectOption("approved"); await page.waitForSelector("text=Aucune dépense", { timeout: 8000 });
    await call("expense.create", { requestId: crypto.randomUUID(), label: "Loyer", category: "loyer", amount: 80000, spentOn: new Date().toISOString().slice(0, 10), method: "transfer", source: "external", reference: "VIR-1" }, h.shop);
    await page.getByRole("button", { name: "Rapports" }).click(); await page.waitForSelector("text=Par catégorie", { timeout: 10000 }); const t = await txt(); if (!/80\s?000/.test(t) || !/Résultat non affiché/.test(t)) throw new Error(t.slice(0, 900));
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.getByRole("button", { name: "CSV", exact: true }).click()]); const csv = fs.readFileSync(await dl.path(), "utf8"); if (!/Loyer/.test(csv) || !/Transport marchandises/.test(csv)) throw new Error(csv.slice(0, 300));
  });
  await step("tableau de bord : dépenses validées affichées séparément du CA", async () => {
    await page.goto(h.url("activite")); await page.waitForSelector("text=Dépenses validées", { timeout: 15000 }); const t = await txt(); if (!/80\s?000/.test(t)) throw new Error(t.slice(0, 600));
  });
  await step("réglages : seuil + catégorie personnalisée", async () => {
    await page.goto(h.url("depenses")); await page.getByRole("button", { name: "Réglages" }).click(); await page.getByLabel("Seuil de validation").fill("50000"); await page.getByRole("button", { name: "Enregistrer", exact: true }).first().click(); await page.waitForSelector("text=Réglages enregistrés", { timeout: 8000 });
    await page.getByLabel("Nouvelle catégorie").fill("Cadeaux clients"); await page.getByRole("button", { name: "Ajouter" }).click(); await page.waitForSelector("text=Cadeaux clients", { timeout: 8000 }); if (st.rows("shops").find((x) => x.expenseThreshold === 50000) === undefined) throw new Error("seuil non enregistré");
  });
  await step("code du responsable : le vendeur crée (en attente), le responsable lit le code dans l'interface, le vendeur le saisit → validée", async () => {
    const cu = (await call("staff.create", { name: "Awa", username: "awa", password: "motdepasse1", role: "cashier", shopIds: [h.shop] }, "")).body.data.userId; const as = (action, payload) => handle(st, cu, { action, tenantId: "t1", shopId: h.shop, payload }, { admins: [] });
    await as("cash.open", { openingFloat: 10000 }); const r = (await as("expense.create", { requestId: crypto.randomUUID(), label: "Achat sacs", category: "fournitures", amount: 1500, spentOn: new Date().toISOString().slice(0, 10), method: "cash", source: "till" })).body.data; if (!r.awaitingCode || r.status !== "pending") throw new Error(JSON.stringify(r));
    await page.goto(h.url("depenses")); await page.locator("button:has-text('Achat sacs')").first().click(); await page.waitForSelector("text=En attente du code du responsable", { timeout: 10000 }); await page.getByRole("button", { name: "Afficher le code" }).click(); const el = page.getByLabel("Code à communiquer"); await el.waitFor({ timeout: 8000 }); const code = (await el.innerText()).trim();
    if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)) throw new Error("code illisible : " + code); const bad = await as("expense.code.validate", { id: r.id, code: "AAAA-BBBB" }); if (bad.status !== 403) throw new Error("mauvais code accepté");
    const ok = await as("expense.code.validate", { id: r.id, code }); if (ok.status !== 200 || ok.body.data.status !== "approved") throw new Error(JSON.stringify(ok.body)); if (!st.rows("cash_movements").some((m) => m.expenseId === r.id && m.authorizedBy === "u1")) throw new Error("sortie absente");
    await page.reload(); await page.locator("button:has-text('Achat sacs')").first().click(); await page.waitForSelector("text=Validée par Dogui", { timeout: 10000 });
  });
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close();
})();
