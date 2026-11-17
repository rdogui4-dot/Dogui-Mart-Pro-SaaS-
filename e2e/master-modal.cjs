/** MASTER DOGUI en fenêtre : ouverture depuis la barre supérieure et le menu, sans quitter l'écran courant ; adresses /master et /merci conservées. Lancement : bash e2e/run.sh master-modal */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { try { await globalThis.__page.screenshot({ path: path.join(OUT, "mm-echec-" + name.slice(0, 10).replace(/[^a-z]/gi, "_") + ".png") }); } catch {} console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 500)); } };
(async () => {
  const h = await start({ plan: "pro", expect: [] }); const { page } = h; globalThis.__page = page; const A = h.shop;
  await h.call("article.save", { data: { name: "Eau minérale", price: 500, cost: 300 }, initialQty: 20 }, A); await h.call("cash.open", { openingFloat: 5000 }, A);
  const url = () => new URL(page.url()).pathname;
  const goPos = async (w, hh) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url("pos")); await page.waitForSelector("text=Eau minérale", { timeout: 15000 }); await page.waitForTimeout(600); };

  await step("ordinateur : bouton « MASTER DOGUI » dans la barre supérieure ; fenêtre centrée au-dessus de la caisse, l'adresse ne change pas", async () => {
    await goPos(1280, 800); await page.locator("button", { hasText: "Eau minérale" }).first().click(); await page.waitForTimeout(300);
    await page.locator("header").getByRole("button", { name: "MASTER DOGUI", exact: true }).click(); await page.waitForSelector('[role="dialog"][aria-label="MASTER DOGUI"]', { timeout: 8000 });
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)))); // mesure après l'animation d'ouverture (perspective et échelle)
    const d = await page.getByRole("dialog", { name: "MASTER DOGUI" }).boundingBox(); if (!d || Math.abs(d.x + d.width / 2 - 640) > 6 || d.width > 780 || d.width < 700) throw new Error("fenêtre non centrée : " + JSON.stringify(d));
    if (url() !== "/Dogui-Mart-Pro-SaaS-/pos") throw new Error("adresse changée : " + url());
    for (const t of ["Licence", "Rapports", "Profil", "Recommandations", "Assistant"]) if (!(await page.getByRole("tab", { name: t, exact: true }).count())) throw new Error("onglet manquant : " + t);
    await page.screenshot({ path: path.join(OUT, "mm-1280.png") });
  });
  await step("Échap ferme la fenêtre, le panier en cours est intact et le focus revient sur le bouton d'origine", async () => {
    await page.keyboard.press("Escape"); await page.waitForTimeout(400); if (await page.getByRole("dialog", { name: "MASTER DOGUI" }).count()) throw new Error("fenêtre encore ouverte");
    if (!(await page.locator("body").innerText()).includes("Total")) throw new Error("panier perdu");
    const f = await page.evaluate(() => document.activeElement?.getAttribute("aria-label")); if (f !== "MASTER DOGUI") throw new Error("focus non restauré : " + f);
  });
  await step("clic sur le fond atténué ferme la fenêtre", async () => {
    await page.locator("header").getByRole("button", { name: "MASTER DOGUI", exact: true }).click(); await page.waitForSelector('[role="dialog"][aria-label="MASTER DOGUI"]'); await page.mouse.click(30, 400); await page.waitForTimeout(400);
    if (await page.getByRole("dialog", { name: "MASTER DOGUI" }).count()) throw new Error("clic extérieur sans effet");
  });
  await step("l'entrée du menu « MASTER DOGUI » ouvre la fenêtre (pas de changement de page)", async () => {
    await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("button", { name: "MASTER DOGUI" }).click(); await page.waitForSelector('[role="dialog"][aria-label="MASTER DOGUI"]');
    if (url() !== "/Dogui-Mart-Pro-SaaS-/pos") throw new Error("page changée : " + url()); await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  });
  await step("téléphone : bouton court « MASTER », fenêtre plein écran, sans débordement", async () => {
    await goPos(390, 800); await page.locator("header").getByRole("button", { name: "MASTER DOGUI", exact: true }).click(); await page.waitForSelector('[role="dialog"][aria-label="MASTER DOGUI"]');
    const d = await page.getByRole("dialog", { name: "MASTER DOGUI" }).boundingBox(); if (!d || d.width < 385 || d.height < 790) throw new Error("fenêtre non plein écran : " + JSON.stringify(d));
    const x = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, i: innerWidth })); if (x.s > x.i + 1) throw new Error("débordement horizontal");
    await page.screenshot({ path: path.join(OUT, "mm-390.png") }); await page.getByRole("button", { name: "Fermer" }).first().click(); await page.waitForTimeout(300);
  });
  await step("adresse /master conservée : accueil + fenêtre ; fermer ramène à l'accueil", async () => {
    await page.setViewportSize({ width: 1280, height: 800 }); await page.goto(h.url("master")); await page.waitForSelector('[role="dialog"][aria-label="MASTER DOGUI"]', { timeout: 10000 });
    await page.keyboard.press("Escape"); await page.waitForTimeout(700); if (url() !== "/Dogui-Mart-Pro-SaaS-/accueil") throw new Error("pas de retour à l'accueil : " + url());
  });
  await step("adresse /merci conservée : fenêtre de retour de paiement, puis ouverture de MASTER DOGUI", async () => {
    await page.goto(h.url("merci")); await page.waitForSelector('[role="dialog"][aria-label="Merci pour votre paiement"]', { timeout: 10000 });
    await page.getByRole("button", { name: "Ouvrir MASTER DOGUI" }).click(); await page.waitForSelector('[role="dialog"][aria-label="MASTER DOGUI"]', { timeout: 8000 });
  });
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
