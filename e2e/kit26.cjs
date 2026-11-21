/** Version Windows, lot 4d : un poste vierge se rattache à un commerce du cloud (faux Appwrite, vrai moteur métier), onglet « Synchronisation » du propriétaire, coupure réseau, session perdue + bandeau,
 *  reconnexion, constats à examiner, restauration depuis le cloud, retour au cloud ; le caissier ne voit rien. Lancement : bash e2e/run.sh kit26 */
const path = require("path"), fs = require("fs"), os = require("os");
const { chromium } = require("playwright");
const { startLocalServer } = require("./.build/local.cjs");
const { startFakeCloud } = require("./.build/fake-cloud.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 500)); } };
(async () => {
  const fake = await startFakeCloud(); const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dmp-sync-e2e-")); const web = path.join(__dirname, ".build", "local-site");
  const srv = await startLocalServer({ dataDir, webRoot: web, port: 0, host: "127.0.0.1", cloud: { config: { endpoint: fake.url, projectId: "e2e" } } }); const base = `http://127.0.0.1:${srv.port}`;
  const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); const page = await ctx.newPage(); page.on("dialog", (d) => void d.accept());
  const errors = []; page.on("pageerror", (e) => errors.push(String(e.message))); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|WebSocket|ERR_/.test(m.text())) errors.push(m.text()); });
  const token = () => page.evaluate(() => localStorage.getItem("dmp.local.token"));
  const exec = async (action, payload, tenantId, shopId = "", tk) => { const r = await fetch(`${base}/v1/execute`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tk ?? await token()}` }, body: JSON.stringify({ action, tenantId, shopId, payload }) }); return { status: r.status, body: await r.json() }; };
  const openSync = async () => { await page.goto(base + "/reglages"); await page.getByRole("tab", { name: "Synchronisation" }).click(); await page.getByText("Synchronisation avec le cloud").first().waitFor({ timeout: 20000 }); };
  const T = fake.T; let shopId = "";

  await step("poste vierge : « Rattacher à mon commerce cloud » → le commerce est téléchargé, le propriétaire est connecté", async () => {
    await page.goto(base + "/accueil"); await page.getByRole("button", { name: /Rattacher ce poste à mon commerce cloud/ }).click();
    await page.getByLabel("E-mail du compte cloud").fill(fake.EMAIL); await page.getByLabel("Mot de passe du compte cloud").fill(fake.PW); await page.getByRole("button", { name: "Rattacher ce poste", exact: true }).click();
    await page.getByText("Boutique Dakar").first().waitFor({ timeout: 40000 }); if (!(await token())) throw new Error("pas de session");
    shopId = String(srv.store.db.prepare("SELECT id FROM rows WHERE tbl = 'shops' AND tenant_id = ?").get(T).id); const n = srv.store.db.prepare("SELECT COUNT(*) AS n FROM rows WHERE tbl = 'products'").get().n; if (n !== 1) throw new Error("articles : " + n);
    const refused = await fake.callCloud(fake.UID, "article.save", { data: { name: "X", price: 1 } }, shopId); if (refused.status !== 409) throw new Error("le cloud devrait être en lecture : " + refused.status);
  });
  await step("onglet « Synchronisation » : état, poste, dernière synchronisation, éléments en attente", async () => {
    await openSync(); const t = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    for (const w of ["À jour", "Caisse principale", "En attente d'envoi", "0 élément", "Connexion au cloud", "active", "Constats à examiner (0)", "Rien à examiner", "Rétablir depuis le cloud", "Rendre le commerce au cloud"]) if (!t.includes(w)) throw new Error("manque : " + w);
    await page.screenshot({ path: path.join(OUT, "kit26-sync-1440.png"), fullPage: true });
  });
  await step("une vente sur le poste : en attente, puis « Synchroniser maintenant » l'envoie au cloud", async () => {
    const prod = String(srv.store.db.prepare("SELECT id FROM rows WHERE tbl = 'products'").get().id);
    const v = await exec("checkout", { clientId: "vente-e2e-0001", lines: [{ productId: prod, qty: 3 }], payments: [{ method: "cash", amount: 1500 }] }, T, shopId); if (v.status !== 200) throw new Error(JSON.stringify(v.body));
    await openSync(); await page.getByText(/[1-9]\d* éléments?/).first().waitFor({ timeout: 20000 }); await page.getByRole("button", { name: "Synchroniser maintenant" }).click(); await page.getByText(/Synchronisation terminée/).waitFor({ timeout: 30000 });
    const n = (await fake.cloud.scan("sales", { tenantId: T })).rows.length; if (n !== 1) throw new Error("ventes au cloud : " + n); await page.getByText("0 élément").first().waitFor({ timeout: 20000 });
  });
  await step("coupure du cloud : l'erreur est affichée, les échecs comptés, rien n'est perdu ; la reprise fonctionne", async () => {
    const prod = String(srv.store.db.prepare("SELECT id FROM rows WHERE tbl = 'products'").get().id); await exec("checkout", { clientId: "vente-e2e-0002", lines: [{ productId: prod, qty: 1 }], payments: [{ method: "cash", amount: 500 }] }, T, shopId);
    fake.state.down = true; await openSync(); await page.getByRole("button", { name: "Synchroniser maintenant" }).click(); await page.getByRole("alert").filter({ hasText: /injoignable|fetch|Cloud/i }).first().waitFor({ timeout: 40000 }); await page.getByText("Échecs consécutifs").waitFor({ timeout: 20000 });
    fake.state.down = false; await page.getByRole("button", { name: "Synchroniser maintenant" }).click(); await page.getByText(/Synchronisation terminée/).waitFor({ timeout: 30000 }); const n = (await fake.cloud.scan("sales", { tenantId: T })).rows.length; if (n !== 2) throw new Error("ventes au cloud : " + n);
  });
  await step("session cloud perdue : le propriétaire voit le bandeau, reconnecte le poste avec son mot de passe, le bandeau disparaît", async () => {
    fake.state.tokens.clear(); await openSync(); await page.getByRole("button", { name: "Synchroniser maintenant" }).click(); await page.getByText(/Session cloud expirée/).first().waitFor({ timeout: 30000 });
    await page.goto(base + "/"); await page.getByText(/n'est plus connecté au cloud/).first().waitFor({ timeout: 30000 }); await page.screenshot({ path: path.join(OUT, "kit26-bandeau-1440.png") });
    await openSync(); await page.getByLabel("Mot de passe du propriétaire").fill("faux"); await page.getByRole("button", { name: "Reconnecter au cloud" }).click(); await page.getByRole("alert").filter({ hasText: /incorrect|invalides/i }).first().waitFor({ timeout: 20000 });
    await page.getByLabel("Mot de passe du propriétaire").fill(fake.PW); await page.getByRole("button", { name: "Reconnecter au cloud" }).click(); await page.getByText("Poste reconnecté au cloud.").waitFor({ timeout: 30000 });
    await page.goto(base + "/"); await page.waitForTimeout(2500); if (await page.getByText(/n'est plus connecté au cloud/).count()) throw new Error("bandeau encore affiché");
  });
  await step("constats à examiner : visibles avec les deux versions, marqués comme examinés sans rien modifier ; seuil d'alerte réglable", async () => {
    srv.store.addConflict("products", "abc123", "deleted_on_cloud", { name: "Eau 1,5 L" }, null); await openSync(); await page.getByText("Constats à examiner (1)").waitFor({ timeout: 20000 });
    const t = (await page.locator("body").innerText()).replace(/\s+/g, " "); if (!t.includes("Supprimé côté cloud")) throw new Error("libellé du constat"); await page.getByText("Voir les versions gardées").click(); await page.getByText("Eau 1,5 L").first().waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: /Marquer comme examiné/ }).first().click(); await page.getByText("Constats à examiner (0)").waitFor({ timeout: 20000 });
    await page.getByLabel("Seuil d'alerte en heures").fill("12"); await page.getByRole("button", { name: "Enregistrer" }).click(); await page.getByText("Seuil d'alerte enregistré.").waitFor({ timeout: 20000 }); await page.getByText("Seuil actuel : 12 h").waitFor({ timeout: 20000 });
  });
  await step("le caissier : ni onglet « Synchronisation », ni bandeau, aucun accès à l'état (403)", async () => {
    const c = await exec("staff.create", { name: "Moussa", username: "moussa", password: "motdepasse1", role: "cashier", shopIds: [shopId] }, T, ""); if (c.status !== 200) throw new Error(JSON.stringify(c.body));
    fake.state.tokens.clear(); await exec("noop", {}, T).catch(() => {});
    const lg = await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: srv.store.userById(c.body.data.userId).email, password: "motdepasse1" }) }); const tk = (await lg.json()).token; if (!tk) throw new Error("connexion caissier");
    if ((await fetch(`${base}/v1/cloud/status`, { headers: { authorization: `Bearer ${tk}` } })).status !== 403) throw new Error("état lisible par un caissier");
    const c2 = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); const p2 = await c2.newPage(); await p2.addInitScript((t) => localStorage.setItem("dmp.local.token", t), tk); await p2.goto(base + "/reglages"); await p2.waitForTimeout(3000);
    if (await p2.getByRole("tab", { name: "Synchronisation" }).count()) throw new Error("onglet visible"); if (await p2.getByText(/Ouvrir la synchronisation/).count()) throw new Error("bandeau visible"); await c2.close();
  });
  await step("restauration depuis le cloud : refusée sans le nom du poste ; sinon copie de sécurité puis commerce re-téléchargé (la vente perdue localement revient)", async () => {
    await openSync(); await page.getByRole("button", { name: "Synchroniser maintenant" }).click(); await page.getByText(/Session cloud expirée/).first().waitFor({ timeout: 30000 }); // le cloud a oublié la session (caissier : jetons effacés)
    await openSync(); await page.getByLabel("Mot de passe du propriétaire").fill(fake.PW); await page.getByRole("button", { name: "Reconnecter au cloud" }).click(); await page.getByText("Poste reconnecté au cloud.").waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "Synchroniser maintenant" }).click(); await page.getByText(/Synchronisation terminée/).waitFor({ timeout: 30000 });
    const btn = page.getByRole("button", { name: "Rétablir depuis le cloud" }); if (!(await btn.isDisabled())) throw new Error("bouton actif sans confirmation");
    srv.store.db.prepare("DELETE FROM rows WHERE tbl = 'sales'").run(); await page.getByLabel("Nom du poste pour confirmer la restauration").fill("Caisse principale"); await btn.click(); await page.getByText(/Poste rétabli depuis le cloud/).waitFor({ timeout: 60000 });
    const n = srv.store.db.prepare("SELECT COUNT(*) AS n FROM rows WHERE tbl = 'sales'").get().n; if (n !== 2) throw new Error("ventes restaurées : " + n); const b = fs.readdirSync(path.join(dataDir, "sauvegardes")); if (!b.length) throw new Error("pas de copie de sécurité");
  });
  await step("390 px : l'onglet Synchronisation ne déborde pas", async () => {
    await page.setViewportSize({ width: 390, height: 900 }); await openSync(); const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o); await page.screenshot({ path: path.join(OUT, "kit26-sync-390.png"), fullPage: true }); await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await step("retour au cloud : confirmation « RENDRE », le cloud reprend l'écriture, le poste n'est plus rattaché", async () => {
    await openSync(); await page.getByRole("button", { name: "Synchroniser maintenant" }).click(); await page.getByText(/Synchronisation terminée/).waitFor({ timeout: 30000 }); // comme un utilisateur : tout envoyer d'abord (sinon le retour est refusé, à raison)
    const btn = page.getByRole("button", { name: "Rendre au cloud" }); if (!(await btn.isDisabled())) throw new Error("bouton actif sans confirmation"); await page.getByLabel("Confirmation du retour au cloud").fill("RENDRE"); await btn.click();
    try { await page.getByText("Commerce rendu au cloud.").waitFor({ timeout: 30000 }); } catch (e) { throw new Error("alerte : " + (await page.getByRole("alert").allInnerTexts()).join(" / ")); }
    const ok = await fake.callCloud(fake.UID, "article.save", { data: { name: "Riz", price: 100, cost: 50, sku: "RIZ", barcode: "RIZ0" } }, shopId); if (ok.status !== 200) throw new Error("le cloud devrait écrire de nouveau : " + ok.status + JSON.stringify(ok.body));
    await page.reload(); await page.getByRole("tab", { name: "Synchronisation" }).click(); await page.getByText("Non rattaché").waitFor({ timeout: 20000 });
  });
  console.log("ERRORS", JSON.stringify(errors.slice(0, 5)));
  await browser.close(); await srv.close(); await fake.close(); fs.rmSync(dataDir, { recursive: true, force: true }); process.exit(0);
})().catch((e) => { console.log("Error", e.message); process.exit(1); });
