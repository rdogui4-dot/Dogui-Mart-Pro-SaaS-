import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatFcfa } from "@/domain/money";
import { formatQty } from "@/domain/quantity";
import { isLow, reorderQty } from "@/domain/stock";
import { list, listAll, qtyOf, stockLevels, variantQty, type Product, type VariantRow } from "@/lib/data";
import { api } from "@/lib/api";
import { can, useSession } from "@/lib/session";
import { Scanner } from "@/components/Scanner";
import { ScanLine } from "lucide-react";
import { Sheet } from "@/components/ui";
import { unitLabel } from "@/domain/articles";
import { useRef } from "react";
import { planAllows } from "@/domain/features";
import { ExpiryAlerts, LotsSheet, SerialsSheet } from "./tracking";
import { trackingOf } from "@/domain/tracking";
import { isVirtualBundle } from "@/domain/bundles";
import type { ArticleRow } from "@/lib/articles";
import { useSubscription } from "./subscription";

export function StockPage() {
  const { session } = useSession(); const s = session!; const qc = useQueryClient();
  const products = useQuery({ queryKey: ["products"], queryFn: () => list<Product>("products", s, [], 500) });
  const levels = useQuery({ queryKey: ["stock"], queryFn: () => stockLevels(s) });
  const variants = useQuery({ queryKey: ["variants-stock", s.shopId], queryFn: () => listAll<VariantRow>("article_variants", s) });
  const [scan, setScan] = useState(false); const [q, setQ] = useState(""); const [pick, setPick] = useState<(Product & { $id: string }) | null>(null);
  const adjust = useMutation({
    mutationFn: ({ id, counted }: { id: string; counted: string }) => api(s, "stock.adjust", { productId: id, counted }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["stock"] }),
  });
  const sub = useSubscription(); const [track, setTrack] = useState<Product & { $id: string } | null>(null);
  const openStock = (p: Product & { $id: string }) => { if (trackingOf(p)) setTrack(p); else if (p.hasVariants) alert("Cet article a des variantes : comptez chaque variante depuis l'écran Articles."); else setPick(p); };
  const shown = (products.data ?? []).filter((p) => !p.archived && !isVirtualBundle(p) && (!q.trim() || [p.name, p.sku, p.barcode].some((x) => String(x ?? "").toLowerCase().includes(q.trim().toLowerCase()))));
  const low = (products.data ?? []).filter((p) => !isVirtualBundle(p) && isLow(qtyOf(levels.data, p), p.minStock ?? 0));
  const value = (products.data ?? []).filter((p) => !p.hasVariants && !isVirtualBundle(p)).reduce((a, p) => a + qtyOf(levels.data, p) * (p.cost ?? 0), 0) + (variants.data ?? []).filter((v) => !v.archived).reduce((a, v) => a + variantQty(levels.data, v, products.data?.find((p) => p.$id === v.productId)?.qtyScale ?? 0) * (v.cost ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      {track && (trackingOf(track) === "lot" ? <LotsSheet a={track as unknown as ArticleRow} canManage={planAllows(sub.data?.entitlement.plan.id, "lots")} onClose={() => setTrack(null)} onChanged={() => void qc.invalidateQueries()} /> : <SerialsSheet a={track as unknown as ArticleRow} canManage={planAllows(sub.data?.entitlement.plan.id, "serials")} onClose={() => setTrack(null)} onChanged={() => void qc.invalidateQueries()} />)}
      {planAllows(sub.data?.entitlement.plan.id, "lots") && <ExpiryAlerts />}
      <div className="grid grid-cols-2 gap-2">
        <div className="card"><div className="text-white/50 text-xs">Valeur du stock</div><div className="font-semibold">{formatFcfa(value)}</div></div>
        <div className="card"><div className="text-white/50 text-xs">Ruptures / alertes</div><div className="font-semibold text-red-400">{low.length}</div></div>
      </div>
      <div className="flex gap-2">
        <input className="input" placeholder="Rechercher un article (nom, référence, code-barres)" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn" aria-label="Scanner" onClick={() => setScan(true)}><ScanLine /></button>
      </div>
      <p className="text-xs text-white/50">Touchez un article pour ajuster son stock. Pour créer un article, utilisez l'écran Articles.</p>
      {s.shops.length > 1 && can(s, "stock") && <Transfer products={(products.data ?? []).filter((p) => p.kind !== "bundle")} variants={variants.data ?? []} levels={levels.data} onDone={() => void qc.invalidateQueries()} />}
      <ul className="flex flex-col gap-2">
        {shown.map((p) => {
          const n = qtyOf(levels.data, p);
          return (
            <li key={p.$id} className="card flex items-center justify-between gap-2 cursor-pointer active:scale-[.99]" onClick={() => can(s, "stock") && openStock(p as Product & { $id: string })}>
              <div className="min-w-0">
                <div className="truncate font-medium">{p.name}</div>
                <div className="text-xs text-white/50">{formatFcfa(p.price)} · seuil {p.minStock ?? 0}{isLow(n, p.minStock ?? 0) && ` · à commander : ${reorderQty(n, 0, 14) || "à voir"}`}</div>
              </div>
              <div className={`text-lg font-bold ${isLow(n, p.minStock ?? 0) ? "text-red-400" : ""}`}>{formatQty(n)}</div>
              {can(s, "stock") && <span className="text-[var(--gold)] text-sm">Ajuster</span>}
            </li>
          );
        })}
      </ul>
      {scan && <Scanner onCode={(c) => { const hit = (products.data ?? []).find((p) => !p.archived && (p.barcode === c || p.sku === c)); setScan(false); if (hit) openStock(hit as Product & { $id: string }); else setQ(c); }} onClose={() => setScan(false)} />}
      {pick && <CountSheet p={pick} n={qtyOf(levels.data, pick)} busy={adjust.isPending} error={adjust.error ? (adjust.error as Error).message : ""} onClose={() => { setPick(null); adjust.reset(); }} onCount={(counted) => adjust.mutate({ id: pick.$id, counted }, { onSuccess: () => setPick(null) })} />}
    </div>
  );
}

