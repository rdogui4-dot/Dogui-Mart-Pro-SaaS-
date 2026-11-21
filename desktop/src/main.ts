import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, session, shell, Tray, type WebContents } from "electron";
import { X509Certificate } from "node:crypto";
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import https from "node:https";
import { join } from "node:path";
import { loadConfig, saveConfig, startMainServer, type MainHandle } from "./boot";
import { isAllowedNavigation, isSafeExternal, normalizeAddress, samePin, type DesktopConfig } from "./logic";

app.setName("Dogui Mart Pro");
const dataDir = app.getPath("userData"); const hidden = process.argv.includes("--hidden");
const resources = app.isPackaged ? process.resourcesPath : join(__dirname, "..", "resources");
const webRoot = join(resources, "web"); const uiDir = join(__dirname, "..", "ui");

/** Journal du poste (userData/logs/poste.log), tourné à 1 Mo : aucune donnée d'entreprise, seulement l'état technique. */
function log(msg: string) { try { const d = join(dataDir, "logs"); mkdirSync(d, { recursive: true }); const f = join(d, "poste.log"); try { if (statSync(f).size > 1_000_000) renameSync(f, `${f}.1`); } catch { /* premier lancement */ } appendFileSync(f, `${new Date().toISOString()} ${msg}\n`); } catch { /* journal indisponible : sans effet sur l'application */ } }
process.on("uncaughtException", (e) => log(`uncaughtException ${e.stack ?? e.message}`)); process.on("unhandledRejection", (e) => log(`unhandledRejection ${String(e)}`));

let cfg: DesktopConfig = loadConfig(dataDir); let server: MainHandle | null = null; let win: BrowserWindow | null = null; let tray: Tray | null = null; let quitting = false; let lastError = "";
const fingerprintOf = (pem: string): string => new X509Certificate(pem).fingerprint256;
const origin = (): string => cfg.mode === "main" && server ? server.origin : cfg.mode === "secondary" && cfg.mainOrigin ? cfg.mainOrigin : "";

