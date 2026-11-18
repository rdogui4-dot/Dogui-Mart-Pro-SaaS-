/** IProj Marchés : données publiques de marché, en consultation seulement (jamais un conseil, aucune opération).
 *  Sources : Frankfurter (taux de change de référence des banques centrales), Banque mondiale (indicateurs par pays),
 *  FRED de la Réserve fédérale de Saint-Louis (taux et matières premières, clé serveur FRED_API_KEY) et, en option,
 *  le dépôt communautaire blakro/brvm (licence MIT, collecte non officielle des cours de la BRVM).
 *  Tous les appels partent du serveur, avec un délai d'attente court ; chaque réponse est mise en cache (table market_cache)
 *  et, si une source ne répond pas, la dernière valeur connue est servie avec sa date. Aucune valeur n'est inventée. */
import { MIN, aud, mine, parse } from "./crm";
import { roleKind } from "./fin-rules";
import { cfgId, gate, itemsAll } from "./invest";
import { proOn } from "./invest-pro";
import { HttpError, type Ctx, type Row, type Store } from "./store";

// ------------------------------------------------------------------ accès réseau (remplaçable dans les tests)
type Fetcher = (url: string, init?: { headers?: Record<string, string>; method?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text: () => Promise<string>; headers: { get: (k: string) => string | null } }>;
let doFetch: Fetcher = (u, i) => fetch(u, i) as unknown as ReturnType<Fetcher>;
let nowFn = () => Date.now();
export const setMarketFetch = (f: Fetcher | null, now?: () => number) => { doFetch = f ?? ((u, i) => fetch(u, i) as unknown as ReturnType<Fetcher>); nowFn = now ?? (() => Date.now()); };
async function get(url: string, ms: number, headers: Record<string, string> = {}, method = "GET") {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await doFetch(url, { headers, method, signal: c.signal });
    if (!r.ok && r.status !== 206) { let why = ""; try { const b = JSON.parse(await r.text()) as { error_message?: string; message?: string }; why = String(b.error_message ?? b.message ?? "").replace(/api_key=[^&\s]+/g, "api_key=…").slice(0, 140); } catch { why = ""; } throw new Error(`réponse ${r.status}${why ? ` : ${why}` : ""}`); }
    return r; }
  catch (e) { throw new Error((e as Error).name === "AbortError" ? "délai dépassé" : (e as Error).message || "injoignable"); }
  finally { clearTimeout(t); }
}
const getJson = async <T>(url: string, ms: number): Promise<T> => JSON.parse(await (await get(url, ms)).text()) as T;

// ------------------------------------------------------------------ sources
export type SourceKey = "fx" | "macro" | "brvm" | "world";
export const SOURCES: Record<SourceKey, { label: string; provider: string; url: string; ttlH: number; pro: boolean; byDefault: boolean; note: string }> = {
  fx: { label: "Taux de change", provider: "Frankfurter — taux de référence de la BCE et des banques centrales", url: "https://frankfurter.dev", ttlH: 12, pro: false, byDefault: true, note: "Taux de référence quotidiens, pas des cours de guichet." },
  macro: { label: "Économies africaines", provider: "Banque mondiale — Indicateurs du développement dans le monde", url: "https://data.worldbank.org", ttlH: 24 * 7, pro: false, byDefault: true, note: "Dernière valeur annuelle publiée par pays ; certaines séries ne sont pas publiées pour tous les pays." },
  brvm: { label: "Cours de la BRVM", provider: "Dépôt communautaire blakro/brvm (licence MIT) — source non officielle", url: "https://github.com/blakro/brvm", ttlH: 6, pro: true, byDefault: false, note: "Collecte communautaire non officielle des cours publiés par la BRVM (brvm.org) ; les données appartiennent à la BRVM. Cours ajustés des fractionnements déclarés. À vérifier auprès d'une société de gestion et d'intermédiation (SGI) avant toute décision." },
  world: { label: "Contexte mondial", provider: "FRED — Réserve fédérale de Saint-Louis", url: "https://fred.stlouisfed.org", ttlH: 12, pro: true, byDefault: true, note: "Séries officielles mensuelles (fin de mois)." },
};
const KEYS = Object.keys(SOURCES) as SourceKey[];
const RETRY_MIN = 30;

