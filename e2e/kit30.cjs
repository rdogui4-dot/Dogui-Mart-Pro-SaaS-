/** Lot S2-d : Centre de sécurité — actions confirmées (fermer les sessions, désactiver / réactiver un compte), tracées au journal ; rien ne part sans confirmation ; propriétaires sans action ; responsive.
 *  Lancement : bash e2e/run.sh kit30 */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
(async () => {
  const h = await start({ plan: "business", expect: [] }); const { page, st } = h; const T = "t1";
  const mk = async (name, username, role) => (await h.call("staff.create", { name, username, password: "motdepasse1", role, shopIds: [h.shop] }, "")).body.data.userId;
  const moussa = await mk("Moussa Diop", "moussa", "cashier"); await mk("Awa Fall", "awa", "manager"); st.security.set(moussa, { lastLogin: new Date().toISOString(), sessions24h: 2, mfa: false });
  const open = async (w = 1440, hh = 1000) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url("securite")); await page.getByRole("region", { name: "Niveau de sécurité" }).waitFor({ timeout: 15000 }); await page.getByRole("tab", { name: /Comptes et actions/ }).click(); await page.getByRole("region", { name: "Comptes du commerce" }).waitFor({ timeout: 8000 }); if (w >= 768) await page.getByRole("table", { name: "Comptes du commerce" }).waitFor({ timeout: 8000 }); };
  const row = (n) => page.getByRole("table", { name: "Comptes du commerce" }).getByRole("row", { name: new RegExp(n) });
  const jr = async () => { await page.getByRole("tab", { name: /Journal de sécurité/ }).click(); await page.getByText(/Chaîne vérifiée|Rupture/).waitFor({ timeout: 8000 }); const t = (await page.getByRole("table", { name: "Journal de sécurité" }).innerText()).replace(/\s+/g, " "); await page.getByRole("tab", { name: /Comptes et actions/ }).click(); await page.getByRole("table", { name: "Comptes du commerce" }).waitFor(); return t; };

  await step("onglet « Comptes et actions » : employés avec état, connexion, sessions, 2FA ; le propriétaire n'a aucune action ; sauvegarde immédiate expliquée hors poste Windows", async () => {
    await open(); const t = (await page.getByRole("table", { name: "Comptes du commerce" }).innerText()).replace(/\s+/g, " ");
    if (!/Moussa Diop/.test(t) || !/Awa Fall/.test(t) || !/Actif/.test(t) || !/Non activée/.test(t)) throw new Error(t.slice(0, 400));
    const own = page.getByRole("table", { name: "Comptes du commerce" }).getByRole("row", { name: /Aucune action sur un propriétaire/ }); if (await own.getByRole("button").count()) throw new Error("action proposée sur un propriétaire");
    if (!(await page.getByText(/depuis le poste Windows du commerce/).count())) throw new Error("explication sauvegarde absente");
    await page.screenshot({ path: path.join(OUT, "kit30-comptes-1440.png"), fullPage: true });
  });
  await step("annuler la confirmation : aucune action n'est envoyée", async () => {
    const before = h.calls.length; await row("Moussa Diop").getByRole("button", { name: /Fermer les sessions de Moussa Diop/ }).click();
    const dlg = page.getByRole("alertdialog"); if (!/Tous ses appareils seront déconnectés/.test(await dlg.innerText())) throw new Error("texte de confirmation"); await dlg.getByRole("button", { name: "Annuler" }).click(); await page.waitForTimeout(300);
    if (await page.getByRole("alertdialog").count()) throw new Error("fenêtre encore ouverte"); if (h.calls.slice(before).some((c) => c[0] === "security.sessions.revoke")) throw new Error("action envoyée sans confirmation"); if (st.revoked.length) throw new Error("sessions fermées");
  });
  await step("fermer les sessions après confirmation : message, compte visé seulement, événement au journal", async () => {
    await row("Moussa Diop").getByRole("button", { name: /Fermer les sessions de Moussa Diop/ }).click(); await page.getByRole("alertdialog").getByRole("button", { name: "Fermer les sessions" }).click();
    await page.getByRole("status").filter({ hasText: "Sessions de Moussa Diop fermées" }).waitFor({ timeout: 8000 }); if (JSON.stringify(st.revoked) !== JSON.stringify([moussa])) throw new Error("comptes visés : " + JSON.stringify(st.revoked));
    const t = await jr(); if (!/Sessions d'un employé fermées/.test(t)) throw new Error("journal : " + t.slice(0, 300));
  });
  await step("désactiver puis réactiver : état mis à jour, événements dédiés, aucun mot de passe dans le journal", async () => {
    await row("Awa Fall").getByRole("button", { name: /Désactiver le compte de Awa Fall/ }).click(); const dlg = page.getByRole("alertdialog"); if (!/ne verra plus aucune donnée/.test(await dlg.innerText())) throw new Error("texte"); await dlg.getByRole("button", { name: "Désactiver le compte" }).click();
    await page.getByRole("status").filter({ hasText: "Compte de Awa Fall désactivé" }).waitFor({ timeout: 8000 }); await page.waitForFunction(() => /Désactivé/.test(document.body.innerText), null, { timeout: 8000 });
    if (!(await row("Awa Fall").getByRole("button", { name: /Réactiver le compte de Awa Fall/ }).count())) throw new Error("bouton Réactiver absent");
    await row("Awa Fall").getByRole("button", { name: /Réactiver le compte de Awa Fall/ }).click(); await page.getByRole("alertdialog").getByRole("button", { name: "Réactiver le compte" }).click(); await page.getByRole("status").filter({ hasText: "Compte de Awa Fall réactivé" }).waitFor({ timeout: 8000 });
    const t = await jr(); if (!/Compte d'un employé désactivé/.test(t) || !/Compte d'un employé réactivé/.test(t)) throw new Error("événements : " + t.slice(0, 400)); if (/motdepasse|awa|moussa/i.test(t)) throw new Error("donnée sensible");
    await page.screenshot({ path: path.join(OUT, "kit30-journal-1440.png"), fullPage: true });
  });
  await step("erreur du serveur affichée clairement (alerte), sans message de succès", async () => {
    await page.route("**/executions", async (route) => { const b = JSON.parse(JSON.parse(route.request().postData() ?? "{}").body ?? "{}"); if (b.action === "security.sessions.revoke") return route.fulfill({ status: 201, contentType: "application/json", headers: { "access-control-allow-origin": h.origin, "access-control-allow-credentials": "true" }, body: JSON.stringify({ $id: "ex", responseStatusCode: 404, responseBody: JSON.stringify({ ok: false, error: "Employé introuvable" }), status: "completed" }) }); return route.fallback(); });
    await row("Moussa Diop").getByRole("button", { name: /Fermer les sessions/ }).click(); await page.getByRole("alertdialog").getByRole("button", { name: "Fermer les sessions" }).click(); await page.getByRole("alert").filter({ hasText: "Employé introuvable" }).waitFor({ timeout: 8000 }); await page.unroute("**/executions");
  });
  for (const [w, theme] of [[1600, "light"], [820, "light"], [390, "light"], [1280, "dark"]]) await step(`${w} px ${theme} : aucun débordement (captures)`, async () => {
    await page.evaluate((t) => localStorage.setItem("dmp-theme", t), theme); await open(w, 900); const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o); await page.screenshot({ path: path.join(OUT, `kit30-${theme}-${w}.png`), fullPage: true });
  });
  await page.evaluate(() => localStorage.setItem("dmp-theme", "light"));
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
