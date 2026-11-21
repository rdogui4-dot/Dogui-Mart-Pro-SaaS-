import { randomBytes, createHash } from "node:crypto";
import { EVENT_KINDS, GENESIS, cleanTarget, eventHash, isEventKind, verifyChain, type ChainRow, type EventKind, type EventSource, type Outcome } from "../../../src/domain/security-events";
import { HttpError, roleOf, type Ctx, type Store } from "./store";

/** Commerce « virtuel » qui porte les événements de la plateforme et ceux d'un appelant sans commerce : visibles du seul administrateur de la plateforme. */
export const PLATFORM_JOURNAL = "platform";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const newRequestId = () => randomBytes(6).toString("hex");

export type SecurityEventInput = { tenantId: string; kind: EventKind; outcome: Outcome; actorId?: string; actorRole?: string; target?: string; requestId?: string; source: EventSource; /** regroupe les répétitions : un seul événement par clé et par fenêtre (voir `throttle`) */ throttleKey?: string };

const headId = (tenantId: string) => `sh${tenantId}`.slice(0, 36);
const eventId = (tenantId: string, seq: number) => `se${sha(`${tenantId}|${seq}`).slice(0, 30)}`;

// Regroupement : une rafale de refus ne remplit ni le journal ni la base. Premier événement de la fenêtre écrit ; les suivants ne font que compter en mémoire, et le compteur est
// reporté dans la ligne aux seuils 10, 100, 1000, 10000 (le compteur n'entre pas dans l'empreinte).
const WINDOW_MS = 60_000; const COUNT_MARKS = new Set([10, 100, 1000, 10_000]);
const seen = new Map<string, { n: number; id: string }>();
export const _resetThrottle = () => seen.clear();

/** Écrit un événement dans la chaîne du commerce. **Ne lève jamais** : un défaut du journal ne doit pas faire échouer l'opération d'origine (l'erreur est écrite dans la console du serveur). */
export async function recordSecurityEvent(store: Store, ev: SecurityEventInput): Promise<string | null> {
  try {
    if (!isEventKind(ev.kind)) throw new Error(`Événement inconnu : ${String(ev.kind)}`);
    const def = EVENT_KINDS[ev.kind]; const tenantId = def.scope === "platform" ? PLATFORM_JOURNAL : ev.tenantId;
    if (!tenantId || !/^[A-Za-z0-9_-]{1,36}$/.test(tenantId)) throw new Error("Commerce invalide pour le journal");
    let key = ""; if (ev.throttleKey) {
      const bucket = Math.floor(Date.now() / WINDOW_MS); key = `${tenantId}|${ev.kind}|${ev.throttleKey}|${bucket}`;
      if (seen.size > 5000) for (const k of seen.keys()) if (!k.endsWith(`|${bucket}`)) seen.delete(k);
      const cur = seen.get(key); if (cur) { cur.n++; if (COUNT_MARKS.has(cur.n) && cur.id) await store.update("security_events", cur.id, { count: cur.n, lastAt: new Date().toISOString() }).catch(() => undefined); return cur.id || null; }
      seen.set(key, { n: 1, id: "" });
    }
    const id = await append(store, tenantId, def.severity, ev); if (key && id) seen.get(key)!.id = id; return id;
  } catch (e) { console.error("journal de sécurité", (e as Error).message); return null; }
}

async function append(store: Store, tenantId: string, severity: string, ev: SecurityEventInput): Promise<string | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const head = await store.get("security_heads", headId(tenantId)); const seq = head ? Number(head.seq) + 1 : 1; const prev = head ? String(head.hash) : GENESIS; const at = new Date().toISOString();
    const f = { tenantId, seq, at, kind: ev.kind, severity, outcome: ev.outcome, actorId: (ev.actorId ?? "").slice(0, 64), actorRole: (ev.actorRole ?? "").slice(0, 24), target: (ev.target ?? "").slice(0, 80), requestId: (ev.requestId ?? "").slice(0, 24), source: ev.source };
    const hash = eventHash(prev, f); const id = eventId(tenantId, seq);
    try {
      await store.batch([{ kind: "create", table: "security_events", id, tenantId, data: { ...f, count: 1, lastAt: at, prevHash: prev, hash } },
        head ? { kind: "update", table: "security_heads", id: headId(tenantId), data: { seq, hash } } : { kind: "create", table: "security_heads", id: headId(tenantId), tenantId, data: { tenantId, seq, hash } }]);
      return id;
    } catch (e) { if (e instanceof HttpError && e.status === 409 || /\b409\b|already exists|existe déjà/i.test(String((e as Error).message))) continue; throw e; } // un autre écrivain a pris ce numéro : on relit la tête et on réessaie
  }
  throw new Error("Chaîne occupée : événement non enregistré");
}

export { cleanTarget };

/** Lecture réservée au propriétaire du commerce (ou à l'administrateur de la plateforme pour le journal de la plateforme). */
export async function securityEvents(store: Store, ctx: Ctx, b: { limit?: number; kind?: string; scope?: "tenant" | "platform" } = {}) {
  const platform = b.scope === "platform";
  if (platform ? !ctx.admin : roleOf(ctx.roles) !== "owner") throw new HttpError(403, platform ? "Réservé à l'administrateur de la plateforme" : "Réservé au propriétaire du commerce");
  const tenantId = platform ? PLATFORM_JOURNAL : ctx.tenantId; const limit = Math.min(Math.max(Math.trunc(Number(b.limit) || 100), 1), 500);
  const [{ rows, truncated }, head] = await Promise.all([store.scan("security_events", { tenantId }, { maxRows: 5000 }), store.get("security_heads", headId(tenantId))]);
  const mine = rows.filter((r) => r.tenantId === tenantId); // la lecture est déjà filtrée par commerce ; contrôle redondant volontaire
  const toRow = (r: Record<string, unknown>): ChainRow => ({ tenantId: String(r.tenantId), seq: Number(r.seq), at: String(r.at), kind: String(r.kind), severity: String(r.severity), outcome: String(r.outcome), actorId: String(r.actorId ?? ""), actorRole: String(r.actorRole ?? ""), target: String(r.target ?? ""), requestId: String(r.requestId ?? ""), source: String(r.source ?? ""), prevHash: String(r.prevHash), hash: String(r.hash) });
  const chain = verifyChain(mine.map(toRow), head ? { seq: Number(head.seq), hash: String(head.hash) } : null);
  const kindOk = isEventKind(b.kind) ? b.kind : null;
  const events = mine.filter((r) => !kindOk || r.kind === kindOk).sort((a, c) => Number(c.seq) - Number(a.seq)).slice(0, limit)
    .map((r) => ({ seq: Number(r.seq), at: String(r.at), kind: String(r.kind), label: isEventKind(r.kind) ? EVENT_KINDS[r.kind].label : String(r.kind), severity: String(r.severity), outcome: String(r.outcome), actorId: String(r.actorId ?? ""), actorRole: String(r.actorRole ?? ""), target: String(r.target ?? ""), requestId: String(r.requestId ?? ""), source: String(r.source ?? ""), count: Number(r.count ?? 1), lastAt: String(r.lastAt ?? r.at) }));
  return { events, chain: { ok: chain.ok, checked: chain.checked, fromStart: chain.fromStart && !truncated, problems: chain.problems.slice(0, 20) }, total: head ? Number(head.seq) : 0, truncated };
}
