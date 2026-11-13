import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { TOKEN_RE, processWebhook, purgeEvents } from "./master-pay";
import { closeHooks } from "./cashier";
import { maskPersonal, cleanQuestion } from "../../../src/domain/master-chat";
import { chatLimits } from "./master-chat";

class DatedStore extends MemoryStore { override async create(t: string, id: string, tenant: string, d: Record<string, unknown>) { return super.create(t, id, tenant, { $createdAt: new Date().toISOString(), ...d }); } }
class CountingStore extends DatedStore { reads = 0; override async get(t: string, id: string) { this.reads++; return super.get(t, id); } override async list(t: string, w: Record<string, string | number | boolean>, l?: number) { this.reads++; return super.list(t, w, l); } override async scan(t: string, w: Record<string, string | number | boolean>, o?: Parameters<MemoryStore["scan"]>[2]) { this.reads++; return super.scan(t, w, o); } }
class FailingRecos extends DatedStore { override async create(t: string, id: string, tenant: string, d: Record<string, unknown>) { if (t === "md_recos") throw new Error("table md_recos indisponible"); return super.create(t, id, tenant, d); } }
const T = "tenanthd0001"; let st: DatedStore; let A = ""; let n = 0; const U: Record<string, string> = {};
const call = (user: string, action: string, payload: unknown = {}, shop = "", tenant = T) => handle(st, U[user] ?? user, { action, tenantId: tenant, shopId: shop, payload }, { admins: ["admin1"] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); };
const adm = (action: string, payload: object = {}) => call("admin1", action, payload, "", "");
const MAP = { ref: "data.id", amount: "data.amount", email: "data.customer.email", status: "event", currency: "data.currency", successValues: ["charge.success"], expectedCurrency: "" };
const setup = async (s: DatedStore) => { st = s; n = 0; await st.grant(T, "own", ["owner"], []); A = (await ok(call("own", "shop.create", { name: "Dakar" }))).shopId; void st.create("subscriptions", T, T, { tenantId: T, plan: "business", period: "month", status: "paid", startedAt: new Date().toISOString(), renewsAt: new Date(Date.now() + 20 * 864e5).toISOString() }); await st.update("shops", A, { phone: "0701020304" }); await ok(call("own", "md.trial.start", {})); U.cais = (await ok(call("own", "staff.create", { name: "c", username: "cais", password: "motdepasse1", role: "cashier", shopIds: [A] }))).userId; };
const ask = (p: Record<string, unknown>, user = "own") => call(user, "md.chat.ask", { requestKey: `req-${String(++n).padStart(10, "0")}`, ...p });
afterEach(() => { delete process.env.MASTER_CHAT_MIN_INTERVAL_MS; delete process.env.MASTER_CHAT_USER_DAILY; vi.restoreAllMocks(); });

