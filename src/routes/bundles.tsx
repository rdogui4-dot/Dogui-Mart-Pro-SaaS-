import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Archive, Camera, Image as ImageIcon, Lock, Plus, Trash2, Undo2 } from "lucide-react";
import { api } from "@/lib/api";
import { Query } from "@/lib/appwrite";
import { list, listAll, qtyOf, variantQty, type Product, type Row, type VariantRow } from "@/lib/data";
import { can, useSession } from "@/lib/session";
import { Confirm, Sheet, Thumb } from "@/components/ui";
import { compressImage, useArticleImage } from "@/lib/articles";
import { MAX_COMPONENTS, bundleAvailable, isKit } from "@/domain/bundles";
import { planAllows } from "@/domain/features";
import { formatFcfa } from "@/domain/money";
import { marginOf, sellsAtLoss } from "@/domain/articles";
import { formatQty, fromScaled } from "@/domain/quantity";
import { trackingOf } from "@/domain/tracking";
import { useSubscription } from "./subscription";
import { useStockLevels } from "@/lib/queries";

type CompRow = Row<{ bundleId: string; componentId: string; variantId?: string; qty: number }>;
type Draft = { key: string; qty: string }; // key = « articleId » ou « articleId:varianteId »
const splitKey = (k: string): { productId: string; variantId?: string } => { const [productId = "", variantId] = k.split(":"); return { productId, ...(variantId ? { variantId } : {}) }; };
/** Quantité lisible d'un composant (stockée en sous-unités de l'article). */
const readableQty = (c: { componentId: string; qty: number }, products?: Row<Product>[]): number => fromScaled(c.qty, products?.find((p) => p.$id === c.componentId)?.qtyScale ?? 0);

