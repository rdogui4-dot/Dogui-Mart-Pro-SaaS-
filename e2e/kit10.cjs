/** Lot K10 (kit 24 interfaces) : Clients CRM (écran 16) — en-tête et « Ajouter un client », 5 indicateurs réels, onglets du kit, segmentation, programme de fidélité réel, évolution de la clientèle, top clients, encart MASTER, responsive. Lancement : bash e2e/run.sh kit10 */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
(async () => {
  const h = await start({ plan: "pro", expect: [] }); const { page } = h; const A = h.shop;
  const riz = (await h.call("article.save", { data: { name: "Riz local 5 kg", price: 5000, cost: 4000, category: "Alimentaire" }, initialQty: 100 }, A)).body.data.id;
  const cust = async (name) => (await h.call("entity.save", { table: "customers", data: { name, phone: "77" + Math.floor(1e6 + Math.random() * 9e6) } }, A)).body.data.id;
  const awa = await cust("Awa Diop"), bara = await cust("Bara Sow"); await cust("Coumba Fall");
  const sell = (customerId, qty) => h.call("checkout", { clientId: "k10" + Math.random().toString(36).slice(2, 12), customerId, lines: [{ productId: riz, qty }], payments: [{ method: "cash", amount: qty * 5000 }] }, A);
  await sell(awa, 4); await sell(awa, 2); await sell(bara, 1);
  const open = async (w = 1440, hh = 1000) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url("clients")); await page.getByRole("heading", { name: "CRM — Clients, Prospects & Fidélisation" }).waitFor({ timeout: 15000 }); await page.waitForTimeout(1500); };

  await step("en-tête du kit, « Ajouter un client » ouvre le formulaire, onglets du kit", async () => {
    await open(); await page.getByRole("button", { name: "Ajouter un client" }).click(); await page.getByRole("dialog").last().waitFor({ timeout: 5000 }); await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    for (const t of ["Liste des clients", "Prospects", "Segmentation", "Fidélité", "Communications", "Analyses"]) if (!(await page.getByRole("tab", { name: t, exact: true }).count())) throw new Error("onglet " + t);
  });
  await step("5 indicateurs réels : 2 clients actifs, 3 nouveaux, panier moyen 11 667 F, CA clients 35 000 F", async () => {
    const k = (l) => page.getByRole("group", { name: l }).innerText();
    if (!/\b2\b/.test(await k("Clients actifs"))) throw new Error(await k("Clients actifs")); if (!/\b3\b/.test(await k("Nouveaux clients"))) throw new Error(await k("Nouveaux clients"));
    if (!/11\s?667/.test(await k("Panier moyen"))) throw new Error(await k("Panier moyen")); if (!/35\s?000/.test(await k("CA généré par les clients"))) throw new Error(await k("CA généré par les clients")); if (!/Clients fidèles/.test(await k("Clients fidèles"))) throw new Error("fidèles");
  });
  await step("segmentation, programme de fidélité réel (règle de points, points en circulation), évolution, top clients classé", async () => {
    if (!(await page.getByRole("region", { name: "Segmentation des clients" }).locator("svg").count())) throw new Error("segmentation");
    const f = await page.getByRole("region", { name: "Programme de fidélité" }).innerText(); if (!/d'achat = 1 point/.test(f) || !/Points en circulation/.test(f)) throw new Error(f);
    if (!(await page.getByRole("region", { name: "Évolution de la clientèle" }).locator("svg").count())) throw new Error("évolution");
    const top = await page.getByRole("region", { name: "Top clients (CA)" }).innerText(); if (!/1\s*Awa Diop[\s\S]*30\s?000[\s\S]*2\s*Bara Sow/.test(top)) throw new Error(top);
    await page.screenshot({ path: path.join(OUT, "kit10-crm-1440.png"), fullPage: true });
  });
  await step("encart MASTER (constats réels) ; un top client ouvre sa fiche", async () => {
    const md = await page.getByRole("region", { name: "MASTER DOGUI — CRM" }).innerText(); if (!/3 nouveau\(x\) client\(s\)/.test(md)) throw new Error(md.slice(0, 300));
    await page.getByRole("region", { name: "Top clients (CA)" }).getByRole("button", { name: /Awa Diop/ }).click(); await page.getByRole("dialog").last().waitFor({ timeout: 6000 }); if (!/Awa Diop/.test(await page.getByRole("dialog").last().innerText())) throw new Error("fiche"); await page.keyboard.press("Escape");
  });
  await step("seconde ligne : Tableau, Opportunités, Agenda ; formule Business : onglets Pro verrouillés", async () => {
    await page.getByRole("tab", { name: "Tableau" }).click(); await page.getByText("Clients par segment").waitFor({ timeout: 8000 });
    const sub = h.st.rows("subscriptions")[0]; sub.plan = "business"; await open(); await page.getByRole("tab", { name: /Segmentation/ }).click(); await page.getByText(/formule|Pro/).first().waitFor({ timeout: 6000 });
    if (!(await page.getByRole("tab", { name: /Segmentation/ }).getByLabel("Réservé à une offre supérieure").count())) throw new Error("cadenas"); sub.plan = "pro";
  });
  for (const [w, theme] of [[1600, "light"], [1280, "light"], [820, "light"], [390, "light"], [360, "light"], [1280, "dark"]]) await step(`${w} px ${theme} : aucun débordement (captures)`, async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("accueil")); await page.evaluate((t) => localStorage.setItem("dmp-theme", t), theme); await open(w, 900);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o); await page.screenshot({ path: path.join(OUT, `kit10-crm-${theme}-${w}.png`), fullPage: true });
  });
  await page.evaluate(() => localStorage.setItem("dmp-theme", "light"));
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
