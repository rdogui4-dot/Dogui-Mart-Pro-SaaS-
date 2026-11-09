import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Archive, Camera, Image as ImageIcon, Lock, Plus, Trash2, Undo2 } from "lucide-react";
import { api } from "@/lib/api";
import { Query } from "@/lib/appwrite";
import { list, listAll, stockLevels, qtyOf, type Product, type Row } from "@/lib/data";
import { can, useSession } from "@/lib/session";
import { Confirm, Sheet, Thumb } from "@/components/ui";
import { compressImage, useArticleImage } from "@/lib/articles";
import { MAX_COMPONENTS, bundleAvailable, isKit } from "@/domain/bundles";
import { planAllows } from "@/domain/features";
import { formatFcfa } from "@/domain/money";
import { marginOf, sellsAtLoss } from "@/domain/articles";
import { formatQty } from "@/domain/quantity";
import { trackingOf } from "@/domain/tracking";
import { useSubscription } from "./subscription";

type CompRow = Row<{ bundleId: string; componentId: string; qty: number }>;
type Draft = { productId: string; qty: string };

/** Module Bundles (Pro) : packs d'articles vendus à un prix propre ; chaque vente retire les composants du stock. */
export function BundlesPage() {
  const { session } = useSession(); const s = session!; const qc = useQueryClient();
  const sub = useSubscription(); const pro = planAllows(sub.data?.entitlement.plan.id, "bundles"); const canManage = pro && can(s, "stock");
  const prods = useQuery({ queryKey: ["products-all", s.shopId], queryFn: () => listAll<Product>("products", s) });
  const comps = useQuery({ queryKey: ["components-all", s.shopId], queryFn: () => list<CompRow>("article_components", s, [], 500) });
  const levels = useQuery({ queryKey: ["stock"], queryFn: () => stockLevels(s) });
  const [edit, setEdit] = useState<Row<Product> | "new" | null>(null); const [q, setQ] = useState("");
  const bundles = (prods.data ?? []).filter((p) => p.kind === "bundle" && (!q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()))).sort((a, b) => Number(!!a.archived) - Number(!!b.archived) || a.name.localeCompare(b.name, "fr"));
  const compsOf = (id: string) => (comps.data ?? []).filter((c) => c.bundleId === id);
  const name = (id: string) => prods.data?.find((p) => p.$id === id)?.name ?? "Article";
  const refresh = () => void qc.invalidateQueries();
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">Bundles</h1>
      <p className="text-sm text-white/60">Un bundle est un pack d'articles vendu à son propre prix. Il n'a pas de stock : chaque vente retire ses composants du stock.</p>
      {!pro && <div className="card flex flex-col gap-2 text-sm"><span className="flex items-center gap-2 font-semibold"><Lock size={16} className="text-[var(--gold)]" />Réservé à la formule Pro</span><span className="text-white/60">Vos bundles existants restent visibles ; leur création, leur modification et leur vente reviennent avec Pro.</span><button className="btn !py-2" onClick={() => window.location.assign(`${import.meta.env.BASE_URL}reglages?onglet=abonnement&formule=pro`)}>Passer à Pro</button></div>}
      {canManage && <button className="btn flex items-center justify-center gap-2" onClick={() => setEdit("new")}><Plus size={18} />Nouveau bundle</button>}
      {(prods.data ?? []).some((p) => p.kind === "bundle") && <input className="input" placeholder="Rechercher un bundle" value={q} onChange={(e) => setQ(e.target.value)} />}
      {prods.isLoading && <p className="text-white/50 text-sm">Chargement…</p>}
      {!prods.isLoading && bundles.length === 0 && <p className="text-center text-white/50 text-sm py-6">{q ? "Aucun résultat." : "Aucun bundle."}</p>}
      <ul className="flex flex-col gap-2">
        {bundles.map((b) => {
          const cs = compsOf(b.$id); const n = qtyOf(levels.data, b);
          return (
            <li key={b.$id}><button className={`card w-full text-left flex flex-col gap-1 ${b.archived ? "opacity-60" : ""}`} onClick={() => setEdit(b)}>
              <div className="flex gap-3 items-center"><Thumb id={b.imageFileId} size={56} /><div className="min-w-0 flex-1 flex flex-col gap-1"><div className="flex justify-between gap-2"><b className="truncate">{b.name}</b><span className="gold-text font-bold">{formatFcfa(b.price)}</span></div>
              <div className="text-xs text-white/50 truncate">{cs.length ? cs.map((c) => `${c.qty}× ${name(c.componentId)}`).join(" + ") : "Aucun composant"}</div>
              <div className="flex gap-2 text-xs flex-wrap"><span className={`rounded-full px-2 py-0.5 ${n <= 0 ? "bg-red-500/20 text-red-300" : "bg-white/10 text-white/70"}`}>{isKit(b) ? `${formatQty(n)} en stock` : `${formatQty(n)} disponible${n > 1 ? "s" : ""}`}</span><span className="rounded-full px-2 py-0.5 bg-white/10 text-white/70">{isKit(b) ? "Kit physique" : "Virtuel"}</span>{b.archived && <span className="text-amber-300">Archivé</span>}{!cs.length && <span className="text-amber-300">{isKit(b) ? "Non assemblable" : "Non vendable"}</span>}</div></div></div>
            </button></li>
          );
        })}
      </ul>
      {edit && <BundleEditor initial={edit === "new" ? null : edit} comps={edit === "new" ? [] : compsOf(edit.$id)} products={prods.data ?? []} levels={levels.data} canManage={canManage} onClose={() => setEdit(null)} onSaved={refresh} />}
    </div>
  );
}

