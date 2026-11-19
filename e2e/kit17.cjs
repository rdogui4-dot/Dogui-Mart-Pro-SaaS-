/** Lot K17 (kit) : Abonnement & Facturation — abonnement actuel (formule, échéance, jours restants, limites), formules au tarif réel, prochaine échéance (renouvellement manuel),
 *  reçus PDF des paiements validés, moyens de paiement « via Selar », avantages, constats MASTER, onglets Reçus / Paiements / Comparer, responsive. Lancement : bash e2e/run.sh kit17 */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
(async () => {
  const h = await start({ plan: "business", admin: true, expect: [] }); const { page, call } = h;
  const ok = async (r) => { const x = await r; if (x.status !== 200) throw new Error(JSON.stringify(x.body)); return x.body.data; };
  await ok(call("platform.settings.save", { selarLinks: { starter: "https://selar.com/aaa111", business: "https://selar.com/bbb222", pro: "https://selar.com/ccc333" } }));
  const a = await ok(call("subscription.checkout", { requestId: "request-k17-01", plan: "business", period: "month" }));
  await ok(call("subscription.submitProof", { paymentId: a.id, txRef: "SEL-445566", payerEmail: "dogui@exemple.sn" }));
  await ok(call("platform.payment.review", { paymentId: a.id, approve: true }));
  await ok(call("subscription.checkout", { requestId: "request-k17-02", plan: "pro", period: "year" })); // reste « À payer »
  const open = async (w = 1440, hh = 1000) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url("reglages?onglet=abonnement")); await page.getByRole("heading", { name: "Abonnement & Facturation" }).waitFor({ timeout: 15000 }); await page.getByRole("region", { name: "Abonnement actuel" }).waitFor({ timeout: 15000 }); await page.waitForTimeout(800); };
  const reg = (n) => page.getByRole("region", { name: n }); const aboTab = (n) => page.getByRole("tablist", { name: "Sections Abonnement & Facturation" }).getByRole("tab", { name: new RegExp("^" + n) });

  await step("onglets du kit ; abonnement actuel : formule Business, échéance, jours restants, limites réelles", async () => {
    await open();
    for (const t of ["Mon abonnement", "Reçus de paiement", "Paiements", "Comparer les offres"]) if (!(await aboTab(t).count())) throw new Error("onglet " + t);
    const cur = await reg("Abonnement actuel").innerText();
    if (!/Formule Business/.test(cur) || !/Actif/.test(cur) || !/jour\(s\) restant\(s\)/.test(cur) || !/1 \/ 3/.test(cur)) throw new Error(cur);
    if (!(await reg("Abonnement actuel").getByRole("button", { name: /Renouveler maintenant/ }).count())) throw new Error("bouton renouveler");
  });
  await step("formules au tarif réel (Business 15 000 F / mois, actuelle signalée) ; choix de durée ; prochaine échéance manuelle", async () => {
    const f = await reg("Formules").innerText(); if (!/Formule actuelle/.test(f) || !/15\s000/.test(f)) throw new Error(f);
    await reg("Formules").getByRole("tab", { name: "Annuel" }).click(); if (!/140\s000/.test(await reg("Formules").innerText())) throw new Error("annuel");
    const n = await reg("Prochaine échéance").innerText(); if (!/140\s000/.test(n) || !/aucun prélèvement automatique/.test(n)) throw new Error(n);
    await reg("Formules").getByRole("tab", { name: "Mensuel" }).click();
  });
  await step("moyens de paiement « Disponible via Selar » (jamais « Connecté »), avantages, constats MASTER réels", async () => {
    const m = await reg("Moyens de paiement").innerText(); if ((m.match(/Disponible via Selar/g) ?? []).length !== 3 || /Connecté/.test(m)) throw new Error(m);
    const av = await reg("Avantages de votre formule").innerText(); if (!/Boutiques\s*3/.test(av) || !/Modules ouverts\s*9 \/ 10/.test(av)) throw new Error(av);
    const ms = await reg("MASTER DOGUI — Abonnement").innerText(); if (!/Payer en annuel revient à 11\s507 F par mois au lieu de 15\s000 F \(−23 %\)/.test(ms)) throw new Error(ms);
    if (/code promo|prélèvement activé/i.test(await page.locator("main").innerText())) throw new Error("fonction inexistante affichée");
  });
  await step("reçu récent téléchargé en PDF (paiement validé)", async () => {
    const r = reg("Reçus récents"); if (!/15\s000/.test(await r.innerText())) throw new Error(await r.innerText());
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), r.getByRole("button", { name: /Télécharger le reçu/ }).click()]);
    const file = path.join(OUT, "kit17-recu.pdf"); await dl.saveAs(file); const head = fs.readFileSync(file).subarray(0, 5).toString(); if (head !== "%PDF-") throw new Error("pas un PDF : " + head);
    if (!/^recu-ABO-/.test(dl.suggestedFilename())) throw new Error(dl.suggestedFilename());
    await page.screenshot({ path: path.join(OUT, "kit17-abonnement-1440.png"), fullPage: true });
  });
  await step("onglets Reçus (1 reçu), Paiements (validé + à payer), Comparer (tarifs et modules)", async () => {
    await aboTab("Reçus de paiement").click(); const rc = await reg("Reçus de paiement").innerText(); if (!/Reçu PDF/.test(rc) || (rc.match(/ABO-/g) ?? []).length !== 1) throw new Error(rc);
    await aboTab("Paiements").click(); const p = await reg("Mes paiements").innerText(); if (!/Validé/.test(p) || !/À payer/.test(p)) throw new Error(p);
    await aboTab("Comparer les offres").click(); const c = await reg("Comparer les offres").innerText(); if (!/Prix ramené au mois/.test(c) || !/Rapports & Analyses/.test(c) || !/Inclus/.test(c)) throw new Error(c);
  });
  await step("comparer les offres : bouton par formule (actuelle : Renouveler), paiement ouvert, offre MASTER DOGUI avec liens annuel et mensuel", async () => {
    await aboTab("Comparer les offres").click(); const r = reg("Comparer les offres");
    if (!(await r.getByRole("button", { name: "Renouveler" }).count()) || !(await r.getByRole("button", { name: "Choisir Pro" }).count()) || !(await r.getByRole("button", { name: "Choisir Starter" }).count())) throw new Error("boutons par formule");
    const m = reg("MASTER DOGUI"); const hrefs = await m.locator("a").evaluateAll((a) => a.map((x) => x.href));
    if (!hrefs.includes("https://selar.com/il7v2a1w53") || !hrefs.includes("https://selar.com/9969pz0845")) throw new Error(hrefs.join(","));
    if (!/15\s000/.test(await m.innerText()) || !/2\s500/.test(await m.innerText())) throw new Error("prix MASTER");
    await page.screenshot({ path: path.join(OUT, "kit17-comparer-1440.png"), fullPage: true }); await r.getByRole("button", { name: "Choisir Pro" }).click(); await page.getByText(/Formule Pro/).first().waitFor({ timeout: 8000 }); await page.getByRole("button", { name: "Fermer" }).last().click();
  });
  for (const [w, theme] of [[1600, "light"], [1280, "light"], [820, "light"], [390, "light"], [1280, "dark"]]) await step(`${w} px ${theme} : aucun débordement (captures)`, async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("accueil")); await page.evaluate((t) => localStorage.setItem("dmp-theme", t), theme); await open(w, 900);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o); await page.screenshot({ path: path.join(OUT, `kit17-${theme}-${w}.png`), fullPage: true });
  });
  await page.evaluate(() => localStorage.setItem("dmp-theme", "light"));
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
