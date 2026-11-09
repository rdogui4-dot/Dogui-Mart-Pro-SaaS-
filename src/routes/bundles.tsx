import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Query } from "@/lib/appwrite";
import { api } from "@/lib/api";
import { list, listAll, stockLevels, type Product, type Row } from "@/lib/data";
import type { ArticleRow } from "@/lib/articles";
import { useSession } from "@/lib/session";
import { Sheet } from "@/components/ui";
import { MAX_COMPONENTS, bundleAvailable } from "@/domain/bundles";
import { formatQty } from "@/domain/quantity";
import { trackingOf } from "@/domain/tracking";

type CompRow = Row<{ bundleId: string; componentId: string; qty: number }>;
export const useComponents = (bundleId: string) => {
  const { session } = useSession(); const s = session!;
  return useQuery({ queryKey: ["components", bundleId], queryFn: () => list<CompRow>("article_components", s, [Query.equal("bundleId", bundleId)], 50) });
};

/** Composition d'un bundle (Pro) : quels articles et en quelle quantité sortent du stock à chaque vente. */
export function BundleSheet({ a, canManage, onClose, onChanged }: { a: ArticleRow; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const { session } = useSession(); const s = session!;
  const comps = useComponents(a.$id);
  const prods = useQuery({ queryKey: ["products-all", s.shopId], queryFn: () => listAll<Product>("products", s) });
  const levels = useQuery({ queryKey: ["stock"], queryFn: () => stockLevels(s) });
  const [rows, setRows] = useState<{ productId: string; qty: string }[] | null>(null); const [err, setErr] = useState("");
  const current = rows ?? (comps.data ?? []).map((c) => ({ productId: c.componentId, qty: String(c.qty) }));
  const eligible = (prods.data ?? []).filter((p) => !p.archived && p.kind !== "bundle" && !trackingOf(p) && !p.hasVariants && (p.qtyScale ?? 0) === 0 && p.$id !== a.$id);
  const name = (id: string) => prods.data?.find((p) => p.$id === id)?.name ?? "Article";
  const stock = (id: string) => levels.data?.get(id) ?? 0;
  const avail = bundleAvailable(current.filter((r) => Number(r.qty) >= 1).map((r) => ({ productId: r.productId, qty: Number(r.qty) })), stock);
  const save = useMutation({
    mutationFn: () => api(s, "bundle.components", { bundleId: a.$id, components: current.map((r) => ({ productId: r.productId, qty: r.qty })) }),
    onSuccess: () => { setErr(""); setRows(null); void comps.refetch(); onChanged(); onClose(); },
    onError: (e) => setErr((e as Error).message),
  });
  const set = (i: number, p: Partial<{ productId: string; qty: string }>) => setRows(current.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const valid = current.length > 0 && current.every((r) => r.productId && /^\d+$/.test(r.qty) && Number(r.qty) >= 1) && new Set(current.map((r) => r.productId)).size === current.length;
  return (
    <Sheet title={`Composition · ${a.name}`} onClose={onClose} back>
      <p className="text-sm text-white/60">Un bundle n'a pas de stock propre : chaque vente retire ses composants du stock. Disponible maintenant : <b>{formatQty(avail)}</b>.</p>
      {current.map((r, i) => (
        <div key={i} className="card flex flex-col gap-2">
          {canManage ? <div className="grid grid-cols-[1fr_4.5rem_auto] gap-2 items-center">
            <select className="input !px-2" aria-label="Composant" value={r.productId} onChange={(e) => set(i, { productId: e.target.value })}><option value="">Article…</option>{eligible.map((p) => <option key={p.$id} value={p.$id}>{p.name}</option>)}{r.productId && !eligible.some((p) => p.$id === r.productId) && <option value={r.productId}>{name(r.productId)}</option>}</select>
            <input className="input !px-2" inputMode="numeric" aria-label="Quantité" placeholder="Qté" value={r.qty} onChange={(e) => set(i, { qty: e.target.value })} />
            <button type="button" className="btn-ghost !p-2" aria-label="Retirer" onClick={() => setRows(current.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
          </div> : <div className="flex justify-between"><span>{name(r.productId)}</span><b>× {r.qty}</b></div>}
          {r.productId && <p className="text-xs text-white/50">En stock : {formatQty(stock(r.productId))} → {formatQty(Math.floor(stock(r.productId) / Math.max(1, Number(r.qty) || 1)))} bundle(s)</p>}
        </div>
      ))}
      {!current.length && <p className="text-center text-white/50 text-sm py-3">Aucun composant : le bundle ne peut pas encore être vendu.</p>}
      {canManage && <button className="btn-ghost flex items-center justify-center gap-2" disabled={current.length >= MAX_COMPONENTS} onClick={() => setRows([...current, { productId: "", qty: "1" }])}><Plus size={16} />Ajouter un composant</button>}
      {err && <p className="text-red-400 text-sm" role="alert">{err}</p>}
      {canManage && <button className="btn" disabled={save.isPending || !valid} onClick={() => save.mutate()}>{save.isPending ? "Enregistrement…" : "Enregistrer la composition"}</button>}
      {!canManage && <p className="text-xs text-amber-300">Composition en lecture seule (formule Business) : vos données sont conservées ; la vente du bundle revient avec Pro.</p>}
    </Sheet>
  );
}
