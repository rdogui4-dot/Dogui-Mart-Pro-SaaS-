/** Lot K20c (kit écran 01) : accueil public — menu et boutons Se connecter / S'inscrire, titre « Gérez. Analysez. Décidez. », modules, garanties vérifiables (pas de logos de marques ni de chiffres inventés),
 *  aperçus réels de l'application, offres aux tarifs réels, liens vers les textes juridiques, inscription directe, responsive. Lancement : bash e2e/run.sh kit20c */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
(async () => {
  const h = await start({ plan: "pro", anonymous: true, expect: [] }); const { page } = h;
  const open = async (w = 1440, hh = 900) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url("presentation/")); await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 15000 }); await page.waitForTimeout(500); };

  await step("menu (Accueil, Fonctionnalités, Tarifs, MASTER DOGUI, Contact) et boutons Se connecter / S'inscrire", async () => {
    await open(); const nav = page.getByRole("navigation", { name: "Sections" });
    for (const l of ["Accueil", "Fonctionnalités", "Tarifs", "MASTER DOGUI", "Contact"]) if (!(await nav.getByRole("link", { name: l, exact: true }).count())) throw new Error("lien " + l);
    if (!(await nav.getByRole("link", { name: "Se connecter" }).count()) || !(await nav.getByRole("link", { name: "S'inscrire" }).count())) throw new Error("boutons");
  });
  await step("hero : « Gérez. Analysez. Décidez. », 6 modules, garanties vérifiables, aucun logo de marque ni chiffre inventé", async () => {
    const t = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    for (const m of ["Gérez. Analysez. Décidez.", "Gestion commerciale", "Gestion des stocks", "Comptabilité & finance", "CRM clients", "Investissement & projection", "Hébergement Appwrite", "Francfort", "Fonctionne hors connexion"]) if (!t.includes(m)) throw new Error("manque : " + m);
    if (/Carrefour|Prosuma|CFAO|CDCI|Ils nous font confiance|\+32 ?%|95 ?%|2 750 000|Voir la démo/i.test(t)) throw new Error("élément inventé affiché");
    await page.screenshot({ path: path.join(OUT, "kit20c-accueil-1440.png"), fullPage: true });
  });
  await step("aperçus réels de l'application chargés (3 images), offres aux tarifs réels", async () => {
    await page.locator("#apercus img").last().scrollIntoViewIfNeeded(); await page.waitForTimeout(800);
    const ok = await page.locator("#apercus img").evaluateAll((a) => a.map((i) => i.complete && i.naturalWidth > 0)); if (ok.length !== 3 || ok.some((x) => !x)) throw new Error(JSON.stringify(ok));
    const t = (await page.locator("#offres").innerText()).replace(/\s+/g, " "); for (const m of ["Starter", "Business", "Pro", "FCFA"]) if (!t.includes(m)) throw new Error("offre : " + m);
  });
  await step("liens juridiques (pied de page et FAQ) mènent aux pages publiques", async () => {
    const f = page.locator("footer"); for (const [l, re] of [["Conditions d'utilisation", /conditions$/], ["Politique de confidentialité", /confidentialite$/]]) { const href = await f.getByRole("link", { name: l }).getAttribute("href"); if (!re.test(href)) throw new Error(l + " → " + href); }
    await f.getByRole("link", { name: "Conditions d'utilisation" }).click(); await page.getByRole("heading", { name: "Conditions d'utilisation" }).first().waitFor({ timeout: 10000 });
  });
  await step("« S'inscrire » ouvre directement la création de compte ; « Se connecter » la connexion", async () => {
    await open(); await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "S'inscrire" }).click(); await page.getByRole("heading", { name: "Créer un compte" }).waitFor({ timeout: 10000 });
    await open(); await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Se connecter" }).click(); await page.getByRole("heading", { name: "Se connecter" }).first().waitFor({ timeout: 10000 });
  });
  for (const [w, theme] of [[1600, "light"], [1280, "light"], [820, "light"], [390, "light"], [1280, "dark"]]) await step(`${w} px ${theme} : aucun débordement (captures)`, async () => {
    await page.emulateMedia({ colorScheme: theme }); await open(w, 900); const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o); await page.screenshot({ path: path.join(OUT, `kit20c-${theme}-${w}.png`), fullPage: true });
  });
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource|401/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
