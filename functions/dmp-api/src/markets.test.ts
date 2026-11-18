import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { PEG, parseBrvm, parseFx, setMarketFetch } from "./markets";

const T = "tenantmarkets1";
let st: MemoryStore; let A = ""; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown = {}) => handle(st, U[user] ?? user, { action, tenantId: T, shopId: A, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); };
const setPlan = (plan: string) => { const row = st.rows("subscriptions").find((r) => r.$id === T); const data = { tenantId: T, plan, period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }; if (row) Object.assign(row, data); else void st.create("subscriptions", T, T, data); };

// ------------------------------------------------------------------ faux réseau (formats réels relevés le 18/11/2026)
const COURS = ["date,ticker,ouverture,haut,bas,cloture,volume_titres,volume_fcfa",
  "2025-11-03,SNTS,26100.0,,,26100.0,100.0,2610000.0", "2026-10-23,SNTS,42500.0,,,43850.0,35656.0,1563515600.0", "2026-10-26,SNTS,4710.0,,,4700.0,323351.0,1519749700.0", "2026-11-17,SNTS,4145.0,,,4110.0,1000.0,4110000.0",
  "2026-11-14,ORAC,19000.0,,,19500.0,10.0,195000.0", "2026-11-17,ORAC,19500.0,,,19000.0,20.0,380000.0", "2026-11-17,SGBC,38000.0,,,38955.0,5.0,194775.0", "2026-11-14,SGBC,38000.0,,,38955.0,5.0,194775.0",
  "2025-01-02,OLDX,1000.0,,,1000.0,1.0,1000.0"].join("\n");
const REF = "ticker,nom,secteur,premiere_vue,derniere_vue\nSNTS,SONATEL SENEGAL,Télécommunications,2015-01-02,2026-11-17\nORAC,ORANGE  COTE D'IVOIRE,Télécommunications,2015-01-02,2026-11-17\nSGBC,SOCIETE GENERALE COTE D'IVOIRE,Services Financiers,2015-01-02,2026-11-17\n";
const DIV = "ticker,date_detachement,montant,exercice\nSNTS,2026-05-22,1740.0,2025.0\nORAC,2026-06-05,800.0,2025.0\n";
const SPL = 'ticker,date,rapport,note\nSNTS,2026-10-26,10.0,"1 action ancienne = 10 nouvelles, nominal de 500 à 50 FCFA"\n';
const FX = [{ date: "2026-10-20", base: "EUR", quote: "USD", rate: 1.12 }, { date: "2026-11-18", base: "EUR", quote: "USD", rate: 1.0999 }, { date: "2026-11-18", base: "EUR", quote: "NGN", rate: 1490.08 }, { date: "2026-11-18", base: "EUR", quote: "XAF", rate: 655.96 }];
const WB = (ind: string) => [{ page: 1 }, [{ country: { id: "SN", value: "Senegal" }, countryiso3code: "SEN", date: "2025", value: ind === "FP.CPI.TOTL.ZG" ? 1.459 : ind === "FR.INR.LEND" ? 5.3 : 6.68 }, { country: { id: "SN", value: "Senegal" }, countryiso3code: "SEN", date: ind === "FR.INR.LEND" ? "2016" : "2025", value: null }, { country: { id: "NG", value: "Nigeria" }, countryiso3code: "NGA", date: "2025", value: ind === "FP.CPI.TOTL.ZG" ? 23.01 : 18.45 }, { country: { id: "1W", value: "World" }, countryiso3code: "WLD", date: "2025", value: 3.04 }]];
let calls: string[] = []; let down = new Set<string>(); let clock = Date.parse("2026-11-18T10:00:00Z");
const res = (body: string, status = 200, headers: Record<string, string> = {}) => Promise.resolve({ ok: status < 300, status, text: () => Promise.resolve(body), headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } });
function fake(url: string, init?: { method?: string; headers?: Record<string, string> }) {
  calls.push(`${init?.method ?? "GET"} ${url}`); const host = new URL(url).host; if (down.has(host)) return Promise.reject(new Error("injoignable"));
  if (host === "api.frankfurter.dev") return res(JSON.stringify(FX));
  if (host === "api.worldbank.org") { const ind = url.split("/indicator/")[1]!.split("?")[0]!; const lend = ind === "FR.INR.LEND"; const b = WB(ind); if (lend) (b[1] as any)[0].date = "2016"; return res(JSON.stringify(b)); }
  if (host === "api.stlouisfed.org") return res(JSON.stringify({ observations: [{ date: "2025-11-01", value: "4.0" }, { date: "2026-10-01", value: "3.5" }, { date: "2026-11-01", value: "." }] }));
  if (host === "raw.githubusercontent.com") { const f = url.split("/").pop()!; if (f === "cours.csv") { if (init?.method === "HEAD") return res("", 200, { "content-length": String(COURS.length) }); return res(COURS); } return res(f === "referentiel.csv" ? REF : f === "dividendes.csv" ? DIV : SPL); }
  return res("", 404);
}

