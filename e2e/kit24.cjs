/** Version Windows, lot 2 : le VRAI serveur local (SQLite sur disque, même fonction métier que le cloud) sert l'application ; aucun Appwrite, aucun cloud.
 *  Création locale du compte et de l'entreprise (assistant d'accueil), connexion, données lues avec les droits, vente et retour, caissier limité à sa boutique, rechargement,
 *  persistance après redémarrage du serveur. Lancement : bash e2e/run.sh kit24 */
const path = require("path"), fs = require("fs"), os = require("os");
const { chromium } = require("playwright");
const { startLocalServer } = require("./.build/local.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 500)); } };
(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dmp-local-e2e-")); const web = path.join(__dirname, ".build", "local-site");
  let srv = await startLocalServer({ dataDir, webRoot: web, port: 0, host: "127.0.0.1" }); let base = `http://127.0.0.1:${srv.port}`;
  const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e.message))); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|WebSocket/.test(m.text())) errors.push(m.text()); });
  const external = []; page.on("request", (r) => { const u = new URL(r.url()); if (!["127.0.0.1", "localhost"].includes(u.hostname) && u.protocol.startsWith("http")) external.push(r.url()); });
  const token = () => page.evaluate(() => localStorage.getItem("dmp.local.token"));
  const exec = async (action, payload, tenantId = "", shopId = "", tk) => { const r = await fetch(`${base}/v1/execute`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tk ?? await token()}` }, body: JSON.stringify({ action, tenantId, shopId, payload }) }); return { status: r.status, body: await r.json() }; };
  let tenantId = "", shopId = ""; let ownerToken = "";

  await step("premier démarrage : l'application est servie par le serveur local, écran de connexion, création du compte propriétaire hors ligne", async () => {
    await page.goto(base + "/"); await page.getByRole("button", { name: /Créer un compte/ }).click(); await page.getByRole("heading", { name: "Créer un compte" }).waitFor({ timeout: 20000 });
    await page.getByLabel("Nom complet").fill("Awa Traoré"); await page.getByLabel("Adresse e-mail").fill("awa@boutique.local"); await page.getByLabel("Mot de passe", { exact: true }).fill("Abcdefg1!xyz"); await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Créer mon compte" }).click(); await page.getByRole("heading", { name: "Informations sur votre entreprise" }).waitFor({ timeout: 20000 });
    if (!(await token())) throw new Error("pas de jeton local");
  });
  await step("assistant d'accueil : entreprise puis boutique créées dans la base locale (SQLite)", async () => {
    await page.getByLabel("Nom de votre activité").fill("Boutique Awa"); await page.getByLabel("Secteur d'activité").selectOption("Alimentation & boissons"); await page.getByLabel("Pays", { exact: true }).selectOption("SN"); await page.getByLabel("Ville", { exact: true }).fill("Dakar");
    await page.getByLabel("Adresse complète").fill("Médina"); await page.getByLabel("Téléphone de l'entreprise").fill("+221 77 000 00 00");
    await page.getByRole("button", { name: /Continuer vers la boutique/ }).click(); await page.getByRole("heading", { name: "Créer votre première boutique" }).waitFor({ timeout: 20000 });
    await page.getByLabel("Nom de la boutique").fill("Boutique Awa Dakar"); await page.getByLabel("Type de boutique").selectOption("Commerce de détail"); await page.getByRole("button", { name: /Finaliser et accéder/ }).click();
    await page.getByRole("heading", { name: "Configuration terminée !" }).waitFor({ timeout: 20000 }); await page.getByRole("button", { name: /Accéder à mon tableau de bord/ }).click(); await page.waitForTimeout(1500);
    const s = await (await fetch(`${base}/v1/auth/session`, { headers: { authorization: `Bearer ${await token()}` } })).json(); tenantId = s.teams[0].id; if (s.teams[0].name !== "Boutique Awa") throw new Error(JSON.stringify(s));
    const shops = srv.store.db.prepare("SELECT id FROM rows WHERE tbl = 'shops' AND tenant_id = ?").all(tenantId); if (shops.length !== 1) throw new Error("boutique non créée"); shopId = String(shops[0].id);
  });
  await step("données lues avec les droits : un article créé par l'API apparaît dans la liste des articles (lecture locale)", async () => {
    srv.store.db.prepare("UPDATE rows SET data = json_set(data, '$.cashRequired', json('false')) WHERE tbl = 'shops'").run();
    await srv.store.update("subscriptions", tenantId, { plan: "business", status: "paid", renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }).catch(() => srv.store.create("subscriptions", tenantId, tenantId, { tenantId, plan: "business", period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }));
    const a = await exec("article.save", { data: { name: "Riz 25 kg", price: 15000, cost: 11000, sku: "RIZ", barcode: "RIZ0" }, initialQty: 12 }, tenantId, shopId); if (a.status !== 200) throw new Error(JSON.stringify(a));
    await page.goto(base + "/articles"); await page.getByText("Riz 25 kg").first().waitFor({ timeout: 20000 });
  });
  await step("vente puis retour (serveur local) : stock, tableau de bord et bénéfice brut calculés sur SQLite", async () => {
    const list = await (await fetch(`${base}/v1/rows/products?q=${encodeURIComponent(JSON.stringify([JSON.stringify({ method: "limit", values: [5] })]))}`, { headers: { authorization: `Bearer ${await token()}` } })).json(); const riz = list.rows.find((r) => r.name === "Riz 25 kg").$id;
    const v = await exec("checkout", { clientId: "vente-win-0001", lines: [{ productId: riz, qty: 2 }], payments: [{ method: "cash", amount: 30000 }] }, tenantId, shopId); if (v.status !== 200) throw new Error(JSON.stringify(v));
    const dup = await exec("checkout", { clientId: "vente-win-0001", lines: [{ productId: riz, qty: 2 }], payments: [{ method: "cash", amount: 30000 }] }, tenantId, shopId); if (!dup.body.data.duplicate) throw new Error("vente non idempotente");
    const sale = (await exec("sales.list", {}, tenantId, shopId)).body.data.sales[0]; const r = await exec("sale.refund", { returnId: "rt-win-0000001", saleId: sale.id, kind: "refund", lines: [{ index: 0, qty: 1 }], reason: "Client", refunds: [{ method: "cash", amount: 15000 }] }, tenantId, shopId); if (r.status !== 200) throw new Error(JSON.stringify(r));
    await page.goto(base + "/activite"); await page.getByRole("heading", { name: "Tableau de bord" }).waitFor({ timeout: 20000 }); await page.getByRole("tab", { name: "Bénéfice brut" }).click(); await page.getByText(/Chiffre d'affaires HT/).first().waitFor({ timeout: 20000 });
    await page.screenshot({ path: path.join(OUT, "kit24-benefice-local.png") });
  });
  await step("caissier créé par le propriétaire : connexion par identifiant, ne voit que sa boutique, jamais le journal d'audit ni la gestion", async () => {
    ownerToken = await token(); const c = await exec("staff.create", { name: "Moussa", username: "moussa", password: "motdepasse1", role: "cashier", shopIds: [shopId] }, tenantId, ""); if (c.status !== 200) throw new Error(JSON.stringify(c));
    await page.evaluate(() => localStorage.removeItem("dmp.local.token")); await page.goto(base + "/accueil"); await page.getByLabel("E-mail ou identifiant").fill("moussa"); await page.getByLabel("Mot de passe", { exact: true }).fill("motdepasse1"); await page.getByRole("button", { name: /Se connecter/ }).last().click();
    await page.waitForTimeout(2500); const tk = await token(); if (!tk) throw new Error("connexion refusée");
    const audit = await (await fetch(`${base}/v1/rows/audit_log?q=${encodeURIComponent(JSON.stringify([JSON.stringify({ method: "limit", values: [5] })]))}`, { headers: { authorization: `Bearer ${tk}` } })).json(); if (audit.total !== 0) throw new Error("journal d'audit lisible par un caissier");
    const hack = await exec("article.save", { data: { name: "X", price: 1 } }, tenantId, shopId, tk); if (hack.status !== 403) throw new Error("écriture article par un caissier : " + hack.status);
    const body = (await page.locator("body").innerText()); if (/Équipe & Permissions/.test(body)) throw new Error("menu d'administration visible");
  });
  await step("redémarrage du serveur : les données sont conservées sur disque, la session reste valable", async () => {
    const tk = ownerToken; await srv.close(); srv = await startLocalServer({ dataDir, webRoot: web, port: 0, host: "127.0.0.1" }); base = `http://127.0.0.1:${srv.port}`;
    const s = await fetch(`${base}/v1/auth/session`, { headers: { authorization: `Bearer ${tk}` } }); if (s.status !== 200) throw new Error("session perdue : " + s.status);
    const n = srv.store.db.prepare("SELECT COUNT(*) AS n FROM rows WHERE tbl = 'sales'").get().n; if (n !== 1) throw new Error("ventes : " + n);
  });
  await step("aucune requête hors de ce poste : pas de cloud, pas de CDN", async () => { if (external.length) throw new Error(external.slice(0, 3).join(", ")); });
  console.log("ERRORS", JSON.stringify(errors.slice(0, 5)));
  await browser.close(); await srv.close(); fs.rmSync(dataDir, { recursive: true, force: true }); process.exit(0);
})().catch((e) => { console.log("Error", e.message); process.exit(1); });
