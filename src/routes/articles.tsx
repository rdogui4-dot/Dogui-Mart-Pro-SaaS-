import { useEffect, useRef, useState, type ReactNode } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Archive, Camera, ChevronLeft, Grid2x2, Image as ImageIcon, List, Lock, Pencil, Plus, ScanLine, Search, Trash2, Undo2, X } from "lucide-react";
import { api } from "@/lib/api";
import { listAll, list, stockLevels, type Product, type Supplier } from "@/lib/data";
import { compressImage, fetchArticles, fetchPriceHistory, useArticleImage, type ArticleRow, type Filters } from "@/lib/articles";
import { can, useSession } from "@/lib/session";
import { Scanner } from "@/components/Scanner";
import { formatFcfa } from "@/domain/money";
import { UNITS, marginOf, sellsAtLoss, unitLabel } from "@/domain/articles";
import { FEATURES, PRO_LOCKED, planAllows } from "@/domain/features";
import { isLow } from "@/domain/stock";
import { useSubscription } from "./subscription";

const SORTS: [Filters["sort"], string][] = [["name_asc", "Nom A → Z"], ["name_desc", "Nom Z → A"], ["new", "Plus récents"], ["old", "Plus anciens"]];
const goUpgrade = () => window.location.assign(`${import.meta.env.BASE_URL}reglages?onglet=abonnement&formule=pro`);

export function ArticlesPage() {
  const sub = useSubscription();
  if (sub.isLoading) return <p className="text-white/50">Chargement…</p>;
  if (sub.error) return <p className="text-red-400 text-sm">{(sub.error as Error).message}</p>;
  if (!planAllows(sub.data?.entitlement.plan.id, "articles")) return <Upsell />; // droit de FORMULE, indépendant du rôle
  return <Catalogue />;
}

function Upsell() {
  return (
    <div className="flex flex-col gap-4 text-center items-center py-6">
      <Lock className="text-[var(--gold)]" size={36} />
      <h1 className="text-2xl font-bold">Catalogue d'articles</h1>
      <p className="text-white/60 text-sm max-w-xs">Fiches complètes avec photo, catégories, unités, fournisseur principal et historique des prix : inclus dans la formule <b>Business</b>.</p>
      <button className="btn" onClick={() => window.location.assign(`${import.meta.env.BASE_URL}reglages?onglet=abonnement&formule=business`)}>Passer à Business</button>
      <p className="text-xs text-white/40">L'écran Stock reste disponible avec votre formule actuelle.</p>
    </div>
  );
}

