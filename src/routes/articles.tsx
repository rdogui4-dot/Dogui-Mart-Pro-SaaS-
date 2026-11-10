import { useEffect, useRef, useState, type ReactNode } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Archive, Camera, Grid2x2, Image as ImageIcon, List, Lock, Pencil, Plus, ScanLine, Search, Trash2, Undo2, X } from "lucide-react";
import { api } from "@/lib/api";
import { DATABASE_ID, Query, tables } from "@/lib/appwrite";
import { list, qtyOf, variantQty, type Supplier, type UnitRow, type VariantRow } from "@/lib/data";
import { VariantsSheet } from "./variants";
import { ClaimsBlock } from "./reclamations";
import { LotsSheet, SerialsSheet } from "./tracking";
import { useProductsAll, useStockLevels, useVariantsAll } from "@/lib/queries";
import { TRACKING_MODES, trackingOf } from "@/domain/tracking";
import { PricingSheet, useRules } from "./pricing";
import { ProfitSheet, SuppliersSheet, useLinks } from "./costing";
import { getShop } from "@/lib/data";
import { marginStats } from "@/domain/costing";
import { compressImage, fetchArticles, fetchPriceHistory, useArticleImage, type ArticleRow, type Filters } from "@/lib/articles";
import { can, useSession } from "@/lib/session";
import { Scanner } from "@/components/Scanner";
import { Confirm, Sheet, Thumb } from "@/components/ui";
import { formatFcfa } from "@/domain/money";
import { UNITS, marginOf, sellsAtLoss, unitLabel } from "@/domain/articles";
import { FEATURES, PRO_LOCKED, planAllows } from "@/domain/features";
import { isLow } from "@/domain/stock";
import { SCALES, formatQty, scaleLabel, scaleOf } from "@/domain/quantity";
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
  const sub = useSubscription(); const pro = planAllows(sub.data?.entitlement.plan.id, "packaging");
  const [f, setF] = useState<Filters>({ q: "", status: "active", category: "", sort: "name_asc" });
  const [qInput, setQInput] = useState(""); const [grid, setGrid] = useState(false);
  const [profitOpen, setProfitOpen] = useState(false); const proProfit = planAllows(sub.data?.entitlement.plan.id, "profitability");
  const [form, setForm] = useState<ArticleRow | "new" | null>(null); const [detail, setDetail] = useState<ArticleRow | null>(null); const [scan, setScan] = useState(false); const [autoOpen, setAutoOpen] = useState(false);
  useEffect(() => { const t = setTimeout(() => setF((x) => ({ ...x, q: qInput })), 300); return () => clearTimeout(t); }, [qInput]);
  const filterKey = JSON.stringify(f);
  const page = useInfiniteQuery({
    queryKey: ["articles", s.shopId, filterKey], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchArticles(s, f, pageParam), getNextPageParam: (l) => l.next,
  });
  // Statistiques calculées sur les données réelles : catégories, valeur du stock, alertes (journal de mouvements)
  const prodQ = useProductsAll(); const varQ = useVariantsAll(); const lvlQ = useStockLevels();
  const stats = { data: prodQ.data && varQ.data && lvlQ.data ? { all: prodQ.data, variants: varQ.data, levels: lvlQ.data } : undefined };
  const levels = stats.data?.levels;
  const variants = stats.data?.variants ?? [];
  const liveVariants = variants.filter((v) => !v.archived);
  const all = (stats.data?.all ?? []).filter((p) => p.kind !== "bundle"); // les bundles ont leur propre module
  const active = all.filter((p) => !p.archived);
  const categories = [...new Set(all.map((p) => p.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "fr"));
  // Articles déclinés : valeur et alertes se calculent variante par variante (chacune a son stock, son coût et son seuil)
  const simple = active.filter((p) => !p.hasVariants);
  const scaleById = new Map(all.map((p) => [p.$id, scaleOf(p)]));
  const activeVariants = liveVariants.filter((v) => active.some((p) => p.$id === v.productId && p.hasVariants));
  const value = simple.filter((p) => p.kind !== "bundle").reduce((a, p) => a + Math.max(qtyOf(levels, p), 0) * (p.cost ?? 0), 0) + activeVariants.reduce((a, v) => a + Math.max(variantQty(levels, v, scaleById.get(v.productId)), 0) * (v.cost ?? 0), 0);
  const alerts = simple.filter((p) => p.kind !== "bundle" && isLow(qtyOf(levels, p), p.minStock ?? 0)).length + activeVariants.filter((v) => isLow(variantQty(levels, v, scaleById.get(v.productId)), v.minStock ?? 0)).length;
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
          <input className="input !pl-10" type="search" aria-label="Rechercher" placeholder="Rechercher un article" value={qInput} onChange={(e) => setQInput(e.target.value)} /></label>
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
        {rows.map((a) => <ArticleCard key={a.$id} a={a} nVariants={a.hasVariants ? liveVariants.filter((v) => v.productId === a.$id).length : 0} qty={levels ? qtyOf(levels, a) : undefined} grid={grid} onOpen={() => setDetail(a)} />)}
      </ul>
      {page.hasNextPage && <button className="btn-ghost" disabled={page.isFetchingNextPage} onClick={() => void page.fetchNextPage()}>{page.isFetchingNextPage ? "Chargement…" : "Voir plus d'articles"}</button>}
      {proProfit && <button className="btn-ghost" onClick={() => setProfitOpen(true)}>Rentabilité par article et catégorie</button>}
      {!pro && <ProLocks />}
      {profitOpen && <ProfitSheet onClose={() => setProfitOpen(false)} />}

      {detail && <ArticleDetail autoOpen={autoOpen} a={rows.find((r) => r.$id === detail.$id) ?? detail} qty={qtyOf(levels, detail)} pro={pro} variants={variants.filter((v) => v.productId === detail.$id)} levels={levels} onClose={() => { setDetail(null); setAutoOpen(false); }} onEdit={() => { setForm(detail); setDetail(null); }} onChanged={refresh} />}
      {form && <ArticleForm onCreated={async (id) => { try { const r = (await tables.getRow({ databaseId: DATABASE_ID, tableId: "products", rowId: id })) as unknown as ArticleRow; setAutoOpen(true); setDetail(r); } catch { /* la fiche reste accessible depuis la liste */ } }} initial={form === "new" ? null : form} pro={pro} qty={form === "new" ? 0 : qtyOf(levels, form)} onClose={() => setForm(null)} onSaved={() => { refresh(); }} />}
      {scan && <Scanner onCode={(c) => { setQInput(c); setScan(false); }} onClose={() => setScan(false)} />}
    </div>
  );
}