beforeEach(async () => {
  st = new MemoryStore(); await st.grant(T, "own", ["owner"], []); calls = []; down = new Set(); clock = Date.parse("2026-11-18T10:00:00Z"); setMarketFetch(fake as never, () => clock);
  A = (await ok(call("own", "shop.create", { name: "Dakar" }))).shopId;
  for (const [u, role] of [["ger", "manager"], ["cais", "cashier"]] as const) U[u] = (await ok(call("own", "staff.create", { name: u, username: u, password: "motdepasse1", role, shopIds: [A] }))).userId;
  setPlan("pro"); delete process.env.FRED_API_KEY;
});
afterEach(() => { setMarketFetch(null); delete process.env.FRED_API_KEY; });

describe("Marchés — analyse des sources", () => {
  it("change : FCFA pour 1 unité, EUR et XAF à la parité exacte, variation sur la période", () => {
    const f = parseFx(FX); const eur = f.rates.find((r) => r.code === "EUR")!, usd = f.rates.find((r) => r.code === "USD")!, xaf = f.rates.find((r) => r.code === "XAF")!;
    expect(eur.perUnit).toBe(PEG); expect(xaf.perUnit).toBe(1); expect(usd.perUnit).toBeCloseTo(655.957 / 1.0999, 3); expect(usd.change30dPct).toBeCloseTo(((655.957 / 1.0999 - 655.957 / 1.12) / (655.957 / 1.12)) * 100, 1); expect(f.date).toBe("2026-11-18");
    expect(() => parseFx([])).toThrow();
  });
  it("BRVM : fractionnement appliqué à l'historique et au dividende, titre sans cotation récente écarté, lecture partielle", () => {
    const p = parseBrvm(COURS, REF, DIV, SPL, false); const s = p.summary.tickers.find((x) => x.ticker === "SNTS")!;
    expect(p.series.SNTS!.map((x) => x.c)).toEqual([2610, 4385, 4700, 4110]); expect(s.change52Pct).toBeCloseTo(((4110 - 2610) / 2610) * 100, 1); expect(s.lastDividend).toEqual({ amount: 174, date: "2026-05-22", exercice: "2025" }); expect(s.yieldPct).toBeCloseTo((174 / 4110) * 100, 2);
    expect(p.summary.tickers.map((x) => x.ticker)).toEqual(["ORAC", "SGBC", "SNTS"]); expect(p.summary.tickers.find((x) => x.ticker === "ORAC")!.name).toBe("ORANGE COTE D'IVOIRE");
    expect(p.summary.breadth).toEqual({ up: 0, down: 2, flat: 1 }); expect(p.summary.asOf).toBe("2026-11-17");
    const part = parseBrvm(COURS.slice(COURS.indexOf("\n") + 5), REF, DIV, SPL, true); expect(part.summary.tickers.length).toBe(3);
  });
});

