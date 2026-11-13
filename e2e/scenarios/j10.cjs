const { start } = require("../harness.cjs");
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n")[0].slice(0, 260)); } };
(async () => {
  const h = await start(); const { page, call, st } = h;
  const jus = (await call("article.save", { data: { name: "Jus", price: 1000, cost: 500 }, initialQty: 10 }, h.shop)).body.data.id;
  const txt = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
  await step("ticket PDF après vente", async () => {
    await page.goto(h.url("pos")); await page.waitForTimeout(1500); await page.getByText("Jus").first().click(); await page.getByRole("button", { name: /Encaisser/ }).click(); await page.waitForTimeout(2000);
    const dl = page.waitForEvent("download", { timeout: 8000 }).catch(() => null); await page.getByRole("button", { name: /Ticket PDF/ }).click(); const d = await dl; if (!d) throw new Error("pas de téléchargement (ni partage)"); const n = d.suggestedFilename(); if (!/\.pdf$/.test(n)) throw new Error(n);
  });
  await step("compta: facture libre + rapport", async () => {
    await page.goto(h.url("compta")); await page.waitForTimeout(1500); console.log((await txt()).slice(0, 200));
    await page.getByRole("button", { name: "Rapports" }).first().click(); await page.waitForTimeout(1800); const t = await txt(); if (!/Chiffre|CA|Ventes/i.test(t)) throw new Error(t.slice(0, 300));
  });
  console.log("ERRORS", h.errors, "\nBAD", h.bad); await h.close();
})();
