const { start } = require("../harness.cjs");
(async () => {
  const h = await start(); const { page, call, st } = h;
  const mk = async (name, extra = {}, qty = 0) => (await call("article.save", { data: { name, price: 1000, cost: 500, ...extra }, ...(qty ? { initialQty: qty } : {}) }, h.shop)).body.data.id;
  await mk("Savon", {}, 20); await mk("Yaourt", { tracking: "lot" }); await mk("Tel", { tracking: "serial" });
  await page.goto(h.url("bundles")); await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /Nouveau bundle/ }).click(); await page.waitForTimeout(500);
  console.log(await page.getByLabel("Composant").first().locator("option").allInnerTexts());
  console.log(h.errors);
  await h.close();
})();
