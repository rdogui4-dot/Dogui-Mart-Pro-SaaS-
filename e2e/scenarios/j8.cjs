const { start } = require("../harness.cjs");
(async () => {
  for (const plan of ["starter", "business"]) {
    const h = await start({ plan }); const { page, call } = h;
    await call("article.save", { data: { name: "Savon", price: 1000, cost: 500 }, initialQty: 5 }, h.shop);
    for (const r of ["accueil", "pos", "stock", "articles", "bundles", "tableau", "achats", "reglages"]) {
      await page.goto(h.url(r)); await page.waitForTimeout(1500); const t = (await page.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 110); console.log(plan.padEnd(9), r.padEnd(9), "|", t);
    }
    console.log("ERRORS", h.errors, "BAD", h.bad); await h.close();
  }
})();