function ArticleCard({ a, qty, grid, nVariants, onOpen }: { a: ArticleRow; qty?: number; grid: boolean; nVariants: number; onOpen: () => void }) {
  const low = qty !== undefined && isLow(qty, a.minStock ?? 0);
  return (
    <li>
      <button onClick={onOpen} className={`tile w-full text-left ${grid ? "" : "!flex-row items-center gap-3"} ${a.archived ? "opacity-60" : ""}`}>
        <Thumb id={a.imageFileId} size={grid ? 96 : 56} className={grid ? "self-center" : ""} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold truncate">{a.name}</div>
          <div className="text-xs text-white/50 truncate">{[a.sku, a.category, nVariants ? `${nVariants} variante${nVariants > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ") || "—"}</div>
          <div className="flex items-center justify-between mt-1"><span className="gold-text font-bold">{formatFcfa(a.price)}</span>
            <span className={`text-xs rounded-full px-2 py-0.5 ${low ? "bg-red-500/20 text-red-300" : "bg-white/10 text-white/70"}`}>{qty === undefined ? "…" : `${formatQty(qty)} ${unitLabel(a.unit).toLowerCase()}`}</span></div>
          {a.archived && <span className="text-xs text-amber-300">Archivé</span>}
        </div>
      </button>
    </li>
  );
}


type Mv = { id: string; at: string; kind: string; label: string; from: string; to: string; qty: number; ref: string; by: string; note: string };
const fmtMv = (d: string) => (d ? new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
/** Tous les mouvements de l'article (ventes, réceptions, retours, ajustements, transferts, inventaires, lots…), du plus récent au plus ancien, par pages de 50. */
function MovementsBlock({ productId }: { productId: string }) {
  const { session } = useSession(); const s = session!; const [pages, setPages] = useState<string[]>([]);
  const first = useQuery({ queryKey: ["art-moves", s.shopId, productId], retry: 1, queryFn: () => api<{ moves: Mv[]; total: number; next: string | null }>(s, "stk.moves", { productId, limit: 50 }) });
  const more = useQuery({ queryKey: ["art-moves", s.shopId, productId, pages.at(-1)], enabled: pages.length > 0, queryFn: () => api<{ moves: Mv[]; next: string | null }>(s, "stk.moves", { productId, limit: 50, before: pages.at(-1) }) });
  const [acc, setAcc] = useState<Mv[]>([]); const [next, setNext] = useState<string | null | undefined>(undefined);
  useEffect(() => { if (more.data) { setAcc((p) => (p.some((x) => x.id === more.data!.moves[0]?.id) ? p : [...p, ...more.data!.moves])); setNext(more.data.next); } }, [more.data]);
  if (first.error) return null; if (!first.data) return null;
  const all = [...first.data.moves, ...acc]; const nx = next === undefined ? first.data.next : next;
  return (
    <div className="card flex flex-col gap-1"><h3 className="font-semibold">Mouvements de stock ({first.data.total})</h3>
      {all.length === 0 && <p className="text-xs text-white/50">Aucun mouvement enregistré.</p>}
      {all.map((m) => <p key={m.id} className="text-xs text-white/70 border-t border-[var(--line)] pt-1"><span className="text-white/50">{fmtMv(m.at)}</span> · {m.label} · <b className={m.qty < 0 ? "text-red-300" : "text-emerald-300"}>{m.qty > 0 ? "+" : ""}{formatQty(m.qty)}</b>{m.from || m.to ? ` · ${m.from || "?"} → ${m.to || "?"}` : ""}{m.ref ? ` · ${m.ref}` : ""}{m.by ? ` · ${m.by}` : ""}{m.note ? ` · ${m.note}` : ""}</p>)}
      {nx && <button className="btn-ghost" disabled={more.isFetching} onClick={() => setPages((p) => [...p, nx])}>Voir les mouvements plus anciens</button>}
    </div>
  );
}
function ArticleDetail({ autoOpen, a, qty, pro, variants, levels, onClose, onEdit, onChanged }: { autoOpen?: boolean; a: ArticleRow; qty: number; pro: boolean; variants: VariantRow[]; levels?: Map<string, number>; onClose: () => void; onEdit: () => void; onChanged: () => void }) {
  const { session } = useSession(); const s = session!;
  const sup = useQuery({ queryKey: ["supplier", a.supplierId], enabled: !!a.supplierId && can(s, "purchases"), queryFn: async () => (await tables.getRow({ databaseId: DATABASE_ID, tableId: "suppliers", rowId: a.supplierId! })) as unknown as Supplier });
  const hist = useQuery({ queryKey: ["price-history", a.$id], queryFn: () => fetchPriceHistory(s, a.$id) });
  const [ask, setAsk] = useState<null | "archive" | "restore" | "delete" | "count">(null); const [counted, setCounted] = useState(""); const [err, setErr] = useState(""); const [unitsOpen, setUnitsOpen] = useState(false); const [varsOpen, setVarsOpen] = useState(false); const [priceOpen, setPriceOpen] = useState(false); const [supOpen, setSupOpen] = useState(false); const [lotsOpen, setLotsOpen] = useState(false); const [serOpen, setSerOpen] = useState(false);
  const mode = trackingOf(a); useEffect(() => { if (autoOpen && mode === "lot") setLotsOpen(true); if (autoOpen && mode === "serial") setSerOpen(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const proTracking = planAllows(useSubscription().data?.entitlement.plan.id, mode === "serial" ? "serials" : "lots");
  const proCosting = planAllows(useSubscription().data?.entitlement.plan.id, "costing"); const links = useLinks(a.$id); const shopDoc = useQuery({ queryKey: ["shop"], queryFn: () => getShop(s) }); const method = (shopDoc.data as { costMethod?: string } | null)?.costMethod ?? "cmup";
  const proPricing = planAllows(useSubscription().data?.entitlement.plan.id, "tieredPricing"); const rules = useRules(a.$id);
  const proVariants = planAllows(useSubscription().data?.entitlement.plan.id, "variants");
  const live = variants.filter((v) => !v.archived); const prices = live.map((v) => v.price);
  const units = useQuery({ queryKey: ["units", a.$id], queryFn: async () => ((await tables.listRows({ databaseId: DATABASE_ID, tableId: "article_units", queries: [Query.equal("productId", a.$id), Query.equal("active", true), Query.limit(20)] })).rows as unknown as UnitRow[]) });
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
        {a.hasVariants ? row("Prix de vente", <b className="gold-text">{prices.length ? (Math.min(...prices) === Math.max(...prices) ? formatFcfa(prices[0]!) : `${formatFcfa(Math.min(...prices))} – ${formatFcfa(Math.max(...prices))}`) : "—"}</b>) : <>{row("Prix de vente", <b className="gold-text">{formatFcfa(a.price)}</b>)}{row("Prix d'achat", a.cost ? formatFcfa(a.cost) : "")}
        {row("Marge brute indicative", a.cost ? `${formatFcfa(m.amount)}${m.pct !== null ? ` (${m.pct} %)` : ""}` : "Prix d'achat non renseigné")}{proCosting && a.cost ? <>{row("Taux de marge (sur le coût)", `${(marginStats(a.price, a.cost).markupPct ?? "—").toLocaleString("fr-FR")} %`)}{row("Taux de marque (sur le prix)", `${(marginStats(a.price, a.cost).markPct ?? "—").toLocaleString("fr-FR")} %`)}</> : null}</>}
        {row("Stock", <b className={isLow(qty, a.minStock ?? 0) ? "text-red-400" : ""}>{formatQty(qty)} {unitLabel(a.unit).toLowerCase()}</b>)}{row("Précision des quantités", scaleLabel(a.qtyScale ?? 0))}{row("Seuil d'alerte", a.minStock ?? 0)}
      </div>
      {loss && !a.hasVariants && <p className="flex gap-2 text-sm text-amber-300"><AlertTriangle size={18} />Le prix de vente est inférieur au prix d'achat : chaque vente se fait à perte.</p>}
      {a.description && <div className="card text-sm whitespace-pre-line">{a.description}</div>}
      {can(s, "stock") && <MovementsBlock productId={a.$id} />}
      {can(s, "purchases") && <ClaimsBlock productId={a.$id} />}
      <div className="card"><h3 className="font-semibold mb-1">Historique des prix</h3>
        {hist.isLoading ? <p className="text-sm text-white/50">Chargement…</p> : hist.error ? <p className="text-sm text-red-400">{(hist.error as Error).message}</p> : !hist.data?.length ? <p className="text-sm text-white/50">Aucune modification enregistrée.</p> :
          <ul className="text-sm flex flex-col gap-1">{hist.data.map((h) => <li key={h.$id} className="flex justify-between gap-2"><span className="text-white/50">{new Date(h.$createdAt).toLocaleDateString("fr-FR")}</span>
            <span className="text-right">{h.oldPrice ? `${formatFcfa(h.oldPrice)} → ` : "Création : "}{formatFcfa(h.newPrice ?? 0)}<span className="text-white/40"> · achat {formatFcfa(h.newCost ?? 0)}</span></span></li>)}</ul>}
        <p className="text-xs text-white/40 mt-2">Les ventes déjà enregistrées gardent le prix du jour de la vente.</p></div>
      {(proCosting || !!links.data?.length) && (
        <div className="card"><div className="flex items-center justify-between"><h3 className="font-semibold">Fournisseurs & coûts</h3><button className="text-sm text-[var(--gold)]" onClick={() => setSupOpen(true)}>{proCosting ? "Gérer" : "Voir"}</button></div>
          <p className="text-sm text-white/50 mt-1">{links.data?.length ? `${links.data.length} fournisseur${links.data.length > 1 ? "s" : ""} associé${links.data.length > 1 ? "s" : ""} · coût de revient, comparaison et évolution.` : "Aucun fournisseur associé : comparez vos fournisseurs et suivez l'évolution de vos coûts."}</p>
          {!proCosting && <p className="text-xs text-amber-300 mt-2">Lecture seule (formule Business) : vos données sont conservées ; les frais d'approvisionnement ne sont plus appliqués.</p>}
        </div>
      )}
      {(proPricing || !!rules.data?.length) && (
        <div className="card"><div className="flex items-center justify-between"><h3 className="font-semibold">Tarifs spéciaux</h3><button className="text-sm text-[var(--gold)]" onClick={() => setPriceOpen(true)}>{proPricing ? "Gérer" : "Voir"}</button></div>
          <p className="text-sm text-white/50 mt-1">{rules.data?.length ? `${rules.data.length} tarif${rules.data.length > 1 ? "s" : ""} : promotions, prix de gros, paliers de quantité.` : "Aucun : le prix de base s'applique à tous."}</p>
          {!proPricing && !!rules.data?.length && <p className="text-xs text-amber-300 mt-2">Tarifs désactivés (formule Business) : le prix de base s'applique ; vos tarifs sont conservés.</p>}
        </div>
      )}
      {(proVariants || a.hasVariants) && (
        <div className="card"><div className="flex items-center justify-between"><h3 className="font-semibold">Variantes</h3><button className="text-sm text-[var(--gold)]" onClick={() => setVarsOpen(true)}>{proVariants ? "Gérer" : "Voir"}</button></div>
          {!live.length ? <p className="text-sm text-white/50 mt-1">Aucune variante active.</p> :
            <ul className="text-sm mt-1 flex flex-col gap-1">{live.slice(0, 5).map((v) => <li key={v.$id} className="flex justify-between gap-2"><span className="truncate">{v.label}</span><span className="text-white/60 whitespace-nowrap">{formatQty(variantQty(levels, v, scaleOf(a)))} · {formatFcfa(v.price)}</span></li>)}{live.length > 5 && <li className="text-white/40">+ {live.length - 5} autres…</li>}</ul>}
          {!proVariants && <p className="text-xs text-amber-300 mt-2">Variantes en lecture seule (formule Business) : vos données sont conservées et la vente continue ; la gestion revient avec Pro.</p>}
        </div>
      )}
      {(pro || !!units.data?.length) && (
        <div className="card"><div className="flex items-center justify-between"><h3 className="font-semibold">Conditionnements</h3>{pro && <button className="text-sm text-[var(--gold)]" onClick={() => setUnitsOpen(true)}>Modifier</button>}</div>
          {!units.data?.length ? <p className="text-sm text-white/50 mt-1">Vendu uniquement en {unitLabel(a.unit).toLowerCase()}.</p> :
            <ul className="text-sm mt-1 flex flex-col gap-1">{units.data.map((u) => <li key={u.$id} className="flex justify-between"><span>1 {unitLabel(u.unit).toLowerCase()} = {formatQty(u.factor)} {unitLabel(a.unit).toLowerCase()}</span><span className="gold-text font-semibold">{formatFcfa(Math.round(a.price * u.factor * 1e6) / 1e6)}</span></li>)}</ul>}
          {!pro && <p className="text-xs text-amber-300 mt-2">Conditionnements désactivés (formule Business) : vos données sont conservées, la vente se fait en {unitLabel(a.unit).toLowerCase()}.</p>}
        </div>
      )}
      {err && <p className="text-red-400 text-sm">{err}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button className="btn flex items-center justify-center gap-2" onClick={onEdit}><Pencil size={18} />Modifier</button>
        {mode ? <button className="btn-ghost" onClick={() => (mode === "lot" ? setLotsOpen(true) : setSerOpen(true))}>{mode === "lot" ? "Lots & péremption" : "Numéros de série"}</button> : null}
        {!mode && <button className="btn-ghost" onClick={() => { if (a.hasVariants) { setVarsOpen(true); return; } setCounted(String(qty).replace(".", ",")); setAsk("count"); }}>{a.hasVariants ? "Stock par variante" : "Compter le stock"}</button>}
        {a.archived ? <button className="btn-ghost flex items-center justify-center gap-2" onClick={() => setAsk("restore")}><Undo2 size={18} />Restaurer</button> : <button className="btn-ghost flex items-center justify-center gap-2" onClick={() => setAsk("archive")}><Archive size={18} />Archiver</button>}
        {canDelete && <button className="btn-ghost !text-red-300 flex items-center justify-center gap-2" onClick={() => setAsk("delete")}><Trash2 size={18} />Supprimer</button>}
      </div>
      {ask === "archive" && <Confirm text={`Archiver « ${a.name} » ? Il ne sera plus proposé à la vente, son historique est conservé.`} confirmLabel="Archiver" onNo={() => setAsk(null)} onYes={() => act.mutate("archive")} />}
      {ask === "restore" && <Confirm text={`Restaurer « ${a.name} » ?`} confirmLabel="Restaurer" onNo={() => setAsk(null)} onYes={() => act.mutate("restore")} />}
      {ask === "delete" && <Confirm danger text={`Supprimer définitivement « ${a.name} » ? Possible seulement s'il n'a jamais été vendu, commandé ni transféré.`} confirmLabel="Supprimer" onNo={() => setAsk(null)} onYes={() => act.mutate("delete")} />}
      {ask === "count" && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-end justify-center p-4"><div className="card w-full max-w-sm flex flex-col gap-3">
          <p>Inventaire de « {a.name} » : quantité réellement comptée ?</p>
          <input className="input" inputMode="decimal" autoFocus value={counted} onChange={(e) => setCounted(e.target.value)} />
          <p className="text-xs text-white/50">Stock enregistré : {formatQty(qty)}. L'écart sera tracé comme mouvement d'inventaire.</p>
          <div className="flex gap-2"><button className="btn-ghost flex-1" onClick={() => setAsk(null)}>Annuler</button><button className="btn flex-1" disabled={act.isPending || !/^\d+([.,]\d{1,3})?$/.test(counted)} onClick={() => act.mutate("count")}>Valider</button></div></div></div>
      )}
      {lotsOpen && <LotsSheet a={a} canManage={proTracking && can(s, "stock")} onClose={() => setLotsOpen(false)} onChanged={onChanged} />}
      {serOpen && <SerialsSheet a={a} canManage={proTracking && can(s, "stock")} onClose={() => setSerOpen(false)} onChanged={onChanged} />}
      {supOpen && <SuppliersSheet a={a} variants={variants} canManage={proCosting} method={method} onClose={() => setSupOpen(false)} onChanged={() => { void links.refetch(); onChanged(); }} />}
      {priceOpen && <PricingSheet a={a} variants={variants} units={units.data ?? []} canManage={proPricing} onClose={() => setPriceOpen(false)} onChanged={() => { void rules.refetch(); onChanged(); }} />}
      {varsOpen && <VariantsSheet a={a} variants={variants} levels={levels} canManage={proVariants} onClose={() => setVarsOpen(false)} onChanged={onChanged} />}
      {unitsOpen && <UnitsEditor a={a} current={units.data ?? []} onClose={() => setUnitsOpen(false)} onSaved={() => { void units.refetch(); onChanged(); }} />}
    </Sheet>
  );
}

/** Conditionnements : « 1 carton = 12 pièces ». Le prix équivalent est calculé à partir du prix de l'unité de base. */
function UnitsEditor({ a, current, onClose, onSaved }: { a: ArticleRow; current: UnitRow[]; onClose: () => void; onSaved: () => void }) {
  const { session } = useSession(); const s = session!;
  const base = a.unit || "piece"; const scale = a.qtyScale ?? 0;
  const [rows, setRows] = useState<{ unit: string; factor: string }[]>(current.map((u) => ({ unit: u.unit, factor: String(u.factor).replace(".", ",") })));
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [done, setDone] = useState("");
  const choices = UNITS.filter((u) => u.id !== base);
  const set = (i: number, p: Partial<(typeof rows)[number]>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const factorOk = (v: string) => { const n = Number(v.replace(",", ".")); const d = (v.split(/[.,]/)[1] ?? "").length; return n > 0 && d <= scale; };
  async function save() {
    setBusy(true); setErr(""); setDone("");
    try { await api(s, "article.units.save", { productId: a.$id, units: rows.map((r) => ({ unit: r.unit, factor: r.factor.replace(",", ".") })) }); setDone("Conditionnements enregistrés."); onSaved(); setTimeout(onClose, 600); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Sheet title={`Conditionnements · ${a.name}`} onClose={onClose} back>
      <p className="text-sm text-white/60">Unité de base : <b>{unitLabel(base)}</b>. Indiquez combien d'unités de base contient chaque conditionnement.{scale === 0 ? " Cet article se vend à l'unité entière : coefficients entiers." : ` Jusqu'à ${scale} décimale${scale > 1 ? "s" : ""}.`}</p>
      {rows.map((r, i) => (
        <div key={i} className="card flex flex-col gap-2">
          <div className="grid grid-cols-[1fr_6rem_auto] gap-2 items-center">
            <select className="input !px-2" aria-label="Unité" value={r.unit} onChange={(e) => set(i, { unit: e.target.value })}>{choices.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</select>
            <input className="input !px-2" aria-label="Coefficient" inputMode="decimal" placeholder="Coef." value={r.factor} onChange={(e) => set(i, { factor: e.target.value })} />
            <button type="button" className="p-2 text-red-300" aria-label="Retirer" onClick={() => setRows(rows.filter((_, j) => j !== i))}><X size={18} /></button>
          </div>
          <p className={`text-xs ${r.factor && !factorOk(r.factor) ? "text-red-300" : "text-white/50"}`}>{r.factor && factorOk(r.factor) ? `1 ${unitLabel(r.unit).toLowerCase()} = ${r.factor} ${unitLabel(base).toLowerCase()} · ${formatFcfa(Math.round(a.price * Number(r.factor.replace(",", ".")) * 1e6) / 1e6)}` : "Coefficient positif, dans la précision de l'article"}</p>
        </div>
      ))}
      {rows.length < 8 && <button className="btn-ghost" onClick={() => setRows([...rows, { unit: choices.find((u) => !rows.some((r) => r.unit === u.id))?.id ?? choices[0]!.id, factor: "" }])}>+ Ajouter un conditionnement</button>}
      {err && <p className="text-red-400 text-sm" role="alert">{err}</p>}{done && <p className="text-emerald-400 text-sm" role="status">{done}</p>}
      <button className="btn" disabled={busy || rows.some((r) => !factorOk(r.factor))} onClick={() => void save()}>{busy ? "Enregistrement…" : "Enregistrer"}</button>
    </Sheet>
  );
}

function ArticleForm({ initial, qty, pro, onClose, onSaved, onCreated }: { onCreated?: (id: string) => void; initial: ArticleRow | null; qty: number; pro: boolean; onClose: () => void; onSaved: () => void }) {
  const { session } = useSession(); const s = session!;
  const edit = !!initial; const requestId = useRef(crypto.randomUUID());
  const [f, setF] = useState({
    name: initial?.name ?? "", sku: initial?.sku ?? "", barcode: initial?.barcode ?? "", category: initial?.category ?? "", description: initial?.description ?? "",
    price: initial ? String(initial.price) : "", cost: initial?.cost ? String(initial.cost) : "", unit: initial?.unit ?? "piece", minStock: String(initial?.minStock ?? 5), supplierId: initial?.supplierId ?? "", qty: "", qtyScale: String(initial?.qtyScale ?? 0), tracking: trackingOf(initial) as string,
  });
  const [photo, setPhoto] = useState<File | null>(null); const [removePhoto, setRemovePhoto] = useState(false); const [preview, setPreview] = useState<string | null>(null);
  const [scan, setScan] = useState(false); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [done, setDone] = useState("");
  const suppliers = useQuery({ queryKey: ["suppliers-pick", s.shopId], enabled: can(s, "purchases"), queryFn: () => list<Supplier>("suppliers", s, [], 200) });
  const cats = useProductsAll(); const categories = [...new Set((cats.data ?? []).map((p) => p.category).filter((c): c is string => !!c))];
  useEffect(() => { if (!photo) { setPreview(null); return; } const u = URL.createObjectURL(photo); setPreview(u); return () => URL.revokeObjectURL(u); }, [photo]);
  const price = Number(f.price) || 0, cost = Number(f.cost) || 0; const m = marginOf(price, cost);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const numeric = (v: string) => v === "" || /^\d+$/.test(v.replace(/\s/g, ""));
  const decimal = (v: string) => v === "" || (/^\d+([.,]\d{1,3})?$/.test(v.trim()) && (v.split(/[.,]/)[1] ?? "").length <= Number(f.qtyScale));
  const valid = f.name.trim() && f.price !== "" && numeric(f.price) && numeric(f.cost) && numeric(f.minStock) && (edit || decimal(f.qty));
  const existingPhoto = useArticleImage(initial?.imageFileId, 400);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(""); setDone("");
    let id = initial?.$id ?? "";
    try {
      const data = { name: f.name, sku: f.sku, barcode: f.barcode, category: f.category, description: f.description, price: f.price.replace(/\s/g, ""), cost: f.cost.replace(/\s/g, ""), unit: f.unit, minStock: f.minStock, supplierId: f.supplierId, ...(pro || f.tracking !== trackingOf(initial) ? { tracking: f.tracking } : {}), ...(pro || Number(f.qtyScale) !== (initial?.qtyScale ?? 0) ? { qtyScale: Number(f.qtyScale) } : {}) };
      const r = await api<{ id: string }>(s, "article.save", edit ? { id, data } : { requestId: requestId.current, data, initialQty: f.qty ? f.qty.trim() : 0 });
      id = r.id; onSaved();
    } catch (x) { setErr((x as Error).message); setBusy(false); return; }
    try { // la photo n'est confirmée qu'après réponse positive du serveur
      if (photo) await api(s, "article.image", { id, data: await compressImage(photo) });
      else if (removePhoto && initial?.imageFileId) await api(s, "article.image", { id, data: null });
      onSaved(); setDone(edit ? "Article modifié." : "Article créé."); setBusy(false);
      if (!edit && f.tracking) { onCreated?.(id); onClose(); } else setTimeout(onClose, 700); // article suivi : on ouvre directement l'entrée de stock (lots / numéros de série)
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
          {lbl("Référence / SKU", <input className="input" maxLength={64} placeholder={initial?.sku ? "" : "Automatique (DMP-000001-26)"} value={f.sku} onChange={set("sku")} />)}
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
        {pro && lbl("Précision des quantités", <select className="input" value={f.qtyScale} onChange={set("qtyScale")}>{SCALES.map((x) => <option key={x} value={x}>{scaleLabel(x)}</option>)}</select>)}
        {pro && <p className="text-xs text-white/40 -mt-2">Pour vendre au kilo ou au litre. Modifiable seulement tant que l'article n'a aucun mouvement de stock.</p>}
        {pro && lbl("Suivi du stock", <select className="input" value={f.tracking} onChange={set("tracking")}>{TRACKING_MODES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>)}
        {pro && <p className="text-xs text-white/40 -mt-2">Par lot : péremption et prélèvement du plus ancien d'abord. Par numéro de série : une unité = un numéro. Modifiable seulement tant que l'article n'a aucun mouvement de stock.</p>}
        {f.tracking && !edit ? <p className="text-sm text-white/50">Le stock d'un article suivi s'ajoute après création : entrée de lot ou numéros de série.</p> : edit ? <p className="text-sm text-white/50">Stock actuel : <b>{formatQty(qty)}</b>. Pour le corriger, utilisez « Compter le stock » sur la fiche (mouvement d'inventaire tracé).</p> : lbl("Quantité en stock (initiale)", <input className="input" inputMode="decimal" value={f.qty} onChange={set("qty")} />)}
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