// ------------------------------------------------------------------ cache plateforme (données publiques, aucune lecture client)
type Cached<T> = { data: T | null; fetchedAt: string; stale: boolean; error: string };
const T_CACHE = "market_cache";
async function readCache(store: Store, key: string) { const r = await store.get(T_CACHE, key); return r ? { data: parse<unknown>(r.data, null), fetchedAt: String(r.fetchedAt ?? ""), attemptAt: String(r.attemptAt ?? ""), error: String(r.error ?? "") } : null; }
async function writeCache(store: Store, key: string, data: Record<string, unknown>) { if (!(await store.create(T_CACHE, key, "", data))) await store.update(T_CACHE, key, data); }
const ageH = (iso: string) => (iso ? (nowFn() - new Date(iso).getTime()) / 36e5 : Infinity);
/** Sert le cache s'il est frais ; sinon recharge (au plus une tentative toutes les 30 min après un échec) ; en cas d'échec, sert la dernière valeur connue. */
export async function cached<T>(store: Store, key: string, ttlH: number, load: () => Promise<T>, force = false): Promise<Cached<T>> {
  const c = await readCache(store, key);
  if (c && c.data !== null && !force && ageH(c.fetchedAt) < ttlH) return { data: c.data as T, fetchedAt: c.fetchedAt, stale: false, error: "" };
  if (c && !force && c.error && ageH(c.attemptAt) * 60 < RETRY_MIN) return { data: c.data as T | null, fetchedAt: c.fetchedAt, stale: true, error: c.error };
  const at = new Date(nowFn()).toISOString();
  try { const data = await load(); await writeCache(store, key, { data: JSON.stringify(data), fetchedAt: at, attemptAt: at, error: "" }); return { data, fetchedAt: at, stale: false, error: "" }; }
  catch (e) { const error = `Source indisponible (${(e as Error).message}).`.slice(0, 200); await writeCache(store, key, { data: c?.data == null ? "" : JSON.stringify(c.data), fetchedAt: c?.fetchedAt ?? "", attemptAt: at, error }); return { data: (c?.data ?? null) as T | null, fetchedAt: c?.fetchedAt ?? "", stale: true, error }; }
}

// ------------------------------------------------------------------ réglages (par boutique, clé `markets` de inv_config)
export const COUNTRIES: { code: string; name: string; group: string }[] = [
  ...([["BJ", "Bénin"], ["BF", "Burkina Faso"], ["CI", "Côte d'Ivoire"], ["GW", "Guinée-Bissau"], ["ML", "Mali"], ["NE", "Niger"], ["SN", "Sénégal"], ["TG", "Togo"]] as const).map(([code, name]) => ({ code, name, group: "UEMOA" })),
  ...([["CM", "Cameroun"], ["GA", "Gabon"], ["CG", "Congo"], ["TD", "Tchad"]] as const).map(([code, name]) => ({ code, name, group: "CEMAC" })),
  ...([["NG", "Nigeria"], ["GH", "Ghana"], ["GN", "Guinée"], ["MA", "Maroc"], ["EG", "Égypte"], ["KE", "Kenya"], ["ZA", "Afrique du Sud"], ["CD", "RD Congo"]] as const).map(([code, name]) => ({ code, name, group: "Afrique" })),
  { code: "SSF", name: "Afrique subsaharienne", group: "Repères" }, { code: "WLD", name: "Monde", group: "Repères" },
];
type MkCfg = { sources: Record<SourceKey, boolean>; country: string | null };
async function cfgRow(store: Store, ctx: Ctx) { const r = await store.get("inv_config", cfgId(ctx)); const ok = !!r && mine(ctx, r); return { row: ok ? (r as Row) : null, data: ok ? parse<Record<string, unknown>>(r!.data, {}) : {} }; }
export async function mkCfg(store: Store, ctx: Ctx): Promise<MkCfg> {
  const m = ((await cfgRow(store, ctx)).data.markets ?? {}) as Partial<MkCfg>; const src = (m.sources ?? {}) as Partial<Record<SourceKey, boolean>>;
  return { sources: Object.fromEntries(KEYS.map((k) => [k, typeof src[k] === "boolean" ? src[k] : SOURCES[k].byDefault])) as Record<SourceKey, boolean>, country: COUNTRIES.some((c) => c.code === m.country) ? m.country! : null };
}
const meta = (k: SourceKey, c: Cached<unknown>) => ({ source: k, provider: SOURCES[k].provider, url: SOURCES[k].url, note: SOURCES[k].note, fetchedAt: c.fetchedAt, stale: c.stale, error: c.error });
async function need(store: Store, ctx: Ctx, k: SourceKey) {
  await gate(store, ctx); const pro = await proOn(store, ctx); if (SOURCES[k].pro && !pro) throw new HttpError(402, `« ${SOURCES[k].label} » est réservé à la formule Pro`);
  if (!(await mkCfg(store, ctx)).sources[k]) throw new HttpError(409, `Source « ${SOURCES[k].label} » désactivée : le propriétaire peut l'activer dans les sources des marchés`); return pro;
}

