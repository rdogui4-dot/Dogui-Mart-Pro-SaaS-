const { start } = require("../harness.cjs");
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n")[0].slice(0, 260)); } };
(async () => {
  const h = await start(); const { page, call, st } = h;
  const txt = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const id = (await call("article.save", { data: { name: "Savon", price: 1000, cost: 500 }, initialQty: 3 }, h.shop)).body.data.id;
  await page.goto(h.url("pos")); await page.waitForTimeout(3000);
  await step("démarrage à froid hors ligne : caisse utilisable avec les produits en cache", async () => {
    await page.waitForTimeout(2500); h.setOffline(true); await page.reload(); await page.waitForTimeout(3500);
    const t = await txt(); if (/Se connecter/.test(t)) throw new Error("écran de connexion hors ligne: " + t.slice(0, 120)); if (!t.includes("Savon")) throw new Error("produits absents: " + t.slice(0, 200));
  });
  await step("vente hors ligne puis refus serveur au retour : visible et traitable", async () => {
    await page.getByText("Savon").first().click(); for (let i = 0; i < 4; i++) await page.getByLabel("Plus").click();
    await page.getByRole("button", { name: /Encaisser/ }).click(); await page.waitForTimeout(1000);
    h.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event("online"))); await page.waitForTimeout(3500);
    const t = await txt(); if (!/vente.? à vérifier/.test(t)) throw new Error("pas de badge: " + t.slice(0, 250));
    await page.goto(h.url("plus")); await page.waitForTimeout(1500); const t2 = await txt(); if (!t2.includes("Stock insuffisant")) throw new Error("motif absent: " + t2.slice(0, 300));
    await page.getByRole("button", { name: "Abandonner" }).click(); await page.getByRole("button", { name: "Abandonner" }).last().click(); await page.waitForTimeout(800);
    if (/Ventes à vérifier/.test(await txt())) throw new Error("vente non retirée");
  });
  console.log("ERRORS", h.errors, "\nBAD", h.bad); await h.close();
})();
