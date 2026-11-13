const { start } = require("../harness.cjs");
(async () => {
  const h = await start(); const { page, call } = h;
  await call("article.save", { data: { name: "Savon", price: 1000, cost: 500 }, initialQty: 30 }, h.shop); await call("shop.create", { name: "Thiès" });
  await page.goto(h.url("stock")); await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /Transférer vers/ }).click(); await page.waitForTimeout(300);
  const sels = await page.locator("main select").evaluateAll((els) => els.map((e) => [...e.options].map((o) => o.textContent)));
  console.log(JSON.stringify(sels)); await h.close();
})();
