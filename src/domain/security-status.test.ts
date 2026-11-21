import { describe, expect, it } from "vitest";
import { UNMEASURED, evaluateStatus, scoreOf, type StatusInput } from "./security-status";

const NOW = "2026-11-21T12:00:00.000Z"; const ago = (h: number) => new Date(Date.parse(NOW) - h * 3_600_000).toISOString();
const NONE: StatusInput = { now: NOW, owners: null, subscription: null, host: null, journal: null, chain: null };
const get = (i: StatusInput, id: string) => evaluateStatus(i).find((c) => c.id === id)!;

describe("états de sécurité — règle de base : sans mesure, « inconnu » (jamais « ok »)", () => {
  it("aucune donnée : tous les contrôles sont inconnus, aucune heure de mesure, aucun score", () => {
    const checks = evaluateStatus(NONE); expect(checks.every((c) => c.state === "unknown" || c.state === "na")).toBe(true); expect(checks.some((c) => c.state === "ok")).toBe(false);
    expect(checks.every((c) => c.measuredAt === null)).toBe(true); const sc = scoreOf(checks); expect(sc.score).toBeNull(); expect(sc.coverage).toBe(0);
  });
  it("chaque contrôle porte sa preuve, sa source et un poids ; pas deux fois le même identifiant", () => {
    const checks = evaluateStatus(NONE); expect(new Set(checks.map((c) => c.id)).size).toBe(checks.length); for (const c of checks) { expect(c.evidence.length).toBeGreaterThan(5); expect(c.source.length).toBeGreaterThan(2); expect(c.weight).toBeGreaterThan(0); }
  });
  it("la limite de l'application est dite : réglages Appwrite et sauvegardes cloud ne sont jamais présentés comme mesurés", () => { expect(UNMEASURED.length).toBeGreaterThanOrEqual(3); expect(UNMEASURED.join(" ")).toMatch(/sessions/); });
});

describe("double authentification des propriétaires", () => {
  it("tous protégés : ok ; un seul non protégé : à surveiller avec conseil ; lecture impossible : inconnu", () => {
    expect(get({ ...NONE, owners: [{ userId: "a", mfa: true }] }, "mfa_owner").state).toBe("ok");
    const w = get({ ...NONE, owners: [{ userId: "a", mfa: true }, { userId: "b", mfa: false }] }, "mfa_owner"); expect(w.state).toBe("watch"); expect(w.advice).toBeTruthy(); expect(w.evidence).toContain("1 propriétaire");
    expect(get({ ...NONE, owners: [{ userId: "a", mfa: null }] }, "mfa_owner").state).toBe("unknown"); expect(get({ ...NONE, owners: [] }, "mfa_owner").state).toBe("unknown");
  });
});

describe("abonnement", () => {
  it("actif et essai : ok ; proche de l'échéance ou délai de grâce : à surveiller ; expiré : critique ; illisible : inconnu", () => {
    expect(get({ ...NONE, subscription: { status: "active", renewsAt: "2027-01-01T00:00:00Z" } }, "subscription").state).toBe("ok");
    expect(get({ ...NONE, subscription: { status: "trial", renewsAt: "2026-12-05T00:00:00Z" } }, "subscription").state).toBe("ok");
    expect(get({ ...NONE, subscription: { status: "active", renewsAt: "2026-11-23T12:00:00Z" } }, "subscription").state).toBe("watch");
    expect(get({ ...NONE, subscription: { status: "grace" } }, "subscription").state).toBe("watch");
    expect(get({ ...NONE, subscription: { status: "expired" } }, "subscription").state).toBe("critical"); expect(get(NONE, "subscription").state).toBe("unknown");
  });
});

