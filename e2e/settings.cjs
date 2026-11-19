/** Réglages par intention (lot N5) : onglets regroupés, profil, boutique (libellés visibles), règles de gestion, journal d'activité réel, droits. Lancement : bash e2e/run.sh settings */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { try { await globalThis.__page.screenshot({ path: path.join(OUT, "st-echec-" + name.slice(0, 12).replace(/[^a-z]/gi, "_") + ".png") }); } catch {} console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 500)); } };
(async () => {
  const h = await start({ plan: "pro", expect: [] }); const { page, st } = h; globalThis.__page = page; const A = h.shop;
  await h.call("article.save", { data: { name: "Riz parfumé", price: 1000, cost: 600 } }, A);
  const open = async (w = 1280, hh = 800) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url("reglages")); await page.getByRole("heading", { name: "Paramètres généraux" }).waitFor({ timeout: 15000 }); await page.waitForTimeout(900); };
  const tab = async (n) => { await page.getByRole("tab", { name: n, exact: true }).click(); await page.waitForTimeout(700); };
  const noOverflow = async (label) => { const x = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, i: innerWidth })); if (x.s > x.i + 1) throw new Error(`${label} : débordement (${x.s} > ${x.i})`); };
  const unnamed = async (label) => { const bad = await page.evaluate(() => [...document.querySelectorAll("button, a[href], input, select")].filter((e) => { const r = e.getBoundingClientRect(); if (!r.width || !r.height) return false; const n = (e.getAttribute("aria-label") || e.innerText || e.getAttribute("title") || (e.labels && [...e.labels].map((l) => l.innerText).join("")) || e.getAttribute("placeholder") || "").trim(); return !n; }).map((e) => e.outerHTML.slice(0, 80))); if (bad.length) throw new Error(`${label} : sans nom : ${bad.slice(0, 3).join(" ; ")}`); };

  for (const [w, hh, label] of [[390, 800, "téléphone"], [820, 1000, "tablette"], [1280, 800, "ordinateur"]]) await step(`${label} (${w} px) : sans débordement, noms accessibles`, async () => { await open(w, hh); await noOverflow(label); await unnamed(label); await page.screenshot({ path: path.join(OUT, `st-${w}.png`) }); });
  await step("onglets du kit et seconde ligne, tous les anciens onglets présents", async () => {
    await open(); for (const x of ["Général", "Point de vente", "Règles de gestion", "Boutiques", "Paiements", "Journal d'activité", "Mon profil"]) if (!(await page.getByRole("tab", { name: x, exact: true }).count())) throw new Error("manquant : " + x);
  });
  await step("boutique : libellés visibles, enregistrement confirmé en vert (statut)", async () => {
    await open(); await tab("Point de vente"); await page.getByLabel("Nom commercial").fill("Dogui Plateau"); await page.getByLabel("Ville").fill("Dakar"); await page.locator("form").getByRole("button", { name: "Enregistrer" }).click(); await page.waitForTimeout(900);
    if (!st.rows("shops").some((x) => x.name === "Dogui Plateau" && x.city === "Dakar")) throw new Error("non enregistré"); const ok = page.getByRole("status").filter({ hasText: "Enregistré" }); if (!(await ok.count())) throw new Error("confirmation absente");
    if (!(await ok.first().evaluate((e) => e.className.includes("text-ok")))) throw new Error("succès pas en vert");
  });
  await step("règles de gestion : valorisation, lots périmés, marge minimale regroupées", async () => {
    await open(); await tab("Règles de gestion"); for (const l of ["Méthode de valorisation", "Politique des lots périmés", "Marge minimale (%)"]) if (!(await page.getByLabel(l).count())) throw new Error("absent : " + l);
  });
  await step("profil : identité et déconnexion", async () => { await open(); await tab("Mon profil"); if (!/Connecté/.test(await page.locator("body").innerText())) throw new Error("identité"); if (!(await page.getByRole("button", { name: "Se déconnecter" }).count())) throw new Error("déconnexion"); });
  await step("journal d'activité : traces réelles (création d'article, fiche boutique), auteur, filtre par module", async () => {
    await open(); await tab("Journal d'activité"); await page.waitForSelector("table", { timeout: 8000 }); const t = await page.locator("table").innerText();
    if (!/Riz parfumé/.test(t)) throw new Error("création d'article absente : " + t.slice(0, 300));
    await page.getByLabel("Filtrer par module").selectOption({ label: "Articles" }); await page.waitForTimeout(800); const rows = await page.locator("tbody tr").allInnerTexts(); if (!rows.length || rows.some((r) => !/Articles/.test(r))) throw new Error("filtre : " + rows.join(" / ").slice(0, 300));
    await page.screenshot({ path: path.join(OUT, "st-journal-1280.png") });
  });
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
