import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { BUILD } from "./health";
import { _resetThrottle, recordSecurityEvent } from "./security-log";

let st: MemoryStore;
const ping = (user?: string) => handle(st, user, { action: "health.ping" }, { cloud: true });
beforeEach(() => { _resetThrottle(); st = new MemoryStore(); });

describe("sonde de santé (health.ping)", () => {
  it("répond SANS identité : version, date de construction, heure, ancre du journal — et rien d'autre", async () => {
    const r = await ping(); expect(r.status).toBe(200); const d = (r.body as any).data;
    expect(Object.keys(d).sort()).toEqual(["at", "builtAt", "journal", "ok", "version"]); expect(d.ok).toBe(true); expect(d.version).toBe(BUILD.sha); expect(Date.parse(d.at)).not.toBeNaN(); expect(d.journal).toEqual({ seq: 0 });
  });
  it("aucune donnée de commerce ni de compte : la réponse ne contient ni identifiant d'équipe, ni boutique, ni utilisateur, même quand la base en contient", async () => {
    await st.grant("tenantheal001", "own", ["owner"], []); await handle(st, "own", { action: "shop.create", tenantId: "tenantheal001", shopId: "", payload: { name: "Boutique Secrète" } }, { cloud: true });
    const txt = JSON.stringify(((await ping()).body as any).data); expect(txt).not.toMatch(/tenantheal001|Secrète|own\b|email|@/);
  });
  it("ancre : le numéro suit le journal de la plateforme et ne recule jamais (croissance normale)", async () => {
    const seq = async () => ((await ping()).body as any).data.journal.seq as number; expect(await seq()).toBe(0);
    await recordSecurityEvent(st, { tenantId: "", kind: "hook.rejected", outcome: "denied", source: "cloud" }); expect(await seq()).toBe(1);
    await recordSecurityEvent(st, { tenantId: "", kind: "hook.accepted", outcome: "accepted", source: "cloud" }); expect(await seq()).toBe(2);
  });
  it("ne ment pas quand la base ne répond pas : la fonction répond, l'ancre est « null » (pas « 0 »)", async () => {
    (st as any).get = async () => { throw new Error("base indisponible"); }; const d = ((await ping()).body as any).data; expect(d.ok).toBe(true); expect(d.journal).toBeNull();
  });
  it("n'écrit rien (ni ligne, ni événement) : un appel répété ne remplit ni la base ni le journal", async () => {
    for (let i = 0; i < 20; i++) await ping(); expect(st.rows("security_events").length).toBe(0); expect(st.rows("security_heads").length).toBe(0); expect(st.rows("audit_log").length).toBe(0);
  });
  it("elle est la seule action publique ajoutée : les autres actions exigent toujours une identité (401)", async () => {
    for (const action of ["security.status", "security.events", "staff.create", "sales.list", "platform.me"]) expect((await handle(st, undefined, { action, tenantId: "t", shopId: "s", payload: {} }, { cloud: true })).status, action).toBe(401);
  });
  it("même avec une identité elle fonctionne (le poste Windows l'utilise aussi) et ne demande ni commerce ni boutique", async () => { expect((await ping("quelquun")).status).toBe(200); });
});
