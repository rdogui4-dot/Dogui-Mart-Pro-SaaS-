/** Tests navigateur Clients (CRM) et Promotions (refonte UI). Lancement : bash e2e/run.sh clients-promotions */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { try { await globalThis.__page.screenshot({ path: path.join(OUT, "cp-echec-" + name.slice(0, 10).replace(/[^a-z]/gi, "_") + ".png") }); } catch {} console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 500)); } };
(async () => {
  const h = await start({ plan: "pro", expect: [] }); const { page, st } = h; globalThis.__page = page; const A = h.shop;
  const txt = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const eau = (await h.call("article.save", { data: { name: "Eau minérale", price: 500, cost: 300 }, initialQty: 50 }, A)).body.data.id;
  for (const [n, ph] of [["Awa Traoré", "0701010101"], ["Moussa Diallo", "0702020202"], ["Fatou Koné", "0703030303"], ["Ibrahim Sané", "0704040404"]]) await h.call("crm.customer.save", { requestKey: crypto.randomUUID().replace(/-/g, ""), name: n, phone: ph }, A);
  const iso = (d) => new Date(Date.now() + d * 864e5).toISOString();
  for (const [n, v] of [["Rentrée", 10], ["Weekend", 15], ["Fidélité", 5]]) await h.call("promotion.save", { data: { name: n, kind: "percent", scope: "items", value: v, startAt: iso(-1), endAt: iso(10) }, productIds: [eau] }, A);
  const open = async (route, w, hh, wait) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url(route)); await page.waitForSelector(`text=${wait}`, { timeout: 15000 }); await page.waitForTimeout(900); };
  const noOverflow = async (label) => { const x = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, i: innerWidth })); if (x.s > x.i + 1) throw new Error(`${label} : débordement horizontal (${x.s} > ${x.i})`); };
  const unnamed = async (label) => { const bad = await page.evaluate(() => [...document.querySelectorAll("button, a[href], input, select")].filter((e) => { const r = e.getBoundingClientRect(); if (!r.width || !r.height) return false; const n = (e.getAttribute("aria-label") || e.innerText || e.getAttribute("title") || (e.labels && [...e.labels].map((l) => l.innerText).join("")) || e.getAttribute("placeholder") || "").trim(); return !n; }).map((e) => e.outerHTML.slice(0, 70))); if (bad.length) throw new Error(`${label} : sans nom accessible : ${bad.slice(0, 3).join(" ; ")}`); };

  for (const [route, wait] of [["clients", "Tableau"], ["promotions", "Créer une promotion"]]) for (const [w, hh, label] of [[390, 800, "téléphone"], [820, 1000, "tablette"], [1280, 800, "ordinateur"]])
    await step(`${route} · ${label} (${w} px) : sans débordement, noms accessibles`, async () => { await open(route, w, hh, wait); await noOverflow(`${route} ${label}`); await unnamed(`${route} ${label}`); await page.screenshot({ path: path.join(OUT, `cp-${route}-${w}.png`) }); });

  await step("clients · ordinateur : onglets regroupés (Suivi / Relations / Pro), aucun défilement horizontal", async () => {
    await open("clients", 1280, 800, "Tableau"); const t = (await txt()).toLowerCase(); for (const x of ["suivi", "relations", "pro", "agenda", "prospects", "opportunités", "segments", "campagnes", "automatisations", "équipes", "analyses", "crédit"]) if (!t.includes(x)) throw new Error("manquant : " + x);
    const lists = await page.getByRole("tablist").evaluateAll((els) => els.map((e) => e.scrollWidth <= e.clientWidth + 1)); if (lists.some((x) => !x)) throw new Error("une rangée défile horizontalement");
  });
  await step("clients · ordinateur : tableau (colonnes), ouverture de la fiche en volet, Échap ; téléphone : cartes", async () => {
    await open("clients", 1280, 800, "Tableau"); await page.getByRole("tab", { name: "Clients", exact: true }).click(); await page.waitForSelector("table", { timeout: 8000 });
    const heads = (await page.locator("thead th").allInnerTexts()).join("|"); for (const x of ["Client", "Contact", "Segment", "Total"]) if (!heads.includes(x)) throw new Error("colonne manquante : " + x);
    if ((await page.locator("tbody tr").count()) < 4) throw new Error("clients manquants");
    await page.locator("tbody tr").first().click(); await page.waitForTimeout(900); const d = await page.getByRole("dialog").first().boundingBox(); if (!d || d.x < 1280 - 560) throw new Error("fiche non affichée en volet : " + JSON.stringify(d));
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
    await open("clients", 390, 800, "Tableau"); await page.getByRole("tab", { name: "Clients", exact: true }).click(); await page.waitForTimeout(1200); if (await page.locator("table").count()) throw new Error("tableau sur téléphone");
  });
  await step("clients · filtres mémorisés par appareil (tri) et bouton Réinitialiser", async () => {
    await open("clients", 1280, 800, "Tableau"); await page.getByRole("tab", { name: "Clients", exact: true }).click(); await page.waitForTimeout(800);
    await page.getByLabel("Tri").selectOption("spent"); await page.waitForTimeout(600); await page.reload(); await page.waitForSelector("text=Tableau"); await page.getByRole("tab", { name: "Clients", exact: true }).click(); await page.waitForTimeout(1000);
    if ((await page.getByLabel("Tri").inputValue()) !== "spent") throw new Error("tri non retrouvé"); await page.getByRole("button", { name: "Réinitialiser" }).click(); await page.waitForTimeout(500); if ((await page.getByLabel("Tri").inputValue()) !== "name") throw new Error("Réinitialiser inefficace");
  });
  await step("promotions · onglets du kit (K9) et seconde ligne, cadenas en icône (pas d'emoji)", async () => {
    await open("promotions", 1280, 800, "Créer une promotion"); const t = (await txt()).toLowerCase(); for (const x of ["promotions actives", "offres groupées", "programmes de fidélité", "analyses", "réglages", "calendrier", "performance", "journal", "coupons", "budgets", "magasins", "conseils"]) if (!t.includes(x)) throw new Error("manquant : " + x);
    if (/🔒/.test(await txt())) throw new Error("emoji de cadenas encore présent"); const lists = await page.getByRole("tablist").evaluateAll((els) => els.map((e) => e.scrollWidth <= e.clientWidth + 1)); if (lists.some((x) => !x)) throw new Error("une rangée défile horizontalement");
  });
  await step("promotions · bouton « Créer une promotion » à largeur naturelle à droite, tableau des campagnes (≥ 1024 px), fiche large", async () => {
    await open("promotions", 1280, 800, "Rentrée"); const b = await page.getByRole("button", { name: "Créer une promotion" }).boundingBox(); if (!b || b.width > 400) throw new Error("bouton pleine largeur : " + JSON.stringify(b));
    if (!(await page.locator("table").count())) throw new Error("pas de tableau"); const heads = (await page.locator("thead th").allInnerTexts()).join("|"); for (const x of ["Campagne", "Remise", "Période", "Statut"]) if (!heads.includes(x)) throw new Error("colonne manquante : " + x);
    if ((await page.locator("tbody tr").count()) < 3) throw new Error("campagnes manquantes");
    await page.getByRole("button", { name: "Créer une promotion" }).click(); await page.waitForTimeout(700); const d = await page.getByRole("dialog").first().boundingBox(); if (!d || d.width < 700) throw new Error("fiche étroite : " + JSON.stringify(d));
  });
  await step("promotions · filtres mémorisés (statut) et Réinitialiser ; téléphone : cartes", async () => {
    await open("promotions", 1280, 800, "Rentrée"); await page.getByRole("button", { name: "Brouillons", exact: true }).click(); await page.waitForTimeout(500);
    await page.reload(); await page.waitForSelector("text=Créer une promotion"); await page.waitForTimeout(900); if (!(await page.getByRole("button", { name: "Brouillons", exact: true }).getAttribute("aria-current")).includes("true")) throw new Error("filtre non retrouvé");
    await page.getByRole("button", { name: "Réinitialiser" }).click(); await page.waitForTimeout(400);
    await open("promotions", 390, 800, "Créer une promotion"); await page.waitForTimeout(800); if (await page.locator("table").count()) throw new Error("tableau sur téléphone");
  });
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
