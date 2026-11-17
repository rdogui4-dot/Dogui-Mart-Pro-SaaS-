/** Page publique (lot N4) : contenu immédiat, réseau neuronal différé et arrêtable, pause hors écran, replis (mouvement réduit, sans JavaScript), halo MASTER, LCP/CLS mesurés. Lancement : bash e2e/run.sh public */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const { chromium } = require("playwright");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 500)); } };
(async () => {
  const h = await start({ plan: "pro", expect: [] }); const { page } = h; const url = h.url("presentation/");
  const noOverflow = async (p, label) => { const x = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, i: innerWidth })); if (x.s > x.i + 1) throw new Error(`${label} : débordement (${x.s} > ${x.i})`); };
  for (const [w, hh] of [[390, 800], [820, 1000], [1280, 800]]) await step(`${w} px : titre, promesse et bouton visibles d'emblée, sans débordement`, async () => {
    await page.setViewportSize({ width: w, height: hh }); await page.goto(url); 
    const vis = await page.evaluate(() => { const h1 = document.querySelector("h1").getBoundingClientRect(); const cta = document.querySelector(".cta .btn").getBoundingClientRect(); return { h1: h1.top < innerHeight && h1.height > 0, cta: cta.top < innerHeight }; });
    if (!vis.h1 || !vis.cta) throw new Error(JSON.stringify(vis)); await noOverflow(page, `${w}`); await page.waitForTimeout(1500); await page.screenshot({ path: path.join(OUT, `pub-${w}.png`) });
  });
  await step("réseau : démarré après le chargement, 60 points au plus, décoratif, bouton pause qui l'arrête vraiment", async () => {
    await page.setViewportSize({ width: 1280, height: 800 }); await page.goto(url); await page.waitForSelector(".neural[data-state=running]", { timeout: 5000 });
    if ((await page.locator(".neural").getAttribute("aria-hidden")) !== "true") throw new Error("non décoratif");
    const f1 = Number(await page.locator(".neural").getAttribute("data-frames")); await page.waitForTimeout(600); const f2 = Number(await page.locator(".neural").getAttribute("data-frames")); if (!(f2 > f1)) throw new Error("animation inactive");
    await page.getByRole("button", { name: "Mettre en pause l'animation" }).click(); await page.waitForTimeout(200); const p1 = Number(await page.locator(".neural").getAttribute("data-frames")); await page.waitForTimeout(600); const p2 = Number(await page.locator(".neural").getAttribute("data-frames"));
    if (p2 !== p1) throw new Error("continue en pause"); if ((await page.getByRole("button", { name: "Reprendre l'animation" }).getAttribute("aria-pressed")) !== "true") throw new Error("état du bouton");
  });
  await step("réseau : suspendu quand l'en-tête sort de l'écran", async () => {
    await page.goto(url); await page.waitForSelector(".neural[data-state=running]", { timeout: 5000 }); await page.evaluate(() => scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(500);
    const a = Number(await page.locator(".neural").getAttribute("data-frames")); await page.waitForTimeout(700); const b = Number(await page.locator(".neural").getAttribute("data-frames")); if (b !== a) throw new Error(`images dessinées hors écran : ${a} → ${b}`);
  });
  await step("mouvement réduit : image fixe, aucun canvas, aucun bouton", async () => {
    const ctx = await page.context().browser().newContext({ reducedMotion: "reduce", viewport: { width: 1280, height: 800 } }); const p = await ctx.newPage(); await p.goto(url); await p.waitForTimeout(1500);
    if (await p.locator(".neural canvas").count()) throw new Error("canvas créé"); if (!(await p.locator(".neural-static").isVisible())) throw new Error("repli absent"); if (await p.locator(".neural-toggle").count()) throw new Error("bouton inutile"); await ctx.close();
  });
  await step("sans JavaScript : tout le contenu est visible (sections, offres, MASTER, questions)", async () => {
    const ctx = await page.context().browser().newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 800 } }); const p = await ctx.newPage(); await p.goto(url); await p.waitForTimeout(500);
    for (const id of ["#fonctions .card", "#offres .plan", "#master .master", "#questions details"]) { const o = await p.locator(id).first().evaluate((e) => getComputedStyle(e).opacity); if (o !== "1") throw new Error(`${id} invisible (opacité ${o})`); }
    if (!(await p.locator(".neural-static").isVisible())) throw new Error("repli absent"); await ctx.close();
  });
  await step("carte MASTER : symbole, halo au survol (pointeur précis) sans changer le texte", async () => {
    await page.goto(url); const m = page.locator(".master"); await m.scrollIntoViewIfNeeded(); await page.waitForTimeout(700); const box = await m.boundingBox(); await page.mouse.move(box.x + 60, box.y + 40); await page.waitForTimeout(400);
    const op = await m.evaluate((e) => getComputedStyle(e, "::before").opacity); if (op !== "1") throw new Error("halo absent : " + op); if (!(await page.locator(".master-symbol").isVisible())) throw new Error("symbole absent"); await m.screenshot({ path: path.join(OUT, "pub-master.png") });
  });
  await step("mesures : LCP < 2,5 s et CLS < 0,1 (local, sans réseau limité)", async () => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.addInitScript(() => { window.__cls = 0; window.__lcp = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); new PerformanceObserver((l) => { const e = l.getEntries(); window.__lcp = e[e.length - 1].startTime; }).observe({ type: "largest-contentful-paint", buffered: true }); });
    await page.goto(url); await page.waitForTimeout(2500); const m = await page.evaluate(() => ({ lcp: Math.round(window.__lcp), cls: Number(window.__cls.toFixed(3)) })); console.log("     mesures", JSON.stringify(m));
    if (m.lcp > 2500 || m.cls > 0.1) throw new Error(JSON.stringify(m));
  });
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
