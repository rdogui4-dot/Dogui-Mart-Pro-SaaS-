/** Captures d'écran de référence (téléphone 390 px) : node e2e/shots.cjs <étiquette> [clair|sombre]. Sorties : e2e/out/shots/<étiquette>/*.png */
const fs = require("fs"), path = require("path");
const { start } = require("./harness.cjs");
(async () => {
  const label = process.argv[2] || "avant"; const theme = process.argv[3] || "";
  const dir = path.join(__dirname, "out", "shots", label); fs.mkdirSync(dir, { recursive: true });
  const h = await start({ plan: "pro" }); const { page } = h; const A = h.shop;
  if (theme) await page.addInitScript((t) => { try { localStorage.setItem("dmp-theme", t === "clair" ? "light" : "dark"); } catch {} }, theme);
  const eau = (await h.call("article.save", { data: { name: "Eau minérale 1,5 l", price: 500, cost: 300, minStock: 10 }, initialQty: 50 }, A)).body.data.id;
  const riz = (await h.call("article.save", { data: { name: "Riz parfumé 5 kg", price: 4500, cost: 3800, minStock: 5 }, initialQty: 3 }, A)).body.data.id;
  await h.call("article.save", { data: { name: "Huile 1 l", price: 1500, cost: 1100 }, initialQty: 20 }, A);
  await h.call("cash.open", { openingFloat: 5000 }, A);
  await h.call("checkout", { clientId: "shot-0001", lines: [{ productId: eau, qty: 4 }, { productId: riz, qty: 1 }], payments: [{ method: "cash", amount: 6500 }] }, A);
  const pages = ["accueil", "plus", "pos", "stock", "articles", "ventes", "caisse", "activite", "reglages", "master"];
  for (const p of pages) { try { await page.goto(h.url(p)); await page.waitForTimeout(1800); await page.screenshot({ path: path.join(dir, p + ".png") }); } catch (e) { console.log("KO", p, String(e.message).slice(0, 80)); } }
  await h.close?.(); process.exit(0);
})();