export async function status(store: Store, ctx: Ctx) {
  await gate(store, ctx); const pro = await proOn(store, ctx); const cfg = await mkCfg(store, ctx);
  const sources = await Promise.all(KEYS.map(async (k) => { const c = await readCache(store, k === "brvm" ? "brvm" : k); return { key: k, label: SOURCES[k].label, provider: SOURCES[k].provider, url: SOURCES[k].url, note: SOURCES[k].note, pro: SOURCES[k].pro, available: !SOURCES[k].pro || pro, enabled: cfg.sources[k], fetchedAt: c?.fetchedAt ?? "", error: c?.error ?? "" }; }));
  return { pro, sources, country: cfg.country, countries: COUNTRIES, canEdit: roleKind(ctx) === "owner", fredKey: !!process.env.FRED_API_KEY, disclaimer: "Informations publiques fournies à titre indicatif : ce n'est ni un conseil en investissement ni une recommandation d'achat ou de vente." };
}
export async function configSave(store: Store, ctx: Ctx, b: { sources?: Record<string, unknown>; country?: unknown }) {
  await gate(store, ctx); if (roleKind(ctx) !== "owner") throw new HttpError(403, "Réservé au propriétaire");
  const before = await mkCfg(store, ctx); const next: MkCfg = { sources: { ...before.sources }, country: before.country };
  if (b.sources !== undefined) { if (typeof b.sources !== "object" || b.sources === null) throw new HttpError(400, "Sources : objet attendu"); for (const [k, v] of Object.entries(b.sources)) { if (!KEYS.includes(k as SourceKey) || typeof v !== "boolean") throw new HttpError(400, `Source inconnue ou valeur invalide : ${k}`); next.sources[k as SourceKey] = v; } }
  if (b.country !== undefined) { if (b.country !== null && !COUNTRIES.some((c) => c.code === b.country)) throw new HttpError(400, "Pays inconnu"); next.country = (b.country as string | null) ?? null; }
  const { row, data } = await cfgRow(store, ctx); const id = cfgId(ctx); const json = JSON.stringify({ ...data, markets: next });
  await store.batch([row ? { kind: "update", table: "inv_config", id, data: { data: json, updatedBy: ctx.userId } } : { kind: "create", table: "inv_config", id, tenantId: ctx.tenantId, data: { ...MIN(ctx), data: json, updatedBy: ctx.userId } }, aud(ctx, "invest.markets.config", JSON.stringify({ before, after: next }).slice(0, 900))]);
  return { config: next };
}

