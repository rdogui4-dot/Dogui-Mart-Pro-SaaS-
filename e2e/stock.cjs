/** Tests navigateur Stock / Articles / Bundles / Inventaire (refonte UI). Lancement : bash e2e/run.sh stock */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { try { await globalThis.__page.screenshot({ path: path.join(OUT, "stock-echec-" + name.slice(0, 10).replace(/[^a-z]/gi, "_") + ".png") }); } catch {} console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 500)); } };
(async () => {
  const h = await start({ plan: "pro", expect: [] }); const { page, st } = h; globalThis.__page = page; const A = h.shop;
  const txt = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
  for (let i = 1; i <= 12; i++) await h.call("article.save", { data: { name: `Article ${String(i).padStart(2, "0")}`, price: 1000 + i * 10, cost: 600, minStock: 5, category: i % 2 ? "Boissons" : "Épicerie" }, initialQty: i % 4 === 0 ? 2 : 20 }, A);
  const open = async (route, w, hh, wait) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url(route)); await page.waitForSelector(`text=${wait}`, { timeout: 15000 }); await page.waitForTimeout(900); };
  const noOverflow = async (label) => { const x = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, i: innerWidth })); if (x.s > x.i + 1) throw new Error(`${label} : débordement horizontal (${x.s} > ${x.i})`); };
  const unnamed = async (label) => { const bad = await page.evaluate(() => [...document.querySelectorAll("button, a[href], input, select")].filter((e) => { const r = e.getBoundingClientRect(); if (!r.width || !r.height) return false; const n = (e.getAttribute("aria-label") || e.innerText || e.getAttribute("title") || (e.labels && [...e.labels].map((l) => l.innerText).join("")) || e.getAttribute("placeholder") || "").trim(); return !n; }).map((e) => e.outerHTML.slice(0, 70))); if (bad.length) throw new Error(`${label} : sans nom accessible : ${bad.slice(0, 3).join(" ; ")}`); };

  for (const [route, wait] of [["stock", "Vue du stock"], ["articles", "Article 01"], ["bundles", "Bundles"], ["inventaire", "Inventaire"]]) {
    for (const [w, hh, label] of [[390, 800, "téléphone"], [820, 1000, "tablette"], [1280, 800, "ordinateur"]]) {
      await step(`${route} · ${label} (${w} px) : sans débordement, noms accessibles`, async () => { await open(route, w, hh, wait); await noOverflow(`${route} ${label}`); await unnamed(`${route} ${label}`); await page.screenshot({ path: path.join(OUT, `stock-${route}-${w}.png`) }); });
    }
  }

  await step("stock · ordinateur : onglets regroupés (principal / Analyses / Suivi) sans défilement horizontal, indicateurs sur 4 colonnes", async () => {
    await open("stock", 1280, 800, "Vue du stock");
    const t = (await txt()).toLowerCase(); for (const x of ["Comptage rapide", "Mouvements", "Transferts", "Analyses", "Suivi", "Réappro", "Lots", "Rapports"].map((x) => x.toLowerCase())) if (!t.includes(x)) throw new Error("manquant : " + x);
    const lists = await page.getByRole("tablist").evaluateAll((els) => els.map((e) => e.scrollWidth <= e.clientWidth + 1)); if (lists.some((x) => !x)) throw new Error("une rangée d'onglets défile horizontalement : " + JSON.stringify(lists));
    const k = await page.locator("text=Articles suivis").first().boundingBox(); const v = await page.locator("text=Valeur estimée du stock").first().boundingBox(); if (!k || !v || Math.abs(k.y - v.y) > 40) throw new Error("indicateurs non alignés sur une même ligne");
  });

  await step("articles · ordinateur : tableau (colonnes), tri par nom, volet latéral à l'ouverture", async () => {
    await open("articles", 1280, 800, "Article 01");
    if (!(await page.locator("table").count())) throw new Error("pas de tableau sur ordinateur");
    const heads = await page.locator("thead th").allInnerTexts(); for (const x of ["Article", "Catégorie", "Prix de vente", "Stock", "Statut"]) if (!heads.some((y) => y.includes(x))) throw new Error("colonne manquante : " + x);
    await page.getByRole("button", { name: /^Article ▲/ }).click(); await page.waitForTimeout(900);
    const first = (await page.locator("tbody tr").first().innerText()).replace(/\s+/g, " "); if (!/Article 12/.test(first)) throw new Error("tri Z → A : première ligne " + first.slice(0, 60));
    await page.locator("tbody tr").first().click(); await page.waitForTimeout(700);
    const dlg = await page.getByRole("dialog").first().boundingBox(); if (!dlg || dlg.x < 1280 - 560 || dlg.width > 560) throw new Error("fiche non affichée en volet à droite : " + JSON.stringify(dlg));
    await page.screenshot({ path: path.join(OUT, "stock-articles-volet.png") });
    await page.keyboard.press("Escape"); await page.waitForTimeout(500); if (await page.getByRole("dialog").count()) throw new Error("Échap ne ferme pas le volet");
  });

  await step("articles · téléphone : cartes (pas de tableau), fiche plein écran", async () => {
    await open("articles", 390, 800, "Article 01"); if (await page.locator("table").count()) throw new Error("tableau affiché sur téléphone");
    await page.locator("li button", { hasText: "Article 01" }).first().click(); await page.waitForTimeout(600);
    const dlg = await page.getByRole("dialog").first().boundingBox(); if (!dlg || dlg.width < 380) throw new Error("fiche non plein écran : " + JSON.stringify(dlg));
  });

  await step("articles · filtres mémorisés par appareil, bouton Réinitialiser", async () => {
    await open("articles", 1280, 800, "Article 01");
    await page.getByRole("button", { name: "Archivés", exact: true }).click(); await page.waitForTimeout(600);
    await page.reload(); await page.waitForTimeout(1500);
    if (!(await page.getByRole("button", { name: "Archivés", exact: true }).getAttribute("aria-current")).includes("true")) throw new Error("filtre « Archivés » non retrouvé après rechargement");
    await page.getByRole("button", { name: "Réinitialiser" }).click(); await page.waitForTimeout(600);
    if (!(await page.getByRole("button", { name: "Actifs", exact: true }).getAttribute("aria-current")).includes("true")) throw new Error("Réinitialiser n'a pas rétabli « Actifs »");
  });

  await step("articles · création par l'interface (formulaire large à deux colonnes) puis ajustement du stock", async () => {
    await open("articles", 1280, 800, "Article 01");
    await page.getByRole("button", { name: /Ajouter un article/ }).first().click(); await page.waitForSelector("text=Désignation", { timeout: 8000 });
    const f1 = await page.locator("label", { hasText: "Désignation" }).boundingBox(); const f2 = await page.locator("label", { hasText: "Référence" }).boundingBox(); if (!f1 || !f2 || Math.abs(f1.y - f2.y) > 30) throw new Error("formulaire sur une seule colonne");
    await page.locator("label", { hasText: "Désignation" }).locator("input").fill("Biscuit test"); await page.locator("label", { hasText: "Prix de vente" }).locator("input").fill("750");
    await page.getByRole("button", { name: "Créer l'article" }).click(); await page.waitForTimeout(2500);
    if (!st.rows("products").some((p) => p.name === "Biscuit test" && p.price === 750)) throw new Error("article non créé : " + (await txt()).slice(0, 200));
  });

  await step("bundles et inventaire : état vide expliqué", async () => {
    await open("inventaire", 1280, 800, "Inventaire"); if (!(await txt()).includes("sans afficher les quantités attendues")) throw new Error("état vide de l'inventaire non explicatif");
  });

  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
