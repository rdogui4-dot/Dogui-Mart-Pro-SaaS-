/** Lot K2 (kit 24 interfaces) : Tableau de bord (écran 08) — indicateurs à pastille, évolution des ventes, encart MASTER sur l'état réel de la licence, répartition, top 5, activités récentes, raccourcis, responsive. Lancement : bash e2e/run.sh kit2 */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
(async () => {
  const h = await start({ plan: "pro", expect: [] }); const { page, st } = h; const A = h.shop;
  const id = (n, p, c) => h.call("article.save", { data: { name: n, price: p, cost: c, category: "Boissons" }, initialQty: 100 }, A).then((r) => r.body.data.id);
  const eau = await id("Eau minérale", 500, 300), jus = await id("Jus de bissap", 1000, 600), the = await id("Thé glacé", 800, 500);
  for (let d = 0; d < 8; d++) await h.call("checkout", { clientId: "k" + d + Math.random().toString(36).slice(2, 9), lines: [{ productId: eau, qty: d + 2 }, { productId: jus, qty: 1 }, ...(d % 2 ? [{ productId: the, qty: 1 }] : [])], payments: [{ method: "cash", amount: (d + 2) * 500 + 1000 + (d % 2 ? 800 : 0) }], soldAt: new Date(Date.now() - d * 864e5).toISOString() }, A);
  const open = async (w = 1280, hh = 900) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url("activite")); await page.waitForSelector("text=CA du jour", { timeout: 15000 }); await page.waitForTimeout(1500); };

  await step("indicateurs : 4 cartes à pastille (CA du jour, CA du mois, articles actifs, panier moyen), valeurs réelles", async () => {
    await open(); const ind = page.getByRole("region", { name: "Indicateurs", exact: true });
    const t = await ind.innerText(); for (const x of ["CA du jour", "CA du mois", "Articles actifs", "Panier moyen"]) if (!t.includes(x)) throw new Error("absent : " + x);
    if (!/CA du jour\s+2\s?000 FCFA/.test(t)) throw new Error("CA du jour : " + t.slice(0, 200)); if ((await ind.locator(".d3-flip").count()) !== 4) throw new Error("nombre de cartes");
  });
  await step("évolution des ventes, répartition par mode de paiement, top 5 classé, activités récentes", async () => {
    if (!(await page.getByRole("region", { name: "Évolution des ventes" }).locator("svg").count())) throw new Error("graphique d'évolution absent");
    const rep = await page.getByRole("region", { name: "Répartition du chiffre d'affaires" }).innerText(); if (!/Espèces/.test(rep)) throw new Error("répartition : " + rep.slice(0, 200));
    const first = await page.getByRole("region", { name: "Top 5 des articles vendus" }).locator("li").first().innerText(); if (!/Eau minérale/.test(first)) throw new Error("top 1 : " + first);
    const feed = page.getByRole("region", { name: "Activités récentes" }); if ((await feed.locator("li").count()) < 1) throw new Error("activité vide");
    await page.screenshot({ path: path.join(OUT, "kit2-dashboard-1280.png"), fullPage: true });
  });
  await step("raccourcis réels du kit (vente, article, commande, client, rapports)", async () => {
    const r = await page.getByRole("region", { name: "Raccourcis" }).innerText(); for (const x of ["Nouvelle vente", "Ajouter un article", "Passer une commande", "Ajouter un client", "Voir les rapports"]) if (!r.includes(x)) throw new Error("absent : " + x);
    await page.getByRole("region", { name: "Raccourcis" }).getByRole("link", { name: /Passer une commande/ }).click(); await page.waitForURL(/\/achats/, { timeout: 5000 });
  });
  await step("MASTER sans licence : aucune réponse simulée, bouton vers la licence", async () => {
    await open(); const m = page.getByRole("region", { name: "MASTER DOGUI" }); await m.waitFor({ timeout: 5000 }); await page.waitForTimeout(800);
    if (await m.getByRole("textbox").count()) throw new Error("zone de question sans licence"); const b = m.getByRole("button", { name: /essai gratuit|Voir la licence/ }); await b.click();
    await page.waitForURL(/\/master\?onglet=lic/, { timeout: 8000 }); await page.getByRole("tab", { name: "Licence", selected: true }).waitFor({ timeout: 5000 });
  });
  await step("MASTER avec essai actif : la question est préparée dans l'assistant (envoyée par l'utilisateur)", async () => {
    st.rows("shops").forEach((s) => { s.phone = "0701020304"; }); const r = await h.call("md.trial.start", {}, A); if (r.status >= 400) throw new Error("essai : " + JSON.stringify(r.body));
    await open(); const m = page.getByRole("region", { name: "MASTER DOGUI" }); await m.getByRole("textbox").waitFor({ timeout: 8000 });
    if (!/Essai|Licence active/.test(await m.innerText())) throw new Error("état de licence absent");
    await m.getByRole("textbox").fill("Quels articles dois-je réapprovisionner ?"); await m.getByRole("button", { name: "Préparer la question dans l'assistant" }).click();
    await page.waitForURL(/\/master\?onglet=chat/, { timeout: 8000 }); await page.getByRole("tab", { name: "Assistant", selected: true }).waitFor({ timeout: 5000 }); await page.waitForTimeout(1200);
    const vals = await page.locator("main").locator("textarea, input[type=text], input:not([type])").evaluateAll((els) => els.map((e) => e.value)); if (!vals.some((v) => /réapprovisionner/.test(v))) throw new Error("question non préparée : " + JSON.stringify(vals));
    await page.screenshot({ path: path.join(OUT, "kit2-master-1280.png") }); await open(); await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, "kit2-dashboard-master-1280.png") });
  });
  for (const [w, theme] of [[1600, "light"], [820, "light"], [390, "light"], [1280, "dark"]]) await step(`${w} px ${theme} : aucun débordement horizontal (captures)`, async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("accueil")); await page.evaluate((t) => localStorage.setItem("dmp-theme", t), theme); await open(w);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o);
    await page.screenshot({ path: path.join(OUT, `kit2-dashboard-${theme}-${w}.png`), fullPage: true });
  });
  await page.evaluate(() => localStorage.setItem("dmp-theme", "light"));
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
