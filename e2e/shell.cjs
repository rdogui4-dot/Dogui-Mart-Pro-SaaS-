/** Tests navigateur de la coque (lot N3) : fil d'Ariane, recherche des pages autorisées, aide, barre latérale repliable mémorisée. Lancement : bash e2e/run.sh shell */
const path = require("path"), fs = require("fs");
const { start } = require("./harness.cjs");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { try { await globalThis.__page.screenshot({ path: path.join(OUT, "sh-echec-" + name.slice(0, 12).replace(/[^a-z]/gi, "_") + ".png") }); } catch {} console.log("FAIL", name, "→", String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 500)); } };
(async () => {
  const h = await start({ plan: "business", expect: [] }); const { page } = h; globalThis.__page = page;
  const open = async (route, w = 1280, hh = 800) => { await page.setViewportSize({ width: w, height: hh }); await page.goto(h.url(route)); await page.waitForSelector("header", { timeout: 15000 }); await page.waitForTimeout(900); };
  const noOverflow = async (label) => { const x = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, i: innerWidth })); if (x.s > x.i + 1) throw new Error(`${label} : débordement horizontal (${x.s} > ${x.i})`); };
  const unnamed = async (label) => { const bad = await page.evaluate(() => [...document.querySelectorAll("button, a[href], input, select")].filter((e) => { const r = e.getBoundingClientRect(); if (!r.width || !r.height) return false; const n = (e.getAttribute("aria-label") || e.innerText || e.getAttribute("title") || (e.labels && [...e.labels].map((l) => l.innerText).join("")) || e.getAttribute("placeholder") || "").trim(); return !n; }).map((e) => e.outerHTML.slice(0, 80))); if (bad.length) throw new Error(`${label} : sans nom accessible : ${bad.slice(0, 3).join(" ; ")}`); };

  for (const [w, hh, label] of [[390, 800, "téléphone"], [820, 1000, "tablette"], [1280, 800, "ordinateur"]]) for (const route of ["accueil", "pos", "finance"])
    await step(`${route} · ${label} (${w} px) : en-tête sans débordement, noms accessibles`, async () => { await open(route, w, hh); await noOverflow(`${route} ${label}`); await unnamed(`${route} ${label}`); if (route === "accueil") await page.screenshot({ path: path.join(OUT, `sh-accueil-${w}.png`) }); });

  await step("fil d'Ariane : Accueil › Comptabilité et finance › Finance ; l'espace mène à sa page", async () => {
    await open("finance"); const bc = page.getByRole("navigation", { name: "Fil d'Ariane" }); const t = (await bc.innerText()).replace(/\s+/g, " ");
    if (!/Accueil.*Comptabilité et finance.*Finance/.test(t)) throw new Error("fil : " + t);
    if ((await bc.locator('[aria-current="page"]').innerText()) !== "Finance") throw new Error("page courante non marquée");
    await bc.getByRole("link", { name: "Comptabilité et finance" }).click(); await page.waitForURL(/espace\/compta/, { timeout: 5000 });
    await open("accueil"); if (await page.getByRole("navigation", { name: "Fil d'Ariane" }).count()) throw new Error("fil affiché sur l'accueil");
  });
  await step("recherche (Ctrl + K) : « factu » propose ICompta, Entrée ouvre la page ; formule Business : Pilotage Pro absent", async () => {
    await open("accueil"); await page.keyboard.press("Control+k"); const dlg = page.getByRole("dialog", { name: /Aller à une page/ }); await dlg.waitFor({ timeout: 4000 });
    const all = (await dlg.getByRole("option").allInnerTexts()).join("|"); if (/Pilotage Pro/.test(all)) throw new Error("page hors formule proposée"); if (!/Caisse/.test(all)) throw new Error("caisse absente : " + all.slice(0, 200));
    await page.getByLabel("Rechercher une page", { exact: true }).fill("factu"); await page.waitForTimeout(200); const first = await dlg.getByRole("option").first().innerText(); if (!/ICompta/.test(first)) throw new Error("premier résultat : " + first);
    await page.keyboard.press("Enter"); await page.waitForURL(/icompta/, { timeout: 5000 });
    await page.keyboard.press("Control+k"); await page.getByLabel("Rechercher une page", { exact: true }).fill("zzzz"); await page.waitForTimeout(200); if (!/Aucune page accessible/.test(await page.locator("body").innerText())) throw new Error("état vide absent"); await page.keyboard.press("Escape");
  });
  await step("recherche : bouton de l'en-tête (téléphone) et ouverture de MASTER DOGUI en fenêtre", async () => {
    await open("accueil", 390, 800); await page.getByRole("button", { name: /Rechercher une page/ }).click(); await page.getByLabel("Rechercher une page", { exact: true }).fill("master"); await page.keyboard.press("Enter"); await page.waitForTimeout(800);
    if (!(await page.getByRole("dialog", { name: "MASTER DOGUI" }).count())) throw new Error("fenêtre MASTER non ouverte"); await page.keyboard.press("Escape");
  });
  await step("aide : raccourcis réels, présentation, contact WhatsApp, version", async () => {
    await open("accueil"); await page.getByRole("button", { name: "Aide" }).click(); const dlg = page.getByRole("dialog", { name: "Aide" }); await dlg.waitFor({ timeout: 4000 }); const t = await dlg.innerText();
    for (const x of ["Ctrl K", "F2", "F4", "F8", "Échap", "WhatsApp", "Version du"]) if (!t.includes(x)) throw new Error("manquant : " + x);
    if (!(await dlg.locator('a[href="https://wa.me/2250544165418"]').count())) throw new Error("lien WhatsApp"); await page.screenshot({ path: path.join(OUT, "sh-aide-1280.png") }); await page.keyboard.press("Escape");
  });
  await step("barre latérale repliable : icônes seules, mémorisée après rechargement, lien de module, puis dépliée", async () => {
    await open("accueil"); await page.getByRole("button", { name: "Replier le menu" }).click(); await page.waitForTimeout(300);
    let wdt = (await page.getByRole("complementary", { name: "Espaces" }).boundingBox()).width; if (wdt > 80) throw new Error("largeur repliée " + wdt);
    await page.reload(); await page.waitForTimeout(1200); wdt = (await page.getByRole("complementary", { name: "Espaces" }).boundingBox()).width; if (wdt > 80) throw new Error("préférence non mémorisée " + wdt);
    await page.screenshot({ path: path.join(OUT, "sh-replie-1280.png") });
    await page.getByRole("complementary", { name: "Espaces" }).getByRole("link", { name: "Stocks & Inventaires" }).click(); await page.waitForURL(/\/stock/, { timeout: 5000 });
    await page.getByRole("button", { name: "Déplier le menu" }).click(); await page.waitForTimeout(300); wdt = (await page.getByRole("complementary", { name: "Espaces" }).boundingBox()).width; if (wdt < 200) throw new Error("non dépliée " + wdt);
  });
  console.log("ERRORS", h.errors.filter((e) => !/WebSocket|Realtime|Failed to load resource/.test(e)), "\nBAD", h.bad); await h.close(); process.exit(0);
})();