// ------------------------------------------------------------------ taux de change (base XOF)
export const FX_QUOTES: [string, string][] = [["EUR", "Euro"], ["USD", "Dollar américain"], ["GBP", "Livre sterling"], ["CHF", "Franc suisse"], ["CNY", "Yuan chinois"], ["JPY", "Yen japonais"], ["AED", "Dirham des Émirats"], ["XAF", "Franc CFA (CEMAC)"], ["NGN", "Naira nigérian"], ["GHS", "Cedi ghanéen"], ["GNF", "Franc guinéen"], ["MAD", "Dirham marocain"], ["EGP", "Livre égyptienne"], ["KES", "Shilling kényan"], ["ZAR", "Rand sud-africain"]];
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const r4 = (n: number) => Math.round(n * 1e4) / 1e4; const r2 = (n: number) => Math.round(n * 100) / 100;
export const PEG = 655.957; // parité fixe légale : 1 EUR = 655,957 XOF (et 655,957 XAF)
/** Taux de référence base EUR → FCFA pour 1 unité de chaque devise : EUR et XAF à la parité exacte, les autres = parité ÷ (EUR → devise). */
export function parseFx(rows: { date: string; quote: string; rate: number }[]) {
  const by = new Map<string, { date: string; perUnit: number }[]>(); const dates = [...new Set(rows.map((r) => r.date))].sort();
  for (const r of rows) if (r.rate > 0 && r.quote !== "XAF" && r.quote !== "EUR") (by.get(r.quote) ?? by.set(r.quote, []).get(r.quote)!).push({ date: r.date, perUnit: r4(PEG / r.rate) });
  if (dates.length) { by.set("EUR", dates.map((date) => ({ date, perUnit: PEG }))); by.set("XAF", dates.map((date) => ({ date, perUnit: 1 }))); }
  const rates = FX_QUOTES.filter(([c]) => by.has(c)).map(([code, name]) => { const s = by.get(code)!.sort((a, b) => a.date.localeCompare(b.date)); const last = s.at(-1)!, first = s[0]!; return { code, name, perUnit: last.perUnit, date: last.date, change30dPct: s.length > 1 && first.perUnit > 0 ? r2(((last.perUnit - first.perUnit) / first.perUnit) * 100) : null, series: s }; });
  if (!rates.some((r) => r.code !== "EUR" && r.code !== "XAF")) throw new Error("aucun taux reçu"); return { base: "XOF", date: rates.reduce((m, r) => (r.date > m ? r.date : m), ""), rates };
}
export async function fx(store: Store, ctx: Ctx, b: { force?: boolean } = {}) {
  await need(store, ctx, "fx"); const from = day(nowFn() - 35 * 864e5);
  const c = await cached(store, "fx", SOURCES.fx.ttlH, async () => parseFx(await getJson(`https://api.frankfurter.dev/v2/rates?base=EUR&quotes=${FX_QUOTES.map(([q]) => q).filter((q) => q !== "EUR" && q !== "XAF").join(",")}&from=${from}`, 10_000)), !!b.force && roleKind(ctx) === "owner");
  return { ...(c.data ?? { base: "XOF", date: "", rates: [] }), parity: "Parité fixe : 1 euro = 655,957 FCFA (francs CFA UEMOA et CEMAC rattachés à l'euro, même valeur). Les autres devises sont calculées à partir de cette parité et du taux de référence de la BCE.", meta: meta("fx", c) };
}

