import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { REFERENCE, evalDataset, evalRun, aiUsage, type RefResult } from "./master-eval";
import { TOOLS, globalTokensToday } from "./master-chat";
import { aiConfig } from "./ai-gemini";
import type { Answer } from "../../../src/domain/master-chat";

process.env.MASTER_CHAT_MIN_INTERVAL_MS = "0"; process.env.MASTER_CHAT_USER_DAILY = "1000";
class DatedStore extends MemoryStore { override async create(t: string, id: string, tenant: string, d: Record<string, unknown>) { return super.create(t, id, tenant, { $createdAt: new Date().toISOString(), ...d }); } }
const T = "tenantl20001"; const KEY = "AIza-SECRET-LOT2-0123456789"; const ENV_ON = { MASTER_AI_ENABLED: "true", MASTER_AI_BILLING_CONFIRMED: "true", GEMINI_API_KEY: KEY, GEMINI_MODEL: "modele-test-1", MASTER_AI_RETRY_MS: "0" };
let st: DatedStore; let A = ""; let n = 0; const fetchMock = vi.fn(); const today = () => new Date().toISOString().slice(0, 10);
const call = (user: string, action: string, payload: unknown = {}, shop = "", tenant = T) => handle(st, user, { action, tenantId: tenant, shopId: shop, payload }, { admins: ["admin1"] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); };
const adm = (action: string, payload: object = {}) => call("admin1", action, payload, "", "");
const ask = (p: Record<string, unknown>) => ok(call("own", "md.chat.ask", { requestKey: `req-${String(++n).padStart(10, "0")}`, shopId: A, ...p }));
const gem = (obj: unknown, usage = { promptTokenCount: 100, candidatesTokenCount: 20 }) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }], usageMetadata: usage }) });
const setEnv = (e: Record<string, string>) => { for (const [k, v] of Object.entries(e)) process.env[k] = v; };
const sale = (id: string, total: number) => st.create("sales", id, T, { tenantId: T, shopId: A, number: id, total, status: "paid", cashierId: "x", payments: JSON.stringify([{ method: "cash", amount: total }]), lines: "[]", soldAt: new Date(Date.now() - 1000).toISOString() });
/** Fournisseur simulé et « raisonnable » : classe d'après le jeu de référence, rédige avec un chiffre présent dans les résultats. */
const smartProvider = (opts: { invent?: string; wrongClass?: string } = {}) => fetchMock.mockImplementation(async (_u: string, init: any) => {
  const text: string = JSON.parse(init.body).contents[0].parts[0].text;
  if (text.startsWith("<question>")) { const q = text.slice(10, -11); const r = REFERENCE.find((x) => x.text === q); return gem({ qid: opts.wrongClass === q ? "stock" : r?.qid ?? "none", days: 7 }); }
  const j = JSON.parse(text); const first = (j.faits as { value: unknown }[]).find((f) => typeof f.value === "number"); const bad = opts.invent && j.question === opts.invent; return gem({ conclusion: bad ? "Un total de 424242 FCFA a été atteint." : `Le chiffre clé est ${first?.value ?? 0}.`, observations: [] });
});
beforeEach(async () => {
  st = new DatedStore(); n = 0; fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); await st.grant(T, "own", ["owner"], []); A = (await ok(call("own", "shop.create", { name: "Dakar" }))).shopId;
  void st.create("subscriptions", T, T, { tenantId: T, plan: "business", period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }); await st.update("shops", A, { phone: "0701020304" }); await ok(call("own", "md.trial.start", {}));
});
afterEach(() => { for (const k of [...Object.keys(ENV_ON), "MASTER_AI_GLOBAL_DAILY_TOKENS", "GEMINI_API_STYLE"]) delete process.env[k]; vi.unstubAllGlobals(); });