describe("MASTER DOGUI — lot 1 : sécurité et données", () => {
  describe("A1 — réception publique", () => {
    beforeEach(() => setup(new CountingStore()));
    it("jeton absent ou mal formé : rejet 404 SANS aucune lecture de base ; corps trop gros refusé avant lecture", async () => {
      const s = st as CountingStore; s.reads = 0; for (const token of ["", "abc", "x".repeat(100), "../etc/passwd", "a b".padEnd(40, "a")]) expect((await processWebhook(s, { token, raw: "{}" })).status).toBe(404); expect((await processWebhook(s, { token: "a".repeat(48), raw: "x".repeat(20_001) })).status).toBe(413); expect(s.reads).toBe(0); expect(TOKEN_RE.test("a".repeat(48))).toBe(true);
    });
    it("configuration mise en cache (30 s) : une rafale de jetons bien formés mais faux ne relit pas la base à chaque requête ; sans cache chaque appel relit", async () => {
      await ok(adm("platform.master.hook.save", { mapping: MAP })); const token = (await ok(adm("platform.master.hook.rotate"))).token; await ok(adm("platform.master.hook.save", { enabled: true })); const s = st as CountingStore;
      s.reads = 0; for (let i = 0; i < 20; i++) expect((await processWebhook(s, { token: "b".repeat(48), raw: "{}" }, { cacheMs: 30_000 })).status).toBe(404); expect(s.reads).toBeLessThanOrEqual(1);
      s.reads = 0; await processWebhook(s, { token: "b".repeat(48), raw: "{}" }); await processWebhook(s, { token: "b".repeat(48), raw: "{}" }); expect(s.reads).toBe(2); expect(token).toMatch(TOKEN_RE);
    });
  });

  describe("A2/A3 — limites par utilisateur et minimisation", () => {
    beforeEach(() => setup(new DatedStore()));
    it("délai minimal entre deux questions (5 s par défaut) : 429 clair ; désactivable", async () => {
      expect(chatLimits()).toEqual({ userDaily: 15, minIntervalMs: 5000 }); await ok(ask({ qid: "profile" })); await err(ask({ qid: "profile" }), 429, "toutes les 5 secondes"); process.env.MASTER_CHAT_MIN_INTERVAL_MS = "0"; await ok(ask({ qid: "profile" }));
    });
    it("plafond personnel (15 par jour) : un utilisateur ne peut pas épuiser l'entreprise ; un autre garde ses questions", async () => {
      process.env.MASTER_CHAT_MIN_INTERVAL_MS = "0"; U.ger = (await ok(call("own", "staff.create", { name: "g", username: "ger", password: "motdepasse1", role: "manager", shopIds: [A] }))).userId;
      for (let i = 0; i < 15; i++) await ok(ask({ qid: "profile" })); await err(ask({ qid: "profile" }), 429, "Plafond personnel"); await ok(ask({ qid: "profile" }, "ger")); const used = (await ok(call("own", "md.chat.list"))).quota.used; expect(used).toBe(16);
    });
    it("limites réglables par variable ; valeurs invalides ignorées", () => { expect(chatLimits({ MASTER_CHAT_USER_DAILY: "5", MASTER_CHAT_MIN_INTERVAL_MS: "0" })).toEqual({ userDaily: 5, minIntervalMs: 0 }); expect(chatLimits({ MASTER_CHAT_USER_DAILY: "abc", MASTER_CHAT_MIN_INTERVAL_MS: "-4" })).toEqual({ userDaily: 15, minIntervalMs: 5000 }); });
    it("masquage : téléphones et e-mails remplacés ; montants groupés par milliers conservés", () => {
      expect(maskPersonal("Appelle Awa au 07 01 02 03 04 ou +225 0701020304")).toBe("Appelle Awa au [numéro] ou [numéro]"); expect(maskPersonal("Écris à awa.diop@exemple.test merci")).toBe("Écris à [e-mail] merci"); expect(maskPersonal("ventes au-dessus de 1 000 000 FCFA ou 37 110 FCFA")).toBe("ventes au-dessus de 1 000 000 FCFA ou 37 110 FCFA"); expect(maskPersonal("77 123 45 67")).toBe("[numéro]"); expect(maskPersonal("code 1234")).toBe("code 1234");
      const c = cleanQuestion("Mon client 0701020304 (a@b.co) a acheté"); expect(c.ok && c.text).toBe("Mon client [numéro] ([e-mail]) a acheté");
    });
    it("la question stockée est masquée (la valeur d'origine n'est jamais conservée)", async () => {
      process.env.MASTER_CHAT_MIN_INTERVAL_MS = "0"; const r = await ok(ask({ text: "Mes ventes pour le client 0701020304 / awa@exemple.test" })); expect(r.user.text).toBe("Mes ventes pour le client [numéro] / [e-mail]"); expect(JSON.stringify(st.rows("md_msgs"))).not.toMatch(/0701020304|awa@exemple/);
    });
  });

  describe("A4/A5 — purges", () => {
    beforeEach(() => setup(new DatedStore()));
    const ev = (id: string, status: string, daysAgo: number, raw = "contenu brut avec e-mail acheteur@test.example") => st.create("md_events", id, "platform", { status, raw, ref: id, $createdAt: new Date(Date.now() - daysAgo * 864e5).toISOString() });
    it("contenu brut effacé après 30 jours ; notifications décidées supprimées après 12 mois ; récentes et en examen intactes", async () => {
      await ev("evA", "review", 40); await ev("evB", "review", 5); await ev("evC", "matched", 400); await ev("evD", "rejected", 100); await ev("evE", "matched", 3);
      const r = await purgeEvents(st); expect(r).toEqual({ cleared: 2, removed: 1 }); const get = (id: string) => st.rows("md_events").find((x) => x.$id === id);
      expect(get("evA")?.raw).toBe(""); expect(get("evB")?.raw).toContain("acheteur"); expect(get("evC")).toBeUndefined(); expect(get("evD")?.raw).toBe(""); expect(get("evE")?.raw).toContain("acheteur");
    });
    it("la consultation administrateur déclenche la purge", async () => { await ev("evOld", "review", 45); await ok(adm("platform.master.events", { status: "review" })); expect(st.rows("md_events").find((x) => x.$id === "evOld")?.raw).toBe(""); });
    it("décision finale : le contenu brut est effacé immédiatement", async () => {
      await st.create("md_events", "evX", "platform", { status: "review", raw: "brut acheteur@test.example", ref: "R1", amount: 15000, email: "acheteur@test.example" }); await ok(adm("platform.master.event.decide", { eventId: "evX", action: "reject", note: "doublon vérifié" })); expect(st.rows("md_events").find((x) => x.$id === "evX")?.raw).toBe("");
    });
    it("décompte des questions : lignes de plus de 90 jours supprimées à la consultation, récentes conservées", async () => {
      const old = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10); await st.create("md_usage", "uOld", T, { tenantId: T, day: old, n: 1, userId: "x" }); await st.create("md_usage", "uNew", T, { tenantId: T, day: new Date().toISOString().slice(0, 10), n: 1, userId: "x" }); await ok(call("own", "md.chat.list")); expect(st.rows("md_usage").map((r) => r.$id)).toEqual(["uNew"]);
    });
  });

  describe("A6 — échecs silencieux tracés", () => {
    it("accroche de clôture en échec : la clôture réussit, l'échec est journalisé (master.hook.failed)", async () => {
      await setup(new DatedStore()); const h = async () => { throw new Error("rapport impossible"); }; closeHooks.push(h);
      try { await ok(call("cais", "cash.open", { openingFloat: 0 }, A)); const c = await ok(call("cais", "cash.close", { counted: 0 }, A)); expect(c.variance).toBe(0); } finally { closeHooks.splice(closeHooks.indexOf(h), 1); }
      const log = st.rows("audit_log").find((r) => r.action === "master.hook.failed"); expect(log).toBeTruthy(); expect(String(log!.detail)).toContain("rapport impossible");
    });
    it("suivi des recommandations de rapports en échec : le rapport reste valide, l'échec est journalisé (master.reco.failed)", async () => {
      await setup(new FailingRecos()); await st.update("shops", A, { varianceTolerance: 100 }); await ok(call("cais", "cash.open", { openingFloat: 0 }, A)); await ok(call("cais", "cash.close", { counted: 5000 }, A));
      expect(st.rows("md_reports").some((r) => r.type === "closing" && r.status !== "failed")).toBe(true); expect(st.rows("audit_log").some((r) => r.action === "master.reco.failed" && String(r.detail).includes("indisponible"))).toBe(true);
    });
  });
});