// ------------------------------------------------------------------ indicateurs macroéconomiques (Banque mondiale)
export const INDICATORS: { key: string; wb: string; label: string; unit: string }[] = [
  { key: "inflation", wb: "FP.CPI.TOTL.ZG", label: "Inflation (prix à la consommation)", unit: "% par an" },
  { key: "growth", wb: "NY.GDP.MKTP.KD.ZG", label: "Croissance du PIB réel", unit: "% par an" },
  { key: "lending", wb: "FR.INR.LEND", label: "Taux débiteur bancaire", unit: "%" },
  { key: "real", wb: "FR.INR.RINR", label: "Taux d'intérêt réel", unit: "%" },
];
type WbRow = { country: { id: string; value: string }; countryiso3code: string; date: string; value: number | null };
const ISO3: Record<string, string> = { BJ: "BEN", BF: "BFA", CI: "CIV", GW: "GNB", ML: "MLI", NE: "NER", SN: "SEN", TG: "TGO", CM: "CMR", GA: "GAB", CG: "COG", TD: "TCD", NG: "NGA", GH: "GHA", GN: "GIN", MA: "MAR", EG: "EGY", KE: "KEN", ZA: "ZAF", CD: "COD", SSF: "SSF", WLD: "WLD" };
export function parseMacro(byIndicator: Record<string, WbRow[]>) {
  const back = Object.fromEntries(Object.entries(ISO3).map(([k, v]) => [v, k])); let any = false;
  const countries = COUNTRIES.map((c) => ({ ...c, values: {} as Record<string, { value: number; year: string } | null> }));
  for (const ind of INDICATORS) for (const c of countries) c.values[ind.key] = null;
  for (const ind of INDICATORS) for (const r of byIndicator[ind.key] ?? []) { const code = back[r.countryiso3code] ?? r.country?.id; const c = countries.find((x) => x.code === code); if (c && typeof r.value === "number") { c.values[ind.key] = { value: r2(r.value), year: r.date }; any = true; } }
  if (!any) throw new Error("aucune valeur reçue"); return { countries, indicators: INDICATORS.map(({ key, label, unit }) => ({ key, label, unit })) };
}
export async function macro(store: Store, ctx: Ctx, b: { force?: boolean } = {}) {
  await need(store, ctx, "macro");
  const c = await cached(store, "macro", SOURCES.macro.ttlH, async () => { const res = await Promise.allSettled(INDICATORS.map((i) => getJson<[unknown, WbRow[] | null]>(`https://api.worldbank.org/v2/country/all/indicator/${i.wb}?format=json&mrnev=1&per_page=400`, 12_000)));
    const by: Record<string, WbRow[]> = {}; res.forEach((r, i) => { if (r.status === "fulfilled") by[INDICATORS[i]!.key] = r.value[1] ?? []; }); if (res.every((r) => r.status === "rejected")) throw new Error((res[0] as PromiseRejectedResult).reason?.message ?? "injoignable"); return parseMacro(by); }, !!b.force && roleKind(ctx) === "owner");
  return { ...(c.data ?? { countries: [], indicators: INDICATORS.map(({ key, label, unit }) => ({ key, label, unit })) }), country: (await mkCfg(store, ctx)).country, meta: meta("macro", c) };
}

