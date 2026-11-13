const { start } = require("../harness.cjs");
(async () => {
  const h = await start({ plan: "starter" }); const { page, st } = h;
  await page.goto(h.url("stock")); await page.waitForTimeout(1500);
  await page.getByPlaceholder("Nom", { exact: true }).fill("Savon"); await page.getByPlaceholder("Prix de vente").fill("500"); await page.getByPlaceholder("Stock initial").fill("12"); await page.getByRole("button", { name: "Ajouter", exact: true }).click(); await page.waitForTimeout(1800);
  const p = st.rows("products").find((x) => x.name === "Savon"); console.log("produit Starter créé:", !!p, p?.sku);
  await page.goto(h.url("pos")); await page.waitForTimeout(1500); console.log((await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 120));
  console.log(h.errors, h.bad); await h.close();
})();
