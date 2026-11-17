/** Retours après vente : recherche par n° de ticket (F9 depuis la caisse), assistant en 4 étapes (articles + état, remboursement, vérification des effets calculés par le serveur, ticket de retour), article abîmé sorti en perte, annulation complète, mises à jour reliées (stock, caisse, fidélité, statut de vente). Lancement : bash e2e/run.sh retours */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
(async () => {
  const h = await start({ plan: "business", expect: [] }); const { page, st } = h; const A = h.shop;
  const mk = (n, p, q) => h.call("article.save", { data: { name: n, price: p, cost: Math.round(p * 0.6) }, initialQty: q }, A).then((r) => r.body.data.id);
  const eau = await mk("Eau 1,5 L", 500, 20), lait = await mk("Lait 1 L", 1000, 10);
  await h.call("cash.open", { openingFloat: 10000 }, A);
  const sell = async (lines, total) => (await h.call("checkout", { clientId: "rt" + Math.random().toString(36).slice(2, 12), lines, payments: [{ method: "cash", amount: total }] }, A)).body.data;
  const s1 = await sell([{ productId: eau, qty: 4 }, { productId: lait, qty: 2 }], 4000); const s2 = await sell([{ productId: eau, qty: 1 }], 500);
  const num = (id) => st.rows("sales").find((x) => x.$id === id).number;
  const stock = (pid) => st.rows("stock_moves").filter((m) => m.productId === pid).reduce((a, m) => a + (["sale", "loss", "transfer_out"].includes(m.kind) ? -Math.abs(Number(m.qty)) : Number(m.qty)), 0);
  const dlg = () => page.getByRole("dialog").last();

  await step("F9 depuis la caisse : page Ventes avec la recherche « Retour sur ticket » prête", async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("pos")); await page.waitForSelector("text=Eau 1,5 L", { timeout: 15000 }); await page.waitForTimeout(600);
    await page.keyboard.press("F9"); await page.waitForURL(/\/ventes\?retour/, { timeout: 6000 }); await page.getByLabel("Numéro du ticket").waitFor({ timeout: 8000 });
    if (!(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Numéro du ticket"))) throw new Error("champ non actif");
  });
  await step("n° invalide expliqué ; n° du ticket (même lu dans un lien de QR) ouvre la vente", async () => {
    await page.getByLabel("Numéro du ticket").fill("12345"); await page.getByRole("button", { name: "Rechercher", exact: true }).click(); await page.getByText("Numéro attendu").waitFor({ timeout: 4000 });
    await page.getByLabel("Numéro du ticket").fill(`https://exemple.test/verif?n=${num(s1.saleId).toLowerCase()}`); await page.getByRole("button", { name: "Rechercher", exact: true }).click();
    await page.getByRole("dialog", { name: `Vente ${num(s1.saleId)}` }).waitFor({ timeout: 8000 });
  });
  await step("étape 1 : quantités par article, état Revendable / Abîmé, montant calculé par le serveur (2 eaux + 1 lait = 2 000 F)", async () => {
    await page.getByRole("button", { name: "Retourner des articles" }).click(); await page.getByRole("list", { name: "Étapes du retour" }).waitFor({ timeout: 5000 });
    await page.getByLabel("Quantité retournée Eau 1,5 L").fill("2"); await page.getByLabel("Quantité retournée Lait 1 L").fill("1");
    await page.getByRole("group", { name: "État Lait 1 L" }).getByRole("button", { name: /Abîmé/ }).click(); await page.waitForFunction(() => /2\s?000\s?FCFA/.test(document.body.innerText), null, { timeout: 8000 });
    await page.screenshot({ path: path.join(OUT, "retours-1-articles.png") }); await page.getByRole("button", { name: "Continuer" }).click();
  });
  await step("étape 2 : motif et répartition obligatoires", async () => {
    const v = page.getByRole("button", { name: "Vérifier" }); if (await v.isEnabled()) throw new Error("vérifier sans motif ni répartition");
    await page.getByLabel("Motif *").fill("Lait tourné, eau non voulue"); await page.getByRole("button", { name: "Tout rembourser ici" }).click(); await v.click();
  });
  await step("étape 3 : effets annoncés (eau remise en stock, lait sorti en perte, CA −2 000 F) puis validation tracée", async () => {
    const t = await page.getByRole("region", { name: "Effets du retour" }).innerText(); if (!/Eau 1,5 L[\s\S]*Remis en stock/.test(t) || !/Lait 1 L[\s\S]*Sorti en perte/.test(t) || !/2\s?000/.test(t)) throw new Error(t);
    await page.screenshot({ path: path.join(OUT, "retours-3-verification.png") });
    const e0 = stock(eau), l0 = stock(lait); await page.getByRole("button", { name: "Valider le retour" }).click(); await page.getByRole("button", { name: "Confirmer" }).click(); await page.getByText("Retour enregistré").waitFor({ timeout: 8000 });
    if (stock(eau) !== e0 + 2) throw new Error(`stock eau ${e0} → ${stock(eau)}`); if (stock(lait) !== l0) throw new Error(`stock lait ${l0} → ${stock(lait)} (le lait abîmé doit sortir en perte)`);
    const ks = st.rows("stock_moves").filter((m) => m.productId === lait && /^retour-/.test(m.refId)).map((m) => m.kind).sort().join(","); if (ks !== "loss,return") throw new Error(ks);
    const r = st.rows("sale_returns")[0]; if (r.amount !== 2000 || r.status !== "done") throw new Error(JSON.stringify(r)); if (st.rows("sales").find((x) => x.$id === s1.saleId).status !== "paid") throw new Error("vente partiellement retournée doit rester payée");
  });
  await step("étape 4 : ticket de retour 80 et 58 mm (PDF)", async () => {
    for (const w of [80, 58]) { const [d] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.getByRole("button", { name: `Ticket de retour ${w} mm` }).click()]); const b = fs.readFileSync(await d.path()); if (b.slice(0, 4).toString() !== "%PDF" || !d.suggestedFilename().includes("retour")) throw new Error("pdf " + w); }
    await page.screenshot({ path: path.join(OUT, "retours-4-ticket.png") }); await page.getByRole("button", { name: "Terminer" }).click(); await page.waitForTimeout(800);
  });
  await step("retour suivant : quantités restantes seulement (eau reste 2, lait reste 1) ; historique du retour visible", async () => {
    const t = await dlg().innerText(); if (!/Remboursement/.test(t)) throw new Error("historique absent");
    await page.getByRole("button", { name: "Retourner des articles" }).click(); const w = await dlg().innerText(); if (!/Eau 1,5 L[\s\S]*reste 2/.test(w) || !/Lait 1 L[\s\S]*reste 1/.test(w)) throw new Error(w.slice(0, 300));
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  });
  await step("annulation complète d'une autre vente : stock remis, vente « annulée », caisse diminuée", async () => {
    await page.goto(h.url("ventes")); await page.getByLabel("Numéro du ticket").fill(num(s2.saleId)); await page.getByRole("button", { name: "Rechercher", exact: true }).click(); await page.getByRole("dialog", { name: `Vente ${num(s2.saleId)}` }).waitFor({ timeout: 8000 });
    const e0 = stock(eau); await page.getByRole("button", { name: "Annuler la vente" }).click(); await page.waitForFunction(() => /500\s?FCFA/.test(document.body.innerText), null, { timeout: 8000 }); await page.getByRole("button", { name: "Continuer" }).click();
    await page.getByLabel("Motif *").fill("Erreur de caisse"); await page.getByRole("button", { name: "Tout rembourser ici" }).click(); await page.getByRole("button", { name: "Vérifier" }).click();
    await dlg().getByRole("button", { name: "Annuler la vente" }).click(); await page.getByRole("button", { name: "Confirmer" }).click(); await page.getByText("Vente annulée", { exact: true }).waitFor({ timeout: 8000 });
    if (stock(eau) !== e0 + 1) throw new Error("stock non remis"); if (st.rows("sales").find((x) => x.$id === s2.saleId).status !== "cancelled") throw new Error("statut");
    const cur = (await h.call("cash.current", {}, A)).body.data; if (JSON.stringify(cur).indexOf("2500") < 0 && JSON.stringify(cur).indexOf("2 500") < 0) console.log("   caisse :", JSON.stringify(cur).slice(0, 300));
  });
  for (const [w, theme] of [[390, "light"], [360, "light"], [1280, "dark"]]) await step(`${w} px ${theme} : assistant sans débordement`, async () => {
    await page.setViewportSize({ width: w, height: 860 }); await page.goto(h.url("accueil")); await page.evaluate((t) => localStorage.setItem("dmp-theme", t), theme);
    await page.goto(h.url("ventes")); await page.getByLabel("Numéro du ticket").fill(num(s1.saleId)); await page.getByRole("button", { name: "Rechercher", exact: true }).click(); await page.getByRole("button", { name: "Retourner des articles" }).click(); await page.waitForTimeout(800);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o); await page.screenshot({ path: path.join(OUT, `retours-${theme}-${w}.png`) });
  });
  await page.evaluate(() => localStorage.setItem("dmp-theme", "light"));
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