function Catalogue() {
  const { session } = useSession(); const s = session!; const qc = useQueryClient();
  const [f, setF] = useState<Filters>({ q: "", status: "active", category: "", sort: "name_asc" });
  const [qInput, setQInput] = useState(""); const [grid, setGrid] = useState(false);
  const [form, setForm] = useState<ArticleRow | "new" | null>(null); const [detail, setDetail] = useState<ArticleRow | null>(null); const [scan, setScan] = useState(false);
  useEffect(() => { const t = setTimeout(() => setF((x) => ({ ...x, q: qInput })), 300); return () => clearTimeout(t); }, [qInput]);
  const filterKey = JSON.stringify(f);
  const page = useInfiniteQuery({
    queryKey: ["articles", s.shopId, filterKey], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchArticles(s, f, pageParam), getNextPageParam: (l) => l.next,
  });
  // Statistiques calculées sur les données réelles : catégories, valeur du stock, alertes (journal de mouvements)
  const stats = useQuery({
    queryKey: ["articles-stats", s.shopId],
    queryFn: async () => ({ all: await listAll<Product>("products", s), levels: await stockLevels(s) }),
  });
  const levels = stats.data?.levels;
  const all = (stats.data?.all ?? []);
  const active = all.filter((p) => !p.archived);
  const categories = [...new Set(all.map((p) => p.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "fr"));
  const value = active.reduce((a, p) => a + Math.max(levels?.get(p.$id) ?? 0, 0) * (p.cost ?? 0), 0);
  const alerts = active.filter((p) => isLow(levels?.get(p.$id) ?? 0, p.minStock ?? 0)).length;
  const rows = page.data?.pages.flatMap((p) => p.rows) ?? [];
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["articles"] }); void qc.invalidateQueries({ queryKey: ["articles-stats"] }); void qc.invalidateQueries({ queryKey: ["products"] }); void qc.invalidateQueries({ queryKey: ["stock"] }); };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Articles</h1>
        <button className="btn flex items-center gap-1 !px-4 !py-2" onClick={() => setForm("new")}><Plus size={18} />Ajouter un article</button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="kpi"><b>{stats.data ? active.length : "…"}</b><span>Actifs</span></div>
        <div className="kpi"><b className={alerts ? "text-red-400" : ""}>{stats.data ? alerts : "…"}</b><span>Alertes</span></div>
        <div className="kpi"><b className="!text-base">{stats.data ? formatFcfa(value) : "…"}</b><span>Valeur stock</span></div>
      </div>
      <div className="flex gap-2">
        <label className="relative flex-1"><Search size={18} className="absolute left-3 top-3.5 text-white/40" />
          <input className="input !pl-10" type="search" aria-label="Rechercher" placeholder="Nom, référence ou code-barres" value={qInput} onChange={(e) => setQInput(e.target.value)} /></label>
        <button className="btn-ghost !px-3" aria-label="Scanner un code-barres" onClick={() => setScan(true)}><ScanLine size={20} /></button>
        <button className="btn-ghost !px-3" aria-label={grid ? "Affichage en liste" : "Affichage en grille"} onClick={() => setGrid(!grid)}>{grid ? <List size={20} /> : <Grid2x2 size={20} />}</button>
      </div>
      <div className="scroll-x" role="group" aria-label="Filtres">
        {(["active", "archived", "all"] as const).map((st) => <button key={st} className="chip" aria-current={f.status === st} onClick={() => setF({ ...f, status: st })}>{{ active: "Actifs", archived: "Archivés", all: "Tous" }[st]}</button>)}
        <select aria-label="Catégorie" className="chip" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">Toutes catégories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <select aria-label="Tri" className="chip" value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value as Filters["sort"] })}>{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </div>

      {page.isLoading && <div className="flex flex-col gap-2" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="card h-20 animate-pulse" />)}</div>}
      {page.error && <div className="card text-sm"><p className="text-red-400">Chargement impossible : {(page.error as Error).message}</p><button className="btn-ghost mt-2" onClick={() => void page.refetch()}>Réessayer</button></div>}
      {!page.isLoading && !page.error && rows.length === 0 && (
        <div className="card text-center text-sm text-white/60 flex flex-col gap-2 items-center">
          {f.q || f.category || f.status !== "active" ? <p>Aucun article ne correspond à cette recherche.</p> : <><p>Votre catalogue est vide.</p><button className="btn" onClick={() => setForm("new")}>Ajouter mon premier article</button></>}
        </div>
      )}
      <ul className={grid ? "grid grid-cols-2 gap-2" : "flex flex-col gap-2"}>
        {rows.map((a) => <ArticleCard key={a.$id} a={a} qty={levels ? levels.get(a.$id) ?? 0 : undefined} grid={grid} onOpen={() => setDetail(a)} />)}
      </ul>
      {page.hasNextPage && <button className="btn-ghost" disabled={page.isFetchingNextPage} onClick={() => void page.fetchNextPage()}>{page.isFetchingNextPage ? "Chargement…" : "Voir plus d'articles"}</button>}
      <ProLocks />

      {detail && <ArticleDetail a={rows.find((r) => r.$id === detail.$id) ?? detail} qty={levels?.get(detail.$id) ?? 0} onClose={() => setDetail(null)} onEdit={() => { setForm(detail); setDetail(null); }} onChanged={refresh} />}
      {form && <ArticleForm initial={form === "new" ? null : form} qty={form === "new" ? 0 : levels?.get(form.$id) ?? 0} onClose={() => setForm(null)} onSaved={() => { refresh(); }} />}
      {scan && <Scanner onCode={(c) => { setQInput(c); setScan(false); }} onClose={() => setScan(false)} />}
    </div>
  );
}

function Thumb({ id, size = 64, className = "" }: { id?: string; size?: number; className?: string }) {
  const url = useArticleImage(id, size >= 120 ? 400 : 160);
  return url ? <img src={url} alt="" className={`object-cover rounded-2xl ${className}`} style={{ width: size, height: size }} /> : <div className={`rounded-2xl bg-white/5 flex items-center justify-center text-white/30 ${className}`} style={{ width: size, height: size }}><ImageIcon size={size / 3} /></div>;
}

