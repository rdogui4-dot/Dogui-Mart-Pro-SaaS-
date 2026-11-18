/** Champ Bundle (Lot) au format du kit : onglets du catalogue, tableau des bundles, fenêtre « Créer un Bundle (Lot) » (photo, nom, catégorie pré-remplie, description, articles avec − / +, prix unitaire, sous-total, recherche d'article), prix ↔ remise liés, interrupteur de suivi du stock, récapitulatif (économie client exacte), enregistrement réel. Lancement : bash e2e/run.sh kitbundle */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
const nb = (t) => t.replace(/[\s  ]/g, "");
(async () => {
  const h = await start({ plan: "pro", expect: [] }); const { page, st } = h; const A = h.shop;
  for (const [name, price] of [["Riz local 5 kg", 2950], ["Huile en Fête 1 L", 1700], ["Sucre 1 kg", 900], ["Pâtes alimentaires 500 g", 500], ["Tomate concentrée 400 g", 600]]) { const r = await h.call("article.save", { data: { name, price, cost: Math.round(price * 0.8) }, initialQty: 20 }, A); if (r.status !== 200) throw new Error(JSON.stringify(r.body)); }
  const open = async (w = 1440, hh = 1000) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url("bundles")); await page.getByRole("heading", { name: "Articles & Catalogue" }).waitFor({ timeout: 15000 }); await page.waitForTimeout(1000); };
  const addArt = async (q) => { await page.getByRole("button", { name: /Ajouter un article/ }).click(); await page.getByLabel("Rechercher un article à ajouter").fill(q); await page.getByRole("dialog", { name: "Ajouter un article" }).getByRole("button", { name: new RegExp(q) }).first().click(); await page.waitForTimeout(250); };
  const recap = async () => nb(await page.getByRole("region", { name: "Récapitulatif" }).innerText());

  await step("onglets du catalogue (Tous les articles 5 / Bundles 0), bouton or « Créer un Bundle »", async () => {
    await open(); const tabs = await page.getByRole("tablist", { name: "Sections du catalogue" }).innerText(); if (!/Tous les articles \(5\)/.test(tabs) || !/Bundles \/ Lots \(0\)/.test(tabs)) throw new Error(tabs);
    await page.getByRole("button", { name: "Créer un Bundle" }).click(); await page.getByRole("dialog", { name: "Créer un Bundle (Lot)" }).waitFor({ timeout: 5000 });
    if ((await page.getByLabel("Catégorie").inputValue()) !== "Packs / Bundles") throw new Error("catégorie pré-remplie"); if (!(await page.getByRole("switch", { name: /Suivre le stock du bundle/ }).isChecked())) throw new Error("suivi du stock activé par défaut");
  });
  await step("5 articles ajoutés par recherche : prix unitaires, sous-totaux, total sans remise 6 650 F", async () => {
    await page.getByLabel("Nom du bundle *").fill("Pack Cuisine Essentiel"); await page.getByLabel("Description (optionnelle)").fill("Un lot pratique pour la cuisine quotidienne : riz, huile, sucre, pâtes et tomate.");
    for (const q of ["Riz local", "Huile en Fête", "Sucre 1 kg", "Pâtes alimentaires", "Tomate concentrée"]) await addArt(q);
    const t = nb(await page.getByRole("table", { name: "Composition du bundle" }).innerText()); for (const x of ["2950FCFA", "1700FCFA", "600FCFA"]) if (!t.includes(x)) throw new Error("prix " + x);
    { const c = (await page.getByRole("region", { name: "Articles du bundle", exact: true }).locator("h3").innerText()).replace(/\s+/g, " "); if (!/Articles du bundle \(5 articles\)/.test(c)) throw new Error("compteur : " + c); }
    if (!(await recap()).includes("Totalsansremise6650FCFA")) throw new Error(await recap());
  });
  await step("remise 10 % → prix 5 985 F ; prix 6 000 F → remise 9,8 % et économie client 650 F (−9,8 %)", async () => {
    await page.getByLabel("Remise en pourcentage").fill("10"); if ((await page.getByLabel(/Prix du bundle/).inputValue()) !== "5985") throw new Error("prix depuis remise : " + (await page.getByLabel(/Prix du bundle/).inputValue()));
    await page.getByLabel(/Prix du bundle/).fill("6000"); await page.waitForTimeout(150); if ((await page.getByLabel("Remise en pourcentage").inputValue()) !== "9,8") throw new Error("remise depuis prix : " + (await page.getByLabel("Remise en pourcentage").inputValue()));
    const r = await recap(); if (!r.includes("Économieclient650FCFA(−9,8%)")) throw new Error(r);
  });
  await step("bouton + sur le riz : quantité 2, sous-total 5 900 F, total 9 600 F ; − ramène à 1", async () => {
    await page.getByRole("button", { name: "Augmenter la quantité de Riz local 5 kg" }).click(); if ((await page.getByLabel("Quantité de Riz local 5 kg", { exact: true }).inputValue()) !== "2") throw new Error("quantité");
    if (!nb(await page.getByRole("table", { name: "Composition du bundle" }).innerText()).includes("5900FCFA") || !(await recap()).includes("Totalsansremise9600FCFA")) throw new Error(await recap());
    await page.getByRole("button", { name: "Diminuer la quantité de Riz local 5 kg" }).click(); await page.screenshot({ path: path.join(OUT, "kitbundle-fenetre-1440.png"), fullPage: true });
  });
  await step("enregistrement réel : bundle virtuel, 5 composants, catégorie et description ; ligne du tableau (Virtuel, 6 000 F, Actif)", async () => {
    await page.getByRole("button", { name: "Enregistrer le bundle" }).click(); await page.waitForTimeout(2000);
    const b = st.rows("products").find((x) => x.name === "Pack Cuisine Essentiel"); if (!b) throw new Error("non créé"); if (b.bundleMode !== "virtual" || b.price !== 6000 || b.category !== "Packs / Bundles" || !/riz, huile/.test(String(b.description))) throw new Error(JSON.stringify(b));
    if (st.rows("article_components").filter((c) => c.bundleId === b.$id).length !== 5) throw new Error("composants");
    const row = nb(await page.getByRole("table", { name: "Bundles" }).innerText()); if (!row.includes("PackCuisineEssentiel") || !row.includes("6000FCFA") || !row.includes("Actif") || !row.includes("Virtuel")) throw new Error(row);
    await page.screenshot({ path: path.join(OUT, "kitbundle-liste-1440.png"), fullPage: true });
  });
  await step("kit physique : interrupteur désactivé à la création → bundle « kit »", async () => {
    await page.getByRole("button", { name: "Créer un Bundle" }).click(); await page.getByRole("switch", { name: /Suivre le stock du bundle/ }).uncheck(); await page.getByLabel("Nom du bundle *").fill("Coffret sucré"); await page.getByLabel(/Prix du bundle/).fill("1300");
    await addArt("Sucre 1 kg"); await addArt("Pâtes alimentaires"); await page.getByRole("button", { name: "Enregistrer le bundle" }).click(); await page.waitForTimeout(1800);
    const b = st.rows("products").find((x) => x.name === "Coffret sucré"); if (!b || b.bundleMode !== "kit") throw new Error(JSON.stringify(b));
  });
  for (const [w, theme] of [[1280, "light"], [820, "light"], [390, "light"], [1280, "dark"]]) await step(`${w} px ${theme} : liste et fenêtre sans débordement`, async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("accueil")); await page.evaluate((t) => localStorage.setItem("dmp-theme", t), theme); await open(w, 900);
    let o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("liste : débordement " + o);
    await page.getByText("Pack Cuisine Essentiel").first().click(); await page.getByRole("dialog", { name: "Modifier le bundle" }).waitFor({ timeout: 5000 }); await page.waitForTimeout(400);
    o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("fenêtre : débordement " + o); await page.screenshot({ path: path.join(OUT, `kitbundle-${theme}-${w}.png`), fullPage: true }); await page.keyboard.press("Escape");
  });
  await page.evaluate(() => localStorage.setItem("dmp-theme", "light"));
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
