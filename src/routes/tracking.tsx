import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Ban, Plus, ScanLine, Trash2, Undo2 } from "lucide-react";
import { DATABASE_ID, Query, tables } from "@/lib/appwrite";
import { api } from "@/lib/api";
import { list, type Row } from "@/lib/data";
import type { ArticleRow } from "@/lib/articles";
import { useSession } from "@/lib/session";
import { Scanner } from "@/components/Scanner";
import { Confirm, Sheet } from "@/components/ui";
import { formatFcfa } from "@/domain/money";
import { formatQty, fromScaled, scaleOf } from "@/domain/quantity";
import { EXPIRY_WARN_DAYS, SERIAL_TRANSITIONS, daysUntil, expiryState, parseSerials, serialStatusLabel, type SerialStatus } from "@/domain/tracking";

export type LotRow = Row<{ productId: string; variantId?: string; lotNo: string; expiresAt?: string | null; manufacturedAt?: string | null; receivedAt?: string; status?: string; unitCost?: number; supplierId?: string }>;
export type SerialRow = Row<{ productId: string; variantId?: string; serial: string; status: string; receivedAt?: string; soldAt?: string; saleRef?: string; warrantyMonths?: number; warrantyUntil?: string | null; unitCost?: number }>;
export const todayStr = () => new Date().toISOString().slice(0, 10);

/** Lots d'un article avec leur stock (somme des mouvements portant ce lot). */
export function useLots(productId: string) {
  const { session } = useSession(); const s = session!;
  return useQuery({
    queryKey: ["lots", productId],
    queryFn: async () => {
      const lots = await list<LotRow>("article_lots", s, [Query.equal("productId", productId)], 500);
      const by = new Map<string, number>(); let cursor: string | undefined;
      for (;;) {
        const page = (await tables.listRows({ databaseId: DATABASE_ID, tableId: "stock_moves", queries: [Query.equal("tenantId", s.tenantId), Query.equal("shopId", s.shopId), Query.equal("productId", productId), Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])] })).rows as unknown as Row<{ lotId?: string; qty: number; kind: string }>[];
        for (const m of page) if (m.lotId) { const d = m.kind === "adjust" ? Number(m.qty) : (["sale", "loss", "transfer_out"].includes(m.kind) ? -1 : 1) * Math.abs(Number(m.qty)); by.set(m.lotId, (by.get(m.lotId) ?? 0) + d); }
        if (page.length < 100) break; cursor = page[page.length - 1]!.$id;
      }
      return lots.map((l) => ({ lot: l, scaled: by.get(l.$id) ?? 0 }));
    },
  });
}

const STATE_UI = { expired: ["Périmé", "text-red-300"], soon: ["Bientôt périmé", "text-amber-300"], ok: ["Valide", "text-emerald-300"], none: ["Sans date", "text-white/50"] } as const;

