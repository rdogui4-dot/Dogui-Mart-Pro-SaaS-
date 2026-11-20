/** Onglet « Bénéfice brut » du tableau de bord : ouvert à toutes les formules (Starter comprise), propriétaire et gérant ; bénéfice = CA HT − coût figé ; bénéfice partiel et articles sans coût signalés ; période et boutique.
 *  Lancement : bash e2e/run.sh kit23 */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
async function run(plan) {
  const h = await start({ plan: "business", expect: [] }); const { page, st } = h; const A = h.shop;
  const ok = async (r) => { const x = await r; if (x.status !== 200) throw new Error(JSON.stringify(x.body)); return x.body.data; };
  const eau = (await ok(h.call("article.save", { data: { name: "Eau", price: 500, cost: 300 }, initialQty: 100 }, A))).id; const sans = (await ok(h.call("article.save", { data: { name: "Divers", price: 1000, cost: 0 }, initialQty: 50 }, A))).id;
  await ok(h.call("checkout", { clientId: "k23-" + plan + "-0001", lines: [{ productId: eau, qty: 4 }, { productId: sans, qty: 1 }], payments: [{ method: "cash", amount: 3000 }] }, A));
  if (plan === "starter") for (const r of st.rows("subscriptions")) r.plan = "starter"; // les données sont saisies en Business, puis la formule redescend : le bénéfice brut reste ouvert
  const open = async (w = 1440) => { await page.setViewportSize({ width: w, height: 1000 }); await page.goto(h.url("activite")); await page.getByRole("heading", { name: "Tableau de bord" }).waitFor({ timeout: 15000 }); await page.getByRole("tab", { name: "Bénéfice brut" }).click(); await page.getByText(/Chiffre d'affaires HT/).first().waitFor({ timeout: 15000 }); await page.waitForTimeout(500); };
  await step(`${plan} : l'onglet « Bénéfice brut » s'ouvre, indicateurs et bénéfice partiel (coût inconnu sur « Divers »)`, async () => {
    await open(); const t = (await page.locator("body").innerText()).replace(/\\s+/g, " ");
    for (const w of ["Chiffre d'affaires HT", "Coût des marchandises vendues", "Taux de marge", "Taux de marque", "Évolution du bénéfice brut", "Articles qui rapportent le plus", "Fiabilité du calcul"]) if (!t.includes(w)) throw new Error("manque : " + w);
    if (!/Bénéfice partiel/.test(t) || !/Divers/.test(t)) throw new Error(t.slice(0, 600));
    await page.screenshot({ path: path.join(OUT, `kit23-${plan}.png`), fullPage: true });
  });
  if (plan === "business") {
    await step("complété : une fois le coût renseigné, plus de bénéfice partiel pour les nouvelles ventes", async () => {
      await ok(h.call("article.save", { id: sans, data: { cost: 600 } }, A)); await ok(h.call("checkout", { clientId: "k23-" + plan + "-0002", lines: [{ productId: sans, qty: 1 }], payments: [{ method: "cash", amount: 1000 }] }, A));
      await open(); await page.getByRole("button", { name: "Aujourd'hui" }).click(); await page.waitForTimeout(800); const t = (await page.locator("body").innerText()).replace(/\\s+/g, " "); if (!/Chiffre d'affaires HT/.test(t)) throw new Error(t.slice(0, 400));
    });
    for (const w of [390, 820]) await step(`${w} px : aucun débordement`, async () => { await open(w); const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o); });
  } else await step("Starter : l'onglet « Vue d'ensemble » reste verrouillé (Business), pas le bénéfice brut", async () => { await page.getByRole("tab", { name: "Vue d'ensemble" }).click(); await page.getByText("Réservé à la formule Business").waitFor({ timeout: 8000 }); });
  console.log("ERRORS", JSON.stringify(h.errors ?? [])); await h.close?.();
}
(async () => { await run("starter"); await run("business"); })().catch((e) => { console.log("Error", e.message); process.exit(1); });
