/** 3D motion (lots 3D-0 et 3D-1) : graphique 3D WebGL chargé à la demande sur le tableau de bord, cartes KPI retournables (définition officielle), replis plats (mouvement réduit, préférence), aucun chargement de three.js ailleurs, mesures. Lancement : bash e2e/run.sh fx3d */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { try { await globalThis.__page.screenshot({ path: path.join(OUT, "fx-echec-" + name.slice(0, 12).replace(/[^a-z]/gi, "_") + ".png") }); } catch {} console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 500)); } };
(async () => {
  const h = await start({ plan: "pro", expect: [] }); const { page } = h; globalThis.__page = page; const A = h.shop;
  const p1 = (await h.call("article.save", { data: { name: "Riz", price: 1000, cost: 600 }, initialQty: 500 }, A)).body.data.id;
  const ago = (d) => new Date(Date.now() - d * 864e5).toISOString(); let n = 0;
  for (const [d, q] of [[0, 3], [1, 5], [2, 2], [3, 7], [5, 4], [6, 6]]) await h.call("checkout", { clientId: "fx" + (++n) + Math.random().toString(36).slice(2, 8), lines: [{ productId: p1, qty: q }], payments: [{ method: "cash", amount: q * 1000 }], soldAt: ago(d) }, A);
  const three = []; page.on("request", (r) => { if (/Chart3D|three/i.test(r.url())) three.push(r.url()); });
  const dash = async (w = 1280, hh = 900) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url("activite")); await page.waitForSelector("text=CA du jour", { timeout: 15000 }); await page.waitForTimeout(1800); };

  await step("accueil : three.js n'est pas chargé hors du tableau de bord", async () => { await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("accueil")); await page.waitForTimeout(2000); if (three.length) throw new Error("chargé : " + three[0]); });
  await step("ordinateur : niveau 3D complet, graphique WebGL des 7 derniers jours avec valeurs lisibles en texte", async () => {
    await dash(); const lvl = await page.evaluate(() => document.documentElement.dataset.fx3d); if (lvl !== "full") throw new Error("niveau " + lvl);
    await page.waitForSelector("[data-chart3d] canvas", { timeout: 8000 }); const fig = await page.getByRole("figure", { name: /vue 3D/ }).innerText(); if (!/7\s?000/.test(fig)) throw new Error("valeurs absentes : " + fig.slice(0, 200));
    await page.locator("[data-chart3d]").scrollIntoViewIfNeeded(); await page.waitForTimeout(900); await page.screenshot({ path: path.join(OUT, "fx-dashboard-1280.png") });
    await page.locator("[data-chart3d]").screenshot({ path: path.join(OUT, "fx-chart3d.png") });
  });
  await step("carte KPI : retournement vers la définition officielle, puis retour ; accessible (aria-pressed, face cachée masquée)", async () => {
    await dash(); const b = page.getByRole("button", { name: "Définition : CA du jour" }); await b.click(); await page.waitForTimeout(600);
    const card = page.locator(".d3-flip").first(); // CA du jour : première carte if ((await card.getAttribute("data-flipped")) !== "true") throw new Error("non retourné");
    const back = await card.locator(".d3-flip-back").innerText(); if (!/ventes terminées \(TTC\)/.test(back)) throw new Error("définition : " + back);
    if ((await card.locator(".d3-flip-front").getAttribute("aria-hidden")) !== "true") throw new Error("recto non masqué");
    await page.screenshot({ path: path.join(OUT, "fx-kpi-flip.png"), clip: { x: 0, y: 0, width: 1280, height: 600 } });
    await page.getByRole("button", { name: "Revenir à la valeur : CA du jour" }).click(); await page.waitForTimeout(500); if ((await card.getAttribute("data-flipped")) !== "false") throw new Error("pas revenu");
  });
  await step("mouvement réduit : affichage plat, graphique 2D, aucun canvas 3D, retournement sans rotation", async () => {
    await page.emulateMedia({ reducedMotion: "reduce" }); await dash(); if ((await page.evaluate(() => document.documentElement.dataset.fx3d)) !== "flat") throw new Error("pas plat");
    if (await page.locator("[data-chart3d]").count()) throw new Error("canvas 3D présent"); const tr = await page.locator(".d3-flip-inner").first().evaluate((e) => getComputedStyle(e).transform); await page.getByRole("button", { name: "Définition : CA du jour" }).click(); await page.waitForTimeout(300);
    const tr2 = await page.locator(".d3-flip-inner").first().evaluate((e) => getComputedStyle(e).transform); if (tr2 !== "none" && tr2 !== tr) throw new Error("rotation en mouvement réduit : " + tr2); await page.emulateMedia({ reducedMotion: "no-preference" });
  });
  await step("préférence « Effets 3D : Désactivés » (Mon profil) : affichage plat mémorisé ; « Automatique » rétablit la 3D", async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("reglages")); await page.waitForTimeout(900); await page.getByRole("tab", { name: "Mon profil" }).click(); await page.getByLabel("Effets 3D").selectOption("off"); await page.waitForTimeout(300);
    if (!/affichage plat/.test(await page.locator("body").innerText())) throw new Error("état non affiché"); await dash(); if (await page.locator("[data-chart3d]").count()) throw new Error("3D malgré la préférence");
    await page.goto(h.url("reglages")); await page.getByRole("tab", { name: "Mon profil" }).click(); await page.getByLabel("Effets 3D").selectOption("auto"); await dash(); if (!(await page.locator("[data-chart3d] canvas").count())) throw new Error("3D non rétablie");
  });
  await step("téléphone : niveau allégé, sans débordement", async () => { await dash(390, 800); if ((await page.evaluate(() => document.documentElement.dataset.fx3d)) !== "lite") throw new Error("niveau"); const x = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, i: innerWidth })); if (x.s > x.i + 1) throw new Error("débordement"); await page.screenshot({ path: path.join(OUT, "fx-dashboard-390.png") }); });
  await step("menu 3D (ordinateur) : la barre latérale se replie et se déplie sur charnière, sans transform résiduel", async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("accueil")); await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Replier le menu" }).click(); await page.waitForTimeout(60);
    const anim = await page.evaluate(() => document.querySelector('aside[aria-label="Espaces"] nav')?.getAnimations().map((a) => a.animationName).join(",")); if (!/d3-unfold-x/.test(anim || "")) throw new Error("pas d'animation de charnière : " + anim);
    await page.waitForTimeout(600); const st = await page.evaluate(() => getComputedStyle(document.querySelector('aside[aria-label="Espaces"] nav')).transform); if (st !== "none") throw new Error("transform résiduel : " + st);
    const w = (await page.getByRole("complementary", { name: "Espaces" }).boundingBox()).width; if (w > 80) throw new Error("largeur " + w);
    await page.getByRole("button", { name: "Déplier le menu" }).click(); await page.waitForTimeout(600); if ((await page.getByRole("complementary", { name: "Espaces" }).boundingBox()).width < 200) throw new Error("non déplié");
  });
  await step("menu 3D (téléphone, page Plus) : accordéon par espace (aria-expanded), dépliage animé, clavier", async () => {
    await page.setViewportSize({ width: 390, height: 800 }); await page.goto(h.url("plus")); await page.waitForTimeout(1200);
    const vendre = page.getByRole("button", { name: /^Vendre/ }), stock = page.getByRole("button", { name: /^Stock/ });
    if ((await vendre.getAttribute("aria-expanded")) !== "true" || (await stock.getAttribute("aria-expanded")) !== "false") throw new Error("état initial");
    if (await page.getByRole("link", { name: /Articles/ }).count()) throw new Error("contenu replié visible");
    await stock.focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(80); const anim = await page.evaluate(() => document.querySelector("#plus-stock a, #plus-stock button")?.getAnimations().map((a) => a.animationName).join(","));
    if (!/d3-unfold-y/.test(anim || "")) throw new Error("pas de dépliage animé : " + anim); await page.waitForTimeout(500);
    if ((await stock.getAttribute("aria-expanded")) !== "true" || !(await page.getByRole("link", { name: /Articles/ }).count())) throw new Error("non déplié");
    await page.screenshot({ path: path.join(OUT, "fx-plus-390.png") }); await vendre.click(); await page.waitForTimeout(300); if ((await vendre.getAttribute("aria-expanded")) !== "false") throw new Error("non replié");
  });
  await step("caisse HD : tuiles en relief, ligne de panier qui arrive en profondeur, confirmation retournée après la vente ; aucune transformation résiduelle", async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("pos")); await page.waitForSelector("text=Riz", { timeout: 15000 }); await page.waitForTimeout(800);
    const tile = page.locator("button.d3-tile", { hasText: "Riz" }).first(); if (!(await tile.count())) throw new Error("tuile sans relief");
    await tile.click(); await page.waitForTimeout(30); const line = await page.evaluate(() => document.querySelector("#panier .d3-line-in")?.getAnimations().map((a) => a.animationName).join(",")); if (!/d3-line-in/.test(line || "")) throw new Error("ligne sans animation : " + line);
    await page.waitForTimeout(400); const tr = await page.evaluate(() => getComputedStyle(document.querySelector("#panier section")).transform); if (tr !== "none") throw new Error("transform résiduel sur le panier : " + tr);
    await page.getByPlaceholder(/montant reçu/i).first().fill("5000"); await page.getByRole("button", { name: /Encaisser/ }).click();
    const dlg = await page.getByRole("alertdialog").boundingBox(); if (!dlg || dlg.y < 0 || dlg.y + dlg.height > 900) throw new Error("boîte de confirmation mal placée : " + JSON.stringify(dlg));
    await page.getByRole("button", { name: "Valider la vente" }).click(); await page.waitForTimeout(60);
    const conf = await page.evaluate(() => [...document.querySelectorAll(".d3-flip-in")].flatMap((e) => e.getAnimations().map((a) => a.animationName)).join(",")); if (!/d3-flip-in/.test(conf)) throw new Error("confirmation sans retournement : " + conf);
    await page.waitForTimeout(700); if (!/Vente/.test(await page.locator("[data-sync]").innerText())) throw new Error("message de vente absent");
    await page.screenshot({ path: path.join(OUT, "fx-caisse-1280.png") });
  });
  await step("caisse HD (processeur ×4) : ajout au panier — INP ≤ 200 ms, CLS ≤ 0,1", async () => {
    const cdp = await page.context().newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 }); await page.setViewportSize({ width: 390, height: 800 });
    await page.addInitScript(() => { window.__cls2 = 0; window.__inp2 = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls2 += e.value; }).observe({ type: "layout-shift", buffered: true }); new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__inp2 = Math.max(window.__inp2, e.duration); }).observe({ type: "event", buffered: true, durationThreshold: 16 }); });
    await page.goto(h.url("pos")); await page.waitForSelector("text=Riz", { timeout: 20000 }); await page.waitForTimeout(2500); await page.locator("button.d3-tile", { hasText: "Riz" }).first().click(); await page.waitForTimeout(800);
    const m = await page.evaluate(() => ({ cls: Number(window.__cls2.toFixed(3)), inp: Math.round(window.__inp2) })); console.log("     mesures caisse", JSON.stringify(m)); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 }); if (m.cls > 0.1 || m.inp > 200) throw new Error(JSON.stringify(m));
    await page.screenshot({ path: path.join(OUT, "fx-caisse-390.png") });
  });
  await step("modules : volet en perspective (fiche article), fenêtre MASTER qui sort de la profondeur, onglet actif en relief, lignes de tableau en relief ; aucun transform résiduel", async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("articles")); await page.waitForSelector("table", { timeout: 15000 }); await page.waitForTimeout(600);
    if (!(await page.locator("tbody tr.d3-row").count())) throw new Error("lignes sans relief");
    await page.locator("tbody tr").first().click(); await page.waitForTimeout(40); const an = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].flatMap((d) => d.getAnimations().map((a) => a.animationName)).join(","));
    if (!/d3-sheet-(panel|lg|md)/.test(an)) throw new Error("fiche sans entrée 3D : " + an); await page.waitForTimeout(500);
    const tr = await page.evaluate(() => getComputedStyle(document.querySelector('[role="dialog"]')).transform); if (tr !== "none") throw new Error("transform résiduel : " + tr); await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    await page.getByRole("button", { name: "MASTER DOGUI", exact: true }).first().click(); await page.waitForTimeout(40); const am = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].flatMap((d) => d.getAnimations().map((a) => a.animationName)).join(","));
    if (!/d3-sheet-modal/.test(am)) throw new Error("fenêtre MASTER sans entrée 3D : " + am); await page.waitForTimeout(400); await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    await page.goto(h.url("finance")); await page.waitForTimeout(1000); const tab = await page.locator('[role="tab"][aria-selected="true"]').first().evaluate((e) => getComputedStyle(e).transform); if (tab === "none") throw new Error("onglet actif sans relief");
  });
  await step("réglages : cartes de la section qui se déplient en cascade au changement d'onglet ; « Enregistré » en relief après réponse du serveur", async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("reglages")); await page.waitForTimeout(1000);
    await page.getByRole("tab", { name: "Règles de gestion" }).click(); await page.waitForTimeout(30);
    const an = await page.evaluate(() => [...document.querySelectorAll(".d3-settings > *")].flatMap((e) => e.getAnimations().map((a) => a.animationName)).join(",")); if (!/d3-unfold-y/.test(an)) throw new Error("cartes sans dépliage : " + an);
    await page.getByRole("tab", { name: "Boutique", exact: true }).click(); await page.waitForTimeout(500); await page.getByLabel("Ville").fill("Dakar"); await page.locator("form").getByRole("button", { name: "Enregistrer" }).click();
    const saved = page.locator(".d3-saved"); await saved.waitFor({ timeout: 6000 }); if (!/Enregistré/.test(await saved.innerText())) throw new Error("confirmation"); await page.waitForTimeout(400);
    if ((await saved.evaluate((e) => getComputedStyle(e).transform)) !== "none") throw new Error("transform résiduel"); await page.screenshot({ path: path.join(OUT, "fx-reglages-1280.png") });
  });
  await step("mesures (processeur ×4) : tableau de bord 3D — CLS ≤ 0,1, INP ≤ 200 ms (retournement d'une carte)", async () => {
    const cdp = await page.context().newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 }); await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript(() => { window.__cls = 0; window.__inp = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__inp = Math.max(window.__inp, e.duration); }).observe({ type: "event", buffered: true, durationThreshold: 16 }); });
    await page.goto(h.url("activite")); await page.waitForSelector("text=CA du jour", { timeout: 20000 }); await page.waitForTimeout(3000); await page.getByRole("button", { name: "Définition : Encaissé" }).click(); await page.waitForTimeout(800);
    const m = await page.evaluate(() => ({ cls: Number(window.__cls.toFixed(3)), inp: Math.round(window.__inp) })); console.log("     mesures", JSON.stringify(m)); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 }); if (m.cls > 0.1 || m.inp > 200) throw new Error(JSON.stringify(m));
  });
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