/** Gestion des lots (Pro) : stock par lot trié par péremption (FEFO), entrée, blocage, mise au rebut. */
export function LotsSheet({ a, canManage, onClose, onChanged }: { a: ArticleRow; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const { session } = useSession(); const s = session!; const scale = scaleOf(a);
  const q = useLots(a.$id); const today = todayStr();
  const [entry, setEntry] = useState(false); const [err, setErr] = useState("");
  const [off, setOff] = useState<null | { lot: LotRow; max: number }>(null); const [offQty, setOffQty] = useState(""); const [offWhy, setOffWhy] = useState("");
  const reqId = useRef(crypto.randomUUID()); const [f, setF] = useState({ lotNo: "", qty: "", expiresAt: "", unitCost: "" });
  const rows = [...(q.data ?? [])].sort((x, y) => (x.lot.expiresAt ? 0 : 1) - (y.lot.expiresAt ? 0 : 1) || String(x.lot.expiresAt ?? "").localeCompare(String(y.lot.expiresAt ?? "")));
  const refresh = () => { void q.refetch(); onChanged(); };
  const save = useMutation({
    mutationFn: () => api(s, "lot.receive", { requestId: reqId.current, productId: a.$id, lotNo: f.lotNo, qty: f.qty.trim(), ...(f.expiresAt ? { expiresAt: f.expiresAt } : {}), ...(f.unitCost ? { unitCost: f.unitCost.replace(/\s/g, "") } : {}) }),
    onSuccess: () => { setEntry(false); setErr(""); setF({ lotNo: "", qty: "", expiresAt: "", unitCost: "" }); reqId.current = crypto.randomUUID(); refresh(); },
    onError: (e) => setErr((e as Error).message),
  });
  const block = useMutation({ mutationFn: (l: LotRow) => api(s, "lot.update", { id: l.$id, status: l.status === "blocked" ? "active" : "blocked" }), onSuccess: () => { setErr(""); refresh(); }, onError: (e) => setErr((e as Error).message) });
  const writeOff = useMutation({
    mutationFn: () => api(s, "lot.writeoff", { lotId: off!.lot.$id, requestId: reqId.current, qty: offQty.trim(), reason: offWhy }),
    onSuccess: () => { setOff(null); setOffQty(""); setOffWhy(""); setErr(""); reqId.current = crypto.randomUUID(); refresh(); },
    onError: (e) => setErr((e as Error).message),
  });
  return (
    <Sheet title={`Lots · ${a.name}`} onClose={onClose} back>
      <p className="text-sm text-white/60">La vente prélève d'abord le lot qui expire le plus tôt (FEFO). Alerte à {EXPIRY_WARN_DAYS} jours de la péremption.</p>
      {canManage && <button className="btn flex items-center justify-center gap-2" onClick={() => setEntry(true)}><Plus size={18} />Entrée dans un lot</button>}
      {err && <p className="text-red-400 text-sm" role="alert">{err}</p>}
      {!q.isLoading && rows.length === 0 && <p className="text-center text-white/50 text-sm py-4">Aucun lot. Une réception ou une entrée de stock en crée.</p>}
      {rows.map(({ lot, scaled }) => {
        const st = expiryState(lot.expiresAt ?? null, today); const [lab, tone] = STATE_UI[st]; const n = fromScaled(scaled, scale); const blocked = lot.status === "blocked";
        return (
          <div key={lot.$id} className={`card flex flex-col gap-1 ${n <= 0 ? "opacity-60" : ""}`}>
            <div className="flex justify-between gap-2"><b className="truncate">Lot {lot.lotNo}</b><span className="font-bold">{formatQty(n)}</span></div>
            <div className="text-xs flex gap-2 flex-wrap"><span className={tone}>{lab}{lot.expiresAt ? ` · ${String(lot.expiresAt).slice(0, 10)}${st !== "none" ? ` (${daysUntil(String(lot.expiresAt), today) >= 0 ? `dans ${daysUntil(String(lot.expiresAt), today)} j` : `il y a ${-daysUntil(String(lot.expiresAt), today)} j`})` : ""}` : ""}</span>{blocked && <b className="text-red-300">Bloqué</b>}{!!lot.unitCost && <span className="text-white/50">coût {formatFcfa(lot.unitCost)}</span>}</div>
            {canManage && (
              <div className="flex gap-2 flex-wrap text-sm pt-1">
                <button className="btn-ghost !py-2 flex items-center gap-1" disabled={block.isPending} onClick={() => block.mutate(lot)}>{blocked ? <><Undo2 size={14} />Débloquer</> : <><Ban size={14} />Bloquer</>}</button>
                {n > 0 && <button className="btn-ghost !py-2 !text-red-300 flex items-center gap-1" onClick={() => { setOff({ lot, max: n }); setOffQty(String(n).replace(".", ",")); setOffWhy(st === "expired" ? "Périmé" : ""); }}><Trash2 size={14} />Mettre au rebut</button>}
              </div>
            )}
          </div>
        );
      })}
      {entry && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-end justify-center p-4"><form className="card w-full max-w-sm flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <b>Entrée dans un lot</b>
          <input className="input" placeholder="N° de lot *" required maxLength={40} value={f.lotNo} onChange={(e) => setF({ ...f, lotNo: e.target.value })} />
          <input className="input" inputMode="decimal" placeholder="Quantité *" required value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
          <label className="text-xs text-white/60">Date de péremption<input className="input mt-1" type="date" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} /></label>
          <input className="input" inputMode="numeric" placeholder="Coût unitaire (FCFA, facultatif)" value={f.unitCost} onChange={(e) => setF({ ...f, unitCost: e.target.value })} />
          {err && <p className="text-red-400 text-sm" role="alert">{err}</p>}
          <div className="flex gap-2"><button type="button" className="btn-ghost flex-1" onClick={() => { setEntry(false); setErr(""); }}>Annuler</button><button className="btn flex-1" disabled={save.isPending || !f.lotNo.trim() || !f.qty.trim()}>Enregistrer</button></div>
        </form></div>
      )}
      {off && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-end justify-center p-4"><div className="card w-full max-w-sm flex flex-col gap-2">
          <b>Mise au rebut · lot {off.lot.lotNo}</b>
          <input className="input" inputMode="decimal" aria-label="Quantité à retirer" value={offQty} onChange={(e) => setOffQty(e.target.value)} />
          <input className="input" placeholder="Motif (périmé, cassé…)" maxLength={200} value={offWhy} onChange={(e) => setOffWhy(e.target.value)} />
          <p className="text-xs text-white/50">Sortie de stock tracée (perte) avec le motif. Disponible : {formatQty(off.max)}.</p>
          {err && <p className="text-red-400 text-sm" role="alert">{err}</p>}
          <div className="flex gap-2"><button className="btn-ghost flex-1" onClick={() => { setOff(null); setErr(""); }}>Annuler</button><button className="btn flex-1" disabled={writeOff.isPending || !offQty.trim() || !offWhy.trim()} onClick={() => writeOff.mutate()}>Retirer</button></div>
        </div></div>
      )}
    </Sheet>
  );
}

