/** Tests navigateur de MASTER DOGUI : 5 onglets (Licence, Rapports, Profil, Recommandations, Assistant), exports PDF/Excel/CSV,
 *  affichage téléphone (390 px) et tablette (1024 px) sans débordement horizontal, noms accessibles, hors ligne. Captures dans e2e/out/. */
const fs = require("fs"), path = require("path");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); const results = [];
const step = async (name, fn) => { try { await fn(); results.push(["OK  ", name]); console.log("OK  ", name); } catch (e) { results.push(["FAIL", name]); console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 4).join(" | ").slice(0, 700)); } };
(async () => {
  const h = await start({ plan: "pro", expect: ["md.chat.ask"] }); const { page, st } = h; const A = h.shop; // le 429 du délai entre deux questions est provoqué volontairement
  const txt = async () => (await page.locator("body").innerText()).replace(/\s+/g, " "); const wait = (t, ms = 8000) => page.waitForFunction((x) => document.body.innerText.replace(/\s+/g, " ").includes(x), t, { timeout: ms });
  const tab = async (n) => { await page.getByRole("tab", { name: n, exact: true }).click(); await page.waitForTimeout(500); };
  const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}.png`) });
  const noOverflow = async (label) => { const w = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, i: window.innerWidth })); if (w.s > w.i + 1) throw new Error(`${label} : débordement horizontal (${w.s} > ${w.i})`); };
  const unnamed = async (label) => { const bad = await page.evaluate(() => [...document.querySelectorAll("button, [role=button], a[href], input, select")].filter((e) => { const r = e.getBoundingClientRect(); if (!r.width || !r.height) return false; const n = (e.getAttribute("aria-label") || e.innerText || e.getAttribute("title") || (e.labels && [...e.labels].map((l) => l.innerText).join("")) || e.getAttribute("placeholder") || "").trim(); return !n; }).map((e) => e.outerHTML.slice(0, 80))); if (bad.length) throw new Error(`${label} : éléments sans nom accessible : ${bad.slice(0, 3).join(" ; ")}`); };
  const download = async (btnName, check) => { const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 8000 }), page.getByRole("button", { name: btnName, exact: true }).first().click()]); const f = path.join(OUT, dl.suggestedFilename()); await dl.saveAs(f); const buf = fs.readFileSync(f); await check(buf, dl.suggestedFilename()); };
  fs.mkdirSync(OUT, { recursive: true });

  // ---- données de départ : licence d'essai, un article en rupture, une vente, une clôture de caisse
  st.rows("shops").forEach((s) => { s.phone = "0701020304"; });
  const eau = (await h.call("article.save", { data: { name: "Eau", price: 500, cost: 300 }, initialQty: 50 }, A)).body.data.id; const riz = (await h.call("article.save", { data: { name: "Riz", price: 1000, cost: 700 }, initialQty: 5 }, A)).body.data.id;
  await h.call("stk.correct", { productId: riz, delta: -5, reason: "casse", requestKey: "e2e-rupture-0001" }, A);

  await step("Licence : onglet, démarrage de l'essai gratuit, état affiché", async () => { await page.goto(h.url("master")); await wait("MASTER DOGUI"); await tab("Licence"); await page.getByRole("button", { name: /Démarrer l'essai gratuit/ }).click(); await wait("Essai gratuit en cours"); await shot("1-licence-mobile"); });
  await h.call("cash.open", { openingFloat: 5000 }, A); await h.call("checkout", { clientId: "vente-e2e-0001", lines: [{ productId: eau, qty: 4 }], payments: [{ method: "cash", amount: 2000 }] }, A); await h.call("cash.close", { counted: 7000 }, A);

  await step("Rapports : rapport de clôture listé, ouverture, export CSV / Excel / PDF (contenu vérifié)", async () => {
    await page.goto(h.url("master")); await tab("Rapports"); await wait("Rapport de clôture"); await page.getByText("Rapport de clôture", { exact: false }).first().click(); await wait("Méthode et limites"); await shot("2-rapport-mobile");
    await download("Exporter ce rapport en CSV", (b, n) => { const s = b.toString("utf8"); if (!n.endsWith(".csv") || b[0] !== 0xef || !s.includes("Ventes") || !s.includes("Méthodes et limites")) throw new Error("CSV invalide : " + n); });
    await download("Exporter ce rapport en Excel", (b, n) => { if (!n.endsWith(".xlsx") || String.fromCharCode(b[0], b[1]) !== "PK") throw new Error("Excel invalide : " + n); });
    await download("Exporter ce rapport en PDF", (b, n) => { if (!n.endsWith(".pdf") || b.slice(0, 4).toString() !== "%PDF") throw new Error("PDF invalide : " + n); });
    await noOverflow("rapport"); await unnamed("rapport"); await page.keyboard.press("Escape"); });

  await step("Profil : fait vérifié affiché, saisie d'un fait déclaré, confirmation d'une hypothèse, suppression", async () => {
    await page.goto(h.url("master")); await tab("Profil"); await wait("Vérifié"); await page.getByRole("button", { name: "Secteur d'activité" }).click(); await page.getByLabel("Secteur d'activité", { exact: true }).selectOption("alimentation"); await page.getByRole("button", { name: "Enregistrer" }).click(); await wait("Alimentation"); await wait("Déclaré");
    await page.getByRole("button", { name: "Taille (nombre de personnes)" }).click(); await page.getByLabel("Taille (nombre de personnes)", { exact: true }).selectOption("3-5"); await page.getByLabel("Qualification").selectOption("hypothesis"); await page.getByRole("button", { name: "Enregistrer" }).click(); await wait("Hypothèse"); await page.getByRole("button", { name: "Confirmer" }).click(); await page.waitForTimeout(600);
    if ((await txt()).includes("Hypothèse")) throw new Error("hypothèse non confirmée"); await shot("3-profil-mobile"); await noOverflow("profil"); await unnamed("profil"); page.once("dialog", (d) => d.accept()); await page.getByRole("button", { name: "Supprimer" }).first().click(); await page.waitForTimeout(600); });

  await step("Recommandations : actualisation, carte avec motif et sources, décision (accepter), export de la liste", async () => {
    await page.goto(h.url("master")); await tab("Recommandations"); await page.getByRole("button", { name: /Actualiser les recommandations/ }).click(); await wait("recommandation(s)"); await wait("rupture"); await page.getByRole("button", { name: /Voir le motif et les sources/ }).first().click(); await wait("Source :");
    await page.getByRole("button", { name: "Accepter" }).first().click(); await wait("Acceptée"); await shot("4-recommandations-mobile");
    await download("Exporter la liste en CSV", (b, n) => { const s = b.toString("utf8"); if (!n.endsWith(".csv") || !s.includes("Recommandation") || !s.includes("Acceptée")) throw new Error("CSV recommandations invalide : " + n); });
    await noOverflow("recommandations"); await unnamed("recommandations"); });

  await step("Assistant : question guidée, réponse chiffrée sourcée, « Plus de questions » (21 sujets), export de la réponse", async () => {
    await page.goto(h.url("master")); await tab("Assistant"); await wait("Mode guidé"); await page.getByRole("button", { name: "Quelles sont mes ventes ?" }).click(); await wait("Calculé par MASTER DOGUI, sans IA"); const t = await txt(); if (!/Total des ventes/.test(t) || !/Source : Caisse/.test(t)) throw new Error("réponse sans chiffres ou sans source");
    const before = (await page.locator("[role=group][aria-label='Questions guidées'] button").count()); await page.getByRole("button", { name: /Plus de questions/ }).click(); const after = await page.locator("[role=group][aria-label='Questions guidées'] button").count(); if (!(before <= 10 && after >= 21)) throw new Error(`liste de questions : ${before} -> ${after}`);
    await download("Exporter cette réponse en CSV", (b, n) => { if (!n.endsWith(".csv") || !b.toString("utf8").includes("Nombre de ventes")) throw new Error("CSV assistant invalide : " + n); }); await shot("5-assistant-mobile"); await noOverflow("assistant"); await unnamed("assistant"); });

  await step("Assistant : délai de 5 s annoncé clairement, puis question libre hors sujet = aucune improvisation ; plafond et privacité annoncés", async () => {
    await page.getByLabel("Votre question").fill("Raconte-moi une blague"); await page.getByRole("button", { name: "Envoyer" }).click(); await wait("patientez un instant"); await page.waitForTimeout(5300); await page.getByRole("button", { name: "Envoyer" }).click(); await wait("Question non comprise"); const t = await txt(); if (!/privées/.test(t) || !/Questions restantes aujourd'hui/.test(t)) throw new Error("privacité ou quota non annoncés"); });

  await step("Assistant : hors connexion, la question est conservée avec un message explicite (jamais perdue en silence)", async () => {
    await page.context().setOffline(true); await page.waitForTimeout(300); await page.getByLabel("Votre question").fill("Quelles sont mes ventes ce mois ?"); await page.getByRole("button", { name: "Envoyer" }).click(); await wait("Hors connexion"); const v = await page.getByLabel("Votre question").inputValue(); await page.context().setOffline(false); if (!v.includes("ventes ce mois")) throw new Error("question perdue hors ligne"); });

  await step("Tablette (1024 px) : les 5 onglets s'affichent sans débordement ni élément sans nom", async () => {
    await page.setViewportSize({ width: 1024, height: 768 }); for (const n of ["Licence", "Rapports", "Profil", "Recommandations", "Assistant"]) { await tab(n); await noOverflow(`tablette ${n}`); await unnamed(`tablette ${n}`); } await shot("6-assistant-tablette"); await page.setViewportSize({ width: 390, height: 800 }); });

  await step("Expiration : l'historique reste consultable, nouvelles questions et actualisations suspendues", async () => {
    const l = st.rows("md_licenses")[0]; l.status = "expired"; l.trialEndsAt = new Date(Date.now() - 864e5).toISOString(); l.paidUntil = l.trialEndsAt; await page.goto(h.url("master")); await tab("Assistant"); await wait("Licence MASTER DOGUI inactive"); const dis = await page.getByRole("group", { name: "Questions guidées" }).getByRole("button", { name: "Quelles sont mes ventes ?" }).isDisabled(); if (!dis) throw new Error("question guidée active sans licence");
    await tab("Recommandations"); await wait("Licence MASTER DOGUI inactive"); if (!(await page.getByRole("button", { name: /Actualiser les recommandations/ }).isDisabled())) throw new Error("actualisation active sans licence"); });

  const errs = h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource|net::ERR_INTERNET_DISCONNECTED/.test(e));
  console.log("ERRORS", errs, "\nBAD", h.bad.map((b) => b.slice(0, 140))); await h.close();
  const failed = results.filter((r) => r[0] === "FAIL").length; console.log(failed ? `${failed} ÉCHEC(S)` : "TOUT PASSE"); process.exit(failed || errs.length ? 1 : 0);
})();
