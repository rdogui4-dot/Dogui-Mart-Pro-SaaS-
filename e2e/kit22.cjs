/** Numéros de série à quantité : un numéro porte une quantité (« NUMERO:24 »), la vente en prélève une partie (le numéro reste disponible avec le restant), le retour la restitue.
 *  Écran « Numéros de série » (quantité restante / reçue, saisie avec quantité), reçu de retour avec la quantité du numéro. Lancement : bash e2e/run.sh kit22 */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
(async () => {
  const h = await start({ plan: "pro", expect: [] }); const { page, st } = h; const A = h.shop;
  const ok = async (r) => { const x = await r; if (x.status !== 200) throw new Error(JSON.stringify(x.body)); return x.body.data; };
  const art = (await ok(h.call("article.save", { data: { name: "Carton de piles", price: 1000, cost: 600, sku: "PIL", barcode: "PIL0", tracking: "serial" } }, A))).id;
  await ok(h.call("serial.add", { productId: art, serials: "LOT-A:24 LOT-B:6 UNIT-1" }, A));
  const open = async (w = 1440) => { await page.setViewportSize({ width: w, height: 1000 }); await page.goto(h.url("articles")); await page.getByText("Carton de piles").first().click(); await page.getByRole("button", { name: "Numéros de série" }).click(); await page.getByRole("heading", { name: /Numéros de série · Carton de piles/ }).waitFor({ timeout: 15000 }); await page.waitForTimeout(600); };

  await step("liste : quantité restante / reçue par numéro, total d'unités disponibles (31)", async () => {
    await open(); const t = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    if (!/31 unité\(s\) disponible\(s\)/.test(t) || !/24 \/ 24/.test(t) || !/6 \/ 6/.test(t)) throw new Error(t.slice(0, 500));
  });
  await step("vente de 5 unités : le numéro LOT-A reste disponible avec 19 / 24 ; total 26", async () => {
    await ok(h.call("checkout", { clientId: "k22-vente-0001", lines: [{ productId: art, qty: 5 }], payments: [{ method: "cash", amount: 5000 }] }, A));
    await open(); const t = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    if (!/26 unité\(s\) disponible\(s\)/.test(t) || !/19 \/ 24/.test(t)) throw new Error(t.slice(0, 500));
    await page.screenshot({ path: path.join(OUT, "kit22-series.png") });
  });
  await step("ajout depuis l'écran : « NUMERO:quantité » et quantité par numéro, total d'unités annoncé", async () => {
    await page.getByRole("button", { name: "Ajouter des numéros" }).click();
    await page.getByLabel("Un numéro par ligne (ou séparés par espace / virgule)").fill("NEW-1:10\nNEW-2"); await page.getByLabel("Quantité par numéro").fill("3");
    const hint = await page.getByText(/unité\(s\) au total/).innerText(); if (!/2 numéro\(s\).*13 unité\(s\)/.test(hint)) throw new Error(hint);
    await page.getByRole("button", { name: "Enregistrer" }).click(); await page.getByText("Ajouter des numéros de série").waitFor({ state: "hidden", timeout: 8000 }); await page.getByText("39 unité(s) disponible(s)").waitFor({ timeout: 8000 });
    const t = (await page.locator("body").innerText()).replace(/\s+/g, " "); if (!/39 unité\(s\) disponible\(s\)/.test(t) || !/10 \/ 10/.test(t) || !/3 \/ 3/.test(t)) throw new Error(t.slice(t.indexOf("Numéros de série"), t.indexOf("Numéros de série") + 700));
  });
  await step("retour de la vente : la quantité (5) revient sur LOT-A (24 / 24)", async () => {
    const sale = (await ok(h.call("sales.list", {}, A))).sales[0];
    await ok(h.call("sale.refund", { returnId: "k22-retour-0001", saleId: sale.id, kind: "cancel", reason: "Erreur", refunds: [{ method: "cash", amount: 5000 }] }, A));
    await open(); const t = (await page.locator("body").innerText()).replace(/\s+/g, " "); if (!/24 \/ 24/.test(t) || !/44 unité\(s\) disponible\(s\)/.test(t)) throw new Error(t.slice(0, 500));
  });
  for (const w of [390, 820]) await step(`${w} px : aucun débordement`, async () => { await open(w); const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o); });
  console.log("ERRORS", JSON.stringify(h.errors ?? [])); await h.close?.();
})().catch((e) => { console.log("Error", e.message); process.exit(1); });
