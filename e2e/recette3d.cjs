/** Recette 3D (lot 3D-6) : replis (appareil modeste, sans WebGL, mouvement réduit sur tout le parcours), libération du graphique WebGL, clavier sur les cartes retournables, mesures sous contrainte (processeur ×4, réseau lent) des écrans 3D. Lancement : bash e2e/run.sh recette3d */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const metrics = [];
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 500)); } };
(async () => {
  const h = await start({ plan: "pro", expect: [] }); const { page } = h; const A = h.shop;
  const p1 = (await h.call("article.save", { data: { name: "Riz", price: 1000, cost: 600 }, initialQty: 500 }, A)).body.data.id;
  for (let d = 0; d < 6; d++) await h.call("checkout", { clientId: "r" + d + Math.random().toString(36).slice(2, 8), lines: [{ productId: p1, qty: d + 1 }], payments: [{ method: "cash", amount: (d + 1) * 1000 }], soldAt: new Date(Date.now() - d * 864e5).toISOString() }, A);

  await page.setViewportSize({ width: 1280, height: 900 });
  await step("appareil modeste (2 cœurs) : affichage plat automatique, graphique 2D, aucun téléchargement de three.js", async () => {
    await page.addInitScript(() => { try { if (sessionStorage.getItem("modest") === "1") Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 2 }); } catch {} });
    await page.goto(h.url("accueil")); await page.evaluate(() => sessionStorage.setItem("modest", "1"));
    const reqs = []; const on = (r) => { if (/Chart3D/.test(r.url())) reqs.push(r.url()); }; page.on("request", on);
    await page.goto(h.url("activite")); await page.waitForSelector("text=CA du jour", { timeout: 15000 }); await page.waitForTimeout(1500); page.off("request", on);
    const lvl = await page.evaluate(() => document.documentElement.dataset.fx3d); if (lvl !== "flat") throw new Error("niveau " + lvl); if (await page.locator("[data-chart3d]").count()) throw new Error("graphique 3D présent"); if (reqs.length) throw new Error("three.js téléchargé");
    await page.evaluate(() => sessionStorage.removeItem("modest"));
  });
  await step("sans WebGL : graphique 2D de repli, cartes en relief conservées", async () => {
    await page.addInitScript(() => { let on = false; try { on = sessionStorage.getItem("nogl") === "1"; } catch {} if (on) { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { return /webgl/.test(String(t)) ? null : g.call(this, t, ...a); }; } });
    await page.goto(h.url("accueil")); await page.evaluate(() => sessionStorage.setItem("nogl", "1")); await page.goto(h.url("activite")); await page.waitForSelector("text=CA du jour", { timeout: 15000 }); await page.waitForTimeout(1500);
    if (await page.locator("[data-chart3d]").count()) throw new Error("canvas 3D malgré l'absence de WebGL"); if (!(await page.getByRole("img", { name: /7 derniers jours/ }).count()) && !(await page.locator("text=Évolution du CA — 7 derniers jours").count())) throw new Error("graphique de repli absent");
    if (!(await page.locator(".d3-flip").count())) throw new Error("cartes absentes"); await page.evaluate(() => sessionStorage.removeItem("nogl"));
  });
  await step("graphique WebGL libéré en quittant le tableau de bord (aucun canvas restant)", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(h.url("activite")); await page.waitForSelector("[data-chart3d] canvas", { timeout: 15000 }); await page.goto(h.url("stock")); await page.waitForTimeout(800);
    // navigation interne : on repasse par l'accueil sans recharger
    await page.goto(h.url("activite")); await page.waitForSelector("[data-chart3d] canvas", { timeout: 15000 }); await page.locator('aside[aria-label="Espaces"] a[href$="/pos"]').first().click(); await page.waitForTimeout(800);
    const n = await page.evaluate(() => document.querySelectorAll("canvas").length); if (n) throw new Error(n + " canvas restant(s)");
  });
  await step("mouvement réduit : aucune animation en cours sur tout le parcours 3D (tableau de bord, caisse, réglages, articles, page Plus)", async () => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const [r, w] of [["activite", 1280], ["pos", 1280], ["reglages", 1280], ["articles", 1280], ["plus", 390]]) { await page.setViewportSize({ width: w, height: 900 }); await page.goto(h.url(r)); await page.waitForTimeout(1300); const run = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && Number(a.effect?.getComputedTiming().duration ?? 0) > 20).map((a) => a.animationName || "transition")); if (run.length) throw new Error(`${r} : ${run.join(",")}`); }
    await page.emulateMedia({ reducedMotion: "no-preference" }); await page.setViewportSize({ width: 1280, height: 900 });
  });
  await step("clavier : carte KPI retournée et revenue au clavier (Tab, Entrée), focus visible", async () => {
    await page.goto(h.url("activite")); await page.waitForSelector("text=CA du jour", { timeout: 15000 }); await page.waitForTimeout(800);
    const b = page.getByRole("button", { name: "Définition : CA du jour" }); await b.focus(); const o = await b.evaluate((e) => getComputedStyle(e).outlineStyle); await page.keyboard.press("Enter"); await page.waitForTimeout(500);
    if ((await page.locator(".d3-flip").first().getAttribute("data-flipped")) !== "true") throw new Error("non retourné au clavier"); await page.keyboard.press("Enter"); await page.waitForTimeout(500);
    if ((await page.locator(".d3-flip").first().getAttribute("data-flipped")) !== "false") throw new Error("pas revenu"); if (o !== "solid") throw new Error("focus non visible : " + o);
  });
  const measure = async (label, route, interact, w = 390) => {
    const cdp = await page.context().newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 }); await cdp.send("Network.enable"); await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 90_000 });
    await page.setViewportSize({ width: w, height: 900 }); await page.goto("about:blank");
    await page.addInitScript(() => { if (window.__mOn) return; window.__mOn = true; /* un seul observateur par page : les scripts des mesures précédentes restent installés */ window.__m = { cls: 0, lcp: 0, inp: 0 }; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__m.cls += e.value; }).observe({ type: "layout-shift", buffered: true }); new PerformanceObserver((l) => { const e = l.getEntries(); window.__m.lcp = e[e.length - 1].startTime; }).observe({ type: "largest-contentful-paint", buffered: true }); new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.inp = Math.max(window.__m.inp, e.duration); }).observe({ type: "event", buffered: true, durationThreshold: 16 }); } catch {} });
    await page.goto(h.url(route), { waitUntil: "load", timeout: 60000 }); await page.waitForTimeout(3500); if (interact) await interact(); await page.waitForTimeout(800);
    const m = await page.evaluate(() => ({ lcp: Math.round(window.__m.lcp), cls: Number(window.__m.cls.toFixed(3)), inp: Math.round(window.__m.inp) })); metrics.push({ page: label, ...m }); console.log("     mesures", label, JSON.stringify(m));
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 }); await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); await cdp.detach();
    if (m.lcp > 2500 || m.cls > 0.1 || m.inp > 200) throw new Error(JSON.stringify(m));
  };
  await step("mesures (processeur ×4, réseau lent) : tableau de bord 3D sur ordinateur (retournement d'une carte)", () => measure("tableau de bord 3D (ordinateur)", "activite", async () => { await page.getByRole("button", { name: "Définition : Encaissé" }).click(); }, 1280));
  await step("mesures (processeur ×4, réseau lent) : tableau de bord sur téléphone (3D allégée)", () => measure("tableau de bord (téléphone)", "activite", async () => { await page.getByRole("button", { name: "Définition : CA du jour" }).click(); }));
  await step("mesures (processeur ×4, réseau lent) : caisse (ajout au panier)", () => measure("caisse (téléphone)", "pos", async () => { await page.locator("button.d3-tile", { hasText: "Riz" }).first().click(); }));
  await step("mesures (processeur ×4, réseau lent) : articles, ouverture d'une fiche en perspective", () => measure("articles (ordinateur)", "articles", async () => { await page.locator("tbody tr").first().click(); }, 1280));
  await step("mesures (processeur ×4, réseau lent) : réglages, changement d'onglet (cartes qui se déplient)", () => measure("réglages (téléphone)", "reglages", async () => { await page.getByRole("tab", { name: "Règles de gestion" }).click(); }));
  fs.writeFileSync(path.join(OUT, "recette3d-mesures.json"), JSON.stringify(metrics, null, 1));
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
