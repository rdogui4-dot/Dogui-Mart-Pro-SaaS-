/** Lot K0 (kit 24 interfaces) : système de design — page de référence interne (administrateur seulement), composants, états, clavier, responsive, clair/sombre. Lancement : bash e2e/run.sh kit0 */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
(async () => {
  { const h = await start({ plan: "pro", expect: [] }); const { page } = h;
    await step("commerçant (non administrateur) : page de référence refusée", async () => {
      await page.setViewportSize({ width: 1280, height: 800 }); await page.goto(h.url("ui-kit")); await page.waitForSelector("text=Accès non autorisé", { timeout: 15000 });
      if (await page.getByText("Système de design").count()) throw new Error("page visible");
    });
    await h.close(); }

  const h = await start({ plan: "pro", admin: true, expect: [] }); const { page } = h;
  for (const theme of ["light", "dark"]) for (const w of [390, 820, 1280]) await step(`page de référence ${theme} ${w} px : en-tête, 5 indicateurs, aucun débordement horizontal`, async () => {
    await page.setViewportSize({ width: w, height: 900 }); await page.goto(h.url("accueil")); await page.evaluate((t) => localStorage.setItem("dmp-theme", t), theme); await page.goto(h.url("ui-kit"));
    await page.waitForSelector("text=Système de design", { timeout: 15000 }); await page.waitForTimeout(600);
    const n = await page.locator('[role="group"]').count(); if (n < 5) throw new Error(n + " indicateurs");
    const o = await overflow(page); if (o > 1) throw new Error("débordement " + o + " px");
    await page.screenshot({ path: path.join(OUT, `kit0-composants-${theme}-${w}.png`), fullPage: true });
  });
  await page.evaluate(() => localStorage.setItem("dmp-theme", "light"));
  await step("onglets : flèche droite change l'onglet sélectionné (clavier)", async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("ui-kit")); await page.waitForSelector("text=Système de design", { timeout: 15000 });
    await page.getByRole("tab", { name: /Composants/ }).focus(); await page.keyboard.press("ArrowRight");
    if ((await page.getByRole("tab", { name: /Tableau/ }).getAttribute("aria-selected")) !== "true") throw new Error("onglet non changé");
    const f = await page.evaluate(() => document.activeElement?.textContent ?? ""); if (!/Tableau/.test(f)) throw new Error("focus non déplacé : " + f);
  });
  await step("tableau : tout sélectionner affiche les actions groupées ; ligne → panneau de détail ; pagination", async () => {
    await page.getByRole("checkbox", { name: "Tout sélectionner" }).check(); await page.getByRole("region", { name: "Actions groupées" }).getByText("5 sélectionnés").waitFor({ timeout: 3000 });
    await page.getByRole("button", { name: "Tout désélectionner" }).click(); if (await page.getByRole("region", { name: "Actions groupées" }).count()) throw new Error("barre restée");
    if ((await page.locator("table").evaluate((t) => t.parentElement.scrollWidth - t.parentElement.clientWidth)) > 1) throw new Error("tableau rogné à 1280 px");
    await page.getByRole("button", { name: "Voir EX-0002" }).click(); await page.getByRole("dialog", { name: "Détail EX-0002" }).waitFor({ timeout: 3000 });
    await page.screenshot({ path: path.join(OUT, "kit0-tableau-1280.png") }); await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    // 1600 px : côte à côte seulement si la zone disponible le permet (sinon fiche) ; dans les deux cas le tableau n'est jamais rogné
    await page.setViewportSize({ width: 1600, height: 900 }); await page.getByRole("button", { name: "Voir EX-0002" }).click(); await page.waitForTimeout(500);
    const side = await page.getByRole("complementary", { name: "Détail EX-0002" }).count(), sheet = await page.getByRole("dialog", { name: "Détail EX-0002" }).count(); if (!side && !sheet) throw new Error("détail non ouvert (1600 px)");
    if (side && (await page.locator("table").evaluate((t) => t.parentElement.scrollWidth - t.parentElement.clientWidth)) > 1) throw new Error("tableau rogné à côté du panneau (1600 px)");
    await page.screenshot({ path: path.join(OUT, "kit0-tableau-1600.png") });
    if (side) await page.getByRole("button", { name: "Fermer le détail" }).click(); else { await page.keyboard.press("Escape"); await page.waitForTimeout(300); } await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("button", { name: "Page 2" }).click(); if ((await page.getByRole("button", { name: "Page 2" }).getAttribute("aria-current")) !== "page") throw new Error("pagination");
    await page.getByLabel("Rechercher (exemple)").fill("exemple C"); if ((await page.locator("tbody tr").count()) !== 1) throw new Error("filtre de recherche");
  });
  await step("téléphone : lignes en cartes, détail en fiche plein écran (Échap ferme)", async () => {
    await page.setViewportSize({ width: 390, height: 800 }); await page.goto(h.url("ui-kit")); await page.waitForSelector("text=Système de design", { timeout: 15000 });
    await page.getByRole("tab", { name: /Tableau/ }).click(); const cards = page.getByRole("list", { name: "Tableau d'exemple" });
    if ((await cards.locator("li").count()) !== 5) throw new Error("cartes absentes"); if (await page.locator("table").isVisible()) throw new Error("tableau visible sur téléphone");
    await cards.locator("li button").first().click(); await page.getByRole("dialog", { name: "Détail EX-0001" }).waitFor({ timeout: 3000 });
    await page.screenshot({ path: path.join(OUT, "kit0-detail-390.png") }); await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    if (await page.getByRole("dialog").count()) throw new Error("fiche non fermée");
  });
  await step("états : chargement, erreur (alerte + réessayer), partiel, succès, accès refusé, offre supérieure, vide", async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("ui-kit")); await page.waitForSelector("text=Système de design", { timeout: 15000 });
    await page.getByRole("tab", { name: /États/ }).click(); await page.waitForTimeout(300);
    for (const t of ["Chargement impossible", "Données partielles.", "Enregistré", "Accès refusé", "Disponible avec l'offre Pro", "Aucun élément"]) if (!(await page.getByText(t, { exact: false }).count())) throw new Error("absent : " + t);
    if (!(await page.getByRole("button", { name: "Réessayer" }).count())) throw new Error("réessayer absent");
    if (!(await page.locator('[aria-busy="true"]').count())) throw new Error("chargement non signalé");
    await page.screenshot({ path: path.join(OUT, "kit0-etats-1280.png"), fullPage: true });
  });
  await step("noms accessibles : tous les boutons et champs de la page ont un nom", async () => {
    for (const tab of ["Composants", "Tableau", "États"]) {
      await page.getByRole("tab", { name: new RegExp(tab) }).click(); await page.waitForTimeout(200);
      const bad = await page.evaluate(() => [...document.querySelectorAll("main button, main input, main select")].filter((e) => { const lbl = e.getAttribute("aria-label") || e.textContent?.trim() || (e.id && document.querySelector(`label[for="${e.id}"]`)) || e.closest("label")?.textContent?.trim(); return !lbl; }).map((e) => e.outerHTML.slice(0, 80)));
      if (bad.length) throw new Error(tab + " : " + bad.join(" | "));
    }
  });
  await step("mouvement réduit : aucune animation en cours", async () => {
    await page.emulateMedia({ reducedMotion: "reduce" }); await page.goto(h.url("ui-kit")); await page.waitForSelector("text=Système de design", { timeout: 15000 }); await page.waitForTimeout(800);
    const run = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && Number(a.effect?.getComputedTiming().duration ?? 0) > 20).length); if (run) throw new Error(run + " animation(s)");
    await page.emulateMedia({ reducedMotion: "no-preference" });
  });
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
