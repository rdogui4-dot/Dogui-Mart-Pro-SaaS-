/** Recette finale (lot N6, cahier §17-§21) : authentification (messages neutres, mot de passe visible, récupération), mouvement réduit, clavier et focus visible, mesures sous contrainte (processeur ×4, réseau lent). Lancement : bash e2e/run.sh recette */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const metrics = [];
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 500)); } };
(async () => {
  // ---- 1. Authentification (visiteur non connecté)
  { const h = await start({ plan: "pro", anonymous: true, expect: ["tenant.init"] }); const { page } = h;
    await step("connexion : écran affiché au visiteur, champs étiquetés, mot de passe affichable", async () => {
      await page.setViewportSize({ width: 390, height: 800 }); await page.goto(h.url("accueil")); await page.waitForSelector("text=Connexion", { timeout: 15000 });
      const pw = page.getByLabel("Mot de passe", { exact: true }); if ((await pw.getAttribute("type")) !== "password") throw new Error("mot de passe en clair par défaut");
      await page.getByRole("button", { name: "Afficher le mot de passe" }).click(); if ((await pw.getAttribute("type")) !== "text") throw new Error("affichage impossible"); await page.getByRole("button", { name: "Masquer le mot de passe" }).click();
      await page.screenshot({ path: path.join(OUT, "rc-connexion-390.png") });
    });
    await step("connexion refusée : message neutre (ne révèle pas si le compte existe), saisie conservée", async () => {
      await page.getByLabel(/E-mail ou identifiant/).fill("awa@exemple.sn"); await page.getByLabel("Mot de passe", { exact: true }).fill("mauvaismdp"); await page.getByRole("button", { name: "Se connecter" }).click(); await page.waitForTimeout(1200);
      const t = await page.locator("body").innerText(); if (/n'existe pas|inconnu|introuvable|aucun compte/i.test(t)) throw new Error("message révélateur : " + t.slice(0, 300));
      if (!(await page.getByRole("alert").count()) && !/incorrect|invalide|vérifiez/i.test(t)) throw new Error("aucun message d'erreur");
      if ((await page.getByLabel(/E-mail ou identifiant/).inputValue()) !== "awa@exemple.sn") throw new Error("identifiant effacé");
    });
    await step("mot de passe oublié : réponse neutre", async () => {
      await page.getByRole("button", { name: "Mot de passe oublié ?" }).click(); await page.getByLabel(/Adresse e-mail/).fill("awa@exemple.sn"); await page.getByRole("button", { name: "Envoyer le lien" }).click(); await page.waitForTimeout(1000);
      if (!/Si un compte existe/.test(await page.locator("body").innerText())) throw new Error("réponse non neutre"); await page.getByRole("button", { name: "Retour à la connexion" }).click();
    });
    await step("inscription : champs étiquetés (boutique, nom, e-mail, mot de passe ≥ 8)", async () => {
      await page.getByRole("button", { name: "Nouveau commerçant ?" }).click(); for (const l of ["Nom de votre boutique", "Votre nom", "Adresse e-mail"]) if (!(await page.getByLabel(l).count())) throw new Error("champ absent : " + l);
      if ((await page.getByLabel("Mot de passe", { exact: true }).getAttribute("minlength")) !== "8") throw new Error("règle de longueur absente"); await page.getByRole("button", { name: "J'ai déjà un compte" }).click();
    });
    await step("connexion réussie : accès à l'espace", async () => {
      await page.getByLabel(/E-mail ou identifiant/).fill("awa@exemple.sn"); await page.getByLabel("Mot de passe", { exact: true }).fill("motdepasse1"); await page.getByRole("button", { name: "Se connecter" }).click();
      await page.waitForSelector("text=Accueil", { timeout: 15000 });
    });
    await h.close(); }

  // ---- 2. Mouvement réduit, clavier, focus
  { const h = await start({ plan: "pro", expect: [] }); const { page } = h; await h.call("article.save", { data: { name: "Eau minérale", price: 500, cost: 300 }, initialQty: 20 }, h.shop);
    await step("mouvement réduit : aucune animation en cours dans l'espace connecté", async () => {
      await page.emulateMedia({ reducedMotion: "reduce" }); await page.setViewportSize({ width: 1280, height: 800 });
      for (const r of ["accueil", "pos", "finance"]) { await page.goto(h.url(r)); await page.waitForTimeout(1200); const run = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && Number(a.effect?.getComputedTiming().duration ?? 0) > 20).length); if (run) throw new Error(`${r} : ${run} animation(s) en cours`); }
      await page.emulateMedia({ reducedMotion: "no-preference" });
    });
    await step("clavier : la barre supérieure se parcourt au clavier, focus visible (contour)", async () => {
      await page.goto(h.url("accueil")); await page.waitForTimeout(1000); const seen = []; let outline = "";
      for (let i = 0; i < 40; i++) { await page.keyboard.press("Tab"); const f = await page.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return { n: (e.getAttribute("aria-label") || e.innerText || "").trim().slice(0, 40), o: cs.outlineStyle + " " + cs.outlineWidth }; }); seen.push(f.n); if (/Rechercher une page/.test(f.n)) outline = f.o; }
      for (const x of ["Rechercher une page", "Aide", "MASTER DOGUI"]) if (!seen.some((n) => n.includes(x))) throw new Error("non atteint au clavier : " + x + " — " + seen.slice(0, 15).join(" | "));
      if (!/solid/.test(outline)) throw new Error("focus non visible : " + outline);
    });
    await step("clavier : Ctrl + K puis Entrée ouvre une page ; Échap ferme les fenêtres", async () => {
      await page.keyboard.press("Control+k"); await page.getByLabel("Rechercher une page", { exact: true }).fill("stock"); await page.keyboard.press("Enter"); await page.waitForURL(/stock/, { timeout: 5000 });
      await page.getByRole("button", { name: "Aide" }).click(); await page.keyboard.press("Escape"); await page.waitForTimeout(300); if (await page.getByRole("dialog").count()) throw new Error("Échap sans effet");
    });
    // ---- 3. Mesures sous contrainte : processeur ×4, réseau lent (latence 150 ms, 1,6 Mbit/s)
    const measure = async (label, route, interact) => {
      const ctx = page.context(); const cdp = await ctx.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 }); await cdp.send("Network.enable"); await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 90_000 });
      await page.setViewportSize({ width: 390, height: 800 });
      await page.evaluate(() => { try { localStorage.clear(); } catch {} }).catch(() => {});
      await page.goto("about:blank"); await page.addInitScript(() => { if (window.__mOn) return; window.__mOn = true; /* un seul observateur par page */ window.__cls = 0; window.__lcp = 0; window.__inp = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); new PerformanceObserver((l) => { const e = l.getEntries(); window.__lcp = e[e.length - 1].startTime; }).observe({ type: "largest-contentful-paint", buffered: true }); new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__inp = Math.max(window.__inp, e.duration); }).observe({ type: "event", buffered: true, durationThreshold: 16 }); } catch {} });
      await page.goto(route, { waitUntil: "load", timeout: 60000 }); await page.waitForTimeout(3000); if (interact) await interact(); await page.waitForTimeout(800);
      const m = await page.evaluate(() => ({ lcp: Math.round(window.__lcp), cls: Number(window.__cls.toFixed(3)), inp: Math.round(window.__inp) })); metrics.push({ page: label, ...m }); console.log("     mesures", label, JSON.stringify(m));
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 }); await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); await cdp.detach();
      return m;
    };
    await step("mesures (processeur ×4, réseau lent) : page publique — LCP ≤ 2,5 s, CLS ≤ 0,1", async () => { const m = await measure("page publique", h.url("presentation/"), async () => { await page.getByRole("link", { name: "Voir les offres" }).click(); }); if (m.lcp > 2500 || m.cls > 0.1) throw new Error(JSON.stringify(m)); });
    await step("mesures (processeur ×4, réseau lent) : accueil connecté — CLS ≤ 0,1, INP ≤ 200 ms (ouverture de la recherche)", async () => { const m = await measure("accueil connecté", h.url("accueil"), async () => { await page.getByRole("button", { name: /Rechercher une page/ }).click(); await page.waitForTimeout(400); await page.keyboard.press("Escape"); }); if (m.cls > 0.1 || m.inp > 200) throw new Error(JSON.stringify(m)); });
    await step("mesures (processeur ×4, réseau lent) : caisse — INP ≤ 200 ms (ajout d'un article au panier)", async () => { const m = await measure("caisse", h.url("pos"), async () => { await page.getByText("Eau minérale").first().click(); }); if (m.cls > 0.1 || m.inp > 200) throw new Error(JSON.stringify(m)); });
    fs.writeFileSync(path.join(OUT, "recette-mesures.json"), JSON.stringify(metrics, null, 1));
    console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); }
  process.exit(0);
})();
