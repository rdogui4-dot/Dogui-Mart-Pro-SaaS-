/** Version Windows, lot 3 : réseau local — le poste principal sert en HTTPS (certificat généré localement), le propriétaire voit les adresses, le QR code, l'empreinte du certificat
 *  et les appareils connectés (téléphone caissier compris), peut en déconnecter un ; page publique « Connecter un appareil ». Lancement : bash e2e/run.sh kit25 */
const path = require("path"), fs = require("fs"), os = require("os");
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // tests : certificat autosigné du poste
const { chromium } = require("playwright");
const { startLocalServer } = require("./.build/local.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 500)); } };
(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dmp-net-e2e-")); const web = path.join(__dirname, ".build", "local-site");
  const srv = await startLocalServer({ dataDir, webRoot: web, port: 0, host: "127.0.0.1", https: true }); const base = `https://127.0.0.1:${srv.port}`;
  const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true }); const page = await ctx.newPage();
  page.on("dialog", (d) => void d.accept());
  const errors = []; page.on("pageerror", (e) => errors.push(String(e.message))); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|WebSocket|ERR_CERT|SSL certificate error/.test(m.text())) errors.push(m.text()); });
  const token = () => page.evaluate(() => localStorage.getItem("dmp.local.token"));
  const exec = async (action, payload, tenantId = "", shopId = "", tk) => { const r = await fetch(`${base}/v1/execute`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tk ?? await token()}` }, body: JSON.stringify({ action, tenantId, shopId, payload }) }); return { status: r.status, body: await r.json() }; };
  let tenantId = "", shopId = "", cashierToken = "";

  await step("poste principal en HTTPS : création du propriétaire et de l'entreprise (assistant d'accueil)", async () => {
    await page.goto(base + "/"); await page.getByRole("button", { name: /Créer un compte/ }).click(); await page.getByRole("heading", { name: "Créer un compte" }).waitFor({ timeout: 20000 });
    await page.getByLabel("Nom complet").fill("Awa Traoré"); await page.getByLabel("Adresse e-mail").fill("awa@boutique.local"); await page.getByLabel("Mot de passe", { exact: true }).fill("Abcdefg1!xyz"); await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "Créer mon compte" }).click();
    await page.getByRole("heading", { name: "Informations sur votre entreprise" }).waitFor({ timeout: 20000 }); await page.getByLabel("Nom de votre activité").fill("Boutique Awa"); await page.getByLabel("Secteur d'activité").selectOption("Alimentation & boissons"); await page.getByLabel("Pays", { exact: true }).selectOption("SN"); await page.getByLabel("Ville", { exact: true }).fill("Dakar");
    await page.getByLabel("Adresse complète").fill("Médina"); await page.getByLabel("Téléphone de l'entreprise").fill("+221 77 000 00 00"); await page.getByRole("button", { name: /Continuer vers la boutique/ }).click(); await page.getByRole("heading", { name: "Créer votre première boutique" }).waitFor({ timeout: 20000 });
    await page.getByLabel("Nom de la boutique").fill("Boutique Awa Dakar"); await page.getByLabel("Type de boutique").selectOption("Commerce de détail"); await page.getByRole("button", { name: /Finaliser et accéder/ }).click(); await page.getByRole("heading", { name: "Configuration terminée !" }).waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: /Accéder à mon tableau de bord/ }).click(); await page.waitForTimeout(1500);
    const s = await (await fetch(`${base}/v1/auth/session`, { headers: { authorization: `Bearer ${await token()}` } })).json(); tenantId = s.teams[0].id; shopId = String(srv.store.db.prepare("SELECT id FROM rows WHERE tbl = 'shops' AND tenant_id = ?").get(tenantId).id);
  });
  await step("Paramètres → « Réseau local » : poste en marche, HTTPS, adresses, QR code, empreinte du certificat, cet appareil", async () => {
    await page.goto(base + "/reglages"); await page.getByRole("tab", { name: "Réseau local" }).click(); await page.getByText("Poste principal").first().waitFor({ timeout: 20000 });
    const t = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    for (const w of ["En marche", "Les échanges sont chiffrés (HTTPS)", "Adresses à ouvrir sur les autres appareils", "https://", "dogui.local", "Certificat de sécurité", "Appareils connectés (1)", "(cet appareil)", "pare-feu Windows"]) if (!t.includes(w)) throw new Error("manque : " + w);
    if (!t.includes(srv.certificate.fingerprint)) throw new Error("empreinte absente"); if ((await page.locator("canvas").count()) < 1) throw new Error("QR code absent");
    await page.screenshot({ path: path.join(OUT, "kit25-reseau-1440.png"), fullPage: true });
  });
  await step("un caissier se connecte depuis un téléphone : il apparaît dans les appareils connectés (type d'appareil, rôle) ; le propriétaire le déconnecte", async () => {
    const c = await exec("staff.create", { name: "Moussa", username: "moussa", password: "motdepasse1", role: "cashier", shopIds: [shopId] }, tenantId, ""); if (c.status !== 200) throw new Error(JSON.stringify(c));
    const email = srv.store.userById(c.body.data.userId).email; const ua = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36";
    const l = await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json", "user-agent": ua }, body: JSON.stringify({ email, password: "motdepasse1" }) }); cashierToken = (await l.json()).token; if (!cashierToken) throw new Error("connexion du caissier");
    await page.reload(); await page.getByRole("tab", { name: "Réseau local" }).click(); await page.getByText("Appareils connectés (2)").waitFor({ timeout: 20000 });
    const t = (await page.locator("body").innerText()).replace(/\s+/g, " "); if (!/Moussa/.test(t) || !/Caissier · Chrome · Android/.test(t)) throw new Error(t.slice(t.indexOf("Appareils connectés"), t.indexOf("Appareils connectés") + 400));
    await page.getByRole("button", { name: /Déconnecter Moussa/ }).click(); await page.getByText("Appareils connectés (1)").waitFor({ timeout: 20000 });
    const s = await fetch(`${base}/v1/auth/session`, { headers: { authorization: `Bearer ${cashierToken}` } }); if (s.status !== 401) throw new Error("session du caissier encore valable : " + s.status);
  });
  await step("page publique « Connecter un appareil » : QR code, adresses, certificat téléchargeable (jamais la clé privée)", async () => {
    const p2 = await ctx.newPage(); await p2.goto(base + "/connect"); await p2.getByRole("heading", { name: /Connecter cet appareil/ }).waitFor({ timeout: 15000 });
    if (!(await p2.locator("svg").count())) throw new Error("QR code absent"); const t = await p2.locator("body").innerText(); if (!t.includes(srv.certificate.fingerprint) || !/Android/.test(t) || !/iPhone/.test(t)) throw new Error(t.slice(0, 300));
    const cert = await (await fetch(`${base}/v1/certificate.crt`)).text(); if (!cert.includes("BEGIN CERTIFICATE") || cert.includes("PRIVATE KEY")) throw new Error("certificat"); await p2.screenshot({ path: path.join(OUT, "kit25-connect-1440.png"), fullPage: true });
    await p2.setViewportSize({ width: 390, height: 800 }); await p2.goto(base + "/connect"); const o = await p2.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o); await p2.close();
  });
  await step("le caissier ne voit pas « Réseau local » ; aucun accès à l'état du réseau", async () => {
    const lg = await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: srv.store.db.prepare("SELECT email FROM users WHERE email LIKE 'moussa%'").get().email, password: "motdepasse1" }) }); const tk = (await lg.json()).token;
    const r = await fetch(`${base}/v1/network`, { headers: { authorization: `Bearer ${tk}` } }); if (r.status !== 403) throw new Error("état du réseau lisible par un caissier : " + r.status);
    const c3 = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true }); const p3 = await c3.newPage(); await p3.addInitScript((t) => localStorage.setItem("dmp.local.token", t), tk); await p3.goto(base + "/reglages"); await p3.waitForTimeout(2500); if (await p3.getByRole("tab", { name: "Réseau local" }).count()) throw new Error("onglet visible"); await c3.close();
  });
  await step("390 px : l'onglet Réseau local ne déborde pas", async () => {
    await page.setViewportSize({ width: 390, height: 900 }); await page.goto(base + "/reglages"); await page.getByRole("tab", { name: "Réseau local" }).click(); await page.getByText("Poste principal").first().waitFor({ timeout: 15000 });
    const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o); await page.screenshot({ path: path.join(OUT, "kit25-reseau-390.png"), fullPage: true });
  });
  console.log("ERRORS", JSON.stringify(errors.slice(0, 5)));
  await browser.close(); await srv.close(); fs.rmSync(dataDir, { recursive: true, force: true }); process.exit(0);
})().catch((e) => { console.log("Error", e.message); process.exit(1); });
