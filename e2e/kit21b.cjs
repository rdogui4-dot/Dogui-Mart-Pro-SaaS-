/** K21 — modification d'un bon de réception : un brouillon se modifie (quantités, bon de livraison, date, notes) sans stock créé ; une réception validée se corrige (bon de livraison, date, notes) avec motif,
 *  stock et quantités inchangés, avant/après dans l'historique. Lancement : bash e2e/run.sh kit21b */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
(async () => {
  const h = await start({ plan: "business", expect: [] }); const { page, st } = h; const A = h.shop;
  const sup = (await h.call("purch.supplier.save", { name: "Grossiste Central", leadDays: 4 }, A)).body.data.id;
  const riz = (await h.call("article.save", { data: { name: "Riz 5 kg", price: 1000, cost: 700 }, initialQty: 10 }, A)).body.data.id;
  const po = (await h.call("purch.po.save", { clientId: "k21b" + Math.random().toString(36).slice(2, 10), supplierId: sup, lines: [{ productId: riz, qty: 20, unitPrice: 700 }] }, A)).body.data; await h.call("purch.po.validate", { id: po.id }, A);
  const draft = (await h.call("purch.receipt.save", { clientId: "k21br" + Math.random().toString(36).slice(2, 10), poId: po.id, deliveryNote: "BL-100", lines: [{ productId: riz, accepted: 5 }] }, A)).body.data;
  const stock = () => st.rows("stock_moves").filter((m) => m.productId === riz).reduce((a, m) => a + Number(m.qty), 0);
  const open = async (bl = "BL-100", w = 1440) => { await page.setViewportSize({ width: w, height: 1000 }); await page.goto(h.url("achats")); await page.getByRole("heading", { name: /Achats & Fournisseurs/ }).waitFor({ timeout: 15000 }); await page.getByRole("tab", { name: /^Réceptions/ }).click(); await page.waitForTimeout(600); await page.getByText(bl).first().waitFor({ timeout: 10000 }); };

  await step("brouillon : bouton « Modifier », formulaire prérempli (bon de livraison et quantité acceptée)", async () => {
    await open(); await page.getByText("BL-100").first().click(); const sh = page.getByRole("dialog").last(); await sh.getByRole("button", { name: "Modifier", exact: true }).waitFor({ timeout: 10000 });
    await sh.getByRole("button", { name: "Modifier", exact: true }).click(); await page.getByRole("heading", { name: /Modifier la réception/ }).waitFor({ timeout: 10000 });
    if ((await page.getByLabel("Numéro du bon de livraison").inputValue()) !== "BL-100" || (await page.getByLabel("Acceptée Riz 5 kg").inputValue()) !== "5") throw new Error("préremplissage");
  });
  await step("modification enregistrée : bon de livraison BL-101, quantité 8, notes ; aucun stock créé tant que non validé", async () => {
    await page.getByLabel("Numéro du bon de livraison").fill("BL-101"); await page.getByLabel("Acceptée Riz 5 kg").fill("8"); await page.getByLabel("Notes").fill("Camion en retard");
    await page.getByRole("button", { name: "Enregistrer les modifications" }).click(); await page.waitForTimeout(1500);
    const r = st.rows("purchase_receipts").find((x) => x.$id === draft.id); if (r.deliveryNote !== "BL-101" || !/Camion/.test(String(r.notes)) || JSON.parse(r.lines)[0].accepted !== 8) throw new Error(JSON.stringify(r)); if (r.status !== "draft") throw new Error("statut " + r.status); if (stock() !== 10) throw new Error("stock créé par un brouillon : " + stock());
  });
  await step("validation, puis « Corriger le document » : motif obligatoire, bon de livraison corrigé, quantités et stock inchangés", async () => {
    await h.call("purch.receipt.validate", { id: draft.id }, A); const s0 = stock(); if (s0 !== 18) throw new Error("stock après validation : " + s0);
    await open("BL-101"); await page.getByText("BL-101").first().click(); const sh = page.getByRole("dialog").last(); await sh.getByRole("button", { name: "Corriger le document" }).click(); await page.getByRole("heading", { name: /^Corriger BR-/ }).waitFor({ timeout: 10000 });
    const save = page.getByRole("button", { name: "Enregistrer la correction" }); if (!(await save.isDisabled())) throw new Error("bouton actif sans modification ni motif");
    await page.getByLabel("Numéro du bon de livraison").fill("BL-101-B"); if (!(await save.isDisabled())) throw new Error("bouton actif sans motif"); await page.getByLabel("Motif de la correction").fill("Numéro lu sur le mauvais bon");
    if (!/Les quantités ne se modifient pas ici/.test(await page.getByRole("dialog").last().innerText())) throw new Error("explication sur les quantités absente");
    await save.click(); await page.waitForTimeout(1500); const r = st.rows("purchase_receipts").find((x) => x.$id === draft.id); if (r.deliveryNote !== "BL-101-B" || JSON.parse(r.lines)[0].accepted !== 8 || r.status !== "validated") throw new Error(JSON.stringify(r)); if (stock() !== s0) throw new Error("stock modifié par la correction");
    const ev = st.rows("purchase_events").find((e) => e.kind === "amend" && e.entityId === draft.id); if (!ev || !/BL-101"/.test(String(ev.detail)) || !/Numéro lu sur le mauvais bon/.test(String(ev.detail))) throw new Error("historique : " + JSON.stringify(ev));
    await page.screenshot({ path: path.join(OUT, "kit21b-reception-1440.png") });
  });
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
