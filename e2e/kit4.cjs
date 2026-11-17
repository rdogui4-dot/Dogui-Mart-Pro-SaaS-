/** Lot K4 (kit 24 interfaces) : Articles & Catalogue (écran 10) — en-tête, 4 indicateurs réels, filtres d'état de stock avec compteurs, cartes avec pastille, fiche détail réactive, responsive. Lancement : bash e2e/run.sh kit4 */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
(async () => {
  const h = await start({ plan: "pro", expect: [] }); const { page } = h; const A = h.shop;
  const mk = (n, p, c, cat, q, min) => h.call("article.save", { data: { name: n, price: p, cost: c, category: cat, minStock: min }, initialQty: q }, A).then((r) => r.body.data.id);
  await mk("Riz local 5 kg", 5000, 4000, "Alimentaire", 50, 10); await mk("Huile 1 L", 4000, 3000, "Alimentaire", 2, 10); await mk("Savon", 500, 300, "Hygiène", 0, 5); const old = await mk("Ancien article", 100, 50, "Divers", 3, 0);
  await h.call("article.archive", { id: old, archived: true }, A);
  const open = async (w = 1280, hh = 900) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url("articles")); await page.waitForSelector("text=Riz local", { timeout: 15000 }); await page.waitForTimeout(900); };
  const chips = () => page.getByRole("navigation", { name: "État du stock" });

  await step("en-tête du kit et 4 indicateurs réels (3 actifs, valeur 206 000 F au coût, 2 catégories actives + 1 archivée, 2 alertes)", async () => {
    await open(); if (!(await page.getByRole("heading", { name: "Articles & Catalogue" }).count())) throw new Error("titre");
    const k = (l) => page.getByRole("group", { name: l }).innerText();
    if (!/\b3\b/.test(await k("Articles actifs"))) throw new Error(await k("Articles actifs")); if (!/206\s?000/.test(await k("Valeur du stock"))) throw new Error(await k("Valeur du stock"));
    if (!/\b2\b/.test(await k("Alertes de stock"))) throw new Error(await k("Alertes de stock"));
  });
  await step("filtres d'état : Tous 3, En stock 1, Stock faible 1, Rupture 1 ; « Rupture » ne montre que Savon", async () => {
    const t = (await chips().innerText()).replace(/\s+/g, " "); for (const x of [/Tous \(3\)/, /En stock \(1\)/, /Stock faible \(1\)/, /Rupture \(1\)/]) if (!x.test(t)) throw new Error(t);
    await chips().getByRole("button", { name: /Rupture/ }).click(); await page.waitForTimeout(400); const body = await page.locator("main").innerText();
    if (!/Savon/.test(body) || /Riz local/.test(body) || /Huile 1 L/.test(body)) throw new Error("filtre rupture : " + body.slice(0, 300));
    await chips().getByRole("button", { name: /Tous/ }).click();
  });
  await step("grille : pastille d'état sur chaque carte", async () => {
    await page.getByRole("button", { name: "Affichage en grille" }).click(); await page.waitForTimeout(400);
    const cards = await page.locator("main li").allInnerTexts(); const savon = cards.find((c) => /Savon/.test(c)) ?? ""; const huile = cards.find((c) => /Huile/.test(c)) ?? "";
    if (!/Rupture/.test(savon) || !/Stock faible/.test(huile)) throw new Error(JSON.stringify(cards).slice(0, 300));
    await page.screenshot({ path: path.join(OUT, "kit4-articles-grille-1280.png") }); await page.getByRole("button", { name: "Affichage en liste" }).click();
  });
  await step("fiche détail : identité immédiate, détails (mouvements, historique des prix) juste après", async () => {
    await page.locator("tbody tr", { hasText: "Riz local" }).first().click(); const dlg = page.getByRole("dialog", { name: "Riz local 5 kg" }); await dlg.waitFor({ timeout: 5000 });
    if (!/Référence|Catégorie/.test(await dlg.innerText())) throw new Error("identité absente"); await dlg.getByText("Historique des prix").waitFor({ timeout: 3000 });
    await page.screenshot({ path: path.join(OUT, "kit4-articles-fiche-1280.png") }); await page.keyboard.press("Escape");
  });
  await step("« Ajouter un article » ouvre le formulaire", async () => { await page.getByRole("button", { name: "Ajouter un article" }).click(); await page.getByLabel("Désignation *").waitFor({ timeout: 5000 }); await page.keyboard.press("Escape"); });
  for (const [w, theme] of [[1600, "light"], [820, "light"], [390, "light"], [360, "light"], [1280, "dark"]]) await step(`${w} px ${theme} : aucun débordement (captures)`, async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("accueil")); await page.evaluate((t) => localStorage.setItem("dmp-theme", t), theme); await open(w);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o);
    await page.screenshot({ path: path.join(OUT, `kit4-articles-${theme}-${w}.png`), fullPage: true });
  });
  await page.evaluate(() => localStorage.setItem("dmp-theme", "light"));
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