function ArticleCard({ a, qty, grid, onOpen }: { a: ArticleRow; qty?: number; grid: boolean; onOpen: () => void }) {
  const low = qty !== undefined && isLow(qty, a.minStock ?? 0);
  return (
    <li>
      <button onClick={onOpen} className={`tile w-full text-left ${grid ? "" : "!flex-row items-center gap-3"} ${a.archived ? "opacity-60" : ""}`}>
        <Thumb id={a.imageFileId} size={grid ? 96 : 56} className={grid ? "self-center" : ""} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold truncate">{a.name}</div>
          <div className="text-xs text-white/50 truncate">{[a.sku, a.category].filter(Boolean).join(" · ") || "—"}</div>
          <div className="flex items-center justify-between mt-1"><span className="gold-text font-bold">{formatFcfa(a.price)}</span>
            <span className={`text-xs rounded-full px-2 py-0.5 ${low ? "bg-red-500/20 text-red-300" : "bg-white/10 text-white/70"}`}>{qty === undefined ? "…" : `${qty} ${unitLabel(a.unit).toLowerCase()}`}</span></div>
          {a.archived && <span className="text-xs text-amber-300">Archivé</span>}
        </div>
      </button>
    </li>
  );
}

function Sheet({ title, onClose, children, back }: { title: string; onClose: () => void; children: ReactNode; back?: boolean }) {
  return (
    <div className="fixed inset-0 z-40 bg-[var(--bg)] overflow-y-auto" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-3 bg-[var(--surface)] border-b border-[var(--line)]">
        <button className="p-2" aria-label="Fermer" onClick={onClose}>{back ? <ChevronLeft /> : <X />}</button><h2 className="font-bold truncate">{title}</h2>
      </div>
      <div className="p-4 pb-28 flex flex-col gap-3 max-w-md mx-auto">{children}</div>
    </div>
  );
}

function Confirm({ text, confirmLabel, danger, onYes, onNo }: { text: string; confirmLabel: string; danger?: boolean; onYes: () => void; onNo: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-4" role="alertdialog" aria-modal="true">
      <div className="card w-full max-w-sm flex flex-col gap-3"><p>{text}</p>
        <div className="flex gap-2"><button className="btn-ghost flex-1" onClick={onNo}>Annuler</button><button className={`flex-1 ${danger ? "btn-ghost !border-red-400 !text-red-300" : "btn"}`} onClick={onYes}>{confirmLabel}</button></div></div>
    </div>
  );
}