/** Inventaire d'un article simple : l'écart avec le stock enregistré devient un mouvement tracé. */
function CountSheet({ p, n, busy, error, onClose, onCount }: { p: Product & { $id: string }; n: number; busy: boolean; error: string; onClose: () => void; onCount: (counted: string) => void }) {
  const [v, setV] = useState(String(n).replace(".", ","));
  return (
    <Sheet title={p.name} onClose={onClose} back>
      <div className="card text-sm">Stock enregistré : <b>{formatQty(n)}</b>{(p.unit ?? "piece") !== "piece" ? ` ${unitLabel(p.unit).toLowerCase()}` : ""}</div>
      <label className="flex flex-col gap-1 text-sm"><span className="text-white/60">Quantité réellement comptée</span><input className="input" inputMode="decimal" autoFocus value={v} onChange={(e) => setV(e.target.value)} /></label>
      <p className="text-xs text-white/50">L'écart sera enregistré comme mouvement d'inventaire (historique conservé).</p>
      {error && <p className="text-red-400 text-sm" role="alert">{error}</p>}
      <button className="btn" disabled={busy || !/^\d+([.,]\d{1,3})?$/.test(v.trim())} onClick={() => onCount(v.trim())}>Valider l'inventaire</button>
    </Sheet>
  );
}

function Transfer({ products, variants, levels, onDone }: { products: { $id: string; name: string; qtyScale?: number; hasVariants?: boolean; tracking?: string }[]; variants: VariantRow[]; levels?: Map<string, number>; onDone: () => void }) {
  const { session } = useSession(); const s = session!;
  const transferId = useRef(crypto.randomUUID()); // même identifiant à chaque nouvel essai : jamais deux transferts
  const [open, setOpen] = useState(false); const [to, setTo] = useState("");
  const [rows, setRows] = useState([{ productId: "", qty: "", serials: "" }]); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const targets = s.shops.filter((x) => x.id !== s.shopId);
  const set = (i: number, p: Partial<(typeof rows)[number]>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg("");
    try {
      const r = await api<{ number: string }>(s, "stock.transfer", { transferId: transferId.current, toShopId: to, lines: rows.filter((x) => x.productId).map((x) => { const [productId, variantId] = x.productId.split(":"); return { productId, ...(variantId ? { variantId } : {}), qty: x.qty, ...(x.serials.trim() ? { serials: x.serials } : {}) }; }) });
      transferId.current = crypto.randomUUID(); setRows([{ productId: "", qty: "", serials: "" }]); setMsg(`Transfert ${r.number} effectué`); onDone();
    } catch (x) { setMsg((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="card flex flex-col gap-2">
      <button className="btn-ghost" onClick={() => setOpen(!open)}>{open ? "Fermer" : "Transférer vers une autre boutique"}</button>
      {open && (
        <form className="flex flex-col gap-2" onSubmit={submit}>
          <select className="input" required value={to} onChange={(e) => setTo(e.target.value)}><option value="">Boutique de destination…</option>{targets.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_5rem] gap-1">
              <select className="input !px-2" value={r.productId} onChange={(e) => set(i, { productId: e.target.value })}><option value="">Produit…</option>{products.flatMap((p) => p.hasVariants ? variants.filter((v) => v.productId === p.$id && !v.archived).map((v) => <option key={v.$id} value={`${p.$id}:${v.$id}`}>{p.name} — {v.label} ({formatQty(variantQty(levels, v, p.qtyScale ?? 0))})</option>) : [<option key={p.$id} value={p.$id}>{p.name} ({formatQty(qtyOf(levels, p))})</option>])}</select>
              <input className="input !px-2" inputMode="decimal" placeholder="Qté" value={r.qty} onChange={(e) => set(i, { qty: e.target.value })} />
              {(() => { const mode = products.find((p) => p.$id === r.productId.split(":")[0])?.tracking; return mode === "lot" ? <p className="col-span-2 text-xs text-white/50">Lots prélevés automatiquement, les plus proches de la péremption d'abord ; ils sont recréés à l'identique (numéro, péremption, coût) dans la boutique de destination.</p> : mode === "serial" ? <textarea className="input col-span-2" rows={2} placeholder="Numéros de série à transférer (facultatif : sinon les plus anciens disponibles)" aria-label="Numéros de série à transférer" value={r.serials} onChange={(e) => set(i, { serials: e.target.value })} /> : null; })()}
            </div>
          ))}
          <button type="button" className="btn-ghost" onClick={() => setRows([...rows, { productId: "", qty: "", serials: "" }])}>+ Ligne</button>
          <button className="btn" disabled={busy || !to}>Transférer</button>
        </form>
      )}
      {msg && <p className="text-sm text-amber-300">{msg}</p>}
    </div>
  );
}