describe("poste Windows : synchronisation, sauvegardes, constats", () => {
  const station = (o: Partial<NonNullable<StatusInput["station"]>> = {}) => ({ lastSyncOkAt: ago(1), pending: 0, sessionOk: true, openConflicts: 0, alertHours: 24, ...o });
  it("cloud seul (pas de poste) : synchronisation et constats « sans objet » ; poste qui héberge mais non mesuré depuis le cloud : inconnu", () => {
    expect(get({ ...NONE, host: { hosted: false } }, "sync").state).toBe("na"); expect(get({ ...NONE, host: { hosted: false } }, "conflicts").state).toBe("na");
    expect(get({ ...NONE, host: { hosted: true, name: "Caisse" } }, "sync").state).toBe("unknown"); expect(get({ ...NONE, host: null }, "sync").state).toBe("unknown");
  });
  it("synchronisation : récente ok ; au-delà du seuil à surveiller ; au-delà de 3 seuils ou jamais : critique ; session expirée : à surveiller", () => {
    const h = { hosted: true, name: "Caisse" }; const st = (s: ReturnType<typeof station>) => get({ ...NONE, host: h, station: s }, "sync").state;
    expect(st(station())).toBe("ok"); expect(st(station({ lastSyncOkAt: ago(30) }))).toBe("watch"); expect(st(station({ lastSyncOkAt: ago(80) }))).toBe("critical"); expect(st(station({ lastSyncOkAt: null }))).toBe("critical"); expect(st(station({ sessionOk: false }))).toBe("watch");
  });
  it("constats : aucun = ok, sinon à surveiller", () => {
    const h = { hosted: true }; expect(get({ ...NONE, host: h, station: station() }, "conflicts").state).toBe("ok"); expect(get({ ...NONE, host: h, station: station({ openConflicts: 2 }) }, "conflicts").state).toBe("watch");
  });
  it("sauvegardes : sans sonde (cloud) = inconnu ; aucune = critique ; récente = ok ; > 48 h ou copie externe en échec = à surveiller ; > 7 jours = critique", () => {
    const b = (o: Partial<NonNullable<StatusInput["backups"]>>) => get({ ...NONE, backups: { lastOkAt: ago(5), hasBackups: true, externalError: null, ...o } }, "backups").state;
    expect(get(NONE, "backups").state).toBe("unknown"); expect(b({})).toBe("ok"); expect(b({ hasBackups: false, lastOkAt: null })).toBe("critical"); expect(b({ lastOkAt: ago(60) })).toBe("watch"); expect(b({ externalError: "clé absente" })).toBe("watch"); expect(b({ lastOkAt: ago(24 * 9) })).toBe("critical");
  });
});

describe("journal de sécurité", () => {
  const chainOk = { ok: true, checked: 12, problems: [], fromStart: true };
  it("refus : peu = ok, 20 et plus = à surveiller, 100 et plus = critique ; journal illisible = inconnu", () => {
    const d = (n: number) => get({ ...NONE, journal: { denied24h: n, total: 50 }, chain: chainOk }, "denials").state; expect(d(3)).toBe("ok"); expect(d(20)).toBe("watch"); expect(d(100)).toBe("critical"); expect(get(NONE, "denials").state).toBe("unknown");
  });
  it("chaîne : intacte = ok ; rompue = critique avec la cause ; journal vide = inconnu (rien à vérifier, pas « ok »)", () => {
    expect(get({ ...NONE, journal: { denied24h: 0, total: 12 }, chain: chainOk }, "journal_chain").state).toBe("ok");
    const k = get({ ...NONE, journal: { denied24h: 0, total: 12 }, chain: { ok: false, checked: 11, problems: ["rupture : n°5 absent"], fromStart: true } }, "journal_chain"); expect(k.state).toBe("critical"); expect(k.evidence).toContain("n°5");
    expect(get({ ...NONE, journal: { denied24h: 0, total: 0 }, chain: { ok: true, checked: 0, problems: [], fromStart: true } }, "journal_chain").state).toBe("unknown");
  });
});

describe("score : règles visibles", () => {
  it("moyenne pondérée des seuls contrôles mesurés (ok 100 %, à surveiller 50 %, critique 0) ; couverture = part du poids mesurée", () => {
    const checks = evaluateStatus({ ...NONE, owners: [{ userId: "a", mfa: true }], subscription: { status: "active", renewsAt: "2027-01-01T00:00:00Z" }, host: { hosted: false }, journal: { denied24h: 0, total: 3 }, chain: { ok: true, checked: 3, problems: [], fromStart: true } });
    const sc = scoreOf(checks); expect(sc.score).toBe(100); expect(sc.unknown).toBe(1); expect(sc.coverage).toBeLessThan(100); expect(sc.coverage).toBeGreaterThan(50);
    const w = scoreOf(evaluateStatus({ ...NONE, owners: [{ userId: "a", mfa: false }], subscription: { status: "active", renewsAt: "2027-01-01T00:00:00Z" } })); expect(w.score).toBe(Math.round(((20 * 0.5 + 10) / 30) * 100));
  });
  it("un contrôle critique fait baisser le score ; « sans objet » ne compte pas", () => {
    const checks = evaluateStatus({ ...NONE, subscription: { status: "expired" }, host: { hosted: false } }); expect(scoreOf(checks).score).toBe(0); expect(scoreOf(checks).total).toBe(checks.filter((c) => c.state !== "na").length);
  });
});