// ------------------------------------------------------------------ BRVM (dépôt communautaire, cours bruts ajustés des fractionnements déclarés)
const RAW = "https://raw.githubusercontent.com/blakro/brvm/main/data/";
const SESSIONS = 260; const TAIL_BYTES = 1_300_000;
/** Découpe une ligne CSV (champs entre guillemets possibles). */
export function csvLine(line: string): string[] { const out: string[] = []; let cur = "", q = false; for (let i = 0; i < line.length; i++) { const ch = line[i]!; if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; } else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out; }
const csvRows = (text: string) => text.split(/\r?\n/).filter((l) => l.trim()).map(csvLine);
type Session = { d: string; c: number; v: number };
type BrvmTicker = { ticker: string; name: string; sector: string; close: number; prev: number | null; changePct: number | null; date: string; volumeFcfa: number; high52: number; low52: number; change52Pct: number | null; lastDividend: { amount: number; date: string; exercice: string } | null; yieldPct: number | null; spark: number[] };
/** Cours bruts (CSV date,ticker,ouverture,haut,bas,cloture,volume_titres,volume_fcfa) → séances par titre, ajustées : avant chaque fractionnement de rapport R, cours ÷ R. */
export function parseBrvm(cours: string, referentiel: string, dividendes: string, fractionnements: string, partial: boolean) {
  const lines = cours.split(/\r?\n/); if (partial) lines.shift(); const head = lines[0]?.startsWith("date,") ? lines.shift() : null; void head;
  const splits = csvRows(fractionnements).slice(1).map(([t, d, r, note]) => ({ ticker: t!, date: d!, ratio: Number(r), note: note ?? "" })).filter((s) => s.ratio > 0);
  const ref = new Map(csvRows(referentiel).slice(1).map(([t, n, s]) => [t!, { name: (n ?? "").replace(/\s+/g, " ").trim(), sector: s ?? "" }]));
  const divs = csvRows(dividendes).slice(1).map(([t, d, m, e]) => ({ ticker: t!, date: d!, amount: Number(m), exercice: (e ?? "").replace(/\.0$/, "") })).filter((x) => x.amount > 0);
  const by = new Map<string, (Session & { vf: number })[]>();
  for (const l of lines) { if (!l.trim()) continue; const [d, t, , , , cl, , vf] = l.split(","); const c = Number(cl); if (!d || !t || !/^\d{4}-\d{2}-\d{2}$/.test(d) || !(c > 0)) continue; (by.get(t) ?? by.set(t, []).get(t)!).push({ d, c, v: 0, vf: Number(vf) || 0 }); }
  for (const [t, rows] of by) { rows.sort((a, b) => a.d.localeCompare(b.d)); for (const s of splits.filter((x) => x.ticker === t)) for (const r of rows) if (r.d < s.date) r.c = r2(r.c / s.ratio); if (rows.length > SESSIONS) by.set(t, rows.slice(-SESSIONS)); }
  const asOf = [...by.values()].reduce((m, r) => (r.at(-1)!.d > m ? r.at(-1)!.d : m), "");
  const tickers: BrvmTicker[] = []; const series: Record<string, Session[]> = {};
  for (const [t, rows] of by) { const last = rows.at(-1)!; if (last.d < day(new Date(asOf).getTime() - 30 * 864e5)) continue; const prev = rows.length > 1 ? rows.at(-2)!.c : null; const closes = rows.map((r) => r.c);
    const ld = divs.filter((x) => x.ticker === t).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null; const adj = ld ? splits.filter((s) => s.ticker === t && s.date > ld.date).reduce((a, s) => a / s.ratio, ld.amount) : null;
    const target = day(new Date(last.d).getTime() - 365 * 864e5); const yearAgo = [...rows].reverse().find((r) => r.d <= target) ?? null; const step = Math.max(1, Math.floor(rows.length / 26));
    tickers.push({ ticker: t, name: ref.get(t)?.name || t, sector: ref.get(t)?.sector || "Non classé", close: last.c, prev, changePct: prev ? r2(((last.c - prev) / prev) * 100) : null, date: last.d, volumeFcfa: Math.round(last.vf), high52: Math.max(...closes), low52: Math.min(...closes), change52Pct: yearAgo && yearAgo.d < last.d ? r2(((last.c - yearAgo.c) / yearAgo.c) * 100) : null, lastDividend: ld && adj ? { amount: r2(adj), date: ld.date, exercice: ld.exercice } : null, yieldPct: ld && adj && ld.date >= day(new Date(last.d).getTime() - 400 * 864e5) ? r2((adj / last.c) * 100) : null, spark: rows.filter((_, i) => i % step === 0 || i === rows.length - 1).map((r) => r.c) });
    series[t] = rows.map(({ d, c, vf }) => ({ d, c, v: Math.round(vf) })); }
  if (!tickers.length) throw new Error("aucun cours exploitable");
  tickers.sort((a, b) => a.ticker.localeCompare(b.ticker)); const today = tickers.filter((x) => x.date === asOf && x.changePct !== null);
  const sectors = [...new Set(tickers.map((x) => x.sector))].map((name) => { const xs = tickers.filter((x) => x.sector === name && x.date === asOf && x.changePct !== null); return { name, count: tickers.filter((x) => x.sector === name).length, avgChangePct: xs.length ? r2(xs.reduce((s, x) => s + x.changePct!, 0) / xs.length) : null }; }).sort((a, b) => b.count - a.count);
  return { summary: { asOf, breadth: { up: today.filter((x) => x.changePct! > 0).length, down: today.filter((x) => x.changePct! < 0).length, flat: today.filter((x) => x.changePct === 0).length }, tickers, sectors, splits: splits.filter((s) => s.date >= day(new Date(asOf).getTime() - 365 * 864e5)) }, series, divs };
}
async function loadBrvm() {
  let cours = "", partial = false;
  try { const h = await get(`${RAW}cours.csv`, 8000, {}, "HEAD"); const len = Number(h.headers.get("content-length")); if (len > TAIL_BYTES) { const r = await get(`${RAW}cours.csv`, 12_000, { Range: `bytes=${len - TAIL_BYTES}-` }); partial = r.status === 206; cours = await r.text(); } } catch { cours = ""; }
  if (!cours) { cours = await (await get(`${RAW}cours.csv`, 14_000)).text(); partial = false; }
  const [ref, div, spl] = await Promise.all(["referentiel.csv", "dividendes.csv", "fractionnements.csv"].map(async (f) => { try { return await (await get(RAW + f, 8000)).text(); } catch { return "x\n"; } }));
  return parseBrvm(cours, ref!, div!, spl!, partial);
}
async function brvmData(store: Store, force: boolean) {
  const c = await cached(store, "brvm", SOURCES.brvm.ttlH, async () => { const p = await loadBrvm(); const at = new Date(nowFn()).toISOString();
    for (const [t, s] of Object.entries(p.series)) await writeCache(store, `brvm_${t}`, { data: JSON.stringify({ series: s, dividends: p.divs.filter((d) => d.ticker === t) }), fetchedAt: at, attemptAt: at, error: "" });
    return p.summary; }, force);
  return c;
}
export async function brvm(store: Store, ctx: Ctx, b: { force?: boolean } = {}) {
  await need(store, ctx, "brvm"); const c = await brvmData(store, !!b.force && roleKind(ctx) === "owner");
  return { ...(c.data ?? { asOf: "", breadth: { up: 0, down: 0, flat: 0 }, tickers: [], sectors: [], splits: [] }), indexNote: "Les indices officiels (BRVM Composite, BRVM 30, BRVM Prestige) ne figurent pas dans cette source : ils ne sont pas affichés.", meta: meta("brvm", c) };
}
export async function brvmTicker(store: Store, ctx: Ctx, b: { ticker?: string }) {
  await need(store, ctx, "brvm"); const t = String(b.ticker ?? "").toUpperCase(); if (!/^[A-Z]{3,6}$/.test(t)) throw new HttpError(400, "Code de titre invalide");
  const sum = await brvmData(store, false); const info = sum.data?.tickers.find((x) => x.ticker === t); if (!info) throw new HttpError(404, "Titre inconnu ou sans cotation récente");
  const row = await readCache(store, `brvm_${t}`); const d = (row?.data ?? null) as { series: Session[]; dividends: { date: string; amount: number; exercice: string }[] } | null;
  return { ...info, series: d?.series ?? [], dividends: (d?.dividends ?? []).sort((a, x) => x.date.localeCompare(a.date)), splits: (sum.data?.splits ?? []).filter((s) => s.ticker === t), meta: meta("brvm", sum) };
}