if (!app.requestSingleInstanceLock()) { app.quit(); } else {
  app.on("second-instance", () => showWindow());

  /** Le certificat auto-signé n'est accepté QUE s'il est exactement celui attendu : celui de ce poste (principal) ou l'empreinte validée par l'utilisateur (secondaire). */
  app.on("certificate-error", (event, _wc, url, _err, certificate, callback) => {
    event.preventDefault(); let ok = false;
    try { const u = new URL(url); const fp = fingerprintOf(certificate.data);
      if (cfg.mode === "main" && server && (u.hostname === "127.0.0.1" || u.hostname === "localhost") && samePin(fp, server.certificate?.fingerprint)) ok = true;
      else if (cfg.mode === "secondary" && cfg.mainOrigin && u.origin === cfg.mainOrigin && samePin(fp, cfg.pinnedFingerprint)) ok = true; } catch { ok = false; }
    if (!ok) log(`certificat refusé pour ${url}`); callback(ok);
  });

  const secureWebPrefs = { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false } as const;
  const lockDown = (wc: WebContents, allowedOrigin: () => string) => {
    wc.setWindowOpenHandler(({ url }) => { if (isSafeExternal(url)) void shell.openExternal(url); return { action: "deny" }; });
    wc.on("will-navigate", (e, url) => { const o = allowedOrigin(); if (o && isAllowedNavigation(url, o)) return; if (url.startsWith("file://")) return; e.preventDefault(); if (isSafeExternal(url)) void shell.openExternal(url); });
  };
  function createWindow(): BrowserWindow {
    const w = new BrowserWindow({ width: 1366, height: 860, minWidth: 360, minHeight: 600, show: false, title: "Dogui Mart Pro", backgroundColor: "#0b1b34", autoHideMenuBar: true, webPreferences: { ...secureWebPrefs, preload: join(__dirname, "preload.cjs") } });
    w.once("ready-to-show", () => { if (!hidden || cfg.mode !== "main") w.show(); }); lockDown(w.webContents, origin);
    w.webContents.on("did-fail-load", (_e, code, desc, url, isMain) => { if (!isMain || code === -3 || url.startsWith("file://")) return; lastError = `${desc} (${code})`; log(`échec de chargement ${url} : ${lastError}`); void showPage("status.html"); });
    w.on("close", (e) => { if (!quitting && cfg.mode === "main") { e.preventDefault(); w.hide(); } }); w.on("closed", () => { win = null; if (cfg.mode !== "main") app.quit(); });
    return w;
  }
  const showPage = async (file: string) => { if (!win) win = createWindow(); await win.loadFile(join(uiDir, file)); win.show(); };
  function showWindow() { if (!win) { void openApp(); return; } if (win.isMinimized()) win.restore(); win.show(); win.focus(); }

  async function openApp() {
    if (!cfg.mode) return void showPage("choose.html");
    if (cfg.mode === "main") {
      if (!server) { try { server = await startMainServer({ dataDir, webRoot, port: cfg.port }); log(`poste principal démarré sur ${server.origin}`); } catch (e) { const m = (e as NodeJS.ErrnoException).code === "EADDRINUSE" ? `Le port ${cfg.port} est déjà utilisé par un autre programme. Fermez-le, ou changez le port dans « poste.json » (${dataDir}).` : (e as Error).message; log(`démarrage impossible : ${m}`); dialog.showErrorBox("Dogui Mart Pro", m); return app.quit(); } }
    } else if (!cfg.mainOrigin || !cfg.pinnedFingerprint) { return void showPage("connect.html"); }
    if (!win) win = createWindow(); await win.loadURL(`${origin()}/`); if (!hidden || cfg.mode !== "main") win.show();
  }

  /** Seuls les écrans internes (fichiers locaux de l'application) peuvent appeler le processus principal. */
  const internal = (e: Electron.IpcMainInvokeEvent): boolean => { try { return new URL(e.senderFrame?.url ?? "").protocol === "file:"; } catch { return false; } };
  const guard = <A extends unknown[], R>(fn: (...a: A) => R) => (e: Electron.IpcMainInvokeEvent, ...a: A): R | { ok: false; error: string } => internal(e) ? fn(...a) : { ok: false, error: "Appel refusé" };
  ipcMain.handle("dogui:info", guard(() => ({ version: app.getVersion(), mode: cfg.mode, mainOrigin: cfg.mainOrigin, message: lastError })));
  ipcMain.handle("dogui:choose-mode", guard(async (mode: unknown) => { if (mode !== "main" && mode !== "secondary") return { ok: false, error: "Mode inconnu" }; cfg = { ...cfg, mode }; if (mode === "main") { saveConfig(dataDir, cfg); await openApp(); } else { delete cfg.mainOrigin; delete cfg.pinnedFingerprint; await showPage("connect.html"); } return { ok: true }; }));
  /** Lit le certificat PRÉSENTÉ par le poste principal (sans le faire confiance) pour que l'utilisateur compare l'empreinte avec celle affichée sur le poste principal. */
  ipcMain.handle("dogui:probe", guard((address: unknown) => new Promise((resolve) => {
    const n = normalizeAddress(String(address ?? "")); if (!n.ok) return resolve({ ok: false, error: n.error });
    const req = https.request({ host: n.host, port: n.port, path: "/v1/connect", method: "GET", rejectUnauthorized: false, timeout: 6000 }, (res) => {
      try { const raw = (res.socket as import("node:tls").TLSSocket).getPeerCertificate().raw; const fingerprint = new X509Certificate(raw).fingerprint256; res.resume(); res.on("end", () => resolve(res.statusCode === 200 ? { ok: true, origin: n.origin, fingerprint } : { ok: false, error: "Ce n'est pas un poste Dogui Mart Pro" })); } catch { resolve({ ok: false, error: "Certificat illisible" }); }
    });
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "Aucune réponse : vérifiez l'adresse, que le poste principal est allumé et sur le même réseau, et que le pare-feu l'autorise." }); }); req.on("error", () => resolve({ ok: false, error: "Poste principal injoignable : vérifiez l'adresse et le réseau." })); req.end();
  })));
  ipcMain.handle("dogui:confirm-pin", guard(async (o: unknown, fp: unknown) => { const n = normalizeAddress(String(o ?? "")); if (!n.ok) return { ok: false, error: n.error }; if (!samePin(String(fp ?? ""), String(fp ?? ""))) return { ok: false, error: "Empreinte invalide" }; cfg = { ...cfg, mode: "secondary", mainOrigin: n.origin, pinnedFingerprint: String(fp).toUpperCase() }; saveConfig(dataDir, cfg); await openApp(); return { ok: true }; }));
  ipcMain.handle("dogui:retry", guard(() => openApp()));
  ipcMain.handle("dogui:reconfigure", guard(async () => { const wasMain = cfg.mode === "main"; if (wasMain) return; cfg = { ...cfg, mode: "secondary" }; delete cfg.mainOrigin; delete cfg.pinnedFingerprint; await showPage("connect.html"); }));

  function buildTray() {
    const img = nativeImage.createFromPath(join(resources, "icon.png")); tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 24, height: 24 })); tray.setToolTip("Dogui Mart Pro");
    const menu = () => Menu.buildFromTemplate([
      { label: "Ouvrir Dogui Mart Pro", click: () => showWindow() },
      ...(cfg.mode === "main" && server ? [{ label: `Adresse de ce poste : ${server.origin.replace("127.0.0.1", "…")}`, enabled: false }] : []),
      { type: "separator" },
      { label: "Démarrer avec Windows", type: "checkbox", checked: cfg.autostart, click: (i) => { cfg = { ...cfg, autostart: i.checked }; saveConfig(dataDir, cfg); applyAutostart(); } },
      { label: "Rechercher une mise à jour", click: () => void checkUpdates(true) },
      { type: "separator" },
      { label: "Quitter (arrête aussi le poste principal)", click: () => { quitting = true; app.quit(); } },
    ]);
    tray.setContextMenu(menu()); tray.on("click", () => showWindow()); tray.on("double-click", () => showWindow());
  }
  const applyAutostart = () => { if (app.isPackaged && process.platform === "win32") app.setLoginItemSettings({ openAtLogin: cfg.autostart, args: ["--hidden"] }); };

  /** Mise à jour : téléchargée en arrière-plan, installée seulement si le propriétaire le décide (jamais en pleine vente). */
  async function checkUpdates(manual = false) {
    if (!app.isPackaged) { if (manual) void dialog.showMessageBox({ message: "Les mises à jour automatiques ne sont actives que dans l'application installée." }); return; }
    try {
      const { autoUpdater } = await import("electron-updater"); autoUpdater.autoDownload = true; autoUpdater.autoInstallOnAppQuit = false; autoUpdater.logger = { info: (m: unknown) => log(`maj ${m}`), warn: (m: unknown) => log(`maj ! ${m}`), error: (m: unknown) => log(`maj ✗ ${m}`), debug: () => undefined } as never;
      autoUpdater.removeAllListeners("update-downloaded"); autoUpdater.removeAllListeners("update-not-available");
      autoUpdater.on("update-downloaded", async (info) => { const r = await dialog.showMessageBox({ type: "info", title: "Mise à jour prête", message: `La version ${info.version} est prête.`, detail: "L'installation ferme l'application quelques secondes. Choisissez un moment où aucune vente n'est en cours.", buttons: ["Installer maintenant", "Plus tard"], defaultId: 1, cancelId: 1 }); if (r.response === 0) { quitting = true; autoUpdater.quitAndInstall(); } });
      if (manual) autoUpdater.once("update-not-available", () => void dialog.showMessageBox({ message: "Vous avez déjà la dernière version." }));
      await autoUpdater.checkForUpdates();
    } catch (e) { log(`recherche de mise à jour impossible : ${(e as Error).message}`); if (manual) void dialog.showMessageBox({ type: "warning", message: "Recherche impossible pour le moment (vérifiez la connexion Internet)." }); }
  }

  app.whenReady().then(async () => {
    // Vérification de certificat au niveau réseau (couvre aussi le service worker) : accepté UNIQUEMENT si l'empreinte est exactement celle attendue ; tout le reste suit la vérification normale.
    session.defaultSession.setCertificateVerifyProc((req, callback) => {
      try { const fp = fingerprintOf(req.certificate.data); const h = req.hostname;
        if (cfg.mode === "main" && server && (h === "127.0.0.1" || h === "localhost") && samePin(fp, server.certificate?.fingerprint)) return callback(0);
        if (cfg.mode === "secondary" && cfg.mainOrigin && h === new URL(cfg.mainOrigin).hostname && samePin(fp, cfg.pinnedFingerprint)) return callback(0); } catch { /* certificat illisible : vérification normale */ }
      callback(-3);
    });
    Menu.setApplicationMenu(null); session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "media" || permission === "clipboard-sanitized-write")); // caméra (scan) et copie seulement
    applyAutostart(); buildTray(); await openApp(); setTimeout(() => void checkUpdates(), 60_000); setInterval(() => void checkUpdates(), 6 * 3600_000).unref();
  });
  app.on("window-all-closed", () => { /* le poste principal reste actif dans la zone de notification */ });
  app.on("before-quit", () => { quitting = true; if (server) { const s = server; server = null; void s.close().catch(() => undefined); } });
}
