import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatFcfa } from "@/domain/money";
import { isLow, reorderQty } from "@/domain/stock";
import { create, list, stockLevels, type Product } from "@/lib/data";
import { can, useSession } from "@/lib/session";
import { Scanner } from "@/components/Scanner";

export function StockPage() {
  const { session } = useSession(); const s = session!; const qc = useQueryClient();
  const products = useQuery({ queryKey: ["products"], queryFn: () => list<Product>("products", s, [], 500) });
  const levels = useQuery({ queryKey: ["stock"], queryFn: () => stockLevels(s) });
  const [f, setF] = useState({ name: "", barcode: "", price: "", cost: "", minStock: "5", qty: "" });
  const [scan, setScan] = useState(false);
  const add = useMutation({
    mutationFn: async () => {
      const p = await create("products", s, { name: f.name, barcode: f.barcode || undefined, price: Number(f.price), cost: Number(f.cost) || 0, minStock: Number(f.minStock) || 0, archived: false });
      if (Number(f.qty) > 0) await create("stock_moves", s, { productId: p.$id, qty: Number(f.qty), kind: "purchase", refId: "initial", userId: s.userId });
    },
    onSuccess: () => { setF({ name: "", barcode: "", price: "", cost: "", minStock: "5", qty: "" }); void qc.invalidateQueries(); },
  });
  const adjust = useMutation({
    mutationFn: ({ id, qty }: { id: string; qty: number }) => create("stock_moves", s, { productId: id, qty, kind: "adjust", refId: "inventaire", userId: s.userId }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["stock"] }),
  });
  const low = (products.data ?? []).filter((p) => isLow(levels.data?.get(p.$id) ?? 0, p.minStock ?? 0));
  const value = (products.data ?? []).reduce((a, p) => a + (levels.data?.get(p.$id) ?? 0) * (p.cost ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2">
        <div className="card"><div className="text-white/50 text-xs">Valeur du stock</div><div className="font-semibold">{formatFcfa(value)}</div></div>
        <div className="card"><div className="text-white/50 text-xs">Ruptures / alertes</div><div className="font-semibold text-red-400">{low.length}</div></div>
      </div>
      {can(s.role, "stock") && (
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
      <ul className="flex flex-col gap-2">
        {(products.data ?? []).map((p) => {
          const n = levels.data?.get(p.$id) ?? 0;
          return (
            <li key={p.$id} className="card flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium">{p.name}</div>
                <div className="text-xs text-white/50">{formatFcfa(p.price)} · seuil {p.minStock ?? 0}{isLow(n, p.minStock ?? 0) && ` · à commander : ${reorderQty(n, 0, 14) || "à voir"}`}</div>
              </div>
              <div className={`text-lg font-bold ${isLow(n, p.minStock ?? 0) ? "text-red-400" : ""}`}>{n}</div>
              {can(s.role, "stock") && <button className="btn-ghost !px-3 !py-2" onClick={() => { const v = prompt(`Inventaire « ${p.name} » : stock réel ?`); if (v !== null && v !== "" && !Number.isNaN(Number(v))) adjust.mutate({ id: p.$id, qty: Number(v) - n }); }}>Compter</button>}
            </li>
          );
        })}
      </ul>
      {scan && <Scanner onCode={(c) => { setF((x) => ({ ...x, barcode: c })); setScan(false); }} onClose={() => setScan(false)} />}
    </div>
  );
}