// ------------------------------------------------------------------ contexte mondial (FRED)
export const FRED_SERIES: { id: string; label: string; unit: string }[] = [
  { id: "ECBDFR", label: "Taux de dépôt de la BCE", unit: "%" },
  { id: "FEDFUNDS", label: "Taux directeur effectif de la Fed (États-Unis)", unit: "%" },
  { id: "DGS10", label: "Rendement des obligations d'État américaines à 10 ans", unit: "%" },
  { id: "DCOILBRENTEU", label: "Pétrole Brent", unit: "USD / baril" },
];
export function parseFred(id: string, json: { observations?: { date: string; value: string }[] }) {
  const pts = (json.observations ?? []).map((o) => ({ date: o.date, value: Number(o.value) })).filter((p) => Number.isFinite(p.value) && String(p.value) !== "NaN");
  if (!pts.length) throw new Error(`série ${id} vide`); const last = pts.at(-1)!; const yr = pts.find((p) => p.date >= day(new Date(last.date).getTime() - 366 * 864e5)) ?? null;
  return { last, yearAgo: yr && yr.date < last.date ? yr : null, points: pts.slice(-13) };
}
export async function world(store: Store, ctx: Ctx, b: { force?: boolean } = {}) {
  await need(store, ctx, "world"); const key = (process.env.FRED_API_KEY ?? "").trim().replace(/^["']|["']$/g, "").toLowerCase();
  if (!key) return { keyMissing: true, series: [], meta: { ...meta("world", { data: null, fetchedAt: "", stale: false, error: "" }), error: "Clé FRED non configurée sur le serveur (variable FRED_API_KEY de la fonction)." } };
  if (!/^[a-z0-9]{32}$/.test(key)) return { keyMissing: false, series: [], meta: { ...meta("world", { data: null, fetchedAt: "", stale: false, error: "" }), error: `Clé FRED au format invalide : 32 caractères (chiffres et lettres minuscules) attendus, ${key.length} reçus. Corrigez la variable FRED_API_KEY de la fonction.` } };
  const start = day(nowFn() - 400 * 864e5);
  const c = await cached(store, "world", SOURCES.world.ttlH, async () => { const res = await Promise.allSettled(FRED_SERIES.map(async (s) => ({ ...s, ...parseFred(s.id, await getJson(`https://api.stlouisfed.org/fred/series/observations?series_id=${s.id}&api_key=${encodeURIComponent(key)}&file_type=json&frequency=m&aggregation_method=eop&observation_start=${start}`, 10_000)) })));
    const ok = res.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])); if (!ok.length) throw new Error(`aucune série reçue — ${String((res.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined)?.reason?.message ?? "raison inconnue")}`); return ok; }, !!b.force && roleKind(ctx) === "owner");
  return { keyMissing: false, series: c.data ?? [], meta: meta("world", c) };
}

