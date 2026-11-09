import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatFcfa } from "@/domain/money";
import { formatQty } from "@/domain/quantity";
import { isLow, reorderQty } from "@/domain/stock";
import { list, listAll, qtyOf, saveEntity, stockLevels, variantQty, type Product, type VariantRow } from "@/lib/data";
import { api } from "@/lib/api";
import { can, useSession } from "@/lib/session";
import { Scanner } from "@/components/Scanner";
import { useRef } from "react";
import { planAllows } from "@/domain/features";
import { ExpiryAlerts } from "./tracking";
import { useSubscription } from "./subscription";

export function StockPage() {
  const { session } = useSession(); const s = session!; const qc = useQueryClient();
  const products = useQuery({ queryKey: ["products"], queryFn: () => list<Product>("products", s, [], 500) });
  const levels = useQuery({ queryKey: ["stock"], queryFn: () => stockLevels(s) });
  const variants = useQuery({ queryKey: ["variants-stock", s.shopId], queryFn: () => listAll<VariantRow>("article_variants", s) });
  const [f, setF] = useState({ name: "", barcode: "", price: "", cost: "", minStock: "5", qty: "" });
  const [scan, setScan] = useState(false);
  const add = useMutation({
    mutationFn: async () => {
      const p = await saveEntity(s, "products", { name: f.name, barcode: f.barcode || undefined, price: Number(f.price), cost: Number(f.cost) || 0, minStock: Number(f.minStock) || 0, archived: false });
      if (Number(f.qty) > 0) await api(s, "stock.adjust", { productId: p.id, counted: Number(f.qty) });
    },
    onSuccess: () => { setF({ name: "", barcode: "", price: "", cost: "", minStock: "5", qty: "" }); void qc.invalidateQueries(); },
  });
  const adjust = useMutation({
    mutationFn: ({ id, counted }: { id: string; counted: string }) => api(s, "stock.adjust", { productId: id, counted }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["stock"] }),
  });
  const sub = useSubscription();
  const low = (products.data ?? []).filter((p) => isLow(qtyOf(levels.data, p), p.minStock ?? 0));
  const value = (products.data ?? []).filter((p) => !p.hasVariants).reduce((a, p) => a + qtyOf(levels.data, p) * (p.cost ?? 0), 0) + (variants.data ?? []).filter((v) => !v.archived).reduce((a, v) => a + variantQty(levels.data, v, products.data?.find((p) => p.$id === v.productId)?.qtyScale ?? 0) * (v.cost ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      {planAllows(sub.data?.entitlement.plan.id, "lots") && <ExpiryAlerts />}
      <div className="grid grid-cols-2 gap-2">
        <div className="card"><div className="text-white/50 text-xs">Valeur du stock</div><div className="font-semibold">{formatFcfa(value)}</div></div>
        <div className="card"><div className="text-white/50 text-xs">Ruptures / alertes</div><div className="font-semibold text-red-400">{low.length}</div></div>
      </div>
      {can(s, "stock") && (
        <form className="card flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <h2 className="font-semibold">Nouveau produit</h2>
          <input className="input" placeholder="Nom" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <div className="flex gap-2">
            <input className="input" placeholder="Code-barres" value={f.barcode} onChange={(e) => setF({ ...f, barcode: e.target.value })} />
            <button type="button" className="btn-ghost" onClick={() => setScan(true)}>Scan</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input className="input" inputMode="numeric" placeholder="Prix de vente" required value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
            <input className="input" inputMode="numeric" placeholder="Prix d'achat" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} />
            <input className="input" inputMode="numeric" placeholder="Stock initial" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
            <input className="input" inputMode="numeric" placeholder="Seuil d'alerte" value={f.minStock} onChange={(e) => setF({ ...f, minStock: e.target.value })} />
          </div>
          <button className="btn" disabled={add.isPending}>Ajouter</button>
          {add.error && <p className="text-red-400 text-sm">{(add.error as Error).message}</p>}
        </form>
      )}
      {s.shops.length > 1 && can(s, "stock") && <Transfer products={products.data ?? []} variants={variants.data ?? []} levels={levels.data} onDone={() => void qc.invalidateQueries()} />}
      <ul className="flex flex-col gap-2">
        {(products.data ?? []).map((p) => {
          const n = qtyOf(levels.data, p);
          return (
            <li key={p.$id} className="card flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium">{p.name}</div>
                <div className="text-xs text-white/50">{formatFcfa(p.price)} · seuil {p.minStock ?? 0}{isLow(n, p.minStock ?? 0) && ` · à commander : ${reorderQty(n, 0, 14) || "à voir"}`}</div>
              </div>
              <div className={`text-lg font-bold ${isLow(n, p.minStock ?? 0) ? "text-red-400" : ""}`}>{formatQty(n)}</div>
              {can(s, "stock") && <button className="btn-ghost !px-3 !py-2" onClick={() => { if (p.hasVariants) { alert("Cet article a des variantes : comptez chaque variante depuis l'écran Articles."); return; } const v = prompt(`Inventaire « ${p.name} » : stock réel ?`); if (v !== null && v !== "" && !Number.isNaN(Number(v.replace(",", ".")))) adjust.mutate({ id: p.$id, counted: v }); }}>Compter</button>}
            </li>
          );
        })}
      </ul>
      {scan && <Scanner onCode={(c) => { setF((x) => ({ ...x, barcode: c })); setScan(false); }} onClose={() => setScan(false)} />}
    </div>
  );
}

function Transfer({ products, variants, levels, onDone }: { products: { $id: string; name: string; qtyScale?: number; hasVariants?: boolean }[]; variants: VariantRow[]; levels?: Map<string, number>; onDone: () => void }) {
  const { session } = useSession(); const s = session!;
  const transferId = useRef(crypto.randomUUID()); // même identifiant à chaque nouvel essai : jamais deux transferts
  const [open, setOpen] = useState(false); const [to, setTo] = useState("");
  const [rows, setRows] = useState([{ productId: "", qty: "" }]); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const targets = s.shops.filter((x) => x.id !== s.shopId);
  const set = (i: number, p: Partial<(typeof rows)[number]>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg("");
    try {
      const r = await api<{ number: string }>(s, "stock.transfer", { transferId: transferId.current, toShopId: to, lines: rows.filter((x) => x.productId).map((x) => { const [productId, variantId] = x.productId.split(":"); return { productId, ...(variantId ? { variantId } : {}), qty: x.qty }; }) });
      transferId.current = crypto.randomUUID(); setRows([{ productId: "", qty: "" }]); setMsg(`Transfert ${r.number} effectué`); onDone();
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
            </div>
          ))}
          <button type="button" className="btn-ghost" onClick={() => setRows([...rows, { productId: "", qty: "" }])}>+ Ligne</button>
          <button className="btn" disabled={busy || !to}>Transférer</button>
        </form>
      )}
      {msg && <p className="text-sm text-amber-300">{msg}</p>}
    </div>
  );
}
