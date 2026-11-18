import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Archive, BarChart3, Boxes, Camera, Check, Eye, Image as ImageIcon, Lock, Minus, Package, Pencil, Plus, Search, Tag, Trash2, Undo2 } from "lucide-react";
import { CatalogTabs } from "@/components/CatalogTabs";
import { ModuleHeader, StatusBadge } from "@/components/kit";
import { useMinWidth } from "@/lib/media";
import { api } from "@/lib/api";
import { Query } from "@/lib/appwrite";
import { list, listAll, qtyOf, variantQty, type Product, type Row, type VariantRow } from "@/lib/data";
import { can, useSession } from "@/lib/session";
import { Confirm, Sheet, Thumb } from "@/components/ui";
import { compressImage, useArticleImage } from "@/lib/articles";
import { MAX_COMPONENTS, bundleAvailable, bundleSummary, isKit, priceForDiscount } from "@/domain/bundles";
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

/** Module Bundles (Lots, Pro) : packs d'articles vendus à un prix propre. Virtuel (stock suivi par ses articles) ou kit physique (stock propre, assemblé à l'avance). */
export function BundlesPage() {
  const { session } = useSession(); const s = session!; const qc = useQueryClient(); const wide = useMinWidth(1024);
  const sub = useSubscription(); const pro = planAllows(sub.data?.entitlement.plan.id, "bundles"); const canManage = pro && can(s, "stock");
  const prods = useQuery({ queryKey: ["products-all", s.shopId], queryFn: () => listAll<Product>("products", s) });
  const comps = useQuery({ queryKey: ["components-all", s.shopId], queryFn: () => list<CompRow>("article_components", s, [], 500) });
  const levels = useStockLevels();
  const variants = useQuery({ queryKey: ["variants-all-b", s.shopId], queryFn: () => listAll<VariantRow>("article_variants", s) });
  const [edit, setEdit] = useState<Row<Product> | "new" | null>(null); const [q, setQ] = useState(""); const [ask, setAsk] = useState<Row<Product> | null>(null);
  const all = prods.data ?? []; const articles = all.filter((p) => p.kind !== "bundle" && !p.archived).length; const total = all.filter((p) => p.kind === "bundle").length;
  const bundles = all.filter((p) => p.kind === "bundle" && (!q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()))).sort((a, b) => Number(!!a.archived) - Number(!!b.archived) || a.name.localeCompare(b.name, "fr"));
  const compsOf = (id: string) => (comps.data ?? []).filter((c) => c.bundleId === id);
  const name = (id: string, vid?: string) => { const n = prods.data?.find((p) => p.$id === id)?.name ?? "Article"; const v = vid ? variants.data?.find((x) => x.$id === vid)?.label : ""; return v ? `${n} — ${v}` : n; };
  const summary = (id: string) => { const cs = compsOf(id); return cs.length ? cs.map((c) => `${formatQty(readableQty(c, prods.data))}× ${name(c.componentId, c.variantId)}`).join(" + ") : "Aucun article"; };
  const refresh = () => void qc.invalidateQueries();
  const arch = useMutation({ mutationFn: (b: Row<Product>) => api(s, "article.archive", { id: b.$id, archived: !b.archived }), onSuccess: () => { setAsk(null); refresh(); }, onError: () => setAsk(null) });
  const stockCell = (b: Row<Product>) => { const n = qtyOf(levels.data, b); return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${n <= 0 ? "bg-bad-bg text-bad" : "bg-subtle text-soft"}`}>{isKit(b) ? `${formatQty(n)} en stock` : `${formatQty(n)} disponible${n > 1 ? "s" : ""}`}</span>; };
  return (
    <div className="flex flex-col gap-3">
      <ModuleHeader icon={Package} title="Articles & Catalogue" subtitle="Gérez vos articles, bundles (lots) et catégories." actions={canManage ? <button className="btn-gold !py-2.5 inline-flex items-center gap-2" onClick={() => setEdit("new")}><Plus size={18} aria-hidden="true" />Créer un Bundle</button> : undefined} />
      <CatalogTabs current="bundles" articles={articles} bundles={total} />
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-bold inline-flex items-center gap-2"><Boxes size={22} className="text-accent-text" aria-hidden="true" />Bundles (Lots)</h2>
        {all.some((p) => p.kind === "bundle") && <label className="relative w-full sm:w-80"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" /><input aria-label="Rechercher un bundle" className="input !pl-9" placeholder="Rechercher un bundle" value={q} onChange={(e) => setQ(e.target.value)} /></label>}</div>
      <p className="text-sm text-muted">Un bundle est un pack d'articles vendu à son propre prix. Virtuel : chaque vente retire ses articles du stock. Kit physique : assemblé à l'avance, avec son propre stock.</p>
      {!pro && <div className="card flex flex-col gap-2 text-sm"><span className="flex items-center gap-2 font-semibold"><Lock size={16} className="text-accent-text" />Réservé à la formule Pro</span><span className="text-muted">Vos bundles existants restent visibles ; leur création, leur modification et leur vente reviennent avec Pro.</span><button className="btn !py-2" onClick={() => window.location.assign(`${import.meta.env.BASE_URL}reglages?onglet=abonnement&formule=pro`)}>Passer à Pro</button></div>}
      {prods.isLoading && <p className="text-muted text-sm">Chargement…</p>}
      {!prods.isLoading && bundles.length === 0 && <p className="text-center text-muted text-sm py-6">{q ? "Aucun résultat." : "Aucun bundle."}</p>}
      {wide && bundles.length > 0 && <div className="card !p-0 overflow-x-auto"><table className="w-full text-sm" aria-label="Bundles"><thead className="text-xs text-muted border-b border-[var(--line)]"><tr><th className="text-left py-2.5 px-3 w-10">#</th><th className="text-left">Bundle</th><th className="text-left">Type</th><th className="text-right">Prix</th><th className="text-center">Stock</th><th className="text-center">Statut</th><th className="text-right pr-3">Actions</th></tr></thead>
        <tbody>{bundles.map((b, i) => <tr key={b.$id} className={`border-t border-[var(--line)] hover:bg-subtle ${b.archived ? "opacity-60" : ""}`}><td className="px-3 py-2 text-muted tabular-nums">{String(i + 1).padStart(2, "0")}</td>
          <td className="py-2"><button type="button" className="flex items-center gap-3 text-left min-w-0" onClick={() => setEdit(b)}><Thumb id={b.imageFileId} size={44} /><span className="min-w-0"><b className="block truncate">{b.name}</b><span className="block text-xs text-muted truncate max-w-[28rem]">{summary(b.$id)}</span></span></button></td>
          <td className="text-xs">{isKit(b) ? "Kit physique" : "Virtuel"}</td><td className="text-right font-semibold tabular-nums">{formatFcfa(b.price)}</td><td className="text-center">{stockCell(b)}</td>
          <td className="text-center"><StatusBadge tone={b.archived ? "muted" : "ok"}>{b.archived ? "Archivé" : "Actif"}</StatusBadge></td>
          <td className="text-right pr-3 whitespace-nowrap"><button type="button" className="btn-ghost !p-2" aria-label={`${canManage ? "Modifier" : "Voir"} ${b.name}`} title={canManage ? "Modifier" : "Voir"} onClick={() => setEdit(b)}>{canManage ? <Pencil size={16} /> : <Eye size={16} />}</button>{canManage && <button type="button" className="btn-ghost !p-2" aria-label={`${b.archived ? "Restaurer" : "Archiver"} ${b.name}`} title={b.archived ? "Restaurer" : "Archiver"} onClick={() => setAsk(b)}>{b.archived ? <Undo2 size={16} /> : <Archive size={16} />}</button>}</td></tr>)}</tbody></table></div>}
      {!wide && <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {bundles.map((b) => <li key={b.$id}><button className={`card w-full text-left flex gap-3 items-center ${b.archived ? "opacity-60" : ""}`} onClick={() => setEdit(b)}><Thumb id={b.imageFileId} size={56} /><div className="min-w-0 flex-1 flex flex-col gap-1"><div className="flex justify-between gap-2"><b className="truncate">{b.name}</b><span className="text-accent-text font-bold">{formatFcfa(b.price)}</span></div>
          <div className="text-xs text-muted truncate">{summary(b.$id)}</div><div className="flex gap-2 text-xs flex-wrap items-center">{stockCell(b)}<span className="rounded-full px-2 py-0.5 bg-subtle text-soft">{isKit(b) ? "Kit physique" : "Virtuel"}</span><StatusBadge tone={b.archived ? "muted" : "ok"}>{b.archived ? "Archivé" : "Actif"}</StatusBadge></div></div></button></li>)}
      </ul>}
      {ask && <Confirm text={ask.archived ? `Restaurer « ${ask.name} » ?` : `Archiver « ${ask.name} » ? Il ne sera plus proposé à la vente.`} confirmLabel={ask.archived ? "Restaurer" : "Archiver"} onNo={() => setAsk(null)} onYes={() => arch.mutate(ask)} />}
      {edit && <BundleEditor initial={edit === "new" ? null : edit} comps={edit === "new" ? [] : compsOf(edit.$id)} products={prods.data ?? []} variants={variants.data ?? []} levels={levels.data} canManage={canManage} onClose={() => setEdit(null)} onSaved={refresh} />}
    </div>
  );
}

const DEFAULT_CATEGORY = "Packs / Bundles";
function BundleEditor({ initial, comps, products, variants, levels, canManage, onClose, onSaved }: { initial: Row<Product> | null; comps: CompRow[]; products: Row<Product>[]; variants: VariantRow[]; levels?: Map<string, number>; canManage: boolean; onClose: () => void; onSaved: () => void }) {
  const { session } = useSession(); const s = session!;
  const requestId = useRef(crypto.randomUUID()); const [bundleId, setBundleId] = useState(initial?.$id ?? "");
  const [f, setF] = useState({ name: initial?.name ?? "", price: initial ? String(initial.price) : "", sku: initial?.sku ?? "", category: initial ? initial.category ?? "" : DEFAULT_CATEGORY, description: (initial as { description?: string } | null)?.description ?? "", mode: initial?.bundleMode === "kit" ? "kit" : "virtual" });
  const [pctEdit, setPctEdit] = useState<string | null>(null); const [asm, setAsm] = useState(false); const [pick, setPick] = useState(false); const kit = f.mode === "kit";
  const [rows, setRows] = useState<Draft[]>(comps.map((c) => ({ key: c.variantId ? `${c.componentId}:${c.variantId}` : c.componentId, qty: String(readableQty(c, products)).replace(".", ",") })));
  const [photo, setPhoto] = useState<File | null>(null); const [removePhoto, setRemovePhoto] = useState(false); const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => { if (!photo) { setPreview(null); return; } const u = URL.createObjectURL(photo); setPreview(u); return () => URL.revokeObjectURL(u); }, [photo]);
  const existing = useArticleImage(initial?.imageFileId, 400);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [ask, setAsk] = useState<null | "archive" | "restore" | "delete">(null);
  // Tous les articles du commerce peuvent composer un bundle (une variante = une option) ; un kit physique n'accepte pas les articles suivis par lot/série.
  const options = products.filter((p) => !p.archived && p.kind !== "bundle" && !(kit && trackingOf(p))).flatMap((p) => p.hasVariants ? variants.filter((v) => v.productId === p.$id && !v.archived).map((v) => ({ key: `${p.$id}:${v.$id}`, label: `${p.name} — ${v.label}`, tracked: !!trackingOf(p), find: `${p.name} ${v.label} ${v.sku ?? ""} ${v.barcode ?? ""} ${p.sku ?? ""}`.toLowerCase(), image: v.imageFileId || p.imageFileId })) : [{ key: p.$id, label: p.name, tracked: !!trackingOf(p), find: `${p.name} ${p.sku ?? ""} ${p.barcode ?? ""}`.toLowerCase(), image: p.imageFileId }]).sort((x, y) => x.label.localeCompare(y.label, "fr"));
  const by = (id: string) => products.find((p) => p.$id === id);
  const labelOf = (k: string) => options.find((o) => o.key === k)?.label ?? (() => { const { productId, variantId } = splitKey(k); const n = by(productId)?.name ?? "Article"; const v = variantId ? variants.find((x) => x.$id === variantId)?.label : ""; return v ? `${n} — ${v}` : n; })();
  const imageOf = (k: string) => { const { productId, variantId } = splitKey(k); return (variantId ? variants.find((v) => v.$id === variantId)?.imageFileId : undefined) || by(productId)?.imageFileId; };
  const stockOfKey = (k: string): number => { const { productId, variantId } = splitKey(k); const p = by(productId); if (!p) return 0; return variantId ? variantQty(levels, { $id: variantId }, p.qtyScale ?? 0) : qtyOf(levels, p); };
  const unitCostOf = (k: string): number => { const { productId, variantId } = splitKey(k); return Number((variantId ? variants.find((v) => v.$id === variantId)?.cost : by(productId)?.cost) ?? 0); };
  const unitPriceOf = (k: string): number => { const { productId, variantId } = splitKey(k); return Number((variantId ? variants.find((v) => v.$id === variantId)?.price : undefined) ?? by(productId)?.price ?? 0); };
  const qtyNum = (t: string) => Number(t.trim().replace(",", "."));
  const qtyOk = (t: string) => /^\d+([.,]\d{1,3})?$/.test(t.trim()) && qtyNum(t) > 0;
  const valid = rows.length > 0 && rows.every((r) => r.key && qtyOk(r.qty)) && new Set(rows.map((r) => r.key)).size === rows.length;
  const avail = valid ? bundleAvailable(rows.map((r) => ({ ...splitKey(r.key), qty: qtyNum(r.qty) })), (id, vid) => stockOfKey(vid ? `${id}:${vid}` : id)) : 0;
  const cost = Math.round(rows.reduce((a, r) => a + unitCostOf(r.key) * (qtyNum(r.qty) || 0), 0)); const price = Number(f.price.replace(/\s/g, "")) || 0; const m = marginOf(price, cost);
  const sum = bundleSummary(rows.filter((r) => qtyOk(r.qty)).map((r) => ({ unitPrice: unitPriceOf(r.key), qty: qtyNum(r.qty) })), price);
  const shownPct = pctEdit ?? (sum.savingPct !== null && f.price ? String(sum.savingPct).replace(".", ",") : "");
  const onPct = (t: string) => { setPctEdit(t); const n = Number(t.trim().replace(",", ".")); if (t.trim() && Number.isFinite(n) && n >= 0 && n <= 100 && sum.gross > 0) setF((x) => ({ ...x, price: String(priceForDiscount(sum.gross, n)) })); };
  const set = (i: number, p: Partial<Draft>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const step = (i: number, d: number) => { const n = Math.max(1, Math.round(((qtyNum(rows[i]!.qty) || 0) + d) * 1000) / 1000); set(i, { qty: String(n).replace(".", ",") }); setPctEdit(null); };
  const add = (k: string) => { if (!rows.some((r) => r.key === k)) setRows([...rows, { key: k, qty: "1" }]); setPick(false); setPctEdit(null); };
  const ok = f.name.trim() && /^\d+$/.test(f.price.replace(/\s/g, "")) && valid;
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      let id = bundleId;
      const data = { name: f.name, price: f.price.replace(/\s/g, ""), sku: f.sku, category: f.category.trim(), description: f.description.trim() };
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
  const cats = [...new Set([DEFAULT_CATEGORY, ...products.map((p) => p.category).filter((c): c is string => !!c)])].sort((a, b) => a.localeCompare(b, "fr"));
  const title = initial ? (canManage ? "Modifier le bundle" : initial.name) : "Créer un Bundle (Lot)";
  return (
    <Sheet title={title} onClose={onClose} back size="lg">
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="-mx-4 -mt-4 px-5 py-4 bg-[linear-gradient(135deg,var(--nav-bg),color-mix(in_srgb,var(--nav-bg)_70%,#1d4ed8))] text-white flex items-center gap-3" aria-hidden="true"><Boxes size={34} /><div><b className="text-lg block">{title}</b><span className="text-sm text-white/80">Regroupez plusieurs articles pour les vendre ensemble (pack, lot, promo).</span></div></div>
        <div className="grid gap-4 md:grid-cols-[13rem_minmax(0,1fr)]">
          <div className="flex flex-col gap-2 items-center">
            <div className="relative">{preview ? <img src={preview} alt="Aperçu" className="w-48 h-40 rounded-2xl object-cover" /> : removePhoto ? <Thumb size={160} /> : <Thumb id={initial?.imageFileId} size={160} />}</div>
            {canManage && <div className="grid grid-cols-2 gap-2 w-full"><label className="btn-ghost !px-2 flex items-center justify-center gap-1 cursor-pointer text-xs"><Camera size={16} />Photo<input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { setPhoto(e.target.files?.[0] ?? null); setRemovePhoto(false); }} /></label>
              <label className="btn-ghost !px-2 flex items-center justify-center gap-1 cursor-pointer text-xs"><ImageIcon size={16} />Galerie<input type="file" accept="image/*" className="sr-only" onChange={(e) => { setPhoto(e.target.files?.[0] ?? null); setRemovePhoto(false); }} /></label></div>}
            {canManage && (photo || (initial?.imageFileId && existing && !removePhoto)) && <button type="button" className="text-xs text-bad" onClick={() => { setPhoto(null); setRemovePhoto(true); }}>Retirer la photo</button>}
          </div>
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm"><span className="font-medium">Nom du bundle <span className="text-bad">*</span></span><input className="input" required maxLength={160} disabled={!canManage} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
              <label className="flex flex-col gap-1 text-sm"><span className="font-medium">Catégorie</span><input className="input" list="bundle-cats" maxLength={80} disabled={!canManage} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /><datalist id="bundle-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist></label>
            </div>
            <label className="flex flex-col gap-1 text-sm"><span className="font-medium">Description (optionnelle)</span><textarea className="input min-h-20" maxLength={1000} disabled={!canManage} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
            <label className="flex flex-col gap-1 text-sm sm:max-w-xs"><span className="text-muted">Référence</span><input className="input" maxLength={64} disabled={!canManage} placeholder={initial?.sku ? "" : "Automatique"} value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} /></label>
          </div>
        </div>

        <section aria-label="Articles du bundle" className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2"><h3 className="font-semibold inline-flex items-center gap-2"><Boxes size={18} className="text-accent-text" aria-hidden="true" />Articles du bundle <span className="text-muted font-normal">({rows.length} article{rows.length > 1 ? "s" : ""})</span></h3>
            {canManage && <button type="button" className="btn-ghost !py-1.5 inline-flex items-center gap-1 text-sm text-accent-text" disabled={rows.length >= MAX_COMPONENTS} onClick={() => setPick(true)}><Plus size={16} />Ajouter un article</button>}</div>
          {!rows.length ? <p className="card text-sm text-muted">Aucun article : utilisez « Ajouter un article ».</p> : <div className="card !p-0 overflow-x-auto"><table className="w-full text-sm min-w-[36rem]" aria-label="Composition du bundle"><thead className="text-xs text-muted bg-subtle"><tr><th className="text-left py-2 px-3 w-8">#</th><th className="text-left">Article</th><th className="text-center">Quantité</th><th className="text-right">Prix unitaire</th><th className="text-right">Sous-total</th><th className="w-10" /></tr></thead>
            <tbody>{rows.map((r, i) => { const q = qtyNum(r.qty); return <tr key={r.key} className="border-t border-[var(--line)]"><td className="px-3 py-2 text-muted">{i + 1}</td>
              <td className="py-2"><span className="flex items-center gap-2 min-w-0"><Thumb id={imageOf(r.key)} size={32} /><span className="min-w-0"><span className="block truncate">{labelOf(r.key)}</span><span className="block text-[11px] text-muted">En stock : {formatQty(stockOfKey(r.key))} · coût {formatFcfa(unitCostOf(r.key))}</span></span></span></td>
              <td className="text-center">{canManage ? <span className="inline-flex items-center gap-1"><button type="button" className="btn-ghost !p-1.5 !min-h-8" aria-label={`Diminuer la quantité de ${labelOf(r.key)}`} disabled={q <= 1} onClick={() => step(i, -1)}><Minus size={14} /></button><input className="input !w-16 !px-1 text-center !min-h-8" inputMode="decimal" aria-label={`Quantité de ${labelOf(r.key)}`} value={r.qty} onChange={(e) => { set(i, { qty: e.target.value }); setPctEdit(null); }} /><button type="button" className="btn-ghost !p-1.5 !min-h-8" aria-label={`Augmenter la quantité de ${labelOf(r.key)}`} onClick={() => step(i, 1)}><Plus size={14} /></button></span> : <b>× {r.qty}</b>}</td>
              <td className="text-right tabular-nums">{formatFcfa(unitPriceOf(r.key))}</td><td className="text-right tabular-nums font-medium">{qtyOk(r.qty) ? formatFcfa(Math.round(unitPriceOf(r.key) * q)) : "—"}</td>
              <td className="text-center">{canManage && <button type="button" className="btn-ghost !p-1.5 !text-bad" aria-label={`Retirer ${labelOf(r.key)}`} onClick={() => { setRows(rows.filter((_, j) => j !== i)); setPctEdit(null); }}><Trash2 size={16} /></button>}</td></tr>; })}</tbody></table></div>}
        </section>

        <div className="grid gap-3 md:grid-cols-2">
          <section aria-label="Paramètres du bundle" className="rounded-2xl p-4 bg-[color-mix(in_srgb,#8b5cf6_8%,var(--surface))] border border-[var(--line)] flex flex-col gap-3">
            <h3 className="font-semibold inline-flex items-center gap-2"><Tag size={18} className="text-[#8b5cf6]" aria-hidden="true" />Paramètres du bundle</h3>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-sm"><span className="font-medium">Prix du bundle (FCFA) <span className="text-bad">*</span></span><input className="input" inputMode="numeric" required disabled={!canManage} value={f.price} onChange={(e) => { setF({ ...f, price: e.target.value }); setPctEdit(null); }} /></label>
              <label className="flex flex-col gap-1 text-sm"><span className="font-medium">Remise (optionnelle)</span><span className="relative"><input className="input !pr-8" inputMode="decimal" aria-label="Remise en pourcentage" disabled={!canManage || sum.gross <= 0} placeholder="0" value={shownPct} onChange={(e) => onPct(e.target.value)} onBlur={() => setPctEdit(null)} /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted">%</span></span></label>
            </div>
            {(!initial && !bundleId) ? <label className="flex items-start gap-3 text-sm cursor-pointer"><input type="checkbox" role="switch" className="mt-0.5 h-5 w-9 accent-[var(--ok)]" checked={!kit} disabled={!canManage} onChange={(e) => { setF({ ...f, mode: e.target.checked ? "virtual" : "kit" }); setRows(rows.filter((r) => e.target.checked || !trackingOf(by(splitKey(r.key).productId) ?? {}))); }} aria-describedby="track-help" />
              <span><b>Suivre le stock du bundle</b><span id="track-help" className="block text-xs text-muted">{kit ? "Désactivé : kit physique, assemblé à l'avance, avec son propre stock (ordres d'assemblage ; articles suivis par lot ou série exclus)." : "Le stock du bundle dépendra des stocks des articles qui le composent : chaque vente retire ses articles."}</span></span></label>
              : <p className="text-xs text-muted">{kit ? "Kit physique : assemblé à l'avance, avec son propre stock (le type ne change plus après la création)." : "Stock suivi par les articles du bundle : chaque vente retire ses articles (le type ne change plus après la création)."}</p>}
          </section>
          <section aria-label="Récapitulatif" className="rounded-2xl p-4 bg-[color-mix(in_srgb,var(--ok)_8%,var(--surface))] border border-[var(--line)] flex flex-col gap-1.5 text-sm">
            <h3 className="font-semibold inline-flex items-center gap-2 mb-1"><BarChart3 size={18} className="text-ok" aria-hidden="true" />Récapitulatif</h3>
            <div className="flex justify-between"><span>Total articles</span><b>{sum.lines}{sum.units !== sum.lines ? ` (${formatQty(sum.units)} unités)` : ""}</b></div>
            <div className="flex justify-between"><span>Total sans remise</span><b className="tabular-nums">{formatFcfa(sum.gross)}</b></div>
            <div className="flex justify-between"><span>Prix du bundle</span><b className="tabular-nums">{price ? formatFcfa(price) : "—"}</b></div>
            <div className={`flex justify-between rounded-lg px-2 py-1.5 font-semibold ${sum.saving > 0 ? "bg-ok-bg/60 text-ok" : sum.saving < 0 && price ? "bg-warn-bg/60 text-warn" : "bg-subtle"}`}><span>Économie client</span><span className="tabular-nums">{price && sum.gross ? `${formatFcfa(Math.max(0, sum.saving))}${sum.savingPct !== null && sum.saving > 0 ? ` (−${fmtPct(sum.savingPct)} %)` : ""}` : "—"}</span></div>
            {price > 0 && sum.saving < 0 && <p className="text-xs text-warn">Le prix du bundle dépasse le total des articles vendus séparément ({formatFcfa(-sum.saving)} de plus).</p>}
            <div className="border-t border-[var(--line)] mt-1 pt-1.5 flex flex-col gap-1 text-xs text-muted">
              <div className="flex justify-between"><span>{kit ? "Assemblables maintenant" : "Disponible maintenant"}</span><b className="text-[var(--text)]">{formatQty(avail)}</b></div>
              {kit && initial && <div className="flex justify-between"><span>Kits en stock</span><b className="text-[var(--text)]">{formatQty(qtyOf(levels, initial))}</b></div>}
              <div className="flex justify-between"><span>Coût des articles</span><b className="text-[var(--text)]">{cost ? formatFcfa(cost) : "—"}</b></div>
              {price > 0 && cost > 0 && <div className="flex justify-between"><span>Marge indicative</span><b className="text-[var(--text)]">{formatFcfa(m.amount)}{m.pct !== null ? ` (${m.pct} %)` : ""}</b></div>}
            </div>
          </section>
        </div>
        {price > 0 && sellsAtLoss(price, cost) && <p className="flex gap-2 text-sm text-warn"><AlertTriangle size={18} />Le prix du bundle est inférieur au coût de ses articles : vente à perte.</p>}
        {err && <p className="text-bad text-sm" role="alert">{err}</p>}
        {canManage ? <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Annuler</button><button className="btn inline-flex items-center gap-2" disabled={busy || !ok}><Check size={18} />{busy ? "Enregistrement…" : "Enregistrer le bundle"}</button></div> : <p className="text-xs text-warn">Lecture seule (formule Business ou accès insuffisant) : vos données sont conservées.</p>}
      </form>
      {canManage && initial && kit && comps.length > 0 && <button className="btn mt-3" onClick={() => setAsm(true)}>Assembler / démonter des kits</button>}
      {asm && initial && <AssemblySheet kit={initial} comps={comps} products={products} variants={variants} levels={levels} onClose={() => setAsm(false)} onDone={onSaved} />}
      {pick && <ArticlePicker options={options.filter((o) => !rows.some((r) => r.key === o.key))} priceOf={unitPriceOf} stockOf={stockOfKey} onPick={add} onClose={() => setPick(false)} />}
      {canManage && initial && (
        <div className="flex gap-2 flex-wrap mt-3">
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
const fmtPct = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });

/** Recherche d'un article à ajouter au bundle : nom, référence ou code-barres. */
function ArticlePicker({ options, priceOf, stockOf, onPick, onClose }: { options: { key: string; label: string; tracked: boolean; find: string; image?: string }[]; priceOf: (k: string) => number; stockOf: (k: string) => number; onPick: (k: string) => void; onClose: () => void }) {
  const [q, setQ] = useState(""); const t = q.trim().toLowerCase(); const shown = options.filter((o) => !t || o.find.includes(t)).slice(0, 60);
  return <Sheet title="Ajouter un article" onClose={onClose} back>
    <div className="flex flex-col gap-2"><label className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" /><input autoFocus className="input !pl-9" aria-label="Rechercher un article à ajouter" placeholder="Nom, référence ou code-barres" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      {!shown.length && <p className="text-sm text-muted text-center py-4">Aucun article.</p>}
      <ul className="flex flex-col gap-1">{shown.map((o) => <li key={o.key}><button type="button" className="w-full text-left rounded-xl border border-[var(--line)] px-3 py-2 hover:bg-subtle flex items-center gap-3" onClick={() => onPick(o.key)}><Thumb id={o.image} size={36} /><span className="min-w-0 flex-1"><span className="block truncate font-medium">{o.label}{o.tracked ? " (suivi)" : ""}</span><span className="block text-xs text-muted">En stock : {formatQty(stockOf(o.key))}</span></span><b className="tabular-nums text-sm">{formatFcfa(priceOf(o.key))}</b></button></li>)}</ul>
      {options.length > 60 && !t && <p className="text-xs text-muted">Affinez la recherche pour voir plus d'articles.</p>}</div>
  </Sheet>;
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
