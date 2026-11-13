const { start } = require("../harness.cjs");
(async () => {
  const h = await start({ plan: "business" }); const { page, call } = h;
  await call("article.save", { data: { name: "Eau", price: 500, cost: 300, category: "Boissons" }, initialQty: 50 }, h.shop);
  await page.goto(h.url("promotions")); await page.waitForTimeout(1500);
  console.log("BTN", await page.getByRole("button").evaluateAll((e) => e.map((x) => x.textContent.trim()).slice(0, 12)));
  await page.getByRole("button", { name: /Nouvelle promotion/ }).click({ timeout: 4000 }).catch((e) => console.log("click fail", e.message.split("\n")[0]));
  await page.waitForTimeout(800); console.log("DIALOG", (await page.locator("[role=dialog]").count()), await page.locator("[role=dialog] label").evaluateAll((e) => e.map((x) => x.textContent.slice(0, 40)).slice(0, 8)));
  console.log(h.errors); await h.close();
})();
