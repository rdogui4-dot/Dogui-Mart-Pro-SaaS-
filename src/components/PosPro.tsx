import { useEffect, useState } from "react";
import { Sparkles, ShieldAlert, Star } from "lucide-react";
import { formatFcfa } from "@/domain/money";

export type Suggest = { items: { productId: string; name: string; reason: string; price: number; stock: number; count: number }[]; quantities: { productId: string; typicalQty: number; reason: string }[]; basedOn: { sales: number; days: number }; note: string };
export type Alert = { level: "block" | "warn"; code: string; message: string };
export type Sim = { ok: true; fp: string; total: number; alerts: Alert[]; needsApproval: { discount: boolean; margin: boolean }; margin: { estimated: number; coveredAmount: number; thresholdPct: number } } | { ok: false; status: number; blocked: string; alerts: Alert[] };
export type ApprovalKind = "discount" | "margin";

const read = <T,>(k: string, fb: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : fb; } catch { return fb; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible : la préférence n'est pas conservée */ } };

/** Favoris du vendeur (raccourcis personnalisés) : préférence locale à l'appareil, par boutique. */
export function useFavorites(shopId: string) {
  const key = `dmp-fav-${shopId}`; const [ids, setIds] = useState<string[]>(() => read<string[]>(key, []));
  const toggle = (id: string) => setIds((cur) => { const n = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-24); write(key, n); return n; });
  return { ids, toggle };
}
export function useDensity() {
  const [d, setD] = useState<"comfort" | "compact">(() => read("dmp-density", "comfort")); return { density: d, toggle: () => setD((c) => { const n = c === "comfort" ? "compact" : "comfort"; write("dmp-density", n); return n; }) };
}
export const FavStar = ({ on, onClick, name }: { on: boolean; onClick: () => void; name: string }) => (
  <span role="button" tabIndex={0} aria-label={`${on ? "Retirer des" : "Ajouter aux"} favoris : ${name}`} aria-pressed={on} className="p-1 -m-1 cursor-pointer" onClick={(e) => { e.stopPropagation(); e.preventDefault(); onClick(); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); e.preventDefault(); onClick(); } }}><Star size={14} className={on ? "fill-[var(--accent)] text-accent-text" : "text-muted"} /></span>
);

/** Suggestions réelles (historique de la boutique) : chaque puce dit sur combien de ventes elle repose. */
export function SuggestStrip({ data, onAdd, hasCart }: { data?: Suggest; onAdd: (productId: string) => void; hasCart: boolean }) {
  if (!data) return null;
  if (!data.items.length) return hasCart ? <p className="text-xs text-muted" role="status">{data.note}</p> : null;
  return (
    <section aria-label="Suggestions" className="flex flex-col gap-1">
      <p className="text-xs text-muted flex items-center gap-1"><Sparkles size={12} />{hasCart ? "Souvent acheté avec ce panier" : "Plus vendus ces 30 jours"} <span className="text-muted">· d'après {data.basedOn.sales} ventes ({data.basedOn.days} j)</span></p>
      <div className="scroll-x">{data.items.map((i) => <button key={i.productId} className="chip" title={i.reason} onClick={() => onAdd(i.productId)}>＋ {i.name} · {formatFcfa(i.price)}</button>)}</div>
      {data.items[0] && <p className="text-xs text-muted">{data.items[0].reason} — indicatif, pas une certitude.</p>}
    </section>
  );
}

/** Simulation avant validation : alertes (bloquantes ou non), marge estimée, demandes d'approbation. */
export function SimPanel({ sim, manager, approvals, pending, onRequest, busy }: { sim?: Sim; manager: boolean; approvals: Partial<Record<ApprovalKind, string>>; pending: Partial<Record<ApprovalKind, string>>; onRequest: (k: ApprovalKind) => void; busy: boolean }) {
  if (!sim) return null;
  const need = sim.ok ? sim.needsApproval : { discount: false, margin: false };
  return (
    <section className="flex flex-col gap-1.5 text-sm" aria-label="Simulation avant validation">
      {sim.alerts.map((a) => <p key={a.code + a.message} role="alert" className={`flex gap-1.5 items-start ${a.level === "block" ? "text-bad" : "text-warn"}`}><ShieldAlert size={14} className="mt-0.5 shrink-0" />{a.message}</p>)}
      {sim.ok && manager && sim.margin.coveredAmount > 0 && <p className="text-xs text-muted">Marge estimée : {formatFcfa(sim.margin.estimated)} ({Math.round((sim.margin.estimated / sim.margin.coveredAmount) * 100)} % du montant dont le coût est connu)</p>}
      {(["margin", "discount"] as const).filter((k) => need[k]).map((k) => (
        <div key={k} className="card !p-2 flex items-center justify-between gap-2 text-xs border border-warn/30">
          <span>{approvals[k] ? "✓ Approbation accordée" : pending[k] ? "En attente de la décision d'un responsable…" : k === "margin" ? "Marge sous le seuil : approbation requise" : "Remise manuelle : approbation requise"}</span>
          {!approvals[k] && !pending[k] && <button className="btn-ghost !py-1 !px-2" disabled={busy} onClick={() => onRequest(k)}>Demander</button>}
        </div>
      ))}
    </section>
  );
}

/** Raccourcis clavier de la caisse (lecteur de codes-barres USB, clavier) : F2 recherche, F4 encaisser, F8 vider le panier. */
export function useShortcuts(map: Record<string, () => void>) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { const f = map[e.key]; if (f && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); f(); } };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  });
}
