/** Lot K1 (kit 24 interfaces) : coque — barre latérale plate (17 modules), carte boutique, barre supérieure (état réseau, alertes réelles, profil), pleine largeur, mobile. Lancement : bash e2e/run.sh kit1 */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
const LABELS = ["Tableau de bord", "Caisse (Ventes)", "Articles & Catalogue", "Stocks & Inventaires", "Inventaires (Silent Count)", "Achats & Fournisseurs", "Dépenses", "Clients (CRM)", "Finance (FinI)", "ICompta", "IProj-Invest", "Rapports & Analyses", "MASTER DOGUI", "Promotions & Offres", "Équipe & Permissions", "Paramètres", "Abonnement & Facturation"];
(async () => {
  const h = await start({ plan: "pro", expect: [] }); const { page } = h;
  const p1 = (await h.call("article.save", { data: { name: "Riz", price: 1000, cost: 600, minStock: 10 }, initialQty: 2 }, h.shop)).body.data.id;
  const nav = () => page.getByRole("navigation", { name: "Navigation principale" });
  const open = async (r, w = 1280, hh = 900) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url(r)); await page.waitForTimeout(1200); };

  await step("barre latérale : 17 modules aux noms du kit, dans l'ordre", async () => {
    await open("pos"); const got = (await nav().locator("a, button").allInnerTexts()).map((t) => t.trim());
    if (JSON.stringify(got) !== JSON.stringify(LABELS)) throw new Error(got.join(" | "));
  });
  await step("module actif en or (aria-current) ; sous-page rattachée (Caisse Pro → Caisse)", async () => {
    if ((await nav().getByRole("link", { name: "Caisse (Ventes)" }).getAttribute("aria-current")) !== "page") throw new Error("caisse non active");
    const bg = await nav().getByRole("link", { name: "Caisse (Ventes)" }).evaluate((e) => getComputedStyle(e).backgroundColor); if (!/214, 168, 79/.test(bg)) throw new Error("fond " + bg);
    await open("caisse-pro"); if ((await nav().getByRole("link", { name: "Caisse (Ventes)" }).getAttribute("aria-current")) !== "page") throw new Error("caisse pro non rattachée");
    await page.screenshot({ path: path.join(OUT, "kit1-coque-1280.png") });
  });
  await step("Équipe & Permissions et Abonnement & Facturation ouvrent le bon onglet des réglages", async () => {
    await open("accueil"); await nav().getByRole("link", { name: "Équipe & Permissions" }).click(); await page.waitForURL(/onglet=equipe/, { timeout: 5000 }); await page.waitForTimeout(800);
    if ((await page.getByRole("tab", { name: "Équipe & accès" }).getAttribute("aria-selected")) !== "true") throw new Error("onglet équipe non sélectionné");
    if ((await nav().getByRole("link", { name: "Équipe & Permissions" }).getAttribute("aria-current")) !== "page") throw new Error("module équipe non actif");
    await nav().getByRole("link", { name: "Abonnement & Facturation" }).click(); await page.waitForURL(/onglet=abonnement/, { timeout: 5000 }); await page.waitForTimeout(800);
    if ((await page.getByRole("tab", { name: "Abonnement", exact: true }).getAttribute("aria-selected")) !== "true") throw new Error("onglet abonnement non sélectionné");
    await nav().getByRole("link", { name: "Paramètres" }).click(); await page.waitForTimeout(800); if ((await nav().getByRole("link", { name: "Paramètres" }).getAttribute("aria-current")) !== "page") throw new Error("paramètres non actif");
  });
  await step("MASTER DOGUI (barre latérale) ouvre la fenêtre sur place", async () => {
    await open("pos"); await nav().getByRole("button", { name: "MASTER DOGUI" }).click(); await page.getByRole("dialog", { name: "MASTER DOGUI" }).waitFor({ timeout: 8000 });
    if (!/\/pos/.test(page.url())) throw new Error("adresse changée"); await page.keyboard.press("Escape");
  });
  await step("carte boutique et état réseau réels ; hors ligne signalé", async () => {
    await open("accueil"); const aside = page.getByRole("complementary", { name: "Espaces" });
    if (!(await aside.getByText("En ligne").count())) throw new Error("état boutique absent"); if (!(await page.locator("header").getByText("En ligne").count())) throw new Error("état réseau absent");
    await page.context().setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event("offline"))); await page.waitForTimeout(400);
    if (!(await page.locator("header").getByText(/Hors ligne/).count())) throw new Error("hors ligne non signalé");
    await page.context().setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event("online"))); await page.waitForTimeout(600);
  });
  await step("cloche : alertes de stock réelles (rupture/seuil), Échap ferme et rend le focus", async () => {
    await open("accueil"); const bell = page.getByRole("button", { name: /^Alertes/ }); await bell.waitFor({ timeout: 5000 });
    const lbl = await bell.getAttribute("aria-label"); if (!/à traiter/.test(lbl)) throw new Error(lbl);
    await bell.click(); const reg = page.getByRole("region", { name: "Alertes de stock" }); await reg.waitFor({ timeout: 3000 }); await page.waitForTimeout(600);
    const t = await reg.innerText(); if (!/Riz/.test(t) && !/Aucune alerte/.test(t)) throw new Error("contenu : " + t.slice(0, 200));
    await page.screenshot({ path: path.join(OUT, "kit1-alertes-1280.png") });
    await page.keyboard.press("Escape"); if (await reg.count()) throw new Error("non fermée"); const f = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? ""); if (!/^Alertes/.test(f)) throw new Error("focus : " + f);
  });
  await step("profil : nom et rôle réels, « Mon profil » ouvre l'onglet profil, déconnexion proposée", async () => {
    await open("accueil"); await page.getByRole("button", { name: /^Profil/ }).click(); const menu = page.getByRole("menu", { name: "Profil" });
    if (!/Propriétaire/.test(await menu.innerText())) throw new Error("rôle absent"); if (!(await menu.getByRole("menuitem", { name: "Se déconnecter" }).count())) throw new Error("déconnexion absente");
    await menu.getByRole("menuitem", { name: "Mon profil" }).click(); await page.waitForURL(/onglet=profil/, { timeout: 5000 }); await page.waitForTimeout(800);
    if ((await page.getByRole("tab", { name: "Mon profil" }).getAttribute("aria-selected")) !== "true") throw new Error("onglet profil non sélectionné");
  });
  await step("menu replié : icônes nommées, préférence mémorisée, retour", async () => {
    await open("accueil"); await page.getByRole("button", { name: "Replier le menu" }).click(); await page.waitForTimeout(400);
    const w = (await page.getByRole("complementary", { name: "Espaces" }).boundingBox()).width; if (w > 80) throw new Error("largeur " + w);
    if ((await nav().locator("[aria-label]").count()) < 17) throw new Error("icônes sans nom"); await page.reload(); await page.waitForTimeout(1200);
    if ((await page.getByRole("complementary", { name: "Espaces" }).boundingBox()).width > 80) throw new Error("non mémorisé");
    await nav().getByRole("link", { name: "Stocks & Inventaires" }).click(); await page.waitForURL(/\/stock/, { timeout: 5000 });
    await page.getByRole("button", { name: "Déplier le menu" }).click(); await page.waitForTimeout(400);
  });
  await step("pleine largeur : contenu au-delà de 1 024 px sur un écran de 1 600 px ; aucun débordement à 1280, 820", async () => {
    await open("activite", 1600); const w = await page.locator("main > div").first().evaluate((e) => e.getBoundingClientRect().width); if (w < 1200) throw new Error("largeur contenu " + w);
    await page.screenshot({ path: path.join(OUT, "kit1-coque-1600.png") });
    for (const vw of [1280, 820]) { await open("activite", vw); const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error(vw + " px : débordement " + o); await page.screenshot({ path: path.join(OUT, `kit1-coque-${vw}.png`) }); }
  });
  await step("téléphone : pas de barre latérale, barre du bas, MASTER et profil dans l'en-tête, sans débordement", async () => {
    await open("accueil", 390, 800); if (await page.getByRole("complementary", { name: "Espaces" }).count()) throw new Error("barre latérale sur téléphone");
    if (!(await page.getByRole("navigation", { name: "Navigation" }).count())) throw new Error("barre du bas absente");
    if (!(await page.locator("header").getByRole("button", { name: "MASTER DOGUI" }).count())) throw new Error("MASTER absent");
    if (!(await page.getByRole("button", { name: /^Profil/ }).count())) throw new Error("profil absent");
    const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o);
    await page.screenshot({ path: path.join(OUT, "kit1-coque-390.png") });
  });
  await step("sombre : coque lisible (captures)", async () => {
    await open("accueil"); await page.evaluate(() => localStorage.setItem("dmp-theme", "dark")); await open("pos"); await page.screenshot({ path: path.join(OUT, "kit1-coque-dark-1280.png") });
    await page.evaluate(() => localStorage.setItem("dmp-theme", "light"));
  });
  void p1;
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
