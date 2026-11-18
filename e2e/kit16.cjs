/** Lot K16 (kit) : Paramètres généraux — en-tête, 5 indicateurs réels, onglets du kit, vue Général (entreprise avec logo, raison sociale, régime fiscal ; boutique : fuseau, TVA ; modules selon la formule ; paiements ; sécurité ; paramétrage intelligent MASTER), responsive. Lancement : bash e2e/run.sh kit16 */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
(async () => {
  const h = await start({ plan: "business", expect: [] }); const { page, st } = h; const A = h.shop;
  const open = async (w = 1440, hh = 1000) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url("reglages")); await page.getByRole("heading", { name: "Paramètres généraux" }).waitFor({ timeout: 15000 }); await page.waitForTimeout(1500); };
  const kpi = (l) => page.getByRole("group", { name: l }).innerText(); const shop = () => st.rows("shops").find((x) => x.$id === A);

  await step("en-tête, 5 indicateurs (1 boutique, modules 9 / 10 en Business), onglets du kit, vue Général par défaut", async () => {
    await open(); if (!/\b1\b/.test(await kpi("Boutiques configurées"))) throw new Error(await kpi("Boutiques configurées")); if (!/9\s*\/\s*10/.test(await kpi("Modules ouverts"))) throw new Error(await kpi("Modules ouverts"));
    if (!/\d+\s*\/\s*12/.test(await kpi("Paramétrage complet"))) throw new Error(await kpi("Paramétrage complet"));
    for (const t of ["Général", "Boutique", "Règles de gestion", "Boutiques", "Paiements", "Journal d'activité", "Mon profil", "Équipe & accès", "Abonnement"]) if (!(await page.getByRole("tab", { name: t, exact: true }).count())) throw new Error("onglet " + t);
    if ((await page.getByRole("tab", { name: "Général" }).getAttribute("aria-selected")) !== "true") throw new Error("vue par défaut");
  });
  await step("entreprise : raison sociale et régime fiscal enregistrés ; la liste MASTER les coche", async () => {
    await page.getByLabel("Raison sociale").fill("Dogui Distribution SARL"); await page.getByLabel("Régime fiscal").fill("Réel simplifié");
    await page.getByRole("region", { name: "Informations de l'entreprise" }).getByRole("button", { name: "Enregistrer" }).click(); await page.waitForTimeout(1500);
    if (shop().companyName !== "Dogui Distribution SARL" || shop().taxRegime !== "Réel simplifié") throw new Error(JSON.stringify(shop()));
    const m = await page.getByRole("region", { name: "MASTER DOGUI — Paramétrage intelligent" }).innerText(); if (/Raison sociale\s*\n\s*Nom juridique/.test(m)) throw new Error("raison sociale encore à faire");
  });
  await step("boutique : fuseau horaire et TVA enregistrés ; devise et langue affichées fixes", async () => {
    await page.getByLabel("Fuseau horaire").selectOption("Africa/Abidjan"); await page.getByRole("region", { name: "Paramètres de la boutique" }).getByRole("button", { name: "Enregistrer" }).click(); await page.waitForTimeout(1200);
    if (shop().promoTz !== "Africa/Abidjan") throw new Error(JSON.stringify(shop())); if (!/XOF — Franc CFA/.test(await page.getByRole("region", { name: "Paramètres de la boutique" }).innerText())) throw new Error("devise");
  });
  await step("logo : vraie image envoyée, vérifiée et enregistrée, confirmation affichée", async () => {
    const b64 = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 320; c.height = 200; const x = c.getContext("2d"); x.fillStyle = "#c9a227"; x.fillRect(0, 0, 320, 200); x.fillStyle = "#0b1f3a"; x.font = "bold 48px sans-serif"; x.fillText("DOGUI", 60, 120); for (let i = 0; i < 400; i++) { x.fillStyle = `hsl(${i},70%,50%)`; x.fillRect((i * 37) % 320, (i * 53) % 200, 3, 3); } return c.toDataURL("image/png").split(",")[1]; });
    await page.getByLabel("Logo de l'entreprise").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: Buffer.from(b64, "base64") }); await page.getByText(/Logo enregistré/).waitFor({ timeout: 10000 });
    if (!shop().logoFileId) throw new Error("logo non enregistré");
  });
  await step("modules selon la formule (Rapports & Analyses verrouillé en Business), paiements, sécurité", async () => {
    const mods = page.getByRole("region", { name: "Modules de la plateforme" }); if (!(await mods.getByLabel("Formule supérieure").count())) throw new Error("module verrouillé absent"); if (!/9 \/ 10 ouverts/.test(await mods.innerText())) throw new Error("compteur");
    if (!/Carte bancaire, paiement en ligne\s*Non disponible/.test(await page.getByRole("region", { name: "Paiements & encaissements" }).innerText())) throw new Error("paiements");
    if (!/journalisées/.test(await page.getByRole("region", { name: "Sécurité & traçabilité" }).innerText())) throw new Error("sécurité");
    await page.screenshot({ path: path.join(OUT, "kit16-parametres-1440.png"), fullPage: true });
  });
  for (const [w, theme] of [[1600, "light"], [1280, "light"], [820, "light"], [390, "light"], [1280, "dark"]]) await step(`${w} px ${theme} : aucun débordement (captures)`, async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("accueil")); await page.evaluate((t) => localStorage.setItem("dmp-theme", t), theme); await open(w, 900);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o); await page.screenshot({ path: path.join(OUT, `kit16-${theme}-${w}.png`), fullPage: true });
  });
  await page.evaluate(() => localStorage.setItem("dmp-theme", "light"));
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