describe("Marchés — droits, sources, cache", () => {
  it("Business : change et économies ; BRVM et contexte mondial réservés au Pro ; employé refusé ; Starter refusé", async () => {
    setPlan("business"); const f = await ok(call("ger", "mk.fx")); expect(f.rates.length).toBe(4); expect(f.meta.provider).toContain("Frankfurter");
    const m = await ok(call("ger", "mk.macro")); const sn = m.countries.find((c: any) => c.code === "SN"); expect(sn.values.inflation).toEqual({ value: 1.46, year: "2025" }); expect(sn.values.lending.year).toBe("2016"); expect(m.countries.find((c: any) => c.code === "GA").values.inflation).toBeNull();
    await err(call("ger", "mk.brvm"), 402); await err(call("ger", "mk.world"), 402); await err(call("cais", "mk.fx"), 403); setPlan("starter"); await err(call("own", "mk.fx"), 402);
  });
  it("BRVM désactivée par défaut ; le propriétaire l'active ; le gérant ne peut pas ; fiche d'un titre", async () => {
    await err(call("ger", "mk.brvm"), 409, "désactivée"); await err(call("ger", "mk.config.save", { sources: { brvm: true } }), 403); await err(call("own", "mk.config.save", { sources: { inconnu: true } }), 400);
    await ok(call("own", "mk.config.save", { sources: { brvm: true }, country: "SN" })); const b = await ok(call("ger", "mk.brvm")); expect(b.tickers).toHaveLength(3); expect(b.meta.note).toContain("non officielle"); expect(b.indexNote).toContain("ne sont pas affichés");
    const t = await ok(call("ger", "mk.brvm.ticker", { ticker: "SNTS" })); expect(t.series.at(-1)).toEqual({ d: "2026-11-17", c: 4110, v: 4110000 }); expect(t.splits).toHaveLength(1); await err(call("ger", "mk.brvm.ticker", { ticker: "OLDX" }), 404); await err(call("ger", "mk.brvm.ticker", { ticker: "x;" }), 400);
    const s = await ok(call("ger", "mk.status")); expect(s.country).toBe("SN"); expect(s.canEdit).toBe(false); expect(s.sources.find((x: any) => x.key === "brvm").enabled).toBe(true);
  });
  it("cache : pas de nouvel appel tant qu'il est frais ; source en panne → dernière valeur servie avec erreur, nouvel essai après 30 min", async () => {
    await ok(call("ger", "mk.fx")); const n = calls.length; await ok(call("ger", "mk.fx")); expect(calls.length).toBe(n);
    clock += 13 * 36e5; down.add("api.frankfurter.dev"); const s = await ok(call("ger", "mk.fx")); expect(s.rates.length).toBe(4); expect(s.meta.stale).toBe(true); expect(s.meta.error).toContain("indisponible");
    const n2 = calls.length; await ok(call("ger", "mk.fx")); expect(calls.length).toBe(n2); clock += 31 * 6e4; down.clear(); const r = await ok(call("ger", "mk.fx")); expect(r.meta.stale).toBe(false); expect(calls.length).toBeGreaterThan(n2);
  });
  it("source jamais chargée et en panne : liste vide et erreur, aucune valeur inventée", async () => { down.add("api.worldbank.org"); const m = await ok(call("ger", "mk.macro")); expect(m.countries).toEqual([]); expect(m.meta.error).toContain("indisponible"); });
  it("contexte mondial : sans clé FRED, message explicite ; avec clé, valeurs non numériques ignorées", async () => {
    const a = await ok(call("ger", "mk.world")); expect(a.keyMissing).toBe(true); expect(a.meta.error).toContain("FRED_API_KEY");
    process.env.FRED_API_KEY = " Abcdefghijklmnopqrstuvwxyz012345\n"; const b = await ok(call("ger", "mk.world")); expect(b.series).toHaveLength(4); expect(b.series[0].last).toEqual({ date: "2026-10-01", value: 3.5 }); expect(b.series[0].yearAgo).toEqual({ date: "2025-11-01", value: 4 });
    expect(calls.some((c) => c.includes("api_key=abcdefghijklmnopqrstuvwxyz012345"))).toBe(true); expect(JSON.stringify(b)).not.toContain("bcdefghijklmnopqrstuvwxyz0123");
  });
  it("contexte mondial : clé au format invalide signalée sans la révéler ; refus de FRED affiché tel quel", async () => {
    process.env.FRED_API_KEY = "trop-courte"; const a = await ok(call("ger", "mk.world")); expect(a.meta.error).toContain("format invalide"); expect(a.meta.error).toContain("11 reçus"); expect(JSON.stringify(a)).not.toContain("trop-courte");
    process.env.FRED_API_KEY = "abcdefghijklmnopqrstuvwxyz012345"; setMarketFetch(((u: string, i: any) => (u.includes("stlouisfed") ? res(JSON.stringify({ error_code: 400, error_message: "Bad Request.  The value for variable api_key is not registered." }), 400) : fake(u, i))) as never, () => clock);
    const b = await ok(call("ger", "mk.world")); expect(b.meta.error).toContain("not registered"); expect(JSON.stringify(b)).not.toContain("abcdefghijklmnopqrstuvwxyz012345");
  });
  it("liens Pro : pays requis ; rendement réel des placements ; taux débiteur de 2016 jugé trop ancien", async () => {
    let l = await ok(call("ger", "mk.links")); expect(l.country).toBeNull();
    await ok(call("own", "inv.item.save", { kind: "placement", requestKey: "kplacement00001", asset: "Obligation Etat", amount: 1_000_000, boughtOn: "2026-01-10", horizonMonths: 36, fees: 0, expectedRatePct: 6.5, risk: "low", riskNotes: "Risque de défaut de l'émetteur" }));
    await ok(call("own", "mk.config.save", { country: "SN" })); l = await ok(call("ger", "mk.links")); expect(l.inflation).toEqual({ value: 1.46, year: "2025" }); expect(l.lendingUsable).toBe(false); expect(l.placements[0]).toMatchObject({ name: "Obligation Etat", expectedRatePct: 6.5, realPct: 5.04 });
    await ok(call("own", "mk.config.save", { country: "NG" })); expect((await ok(call("ger", "mk.links"))).lendingUsable).toBe(true);
    setPlan("business"); await err(call("ger", "mk.links"), 402);
  });
});