/** Numéros de série d'un article : liste filtrable, ajout (saisie ou scan), changement de statut (retour, garantie, défectueux). */
export function SerialsSheet({ a, canManage, onClose, onChanged }: { a: ArticleRow; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const { session } = useSession(); const s = session!;
  const q = useQuery({ queryKey: ["serials", a.$id], queryFn: () => list<SerialRow>("article_serials", s, [Query.equal("productId", a.$id)], 500) });
  const [find, setFind] = useState(""); const [adding, setAdding] = useState(false); const [scan, setScan] = useState(false); const [err, setErr] = useState("");
  const [txt, setTxt] = useState(""); const [months, setMonths] = useState("12"); const [cost, setCost] = useState(""); const reqId = useRef(crypto.randomUUID());
  const [ask, setAsk] = useState<null | { r: SerialRow; to: SerialStatus }>(null);
  const refresh = () => { void q.refetch(); onChanged(); };
  let parsed: string[] = []; let parseErr = ""; try { parsed = txt.trim() ? parseSerials(txt) : []; } catch (e) { parseErr = (e as Error).message; }
  const add = useMutation({
    mutationFn: () => api<{ count: number }>(s, "serial.add", { requestId: reqId.current, productId: a.$id, serials: txt, warrantyMonths: months || 0, ...(cost ? { unitCost: cost.replace(/\s/g, "") } : {}) }),
    onSuccess: () => { setAdding(false); setTxt(""); setErr(""); reqId.current = crypto.randomUUID(); refresh(); },
    onError: (e) => setErr((e as Error).message),
  });
  const setStatus = useMutation({ mutationFn: (v: { r: SerialRow; to: SerialStatus }) => api(s, "serial.status", { id: v.r.$id, status: v.to }), onSuccess: () => { setAsk(null); setErr(""); refresh(); }, onError: (e) => { setAsk(null); setErr((e as Error).message); } });
  const rows = (q.data ?? []).filter((r) => !find.trim() || r.serial.includes(find.trim().toUpperCase())).sort((x, y) => x.serial.localeCompare(y.serial));
  const count = (st: string) => (q.data ?? []).filter((r) => r.status === st).length;
  const today = todayStr();
  return (
    <Sheet title={`Numéros de série · ${a.name}`} onClose={onClose} back>
      <p className="text-sm text-white/60">{count("available")} disponible(s) · {count("sold")} vendu(s) · {count("warranty") + count("returned") + count("defective")} autre(s).</p>
      <input className="input" placeholder="Rechercher un numéro" value={find} onChange={(e) => setFind(e.target.value)} />
      {canManage && <button className="btn flex items-center justify-center gap-2" onClick={() => setAdding(true)}><Plus size={18} />Ajouter des numéros</button>}
      {err && <p className="text-red-400 text-sm" role="alert">{err}</p>}
      {!q.isLoading && rows.length === 0 && <p className="text-center text-white/50 text-sm py-4">Aucun numéro de série.</p>}
      {rows.map((r) => {
        const next = SERIAL_TRANSITIONS[r.status as SerialStatus] ?? [];
        const under = r.warrantyUntil ? String(r.warrantyUntil).slice(0, 10) >= today : false;
        return (
          <div key={r.$id} className="card flex flex-col gap-1">
            <div className="flex justify-between gap-2"><b className="truncate">{r.serial}</b><span className={`text-sm ${r.status === "available" ? "text-emerald-300" : r.status === "defective" ? "text-red-300" : "text-white/60"}`}>{serialStatusLabel(r.status)}</span></div>
            <div className="text-xs text-white/50">{r.saleRef ? `Vente ${r.saleRef}` : "En stock"}{r.warrantyUntil ? ` · garantie ${under ? "jusqu'au" : "expirée le"} ${String(r.warrantyUntil).slice(0, 10)}` : r.warrantyMonths ? ` · garantie ${r.warrantyMonths} mois` : ""}</div>
            {canManage && next.length > 0 && <div className="flex gap-2 flex-wrap text-sm pt-1">{next.map((to) => <button key={to} className="btn-ghost !py-2" onClick={() => setAsk({ r, to })}>{serialStatusLabel(to)}</button>)}</div>}
          </div>
        );
      })}
      {ask && <Confirm text={`Passer le numéro ${ask.r.serial} de « ${serialStatusLabel(ask.r.status)} » à « ${serialStatusLabel(ask.to)} » ?`} confirmLabel="Confirmer" onNo={() => setAsk(null)} onYes={() => setStatus.mutate(ask)} />}
      {adding && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-end justify-center p-4"><form className="card w-full max-w-sm flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <b>Ajouter des numéros de série</b>
          <div className="flex gap-2"><textarea className="input flex-1" rows={4} placeholder="Un numéro par ligne (ou séparés par espace / virgule)" value={txt} onChange={(e) => setTxt(e.target.value)} /><button type="button" className="btn-ghost self-start" aria-label="Scanner" onClick={() => setScan(true)}><ScanLine size={20} /></button></div>
          <p className={`text-xs ${parseErr ? "text-red-300" : "text-white/50"}`}>{parseErr || `${parsed.length} numéro(s) reconnu(s).`}</p>
          <div className="grid grid-cols-2 gap-2"><input className="input" inputMode="numeric" aria-label="Garantie (mois)" placeholder="Garantie (mois)" value={months} onChange={(e) => setMonths(e.target.value)} /><input className="input" inputMode="numeric" placeholder="Coût unitaire" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
          {err && <p className="text-red-400 text-sm" role="alert">{err}</p>}
          <div className="flex gap-2"><button type="button" className="btn-ghost flex-1" onClick={() => { setAdding(false); setErr(""); }}>Annuler</button><button className="btn flex-1" disabled={add.isPending || !parsed.length || !!parseErr}>Enregistrer</button></div>
        </form></div>
      )}
      {scan && <Scanner onCode={(c) => { setTxt((t) => (t.trim() ? `${t.trim()}\n${c}` : c)); setScan(false); }} onClose={() => setScan(false)} />}
    </Sheet>
  );
}

