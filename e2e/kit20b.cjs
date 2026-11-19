/** Lot K20b (kit écrans 05-07) : assistant d'accueil — Entreprise (forme juridique et RCCM facultatifs), Boutique (type, horaires), « Votre espace est prêt » (liste calculée sur les données réelles),
 *  reprise après rechargement, accès à l'espace. Lancement : bash e2e/run.sh kit20b */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
(async () => {
  const h = await start({ plan: "business", noTeam: true, expect: [] }); const { page, st } = h;
  const open = async (w = 1440, hh = 1000) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url("accueil")); await page.waitForTimeout(1200); };
  const shops = () => st.rows("shops").filter((r) => r.companyName || r.sector);
  const t = () => page.locator("main").innerText();

  await step("compte sans commerce : l'assistant s'ouvre (étape Entreprise), forme juridique et RCCM marqués facultatifs", async () => {
    await open(); await page.getByRole("heading", { name: "Informations sur votre entreprise" }).waitFor({ timeout: 15000 });
    const f = await t(); if (!/Étape 2 sur 3/.test(f)) throw new Error("étape"); if (!/Forme juridique \(facultatif\)/.test(f) || !/RCCM \/ ID fiscal \(facultatif\)/.test(f)) throw new Error("facultatif absent");
    if (!/Pays/.test(f) || !/Secteur d'activité/.test(f)) throw new Error("champs");
    await page.screenshot({ path: path.join(OUT, "kit20b-entreprise-1440.png"), fullPage: true });
  });
  await step("envoi à vide : erreurs sur les champs obligatoires seulement, rien n'est créé", async () => {
    await page.getByRole("button", { name: /Continuer vers la boutique/ }).click(); await page.waitForTimeout(400);
    const f = await t(); for (const m of ["Nom de l'entreprise requis", "Choisissez un secteur", "Ville requise", "Adresse requise", "Téléphone invalide"]) if (!f.includes(m)) throw new Error("erreur absente : " + m);
    if (/forme juridique inconnue|RCCM requis/i.test(f)) throw new Error("champ facultatif exigé"); if (h.createdTeams?.length) throw new Error("équipe créée");
    if (st.rows("shops").some((r) => r.name === "Dogui Distribution")) throw new Error("boutique créée");
  });
  await step("entreprise sans forme juridique ni RCCM : enregistrée (fuseau déduit du pays, logo envoyé), passage à la boutique", async () => {
    await page.getByLabel("Nom de l'entreprise").fill("Dogui Distribution"); await page.getByLabel("Secteur d'activité").selectOption("Commerce / Distribution"); await page.getByLabel("Ville", { exact: true }).fill("Abidjan");
    await page.getByLabel("Adresse complète").fill("Cocody, Angré 7e Tranche"); await page.getByLabel("Téléphone de l'entreprise").fill("+225 07 00 00 00 00"); await page.getByLabel("Brève description de votre activité").fill("Vente de produits alimentaires");
    const b64 = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 200; c.height = 120; const x = c.getContext("2d"); x.fillStyle = "#c9a227"; x.fillRect(0, 0, 200, 120); for (let i = 0; i < 300; i++) { x.fillStyle = `hsl(${i},70%,50%)`; x.fillRect((i * 37) % 200, (i * 53) % 120, 3, 3); } return c.toDataURL("image/png").split(",")[1]; });
    await page.getByLabel("Ajouter le logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: Buffer.from(b64, "base64") });
    await page.getByRole("button", { name: /Continuer vers la boutique/ }).click(); await page.getByRole("heading", { name: "Créer votre première boutique" }).waitFor({ timeout: 15000 });
    const s = shops()[0]; if (!s) throw new Error("rien d'enregistré");
    if (s.companyName !== "Dogui Distribution" || s.sector !== "Commerce / Distribution" || s.country !== "CI" || s.promoTz !== "Africa/Abidjan") throw new Error(JSON.stringify(s));
    if (s.legalForm) throw new Error("forme juridique non vide : " + s.legalForm); if (!s.logoFileId) throw new Error("logo non enregistré"); if (!/Étape 3 sur 3/.test(await t())) throw new Error("étape 3");
    if (!(await page.getByLabel("Nom de la boutique").inputValue())) throw new Error("nom non prérempli");
  });
  await step("reprise : rechargement de la page à l'étape Boutique → l'assistant reprend à la boutique, sans recréer le commerce", async () => {
    const teamsBefore = st.rows("subscriptions").length; await page.reload(); await page.getByRole("heading", { name: "Créer votre première boutique" }).waitFor({ timeout: 15000 });
    if (st.rows("subscriptions").length !== teamsBefore) throw new Error("commerce recréé");
    await page.waitForTimeout(800); if ((await page.getByLabel("Adresse de la boutique").inputValue()) !== "Cocody, Angré 7e Tranche" || (await page.getByLabel("Ville / Commune").inputValue()) !== "Abidjan") throw new Error("champs non préremplis depuis les données enregistrées");
  });
  await step("boutique : horaires incohérents refusés, puis enregistrement du type, des jours et des horaires", async () => {
    await page.getByLabel("Nom de la boutique").fill("Dogui Mart Abidjan"); await page.getByLabel("Type de boutique").selectOption("Commerce de détail");
    await page.getByLabel("Ouverture").fill("20:00"); await page.getByLabel("Fermeture").fill("08:00"); await page.getByRole("button", { name: /Finaliser et accéder/ }).click(); await page.waitForTimeout(400);
    if (!/fermeture doit suivre/.test(await t())) throw new Error("horaires incohérents acceptés");
    await page.getByLabel("Ouverture").fill("08:00"); await page.getByLabel("Fermeture").fill("20:00"); await page.getByRole("button", { name: /Finaliser et accéder/ }).click();
    await page.getByRole("heading", { name: "Configuration terminée !" }).waitFor({ timeout: 15000 });
    const s = shops()[0]; if (s.name !== "Dogui Mart Abidjan" || s.shopType !== "Commerce de détail" || s.openDays !== "1111110" || s.openFrom !== "08:00" || s.openTo !== "20:00" || s.companyName !== "Dogui Distribution") throw new Error(JSON.stringify(s));
  });
  await step("« Votre espace est prêt » : liste calculée sur les données réelles (nom, adresse, logo, fuseau cochés), actions rapides, conseils", async () => {
    const lst = page.getByRole("region", { name: "Checklist de démarrage" }); await lst.getByRole("progressbar").waitFor({ timeout: 10000 }); const x = await lst.innerText();
    if (!/\d+ %/.test(x) || !/Nom commercial/.test(x) || !/Logo/.test(x)) throw new Error(x.slice(0, 300));
    if ((await lst.getByLabel("Terminé").count()) < 4) throw new Error("points non cochés d'après les données");
    if (!(await page.getByRole("region", { name: "Que souhaitez-vous faire maintenant ?" }).getByRole("button", { name: /Commencer à vendre/ }).count())) throw new Error("action rapide");
    await page.screenshot({ path: path.join(OUT, "kit20b-pret-1440.png"), fullPage: true });
  });
  await step("accès au tableau de bord : l'assistant disparaît et ne revient pas après rechargement", async () => {
    await page.getByRole("button", { name: /Accéder à mon tableau de bord/ }).click(); await page.waitForTimeout(2500);
    if (await page.getByRole("heading", { name: "Configuration terminée !" }).count()) throw new Error("assistant encore affiché"); if (!(await page.getByRole("link", { name: /Tableau de bord/ }).first().count())) throw new Error("espace non chargé");
    await page.reload(); await page.waitForTimeout(2000); if (await page.getByRole("heading", { name: /Informations sur votre entreprise|Créer votre première boutique|Configuration terminée/ }).count()) throw new Error("assistant revenu");
  });
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
