const { start } = require("../harness.cjs");
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 5).join(" | ").slice(0, 800)); } };
(async () => {
  const h = await start({ plan: "business", expect: ["crm.customer.save", "crm.lead.convert"] }); const { page, st } = h; const T = "t1"; const A = h.shop; const txt = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
  await st.create("products", "p1", T, { tenantId: T, shopId: A, name: "Riz 25kg", price: 1000, cost: 500 }); await st.create("stock_moves", "m0", T, { tenantId: T, shopId: A, productId: "p1", qty: 100, kind: "purchase" });
  const tab = (n) => page.getByRole("tab", { name: n }).click(); const wait = (t) => page.waitForSelector(`text=${t}`, { timeout: 10000 });
  await step("CRM visible en Business : onglets, état vide honnête (aucun faux client)", async () => {
    await page.goto(h.url("clients")); await tab("Clients"); await wait("Aucun client pour le moment"); for (const k of ["Tableau", "Prospects", "Opportunités", "Agenda", "Crédit & fidélité"]) if (!(await page.getByRole("tab", { name: k }).count())) throw new Error("onglet manquant " + k);
  });
  await step("fiche client créée depuis le formulaire (validation, consentements), retrouvée par la recherche", async () => {
    await page.getByRole("button", { name: "Nouveau client", exact: true }).click(); await page.getByLabel("Nom", { exact: true }).fill("Awa Ndiaye"); await page.getByLabel("Téléphone").fill("77 000 11 22"); await page.getByLabel("E-mail", { exact: true }).fill("awa@mail.sn"); await page.getByLabel("Entreprise").fill("Boutique Awa"); await page.getByLabel("Origine du contact").selectOption("referral"); await page.getByLabel("Consentement WhatsApp").check();
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click(); await wait("Fiche client").catch(() => {}); await wait("Sans achat"); const c = st.rows("customers")[0]; if (!c || c.phone !== "770001122" || c.source !== "referral" || !JSON.parse(c.consents).whatsapp) throw new Error(JSON.stringify(c));
    await page.getByLabel("Fermer").click(); await page.getByLabel("Rechercher un client").fill("awa"); await wait("Boutique Awa");
  });
  await step("doublon de téléphone signalé, enregistrement forcé seulement après confirmation", async () => {
    await page.getByRole("button", { name: "Nouveau client", exact: true }).click(); await page.getByLabel("Nom", { exact: true }).fill("Autre Awa"); await page.getByLabel("Téléphone").fill("770001122"); await page.getByRole("button", { name: "Enregistrer", exact: true }).click(); await wait("porte déjà ce téléphone"); if (st.rows("customers").length !== 1) throw new Error("doublon écrit");
    await page.getByRole("button", { name: /enregistrer quand même/ }).click(); await wait("Sans achat"); if (st.rows("customers").length !== 2) throw new Error("non créé"); await page.getByLabel("Fermer").click();
  });
  await step("une vente réelle en caisse met à jour la fiche (achat, chronologie, article) sans doublon", async () => {
    const cid = st.rows("customers").find((c) => c.name === "Awa Ndiaye").$id; const body = { clientId: "client-crm-0001", customerId: cid, lines: [{ productId: "p1", qty: 2 }], payments: [{ method: "cash", amount: 2000 }] };
    const r1 = await h.call("checkout", body, A); const r2 = await h.call("checkout", body, A); if (r1.status !== 200 || r2.status !== 200) throw new Error(JSON.stringify([r1.body, r2.body]));
    await page.reload(); await tab("Clients"); await page.getByLabel("Rechercher un client").fill("Boutique Awa"); await page.getByText("Awa Ndiaye").first().click(); await wait("Achats confirmés"); const t = await txt(); if (!/Achats confirmés\s*1\b/.test(t) || !/Riz 25kg/.test(t) || !/Vente V-/.test(t)) throw new Error(t.slice(0, 800)); await page.getByLabel("Fermer").click();
  });
  await step("prospect : création, étape, note, relance planifiée ; « gagné » seulement par conversion", async () => {
    await tab("Prospects"); await wait("Aucun prospect"); await page.getByRole("button", { name: "Nouveau prospect" }).click(); await page.getByLabel("Nom", { exact: true }).fill("Moussa Fall"); await page.getByLabel("Téléphone").fill("770009999"); await page.getByLabel("Origine du contact").selectOption("whatsapp"); await page.getByLabel("Notes du prospect").fill("Veut 50 sacs de riz");
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click(); await wait("Nouveau"); await page.getByLabel("Étape du prospect").selectOption("qualified"); await page.waitForFunction(() => document.body.innerText.includes("Qualifié"), null, { timeout: 8000 });
    await page.getByRole("button", { name: "Ajouter une note" }).click(); await page.getByLabel("Type d'interaction").selectOption("call"); await page.getByLabel("Contenu de la note").fill("Rappelle jeudi"); await page.getByRole("button", { name: "Enregistrer la note" }).click(); await wait("Rappelle jeudi");
    await page.getByRole("button", { name: "Planifier une relance" }).click(); await page.getByLabel("Intitulé", { exact: true }).fill("Rappeler Moussa"); await page.getByRole("button", { name: "Planifier", exact: true }).click(); await wait("Rappeler Moussa");
    const t = st.rows("crm_tasks")[0]; if (!t || t.status !== "open" || t.createdBy !== "u1" || !t.leadId) throw new Error(JSON.stringify(t)); if (st.rows("customers").length !== 2) throw new Error("client créé trop tôt");
  });
  await step("conversion réelle : confirmation, un seul client créé, relance et historique rattachés", async () => {
    await page.getByRole("button", { name: "Convertir en client" }).click(); await page.getByRole("button", { name: /Convertir Moussa Fall en client/ }).click(); await page.getByRole("button", { name: "Convertir", exact: true }).click(); await wait("Converti en client");
    const cs = st.rows("customers"); if (cs.length !== 3 || !cs.some((c) => c.name === "Moussa Fall")) throw new Error(JSON.stringify(cs.map((c) => c.name))); const cu = cs.find((c) => c.name === "Moussa Fall"); if (st.rows("crm_tasks")[0].customerId !== cu.$id) throw new Error("relance non rattachée");
    await page.getByLabel("Fermer").click(); await tab("Clients"); await page.getByLabel("Rechercher un client").fill("Moussa"); await wait("Moussa Fall");
  });
  await step("opportunité depuis la fiche client, pipeline pondéré, gagnée avec auteur et date", async () => {
    await page.getByText("Moussa Fall").first().click(); await page.getByRole("button", { name: "Nouvelle opportunité" }).click(); await page.getByLabel("Intitulé de l'opportunité").fill("50 sacs de riz"); await page.getByLabel("Valeur estimée").fill("1500000"); await page.getByRole("button", { name: "Créer l'opportunité" }).click(); await wait("50 sacs de riz"); await page.getByLabel("Fermer").click();
    await tab("Opportunités"); await wait("50 sacs de riz"); const t = await txt(); if (!/1\s?500\s?000/.test(t) || !/Valeur pondérée/.test(t)) throw new Error(t.slice(0, 600)); await page.getByText("50 sacs de riz").first().click(); await page.getByRole("button", { name: "Marquer gagnée" }).click(); await page.waitForFunction(() => !document.querySelector("[role=dialog]"), null, { timeout: 8000 }); await page.getByRole("button", { name: "Gagnées" }).click(); await wait("Gagné");
    const o = st.rows("crm_opps")[0]; if (o.stage !== "won" || o.closedBy !== "u1" || o.probability !== 100) throw new Error(JSON.stringify(o));
  });
  await step("agenda : relance faite avec résultat, relance suivante créée ; annulation avec motif obligatoire", async () => {
    await tab("Agenda"); await wait("Rappeler Moussa"); await page.getByRole("button", { name: "Faite", exact: true }).first().click(); await page.getByLabel("Résultat").fill("Commande confirmée"); await page.getByLabel("Planifier une relance suivante").check(); await page.getByRole("button", { name: "Marquer comme faite" }).click(); await page.waitForFunction(() => document.body.innerText.includes("Relance : Rappeler Moussa"), null, { timeout: 8000 });
    const ts = st.rows("crm_tasks"); const d = ts.find((t) => t.title === "Rappeler Moussa"); if (d.status !== "done" || d.doneBy !== "u1" || d.outcome !== "Commande confirmée" || ts.length !== 2) throw new Error(JSON.stringify(ts.map((t) => [t.title, t.status])));
    await page.getByRole("button", { name: "Annuler", exact: true }).first().click(); if (!(await page.getByRole("button", { name: "Annuler cette relance" }).isDisabled())) throw new Error("annulation sans motif"); await page.getByLabel("Motif d'annulation").fill("Client injoignable"); await page.getByRole("button", { name: "Annuler cette relance" }).click(); await page.waitForFunction(() => !document.body.innerText.includes("Annuler cette relance"), null, { timeout: 8000 });
    if (!st.rows("crm_tasks").some((t) => t.status === "cancelled" && t.outcome === "Client injoignable")) throw new Error("non annulée");
  });
  await step("tableau de bord : chiffres réels, client inactif à relancer (relance préremplie)", async () => {
    const cid = st.rows("customers").find((c) => c.name === "Autre Awa").$id; await st.create("sales", "sold1", T, { tenantId: T, shopId: A, number: "V-OLD", total: 8000, customerId: cid, cashierId: "u1", status: "paid", payments: "[]", lines: "[]", clientId: "old1", soldAt: new Date(Date.now() - 100 * 864e5).toISOString() });
    await tab("Tableau"); await wait("Clients à relancer (1)"); await wait("Autre Awa"); await wait("Meilleurs clients"); await page.getByRole("button", { name: "Relancer", exact: true }).first().click(); await page.waitForFunction(() => document.querySelector("input[aria-label='Intitulé']")?.value === "Relancer Autre Awa", null, { timeout: 8000 }); await page.getByLabel("Fermer").click();
  });
  await step("onglet Crédit & fidélité : fonctions existantes préservées", async () => { await tab("Crédit & fidélité"); await wait("Créances clients"); });
  await step("Starter : page Clients simple, sans CRM", async () => { st.rows("subscriptions")[0].plan = "starter"; await page.goto(h.url("clients")); await page.reload(); await wait("Créances clients"); await page.waitForFunction(() => ![...document.querySelectorAll("[role=tab]")].some((e) => e.textContent === "Prospects"), null, { timeout: 8000 }); });
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close();
})();
