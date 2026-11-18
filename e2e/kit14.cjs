/** Lot K14 (kit 24 interfaces) : MASTER DOGUI en page complète (écran 20) — sans licence : vue réservée ; essai démarré : santé expliquée, alertes, synthèse du mois, insights, actions rapides vers l'assistant, état réel de l'IA, accès par la barre supérieure, responsive. Lancement : bash e2e/run.sh kit14 */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
(async () => {
  const h = await start({ plan: "business", expect: [] }); const { page, st } = h; const A = h.shop; const T = st.rows("shops")[0].tenantId;
  await st.update("shops", A, { phone: "+225 07 01 02 03 04" });
  const open = async (w = 1440, hh = 1000, onglet = "") => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url(`master${onglet ? `?onglet=${onglet}` : ""}`)); await page.getByRole("heading", { name: /MASTER DOGUI — Le cerveau intelligent/ }).waitFor({ timeout: 15000 }); await page.waitForTimeout(1500); };

  await step("sans licence : page MASTER avec onglets, vue d'ensemble réservée à la licence, licence affichée", async () => {
    await open(); for (const t of ["Vue d'ensemble", "Assistant", "Recommandations", "Rapports MASTER", "Profil", "Licence"]) if (!(await page.getByRole("tab", { name: t }).count())) throw new Error("onglet " + t);
    await page.getByText(/réservée à la licence MASTER active/).waitFor({ timeout: 5000 }); if (!(await page.getByRole("button", { name: /Démarrer l'essai gratuit/ }).count())) throw new Error("bouton d'essai");
  });
  await step("essai démarré + ventes de deux mois : santé (règles), synthèse +20 %, insights réels, état de l'IA « Mode guidé »", async () => {
    const r = await h.call("md.trial.start", {}, ""); if (r.status !== 200) throw new Error(JSON.stringify(r.body));
    const now = new Date(); const prevM = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 10)).toISOString(); const curM = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 9)).toISOString();
    for (const [id, total, at] of [["s1", 100000, prevM], ["s2", 120000, curM]]) await st.create("sales", id, T, { tenantId: T, shopId: A, number: id, total, vat: 0, status: "paid", soldAt: at, lines: JSON.stringify([{ productId: "p1", name: "Riz 25 kg", qty: 1, unitPrice: total, unitCost: total / 2 }]), payments: "[]" });
    await open(); const health = await page.getByRole("region", { name: "Santé globale de l'activité" }).innerText(); if (!/Ventes : Bon/.test(health)) throw new Error(health);
    const syn = await page.getByRole("region", { name: "Synthèse de l'activité (ce mois)" }).innerText(); if (!/120[\s ]?000/.test(syn) || !/\+20 %/.test(syn)) throw new Error(syn);
    const ins = await page.getByRole("region", { name: "Insights du jour" }).innerText(); if (!/augmenté de 20 %/.test(ins) || !/Riz 25 kg/.test(ins)) throw new Error(ins);
    if (!(await page.getByLabel("État de l'IA : mode guidé").count())) throw new Error("état IA"); await page.screenshot({ path: path.join(OUT, "kit14-master-1440.png"), fullPage: true });
    await page.getByText("Comment est calculé ce score ?").click(); if (!/20 points/.test(await page.getByRole("region", { name: "Santé globale de l'activité" }).innerText())) throw new Error("méthode");
  });
  await step("action rapide « Analyser mon activité » → onglet Assistant, question envoyée et réponse affichée", async () => {
    await page.getByRole("button", { name: "Analyser mon activité" }).click(); await page.getByRole("tab", { name: "Assistant", selected: true }).waitFor({ timeout: 5000 });
    await page.getByLabel("Conversation").waitFor({ timeout: 15000 }); if (!/Comment se porte mon commerce/.test(await page.getByLabel("Conversation").innerText())) throw new Error("question non envoyée"); if (/qid=/.test(page.url())) throw new Error("question restée dans l'adresse");
  });
  await step("question libre depuis la vue d'ensemble → assistant ; « Voir et décider » → onglet Recommandations ; « Simuler un investissement » → IProj", async () => {
    await page.waitForTimeout(5500); await open(); await page.getByLabel("Posez votre question à MASTER DOGUI").fill("Quels articles sont en rupture ?"); await page.getByRole("button", { name: "Envoyer la question" }).click();
    await page.getByLabel("Conversation").waitFor({ timeout: 15000 }); if (!/Quels articles sont en rupture/.test(await page.getByLabel("Conversation").innerText())) throw new Error("question libre");
    await open(); await page.getByRole("button", { name: /Ouvrir les recommandations|Voir et décider/ }).first().click(); await page.getByRole("tab", { name: "Recommandations", selected: true }).waitFor({ timeout: 5000 });
    await open(); await page.getByRole("button", { name: "Simuler un investissement" }).click(); await page.getByRole("heading", { name: /IProj-Invest/ }).first().waitFor({ timeout: 10000 });
  });
  await step("menu latéral (ordinateur) et bouton de la barre supérieure (téléphone) → page /master, plus de fenêtre", async () => {
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(h.url("accueil")); await page.waitForTimeout(1200); await page.getByRole("link", { name: "MASTER DOGUI" }).first().click(); await page.waitForURL(/\/master/, { timeout: 8000 }); if (await page.getByRole("dialog").count()) throw new Error("fenêtre encore ouverte");
    await page.setViewportSize({ width: 390, height: 800 }); await page.goto(h.url("accueil")); await page.waitForTimeout(1200); await page.getByRole("button", { name: "MASTER DOGUI" }).first().click(); await page.waitForURL(/\/master/, { timeout: 8000 }); if (await page.getByRole("dialog").count()) throw new Error("fenêtre encore ouverte (téléphone)");
  });
  for (const [w, theme] of [[1600, "light"], [1280, "light"], [820, "light"], [390, "light"], [360, "light"], [1280, "dark"]]) await step(`${w} px ${theme} : aucun débordement (captures)`, async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("accueil")); await page.evaluate((t) => localStorage.setItem("dmp-theme", t), theme); await open(w, 900);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o); await page.screenshot({ path: path.join(OUT, `kit14-master-${theme}-${w}.png`), fullPage: true });
  });
  await page.evaluate(() => localStorage.setItem("dmp-theme", "light"));
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