/** Module Bundles (Pro) : packs d'articles vendus à un prix propre ; chaque vente retire les composants du stock. */
export function BundlesPage() {
  const { session } = useSession(); const s = session!; const qc = useQueryClient();
  const sub = useSubscription(); const pro = planAllows(sub.data?.entitlement.plan.id, "bundles"); const canManage = pro && can(s, "stock");
  const prods = useQuery({ queryKey: ["products-all", s.shopId], queryFn: () => listAll<Product>("products", s) });
  const comps = useQuery({ queryKey: ["components-all", s.shopId], queryFn: () => list<CompRow>("article_components", s, [], 500) });
  const levels = useStockLevels();
  const variants = useQuery({ queryKey: ["variants-all-b", s.shopId], queryFn: () => listAll<VariantRow>("article_variants", s) });
  const [edit, setEdit] = useState<Row<Product> | "new" | null>(null); const [q, setQ] = useState("");
  const bundles = (prods.data ?? []).filter((p) => p.kind === "bundle" && (!q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()))).sort((a, b) => Number(!!a.archived) - Number(!!b.archived) || a.name.localeCompare(b.name, "fr"));
  const compsOf = (id: string) => (comps.data ?? []).filter((c) => c.bundleId === id);
  const name = (id: string, vid?: string) => { const n = prods.data?.find((p) => p.$id === id)?.name ?? "Article"; const v = vid ? variants.data?.find((x) => x.$id === vid)?.label : ""; return v ? `${n} — ${v}` : n; };
  const refresh = () => void qc.invalidateQueries();
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">Bundles</h1>
      <p className="text-sm text-muted">Un bundle est un pack d'articles vendu à son propre prix. Il n'a pas de stock : chaque vente retire ses composants du stock.</p>
      {!pro && <div className="card flex flex-col gap-2 text-sm"><span className="flex items-center gap-2 font-semibold"><Lock size={16} className="text-accent-text" />Réservé à la formule Pro</span><span className="text-muted">Vos bundles existants restent visibles ; leur création, leur modification et leur vente reviennent avec Pro.</span><button className="btn !py-2" onClick={() => window.location.assign(`${import.meta.env.BASE_URL}reglages?onglet=abonnement&formule=pro`)}>Passer à Pro</button></div>}
      {canManage && <button className="btn flex items-center justify-center gap-2" onClick={() => setEdit("new")}><Plus size={18} />Nouveau bundle</button>}
      {(prods.data ?? []).some((p) => p.kind === "bundle") && <input aria-label="Rechercher un bundle" className="input" placeholder="Rechercher un bundle" value={q} onChange={(e) => setQ(e.target.value)} />}
      {prods.isLoading && <p className="text-muted text-sm">Chargement…</p>}
      {!prods.isLoading && bundles.length === 0 && <p className="text-center text-muted text-sm py-6">{q ? "Aucun résultat." : "Aucun bundle."}</p>}
      <ul className="flex flex-col gap-2">
        {bundles.map((b) => {
          const cs = compsOf(b.$id); const n = qtyOf(levels.data, b);
          return (
            <li key={b.$id}><button className={`card w-full text-left flex flex-col gap-1 ${b.archived ? "opacity-60" : ""}`} onClick={() => setEdit(b)}>
              <div className="flex gap-3 items-center"><Thumb id={b.imageFileId} size={56} /><div className="min-w-0 flex-1 flex flex-col gap-1"><div className="flex justify-between gap-2"><b className="truncate">{b.name}</b><span className="text-accent-text font-bold">{formatFcfa(b.price)}</span></div>
              <div className="text-xs text-muted truncate">{cs.length ? cs.map((c) => `${formatQty(readableQty(c, prods.data))}× ${name(c.componentId, c.variantId)}`).join(" + ") : "Aucun composant"}</div>
              <div className="flex gap-2 text-xs flex-wrap"><span className={`rounded-full px-2 py-0.5 ${n <= 0 ? "bg-bad-bg text-bad" : "bg-subtle text-soft"}`}>{isKit(b) ? `${formatQty(n)} en stock` : `${formatQty(n)} disponible${n > 1 ? "s" : ""}`}</span><span className="rounded-full px-2 py-0.5 bg-subtle text-soft">{isKit(b) ? "Kit physique" : "Virtuel"}</span>{b.archived && <span className="text-warn">Archivé</span>}{!cs.length && <span className="text-warn">{isKit(b) ? "Non assemblable" : "Non vendable"}</span>}</div></div></div>
            </button></li>
          );
        })}
      </ul>
      {edit && <BundleEditor initial={edit === "new" ? null : edit} comps={edit === "new" ? [] : compsOf(edit.$id)} products={prods.data ?? []} variants={variants.data ?? []} levels={levels.data} canManage={canManage} onClose={() => setEdit(null)} onSaved={refresh} />}
    </div>
  );
}

