/** Lot K8 (kit 24 interfaces) : Dépenses & Charges (écran 14) — en-tête et « Enregistrer une dépense », 5 indicateurs réels, onglets du kit (Budgets et Charges récurrentes intégrés en Pro, verrouillés en Business), répartition, tendance 6 mois, top catégories, encart MASTER, responsive. Lancement : bash e2e/run.sh kit8 */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
(async () => {
  const h = await start({ plan: "pro", expect: [] }); const { page } = h; const A = h.shop; const day = new Date().toISOString().slice(0, 10);
  const exp = (label, category, amount) => h.call("expense.create", { requestId: crypto.randomUUID(), label, category, amount, spentOn: day, method: "transfer", source: "external", reference: "R-" + label.slice(0, 6) }, A);
  await exp("Loyer boutique", "loyer", 60000); await exp("Facture électricité", "electricite", 25000); await exp("Transport marchandises", "transport", 15000);
  const open = async (w = 1440, hh = 1000) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url("depenses")); await page.getByRole("heading", { name: "Dépenses & Charges" }).waitFor({ timeout: 15000 }); await page.waitForTimeout(1500); };

  await step("en-tête du kit, « Enregistrer une dépense » ouvre le formulaire, onglets du kit", async () => {
    await open(); await page.getByRole("button", { name: "Enregistrer une dépense" }).click(); await page.getByLabel("Libellé").waitFor({ timeout: 5000 }); await page.keyboard.press("Escape");
    for (const t of ["Liste des dépenses", "Catégories", "Charges récurrentes", "Budgets", "Analyses"]) if (!(await page.getByRole("tab", { name: t, exact: true }).count())) throw new Error("onglet " + t);
  });
  await step("5 indicateurs réels : ce mois 100 000 F, 3 dépenses, principale charge Loyer (60 %), écart vs période précédente", async () => {
    const k = (l) => page.getByRole("group", { name: l }).innerText();
    if (!/100\s?000/.test(await k("Dépenses ce mois"))) throw new Error(await k("Dépenses ce mois")); if (!/100\s?000/.test(await k("Total des dépenses"))) throw new Error(await k("Total des dépenses"));
    if (!/\b3\b/.test(await k("Nombre de dépenses"))) throw new Error(await k("Nombre de dépenses")); if (!/Loyer \(60 %\)/.test(await k("Principale charge"))) throw new Error(await k("Principale charge"));
    if (!/\+\s?100\s?000|100\s?000/.test(await k("Écart vs période précédente"))) throw new Error(await k("Écart vs période précédente"));
  });
  await step("répartition (Loyer, Électricité, Transport), tendance 6 mois, top catégories avec parts", async () => {
    const r = await page.getByRole("region", { name: "Répartition des dépenses (ce mois)" }).innerText(); for (const x of ["Loyer", "Électricité", "Transport"]) if (!r.includes(x)) throw new Error(r);
    if (!(await page.getByRole("region", { name: "Tendance des dépenses" }).locator("svg").count())) throw new Error("tendance absente");
    const top = await page.getByRole("region", { name: "Top catégories (ce mois)" }).innerText(); if (!/Loyer[\s\S]*60\s?000[\s\S]*60 %[\s\S]*Électricité[\s\S]*25 %/.test(top)) throw new Error(top);
    await page.screenshot({ path: path.join(OUT, "kit8-depenses-1440.png"), fullPage: true });
  });
  await step("encart MASTER : part du loyer et absence de budget (constats réels, aucune action automatique)", async () => {
    const md = await page.getByRole("region", { name: "MASTER DOGUI — Dépenses" }).innerText(); if (!/Loyer représente 60 %/.test(md) || !/Aucun budget mensuel/.test(md)) throw new Error(md.slice(0, 300));
  });
  await step("onglets Pro intégrés : Budgets et Charges récurrentes s'ouvrent ; Analyses montre le rapport", async () => {
    await page.getByRole("tab", { name: "Budgets", exact: true }).click(); await page.getByText(/Définir un budget|Aucun budget/).first().waitFor({ timeout: 8000 });
    await page.getByRole("tab", { name: "Charges récurrentes" }).click(); await page.getByText(/À payer/).first().waitFor({ timeout: 8000 });
    await page.getByRole("tab", { name: "Analyses" }).click(); await page.getByText("En attente de validation").waitFor({ timeout: 8000 });
  });
  await step("formule Business : Budgets et Charges récurrentes verrouillés (cadenas, écran Pro)", async () => {
    await h.setPlan?.("business"); if (!h.setPlan) { const sub = h.st.rows("subscriptions")[0]; if (sub) sub.plan = "business"; }
    await open(); await page.getByRole("tab", { name: /Budgets/ }).click(); await page.getByText(/Pro/).first().waitFor({ timeout: 6000 });
    if (!(await page.getByRole("tab", { name: /Budgets/ }).getByLabel("Réservé à une offre supérieure").count())) throw new Error("cadenas absent");
    const sub = h.st.rows("subscriptions")[0]; if (sub) sub.plan = "pro";
  });
  for (const [w, theme] of [[1600, "light"], [1024, "light"], [820, "light"], [390, "light"], [360, "light"], [1280, "dark"]]) await step(`${w} px ${theme} : aucun débordement (captures)`, async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("accueil")); await page.evaluate((t) => localStorage.setItem("dmp-theme", t), theme); await open(w, 900);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o); await page.screenshot({ path: path.join(OUT, `kit8-depenses-${theme}-${w}.png`), fullPage: true });
  });
  await page.evaluate(() => localStorage.setItem("dmp-theme", "light"));
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