describe("MASTER DOGUI — lot 2 : coût et conformité de l'IA", () => {
  it("B3 garde « offre payante confirmée » : sans MASTER_AI_BILLING_CONFIRMED, aucun appel externe même si tout le reste est configuré ; le statut l'explique", async () => {
    setEnv({ ...ENV_ON, MASTER_AI_BILLING_CONFIRMED: "false" }); await sale("s1", 1000); const r = await ask({ qid: "sales", days: 1 }); expect(fetchMock).not.toHaveBeenCalled(); expect((r.assistant.answer as Answer).ai?.used).toBe(false); const l = await ok(call("own", "md.chat.list")); expect(l.mode.ai).toBe(false); expect(l.mode.label).toContain("MASTER_AI_BILLING_CONFIRMED"); expect(l.mode.billingConfirmed).toBe(false); expect(aiConfig({ ...ENV_ON })).not.toBeNull();
  });
  it("B2 plafond global de jetons de la plateforme : atteint = réponse calculée sans appel ; les jetons de chaque appel sont cumulés au compteur global", async () => {
    setEnv({ ...ENV_ON, MASTER_AI_GLOBAL_DAILY_TOKENS: "10000" }); await sale("s1", 1000); fetchMock.mockResolvedValue(gem({ conclusion: "1 vente pour 1 000 FCFA.", observations: [] }, { promptTokenCount: 300, candidatesTokenCount: 50 })); await ask({ qid: "sales", days: 1 }); expect(await globalTokensToday(st)).toBe(350); await ask({ qid: "sales", days: 1 }); expect(await globalTokensToday(st)).toBe(700);
    await st.update("md_usage", `ug${today()}`, { tokensIn: 6000, tokensOut: 5000 }); fetchMock.mockClear(); const r = await ask({ qid: "sales", days: 1 }); expect(fetchMock).not.toHaveBeenCalled(); expect((r.assistant.answer as Answer).ai?.note).toContain("plateforme");
  });
  it("B4 modèle, style d'API et version du prompt conservés avec chaque réponse (rédigée ou repliée)", async () => {
    setEnv({ ...ENV_ON, GEMINI_API_STYLE: "generate" }); await sale("s1", 1000); fetchMock.mockResolvedValueOnce(gem({ conclusion: "1 vente pour 1 000 FCFA.", observations: [] })); const a = (await ask({ qid: "sales", days: 1 })).assistant.answer as Answer; expect(a.ai).toMatchObject({ used: true, model: "modele-test-1", style: "generate", prompt: "w1" });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) }); const b = (await ask({ qid: "sales", days: 1 })).assistant.answer as Answer; expect(b.ai).toMatchObject({ used: false, model: "modele-test-1", prompt: "w1" }); expect(JSON.stringify(st.rows("md_msgs"))).toContain("modele-test-1");
  });
  it("B1 le décompte par question conserve réponses IA et replis (pour le panneau de coûts)", async () => {
    setEnv(ENV_ON); await sale("s1", 1000); fetchMock.mockResolvedValueOnce(gem({ conclusion: "1 vente pour 1 000 FCFA.", observations: [] })); await ask({ qid: "sales", days: 1 }); fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) }); await ask({ qid: "sales", days: 1 });
    const u = st.rows("md_usage").filter((r) => r.tenantId === T); expect(u.map((r) => [r.aiUsed, r.fallback])).toEqual([[1, 0], [0, 1]]);
  });
  it("B1 panneau administrateur : réservé à l'administrateur, totaux par jour, replis, principaux consommateurs, alertes", async () => {
    await err(call("own", "platform.master.ai.usage", {}, "", ""), 403); const d = today();
    for (let i = 0; i < 12; i++) await st.create("md_usage", `x${i}`, T, { tenantId: T, day: d, n: i + 1, userId: "u", tokensIn: 1000, tokensOut: 200, aiUsed: i < 6 ? 1 : 0, fallback: i < 6 ? 0 : 1 }); await st.create("md_usage", "y1", "tenantother01", { tenantId: "tenantother01", day: d, n: 1, userId: "u", tokensIn: 50, tokensOut: 10, aiUsed: 1, fallback: 0 }); await st.create("md_usage", `ug${d}`, "platform", { tenantId: "platform", day: d, n: 0, tokensIn: 900_000, tokensOut: 0 });
    setEnv(ENV_ON); const r = await ok(adm("platform.master.ai.usage", { days: 3 })); const t0 = r.days[0]; expect(r.days).toHaveLength(3); expect(t0).toMatchObject({ day: d, questions: 13, aiAnswers: 7, fallbacks: 6, tokensIn: 12_050, tokensOut: 2_410, globalTokens: 900_000, tenants: 2 }); expect(t0.top[0]).toMatchObject({ tenantId: T, tokens: 14_400 }); expect(r.globalCap).toBe(1_000_000); expect(r.alerts.join(" ")).toContain("90 %"); expect(r.alerts.join(" ")).toContain("replis"); expect(JSON.stringify(r)).not.toContain(KEY); expect(r.status.active).toBe(true);
  });
  it("C1 jeu de référence : 25 questions, chiffres attendus EXACTS sur les données synthétiques (garde de non-régression des outils, sans fournisseur)", async () => {
    expect(REFERENCE).toHaveLength(25); expect(REFERENCE.filter((q) => q.free)).toHaveLength(9); const d = await evalDataset();
    for (const q of REFERENCE) { const a = await TOOLS[q.qid]!({ store: d.store, ctx: d.ctx, shop: d.shop, days: q.days }); const got = Object.fromEntries(a.facts.map((f) => [f.label, f.value])); for (const [k, v] of Object.entries(q.expect)) expect(got[k], `${q.id} · ${k}`).toBe(v); }
  });
  it("C1 évaluation contre le fournisseur : réservée à l'administrateur, exige l'IA active, respecte le plafond global", async () => {
    await err(call("own", "platform.master.ai.eval", {}, "", ""), 403); await err(adm("platform.master.ai.eval", {}), 409, "IA non active"); setEnv({ ...ENV_ON, MASTER_AI_GLOBAL_DAILY_TOKENS: "10000" }); await st.create("md_usage", `ug${today()}`, "platform", { tenantId: "platform", day: today(), n: 0, tokensIn: 10_000, tokensOut: 0 }); await err(adm("platform.master.ai.eval", {}), 429, "Plafond global");
  });
  it("C1 une mauvaise classification de l'IA est détectée et comptée comme échec (le chiffre n'est alors pas jugé exact)", async () => {
    setEnv(ENV_ON); smartProvider({ wrongClass: "Qui me doit encore de l'argent ?" }); const r: any = await ok(adm("platform.master.ai.eval", { from: 16, count: 5 })); const f3 = r.results.find((x: RefResult) => x.id === "f-3"); expect(f3).toMatchObject({ ai: "stock", routed: "stock", classOk: false, factsOk: false }); expect(f3.mismatches.join(" ")).toContain("sujet stock au lieu de credit");
  });
  it("C1 si l'IA échoue pendant le classement, les mots-clés servent de repli (comme en production)", async () => {
    setEnv(ENV_ON); fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }); const r: any = await ok(adm("platform.master.ai.eval", { from: 16, count: 1 })); expect(r.results[0]).toMatchObject({ id: "f-1", routed: "sales", classOk: true, written: "erreur" }); expect(r.results[0].ai).toContain("erreur");
  });
  it("assistant : question saisie = l'IA choisit le sujet (corrige les faux amis des mots-clés) ; repli sur les mots-clés si l'IA échoue", async () => {
    setEnv(ENV_ON); await sale("s1", 1000); fetchMock.mockResolvedValueOnce(gem({ qid: "sales", days: 1 })).mockResolvedValueOnce(gem({ conclusion: "1 vente pour 1 000 FCFA.", observations: [] })); const a = (await ask({ text: "Qui me doit encore de l'argent aujourd'hui ?" })).assistant.answer as Answer; expect(a.qid).toBe("sales");
    fetchMock.mockReset(); fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }); const b = (await ask({ text: "Mes ventes aujourd'hui" })).assistant.answer as Answer; expect(b.qid).toBe("sales"); expect(b.ai?.note).toContain("classement par mots-clés utilisé"); expect(b.facts.length).toBeGreaterThan(0);
  });
  it("C1 évaluation complète par lots (pagination) : classement, chiffres exacts, rédactions retenues/écartées, jetons comptés au plafond global ; aucune donnée d'entreprise transmise", async () => {
    setEnv(ENV_ON); smartProvider({ invent: "Quels produits se vendent le plus ?" }); const all: RefResult[] = []; let from: number | null = 0; let calls = 0;
    while (from !== null) { const r: any = await ok(adm("platform.master.ai.eval", { from, count: 5 })); all.push(...r.results); from = r.next; calls++; expect(r.model).toBe("modele-test-1"); }
    expect(calls).toBe(5); expect(all).toHaveLength(25); expect(all.every((x) => x.factsOk)).toBe(true); expect(all.filter((x) => x.classOk)).toHaveLength(25); expect(all.find((x) => x.id === "f-3")).toMatchObject({ matcher: "treasury", ai: "credit", routed: "credit", classOk: true }); expect(all.find((x) => x.id === "f-2")).toMatchObject({ matcher: "overview", ai: "top", routed: "top" }); const inv = all.filter((x) => x.invented); expect(inv).toHaveLength(1); expect(inv.every((x) => x.expected === "top")).toBe(true); expect(all.filter((x) => x.written === "retenue")).toHaveLength(24);
    expect(await globalTokensToday(st)).toBeGreaterThan(3000); const bodies = fetchMock.mock.calls.map((c) => String((c[1] as any).body)).join(" "); expect(bodies).not.toContain(KEY); expect(bodies).not.toMatch(/tenantl20001|Dakar/);
  });
});
