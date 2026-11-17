/** Caisse : saisie du bon d'achat / avoir. Cas 1 : le bon couvre le prix → aucune autre saisie. Cas 2 : le bon est inférieur au prix → le reliquat va dans le champ montant. Lancement : bash e2e/run.sh bon-caisse */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
(async () => {
  const h = await start({ plan: "pro", expect: [] }); const { page, st } = h; const A = h.shop;
  const riz = (await h.call("article.save", { data: { name: "Riz local 5 kg", price: 5000, cost: 4000, category: "Alimentaire" }, initialQty: 30 }, A)).body.data.id;
  await h.call("article.save", { data: { name: "Eau minérale", price: 500, cost: 300, category: "Boissons" }, initialQty: 50 }, A);
  const avoir = async (amount) => { const s = (await h.call("checkout", { clientId: "bc" + Math.random().toString(36).slice(2, 12), lines: [{ productId: riz, qty: 1 }], payments: [{ method: "cash", amount: 5000 }] }, A)).body.data;
    const r = (await h.call("sale.refund", { returnId: "rt-bc-" + Math.random().toString(36).slice(2, 10), saleId: s.saleId, kind: "refund", reason: "Avoir de test", lines: [{ index: 0, qty: 1 }], refunds: [{ method: "voucher", amount: 5000 }] }, A)).body.data; const code = r.vouchers[0].code;
    if (amount < 5000) { const use = 5000 - amount; await h.call("checkout", { clientId: "bu" + Math.random().toString(36).slice(2, 12), lines: [{ productId: riz, qty: 1 }], payments: [{ method: "voucher", amount: use, reference: code }, { method: "cash", amount: 5000 - use }] }, A); }
    return code; };
  const big = await avoir(5000), small = await avoir(3000); // bon de 5 000 F, bon dont il reste 3 000 F
  const open = async () => { await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("pos")); await page.waitForSelector("text=Eau minérale", { timeout: 15000 }); await page.waitForTimeout(700); };
  const tile = (n) => page.locator("button.d3-tile", { hasText: n }).first();
  const methods = () => page.locator('select[aria-label^="Moyen de paiement"]').evaluateAll((els) => els.map((e) => e.value));
  const amounts = () => page.locator('input[aria-label^="Montant "]').evaluateAll((els) => els.map((e) => e.value));

  await step("cas 1 : bon de 5 000 F pour un article à 5 000 F → le bon couvre tout, aucune autre ligne ni montant à saisir, vente encaissée", async () => {
    await open(); await tile("Riz local").click(); await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press("F7"); await page.waitForTimeout(300);
    await page.getByLabel("Code du bon 1").fill(big); await page.waitForFunction(() => /couvre le total/.test(document.body.innerText), null, { timeout: 8000 });
    if ((await methods()).join(",") !== "voucher" || (await amounts()).join(",") !== "5000") throw new Error(`${await methods()} / ${await amounts()}`);
    await page.screenshot({ path: path.join(OUT, "bon-caisse-cas1.png") });
    const before = new Set(st.rows("sales").map((x) => x.$id)); await page.getByRole("button", { name: /Encaisser 5\s?000 FCFA/ }).click(); await page.getByRole("button", { name: "Valider la vente" }).click(); await page.waitForTimeout(2500);
    const created = st.rows("sales").filter((x) => !before.has(x.$id)); const pays = created.length === 1 ? JSON.parse(created[0].payments) : []; if (pays.length !== 1 || pays[0].method !== "voucher" || pays[0].amount !== 5000) throw new Error(created.length + " " + JSON.stringify(pays));
  });
  await step("cas 2 : bon de 3 000 F pour un article à 5 000 F → 3 000 F appliqués, reliquat de 2 000 F placé dans le champ montant (espèces)", async () => {
    await open(); await tile("Riz local").click(); await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press("F7"); await page.waitForTimeout(300);
    await page.getByLabel("Code du bon 1").fill(small); await page.waitForFunction(() => /reliquat de 2\s?000/.test(document.body.innerText), null, { timeout: 8000 });
    if ((await methods()).join(",") !== "voucher,cash" || (await amounts()).join(",") !== "3000,2000") throw new Error(`${await methods()} / ${await amounts()}`);
    await page.screenshot({ path: path.join(OUT, "bon-caisse-cas2.png") });
    const before = new Set(st.rows("sales").map((x) => x.$id)); await page.getByRole("button", { name: /Encaisser 5\s?000 FCFA/ }).click(); await page.getByRole("button", { name: "Valider la vente" }).click(); await page.waitForTimeout(2500); const c2 = st.rows("sales").filter((x) => !before.has(x.$id)); const pays = c2.length === 1 ? JSON.parse(c2[0].payments).map((p) => `${p.method}:${p.amount}`).join(",") : `${c2.length} vente(s)`; if (pays !== "voucher:3000,cash:2000") throw new Error(pays);
  });
  await step("bon épuisé : refusé avec son motif, aucun montant appliqué", async () => {
    await open(); await tile("Eau minérale").click(); await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press("F7"); await page.waitForTimeout(300);
    await page.getByLabel("Code du bon 1").fill(big); await page.waitForFunction(() => /Bon inutilisable|épuisé|introuvable|inconnu/i.test(document.body.innerText), null, { timeout: 8000 }).catch(async () => { throw new Error((await page.getByRole("region", { name: "Encaissement" }).innerText()).slice(0, 300)); }); if ((await amounts())[0] !== "") throw new Error("montant appliqué malgré le refus");
  });
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