function BundleEditor({ initial, comps, products, levels, canManage, onClose, onSaved }: { initial: Row<Product> | null; comps: CompRow[]; products: Row<Product>[]; levels?: Map<string, number>; canManage: boolean; onClose: () => void; onSaved: () => void }) {
  const { session } = useSession(); const s = session!;
  const requestId = useRef(crypto.randomUUID()); const [bundleId, setBundleId] = useState(initial?.$id ?? "");
  const [f, setF] = useState({ name: initial?.name ?? "", price: initial ? String(initial.price) : "", sku: initial?.sku ?? "", mode: initial?.bundleMode === "kit" ? "kit" : "virtual" });
  const [asm, setAsm] = useState(false); const kit = f.mode === "kit";
  const [rows, setRows] = useState<Draft[]>(comps.length ? comps.map((c) => ({ productId: c.componentId, qty: String(c.qty) })) : [{ productId: "", qty: "1" }]);
  const [photo, setPhoto] = useState<File | null>(null); const [removePhoto, setRemovePhoto] = useState(false); const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => { if (!photo) { setPreview(null); return; } const u = URL.createObjectURL(photo); setPreview(u); return () => URL.revokeObjectURL(u); }, [photo]);
  const existing = useArticleImage(initial?.imageFileId, 400);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [ask, setAsk] = useState<null | "archive" | "restore" | "delete">(null);
  const eligible = products.filter((p) => !p.archived && p.kind !== "bundle" && !trackingOf(p) && !p.hasVariants && (p.qtyScale ?? 0) === 0);
  const by = (id: string) => products.find((p) => p.$id === id);
  const stock = (id: string) => (by(id) ? qtyOf(levels, by(id)!) : 0);
  const valid = rows.length > 0 && rows.every((r) => r.productId && /^\d+$/.test(r.qty) && Number(r.qty) >= 1) && new Set(rows.map((r) => r.productId)).size === rows.length;
  const avail = valid ? bundleAvailable(rows.map((r) => ({ productId: r.productId, qty: Number(r.qty) })), stock) : 0;
  const cost = rows.reduce((a, r) => a + Number(by(r.productId)?.cost ?? 0) * (Number(r.qty) || 0), 0); const price = Number(f.price) || 0; const m = marginOf(price, cost);
  const set = (i: number, p: Partial<Draft>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const ok = f.name.trim() && /^\d+$/.test(f.price.replace(/\s/g, "")) && valid;
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      let id = bundleId;
      const data = { name: f.name, price: f.price.replace(/\s/g, ""), sku: f.sku };
      if (id) await api(s, "article.save", { id, data });
      else { id = (await api<{ id: string }>(s, "article.save", { requestId: requestId.current, data: { ...data, kind: "bundle", bundleMode: f.mode } })).id; setBundleId(id); }
      await api(s, "bundle.components", { bundleId: id, components: rows.map((r) => ({ productId: r.productId, qty: r.qty })) });
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
            {preview ? <img src={preview} alt="Aperçu" className="w-24 h-24 rounded-2xl object-cover" /> : removePhoto ? <Thumb size={96} /> : <Thumb id={initial?.imageFileId} size={96} />}
            <div className="flex flex-col gap-2 flex-1">
              <label className="btn-ghost flex items-center justify-center gap-2 cursor-pointer text-sm"><Camera size={18} />Prendre une photo<input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { setPhoto(e.target.files?.[0] ?? null); setRemovePhoto(false); }} /></label>
              <label className="btn-ghost flex items-center justify-center gap-2 cursor-pointer text-sm"><ImageIcon size={18} />Galerie<input type="file" accept="image/*" className="sr-only" onChange={(e) => { setPhoto(e.target.files?.[0] ?? null); setRemovePhoto(false); }} /></label>
              {(photo || (initial?.imageFileId && existing && !removePhoto)) && <button type="button" className="text-xs text-red-300 text-left" onClick={() => { setPhoto(null); setRemovePhoto(true); }}>Retirer la photo</button>}
            </div>
          </div>
        )}
        {!initial && !bundleId && <label className="flex flex-col gap-1 text-sm"><span className="text-white/60">Type de bundle</span><select className="input" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="virtual">Virtuel : les composants sortent du stock à la vente</option><option value="kit">Kit physique : assemblé à l'avance, stock propre</option></select></label>}
        {(initial || bundleId) && <p className="text-xs text-white/50">{kit ? "Kit physique : on l'assemble à l'avance (ordre d'assemblage), il a son propre stock." : "Bundle virtuel : pas de stock propre, chaque vente retire les composants."}</p>}
        <label className="flex flex-col gap-1 text-sm"><span className="text-white/60">Nom du bundle *</span><input className="input" required maxLength={160} disabled={!canManage} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-sm"><span className="text-white/60">Prix de vente (FCFA) *</span><input className="input" inputMode="numeric" required disabled={!canManage} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></label>
          <label className="flex flex-col gap-1 text-sm"><span className="text-white/60">Référence</span><input className="input" maxLength={64} disabled={!canManage} placeholder={initial?.sku ? "" : "Automatique"} value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} /></label>
        </div>
        <h3 className="font-semibold">Composition</h3>
        {rows.map((r, i) => (
          <div key={i} className="card flex flex-col gap-1">
            {canManage ? <div className="grid grid-cols-[1fr_4.5rem_auto] gap-2 items-center">
              <select className="input !px-2" aria-label="Composant" value={r.productId} onChange={(e) => set(i, { productId: e.target.value })}><option value="">Article…</option>{eligible.map((p) => <option key={p.$id} value={p.$id}>{p.name}</option>)}{r.productId && !eligible.some((p) => p.$id === r.productId) && <option value={r.productId}>{by(r.productId)?.name ?? "Article"}</option>}</select>
              <input className="input !px-2" inputMode="numeric" aria-label="Quantité" placeholder="Qté" value={r.qty} onChange={(e) => set(i, { qty: e.target.value })} />
              <button type="button" className="btn-ghost !p-2" aria-label="Retirer" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
            </div> : <div className="flex justify-between"><span>{by(r.productId)?.name ?? "Article"}</span><b>× {r.qty}</b></div>}
            {r.productId && <p className="text-xs text-white/50">En stock : {formatQty(stock(r.productId))} · coût {formatFcfa(Number(by(r.productId)?.cost ?? 0))}</p>}
          </div>
        ))}
        {canManage && <button type="button" className="btn-ghost flex items-center justify-center gap-2" disabled={rows.length >= MAX_COMPONENTS} onClick={() => setRows([...rows, { productId: "", qty: "1" }])}><Plus size={16} />Ajouter un composant</button>}
        <div className="card text-sm flex flex-col gap-1">
          <div className="flex justify-between"><span className="text-white/50">{kit ? "Assemblables maintenant" : "Disponible maintenant"}</span><b>{formatQty(avail)}</b></div>
          {kit && initial && <div className="flex justify-between"><span className="text-white/50">Kits en stock</span><b>{formatQty(qtyOf(levels, initial))}</b></div>}
          <div className="flex justify-between"><span className="text-white/50">Coût des composants</span><b>{cost ? formatFcfa(cost) : "—"}</b></div>
          {price > 0 && cost > 0 && <div className="flex justify-between"><span className="text-white/50">Marge indicative</span><b>{formatFcfa(m.amount)}{m.pct !== null ? ` (${m.pct} %)` : ""}</b></div>}
        </div>
        {price > 0 && sellsAtLoss(price, cost) && <p className="flex gap-2 text-sm text-amber-300"><AlertTriangle size={18} />Le prix du bundle est inférieur au coût de ses composants : vente à perte.</p>}
        {err && <p className="text-red-400 text-sm" role="alert">{err}</p>}
        {canManage ? <button className="btn" disabled={busy || !ok}>{busy ? "Enregistrement…" : initial || bundleId ? "Enregistrer" : "Créer le bundle"}</button> : <p className="text-xs text-amber-300">Lecture seule (formule Business ou accès insuffisant) : vos données sont conservées.</p>}
      </form>
      {canManage && initial && kit && comps.length > 0 && <button className="btn" onClick={() => setAsm(true)}>Assembler / démonter des kits</button>}
      {asm && initial && <AssemblySheet kit={initial} comps={comps} products={products} levels={levels} onClose={() => setAsm(false)} onDone={onSaved} />}
      {canManage && initial && (
        <div className="flex gap-2 flex-wrap">
          {initial.archived ? <button className="btn-ghost flex items-center gap-2" onClick={() => setAsk("restore")}><Undo2 size={16} />Restaurer</button> : <button className="btn-ghost flex items-center gap-2" onClick={() => setAsk("archive")}><Archive size={16} />Archiver</button>}
          {(s.role === "owner" || s.role === "manager") && <button className="btn-ghost !text-red-300 flex items-center gap-2" onClick={() => setAsk("delete")}><Trash2 size={16} />Supprimer</button>}
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
function AssemblySheet({ kit, comps, products, levels, onClose, onDone }: { kit: Row<Product>; comps: CompRow[]; products: Row<Product>[]; levels?: Map<string, number>; onClose: () => void; onDone: () => void }) {
  const { session } = useSession(); const s = session!; const qc = useQueryClient();
  const requestId = useRef(crypto.randomUUID()); const [qty, setQty] = useState("1"); const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const orders = useQuery({ queryKey: ["assembly-orders", kit.$id], queryFn: () => list<OrderRow>("assembly_orders", s, [Query.equal("bundleId", kit.$id)], 20) });
  const name = (id: string) => products.find((p) => p.$id === id)?.name ?? "Article";
  const stock = (id: string) => (products.find((p) => p.$id === id) ? qtyOf(levels, products.find((p) => p.$id === id)!) : 0);
  const n = /^\d+$/.test(qty) ? Number(qty) : 0; const kitStock = qtyOf(levels, kit);
  const maxAsm = bundleAvailable(comps.map((c) => ({ productId: c.componentId, qty: c.qty })), stock);
  const run = useMutation({
    mutationFn: (type: "assemble" | "disassemble") => api<{ number: string }>(s, "kit.assemble", { requestId: requestId.current, bundleId: kit.$id, qty: n, type }),
    onSuccess: (r, type) => { requestId.current = crypto.randomUUID(); setErr(""); setMsg(`${type === "assemble" ? "Assemblage" : "Démontage"} enregistré (${r.number}).`); void qc.invalidateQueries(); void orders.refetch(); onDone(); },
    onError: (e) => { setMsg(""); setErr((e as Error).message); },
  });
  return (
    <Sheet title={`Assemblage · ${kit.name}`} onClose={onClose} back>
      <div className="card text-sm flex flex-col gap-1"><div className="flex justify-between"><span className="text-white/50">Kits en stock</span><b>{formatQty(kitStock)}</b></div><div className="flex justify-between"><span className="text-white/50">Assemblables avec le stock actuel</span><b>{formatQty(maxAsm)}</b></div></div>
      <label className="flex flex-col gap-1 text-sm"><span className="text-white/60">Nombre de kits</span><input className="input" inputMode="numeric" value={qty} onChange={(e) => { setQty(e.target.value); setMsg(""); }} /></label>
      {n > 0 && <div className="card text-sm flex flex-col gap-1"><b>Composants concernés</b>{comps.map((c) => <div key={c.$id} className="flex justify-between gap-2"><span className="truncate">{name(c.componentId)}</span><span className={stock(c.componentId) < c.qty * n ? "text-red-300" : "text-white/70"}>{c.qty * n} (stock {formatQty(stock(c.componentId))})</span></div>)}</div>}
      {err && <p className="text-red-400 text-sm" role="alert">{err}</p>}{msg && <p className="text-emerald-300 text-sm" role="status">{msg}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button className="btn" disabled={run.isPending || n < 1 || n > maxAsm} onClick={() => run.mutate("assemble")}>Assembler</button>
        <button className="btn-ghost" disabled={run.isPending || n < 1 || n > kitStock} onClick={() => run.mutate("disassemble")}>Démonter</button>
      </div>
      <p className="text-xs text-white/50">Assembler retire les composants du stock et ajoute les kits (coût moyen mis à jour). Démonter fait l'inverse.</p>
      <h3 className="font-semibold">Historique</h3>
      {!orders.data?.length ? <p className="text-sm text-white/50">Aucun ordre.</p> : orders.data.map((o) => <div key={o.$id} className="flex justify-between gap-2 text-sm border-t border-[var(--line)] pt-1"><span>{o.number}</span><span className="text-white/60">{o.type === "assemble" ? "+" : "−"}{o.qty} kit{o.qty > 1 ? "s" : ""}{o.status === "pending" ? " · en cours" : ""}</span></div>)}
    </Sheet>
  );
}
