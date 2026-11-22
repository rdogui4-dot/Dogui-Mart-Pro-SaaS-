/** Lot S2-c : Centre de sécurité (Security Guardian) — contrôles mesurés (« Inconnu » sans mesure), score expliqué, journal chaîné (filtres, export, rupture détectée), réservé au propriétaire, responsive.
 *  Lancement : bash e2e/run.sh kit29 */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
(async () => {
  const h = await start({ plan: "business", expect: ["security.status", "security.events", "stk.alerts"] }); const { page, st } = h; const T = "t1";
  const cashier = (await h.call("staff.create", { name: "Moussa", username: "moussa", password: "motdepasse1", role: "cashier", shopIds: [h.shop] }, "")).body.data.userId;
  await h.handle(st, cashier, { action: "staff.create", tenantId: T, shopId: "", payload: {} }, {}); // refus : droits insuffisants (événement du commerce)
  await h.handle(st, "etranger", { action: "sales.list", tenantId: T, shopId: h.shop, payload: {} }, {}); // étranger : va au journal de la plateforme, jamais à celui du commerce
  const open = async (w = 1440, hh = 1000) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url("securite")); await page.getByRole("heading", { name: "Security Guardian", level: 1 }).waitFor({ timeout: 15000 }); await page.getByRole("region", { name: "Niveau de sécurité" }).waitFor({ timeout: 15000 }); };
  const txt = async () => (await page.locator("main, body").first().innerText()).replace(/\s+/g, " ");

  await step("page réservée au propriétaire, entrée « Security Guardian » dans le menu ; score avec explication et couverture ; aucun compteur décoratif", async () => {
    await open(); const t = await txt();
    if (!/\d+ \/ 100/.test(t) || !/Couverture : \d+ %/.test(t)) throw new Error("score / couverture : " + t.slice(0, 300));
    if (!(await page.getByText("Comment ce score est-il calculé ?").count())) throw new Error("explication du score absente");
    if (/attaques bloquées|pays sources|IP bloquées|Tentatives d'intrusion/i.test(t)) throw new Error("compteur décoratif affiché");
    if (!(await page.getByRole("link", { name: /Security Guardian/ }).count())) throw new Error("entrée de menu absente");
    await page.screenshot({ path: path.join(OUT, "kit29-controles-1440.png"), fullPage: true });
  });
  await step("10 contrôles : sauvegardes « Inconnu » (aucune mesure, jamais conforme), synchronisation « Sans objet », 2FA « À surveiller » puis « Conforme » une fois mesurée", async () => {
    const cards = page.getByRole("listitem", { name: /.+/ }); const n = await cards.count(); if (n !== 10) throw new Error("contrôles : " + n);
    const back = page.getByRole("listitem", { name: "Sauvegardes du poste" }); const bt = await back.innerText(); if (!/Inconnu/.test(bt) || !/aucune mesure/.test(bt) || /Conforme/.test(bt)) throw new Error("sauvegardes : " + bt);
    if (!/Sans objet/.test(await page.getByRole("listitem", { name: "Synchronisation du poste avec le cloud" }).innerText())) throw new Error("sync");
    const m = page.getByRole("listitem", { name: "Double authentification des propriétaires" }); if (!/À surveiller/.test(await m.innerText())) throw new Error("2FA avant : " + (await m.innerText()));
    st.security.set("u1", { lastLogin: null, sessions24h: 0, mfa: true }); await page.getByRole("button", { name: "Actualiser" }).click(); await page.waitForFunction(() => /Conforme/.test(document.querySelector('[aria-label="Double authentification des propriétaires"]')?.textContent ?? ""), null, { timeout: 8000 });
  });
  await step("journal : événements réels (employé créé, refus pour droits insuffisants), chaîne vérifiée ; l'étranger n'apparaît PAS dans le journal du commerce", async () => {
    await page.getByRole("tab", { name: /Journal de sécurité/ }).click(); await page.getByText(/Chaîne vérifiée/).waitFor({ timeout: 8000 });
    const t = await txt(); if (!/Employé créé/.test(t) || !/droits insuffisants/.test(t)) throw new Error("événements : " + t.slice(0, 400)); if (/étranger au commerce/.test(t)) throw new Error("tentative d'un étranger dans le journal du commerce");
    if (/motdepasse|moussa/.test(t)) throw new Error("donnée sensible dans le journal");
    await page.screenshot({ path: path.join(OUT, "kit29-journal-1440.png"), fullPage: true });
  });
  await step("filtres (type, gravité, recherche) et export CSV du journal filtré", async () => {
    await page.getByLabel("Type").selectOption({ label: "Employé créé" }); await page.waitForTimeout(200); let t = await txt(); if (/droits insuffisants/.test(t.split("Journal en ajout seulement")[0].replace(/Action refusée : droits insuffisants/g, "X").includes("X") ? "" : "")) throw new Error("filtre"); if (!/1 événement\(s\) affiché\(s\)/.test(t)) throw new Error("filtre type : " + t.slice(t.indexOf("événement(s)") - 40, t.indexOf("événement(s)") + 60));
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exporter en CSV" }).click()]); const f = await dl.path(); const csv = fs.readFileSync(f, "utf8");
    if (!/Journal de sécurité/.test(csv) || !/Employé créé/.test(csv) || /droits insuffisants/.test(csv) || !/Chaîne d'empreintes vérifiée/.test(csv)) throw new Error("CSV : " + csv.slice(0, 300));
    await page.getByLabel("Type").selectOption(""); await page.getByLabel("Gravité").selectOption({ label: "Avertissement" }); await page.waitForTimeout(200); t = await txt(); const tb = (await page.getByRole("table", { name: "Journal de sécurité" }).innerText()).replace(/\s+/g, " "); if (!/droits insuffisants/.test(tb) || /Employé créé/.test(tb)) throw new Error("filtre gravité : " + tb.slice(0, 200));
    await page.getByLabel("Gravité").selectOption("");
  });
  await step("suppression d'un événement : rupture de chaîne signalée dans le journal ET contrôle d'intégrité « Critique »", async () => {
    const rows = st.rows("security_events").filter((r) => r.tenantId === T).sort((a, b) => a.seq - b.seq); await st.remove("security_events", rows[0].$id);
    await page.getByRole("button", { name: "Actualiser" }).click(); await page.getByRole("tab", { name: /Contrôles/ }).click();
    await page.waitForFunction(() => /Critique/.test(document.querySelector('[aria-label="Intégrité du journal de sécurité"]')?.textContent ?? ""), null, { timeout: 8000 });
    await page.getByRole("tab", { name: /Journal de sécurité/ }).click(); await page.getByRole("alert").filter({ hasText: "Rupture de chaîne" }).waitFor({ timeout: 8000 });
  });
  await step("« Ce qui n'est pas mesuré » : limites dites (réglages Appwrite, sauvegardes cloud, connexions échouées)", async () => {
    await page.getByRole("tab", { name: /Ce qui n'est pas mesuré/ }).click(); const t = await txt(); if (!/Politique de mots de passe/.test(t) || !/Connexions échouées/.test(t) || !/pare-feu applicatif/.test(t)) throw new Error(t.slice(0, 300));
  });
  for (const [w, theme] of [[1600, "light"], [820, "light"], [390, "light"], [1280, "dark"]]) await step(`${w} px ${theme} : aucun débordement (captures)`, async () => {
    await page.evaluate((t) => localStorage.setItem("dmp-theme", t), theme); await open(w, 900); const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o);
    await page.getByRole("tab", { name: /Journal de sécurité/ }).click(); await page.waitForTimeout(300); const o2 = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o2 > 1) throw new Error("débordement journal " + o2); await page.screenshot({ path: path.join(OUT, `kit29-${theme}-${w}.png`), fullPage: true });
  });
  await page.evaluate(() => localStorage.setItem("dmp-theme", "light"));
  await step("un gérant n'a ni l'entrée de menu ni la page (accès refusé), et le serveur refuse aussi", async () => {
    await st.grant(T, "u1", ["manager"], []); await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(h.url("securite")); await page.waitForTimeout(1500); const t = await txt();
    if (/Niveau de sécurité/.test(t) && /\d+ \/ 100/.test(t)) throw new Error("page visible pour un gérant"); const r = await h.handle(st, "u1", { action: "security.status", tenantId: T, shopId: "", payload: {} }, {}); if (r.status !== 403) throw new Error("serveur : " + r.status);
  });
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