function BundleEditor({ initial, comps, products, variants, levels, canManage, onClose, onSaved }: { initial: Row<Product> | null; comps: CompRow[]; products: Row<Product>[]; variants: VariantRow[]; levels?: Map<string, number>; canManage: boolean; onClose: () => void; onSaved: () => void }) {
  const { session } = useSession(); const s = session!;
  const requestId = useRef(crypto.randomUUID()); const [bundleId, setBundleId] = useState(initial?.$id ?? "");
  const [f, setF] = useState({ name: initial?.name ?? "", price: initial ? String(initial.price) : "", sku: initial?.sku ?? "", mode: initial?.bundleMode === "kit" ? "kit" : "virtual" });
  const [asm, setAsm] = useState(false); const kit = f.mode === "kit";
  const [rows, setRows] = useState<Draft[]>(comps.length ? comps.map((c) => ({ key: c.variantId ? `${c.componentId}:${c.variantId}` : c.componentId, qty: String(readableQty(c, products)).replace(".", ",") })) : [{ key: "", qty: "1" }]);
  const [photo, setPhoto] = useState<File | null>(null); const [removePhoto, setRemovePhoto] = useState(false); const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => { if (!photo) { setPreview(null); return; } const u = URL.createObjectURL(photo); setPreview(u); return () => URL.revokeObjectURL(u); }, [photo]);
  const existing = useArticleImage(initial?.imageFileId, 400);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [ask, setAsk] = useState<null | "archive" | "restore" | "delete">(null);
  // Tous les articles du commerce peuvent composer un bundle (une variante = une option) ; un kit physique n'accepte pas les articles suivis par lot/série.
  const options = products.filter((p) => !p.archived && p.kind !== "bundle" && !(kit && trackingOf(p))).flatMap((p) => p.hasVariants ? variants.filter((v) => v.productId === p.$id && !v.archived).map((v) => ({ key: `${p.$id}:${v.$id}`, label: `${p.name} — ${v.label}`, tracked: !!trackingOf(p) })) : [{ key: p.$id, label: p.name, tracked: !!trackingOf(p) }]).sort((x, y) => x.label.localeCompare(y.label, "fr"));
  const by = (id: string) => products.find((p) => p.$id === id);
  const labelOf = (k: string) => options.find((o) => o.key === k)?.label ?? (() => { const { productId, variantId } = splitKey(k); const n = by(productId)?.name ?? "Article"; const v = variantId ? variants.find((x) => x.$id === variantId)?.label : ""; return v ? `${n} — ${v}` : n; })();
  const stockOfKey = (k: string): number => { const { productId, variantId } = splitKey(k); const p = by(productId); if (!p) return 0; return variantId ? variantQty(levels, { $id: variantId }, p.qtyScale ?? 0) : qtyOf(levels, p); };
  const unitCostOf = (k: string): number => { const { productId, variantId } = splitKey(k); return Number((variantId ? variants.find((v) => v.$id === variantId)?.cost : by(productId)?.cost) ?? 0); };
  const qtyNum = (t: string) => Number(t.trim().replace(",", "."));
  const qtyOk = (t: string) => /^\d+([.,]\d{1,3})?$/.test(t.trim()) && qtyNum(t) > 0;
  const valid = rows.length > 0 && rows.every((r) => r.key && qtyOk(r.qty)) && new Set(rows.map((r) => r.key)).size === rows.length;
  const avail = valid ? bundleAvailable(rows.map((r) => ({ ...splitKey(r.key), qty: qtyNum(r.qty) })), (id, vid) => stockOfKey(vid ? `${id}:${vid}` : id)) : 0;
  const cost = Math.round(rows.reduce((a, r) => a + unitCostOf(r.key) * (qtyNum(r.qty) || 0), 0)); const price = Number(f.price) || 0; const m = marginOf(price, cost);
  const set = (i: number, p: Partial<Draft>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const ok = f.name.trim() && /^\d+$/.test(f.price.replace(/\s/g, "")) && valid;
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      let id = bundleId;
      const data = { name: f.name, price: f.price.replace(/\s/g, ""), sku: f.sku };
      if (id) await api(s, "article.save", { id, data });
      else { id = (await api<{ id: string }>(s, "article.save", { requestId: requestId.current, data: { ...data, kind: "bundle", bundleMode: f.mode } })).id; setBundleId(id); }
      await api(s, "bundle.components", { bundleId: id, components: rows.map((r) => ({ ...splitKey(r.key), qty: r.qty })) });
      onSaved();
      try { // la photo n'est confirmée qu'après réponse positive du serveur
        if (photo) await api(s, "article.image", { id, data: await compressImage(photo) });
        else if (removePhoto && initial?.imageFileId) await api(s, "article.image", { id, data: null });
      } catch (x) { setErr(`Le bundle est enregistré, mais la photo a échoué : ${(x as Error).message}`); setPhoto(null); onSaved(); return; }
      onSaved(); onClose();
    } catch (x) { setErr((x as Error).message); onSaved(); } finally { setBusy(false); }
  }
  const act = useMutation({
    mutationFn: async (kind: "archive" | "restore" | "delete") => (kind === "delete" ? api(s, "article.delete", { id: bundleId }) : api(s, "article.archive", { id: bundleId, archived: kind === "archive" })),
    onSuccess: () => { setAsk(null); onSaved(); onClose(); }, onError: (e) => { setAsk(null); setErr((e as Error).message); },
  });
  return (
    <Sheet title={initial ? initial.name : "Nouveau bundle"} onClose={onClose} back>
      <form onSubmit={save} className="flex flex-col gap-3">
        {canManage && (
          <div className="flex items-center gap-3">
            {preview ? <img src={preview} alt="Aperçu" className="w-24 h-24 rounded-lg object-cover" /> : removePhoto ? <Thumb size={96} /> : <Thumb id={initial?.imageFileId} size={96} />}
            <div className="flex flex-col gap-2 flex-1">
              <label className="btn-ghost flex items-center justify-center gap-2 cursor-pointer text-sm"><Camera size={18} />Prendre une photo<input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { setPhoto(e.target.files?.[0] ?? null); setRemovePhoto(false); }} /></label>
              <label className="btn-ghost flex items-center justify-center gap-2 cursor-pointer text-sm"><ImageIcon size={18} />Galerie<input type="file" accept="image/*" className="sr-only" onChange={(e) => { setPhoto(e.target.files?.[0] ?? null); setRemovePhoto(false); }} /></label>
              {(photo || (initial?.imageFileId && existing && !removePhoto)) && <button type="button" className="text-xs text-bad text-left" onClick={() => { setPhoto(null); setRemovePhoto(true); }}>Retirer la photo</button>}
            </div>
          </div>
        )}
        {!initial && !bundleId && <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Type de bundle</span><select className="input" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="virtual">Virtuel : les composants sortent du stock à la vente</option><option value="kit">Kit physique : assemblé à l'avance, stock propre</option></select></label>}
        {(initial || bundleId) && <p className="text-xs text-muted">{kit ? "Kit physique : on l'assemble à l'avance (ordre d'assemblage), il a son propre stock." : "Bundle virtuel : pas de stock propre, chaque vente retire les composants."}</p>}
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Nom du bundle *</span><input className="input" required maxLength={160} disabled={!canManage} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Prix de vente (FCFA) *</span><input className="input" inputMode="numeric" required disabled={!canManage} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></label>
          <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Référence</span><input className="input" maxLength={64} disabled={!canManage} placeholder={initial?.sku ? "" : "Automatique"} value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} /></label>
        </div>
        <h3 className="font-semibold">Composition</h3>
        {rows.map((r, i) => (
          <div key={i} className="card flex flex-col gap-1">
            {canManage ? <div className="grid grid-cols-[1fr_4.5rem_auto] gap-2 items-center">
              <select className="input !px-2" aria-label="Composant" value={r.key} onChange={(e) => set(i, { key: e.target.value })}><option value="">Article…</option>{options.map((o) => <option key={o.key} value={o.key}>{o.label}{o.tracked ? " (suivi)" : ""}</option>)}{r.key && !options.some((o) => o.key === r.key) && <option value={r.key}>{labelOf(r.key)}</option>}</select>
              <input className="input !px-2" inputMode="decimal" aria-label="Quantité" placeholder="Qté" value={r.qty} onChange={(e) => set(i, { qty: e.target.value })} />
              <button type="button" className="btn-ghost !p-2" aria-label="Retirer" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
            </div> : <div className="flex justify-between"><span>{labelOf(r.key)}</span><b>× {r.qty}</b></div>}
            {r.key && <p className="text-xs text-muted">En stock : {formatQty(stockOfKey(r.key))} · coût {formatFcfa(unitCostOf(r.key))}</p>}
          </div>
        ))}
        {canManage && <button type="button" className="btn-ghost flex items-center justify-center gap-2" disabled={rows.length >= MAX_COMPONENTS} onClick={() => setRows([...rows, { key: "", qty: "1" }])}><Plus size={16} />Ajouter un composant</button>}
        <div className="card text-sm flex flex-col gap-1">
          <div className="flex justify-between"><span className="text-muted">{kit ? "Assemblables maintenant" : "Disponible maintenant"}</span><b>{formatQty(avail)}</b></div>
          {kit && initial && <div className="flex justify-between"><span className="text-muted">Kits en stock</span><b>{formatQty(qtyOf(levels, initial))}</b></div>}
          <div className="flex justify-between"><span className="text-muted">Coût des composants</span><b>{cost ? formatFcfa(cost) : "—"}</b></div>
          {price > 0 && cost > 0 && <div className="flex justify-between"><span className="text-muted">Marge indicative</span><b>{formatFcfa(m.amount)}{m.pct !== null ? ` (${m.pct} %)` : ""}</b></div>}
        </div>
        {price > 0 && sellsAtLoss(price, cost) && <p className="flex gap-2 text-sm text-warn"><AlertTriangle size={18} />Le prix du bundle est inférieur au coût de ses composants : vente à perte.</p>}
        {err && <p className="text-bad text-sm" role="alert">{err}</p>}
        {canManage ? <button className="btn" disabled={busy || !ok}>{busy ? "Enregistrement…" : initial || bundleId ? "Enregistrer" : "Créer le bundle"}</button> : <p className="text-xs text-warn">Lecture seule (formule Business ou accès insuffisant) : vos données sont conservées.</p>}
      </form>
      {canManage && initial && kit && comps.length > 0 && <button className="btn" onClick={() => setAsm(true)}>Assembler / démonter des kits</button>}
      {asm && initial && <AssemblySheet kit={initial} comps={comps} products={products} variants={variants} levels={levels} onClose={() => setAsm(false)} onDone={onSaved} />}
      {canManage && initial && (
        <div className="flex gap-2 flex-wrap">
          {initial.archived ? <button className="btn-ghost flex items-center gap-2" onClick={() => setAsk("restore")}><Undo2 size={16} />Restaurer</button> : <button className="btn-ghost flex items-center gap-2" onClick={() => setAsk("archive")}><Archive size={16} />Archiver</button>}
          {(s.role === "owner" || s.role === "manager") && <button className="btn-ghost !text-bad flex items-center gap-2" onClick={() => setAsk("delete")}><Trash2 size={16} />Supprimer</button>}
        </div>
      )}
      {ask === "archive" && <Confirm text={`Archiver « ${initial?.name} » ? Il ne sera plus proposé à la vente.`} confirmLabel="Archiver" onNo={() => setAsk(null)} onYes={() => act.mutate("archive")} />}
      {ask === "restore" && <Confirm text={`Restaurer « ${initial?.name} » ?`} confirmLabel="Restaurer" onNo={() => setAsk(null)} onYes={() => act.mutate("restore")} />}
      {ask === "delete" && <Confirm danger text={`Supprimer définitivement « ${initial?.name} » ? Impossible s'il a déjà été vendu (archivez-le alors).`} confirmLabel="Supprimer" onNo={() => setAsk(null)} onYes={() => act.mutate("delete")} />}
    </Sheet>
  );
}

