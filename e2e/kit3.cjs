/** Lot K3 (kit 24 interfaces) : Caisse / Point de vente (écran 09) — catégories avec compteurs, tuiles, panier (en-tête, total à payer), barre d'actions réelles selon la formule, mise en attente / reprise (sur l'appareil), raccourcis, responsive. Lancement : bash e2e/run.sh kit3 */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
(async () => {
  const h = await start({ plan: "pro", expect: [] }); const { page } = h; const A = h.shop;
  for (const [n, p, c, cat, q] of [["Riz local 5 kg", 5000, 4000, "Alimentaire", 30], ["Huile 1 L", 4000, 3000, "Alimentaire", 20], ["Eau minérale", 500, 300, "Boissons", 50], ["Savon", 500, 300, "Hygiène", 0]]) await h.call("article.save", { data: { name: n, price: p, cost: c, category: cat }, initialQty: q }, A);
  const open = async (w = 1280, hh = 900) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url("pos")); await page.waitForSelector("text=Eau minérale", { timeout: 15000 }); await page.waitForTimeout(700); };
  const tile = (n) => page.locator("button.d3-tile", { hasText: n }).first();
  const cart = () => page.getByRole("region", { name: "Panier de vente" });

  await step("en-tête et catégories avec le nombre réel d'articles (Tous 4, Alimentaire 2, Boissons 1, Hygiène 1)", async () => {
    await open(); if (!(await page.getByRole("heading", { name: "Caisse · Point de vente" }).count())) throw new Error("titre");
    const t = await page.getByRole("navigation", { name: "Catégories" }).innerText(); for (const x of [/Tous\s*\(4\)/, /Alimentaire\s*\(2\)/, /Boissons\s*\(1\)/, /Hygiène\s*\(1\)/]) if (!x.test(t)) throw new Error(t.replace(/\n/g, " "));
    await page.getByRole("navigation", { name: "Catégories" }).getByRole("button", { name: /Boissons/ }).click(); await page.waitForTimeout(300);
    if ((await page.locator("button.d3-tile").count()) !== 1) throw new Error("filtre catégorie"); await page.getByRole("navigation", { name: "Catégories" }).getByRole("button", { name: /Tous/ }).click();
  });
  await step("tuiles : stock en pastille, rupture non vendable", async () => {
    if (!/Stock : 30/.test(await tile("Riz local").innerText())) throw new Error("pastille stock"); if (!(await tile("Savon").isDisabled())) throw new Error("rupture vendable"); if (!/Rupture/.test(await tile("Savon").innerText())) throw new Error("rupture non signalée");
  });
  await step("panier : en-tête « Panier de vente (n articles) », total à payer, Encaisser (F4)", async () => {
    await tile("Riz local").click(); await tile("Eau minérale").click(); await tile("Eau minérale").click();
    const c = await cart().innerText(); if (!/Panier de vente\s*\(2 articles\)/.test(c)) throw new Error(c.slice(0, 120)); if (!/Total à payer\s*6\s?000 FCFA/.test(c)) throw new Error("total : " + c.slice(0, 400));
    await page.getByRole("button", { name: /Encaisser 6\s?000 FCFA/ }).waitFor({ timeout: 5000 }).catch(() => { throw new Error("bouton encaisser"); });
    await page.screenshot({ path: path.join(OUT, "kit3-caisse-1280.png") });
  });
  await step("barre d'actions (Pro, propriétaire) : Client F3, Remise F6, Avoir F7, Retour F9, attente, reprise, fin de journée", async () => {
    const t = await page.getByRole("navigation", { name: "Actions de caisse" }).innerText(); for (const x of ["Client", "F3", "Remise", "F6", "Avoir", "F7", "Retour", "F9", "Mettre en attente", "Reprendre", "Fin de journée"]) if (!t.includes(x)) throw new Error("absent : " + x);
    if (!(await page.getByRole("button", { name: /^Reprendre/ }).isDisabled())) throw new Error("reprendre actif sans panier en attente");
  });
  await step("raccourcis : F3 → recherche client, F6 → remise de ligne, F7 → ligne de bon d'achat", async () => {
    await page.keyboard.press("F3"); await page.waitForTimeout(300); if ((await page.evaluate(() => document.activeElement?.id)) !== "pos-client") throw new Error("F3");
    await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press("F6"); await page.waitForTimeout(300); if (!/^Remise /.test(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? ""))) throw new Error("F6");
    await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press("F7"); await page.waitForTimeout(300);
    const methods = await page.locator('select[aria-label^="Moyen de paiement"]').evaluateAll((els) => els.map((e) => e.value)); if (!methods.includes("voucher")) throw new Error("F7 : " + methods.join(","));
  });
  await step("mise en attente : panier vidé, conservé sur l'appareil (après rechargement), repris avec ses lignes", async () => {
    await page.getByRole("button", { name: "Mettre en attente" }).click(); await page.waitForTimeout(300);
    if (await cart().count()) throw new Error("panier non vidé"); if (!(await page.getByRole("button", { name: "Reprendre (1)" }).count())) throw new Error("compteur");
    await page.reload(); await page.waitForSelector("text=Eau minérale", { timeout: 15000 }); await page.waitForTimeout(600);
    await page.getByRole("button", { name: "Reprendre (1)" }).click(); const dlg = page.getByRole("dialog", { name: "Paniers en attente" }); await dlg.waitFor({ timeout: 3000 });
    if (!/Le stock n'est pas réservé/.test(await dlg.innerText())) throw new Error("avertissement absent"); await page.screenshot({ path: path.join(OUT, "kit3-attente-1280.png") });
    await dlg.getByRole("button", { name: "Reprendre", exact: true }).click(); await page.waitForTimeout(500);
    if (!/Total à payer\s*6\s?000 FCFA/.test(await cart().innerText())) throw new Error("panier non restauré"); if (!(await page.getByRole("button", { name: /^Reprendre/ }).isDisabled())) throw new Error("panier repris resté en attente");
  });
  await step("reprise refusée tant qu'un panier est en cours (rien n'est écrasé)", async () => {
    await page.getByRole("button", { name: "Mettre en attente" }).click(); await tile("Huile").click(); await page.getByRole("button", { name: "Reprendre (1)" }).click();
    await page.getByRole("dialog", { name: "Paniers en attente" }).getByRole("button", { name: "Reprendre", exact: true }).click(); await page.waitForTimeout(300);
    if (!/Mettez d'abord le panier en cours en attente/.test(await page.locator("body").innerText())) throw new Error("pas de refus"); await page.keyboard.press("Escape");
    if (!/Total à payer\s*4\s?000 FCFA/.test(await cart().innerText())) throw new Error("panier en cours écrasé");
  });
  await step("F9 : retour → page Ventes (remboursements tracés)", async () => { await page.keyboard.press("F9"); await page.waitForURL(/\/ventes/, { timeout: 5000 }); });
  for (const [w, hh] of [[1280, 800], [1024, 768]]) await step(`${w}×${hh} : panier long défilable jusqu'au bouton Encaisser (molette sur le panier)`, async () => {
    await open(w, hh); for (const n of ["Riz local", "Huile", "Eau minérale"]) await tile(n).click(); await page.getByRole("button", { name: /Wave/ }).first().click().catch(() => {}); await page.waitForTimeout(400);
    const box = await page.locator("#panier").boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + 200); await page.mouse.wheel(0, 4000); await page.waitForTimeout(400);
    const b = await page.getByRole("button", { name: /Encaisser/ }).boundingBox(); if (!b || b.y + b.height > hh) throw new Error("bouton Encaisser hors d'atteinte : " + JSON.stringify(b));
    await page.keyboard.press("F8"); await page.getByRole("alertdialog").getByRole("button", { name: "Vider" }).click();
  });
  for (const [w, cols] of [[360, 2], [412, 3]]) await step(`Android ${w} px : ${cols} articles par rangée, premiers articles visibles sans défiler, barre de total sur une ligne`, async () => {
    await open(w, 800); const boxes = await page.locator("button.d3-tile").evaluateAll((els) => els.slice(0, 4).map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.left), Math.round(r.height)]; }));
    const row1 = boxes.filter((b) => b[0] === boxes[0][0]).length; if (row1 !== cols) throw new Error(`${row1} par rangée : ${JSON.stringify(boxes)}`);
    if (boxes[0][0] > 380) throw new Error("premier article trop bas : " + boxes[0][0]); if (boxes[0][2] > 240) throw new Error("tuile trop haute : " + boxes[0][2]);
    await tile("Riz local").click(); const bar = page.getByRole("button", { name: /Voir le paiement/ }); const bh = (await bar.boundingBox()).height; if (bh > 50) throw new Error("barre sur deux lignes : " + bh);
    await page.screenshot({ path: path.join(OUT, `kit3-android-${w}.png`) });
  });
  for (const [w, theme] of [[1600, "light"], [820, "light"], [390, "light"], [1280, "dark"]]) await step(`${w} px ${theme} : aucun débordement (captures)`, async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(h.url("accueil")); await page.evaluate((t) => localStorage.setItem("dmp-theme", t), theme); await open(w);
    await tile("Riz local").click(); await page.waitForTimeout(300); const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error("débordement " + o);
    await page.screenshot({ path: path.join(OUT, `kit3-caisse-${theme}-${w}.png`), fullPage: true });
  });
  await page.evaluate(() => localStorage.setItem("dmp-theme", "light"));
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close();

  { const b = await start({ plan: "business", expect: [] }); const pg = b.page; await b.call("article.save", { data: { name: "Eau minérale", price: 500, cost: 300 }, initialQty: 10 }, b.shop);
    await step("formule Business : pas d'Avoir (bons d'achat Pro) ; Retour et Fin de journée présents", async () => {
      await pg.setViewportSize({ width: 1280, height: 900 }); await pg.goto(b.url("pos")); await pg.waitForSelector("text=Eau minérale", { timeout: 15000 }); await pg.waitForTimeout(600);
      const t = await pg.getByRole("navigation", { name: "Actions de caisse" }).innerText(); if (t.includes("Avoir")) throw new Error("avoir hors formule"); for (const x of ["Retour", "Fin de journée", "Mettre en attente"]) if (!t.includes(x)) throw new Error("absent : " + x);
    });
    console.log("ERRORS", b.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", b.bad); await b.close(); }
  process.exit(0);
})();
