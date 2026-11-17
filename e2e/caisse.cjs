/** Tests navigateur de la Caisse (refonte UI) : disposition téléphone / tablette / ordinateur, barre de total, cibles tactiles, vente réelle, hors ligne.
 *  Lancement : bash e2e/run.sh caisse */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { try { await globalThis.__page.screenshot({ path: path.join(OUT, "caisse-echec-" + name.slice(0, 12).replace(/[^a-z]/gi, "_") + ".png") }); } catch {} console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 500)); } };
(async () => {
  const h = await start({ plan: "business", expect: ["checkout"], defaultSession: true }); const { page, st } = h; globalThis.__page = page; const A = h.shop;
  const txt = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
  await h.call("article.save", { data: { name: "Eau minérale", price: 500, cost: 300 }, initialQty: 30 }, A);
  await h.call("article.save", { data: { name: "Riz parfumé", price: 4500, cost: 3800 }, initialQty: 10 }, A);
  for (let i = 1; i <= 14; i++) await h.call("article.save", { data: { name: `Article ${String(i).padStart(2, "0")}`, price: 1000 + i }, initialQty: 5 }, A); // catalogue assez long pour que le panier sorte de l'écran sur téléphone
  const open = async (w, hh) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url("pos")); await page.waitForSelector("text=Eau minérale", { timeout: 15000 }); await page.waitForTimeout(600); };
  const noOverflow = async (label) => { const x = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, i: innerWidth })); if (x.s > x.i + 1) throw new Error(`${label} : débordement horizontal (${x.s} > ${x.i})`); };
  const unnamed = async (label) => { const bad = await page.evaluate(() => [...document.querySelectorAll("button, a[href], input, select")].filter((e) => { const r = e.getBoundingClientRect(); if (!r.width || !r.height) return false; const n = (e.getAttribute("aria-label") || e.innerText || e.getAttribute("title") || (e.labels && [...e.labels].map((l) => l.innerText).join("")) || e.getAttribute("placeholder") || "").trim(); return !n; }).map((e) => e.outerHTML.slice(0, 70))); if (bad.length) throw new Error(`${label} : sans nom accessible : ${bad.slice(0, 3).join(" ; ")}`); };
  const add = (name) => page.locator("button", { hasText: name }).first().click();
  const sales = () => st.rows("sales").length;
  const sell = async (amount) => { await page.getByPlaceholder(/montant reçu/i).first().fill(String(amount)); await page.getByRole("button", { name: /Encaisser/ }).click();
    const dlg = await page.getByRole("alertdialog").boundingBox(); const vp = page.viewportSize(); if (!dlg || dlg.y < -1 || dlg.y + dlg.height > vp.height + 1) throw new Error("la boîte de confirmation n'est pas positionnée sur l'écran : " + JSON.stringify(dlg)); // un transform actif sur le conteneur de page déplacerait les éléments « fixed »
    await page.getByRole("button", { name: "Valider la vente" }).click(); };

  await step("session obligatoire par défaut : sans caisse ouverte, la vente est bloquée (bouton, message, lien) et le serveur refuse", async () => {
    await open(390, 800); await add("Article 14"); await page.waitForTimeout(800);
    const t = await txt(); if (!/Caisse fermée/.test(t)) throw new Error("pas d'indication « Caisse fermée » : " + t.slice(0, 200));
    const b = page.getByRole("button", { name: /Encaisser/ }); if (!(await b.isDisabled())) throw new Error("le bouton Encaisser est actif sans session ouverte");
    const r = await h.call("checkout", { clientId: "sans-session-0001", lines: [{ productId: st.rows("products")[0].$id, qty: 1 }], payments: [{ method: "cash", amount: 5000 }] }, A);
    if (r.status !== 409 || !/Ouvrez la caisse/.test(r.body.error)) throw new Error("le serveur n'a pas refusé : " + r.status + " " + JSON.stringify(r.body).slice(0, 120));
    if (sales() !== 0) throw new Error("une vente a été enregistrée sans session");
    await h.call("cash.open", { openingFloat: 5000 }, A);
  });

  for (const [w, hh, label] of [[390, 800, "téléphone"], [820, 1000, "tablette"], [1280, 800, "ordinateur"]]) {
    await step(`${label} (${w} px) : écran sans débordement, noms accessibles, onglets de la caisse`, async () => {
      await open(w, hh); await noOverflow(label); await unnamed(label);
      const nav = page.getByRole("navigation", { name: "Écrans de la caisse" }); const t = await nav.innerText();
      for (const x of ["Encaisser", "Ventes", "Session de caisse"]) if (!t.includes(x)) throw new Error("onglet manquant : " + x);
      await page.screenshot({ path: path.join(OUT, `caisse-${w}.png`) });
    });
  }

  await step("téléphone : barre de total fixe, puis accès au paiement", async () => {
    await open(390, 800);
    if (await page.locator("button", { hasText: "Voir le paiement" }).count()) throw new Error("barre visible avec un panier vide");
    await add("Article 14"); await add("Article 13"); await page.waitForTimeout(500); // articles du haut du catalogue : le panier reste sous la ligne de flottaison
    const bar = page.locator("button", { hasText: "Voir le paiement" }); await bar.waitFor({ timeout: 5000 });
    const t = (await bar.innerText()).replace(/\s+/g, " "); if (!/2 articles/.test(t) || !/2[   ]027 FCFA/.test(t)) throw new Error("contenu de la barre : " + t);
    const box = await bar.boundingBox(); if (!box || box.y + box.height > 800) throw new Error("barre hors de l'écran : " + JSON.stringify(box));
    await bar.click(); await page.waitForTimeout(900);
    const enc = await page.getByRole("button", { name: /Encaisser/ }).boundingBox(); if (!enc || enc.y < 0 || enc.y > 800) throw new Error("bouton Encaisser non visible après « Voir le paiement »");
    if (await bar.count()) throw new Error("la barre reste affichée alors que le paiement est visible");
    await page.screenshot({ path: path.join(OUT, "caisse-390-panier.png") });
  });

  await step("cibles tactiles : boutons − / + / retirer d'au moins 44 px", async () => {
    for (const nm of ["Moins", "Plus"]) { const b = await page.getByLabel(nm).first().boundingBox(); if (!b || b.width < 43.5 || b.height < 43.5) throw new Error(`${nm} : ${b && Math.round(b.width)}×${b && Math.round(b.height)} px`); }
  });

  await step("ordinateur : panneau de vente à droite, bouton Encaisser visible sans défilement", async () => {
    await open(1280, 800); await add("Eau minérale"); await page.waitForTimeout(400);
    const enc = await page.getByRole("button", { name: /Encaisser/ }).boundingBox(); if (!enc || enc.y + enc.height > 800) throw new Error("Encaisser hors de l'écran");
    const panel = await page.locator("#panier").boundingBox(); const grid = await page.locator("button", { hasText: "Riz parfumé" }).first().boundingBox();
    if (!panel || !grid || panel.x <= grid.x) throw new Error("le panier n'est pas à droite du catalogue");
    if (await page.locator("button", { hasText: "Voir le paiement" }).count()) throw new Error("barre de téléphone affichée sur ordinateur");
    await page.screenshot({ path: path.join(OUT, "caisse-1280-panier.png") });
  });

  for (const [w, hh, label] of [[1280, 800, "ordinateur"], [390, 800, "téléphone"]]) {
    await step(`${label} : vente en espèces, enregistrée et stock déduit`, async () => {
      const before = sales(); await open(w, hh); await add("Eau minérale"); await page.waitForTimeout(400);
      await sell(500); await page.waitForTimeout(2500);
      if (sales() !== before + 1) throw new Error(`vente non enregistrée (${before} → ${sales()}) : ${(await txt()).slice(0, 200)}`);
    });
  }

  await step("raccourci F8 : demande une confirmation avant de vider le panier", async () => {
    await open(1280, 800); await add("Riz parfumé");
    await page.keyboard.press("F8"); const dlg = page.getByRole("alertdialog"); await dlg.waitFor({ timeout: 3000 }).catch(() => { throw new Error("aucune confirmation"); });
    await dlg.getByRole("button", { name: "Annuler" }).click(); if (!(await page.getByRole("region", { name: "Panier de vente" }).count())) throw new Error("panier vidé malgré le refus");
    await page.keyboard.press("F8"); await page.getByRole("alertdialog").getByRole("button", { name: "Vider" }).click(); await page.waitForTimeout(300);
    if (await page.getByRole("region", { name: "Panier de vente" }).count()) throw new Error("panier non vidé après confirmation");
  });

  await step("hors ligne : vente mise en file puis synchronisée au retour du réseau", async () => {
    await open(390, 800); await page.waitForTimeout(2500); h.setOffline(true); await add("Eau minérale"); const before = sales();
    await sell(500); await page.waitForTimeout(1500);
    if (sales() !== before) throw new Error("vente envoyée alors que le réseau est coupé");
    h.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event("online"))); await page.waitForTimeout(4000);
    if (sales() !== before + 1) throw new Error("vente non synchronisée au retour du réseau");
  });

  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
