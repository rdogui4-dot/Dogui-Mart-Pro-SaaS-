/** Lot K19 (kit) : Assistant MASTER — trois colonnes (conversations, échange, contexte actif + actions rapides), réponse en cartes avec écart réel vs période précédente,
 *  enseignements, sources/méthode/limites visibles, périodes au mois calendaire, actions rapides reliées aux vraies questions, aucune mention inventée, responsive. Lancement : bash e2e/run.sh kit19 */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
(async () => {
  const h = await start({ plan: "business", expect: [] }); const { page, st } = h; const A = h.shop; const T = st.rows("shops")[0].tenantId;
  await st.update("shops", A, { phone: "+225 07 01 02 03 04" });
  const r = await h.call("md.trial.start", {}, ""); if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  const ago = (d) => new Date(Date.now() - d * 864e5 - 3600e3).toISOString();
  for (const [id, total, at] of [["s1", 100000, ago(9)], ["s2", 120000, ago(0)]]) await st.create("sales", id, T, { tenantId: T, shopId: A, number: id, total, vat: 0, status: "paid", soldAt: at, lines: JSON.stringify([{ productId: "p1", name: "Riz 25 kg", qty: 1, unitPrice: total, unitCost: total / 2 }]), payments: JSON.stringify([{ method: "cash", amount: total }]) });
  const open = async (w = 1600, hh = 1000) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url("master?onglet=chat")); await page.getByRole("region", { name: "Échange avec MASTER DOGUI" }).waitFor({ timeout: 15000 }); await page.waitForTimeout(800); };
  const reg = (n) => page.getByRole("region", { name: n });

  await step("trois colonnes : historique + nouvelle conversation, échange, contexte actif, actions rapides ; état réel de l'IA ; aucun micro", async () => {
    await open();
    if (!(await page.getByRole("navigation", { name: "Historique" }).count())) throw new Error("historique");
    if (!(await page.getByRole("button", { name: "Nouvelle conversation" }).count())) throw new Error("nouvelle conversation");
    for (const n of ["Contexte actif", "Actions rapides", "Ce que fait MASTER DOGUI"]) if (!(await reg(n).count())) throw new Error(n);
    if (!/Mode guidé|IA active/.test(await page.locator("main").innerText())) throw new Error("état IA");
    const all = await page.locator("main").innerText(); if (/Apprend de l'activité|micro/i.test(all)) throw new Error("mention inventée");
    if (!(await page.getByRole("combobox", { name: "Période" }).locator("option", { hasText: "Mois en cours" }).count())) throw new Error("période mois");
  });
  await step("action rapide « Analyser mes ventes » : cartes réelles, écart +20 % vs période précédente, sources dans le contexte actif", async () => {
    await reg("Actions rapides").getByRole("button", { name: /Analyser mes ventes/ }).click();
    await page.getByLabel("Indicateurs de la réponse").waitFor({ timeout: 15000 });
    const c = await page.getByLabel("Indicateurs de la réponse").innerText(); if (!/Total des ventes/.test(c) || !/120[\s  ]?000/.test(c) || !/\+20 % vs période précédente/.test(c)) throw new Error(c);
    const conv = await page.getByLabel("Conversation").innerText(); if (!/Source :/.test(conv) || !/Méthode :/.test(conv)) throw new Error("sources/méthode absentes");
    const ctx = await reg("Contexte actif").innerText(); if (!/Données utilisées : Caisse/.test(ctx) || !/7 derniers jours/.test(ctx)) throw new Error(ctx);
    await page.screenshot({ path: path.join(OUT, "kit19-assistant-1600.png"), fullPage: true });
  });
  await step("période « Mois en cours » : réponse datée du 1er du mois", async () => {
    await page.waitForTimeout(5500); await page.getByRole("combobox", { name: "Période" }).selectOption({ label: "Mois en cours" });
    await reg("Actions rapides").getByRole("button", { name: /Analyser mes ventes/ }).click(); await page.waitForTimeout(2500);
    const ctx = await reg("Contexte actif").innerText(); if (!/mois en cours/.test(ctx) || !/\(1 /.test(ctx)) throw new Error(ctx);
  });
  await step("question libre puis nouvelle conversation (historique conservé)", async () => {
    await page.waitForTimeout(5500); await page.getByLabel("Votre question").fill("Quels articles sont en rupture ?"); await page.getByRole("button", { name: "Envoyer" }).click(); await page.waitForTimeout(2500);
    if (!/Quels articles sont en rupture/.test(await page.getByLabel("Conversation").innerText())) throw new Error("question libre");
    await page.getByRole("button", { name: "Nouvelle conversation" }).click(); if (await page.getByLabel("Conversation").count()) throw new Error("conversation non réinitialisée");
    if ((await page.getByRole("navigation", { name: "Historique" }).getByRole("button", { name: /^Supprimer/ }).count()) < 1) throw new Error("historique vide");
  });
  for (const [w, theme] of [[1600, "light"], [1280, "light"], [820, "light"], [390, "light"], [1280, "dark"]]) await step(`${w} px ${theme} : aucun débordement (captures)`, async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("accueil")); await page.evaluate((t) => localStorage.setItem("dmp-theme", t), theme); await open(w, 900);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o); await page.screenshot({ path: path.join(OUT, `kit19-${theme}-${w}.png`), fullPage: true });
  });
  await page.evaluate(() => localStorage.setItem("dmp-theme", "light"));
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
