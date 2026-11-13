const { start } = require("../harness.cjs");
(async () => {
  const h = await start(); const { page, call } = h;
  await call("article.save", { data: { name: "Tee-shirt", price: 5000, cost: 3000 } }, h.shop);
  await page.goto(h.url("articles")); await page.waitForTimeout(1500);
  console.log("PLACEHOLDERS", await page.locator("input").evaluateAll((e) => e.map((x) => x.placeholder || x.getAttribute("aria-label"))));
  await page.getByText("Tee-shirt").first().click(); await page.waitForTimeout(800);
  console.log("BUTTONS", await page.locator("[role=dialog] button").evaluateAll((e) => e.map((x) => x.textContent.trim()).filter(Boolean)));
  await page.getByRole("button", { name: /Gérer/ }).first().click(); await page.waitForTimeout(500);
  console.log("BUTTONS2", await page.locator("[role=dialog] button").evaluateAll((e) => e.map((x) => x.textContent.trim()).filter(Boolean)));
  await h.close();
})();
