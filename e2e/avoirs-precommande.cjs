/** Avoirs et précommande automatique : nouvel avoir au retour (code, solde, ticket), vente payée par avoir puis retour rendu au même avoir, écran Avoirs (solde, historique, désactivation), précommande préparée automatiquement quand un article passe sous son seuil, réglage et « Analyser maintenant ». Lancement : bash e2e/run.sh avoirs-precommande */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
(async () => {
  const h = await start({ plan: "pro", expect: [] }); const { page, st } = h; const A = h.shop;
  const sup = (await h.call("purch.supplier.save", { name: "Grossiste Central", leadDays: 5 }, A)).body.data.id;
  const mk = (n, p, q, extra = {}) => h.call("article.save", { data: { name: n, price: p, cost: Math.round(p * 0.7), ...extra }, initialQty: q }, A).then((r) => r.body.data.id);
  const eau = await mk("Eau 1,5 L", 500, 50), riz = await mk("Riz 5 kg", 5000, 12, { minStock: 10, supplierId: sup }); await mk("Sel fin", 200, 3, { minStock: 5 });
  await h.call("cash.open", { openingFloat: 20000 }, A);
  const cu = (await h.call("entity.save", { table: "customers", data: { name: "Awa Diop" } }, A)).body.data.id;
  const sell = async (lines, payments, extra = {}) => (await h.call("checkout", { clientId: "av" + Math.random().toString(36).slice(2, 12), lines, payments, ...extra }, A)).body;
  const s0 = (await sell([{ productId: eau, qty: 6 }], [{ method: "cash", amount: 3000 }], { customerId: cu })).data;
  const num = (id) => st.rows("sales").find((x) => x.$id === id).number; const dlg = () => page.getByRole("dialog").last();
  const openSale = async (id) => { await page.goto(h.url("ventes")); await page.getByLabel("Numéro du ticket").fill(num(id)); await page.getByRole("button", { name: "Rechercher", exact: true }).click(); await page.getByRole("dialog", { name: `Vente ${num(id)}` }).waitFor({ timeout: 8000 }); };
  let code = "";

  await step("retour remboursé en « Nouvel avoir » : code, solde et validité affichés, ticket de retour", async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await openSale(s0.saleId); await page.getByRole("button", { name: "Retourner des articles" }).click();
    await page.getByLabel("Quantité retournée Eau 1,5 L").fill("6"); await page.waitForFunction(() => /3\s?000\s?FCFA/.test(document.body.innerText), null, { timeout: 8000 }); await page.getByRole("button", { name: "Continuer" }).click();
    await page.getByLabel("Motif *").fill("Préfère un avoir"); await page.getByLabel("Moyen de remboursement 1").selectOption("voucher"); await page.getByRole("button", { name: "Tout rembourser ici" }).click(); await page.getByRole("button", { name: "Vérifier" }).click();
    await page.getByRole("button", { name: "Valider le retour" }).click(); await page.getByRole("button", { name: "Confirmer" }).click(); await page.getByText("Retour enregistré").waitFor({ timeout: 8000 });
    const t = await dlg().innerText(); const m = t.match(/Nouvel avoir (AV-[A-Z0-9]{8})/); if (!m || !/solde 3\s?000/.test(t) || !/valable jusqu/.test(t)) throw new Error(t.slice(0, 400)); code = m[1];
    const [d] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.getByRole("button", { name: "Ticket de retour 80 mm" }).click()]); if (fs.readFileSync(await d.path()).slice(0, 4).toString() !== "%PDF") throw new Error("pdf");
    await page.screenshot({ path: path.join(OUT, "avoirs-1-nouvel-avoir.png") }); await page.getByRole("button", { name: "Terminer" }).click();
  });
  let s1 = null;
  await step("vente payée en partie par l'avoir, puis retour : la part avoir est proposée vers le même avoir et y revient", async () => {
    s1 = (await sell([{ productId: eau, qty: 4 }], [{ method: "voucher", amount: 1500, reference: code }, { method: "cash", amount: 500 }], { customerId: cu })).data;
    await openSale(s1.saleId); await page.getByRole("button", { name: "Annuler la vente" }).click(); await page.waitForFunction(() => /2\s?000\s?FCFA/.test(document.body.innerText), null, { timeout: 8000 }); await page.getByRole("button", { name: "Continuer" }).click();
    const note = await page.getByRole("note").first().innerText(); if (!new RegExp(`1\\s?500.*${code}`).test(note)) throw new Error(note);
    if ((await page.getByLabel("Moyen de remboursement 1").inputValue()) !== `back:${code}` || (await page.getByLabel("Montant remboursé 1").inputValue()) !== "1500" || (await page.getByLabel("Montant remboursé 2").inputValue()) !== "500") throw new Error("répartition proposée");
    await page.getByLabel("Motif *").fill("Erreur de caisse"); await page.getByRole("button", { name: "Vérifier" }).click(); await dlg().getByRole("button", { name: "Annuler la vente" }).click(); await page.getByRole("button", { name: "Confirmer" }).click();
    await page.getByText("Vente annulée", { exact: true }).waitFor({ timeout: 8000 }); const t = await dlg().innerText(); if (!new RegExp(`Rendu à l'avoir ${code}[\\s\\S]*solde 3\\s?000`).test(t)) throw new Error(t.slice(0, 400));
    if (st.rows("customer_vouchers").filter((v) => v.kind === "voucher").length !== 1) throw new Error("un second avoir a été créé"); await page.getByRole("button", { name: "Terminer" }).click();
  });
  await step("écran Avoirs : indicateurs réels, historique (utilisé puis rendu), réimpression, désactivation motivée", async () => {
    await page.goto(h.url("avoirs")); await page.getByRole("heading", { name: "Avoirs" }).waitFor({ timeout: 10000 }); await page.waitForTimeout(600);
    const k = (l) => page.getByRole("group", { name: l }).innerText(); if (!/\b1\b/.test(await k("Avoirs actifs")) || !/3\s?000/.test(await k("Encours à honorer"))) throw new Error("indicateurs");
    await page.locator("main button", { hasText: code }).click(); await dlg().getByText("Rendu (retour)").waitFor({ timeout: 8000 }); const t = await dlg().innerText(); if (!/Utilisé[\s\S]*1\s?500[\s\S]*Rendu \(retour\)[\s\S]*1\s?500/.test(t) || !/Awa Diop/.test(t)) throw new Error(JSON.stringify(t.slice(0, 700)));
    const [d] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.getByRole("button", { name: "Réimprimer 58 mm" }).click()]); if (fs.readFileSync(await d.path()).slice(0, 4).toString() !== "%PDF") throw new Error("pdf");
    await page.screenshot({ path: path.join(OUT, "avoirs-2-detail.png") });
    if (await page.getByRole("button", { name: "Désactiver" }).isEnabled()) throw new Error("désactivation sans motif"); await page.getByLabel("Motif de la désactivation").fill("Avoir perdu par la cliente"); await page.getByRole("button", { name: "Désactiver" }).click(); await page.getByRole("button", { name: "Désactiver" }).last().click();
    await page.waitForFunction(() => /Désactivé/.test(document.querySelector('[role="dialog"]:last-of-type')?.textContent ?? document.body.innerText), null, { timeout: 8000 }); if (!st.rows("audit_log").some((a) => a.action === "voucher.disable")) throw new Error("non tracé"); await page.keyboard.press("Escape");
  });
  await step("précommande automatique : la vente qui passe le riz sous son seuil prépare un brouillon pour son fournisseur", async () => {
    await sell([{ productId: riz, qty: 3 }], [{ method: "cash", amount: 15000 }]); const d = st.rows("purchase_orders").filter((p) => p.createdBy === "auto-preorder"); if (d.length !== 1 || d[0].status !== "draft") throw new Error(JSON.stringify(d).slice(0, 300));
    await page.goto(h.url("achats")); const sec = page.getByRole("region", { name: "Précommande automatique" }); await sec.waitFor({ timeout: 10000 }); await page.waitForTimeout(800); const t = await sec.innerText();
    if (!/Riz 5 kg × \d+/.test(t) || !/Grossiste Central/.test(t) || !/Brouillon à relire/.test(t)) throw new Error(t.slice(0, 400)); if (!/Sel fin \(3 \/ seuil 5\)/.test(t)) throw new Error("article sans fournisseur non signalé : " + t.slice(0, 300));
    await page.screenshot({ path: path.join(OUT, "precommande-1-achats.png") });
    await sec.getByRole("button", { name: /Brouillon à relire/ }).click(); await page.getByRole("dialog").last().waitFor({ timeout: 6000 }); if (!/Riz 5 kg/.test(await dlg().innerText())) throw new Error("brouillon non ouvert"); await page.keyboard.press("Escape");
  });
  await step("réglage : désactivée, une nouvelle baisse ne crée rien ; réactivée + « Analyser maintenant » ajoute le sel une fois son fournisseur indiqué", async () => {
    const sec = page.getByRole("region", { name: "Précommande automatique" }); await sec.getByLabel("Précommande automatique active").uncheck(); await sec.getByText("Désactivée").first().waitFor({ timeout: 6000 });
    await sell([{ productId: riz, qty: 1 }], [{ method: "cash", amount: 5000 }]); const sel = st.rows("products").find((p) => p.name === "Sel fin"); await h.call("article.save", { id: sel.$id, data: { name: "Sel fin", price: 200, cost: 140, minStock: 5, supplierId: sup } }, A);
    if (st.rows("purchase_orders").filter((p) => p.createdBy === "auto-preorder").length !== 1) throw new Error("brouillon créé malgré la désactivation");
    await sec.getByLabel("Précommande automatique active").check(); await sec.getByText("Active", { exact: true }).waitFor({ timeout: 6000 }); await sec.getByRole("button", { name: "Analyser maintenant" }).click(); await sec.getByText(/Précommande mise à jour/).waitFor({ timeout: 8000 });
    const lines = JSON.parse(st.rows("purchase_orders").find((p) => p.createdBy === "auto-preorder").lines).map((l) => l.name); if (lines.join(",") !== "Riz 5 kg,Sel fin") throw new Error(lines.join(","));
  });
  for (const [w, theme] of [[390, "light"], [360, "light"], [1280, "dark"]]) await step(`${w} px ${theme} : Avoirs et Achats sans débordement`, async () => {
    await page.setViewportSize({ width: w, height: 860 }); await page.goto(h.url("accueil")); await page.evaluate((t) => localStorage.setItem("dmp-theme", t), theme);
    for (const p of ["avoirs", "achats"]) { await page.goto(h.url(p)); await page.waitForTimeout(1500); const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) throw new Error(`${p} débordement ${o}`); await page.screenshot({ path: path.join(OUT, `avoirs-precommande-${p}-${theme}-${w}.png`) }); }
  });
  await page.evaluate(() => localStorage.setItem("dmp-theme", "light"));
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