// ------------------------------------------------------------------ liens avec vos projets (Pro) : repère de coût du capital, placements face à l'inflation
export async function links(store: Store, ctx: Ctx) {
  await gate(store, ctx); if (!(await proOn(store, ctx))) throw new HttpError(402, "Liens marchés et projets : formule Pro"); const cfg = await mkCfg(store, ctx);
  if (!cfg.country) return { country: null, countryName: null, inflation: null, lending: null, lendingUsable: false, real: null, placements: [], note: "Choisissez votre pays de référence pour comparer vos placements à l'inflation et disposer d'un repère de coût du capital." };
  const m = cfg.sources.macro ? await macro(store, ctx) : null; const c = m?.countries.find((x) => x.code === cfg.country) ?? null;
  const inflation = c?.values.inflation ?? null; const pl = (await itemsAll(store, ctx)).filter((i) => i.kind === "placement" && i.status === "active");
  const lending = c?.values.lending ?? null; const recent = (v: { year: string } | null) => !!v && Number(v.year) >= new Date(nowFn()).getUTCFullYear() - 3;
  return { country: cfg.country, countryName: COUNTRIES.find((x) => x.code === cfg.country)!.name, inflation, lending, lendingUsable: recent(lending), real: c?.values.real ?? null,
    placements: pl.map((i) => { const rate = Number((i.data as { expectedRatePct?: number }).expectedRatePct); return { id: i.id, name: i.name, amount: i.budget, expectedRatePct: Number.isFinite(rate) ? rate : null, realPct: Number.isFinite(rate) && inflation ? r2(rate - inflation.value) : null }; }),
    note: "Rendement réel approché = rendement attendu déclaré − dernière inflation annuelle publiée. Le taux débiteur bancaire n'est qu'un repère, proposé seulement s'il a moins de 3 ans : le coût du capital reste fixé par le propriétaire." };
}
