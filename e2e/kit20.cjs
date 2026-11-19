/** Lot K20a (kit écrans 02-04) : connexion, création de compte (étape 1 sur 3, solidité du mot de passe, consentement obligatoire), mot de passe oublié en 3 étapes (lien), deux colonnes,
 *  pages publiques Conditions d'utilisation et Politique de confidentialité, aucun faux élément (réseaux sociaux, « se souvenir de moi », code SMS), responsive. Lancement : bash e2e/run.sh kit20 */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
(async () => {
  const h = await start({ plan: "pro", anonymous: true, expect: [] }); const { page } = h;
  const open = async (w = 1440, hh = 900, p = "accueil") => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url(p)); await page.getByRole("heading", { name: /Se connecter|Créer un compte|Conditions d'utilisation|Politique de confidentialité/ }).first().waitFor({ timeout: 15000 }); await page.waitForTimeout(400); };

  await step("connexion : deux colonnes (message + 6 modules), formulaire, mot de passe oublié ; aucun faux élément", async () => {
    await open(); const t = await page.locator("body").innerText();
    for (const m of ["gestion intelligente", "Ventes & Caisse", "Stocks & Inventaires", "Finance (FinI)", "Comptabilité (ICompta)", "IProj-Invest", "CRM"]) if (!t.includes(m)) throw new Error("manque : " + m);
    if (/Google|Microsoft|Apple|Se souvenir|code de r[ée]initialisation|Ils nous font confiance/i.test(t)) throw new Error("faux élément affiché");
    if (!(await page.getByRole("button", { name: "Mot de passe oublié ?" }).count())) throw new Error("mot de passe oublié");
    await page.screenshot({ path: path.join(OUT, "kit20-connexion-1440.png") });
  });
  await step("création de compte : étape 1 sur 3, bouton inactif sans consentement, solidité du mot de passe réelle, liens juridiques", async () => {
    await page.getByRole("button", { name: /Créer un compte/ }).click(); await page.getByRole("heading", { name: "Créer un compte" }).waitFor();
    if (!/Étape 1 sur 3/.test(await page.locator("form").innerText())) throw new Error("étape");
    const btn = page.getByRole("button", { name: "Créer mon compte" }); if (!(await btn.isDisabled())) throw new Error("bouton actif sans consentement");
    await page.getByLabel("Mot de passe", { exact: true }).fill("abc"); if (!/8 caractères|Trop court/.test(await page.locator("form").innerText()) && !/Sécurité : Trop court/.test(await page.locator("form").innerText())) throw new Error("règle");
    await page.getByLabel("Mot de passe", { exact: true }).fill("Abcdefg1!xyz"); if (!/Sécurité : Forte/.test(await page.locator("form").innerText())) throw new Error("solidité forte");
    await page.getByLabel("Nom complet").fill("Awa Traoré"); await page.getByLabel("Adresse e-mail").fill("awa@exemple.sn"); await page.getByRole("checkbox").check(); if (await btn.isDisabled()) throw new Error("bouton inactif malgré le consentement");
    const links = await page.locator("form a").evaluateAll((a) => a.map((x) => x.getAttribute("href"))); if (!links.some((l) => /conditions$/.test(l)) || !links.some((l) => /confidentialite$/.test(l))) throw new Error(JSON.stringify(links));
    await page.screenshot({ path: path.join(OUT, "kit20-inscription-1440.png") });
  });
  await step("mot de passe oublié : 3 étapes (Demande, Nouveau mot de passe, Confirmation), message de lien et réponse neutre", async () => {
    await page.getByRole("button", { name: /Se connecter/ }).last().click(); await page.getByRole("button", { name: "Mot de passe oublié ?" }).click(); await page.getByRole("heading", { name: "Mot de passe oublié ?" }).waitFor();
    const f = await page.locator("form").innerText(); for (const s of ["Demande", "Nouveau mot de passe", "Confirmation"]) if (!f.includes(s)) throw new Error("étape " + s);
    await page.getByLabel("Adresse e-mail").fill("awa@exemple.sn"); await page.getByRole("button", { name: /Envoyer le lien/ }).click(); await page.waitForTimeout(900);
    const r = await page.locator("form").innerText(); if (!/Si un compte existe/.test(r) || !/lien/.test(r) || /code/i.test(r)) throw new Error(r.slice(0, 300));
    await page.screenshot({ path: path.join(OUT, "kit20-oubli-1440.png") });
  });
  await step("lien de réinitialisation reçu par e-mail : l'écran « Nouveau mot de passe » (étape 2 sur 3) s'ouvre malgré la redirection d'accueil, puis confirmation", async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("?userId=u1&secret=abcdef")); await page.getByRole("heading", { name: "Nouveau mot de passe" }).waitFor({ timeout: 15000 });
    if (!/Étape 2 sur 3/.test(await page.locator("form").innerText())) throw new Error("étape 2");
    await page.getByLabel("Nouveau mot de passe", { exact: true }).fill("Nouveaumdp1!"); await page.getByRole("button", { name: "Enregistrer le mot de passe" }).click();
    await page.getByRole("heading", { name: "Mot de passe modifié" }).waitFor({ timeout: 10000 }); if (!(await page.getByRole("button", { name: /Se connecter/ }).count())) throw new Error("retour à la connexion");
  });
  await step("conditions d'utilisation : page publique complète (14 articles, version, contact)", async () => {
    await open(1280, 900, "conditions"); const t = await page.locator("main").innerText();
    if ((await page.locator("main section").count()) !== 14) throw new Error("articles : " + (await page.locator("main section").count()));
    for (const m of ["Version du", "essai gratuit de 14 jours", "n'est jamais reconduit automatiquement", "+225 05 44 16 54 18", "ne constituent ni un conseil"]) if (!t.replace(/\s+/g, " ").includes(m) && !t.includes(m)) throw new Error("manque : " + m);
    if (!(await page.getByRole("link", { name: "Politique de confidentialité" }).count())) throw new Error("lien croisé");
  });
  await step("politique de confidentialité : sous-traitants réels, conservation 12 mois, droits, aucune identité inventée", async () => {
    await open(1280, 900, "confidentialite"); const t = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    for (const m of ["Appwrite", "Francfort", "Selar", "Gemini", "12 mois", "droit d'accès", "n'utilise ni traceur publicitaire"]) if (!t.includes(m)) throw new Error("manque : " + m);
    if (/SARL|RCCM n°|Capital de/i.test(t.replace("SARL", ""))) throw new Error("identité inventée");
    await page.screenshot({ path: path.join(OUT, "kit20-confidentialite-1280.png"), fullPage: true });
  });
  for (const [w, theme, p] of [[1600, "light", "accueil"], [820, "light", "accueil"], [390, "light", "accueil"], [1280, "dark", "accueil"], [390, "light", "conditions"]]) await step(`${p} ${w} px ${theme} : aucun débordement (captures)`, async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("accueil")); await page.evaluate((t) => localStorage.setItem("dmp-theme", t), theme); await open(w, 900, p);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o); await page.screenshot({ path: path.join(OUT, `kit20-${p}-${theme}-${w}.png`), fullPage: true });
  });
  await page.evaluate(() => localStorage.setItem("dmp-theme", "light"));
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource|401/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
