const { start } = require("../harness.cjs");
(async () => {
  const h = await start(); const { page, call, st } = h;
  await call("article.save", { data: { name: "Jus", price: 1000, cost: 500 }, initialQty: 10 }, h.shop);
  await page.goto(h.url("pos")); await page.waitForTimeout(1500); await page.getByText("Jus").first().click();
  const btn = page.getByRole("button", { name: /Encaisser/ });
  console.log("désactivé sans montant:", await btn.isDisabled());
  await page.getByLabel("Montant reçu").fill("500"); console.log("désactivé si insuffisant:", await btn.isDisabled(), "|", await page.getByRole("status").innerText());
  await page.getByLabel("Montant reçu").fill("1500"); console.log("actif:", !(await btn.isDisabled()), "|", await page.getByRole("status").innerText());
  await btn.click(); await page.waitForTimeout(2000); console.log("ventes:", st.rows("sales").length, JSON.parse(st.rows("sales")[0].payments));
  await h.close();
})();
