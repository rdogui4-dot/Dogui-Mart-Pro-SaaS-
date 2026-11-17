/** Tests navigateur Achats et Dépenses (refonte UI). Lancement : bash e2e/run.sh achats-depenses */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { try { await globalThis.__page.screenshot({ path: path.join(OUT, "ad-echec-" + name.slice(0, 10).replace(/[^a-z]/gi, "_") + ".png") }); } catch {} console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 500)); } };
const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 24);
(async () => {
  const h = await start({ plan: "pro", expect: [] }); const { page, st } = h; globalThis.__page = page; const A = h.shop;
  const txt = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const p1 = (await h.call("article.save", { data: { name: "Riz 25 kg", price: 14000, cost: 11000 }, initialQty: 3 }, A)).body.data.id;
  const sups = []; for (const n of ["Grossiste Sané", "Import Diallo", "Ferme Kouassi"]) sups.push((await h.call("purch.supplier.save", { name: n, phone: "0700000000" }, A)).body.data.id);
  for (let i = 0; i < 4; i++) { const po = (await h.call("purch.po.save", { clientId: rid(), supplierId: sups[i % 3], lines: [{ productId: p1, qty: 10 + i, unitPrice: 11000 }] }, A)).body.data.id; await h.call("purch.po.validate", { id: po }, A); }
  await h.call("cash.open", { openingFloat: 50000 }, A);
  const day = new Date().toISOString().slice(0, 10);
  for (let i = 1; i <= 6; i++) await h.call("expense.create", { requestId: crypto.randomUUID(), label: `Dépense ${i}`, category: i % 2 ? "loyer" : "fournitures", amount: 1000 * i, spentOn: day, method: "transfer", source: "external", reference: `REF-${i}` }, A);
  const open = async (route, w, hh, wait) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url(route)); await page.waitForSelector(`text=${wait}`, { timeout: 15000 }); await page.waitForTimeout(900); };
  const noOverflow = async (label) => { const x = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, i: innerWidth })); if (x.s > x.i + 1) throw new Error(`${label} : débordement horizontal (${x.s} > ${x.i})`); };
  const unnamed = async (label) => { const bad = await page.evaluate(() => [...document.querySelectorAll("button, a[href], input, select")].filter((e) => { const r = e.getBoundingClientRect(); if (!r.width || !r.height) return false; const n = (e.getAttribute("aria-label") || e.innerText || e.getAttribute("title") || (e.labels && [...e.labels].map((l) => l.innerText).join("")) || e.getAttribute("placeholder") || "").trim(); return !n; }).map((e) => e.outerHTML.slice(0, 70))); if (bad.length) throw new Error(`${label} : sans nom accessible : ${bad.slice(0, 3).join(" ; ")}`); };

  for (const [route, wait] of [["achats", "Achats & fournisseurs"], ["depenses", "Dépense 1"], ["depenses-pro", "Budgets"]]) for (const [w, hh, label] of [[390, 800, "téléphone"], [820, 1000, "tablette"], [1280, 800, "ordinateur"]])
    await step(`${route} · ${label} (${w} px) : sans débordement, noms accessibles`, async () => { await open(route, w, hh, wait); await noOverflow(`${route} ${label}`); await unnamed(`${route} ${label}`); await page.screenshot({ path: path.join(OUT, `ad-${route}-${w}.png`) }); });

  await step("achats · ordinateur : onglets du kit (K7), indicateurs alignés, aide dépliable dans Analyses", async () => {
    await open("achats", 1280, 800, "Achats & fournisseurs"); const tabs = (await page.getByRole("tablist", { name: "Sections des achats" }).innerText()).toLowerCase(); for (const x of ["commandes d'achat", "réceptions", "factures", "fournisseurs", "réclamations", "demandes d'approvisionnement", "analyses"]) if (!tabs.includes(x)) throw new Error("manquant : " + x);
    await page.getByRole("tab", { name: "Analyses" }).click(); await page.getByText("Comment lire ces chiffres").waitFor({ timeout: 8000 }); await page.getByRole("tab", { name: "Commandes d'achat" }).click();
    const a = await page.locator("text=Fournisseurs actifs").first().boundingBox(); const b = await page.locator("text=Commandes en cours").first().boundingBox(); if (!a || !b || Math.abs(a.y - b.y) > 40) throw new Error("indicateurs non alignés");
  });
  await step("achats · commandes en tableau (≥ 1024 px), ouverture de la fiche en volet, cartes sur téléphone", async () => {
    await open("achats", 1280, 800, "Achats & fournisseurs"); await page.getByRole("tab", { name: "Commandes d'achat" }).click(); await page.waitForSelector("table", { timeout: 8000 });
    const heads = (await page.locator("thead th").allInnerTexts()).join("|"); for (const x of ["Commande", "Fournisseur", "Total TTC", "Statut"]) if (!heads.includes(x)) throw new Error("colonne manquante : " + x + " / " + heads);
    if ((await page.locator("tbody tr").count()) < 4) throw new Error("lignes manquantes");
    await page.locator("tbody tr").first().click(); await page.waitForTimeout(800); const d = await page.getByRole("dialog").first().boundingBox(); if (!d || d.x < 1280 - 560) throw new Error("fiche non affichée en volet : " + JSON.stringify(d));
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
    await open("achats", 390, 800, "Achats & fournisseurs"); await page.getByRole("tab", { name: "Commandes d'achat" }).click(); await page.waitForTimeout(1500); if (await page.locator("table").count()) throw new Error("tableau sur téléphone");
  });
  await step("achats · filtres mémorisés par appareil et bouton Réinitialiser", async () => {
    await open("achats", 1280, 800, "Achats & fournisseurs"); await page.getByRole("tab", { name: "Commandes d'achat" }).click(); await page.waitForTimeout(800);
    await page.getByLabel("Statut").selectOption("received"); await page.waitForTimeout(800); await page.reload(); await page.waitForSelector("text=Achats & fournisseurs"); await page.getByRole("tab", { name: "Commandes d'achat" }).click(); await page.waitForTimeout(1200);
    if ((await page.getByLabel("Statut").inputValue()) !== "received") throw new Error("filtre de statut non retrouvé");
    await page.getByRole("button", { name: "Réinitialiser les filtres" }).click(); await page.waitForTimeout(600); if ((await page.getByLabel("Statut").inputValue()) !== "") throw new Error("Réinitialiser inefficace");
  });
  await step("dépenses · ordinateur : tableau, onglets du kit (dont Budgets et Charges récurrentes), filtres sur une ligne", async () => {
    await open("depenses", 1280, 800, "Dépense 1"); if (!(await page.locator("table").count())) throw new Error("pas de tableau");
    const tabs = await page.getByRole("tablist", { name: "Sections des dépenses" }).innerText(); if (!tabs.includes("Budgets") || !tabs.includes("Charges récurrentes")) throw new Error("onglets Pro absents");
    const f1 = await page.getByLabel("Catégorie", { exact: true }).boundingBox(); const f2 = await page.getByLabel("Statut", { exact: true }).boundingBox(); const f3 = await page.getByLabel("Du", { exact: true }).boundingBox(); if (!f1 || !f2 || !f3 || Math.abs(f1.y - f2.y) > 40 || Math.abs(f1.y - f3.y) > 40) throw new Error("filtres non alignés sur ordinateur");
    await page.locator("tbody tr").first().click(); await page.waitForTimeout(800); const d = await page.getByRole("dialog").first().boundingBox(); if (!d || d.x < 1280 - 560) throw new Error("fiche non affichée en volet");
    await page.keyboard.press("Escape");
  });
  await step("dépenses · téléphone : filtres repliés derrière « Filtres », cartes", async () => {
    await open("depenses", 390, 800, "Dépense 1"); if (await page.locator("table").count()) throw new Error("tableau sur téléphone");
    if (!(await txt()).includes("Filtres")) throw new Error("bloc Filtres absent"); if (await page.getByLabel("Moyen de paiement").isVisible()) throw new Error("filtres secondaires déjà dépliés");
    await page.getByText("Filtres", { exact: false }).first().click(); await page.waitForTimeout(400); if (!(await page.getByLabel("Moyen de paiement").isVisible())) throw new Error("le dépliage ne montre pas les filtres");
  });
  await step("dépenses · création par l'interface (fiche large)", async () => {
    await open("depenses", 1280, 800, "Dépense 1"); await page.getByRole("button", { name: "Enregistrer une dépense" }).click(); await page.waitForSelector("text=Nouvelle dépense", { timeout: 8000 });
    const dlg = await page.getByRole("dialog").first().boundingBox(); if (!dlg || dlg.width < 700) throw new Error("fiche étroite : " + JSON.stringify(dlg));
  });
  await step("menu : une seule entrée « Dépenses » (Dépenses Pro est un onglet)", async () => {
    await open("depenses", 1280, 800, "Dépense 1"); const side = await page.getByRole("navigation", { name: "Navigation principale" }).innerText(); if (/Dépenses Pro/.test(side)) throw new Error("entrée « Dépenses Pro » encore dans le menu"); if (!/Dépenses/.test(side)) throw new Error("entrée Dépenses absente");
  });
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
