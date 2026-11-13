const { start } = require("../harness.cjs");
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n")[0].slice(0, 260)); } };
(async () => {
  const h = await start(); const { page, st } = h;
  const txt = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
  await page.goto(h.url("reglages")); await page.waitForTimeout(1500);
  await step("boutiques: création", async () => { await page.getByRole("button", { name: "Boutiques" }).click(); await page.waitForTimeout(600); console.log("  ", (await txt()).slice(0, 220)); });
  await step("équipe: création d'un caissier", async () => {
    await page.getByRole("button", { name: /Équipe/ }).click(); await page.waitForTimeout(800); const t = await txt(); console.log("  ", t.slice(0, 260));
    const ph = await page.locator("main input, main select").evaluateAll((e) => e.map((x) => x.placeholder || x.getAttribute("aria-label") || x.tagName)); console.log("  ", JSON.stringify(ph));
  });
  await step("abonnement: affichage des formules", async () => { await page.getByRole("button", { name: "Abonnement" }).click(); await page.waitForTimeout(1200); const t = await txt(); if (!/Pro/.test(t)) throw new Error(t.slice(0, 200)); console.log("  ", t.slice(0, 260)); });
  console.log("ERRORS", h.errors, "\nBAD", h.bad); await h.close();
})();
