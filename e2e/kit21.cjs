/** Lot K21 (kit écran 08, second passage) : tableau de bord — variations réelles sur les indicateurs (aucun écart sans période de référence), « Clients actifs »,
 *  courbe 7 jours / 30 jours / mois en cours avec la période précédente en pointillé, responsive. Lancement : bash e2e/run.sh kit21 */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
const ago = (d, h = 0) => new Date(Date.now() - d * 864e5 - h * 3600e3).toISOString();
(async () => {
  const h = await start({ plan: "business", expect: [] }); const { page, st } = h; const A = h.shop; const T = st.rows("shops")[0].tenantId;
  let n = 0; const sale = (total, soldAt, customerId) => st.create("sales", `s-k21-${++n}-xxxx`, T, { tenantId: T, shopId: A, number: `V-${n}`, total, vat: 0, status: "paid", soldAt, payments: JSON.stringify([{ method: "cash", amount: total }]), lines: JSON.stringify([{ productId: "p1", name: "Riz 25 kg", qty: 1, unitPrice: total, amount: total }]), clientId: `s-k21-${n}-xxxx`, ...(customerId ? { customerId } : {}) });
  await sale(6000, ago(0, 0.1), "c1"); await sale(4000, ago(1, 0.2), "c1"); await sale(9000, ago(1, -5)); await sale(3000, ago(3), "c2"); await sale(2000, ago(40), "c3"); await sale(2000, ago(10)); await sale(2000, ago(11));
  const open = async (w = 1440, hh = 1000) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url("activite")); await page.getByRole("region", { name: "Indicateurs", exact: true }).waitFor({ timeout: 15000 }); await page.waitForTimeout(800); };
  const kpi = () => page.getByRole("region", { name: "Indicateurs", exact: true }).innerText();

  await step("indicateurs : variation réelle du CA du jour vs hier à la même heure (+50 %), clients actifs (2) avec écart, panier moyen comparé ; « Articles actifs » passé dans les détails", async () => {
    await open(); const t = (await kpi()).replace(/\s+/g, " ");
    if (!/CA du jour.*\+50 %.*vs hier à la même heure/.test(t)) throw new Error(t.slice(0, 400)); if (!/Clients actifs 2/.test(t) || !/vs 30 jours précédents/.test(t)) throw new Error("clients actifs : " + t.slice(0, 500)); if (!/Panier moyen.*vs /.test(t)) throw new Error("panier moyen sans écart");
    if (/Articles actifs/.test(t)) throw new Error("Articles actifs encore en tête"); if (!/Articles actifs/.test(await page.getByRole("region", { name: "Indicateurs détaillés" }).innerText())) throw new Error("Articles actifs absent des détails");
    await page.screenshot({ path: path.join(OUT, "kit21-tableau-1440.png"), fullPage: true });
  });
  await step("courbe : 3 périodes (7 jours, 30 jours, mois en cours), pointillé de la période précédente quand elle existe", async () => {
    const g = page.getByRole("group", { name: "Période de la courbe" }); for (const l of ["7 jours", "30 jours", "Mois en cours"]) if (!(await g.getByRole("button", { name: l }).count())) throw new Error("bouton " + l);
    if ((await g.getByRole("button", { name: "30 jours" }).getAttribute("aria-pressed")) !== "true") throw new Error("30 jours non présélectionné");
    const sec = page.getByRole("region", { name: "Évolution des ventes" }); if (!/30 derniers jours/.test(await sec.innerText())) throw new Error("libellé 30 jours");
    await g.getByRole("button", { name: "7 jours" }).click(); await page.waitForTimeout(300); if (!/7 derniers jours/.test(await sec.innerText()) || !/en pointillé/.test(await sec.innerText())) throw new Error("7 jours / pointillé");
    if (!(await sec.locator("svg [stroke-dasharray]").count())) throw new Error("tracé en pointillé absent");
    await g.getByRole("button", { name: "Mois en cours" }).click(); await page.waitForTimeout(300); if (!/mois en cours/.test(await sec.innerText())) throw new Error("mois en cours");
  });
  await step("aucun écart inventé : sans période de référence, aucune variation affichée", async () => {
    const g2 = await start({ plan: "business", expect: [] }); const p2 = g2.page; const T2 = g2.st.rows("shops")[0].tenantId;
    await g2.st.create("sales", "only-today-0001", T2, { tenantId: T2, shopId: g2.shop, number: "V-1", total: 5000, vat: 0, status: "paid", soldAt: ago(0, 0.1), payments: JSON.stringify([{ method: "cash", amount: 5000 }]), lines: "[]", clientId: "only-today-0001" });
    await p2.setViewportSize({ width: 1440, height: 1000 }); await p2.goto(g2.url("activite")); await p2.getByRole("region", { name: "Indicateurs", exact: true }).waitFor({ timeout: 15000 }); await p2.waitForTimeout(800);
    const t = (await p2.getByRole("region", { name: "Indicateurs", exact: true }).innerText()).replace(/\s+/g, " "); if (/▲|▼|vs hier|vs 30 jours/.test(t)) throw new Error("écart affiché sans référence : " + t.slice(0, 300)); if (!/Clients actifs 0/.test(t)) throw new Error("clients actifs");
    await g2.close();
  });
  for (const [w, theme] of [[1600, "light"], [820, "light"], [390, "light"], [1280, "dark"]]) await step(`${w} px ${theme} : aucun débordement (captures)`, async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("accueil")); await page.evaluate((t) => localStorage.setItem("dmp-theme", t), theme); await open(w, 900);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o); await page.screenshot({ path: path.join(OUT, `kit21-${theme}-${w}.png`), fullPage: true });
  });
  await page.evaluate(() => localStorage.setItem("dmp-theme", "light"));
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