type OrderRow = Row<{ bundleId: string; number: string; type: string; qty: number; unitCost?: number; status?: string }>;
/** Ordres d'assemblage / démontage d'un kit physique : composants sortis (ou rendus), kits entrés (ou sortis), historique. */
function AssemblySheet({ kit, comps, products, variants, levels, onClose, onDone }: { kit: Row<Product>; comps: CompRow[]; products: Row<Product>[]; variants: VariantRow[]; levels?: Map<string, number>; onClose: () => void; onDone: () => void }) {
  const { session } = useSession(); const s = session!; const qc = useQueryClient();
  const requestId = useRef(crypto.randomUUID()); const [qty, setQty] = useState("1"); const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const orders = useQuery({ queryKey: ["assembly-orders", kit.$id], queryFn: () => list<OrderRow>("assembly_orders", s, [Query.equal("bundleId", kit.$id)], 20) });
  const name = (id: string, vid?: string) => { const n = products.find((p) => p.$id === id)?.name ?? "Article"; const v = vid ? variants.find((x) => x.$id === vid)?.label : ""; return v ? `${n} — ${v}` : n; };
  const stock = (id: string, vid?: string) => { const p = products.find((x) => x.$id === id); return !p ? 0 : vid ? variantQty(levels, { $id: vid }, p.qtyScale ?? 0) : qtyOf(levels, p); };
  const n = /^\d+$/.test(qty) ? Number(qty) : 0; const kitStock = qtyOf(levels, kit);
  const cs = comps.map((c) => ({ productId: c.componentId, variantId: c.variantId || undefined, qty: readableQty(c, products) }));
  const maxAsm = bundleAvailable(cs, stock);
  const run = useMutation({
    mutationFn: (type: "assemble" | "disassemble") => api<{ number: string }>(s, "kit.assemble", { requestId: requestId.current, bundleId: kit.$id, qty: n, type }),
    onSuccess: (r, type) => { requestId.current = crypto.randomUUID(); setErr(""); setMsg(`${type === "assemble" ? "Assemblage" : "Démontage"} enregistré (${r.number}).`); void qc.invalidateQueries(); void orders.refetch(); onDone(); },
    onError: (e) => { setMsg(""); setErr((e as Error).message); },
  });
  return (
    <Sheet title={`Assemblage · ${kit.name}`} onClose={onClose} back>
      <div className="card text-sm flex flex-col gap-1"><div className="flex justify-between"><span className="text-muted">Kits en stock</span><b>{formatQty(kitStock)}</b></div><div className="flex justify-between"><span className="text-muted">Assemblables avec le stock actuel</span><b>{formatQty(maxAsm)}</b></div></div>
      <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Nombre de kits</span><input className="input" inputMode="numeric" value={qty} onChange={(e) => { setQty(e.target.value); setMsg(""); }} /></label>
      {n > 0 && <div className="card text-sm flex flex-col gap-1"><b>Composants concernés</b>{cs.map((c, i) => <div key={i} className="flex justify-between gap-2"><span className="truncate">{name(c.productId, c.variantId)}</span><span className={stock(c.productId, c.variantId) < c.qty * n ? "text-bad" : "text-soft"}>{formatQty(Math.round(c.qty * n * 1000) / 1000)} (stock {formatQty(stock(c.productId, c.variantId))})</span></div>)}</div>}
      {err && <p className="text-bad text-sm" role="alert">{err}</p>}{msg && <p className="text-ok text-sm" role="status">{msg}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button className="btn" disabled={run.isPending || n < 1 || n > maxAsm} onClick={() => run.mutate("assemble")}>Assembler</button>
        <button className="btn-ghost" disabled={run.isPending || n < 1 || n > kitStock} onClick={() => run.mutate("disassemble")}>Démonter</button>
      </div>
      <p className="text-xs text-muted">Assembler retire les composants du stock et ajoute les kits (coût moyen mis à jour). Démonter fait l'inverse.</p>
      <h3 className="font-semibold">Historique</h3>
      {!orders.data?.length ? <p className="text-sm text-muted">Aucun ordre.</p> : orders.data.map((o) => <div key={o.$id} className="flex justify-between gap-2 text-sm border-t border-[var(--line)] pt-1"><span>{o.number}</span><span className="text-muted">{o.type === "assemble" ? "+" : "−"}{o.qty} kit{o.qty > 1 ? "s" : ""}{o.status === "pending" ? " · en cours" : ""}</span></div>)}
    </Sheet>
  );
}
