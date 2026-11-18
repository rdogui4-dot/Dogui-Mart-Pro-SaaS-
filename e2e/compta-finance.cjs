/** Tests navigateur Finance, ICompta et Investissements (refonte UI). Lancement : bash e2e/run.sh compta-finance */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { try { await globalThis.__page.screenshot({ path: path.join(OUT, "cf-echec-" + name.slice(0, 10).replace(/[^a-z]/gi, "_") + ".png") }); } catch {} console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 500)); } };
const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 24);
const day = (o = 0) => new Date(Date.now() + o * 864e5).toISOString().slice(0, 10);
(async () => {
  const h = await start({ plan: "pro", expect: [] }); const { page } = h; globalThis.__page = page; const A = h.shop;
  const txt = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
  // Données réelles créées par le serveur (aucune valeur fabriquée dans l'interface).
  await h.call("fin.account.save", { requestKey: rid(), name: "Caisse", kind: "cash", methods: ["cash"], openingBalance: 100000, openingDate: day(-10) }, A);
  await h.call("fin.account.save", { requestKey: rid(), name: "Banque", kind: "bank", methods: ["card"], openingBalance: 250000, openingDate: day(-10) }, A);
  const cust = (await h.call("crm.customer.save", { requestKey: rid(), name: "Awa Traoré", phone: "0701010101" }, A)).body.data;
  const custId = cust.id ?? cust.customerId ?? cust.$id;
  await h.call("invoice.customer.create", { invoiceId: crypto.randomUUID(), customerId: custId, note: "", lines: [{ description: "Prestation", qty: 2, unitPrice: 15000 }] }, A);
  await h.call("ic.account.import", { text: "571;Caisse (essai)\n101;Capital (essai)\n411;Clients (essai)\n701;Ventes (essai)" }, A);
  const ent = (await h.call("ic.entry.save", { requestKey: rid(), journal: "OD", date: day(0), label: "Apport en caisse", lines: [{ account: "571", debit: 5000, credit: 0 }, { account: "101", debit: 0, credit: 5000 }], pieces: [{ ref: "REC-001" }] }, A)).body.data; if (!ent) throw new Error("écriture de départ refusée");
  const sub = await h.call("ic.entry.submit", { id: ent.id }, A); const val = await h.call("ic.entry.validate", { id: ent.id }, A); console.log("écriture : soumission", sub.status, "validation", val.status, val.body.error ?? "");
  await h.call("inv.item.save", { kind: "project", requestKey: rid(), name: "Nouveau magasin", budget: 5000000, startOn: day(-40), objective: "Ouvrir un second point de vente", type: "Nouveau magasin" }, A);

  const open = async (route, w, hh, wait) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url(route)); await page.waitForSelector(`text=${wait}`, { timeout: 15000 }); await page.waitForTimeout(900); };
  const tab = async (name) => { await page.getByRole("tab", { name, exact: true }).click(); await page.waitForTimeout(900); };
  const noOverflow = async (label) => { const x = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, i: innerWidth })); if (x.s > x.i + 1) throw new Error(`${label} : débordement horizontal (${x.s} > ${x.i})`); };
  const unnamed = async (label) => { const bad = await page.evaluate(() => [...document.querySelectorAll("button, a[href], input, select")].filter((e) => { const r = e.getBoundingClientRect(); if (!r.width || !r.height) return false; const n = (e.getAttribute("aria-label") || e.innerText || e.getAttribute("title") || (e.labels && [...e.labels].map((l) => l.innerText).join("")) || e.getAttribute("placeholder") || "").trim(); return !n; }).map((e) => e.outerHTML.slice(0, 70))); if (bad.length) throw new Error(`${label} : sans nom accessible : ${bad.slice(0, 3).join(" ; ")}`); };
  const heads = async () => (await page.locator("thead th").allInnerTexts()).join("|");
  const rowGroups = async () => { const lists = await page.getByRole("tablist").evaluateAll((els) => els.map((e) => e.scrollWidth <= e.clientWidth + 1)); if (lists.some((x) => !x)) throw new Error("une rangée d'onglets défile horizontalement"); };

  for (const [route, wait] of [["finance", "Trésorerie"], ["icompta", "Facturation"], ["investissements", "Vue d'ensemble"]]) for (const [w, hh, label] of [[390, 800, "téléphone"], [820, 1000, "tablette"], [1280, 800, "ordinateur"]])
    await step(`${route} · ${label} (${w} px) : sans débordement, noms accessibles`, async () => { await open(route, w, hh, wait); await noOverflow(`${route} ${label}`); await unnamed(`${route} ${label}`); await page.screenshot({ path: path.join(OUT, `cf-${route}-${w}.png`) }); });

  await step("finance · onglets du kit (K11) et seconde ligne, les anciens onglets tous présents", async () => {
    await open("finance", 1280, 800, "Trésorerie"); const t = (await txt()).toLowerCase();
    for (const x of ["vue d'ensemble", "trésorerie", "flux de caisse", "résultats", "rentabilité", "comptes", "virements", "rapprochement", "échéances", "budgets", "prévisions", "échéancier", "analyses", "règles", "rapports"]) if (!t.includes(x)) throw new Error("manquant : " + x);
    await rowGroups();
  });
  await step("finance · avertissement replié sur téléphone (« Lire la suite »)", async () => {
    await open("finance", 390, 800, "Trésorerie"); await tab("Trésorerie"); if (!(await page.getByRole("button", { name: /Lire la suite/ }).count())) throw new Error("avertissement non replié");
  });
  await step("finance · trésorerie : indicateurs sur 3 colonnes (tablette+), soldes réels des comptes", async () => {
    await open("finance", 1280, 800, "Trésorerie"); await tab("Trésorerie"); await page.waitForSelector("text=Perspective", { timeout: 10000 }); const t = await txt(); if (!t.includes("Caisse") || !t.includes("Banque")) throw new Error("comptes absents de la trésorerie");
    const tops = await page.locator(".card:has-text('Trésorerie (comptes configurés)'), .card:has-text('Perspective à 30 jours'), .card:has-text('Entrées (30 j)')").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top))); if (new Set(tops).size !== 1) throw new Error("indicateurs pas sur une même ligne : " + tops);
  });
  await step("finance · comptes : tableau (≥ 1024 px), création d'un compte, bouton à largeur naturelle ; téléphone : cartes", async () => {
    await open("finance", 1280, 800, "Trésorerie"); await tab("Comptes"); await page.waitForSelector("table", { timeout: 8000 });
    const hd = await heads(); for (const x of ["Compte", "Type", "Solde", "État"]) if (!hd.includes(x)) throw new Error("colonne manquante : " + x);
    const b = await page.getByRole("button", { name: "Nouveau compte" }).boundingBox(); if (!b || b.width > 400) throw new Error("bouton pleine largeur");
    await page.getByRole("button", { name: "Nouveau compte" }).click(); await page.getByLabel("Nom du compte").fill("Coffre"); await page.getByLabel("Type de compte").selectOption({ index: 0 }); await page.getByRole("button", { name: "Enregistrer", exact: true }).click(); await page.waitForTimeout(1200);
    if (!(await page.locator("tbody", { hasText: "Coffre" }).count())) throw new Error("compte créé absent du tableau");
    await open("finance", 390, 800, "Trésorerie"); await tab("Comptes"); await page.waitForTimeout(600); if (await page.locator("table").count()) throw new Error("tableau sur téléphone");
  });
  await step("finance · flux et virements : tableaux (≥ 1024 px)", async () => {
    await open("finance", 1280, 800, "Trésorerie"); await tab("Virements"); const b = await page.getByRole("button", { name: "Nouveau virement interne" }).boundingBox(); if (!b || b.width > 400) throw new Error("bouton pleine largeur");
    await page.getByRole("button", { name: "Nouveau virement interne" }).click(); await page.getByLabel("Compte source").selectOption({ label: "Caisse" }); await page.getByLabel("Compte destination").selectOption({ label: "Banque" }); await page.getByLabel("Montant du virement").fill("10000"); await page.getByLabel("Motif du virement").fill("Dépôt banque"); await page.getByRole("button", { name: "Créer le virement" }).click(); await page.waitForTimeout(1200);
    await page.waitForSelector("table", { timeout: 8000 }); const hd = await heads(); for (const x of ["Trajet", "Statut", "Montant", "Actions"]) if (!hd.includes(x)) throw new Error("colonne virement manquante : " + x);
    await tab("Flux de caisse"); await page.waitForTimeout(600); if ((await page.getByRole("table", { name: "Flux" }).count()) === 0 && !(await txt()).includes("0 ligne")) throw new Error("ni tableau ni liste vide des flux");
  });

  await step("icompta · onglets du kit (K12) et seconde ligne, tous les anciens onglets présents", async () => {
    await open("icompta", 1280, 800, "Facturation"); const t = (await txt()).toLowerCase();
    for (const x of ["vue d'ensemble", "facturation", "synthèse", "écritures", "propositions", "journaux", "tiers", "clôture", "plan comptable", "lettrage", "immobilisations", "analytique", "états financiers", "clôture guidée", "exports comptables", "rapports d'activité"]) if (!t.includes(x)) throw new Error("manquant : " + x);
    await rowGroups();
  });
  await step("icompta · factures : tableau (≥ 1024 px), fiche en volet ; création d'une facture libre", async () => {
    await open("icompta", 1280, 800, "Facturation"); await tab("Facturation"); await page.waitForSelector("table", { timeout: 8000 }); const hd = await heads(); for (const x of ["N°", "Client", "Total", "Reste", "Statut"]) if (!hd.includes(x)) throw new Error("colonne manquante : " + x);
    if (!(await page.locator("tbody", { hasText: "Awa Traoré" }).count())) throw new Error("facture du client absente");
    await page.locator("tbody tr").first().click(); await page.waitForTimeout(800); const d = await page.getByRole("dialog").first().boundingBox(); if (!d || d.x < 1280 - 600) throw new Error("fiche non affichée en volet : " + JSON.stringify(d)); await page.keyboard.press("Escape"); await page.waitForTimeout(400);
    const before = await page.locator("tbody tr").count(); await page.getByRole("button", { name: "Facture libre" }).click(); await page.getByLabel("Client", { exact: true }).selectOption({ label: "Awa Traoré" });
    await page.getByLabel("Désignation").fill("Conseil"); await page.getByLabel("Prix HT").fill("20000"); await page.getByRole("button", { name: /Créer la facture/ }).click(); await page.waitForTimeout(1500);
    if ((await page.locator("tbody tr").count()) !== before + 1) throw new Error("facture libre non ajoutée");
  });
  await step("icompta · écritures : tableau, nouvelle écriture en grande fenêtre", async () => {
    await open("icompta", 1280, 800, "Facturation"); await tab("Écritures"); await page.waitForSelector("table", { timeout: 8000 }); const hd = await heads(); for (const x of ["Journal", "Libellé", "Montant", "Statut"]) if (!hd.includes(x)) throw new Error("colonne manquante : " + x);
    if (!(await page.locator("tbody", { hasText: "Apport en caisse" }).count())) throw new Error("écriture absente");
    const b = await page.getByRole("button", { name: "Nouvelle écriture" }).boundingBox(); if (!b || b.width > 400) throw new Error("bouton pleine largeur");
    await page.getByRole("button", { name: "Nouvelle écriture" }).click(); await page.waitForTimeout(700); const d = await page.getByRole("dialog").first().boundingBox(); if (!d || d.width < 600) throw new Error("fenêtre étroite : " + JSON.stringify(d));
  });
  await step("icompta · livres : balance, grand livre et journal en tableaux ; téléphone : cartes", async () => {
    await open("icompta", 1280, 800, "Facturation"); await tab("Journaux"); await page.waitForSelector("table", { timeout: 8000 }); let hd = await heads(); for (const x of ["Compte", "Intitulé", "Débit", "Crédit", "Solde"]) if (!hd.includes(x)) throw new Error("balance : colonne manquante " + x);
    await page.getByRole("button", { name: "Grand livre d'un compte" }).click(); await page.waitForTimeout(1000); hd = await heads(); for (const x of ["Date", "Pièce", "Libellé", "Débit", "Crédit", "Solde"]) if (!hd.includes(x)) throw new Error("grand livre : colonne manquante " + x);
    await page.getByRole("button", { name: "Journal", exact: true }).click(); await page.waitForTimeout(1000); hd = await heads(); for (const x of ["Pièce", "Compte", "Débit", "Crédit"]) if (!hd.includes(x)) throw new Error("journal : colonne manquante " + x);
    await open("icompta", 390, 800, "Facturation"); await tab("Journaux"); await page.waitForTimeout(800); if (await page.locator("table").count()) throw new Error("tableau sur téléphone");
  });
  await step("icompta · impression : navigation et onglets masqués", async () => {
    await open("icompta", 1280, 800, "Facturation"); await tab("Journaux"); await page.emulateMedia({ media: "print" });
    const vis = await page.evaluate(() => [...document.querySelectorAll("nav, header, [role=tablist]")].filter((e) => getComputedStyle(e).display !== "none").length); await page.emulateMedia({ media: "screen" }); if (vis) throw new Error(vis + " élément(s) de navigation imprimé(s)");
  });

  await step("investissements · onglets du kit (K13), projets en tableau et fiche en volet", async () => {
    await open("investissements", 1280, 800, "Vue d'ensemble"); const t = (await txt()).toLowerCase(); for (const x of ["vue d'ensemble", "projets d'investissement", "simulations & projections", "plan de financement", "suivi & rentabilité", "placements", "portefeuille", "profil de risque", "réglages pro"]) if (!t.includes(x)) throw new Error("manquant : " + x);
    await tab("Projets d'investissement"); await page.waitForSelector("table", { timeout: 8000 }); const hd = await heads(); for (const x of ["Projet", "Statut", "Budget", "Scénarios"]) if (!hd.includes(x)) throw new Error("colonne manquante : " + x);
    await page.locator("tbody tr").first().click(); await page.waitForTimeout(900); const d = await page.getByRole("dialog").first().boundingBox(); if (!d || d.x < 1280 - 600) throw new Error("fiche non affichée en volet : " + JSON.stringify(d));
  });
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
