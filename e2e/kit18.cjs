/** Lot K18 (kit) : Équipe & Permissions — 5 indicateurs réels, onglets du kit, membres (dernière connexion, 2FA de l'annuaire), invitation par lien à usage unique
 *  (création, QR, acceptation publique, lien inutilisable ensuite), modification d'un membre, matrice des droits, journal, sécurité, constats MASTER, rapport PDF, responsive. Lancement : bash e2e/run.sh kit18 */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
(async () => {
  const h = await start({ plan: "pro", expect: [] }); const { page, st, call } = h; const A = h.shop;
  const ok = async (r) => { const x = await r; if (x.status !== 200) throw new Error(JSON.stringify(x.body)); return x.body.data; };
  await ok(call("staff.create", { name: "Kouamé Serge", username: "kouame", password: "motdepasse1", role: "stockkeeper", shopIds: [A] }));
  const k = st.rows("staff")[0];
  st.security.set("u1", { lastLogin: new Date().toISOString(), sessions24h: 3, mfa: false });
  st.security.set(k.userId, { lastLogin: new Date(Date.now() - 45 * 864e5).toISOString(), sessions24h: 0, mfa: false });
  const open = async (w = 1440, hh = 1000) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url("reglages?onglet=equipe")); await page.getByRole("heading", { name: "Équipe & Permissions" }).waitFor({ timeout: 15000 }); await page.getByRole("group", { name: "Membres de l'équipe" }).waitFor({ timeout: 15000 }); await page.waitForTimeout(600); };
  const kpi = (l) => page.getByRole("group", { name: l }).innerText(); const tab = (n) => page.getByRole("tablist", { name: "Sections Équipe & Permissions" }).getByRole("tab", { name: new RegExp("^" + n) });
  let link = "";

  await step("5 indicateurs réels (2 membres, 2 rôles, 3 connexions 24 h, 2FA 0 / 2) et 6 onglets", async () => {
    await open();
    if (!/\b2\b/.test(await kpi("Membres de l'équipe"))) throw new Error(await kpi("Membres de l'équipe"));
    if (!/2 \/ 2/.test(await kpi("Comptes actifs"))) throw new Error(await kpi("Comptes actifs"));
    if (!/\b3\b/.test(await kpi("Connexions (24 h)"))) throw new Error(await kpi("Connexions (24 h)"));
    if (!/0 \/ 2/.test(await kpi("Comptes avec 2FA"))) throw new Error(await kpi("Comptes avec 2FA"));
    for (const t of ["Vue d'ensemble", "Membres de l'équipe", "Rôles & Permissions", "Invitations", "Activités & Journaux", "Sécurité"]) if (!(await tab(t).count())) throw new Error("onglet " + t);
  });
  await step("vue d'ensemble : membres réels, matrice, constats MASTER (compte inactif 45 j, 2FA)", async () => {
    const m = await page.getByRole("table", { name: "Membres de l'équipe" }).innerText(); if (!/Kouamé Serge/.test(m) || !/Magasinier/.test(m) || !/Propriétaire/.test(m)) throw new Error(m);
    const ms = await page.getByRole("region", { name: "MASTER DOGUI — Équipe" }).innerText(); if (!/sans connexion depuis 30 jours/.test(ms) || !/double authentification/.test(ms)) throw new Error(ms);
    if (!(await page.getByRole("table", { name: "Matrice des permissions" }).count())) throw new Error("matrice");
  });
  await step("invitation : lien et QR affichés une fois ; aucune donnée du jeton en clair", async () => {
    await page.getByRole("button", { name: "Ajouter un membre" }).first().click();
    await page.getByLabel("Nom de la personne invitée").fill("Aka Blandine"); await page.getByRole("dialog").getByRole("combobox", { name: "Rôle", exact: true }).selectOption("cashier");
    await page.getByRole("button", { name: "Créer le lien d'invitation" }).click();
    link = await page.getByLabel("Lien d'invitation").inputValue({ timeout: 10000 }); if (!/invitation\?t=[a-f0-9]{64}$/.test(link)) throw new Error(link);
    const row = st.rows("staff_invites")[0]; if (JSON.stringify(row).includes(link.split("t=")[1])) throw new Error("jeton stocké en clair");
    await page.screenshot({ path: path.join(OUT, "kit18-invitation.png") });
  });
  await step("acceptation publique : compte créé avec le rôle de l'invitation ; lien inutilisable ensuite", async () => {
    await page.goto(link); await page.getByText("Aka Blandine").waitFor({ timeout: 10000 }); if (!/Caissier/.test(await page.locator("main").innerText())) throw new Error("rôle");
    await page.getByLabel("Identifiant de connexion").fill("blandine"); await page.getByLabel("Mot de passe (8 caractères min.)").fill("motdepasse1"); await page.getByLabel("Confirmer le mot de passe").fill("motdepasse1");
    await page.getByRole("button", { name: "Créer mon compte" }).click(); await page.getByText("Votre compte est créé").waitFor({ timeout: 10000 });
    const s = st.rows("staff").find((x) => x.username === "blandine"); if (!s || s.role !== "cashier") throw new Error(JSON.stringify(s));
    await page.screenshot({ path: path.join(OUT, "kit18-acceptation.png") });
    await page.goto(link); await page.getByText(/déjà été utilisée/).waitFor({ timeout: 10000 });
  });
  await step("invitations : acceptée listée ; journal de l'équipe (ajout, invitation acceptée)", async () => {
    await open(); await tab("Invitations").click(); if (!/Acceptée/.test(await page.getByRole("region", { name: "Invitations" }).innerText())) throw new Error("statut");
    await tab("Activités & Journaux").click(); const a = await page.getByRole("region", { name: "Activités & Journaux de l'équipe" }).innerText(); if (!/Invitation acceptée/.test(a) || !/Ajout d'un membre/.test(a)) throw new Error(a);
  });
  await step("modifier un membre : passage en Consultant enregistré côté serveur", async () => {
    await tab("Membres de l'équipe").click(); await page.getByRole("button", { name: "Modifier Kouamé Serge" }).first().click();
    await page.getByRole("dialog").getByRole("combobox", { name: "Rôle", exact: true }).selectOption("viewer"); await page.getByRole("button", { name: "Enregistrer rôle, accès et boutiques" }).click(); await page.waitForTimeout(1200);
    if (st.rows("staff").find((x) => x.username === "kouame").role !== "viewer") throw new Error("rôle non enregistré");
    const r = await page.getByRole("table", { name: "Membres de l'équipe" }).innerText(); if (!/Consultant/.test(r)) throw new Error(r);
  });
  await step("rôles & permissions : matrice modules × 6 rôles + actions réservées ; sécurité : connexions et 2FA", async () => {
    await tab("Rôles & Permissions").click(); const m = page.getByRole("table", { name: "Matrice des permissions" }); if ((await m.count()) !== 2) throw new Error("2 matrices attendues");
    if (!/Gérer l'équipe/.test(await m.nth(1).innerText())) throw new Error("actions réservées");
    await tab("Sécurité").click(); const s = await page.getByRole("table", { name: "Sécurité des comptes" }).innerText(); if (!/Non activée/.test(s)) throw new Error(s);
  });
  await step("rapport de sécurité PDF téléchargé", async () => {
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.getByRole("button", { name: "Rapport de sécurité (PDF)" }).click()]);
    const f = path.join(OUT, "kit18-rapport.pdf"); await dl.saveAs(f); if (fs.readFileSync(f).subarray(0, 5).toString() !== "%PDF-") throw new Error("pas un PDF");
  });
  await step("capture vue d'ensemble 1440", async () => { await open(); await page.screenshot({ path: path.join(OUT, "kit18-equipe-1440.png"), fullPage: true }); });
  for (const [w, theme] of [[1600, "light"], [1280, "light"], [820, "light"], [390, "light"], [1280, "dark"]]) await step(`${w} px ${theme} : aucun débordement (captures)`, async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("accueil")); await page.evaluate((t) => localStorage.setItem("dmp-theme", t), theme); await open(w, 900);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o); await page.screenshot({ path: path.join(OUT, `kit18-${theme}-${w}.png`), fullPage: true });
  });
  await page.evaluate(() => localStorage.setItem("dmp-theme", "light"));
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
