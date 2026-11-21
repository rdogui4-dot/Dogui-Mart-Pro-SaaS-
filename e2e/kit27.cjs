/** Version Windows, lot 5 : le VRAI Electron (sous Xvfb) lance le poste principal (HTTPS, application, sauvegarde du jour) ; un poste secondaire se connecte avec épinglage de l'empreinte
 *  (adresses Internet et HTTP refusées, empreinte comparée, case obligatoire) ; une empreinte fausse est refusée. Prérequis : `npm run desktop:build` puis `cd desktop && npm install`.
 *  Lancement : bash e2e/run.sh kit27 */
const path = require("path"), fs = require("fs"), os = require("os"), { spawn, execSync } = require("child_process");
const { chromium } = require("playwright");
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 500)); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DESK = path.join(__dirname, "..", "desktop"); const EL = path.join(DESK, "node_modules", "electron", "dist", "electron");
if (!fs.existsSync(EL) || !fs.existsSync(path.join(DESK, "dist", "main.cjs"))) { console.log("SKIP Electron non installé (npm run desktop:build puis cd desktop && npm install) : scénario ignoré"); process.exit(0); }
const procs = []; const launch = (ud, port) => { const p = spawn("xvfb-run", ["-a", EL, DESK, "--no-sandbox", `--user-data-dir=${ud}`, `--remote-debugging-port=${port}`], { stdio: "ignore", detached: true }); procs.push(p); return p; };
const waitCdp = async (port) => { for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json`); if (r.ok && (await r.json()).some((t) => t.type === "page")) return; } catch { /* pas encore prêt */ } await sleep(500); } throw new Error("Electron ne répond pas"); };
const page = async (port) => { const b = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); return { b, p: b.contexts()[0].pages()[0] }; };
(async () => {
  const MAIN = 19443; const ud1 = fs.mkdtempSync(path.join(os.tmpdir(), "dmp-el1-")), ud2 = fs.mkdtempSync(path.join(os.tmpdir(), "dmp-el2-")); fs.writeFileSync(path.join(ud1, "poste.json"), JSON.stringify({ mode: "main", port: MAIN, autostart: false }));
  let fp = ""; let p1; let ud3 = "";
  await step("poste principal (Electron réel) : serveur HTTPS démarré, application affichée, sauvegarde du jour créée, journal sans donnée d'entreprise", async () => {
    launch(ud1, 9555); await waitCdp(9555); await sleep(4000); const c = await page(9555); p1 = c.p; await p1.waitForLoadState("domcontentloaded");
    if (!/127\.0\.0\.1:19443/.test(p1.url())) throw new Error("URL : " + p1.url()); await p1.getByText(/Connectez-vous à votre espace/).first().waitFor({ timeout: 20000 });
    fp = await p1.evaluate(async () => (await (await fetch("/v1/connect")).json()).certificate.fingerprint); if (!/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(fp)) throw new Error("empreinte : " + fp);
    if (!fs.readdirSync(path.join(ud1, "sauvegardes")).some((n) => /^auto-\d{4}-\d{2}-\d{2}\.sqlite$/.test(n))) throw new Error("pas de sauvegarde"); if (!/poste principal démarré/.test(fs.readFileSync(path.join(ud1, "logs", "poste.log"), "utf8"))) throw new Error("journal");
    const sw = await p1.evaluate(() => (window.dogui === undefined)); if (!sw) throw new Error("le pont du poste est exposé à la page de l'application");
  });
  await step("poste secondaire : choix du mode, adresses Internet et HTTP refusées, empreinte affichée identique à celle du principal, case obligatoire, connexion", async () => {
    launch(ud2, 9556); await waitCdp(9556); await sleep(3000); const { p } = await page(9556); await p.locator("#secondary").click(); await p.locator("#addr").waitFor({ timeout: 15000 });
    await p.locator("#addr").fill("http://example.com"); await p.locator("#go").click(); await p.locator("#err").filter({ hasText: /HTTPS/ }).waitFor({ timeout: 10000 });
    await p.locator("#addr").fill("8.8.8.8"); await p.locator("#go").click(); await p.locator("#err").filter({ hasText: /réseau local/ }).waitFor({ timeout: 10000 });
    await p.locator("#addr").fill(`127.0.0.1:${MAIN}`); await p.locator("#go").click(); await p.locator("#fp").waitFor({ state: "visible", timeout: 20000 }); if ((await p.locator("#fp").innerText()) !== fp) throw new Error("empreinte affichée différente");
    if (!(await p.locator("#confirm").isDisabled())) throw new Error("bouton actif sans coche"); await p.locator("#ok").check(); await p.locator("#confirm").click();
    await p.waitForURL(new RegExp(`127\\.0\\.0\\.1:${MAIN}`), { timeout: 30000 }); await p.getByText(/Connectez-vous à votre espace/).first().waitFor({ timeout: 20000 });
    const cfg = JSON.parse(fs.readFileSync(path.join(ud2, "poste.json"), "utf8")); if (cfg.mode !== "secondary" || cfg.pinnedFingerprint !== fp) throw new Error("configuration : " + JSON.stringify(cfg));
  });
  await step("poste secondaire avec une empreinte épinglée FAUSSE : connexion refusée, écran « Poste principal injoignable » (aucune exception de sécurité)", async () => {
    procs.forEach((p) => { try { process.kill(-p.pid); } catch { /* déjà arrêté */ } }); procs.length = 0; await sleep(2500);
    execSync("pkill -f '[r]emote-debugging-port' || true"); for (const port of [9555, 9556]) for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${port}/json`); await sleep(500); } catch { break; } } // attendre l'arrêt réel des instances
    ud3 = fs.mkdtempSync(path.join(os.tmpdir(), "dmp-el3-")); fs.writeFileSync(path.join(ud3, "poste.json"), JSON.stringify({ mode: "secondary", mainOrigin: `https://127.0.0.1:${MAIN}`, pinnedFingerprint: "00:00" + fp.slice(5) })); // profil neuf : aucun cache ni service worker d'une session précédente
    launch(ud1, 9555); await waitCdp(9555); await sleep(4000); launch(ud3, 9556); await waitCdp(9556); await sleep(4000); const { p } = await page(9556); try { await p.locator("h1").filter({ hasText: /injoignable/ }).waitFor({ timeout: 20000 }); } catch (e) { throw new Error("page : " + p.url() + " | " + (await p.locator("body").innerText().catch(() => "?")).replace(/\s+/g, " ").slice(0, 120)); } const m = await p.locator("#msg").innerText(); if (!/CERT/.test(m)) throw new Error(m);
  });
  procs.forEach((p) => { try { process.kill(-p.pid); } catch { /* déjà arrêté */ } }); try { execSync("pkill -f '[r]emote-debugging-port' || true"); } catch { /* rien à arrêter */ }
  fs.rmSync(ud1, { recursive: true, force: true }); fs.rmSync(ud2, { recursive: true, force: true }); if (ud3) fs.rmSync(ud3, { recursive: true, force: true }); process.exit(0);
})().catch((e) => { console.log("Error", e.message); try { execSync("pkill -f '[r]emote-debugging-port' || true"); } catch { /* rien */ } process.exit(1); });
