/** Lot K12 (kit 24 interfaces) : ICompta Comptabilité Intelligente (écran 18) — en-tête et « Nouvelle écriture », 5 indicateurs réels (classes 6/7 des écritures validées), onglets du kit, évolution du résultat, situation comptable, accès rapide, encart MASTER, responsive. Lancement : bash e2e/run.sh kit12 */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
(async () => {
  const h = await start({ plan: "business", expect: [] }); const { page, st } = h; const A = h.shop; const T = st.rows("shops")[0].tenantId; const d = new Date().toISOString().slice(0, 10);
  const mk = (id, ref, account, debit, credit) => st.create("journal_entries", id, T, { tenantId: T, shopId: A, ref, account, debit, credit, label: ref, date: `${d}T10:00:00.000Z` });
  await mk("k1", "V-1", "571", 20000, 0); await mk("k2", "V-1", "701", 0, 20000); await mk("k3", "D-1", "622", 5000, 0); await mk("k4", "D-1", "571", 0, 5000);
  const open = async (w = 1440, hh = 1000) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url("icompta")); await page.getByRole("heading", { name: "ICompta — Comptabilité Intelligente" }).waitFor({ timeout: 15000 }); await page.waitForTimeout(1500); };

  await step("en-tête du kit, « Nouvelle écriture » ouvre la saisie, onglets du kit", async () => {
    await open(); await page.getByRole("button", { name: "Nouvelle écriture" }).first().click(); await page.getByRole("dialog", { name: "Nouvelle écriture" }).waitFor({ timeout: 5000 }); await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    for (const t of ["Vue d'ensemble", "Écritures", "Plan comptable", "Journaux", /^États financiers/, "Clôture", "Facturation", "Propositions"]) if (!(await page.getByRole("tab", { name: t }).count())) throw new Error("onglet " + t);
  });
  await step("5 indicateurs réels : produits 20 000 F, charges 5 000 F, résultat 15 000 F, 2 écritures, 3 comptes", async () => {
    const k = (l) => page.getByRole("group", { name: l }).innerText();
    if (!/20\s?000/.test(await k("Produits (mois)"))) throw new Error(await k("Produits (mois)")); if (!/5\s?000/.test(await k("Charges (mois)"))) throw new Error(await k("Charges (mois)"));
    if (!/15\s?000/.test(await k("Résultat net"))) throw new Error(await k("Résultat net")); if (!/\b2\b/.test(await k("Écritures"))) throw new Error(await k("Écritures")); if (!/\b3\b/.test(await k("Comptes actifs"))) throw new Error(await k("Comptes actifs"));
  });
  await step("vue d'ensemble : évolution du résultat, situation comptable (marge nette 75 %), accès rapide, MASTER (intégrité)", async () => {
    if (!(await page.getByRole("region", { name: "Évolution du résultat net" }).locator("svg").count())) throw new Error("évolution");
    if (!/75 %/.test(await page.getByRole("region", { name: "Situation comptable (ce mois)" }).innerText())) throw new Error("marge nette");
    if (!/intacte/.test(await page.getByRole("region", { name: "MASTER DOGUI — ICompta" }).innerText())) throw new Error("intégrité");
    await page.screenshot({ path: path.join(OUT, "kit12-icompta-1440.png"), fullPage: true });
    await page.getByRole("region", { name: "Accès rapide" }).getByRole("button", { name: "Plan comptable" }).click(); if ((await page.getByRole("tab", { name: "Plan comptable" }).getAttribute("aria-selected")) !== "true") throw new Error("accès rapide");
  });
  for (const [w, theme] of [[1600, "light"], [1280, "light"], [820, "light"], [390, "light"], [360, "light"], [1280, "dark"]]) await step(`${w} px ${theme} : aucun débordement (captures)`, async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("accueil")); await page.evaluate((t) => localStorage.setItem("dmp-theme", t), theme); await open(w, 900);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o); await page.screenshot({ path: path.join(OUT, `kit12-icompta-${theme}-${w}.png`), fullPage: true });
  });
  await page.evaluate(() => localStorage.setItem("dmp-theme", "light"));
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
