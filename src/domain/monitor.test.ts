import { describe, expect, it } from "vitest";
import { GRACE_MIN, decide, issueIdOf, issueTitle, nextAnchor, silentMonitor, type Observation } from "./monitor";

const NOW = "2026-11-22T12:00:00.000Z"; const SHA = "a".repeat(40); const ago = (m: number) => new Date(Date.parse(NOW) - m * 60_000).toISOString();
const healthy = (): Observation => ({ at: NOW, api: { reachable: true, latencyMs: 400, version: SHA, journalSeq: 5 }, hooks: { reachable: true, latencyMs: 300, version: SHA, journalSeq: 5 }, site: { reachable: true, status: 200, csp: true, version: SHA }, tls: [{ host: "a.example", daysLeft: 60 }], deploy: { latestSuccessSha: SHA, latestSuccessAt: ago(300), inProgressSince: null }, previousSeq: 5 });
const ids = (o: Observation) => decide(o).map((a) => a.id);

describe("moniteur : décision", () => {
  it("tout va bien : aucune alerte", () => { expect(decide(healthy())).toEqual([]); });
  it("coupure : fonction injoignable = critique, avec la cause ; base muette (la fonction répond mais pas la base) = alerte distincte", () => {
    const o = healthy(); o.api = { reachable: false, error: "ENOTFOUND" }; const a = decide(o).find((x) => x.id === "api_down")!; expect(a.severity).toBe("critical"); expect(a.detail).toContain("ENOTFOUND");
    const p = healthy(); p.hooks = { reachable: true, latencyMs: 100, version: SHA, journalSeq: null }; expect(ids(p)).toEqual(["hooks_db_down"]);
    const s = healthy(); s.api = { reachable: true, latencyMs: 12_000, version: SHA, journalSeq: 5 }; expect(ids(s)).toEqual(["api_slow"]); expect(decide(s)[0]!.severity).toBe("warning");
  });
  it("site : indisponible ou statut anormal = critique ; CSP disparue = critique", () => {
    const a = healthy(); a.site = { reachable: false, error: "ECONNRESET" }; expect(ids(a)).toContain("site_down"); const b = healthy(); b.site = { reachable: true, status: 503 }; expect(ids(b)).toContain("site_down");
    const c = healthy(); c.site = { reachable: true, status: 200, csp: false, version: SHA }; expect(ids(c)).toEqual(["site_no_csp"]);
  });
  it("dérive : une version différente de la version publiée est critique, par composant ; la bonne version ne déclenche rien", () => {
    const o = healthy(); o.api.version = "b".repeat(40); o.site.version = "dev"; expect(ids(o).sort()).toEqual(["drift_api", "drift_site"]); expect(decide(o)[0]!.detail).toContain(SHA.slice(0, 12));
  });
  it("dérive : tolérance pendant un déploiement en cours et juste après un déploiement réussi (propagation), pas au-delà", () => {
    const mid = healthy(); mid.api.version = "b".repeat(40); mid.deploy = { latestSuccessSha: SHA, latestSuccessAt: ago(300), inProgressSince: ago(5) }; expect(ids(mid)).toEqual([]);
    const stuck = healthy(); stuck.api.version = "b".repeat(40); stuck.deploy = { latestSuccessSha: SHA, latestSuccessAt: ago(300), inProgressSince: ago(GRACE_MIN + 5) }; expect(ids(stuck)).toEqual(["drift_api"]);
    const fresh = healthy(); fresh.site.version = "c".repeat(40); fresh.deploy = { latestSuccessSha: SHA, latestSuccessAt: ago(3), inProgressSince: null }; expect(ids(fresh)).toEqual([]);
    const later = healthy(); later.site.version = "c".repeat(40); later.deploy = { latestSuccessSha: SHA, latestSuccessAt: ago(GRACE_MIN + 1), inProgressSince: null }; expect(ids(later)).toEqual(["drift_site"]);
  });
  it("dérive : une fonction injoignable n'est pas aussi déclarée « en dérive » (une seule alerte : la coupure)", () => { const o = healthy(); o.api = { reachable: false, error: "x" }; expect(ids(o)).toEqual(["api_down"]); });
  it("dernier déploiement introuvable : avertissement (jamais « tout va bien » sans comparaison)", () => { const o = healthy(); o.deploy = null; expect(ids(o)).toEqual(["deploy_unknown"]); const p = healthy(); p.deploy = { latestSuccessSha: null, latestSuccessAt: null, inProgressSince: null }; expect(ids(p)).toEqual(["deploy_unknown"]); });
  it("certificats : plus de 14 jours = rien ; moins = avertissement ; moins de 3 jours = critique ; illisible = avertissement", () => {
    const t = (d: number | null) => { const o = healthy(); o.tls = [{ host: "x.example", daysLeft: d }]; return decide(o); };
    expect(t(15)).toEqual([]); expect(t(13)[0]).toMatchObject({ id: "tls_x.example", severity: "warning" }); expect(t(2)[0]!.severity).toBe("critical"); expect(t(-1)[0]!.severity).toBe("critical"); expect(t(null)[0]).toMatchObject({ id: "tls_unknown_x.example", severity: "warning" });
  });
  it("ancre du journal : un numéro qui recule est critique ; croissance ou égalité = rien ; premier relevé = rien", () => {
    const back = healthy(); back.api.journalSeq = 3; back.hooks.journalSeq = 3; expect(ids(back)).toEqual(["journal_rewind"]);
    const up = healthy(); up.api.journalSeq = 9; up.hooks.journalSeq = 9; expect(ids(up)).toEqual([]); const first = healthy(); first.previousSeq = null; expect(ids(first)).toEqual([]);
  });
  it("les deux fonctions ne lisent pas le même journal : avertissement", () => { const o = healthy(); o.hooks.journalSeq = 4; o.previousSeq = 4; expect(ids(o)).toEqual(["journal_mismatch"]); });
  it("ancre mémorisée : jamais en dessous du précédent relevé (un recul reste visible tant qu'il n'est pas réinitialisé par un humain)", () => {
    const o = healthy(); o.api.journalSeq = 9; o.hooks.journalSeq = 9; expect(nextAnchor(o)).toBe(9); o.api.journalSeq = 2; o.hooks.journalSeq = 2; o.previousSeq = 9; expect(nextAnchor(o)).toBe(9);
    const n = healthy(); n.api = { reachable: false }; n.hooks = { reachable: false }; n.previousSeq = null; expect(nextAnchor(n)).toBeNull();
  });
  it("tickets : titre stable par alerte ; simulation distinguée ; titres étrangers ignorés", () => {
    expect(issueTitle("api_down")).toBe("[Alerte sécurité] api_down"); expect(issueTitle("api_down", true)).toBe("[SIMULATION] [Alerte sécurité] api_down");
    expect(issueIdOf("[Alerte sécurité] drift_api")).toEqual({ id: "drift_api", simulation: false }); expect(issueIdOf("[SIMULATION] [Alerte sécurité] x")).toEqual({ id: "x", simulation: true }); expect(issueIdOf("Autre ticket")).toBeNull();
  });
});

describe("bilan : moniteur muet", () => {
  it("environ 4 exécutions par heure : normal = rien ; moins de la moitié = critique ; aucune = critique", () => {
    expect(silentMonitor(670, 168)).toBeNull(); expect(silentMonitor(340, 168)).toBeNull(); expect(silentMonitor(300, 168)).toMatchObject({ id: "moniteur_muet", severity: "critical" }); expect(silentMonitor(0, 168)!.detail).toContain("0 exécution");
    expect(silentMonitor(2, 1)).toBeNull(); expect(silentMonitor(0, 1)).not.toBeNull();
  });
});
