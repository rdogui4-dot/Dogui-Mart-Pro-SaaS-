/** MASTER DOGUI en page complète (lot K14, remplace l'ancienne fenêtre) : accès depuis le menu latéral, la barre supérieure (téléphone), la recherche, le menu « Plus » ; adresses /master?onglet= et /merci. Lancement : bash e2e/run.sh master-modal */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
(async () => {
  const h = await start({ plan: "pro", expect: [] }); const { page } = h; const A = h.shop;
  await h.call("article.save", { data: { name: "Eau minérale", price: 500, cost: 300 }, initialQty: 20 }, A); await h.call("cash.open", { openingFloat: 5000 }, A);
  const url = () => new URL(page.url()); const head = () => page.getByRole("heading", { name: /MASTER DOGUI — Le cerveau intelligent/ }).waitFor({ timeout: 10000 });

  await step("ordinateur : entrée « MASTER DOGUI » du menu latéral → page /master (vue d'ensemble), sans fenêtre, entrée active", async () => {
    await page.setViewportSize({ width: 1280, height: 800 }); await page.goto(h.url("pos")); await page.waitForSelector("text=Eau minérale", { timeout: 15000 });
    await page.getByRole("link", { name: "MASTER DOGUI" }).first().click(); await head(); if (!url().pathname.endsWith("/master")) throw new Error(url().pathname); if (await page.getByRole("dialog").count()) throw new Error("fenêtre ouverte");
    if ((await page.getByRole("link", { name: "MASTER DOGUI" }).first().getAttribute("aria-current")) !== "page") throw new Error("entrée non active"); if ((await page.getByRole("tab", { name: "Vue d'ensemble" }).getAttribute("aria-selected")) !== "true") throw new Error("onglet par défaut");
  });
  await step("téléphone : bouton court « MASTER » de la barre supérieure → page, sans débordement", async () => {
    await page.setViewportSize({ width: 390, height: 800 }); await page.goto(h.url("accueil")); await page.waitForTimeout(1200); await page.getByRole("button", { name: "MASTER DOGUI" }).first().click(); await head();
    const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o); await page.screenshot({ path: path.join(OUT, "master-page-390.png"), fullPage: true });
  });
  await step("adresse /master?onglet=lic : onglet Licence ouvert directement ; changer d'onglet met l'adresse à jour", async () => {
    await page.setViewportSize({ width: 1280, height: 800 }); await page.goto(h.url("master?onglet=lic")); await head(); if ((await page.getByRole("tab", { name: "Licence" }).getAttribute("aria-selected")) !== "true") throw new Error("onglet licence");
    await page.getByRole("tab", { name: "Profil" }).click(); await page.waitForTimeout(500); if (url().searchParams.get("onglet") !== "pro") throw new Error(url().search);
  });
  await step("adresse /merci conservée : fenêtre de retour de paiement, puis « Ouvrir MASTER DOGUI » → page, onglet Licence", async () => {
    await page.goto(h.url("merci")); await page.waitForSelector('[role="dialog"][aria-label="Merci pour votre paiement"]', { timeout: 10000 }); await page.getByRole("button", { name: "Ouvrir MASTER DOGUI" }).click(); await head();
    if (url().searchParams.get("onglet") !== "lic") throw new Error(url().search);
  });
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