/** Alertes de péremption de la boutique : lots en stock périmés ou proches de leur date. */
export function useExpiryAlerts(enabled: boolean) {
  const { session } = useSession(); const s = session!;
  return useQuery({
    queryKey: ["expiry-alerts", s.shopId], enabled, staleTime: 60_000,
    queryFn: async () => {
      const today = todayStr(); const lots = (await list<LotRow>("article_lots", s, [Query.isNotNull("expiresAt")], 500)).filter((l) => expiryState(l.expiresAt ?? null, today) !== "ok" && l.status !== "archived");
      if (!lots.length) return [] as { lot: LotRow; name: string; qty: number; state: "soon" | "expired" }[];
      const prods = await list<{ name: string; qtyScale?: number }>("products", s, [], 500); const by = new Map<string, number>();
      for (const id of new Set(lots.map((l) => l.productId))) {
        let cursor: string | undefined;
        for (;;) {
          const page = (await tables.listRows({ databaseId: DATABASE_ID, tableId: "stock_moves", queries: [Query.equal("tenantId", s.tenantId), Query.equal("shopId", s.shopId), Query.equal("productId", id), Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])] })).rows as unknown as Row<{ lotId?: string; qty: number; kind: string }>[];
          for (const m of page) if (m.lotId) { const d = m.kind === "adjust" ? Number(m.qty) : (["sale", "loss", "transfer_out"].includes(m.kind) ? -1 : 1) * Math.abs(Number(m.qty)); by.set(m.lotId, (by.get(m.lotId) ?? 0) + d); }
          if (page.length < 100) break; cursor = page[page.length - 1]!.$id;
        }
      }
      return lots.flatMap((l) => { const p = prods.find((x) => x.$id === l.productId); const n = fromScaled(by.get(l.$id) ?? 0, p?.qtyScale ?? 0); return n > 0 ? [{ lot: l, name: p?.name ?? "Article", qty: n, state: expiryState(l.expiresAt ?? null, today) as "soon" | "expired" }] : []; }).sort((x, y) => String(x.lot.expiresAt).localeCompare(String(y.lot.expiresAt)));
    },
  });
}
export function ExpiryAlerts() {
  const q = useExpiryAlerts(true); const today = todayStr();
  if (!q.data?.length) return null;
  return (
    <section className="card flex flex-col gap-1" aria-label="Alertes de péremption">
      <h2 className="font-semibold flex items-center gap-2"><AlertTriangle size={16} className="text-amber-300" />Péremptions ({q.data.length})</h2>
      {q.data.slice(0, 10).map(({ lot, name, qty, state }) => <div key={lot.$id} className="flex justify-between gap-2 text-sm"><span className="truncate">{name} · lot {lot.lotNo}</span><span className={`text-right shrink-0 ${state === "expired" ? "text-red-300" : "text-amber-300"}`}>{formatQty(qty)} · {state === "expired" ? "périmé" : `${daysUntil(String(lot.expiresAt), today)} j`}</span></div>)}
    </section>
  );
}