function ArticleDetail({ a, qty, onClose, onEdit, onChanged }: { a: ArticleRow; qty: number; onClose: () => void; onEdit: () => void; onChanged: () => void }) {
  const { session } = useSession(); const s = session!;
  const sup = useQuery({ queryKey: ["supplier", a.supplierId], enabled: !!a.supplierId && can(s, "purchases"), queryFn: async () => (await list<Supplier>("suppliers", s, [], 200)).find((x) => x.$id === a.supplierId) });
  const hist = useQuery({ queryKey: ["price-history", a.$id], queryFn: () => fetchPriceHistory(s, a.$id) });
  const [ask, setAsk] = useState<null | "archive" | "restore" | "delete" | "count">(null); const [counted, setCounted] = useState(""); const [err, setErr] = useState("");
  const m = marginOf(a.price, a.cost ?? 0); const loss = sellsAtLoss(a.price, a.cost ?? 0);
  const act = useMutation({
    mutationFn: async (kind: "archive" | "restore" | "delete" | "count") => {
      if (kind === "delete") return api(s, "article.delete", { id: a.$id });
      if (kind === "count") return api(s, "stock.adjust", { productId: a.$id, counted: Number(counted) });
      return api(s, "article.archive", { id: a.$id, archived: kind === "archive" });
    },
    onSuccess: (_r, kind) => { setAsk(null); setErr(""); onChanged(); if (kind === "delete") onClose(); },
    onError: (e) => { setAsk(null); setErr((e as Error).message); },
  });
  const canDelete = s.role === "owner" || s.role === "manager";
  const row = (k: string, v: ReactNode) => <div className="flex justify-between gap-3 text-sm py-1.5 border-b border-[var(--line)]"><span className="text-white/50">{k}</span><span className="text-right">{v || "—"}</span></div>;
  return (
    <Sheet title={a.name} onClose={onClose} back>
      <Thumb id={a.imageFileId} size={160} className="self-center" />
      {a.archived && <p className="text-amber-300 text-sm text-center">Article archivé : il n'apparaît plus dans les actifs.</p>}
      <div className="card">
        {row("Référence", a.sku)}{row("Code-barres", a.barcode)}{row("Catégorie", a.category)}{row("Unité de vente", unitLabel(a.unit))}
        {row("Fournisseur principal", sup.data?.name ?? (a.supplierId && !can(s, "purchases") ? "Non visible avec vos accès" : ""))}
        {row("Prix de vente", <b className="gold-text">{formatFcfa(a.price)}</b>)}{row("Prix d'achat", a.cost ? formatFcfa(a.cost) : "")}
        {row("Marge brute indicative", a.cost ? `${formatFcfa(m.amount)}${m.pct !== null ? ` (${m.pct} %)` : ""}` : "Prix d'achat non renseigné")}
        {row("Stock", <b className={isLow(qty, a.minStock ?? 0) ? "text-red-400" : ""}>{qty} {unitLabel(a.unit).toLowerCase()}</b>)}{row("Seuil d'alerte", a.minStock ?? 0)}
      </div>
      {loss && <p className="flex gap-2 text-sm text-amber-300"><AlertTriangle size={18} />Le prix de vente est inférieur au prix d'achat : chaque vente se fait à perte.</p>}
      {a.description && <div className="card text-sm whitespace-pre-line">{a.description}</div>}
      <div className="card"><h3 className="font-semibold mb-1">Historique des prix</h3>
        {hist.isLoading ? <p className="text-sm text-white/50">Chargement…</p> : hist.error ? <p className="text-sm text-red-400">{(hist.error as Error).message}</p> : !hist.data?.length ? <p className="text-sm text-white/50">Aucune modification enregistrée.</p> :
          <ul className="text-sm flex flex-col gap-1">{hist.data.map((h) => <li key={h.$id} className="flex justify-between gap-2"><span className="text-white/50">{new Date(h.$createdAt).toLocaleDateString("fr-FR")}</span>
            <span className="text-right">{h.oldPrice ? `${formatFcfa(h.oldPrice)} → ` : "Création : "}{formatFcfa(h.newPrice ?? 0)}<span className="text-white/40"> · achat {formatFcfa(h.newCost ?? 0)}</span></span></li>)}</ul>}
        <p className="text-xs text-white/40 mt-2">Les ventes déjà enregistrées gardent le prix du jour de la vente.</p></div>
      {err && <p className="text-red-400 text-sm">{err}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button className="btn flex items-center justify-center gap-2" onClick={onEdit}><Pencil size={18} />Modifier</button>
        <button className="btn-ghost" onClick={() => { setCounted(String(qty)); setAsk("count"); }}>Compter le stock</button>
        {a.archived ? <button className="btn-ghost flex items-center justify-center gap-2" onClick={() => setAsk("restore")}><Undo2 size={18} />Restaurer</button> : <button className="btn-ghost flex items-center justify-center gap-2" onClick={() => setAsk("archive")}><Archive size={18} />Archiver</button>}
        {canDelete && <button className="btn-ghost !text-red-300 flex items-center justify-center gap-2" onClick={() => setAsk("delete")}><Trash2 size={18} />Supprimer</button>}
      </div>
      {ask === "archive" && <Confirm text={`Archiver « ${a.name} » ? Il ne sera plus proposé à la vente, son historique est conservé.`} confirmLabel="Archiver" onNo={() => setAsk(null)} onYes={() => act.mutate("archive")} />}
      {ask === "restore" && <Confirm text={`Restaurer « ${a.name} » ?`} confirmLabel="Restaurer" onNo={() => setAsk(null)} onYes={() => act.mutate("restore")} />}
      {ask === "delete" && <Confirm danger text={`Supprimer définitivement « ${a.name} » ? Possible seulement s'il n'a jamais été vendu, commandé ni transféré.`} confirmLabel="Supprimer" onNo={() => setAsk(null)} onYes={() => act.mutate("delete")} />}
      {ask === "count" && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-end justify-center p-4"><div className="card w-full max-w-sm flex flex-col gap-3">
          <p>Inventaire de « {a.name} » : quantité réellement comptée ?</p>
          <input className="input" inputMode="numeric" autoFocus value={counted} onChange={(e) => setCounted(e.target.value)} />
          <p className="text-xs text-white/50">Stock enregistré : {qty}. L'écart sera tracé comme mouvement d'inventaire.</p>
          <div className="flex gap-2"><button className="btn-ghost flex-1" onClick={() => setAsk(null)}>Annuler</button><button className="btn flex-1" disabled={act.isPending || !/^\d+$/.test(counted)} onClick={() => act.mutate("count")}>Valider</button></div></div></div>
      )}
    </Sheet>
  );
}

function ArticleForm({ initial, qty, onClose, onSaved }: { initial: ArticleRow | null; qty: number; onClose: () => void; onSaved: () => void }) {
  const { session } = useSession(); const s = session!;
  const edit = !!initial; const requestId = useRef(crypto.randomUUID());
  const [f, setF] = useState({
    name: initial?.name ?? "", sku: initial?.sku ?? "", barcode: initial?.barcode ?? "", category: initial?.category ?? "", description: initial?.description ?? "",
    price: initial ? String(initial.price) : "", cost: initial?.cost ? String(initial.cost) : "", unit: initial?.unit ?? "piece", minStock: String(initial?.minStock ?? 5), supplierId: initial?.supplierId ?? "", qty: "",
  });
  const [photo, setPhoto] = useState<File | null>(null); const [removePhoto, setRemovePhoto] = useState(false); const [preview, setPreview] = useState<string | null>(null);
  const [scan, setScan] = useState(false); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [done, setDone] = useState("");
  const suppliers = useQuery({ queryKey: ["suppliers-pick", s.shopId], enabled: can(s, "purchases"), queryFn: () => list<Supplier>("suppliers", s, [], 200) });
  const cats = useQuery({ queryKey: ["articles-stats", s.shopId], queryFn: async () => ({ all: await listAll<Product>("products", s), levels: await stockLevels(s) }) });
  const categories = [...new Set((cats.data?.all ?? []).map((p) => p.category).filter((c): c is string => !!c))];
  useEffect(() => { if (!photo) { setPreview(null); return; } const u = URL.createObjectURL(photo); setPreview(u); return () => URL.revokeObjectURL(u); }, [photo]);
  const price = Number(f.price) || 0, cost = Number(f.cost) || 0; const m = marginOf(price, cost);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const numeric = (v: string) => v === "" || /^\d+$/.test(v.replace(/\s/g, ""));
  const valid = f.name.trim() && f.price !== "" && numeric(f.price) && numeric(f.cost) && numeric(f.minStock) && (edit || numeric(f.qty));
  const existingPhoto = useArticleImage(initial?.imageFileId, 400);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(""); setDone("");
    let id = initial?.$id ?? "";
    try {
      const data = { name: f.name, sku: f.sku, barcode: f.barcode, category: f.category, description: f.description, price: f.price.replace(/\s/g, ""), cost: f.cost.replace(/\s/g, ""), unit: f.unit, minStock: f.minStock, supplierId: f.supplierId };
      const r = await api<{ id: string }>(s, "article.save", edit ? { id, data } : { requestId: requestId.current, data, initialQty: f.qty ? Number(f.qty) : 0 });
      id = r.id; onSaved();
    } catch (x) { setErr((x as Error).message); setBusy(false); return; }
    try { // la photo n'est confirmée qu'après réponse positive du serveur
      if (photo) await api(s, "article.image", { id, data: await compressImage(photo) });
      else if (removePhoto && initial?.imageFileId) await api(s, "article.image", { id, data: null });
      onSaved(); setDone(edit ? "Article modifié." : "Article créé."); setBusy(false); setTimeout(onClose, 700);
    } catch (x) {
      setBusy(false); setErr(`L'article est enregistré, mais la photo a échoué : ${(x as Error).message}`); onSaved();
      if (!edit) { requestId.current = crypto.randomUUID(); }
    }
  }
  const lbl = (t: string, c: ReactNode) => <label className="flex flex-col gap-1 text-sm"><span className="text-white/60">{t}</span>{c}</label>;
  return (
    <Sheet title={edit ? "Modifier l'article" : "Nouvel article"} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          {preview ? <img src={preview} alt="Aperçu" className="w-24 h-24 rounded-2xl object-cover" /> : removePhoto ? <Thumb size={96} /> : <Thumb id={initial?.imageFileId} size={96} />}
          <div className="flex flex-col gap-2 flex-1">
            <label className="btn-ghost flex items-center justify-center gap-2 cursor-pointer text-sm"><Camera size={18} />Prendre une photo<input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { setPhoto(e.target.files?.[0] ?? null); setRemovePhoto(false); }} /></label>
            <label className="btn-ghost flex items-center justify-center gap-2 cursor-pointer text-sm"><ImageIcon size={18} />Galerie<input type="file" accept="image/*" className="sr-only" onChange={(e) => { setPhoto(e.target.files?.[0] ?? null); setRemovePhoto(false); }} /></label>
            {(photo || (initial?.imageFileId && existingPhoto && !removePhoto)) && <button type="button" className="text-xs text-red-300 text-left" onClick={() => { setPhoto(null); setRemovePhoto(true); }}>Retirer la photo</button>}
          </div>
        </div>
        {lbl("Désignation *", <input className="input" required maxLength={160} value={f.name} onChange={set("name")} />)}
        <div className="grid grid-cols-2 gap-2">
          {lbl("Référence / SKU", <input className="input" maxLength={64} value={f.sku} onChange={set("sku")} />)}
          {lbl("Catégorie", <><input className="input" list="cats" maxLength={80} value={f.category} onChange={set("category")} /><datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></>)}
        </div>
        {lbl("Code-barres", <div className="flex gap-2"><input className="input" maxLength={64} value={f.barcode} onChange={set("barcode")} /><button type="button" className="btn-ghost" aria-label="Scanner" onClick={() => setScan(true)}><ScanLine size={20} /></button></div>)}
        <div className="grid grid-cols-2 gap-2">
          {lbl("Prix de vente (FCFA) *", <input className="input" inputMode="numeric" required value={f.price} onChange={set("price")} />)}
          {lbl("Prix d'achat (FCFA)", <input className="input" inputMode="numeric" value={f.cost} onChange={set("cost")} />)}
        </div>
        {f.price !== "" && <p className={`text-sm ${sellsAtLoss(price, cost) ? "text-amber-300" : "text-white/60"}`}>{sellsAtLoss(price, cost) ? <><AlertTriangle size={14} className="inline mr-1" />Prix de vente inférieur au prix d'achat : vente à perte.</> : cost ? `Marge brute indicative : ${formatFcfa(m.amount)}${m.pct !== null ? ` (${m.pct} %)` : ""}` : "Renseignez le prix d'achat pour voir la marge."}</p>}
        <div className="grid grid-cols-2 gap-2">
          {lbl("Unité de vente", <select className="input" value={f.unit} onChange={set("unit")}>{UNITS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</select>)}
          {lbl("Seuil d'alerte", <input className="input" inputMode="numeric" value={f.minStock} onChange={set("minStock")} />)}
        </div>
        {edit ? <p className="text-sm text-white/50">Stock actuel : <b>{qty}</b>. Pour le corriger, utilisez « Compter le stock » sur la fiche (mouvement d'inventaire tracé).</p> : lbl("Quantité en stock (initiale)", <input className="input" inputMode="numeric" value={f.qty} onChange={set("qty")} />)}
        {can(s, "purchases") && lbl("Fournisseur principal (facultatif)", <select className="input" value={f.supplierId} onChange={set("supplierId")}><option value="">Aucun</option>{(suppliers.data ?? []).map((x) => <option key={x.$id} value={x.$id}>{x.name}</option>)}</select>)}
        {lbl("Description", <textarea className="input" rows={3} maxLength={1000} value={f.description} onChange={set("description")} />)}
        {err && <p className="text-red-400 text-sm" role="alert">{err}</p>}
        {done && <p className="text-emerald-400 text-sm" role="status">{done}</p>}
        <button className="btn" disabled={busy || !valid}>{busy ? "Enregistrement…" : edit ? "Enregistrer" : "Créer l'article"}</button>
      </form>
      {scan && <Scanner onCode={(c) => { setF((x) => ({ ...x, barcode: c })); setScan(false); }} onClose={() => setScan(false)} />}
    </Sheet>
  );
}

function ProLocks() {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section aria-label="Fonctions Pro" className="card flex flex-col gap-2 mt-2">
      <h2 className="font-semibold flex items-center gap-2"><Lock size={16} className="text-[var(--gold)]" />Avec la formule Pro</h2>
      <ul className="flex flex-col gap-1">
        {PRO_LOCKED.map((k) => (
          <li key={k}><button className="w-full flex justify-between items-center text-sm py-2 border-b border-[var(--line)] text-white/70" onClick={() => setOpen(open === k ? null : k)}><span>{FEATURES[k].label}</span><Lock size={14} className="text-white/40" /></button>
            {open === k && <div className="text-xs text-white/60 py-2 flex flex-col gap-2"><p>{FEATURES[k].help} Disponible avec la formule Pro.</p><button className="btn !py-2" onClick={goUpgrade}>Passer à Pro</button></div>}</li>
        ))}
      </ul>
    </section>
  );
}
