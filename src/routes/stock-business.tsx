import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowRightLeft } from "lucide-react";
import { api } from "@/lib/api";
import { list, listAll, qtyOf, variantQty, type Product, type VariantRow } from "@/lib/data";
import { useStockLevels } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { Confirm, Sheet, Thumb } from "@/components/ui";
import { formatFcfa } from "@/domain/money";
import { formatQty } from "@/domain/quantity";
import { trackingOf } from "@/domain/tracking";
import { isVirtualBundle } from "@/domain/bundles";
import { STATUS_LABEL, XFER_LABEL, type StockStatus, type XferStatus } from "@/domain/stock-intel";

// ------------------------------------------------------------------ types (réponses du serveur)
type Alert = { kind: string; level: "high" | "warn" | "info"; title: string; detail: string; productId?: string; variantId?: string; link?: string };
type Dash = { period: { from: string; to: string }; scope: string; categories: string[]; totals: { articles: number; ok: number; watch: number; low: number; out: number; negative: number; value: number; missingCost: number; inTransitIn: number; inTransitOut: number }; byShop: { shopId: string; shop: string; articles: number; available: number; low: number; out: number; negative: number; value: number; missingCost: number; inTransitIn: number; inTransitOut: number }[]; byLocation: { location: string; articles: number; units: number; value: number }[]; byCategory: { category: string; articles: number; value: number }[]; lastMoves: { at: string; shop: string; article: string; qty: number; label: string; ref: string }[]; alerts: { count: number; top: Alert[] }; missingCostNames: string[]; notes: string[] };
type Hist = { id: string; at: string; kind: string; label: string; from: string; to: string; qty: number; direction: string; ref: string; by: string; note: string };
type Card = { productId: string; variantId: string; name: string; sku: string; barcode: string; category: string; imageFileId: string; unit: string; shop: string; location: string; tracking: string; status: StockStatus; statusLabel: string; settings: { minStock: number; alertStock: number; idleDays: number; location: string }; quantities: { inStock: number; reserved: number; available: number; onOrder: number; inTransitIn: number; inTransitOut: number }; cost: number; price: number; value: number; costMissing: boolean; lastMoveAt: string | null; history: Hist[]; lastReceipts: Hist[]; lastSales: Hist[]; adjustments: Hist[]; lastPurchases: { at: string; supplier: string; ref: string; qty: number; unitCost: number; landedCost: number; method: string }[]; inventories: { at: string; counted: number; diff: number | null; status: string }[]; canCorrect: boolean; note: string };
type Move = { id: string; at: string; kind: string; label: string; from: string; to: string; article: string; productId: string; variantId: string; qty: number; ref: string; by: string; note: string };
type XLine = { index: number; productId: string; variantId: string; name: string; sent: number; received: number; missing: number; left: number };
type Xfer = { id: string; number: string; status: XferStatus; label: string; from: string; fromName: string; to: string; toName: string; lines: XLine[]; totals: { sent: number; received: number; missing: number; inTransit: number }; late: boolean; shippedAt: string; dueOn: string; createdAt: string; closeNote: string; direction: "in" | "out"; history: { key: string; at: string; by: string; lines: { index: number; qty: number }[]; note?: string }[]; moves?: { id: string; kind: string; shop: string; qty: number; at: string; note: string }[]; shippedBy?: string; createdBy?: string };

const TONE: Record<StockStatus, string> = { ok: "text-emerald-300", watch: "text-amber-200", low: "text-amber-300", out: "text-red-400", negative: "text-red-400" };
const LEVEL_TONE = { high: "text-red-300", warn: "text-amber-300", info: "text-sky-300" } as const;
const fmtDay = (d: string) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
const fmtAt = (d: string) => new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const signedQty = (n: number) => `${n > 0 ? "+" : ""}${formatQty(n)}`;
const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 24);
const Err = ({ e }: { e: unknown }) => (e ? <p className="text-red-400 text-sm" role="alert">{(e as Error).message}</p> : null);
const Field = ({ label, children }: { label: string; children: ReactNode }) => <label className="text-xs text-white/60 flex flex-col gap-1">{label}{children}</label>;
const Kpi = ({ label, value, tone = "", hint }: { label: string; value: ReactNode; tone?: string; hint?: string }) => <div className="card"><div className="text-white/50 text-xs">{label}</div><div className={`font-semibold ${tone}`}>{value}</div>{hint && <div className="text-[11px] text-white/40">{hint}</div>}</div>;
const dayOff = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

type Open = (productId: string, variantId?: string) => void;

/** Stock intelligent (Business) : tableau de bord, articles, journal des mouvements, transferts entre boutiques et alertes. Tous les chiffres viennent du serveur. */
export function StockHub({ legacy }: { legacy: (onCard: Open) => ReactNode }) {
  const { session } = useSession(); const s = session!;
  const [tab, setTab] = useState<"dash" | "art" | "mov" | "xfer" | "alert">("dash"); const [card, setCard] = useState<{ productId: string; variantId: string } | null>(null);
  const open: Open = (productId, variantId = "") => setCard({ productId, variantId });
  const alerts = useQuery({ queryKey: ["stk-alerts", s.shopId], retry: 1, queryFn: () => api<{ counts: { high: number; warn: number; info: number } }>(s, "stk.alerts"), staleTime: 30_000 });
  const n = (alerts.data?.counts.high ?? 0) + (alerts.data?.counts.warn ?? 0);
  const tabs: [typeof tab, string][] = [["dash", "Tableau"], ["art", "Articles"], ["mov", "Mouvements"], ["xfer", "Transferts"], ["alert", n ? `Alertes (${n})` : "Alertes"]];
  return (
    <div className="flex flex-col gap-4">
      <h1 className="sr-only">Stock</h1>
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Sections du stock">{tabs.map(([k, l]) => <button key={k} role="tab" className="chip" aria-current={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === "dash" && <Dashboard onOpen={open} onTab={setTab} />}
      {tab === "art" && legacy(open)}
      {tab === "mov" && <Moves onOpen={open} />}
      {tab === "xfer" && <Transfers />}
      {tab === "alert" && <Alerts onOpen={open} onTab={setTab} />}
      {card && <CardSheet productId={card.productId} variantId={card.variantId} onClose={() => setCard(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------ tableau de bord
function Dashboard({ onOpen, onTab }: { onOpen: Open; onTab: (t: "dash" | "art" | "mov" | "xfer" | "alert") => void }) {
  const { session } = useSession(); const s = session!; const owner = s.role === "owner" && s.shops.length > 1;
  const [f, setF] = useState({ category: "", from: dayOff(-29), to: dayOff(0), all: false });
  const q = useQuery({ queryKey: ["stk-dash", s.shopId, f], retry: 1, queryFn: () => api<Dash>(s, "stk.dashboard", { category: f.category || undefined, from: f.from, to: f.to, ...(f.all ? { shopId: "all" } : {}) }) });
  const d = q.data;
  return (
    <div className="flex flex-col gap-3">
      <div className="card grid grid-cols-2 gap-2">
        <Field label="Catégorie"><select className="input" aria-label="Catégorie" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">Toutes</option>{(d?.categories ?? []).map((c) => <option key={c}>{c}</option>)}</select></Field>
        {owner ? <Field label="Boutiques"><select className="input" aria-label="Boutiques" value={f.all ? "all" : "one"} onChange={(e) => setF({ ...f, all: e.target.value === "all" })}><option value="one">Boutique actuelle</option><option value="all">Toutes (consolidé)</option></select></Field> : <span />}
        <Field label="Mouvements du"><input className="input" type="date" aria-label="Du" value={f.from} max={f.to} onChange={(e) => e.target.value && setF({ ...f, from: e.target.value })} /></Field>
        <Field label="au"><input className="input" type="date" aria-label="Au" value={f.to} min={f.from} onChange={(e) => e.target.value && setF({ ...f, to: e.target.value })} /></Field>
      </div>
      {q.isLoading && <p className="text-white/60 text-sm" role="status">Chargement…</p>}
      <Err e={q.error} />
      {d && <>
        <div className="grid grid-cols-2 gap-2">
          <Kpi label="Articles suivis" value={d.totals.articles} />
          <Kpi label="Valeur estimée du stock" value={formatFcfa(d.totals.value)} hint="Quantité × coût configuré (pas un chiffre d'affaires)" />
          <Kpi label="Disponibles" value={d.totals.ok + d.totals.watch} tone="text-emerald-300" />
          <Kpi label="Stock bas" value={d.totals.low} tone="text-amber-300" />
          <Kpi label="En rupture" value={d.totals.out} tone="text-red-400" />
          <Kpi label="Stock négatif" value={d.totals.negative} tone={d.totals.negative ? "text-red-400" : ""} hint={d.totals.negative ? "À corriger" : undefined} />
          <Kpi label="En transit (à recevoir)" value={formatQty(d.totals.inTransitIn)} />
          <Kpi label="En transit (expédié)" value={formatQty(d.totals.inTransitOut)} />
        </div>
        {d.totals.missingCost > 0 && <p className="card text-sm text-amber-300" role="status">{d.totals.missingCost} article(s) en stock sans coût : non valorisés{d.missingCostNames.length ? ` (${d.missingCostNames.slice(0, 5).join(", ")}${d.missingCostNames.length > 5 ? "…" : ""})` : ""}. Renseignez le coût d'achat ou réceptionnez-les.</p>}
        <section className="card flex flex-col gap-1"><h2 className="font-semibold">Par boutique</h2>
          {d.byShop.map((b) => <div key={b.shopId} className="text-sm flex justify-between gap-2 border-t border-[var(--line)] pt-1"><span className="truncate">{b.shop}</span><span className="text-white/60 text-right">{b.articles} art. · {b.low + b.out} alerte(s) · {formatFcfa(b.value)}{b.inTransitIn + b.inTransitOut > 0 ? ` · transit ${formatQty(b.inTransitIn)}↓ ${formatQty(b.inTransitOut)}↑` : ""}</span></div>)}</section>
        <section className="card flex flex-col gap-1"><h2 className="font-semibold">Par emplacement</h2>
          {d.byLocation.map((l) => <div key={l.location} className="text-sm flex justify-between gap-2 border-t border-[var(--line)] pt-1"><span className="truncate">{l.location}</span><span className="text-white/60">{l.articles} art. · {formatQty(l.units)} u. · {formatFcfa(l.value)}</span></div>)}
          <p className="text-xs text-white/40">L'emplacement se renseigne sur la fiche de stock de chaque article.</p></section>
        <section className="card flex flex-col gap-1"><div className="flex justify-between items-center"><h2 className="font-semibold">Alertes ({d.alerts.count})</h2><button className="text-[var(--gold)] text-sm" onClick={() => onTab("alert")}>Tout voir</button></div>
          {d.alerts.top.length === 0 && <p className="text-sm text-white/60">Aucune alerte.</p>}
          {d.alerts.top.map((a, i) => <button key={i} className="text-left text-sm border-t border-[var(--line)] pt-1" onClick={() => (a.productId ? onOpen(a.productId, a.variantId) : onTab("alert"))}><span className={LEVEL_TONE[a.level]}>{a.title}</span></button>)}</section>
        <section className="card flex flex-col gap-1"><div className="flex justify-between items-center"><h2 className="font-semibold">Derniers mouvements</h2><button className="text-[var(--gold)] text-sm" onClick={() => onTab("mov")}>Journal</button></div>
          {d.lastMoves.length === 0 && <p className="text-sm text-white/60">Aucun mouvement sur la période.</p>}
          {d.lastMoves.slice(0, 8).map((m, i) => <p key={i} className="text-xs text-white/70 border-t border-[var(--line)] pt-1"><span className="text-white/50">{fmtAt(m.at)}</span> · {m.label} · {m.article} · <b className={m.qty < 0 ? "text-red-300" : "text-emerald-300"}>{signedQty(m.qty)}</b></p>)}</section>
        <div className="text-[11px] text-white/40 flex flex-col gap-1">{d.notes.map((n) => <p key={n}>{n}</p>)}</div>
      </>}
    </div>
  );
}

// ------------------------------------------------------------------ fiche de stock d'un article
function CardSheet({ productId, variantId, onClose }: { productId: string; variantId: string; onClose: () => void }) {
  const { session } = useSession(); const s = session!; const qc = useQueryClient();
  const q = useQuery({ queryKey: ["stk-card", s.shopId, productId, variantId], retry: 1, queryFn: () => api<Card>(s, "stk.article", { productId, variantId }) });
  const c = q.data; const [mode, setMode] = useState<"" | "fix" | "set">("");
  const refresh = () => { void qc.invalidateQueries(); };
  return (
    <Sheet title={c?.name ?? "Fiche de stock"} onClose={onClose} back>
      {q.isLoading && <p className="text-white/60 text-sm" role="status">Chargement…</p>}
      <Err e={q.error} />
      {c && <>
        <div className="flex gap-3 items-center"><Thumb id={c.imageFileId} size={72} /><div className="min-w-0 text-sm"><div className="text-white/60 truncate">{c.sku ? `Réf. ${c.sku}` : "Sans référence"}{c.barcode ? ` · ${c.barcode}` : ""}</div><div className="text-white/60">{c.shop}{c.location ? ` · ${c.location}` : ""}{c.category ? ` · ${c.category}` : ""}</div><div className={`font-semibold ${TONE[c.status]}`}>{STATUS_LABEL[c.status] ?? c.statusLabel}</div></div></div>
        <div className="grid grid-cols-2 gap-2">
          <Kpi label="En stock (théorique)" value={formatQty(c.quantities.inStock)} tone={TONE[c.status]} hint="Calculé depuis les mouvements" />
          <Kpi label="Disponible" value={formatQty(c.quantities.available)} hint="En stock − réservé" />
          <Kpi label="Réservé" value={formatQty(c.quantities.reserved)} hint="Transferts préparés" />
          <Kpi label="En commande" value={formatQty(c.quantities.onOrder)} hint="Pas encore en stock" />
          <Kpi label="En transit (reçu bientôt)" value={formatQty(c.quantities.inTransitIn)} />
          <Kpi label="En transit (expédié)" value={formatQty(c.quantities.inTransitOut)} />
          <Kpi label="Seuils" value={`min ${formatQty(c.settings.minStock)} · alerte ${formatQty(c.settings.alertStock)}`} />
          <Kpi label="Valeur" value={c.costMissing ? "Coût manquant" : formatFcfa(c.value)} tone={c.costMissing ? "text-amber-300" : ""} hint={`Coût ${formatFcfa(c.cost)} · prix ${formatFcfa(c.price)}`} />
        </div>
        {c.canCorrect && <div className="flex gap-2"><button className="btn-ghost flex-1" onClick={() => setMode(mode === "fix" ? "" : "fix")}>Corriger le stock</button><button className="btn-ghost flex-1" onClick={() => setMode(mode === "set" ? "" : "set")}>Seuils et emplacement</button></div>}
        {mode === "fix" && <FixForm c={c} onDone={() => { setMode(""); refresh(); }} />}
        {mode === "set" && <SettingsForm c={c} onDone={() => { setMode(""); refresh(); }} />}
        <HistBlock title="Derniers achats et réceptions" items={c.lastReceipts} extra={c.lastPurchases.map((p) => `${fmtDay(p.at)} · ${p.supplier || "Fournisseur"} · ${formatQty(p.qty)} × ${formatFcfa(p.unitCost)}${p.landedCost !== p.unitCost ? ` (revient ${formatFcfa(p.landedCost)})` : ""}${p.ref ? ` · ${p.ref}` : ""}`)} />
        <HistBlock title="Dernières ventes" items={c.lastSales} />
        <HistBlock title="Ajustements et pertes" items={c.adjustments} />
        <section className="flex flex-col gap-1"><h3 className="text-sm font-semibold">Inventaires (Silent Count)</h3>{c.inventories.length === 0 && <p className="text-xs text-white/50">Aucun comptage.</p>}{c.inventories.map((i, k) => <p key={k} className="text-xs text-white/70 border-t border-[var(--line)] pt-1">{fmtDay(i.at)} · compté {formatQty(i.counted)}{i.diff !== null ? ` · écart ${signedQty(i.diff)}` : ""}</p>)}</section>
        <HistBlock title="Historique complet des mouvements" items={c.history} open />
        <p className="text-[11px] text-white/40">{c.note}</p>
      </>}
    </Sheet>
  );
}
function HistBlock({ title, items, extra, open }: { title: string; items: Hist[]; extra?: string[]; open?: boolean }) {
  return (
    <section className="flex flex-col gap-1"><h3 className="text-sm font-semibold">{title}</h3>
      {extra?.map((e, i) => <p key={`x${i}`} className="text-xs text-white/70 border-t border-[var(--line)] pt-1">{e}</p>)}
      {items.length === 0 && !extra?.length && <p className="text-xs text-white/50">Rien pour le moment.</p>}
      {items.slice(0, open ? 100 : 8).map((h) => <p key={h.id} className="text-xs text-white/70 border-t border-[var(--line)] pt-1"><span className="text-white/50">{fmtAt(h.at)}</span> · {h.label} · <b className={h.qty < 0 ? "text-red-300" : "text-emerald-300"}>{signedQty(h.qty)}</b>{h.from || h.to ? ` · ${h.from || "?"} → ${h.to || "?"}` : ""}{h.ref ? ` · ${h.ref}` : ""}{h.by ? ` · ${h.by}` : ""}{h.note ? ` — « ${h.note} »` : ""}</p>)}
    </section>
  );
}
function FixForm({ c, onDone }: { c: Card; onDone: () => void }) {
  const { session } = useSession(); const s = session!; const key = useRef(rid()); const [d, setD] = useState(""); const [why, setWhy] = useState("");
  const m = useMutation({ mutationFn: () => api(s, "stk.correct", { productId: c.productId, variantId: c.variantId || undefined, delta: d.trim().replace(",", "."), reason: why, requestKey: key.current }), onSuccess: () => { key.current = rid(); onDone(); } });
  const bad = !/^-?\d+([.,]\d{1,3})?$/.test(d.trim()) || Number(d.replace(",", ".")) === 0 || why.trim().length < 5;
  return (
    <form className="card flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <p className="text-xs text-white/60">Une correction est un mouvement tracé (auteur, date, motif) ; rien n'est modifié directement. Pour recompter tout le stock, utilisez l'inventaire.</p>
      <Field label="Quantité à ajouter (+) ou retirer (−)"><input className="input" aria-label="Quantité de correction" inputMode="decimal" placeholder="ex. -3 ou 5" value={d} onChange={(e) => setD(e.target.value)} /></Field>
      <Field label="Motif obligatoire"><input className="input" aria-label="Motif de la correction" maxLength={200} placeholder="ex. casse constatée, erreur de saisie" value={why} onChange={(e) => setWhy(e.target.value)} /></Field>
      <Err e={m.error} />
      <button className="btn" disabled={m.isPending || bad}>Enregistrer la correction</button>
    </form>
  );
}
function SettingsForm({ c, onDone }: { c: Card; onDone: () => void }) {
  const { session } = useSession(); const s = session!; const [v, setV] = useState({ min: String(c.settings.minStock), alert: String(c.settings.alertStock), idle: String(c.settings.idleDays), loc: c.settings.location });
  const m = useMutation({ mutationFn: () => api(s, "stk.settings", { productId: c.productId, minStock: v.min, alertStock: v.alert, idleDays: v.idle, location: v.loc }), onSuccess: onDone });
  return (
    <form className="card flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <p className="text-xs text-white/60">Ces seuils s'appliquent à cet article dans la boutique actuelle.</p>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Stock minimum"><input className="input" aria-label="Stock minimum" inputMode="decimal" value={v.min} onChange={(e) => setV({ ...v, min: e.target.value })} /></Field>
        <Field label="Seuil d'alerte"><input className="input" aria-label="Seuil d'alerte" inputMode="decimal" value={v.alert} onChange={(e) => setV({ ...v, alert: e.target.value })} /></Field>
        <Field label="Jours sans mouvement"><input className="input" aria-label="Jours sans mouvement" inputMode="numeric" value={v.idle} onChange={(e) => setV({ ...v, idle: e.target.value })} /></Field>
      </div>
      <Field label="Emplacement (rayon, réserve…)"><input className="input" aria-label="Emplacement" maxLength={64} value={v.loc} onChange={(e) => setV({ ...v, loc: e.target.value })} /></Field>
      <Err e={m.error} />
      <button className="btn" disabled={m.isPending}>Enregistrer</button>
    </form>
  );
}

// ------------------------------------------------------------------ journal des mouvements
const KINDS: [string, string][] = [["", "Tous"], ["sale", "Ventes"], ["purchase", "Réceptions"], ["return", "Retours clients"], ["adjust", "Ajustements"], ["loss", "Pertes"], ["transfer_in", "Transferts reçus"], ["transfer_out", "Transferts expédiés"]];
function Moves({ onOpen }: { onOpen: Open }) {
  const { session } = useSession(); const s = session!; const [f, setF] = useState({ kind: "", q: "", from: "", to: "" }); const [pages, setPages] = useState<string[]>([]);
  const key = (before?: string) => ["stk-moves", s.shopId, f, before ?? ""];
  const first = useQuery({ queryKey: key(), retry: 1, queryFn: () => api<{ moves: Move[]; total: number; next: string | null; note: string }>(s, "stk.moves", { ...clean(f), limit: 50 }) });
  const more = useQuery({ queryKey: key(pages.at(-1)), enabled: pages.length > 0, queryFn: () => api<{ moves: Move[]; next: string | null }>(s, "stk.moves", { ...clean(f), limit: 50, before: pages.at(-1) }) });
  const [acc, setAcc] = useState<Move[]>([]); const rows = [...(first.data?.moves ?? []), ...acc]; const next = pages.length ? more.data?.next : first.data?.next;
  const reset = (p: Partial<typeof f>) => { setF({ ...f, ...p }); setPages([]); setAcc([]); };
  return (
    <div className="flex flex-col gap-3">
      <div className="card grid grid-cols-2 gap-2">
        <input aria-label="Rechercher un mouvement" className="input col-span-2" placeholder="Article ou référence" value={f.q} onChange={(e) => reset({ q: e.target.value })} />
        <select aria-label="Type de mouvement" className="input col-span-2" value={f.kind} onChange={(e) => reset({ kind: e.target.value })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input aria-label="Mouvements depuis le" type="date" className="input" value={f.from} onChange={(e) => reset({ from: e.target.value })} />
        <input aria-label="Mouvements jusqu'au" type="date" className="input" value={f.to} onChange={(e) => reset({ to: e.target.value })} />
      </div>
      <Err e={first.error ?? more.error} />
      {first.isLoading && <p className="text-sm text-white/60" role="status">Chargement…</p>}
      {first.data && rows.length === 0 && <p className="text-sm text-white/60">Aucun mouvement ne correspond.</p>}
      <ul className="flex flex-col gap-2">{rows.map((m) => (
        <li key={m.id}><button className="card w-full text-left flex justify-between gap-2" onClick={() => onOpen(m.productId, m.variantId)}>
          <span className="min-w-0"><span className="block truncate font-medium">{m.article}</span><span className="block text-xs text-white/60">{fmtAt(m.at)} · {m.label}{m.from || m.to ? ` · ${m.from || "?"} → ${m.to || "?"}` : ""}</span><span className="block text-xs text-white/40 truncate">{m.ref}{m.by ? ` · ${m.by}` : ""}{m.note ? ` — « ${m.note} »` : ""}</span></span>
          <b className={m.qty < 0 ? "text-red-300" : "text-emerald-300"}>{signedQty(m.qty)}</b></button></li>))}</ul>
      {next && <button className="btn-ghost" disabled={more.isFetching} onClick={() => { if (pages.length && more.data) setAcc((a) => [...a, ...more.data!.moves]); setPages((p) => [...p, next]); }}>Voir plus</button>}
      {first.data && <p className="text-[11px] text-white/40">{first.data.total} mouvement(s). {first.data.note}</p>}
    </div>
  );
}
const clean = (f: Record<string, string>) => Object.fromEntries(Object.entries(f).filter(([, v]) => v));

// ------------------------------------------------------------------ alertes
function Alerts({ onOpen, onTab }: { onOpen: Open; onTab: (t: "dash" | "art" | "mov" | "xfer" | "alert") => void }) {
  const { session } = useSession(); const s = session!; const nav = useNavigate(); const [lvl, setLvl] = useState<"" | "high" | "warn" | "info">("");
  const q = useQuery({ queryKey: ["stk-alerts-full", s.shopId], retry: 1, queryFn: () => api<{ alerts: Alert[]; counts: { high: number; warn: number; info: number }; note: string }>(s, "stk.alerts") });
  const rows = (q.data?.alerts ?? []).filter((a) => !lvl || a.level === lvl);
  const go = (a: Alert) => { if (a.productId) onOpen(a.productId, a.variantId); else if (a.link === "transferts") onTab("xfer"); else if (a.link) void nav({ to: `/${a.link}` as never }); };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 overflow-x-auto">{([["", "Toutes"], ["high", `Urgentes (${q.data?.counts.high ?? 0})`], ["warn", `À traiter (${q.data?.counts.warn ?? 0})`], ["info", `Infos (${q.data?.counts.info ?? 0})`]] as const).map(([k, l]) => <button key={k} className="chip" aria-current={lvl === k} onClick={() => setLvl(k)}>{l}</button>)}</div>
      <Err e={q.error} />
      {q.isLoading && <p className="text-sm text-white/60" role="status">Chargement…</p>}
      {q.data && rows.length === 0 && <p className="card text-sm text-white/70">Aucune alerte : tous les stocks sont dans leurs seuils.</p>}
      <ul className="flex flex-col gap-2">{rows.map((a, i) => <li key={i}><button className="card w-full text-left flex gap-2 items-start" onClick={() => go(a)}><AlertTriangle size={16} className={`mt-0.5 shrink-0 ${LEVEL_TONE[a.level]}`} /><span><span className={`block text-sm font-medium ${LEVEL_TONE[a.level]}`}>{a.title}</span><span className="block text-xs text-white/60">{a.detail}</span></span></button></li>)}</ul>
      {q.data && <p className="text-[11px] text-white/40">{q.data.note}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ transferts entre boutiques
function Transfers() {
  const { session } = useSession(); const s = session!; const [flt, setFlt] = useState<"open" | "">("open"); const [sheet, setSheet] = useState<"new" | string | null>(null);
  const manager = s.role === "owner" || s.role === "manager";
  const q = useQuery({ queryKey: ["xfer-list", s.shopId, flt], retry: 1, queryFn: () => api<{ transfers: Xfer[] }>(s, "xfer.list", flt ? { status: flt } : {}) });
  return (
    <div className="flex flex-col gap-3">
      {s.shops.length < 2 && <p className="card text-sm text-white/70">Les transferts demandent au moins deux boutiques. Ajoutez une boutique dans les réglages.</p>}
      <div className="flex gap-2 items-center"><div className="flex gap-2 flex-1 overflow-x-auto">{([["open", "En cours"], ["", "Tous"]] as const).map(([k, l]) => <button key={k} className="chip" aria-current={flt === k} onClick={() => setFlt(k)}>{l}</button>)}</div>
        {manager && s.shops.length > 1 && <button className="btn !py-2" onClick={() => setSheet("new")}>Nouveau transfert</button>}</div>
      <p className="text-xs text-white/50">Boutique actuelle : <b>{s.shops.find((x) => x.id === s.shopId)?.name}</b>. Les transferts à recevoir apparaissent quand vous êtes dans la boutique de destination.</p>
      <Err e={q.error} />
      {q.isLoading && <p className="text-sm text-white/60" role="status">Chargement…</p>}
      {q.data && q.data.transfers.length === 0 && <p className="card text-sm text-white/70">Aucun transfert{flt ? " en cours" : ""}.</p>}
      <ul className="flex flex-col gap-2">{(q.data?.transfers ?? []).map((t) => (
        <li key={t.id}><button className="card w-full text-left flex flex-col gap-1" onClick={() => setSheet(t.id)}>
          <span className="flex justify-between gap-2"><b>{t.number}</b><span className={t.late ? "text-red-300" : t.status === "received" ? "text-emerald-300" : "text-amber-300"}>{t.late ? "En retard · " : ""}{XFER_LABEL[t.status] ?? t.label}</span></span>
          <span className="text-sm text-white/70 flex items-center gap-1"><ArrowRightLeft size={14} />{t.fromName} → {t.toName} · {t.direction === "in" ? "à recevoir" : "sortant"}</span>
          <span className="text-xs text-white/50">{t.lines.length} article(s){t.status !== "draft" ? ` · expédié ${formatQty(t.totals.sent)} · reçu ${formatQty(t.totals.received)} · en transit ${formatQty(t.totals.inTransit)}` : ""}</span></button></li>))}</ul>
      {sheet === "new" && <NewTransfer onClose={() => setSheet(null)} onSaved={(id) => setSheet(id)} />}
      {sheet && sheet !== "new" && <XferSheet id={sheet} onClose={() => setSheet(null)} />}
    </div>
  );
}
function NewTransfer({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const { session } = useSession(); const s = session!; const qc = useQueryClient(); const clientId = useRef(rid());
  const products = useQuery({ queryKey: ["products"], queryFn: () => list<Product>("products", s, [], 500) }); const variants = useQuery({ queryKey: ["variants-stock", s.shopId], queryFn: () => listAll<VariantRow>("article_variants", s) }); const levels = useStockLevels();
  const [to, setTo] = useState(""); const [due, setDue] = useState(""); const [rows, setRows] = useState([{ pv: "", qty: "" }]); const set = (i: number, p: Partial<(typeof rows)[number]>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const opts = (products.data ?? []).filter((p) => !p.archived && !isVirtualBundle(p) && !trackingOf(p)).flatMap((p) => p.hasVariants ? (variants.data ?? []).filter((v) => v.productId === p.$id && !v.archived).map((v) => ({ v: `${p.$id}:${v.$id}`, l: `${p.name} — ${v.label} (${formatQty(variantQty(levels.data, v, p.qtyScale ?? 0))})` })) : [{ v: p.$id, l: `${p.name} (${formatQty(qtyOf(levels.data, p))})` }]);
  const m = useMutation({ mutationFn: () => api<{ id: string }>(s, "xfer.save", { clientId: clientId.current, toShopId: to, dueOn: due || undefined, lines: rows.filter((r) => r.pv).map((r) => { const [productId, variantId] = r.pv.split(":"); return { productId, ...(variantId ? { variantId } : {}), qty: r.qty.trim().replace(",", ".") }; }) }), onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ["xfer-list"] }); onSaved(r.id); } });
  const ok = !!to && rows.some((r) => r.pv) && rows.every((r) => !r.pv || /^\d+([.,]\d{1,3})?$/.test(r.qty.trim()) && Number(r.qty.replace(",", ".")) > 0);
  return (
    <Sheet title="Nouveau transfert" onClose={onClose} back>
      <p className="text-xs text-white/60">Le transfert est d'abord préparé : le stock ne bouge qu'à la validation du départ. Les articles suivis par lot ou numéro de série passent par le transfert direct (Lots / Séries).</p>
      <Field label="Boutique de destination"><select className="input" aria-label="Boutique de destination" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choisir…</option>{s.shops.filter((x) => x.id !== s.shopId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      <Field label="Arrivée prévue (facultatif)"><input className="input" type="date" aria-label="Arrivée prévue" min={dayOff(0)} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
      {rows.map((r, i) => <div key={i} className="grid grid-cols-[1fr_5rem] gap-1"><select className="input !px-2" aria-label={`Article ${i + 1}`} value={r.pv} onChange={(e) => set(i, { pv: e.target.value })}><option value="">Article…</option>{opts.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select><input className="input !px-2" aria-label={`Quantité ${i + 1}`} inputMode="decimal" placeholder="Qté" value={r.qty} onChange={(e) => set(i, { qty: e.target.value })} /></div>)}
      {rows.length < 40 && <button type="button" className="btn-ghost" onClick={() => setRows([...rows, { pv: "", qty: "" }])}>+ Ligne</button>}
      <Err e={m.error} />
      <button className="btn" disabled={m.isPending || !ok} onClick={() => m.mutate()}>Enregistrer le transfert (préparé)</button>
    </Sheet>
  );
}
function XferSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { session } = useSession(); const s = session!; const qc = useQueryClient(); const manager = s.role === "owner" || s.role === "manager";
  const q = useQuery({ queryKey: ["xfer", s.shopId, id], retry: 1, queryFn: () => api<Xfer>(s, "xfer.get", { id }) }); const t = q.data;
  const [confirm, setConfirm] = useState<"" | "ship" | "cancel">(""); const [panel, setPanel] = useState<"" | "recv" | "close">("");
  const done = () => { setPanel(""); setConfirm(""); void qc.invalidateQueries({ queryKey: ["xfer"] }); void qc.invalidateQueries({ queryKey: ["xfer-list"] }); void qc.invalidateQueries({ queryKey: ["stock"] }); void qc.invalidateQueries({ queryKey: ["stk-alerts"] }); };
  const ship = useMutation({ mutationFn: () => api(s, "xfer.ship", { id }), onSuccess: done, onSettled: () => setConfirm("") });
  const [why, setWhy] = useState(""); const cancel = useMutation({ mutationFn: () => api(s, "xfer.cancel", { id, reason: why }), onSuccess: done });
  const open = t && (t.status === "shipped" || t.status === "partial");
  return (
    <Sheet title={t?.number ?? "Transfert"} onClose={onClose} back>
      {q.isLoading && <p className="text-sm text-white/60" role="status">Chargement…</p>}
      <Err e={q.error} />
      {t && <>
        <div className="card text-sm flex flex-col gap-1"><div className="flex justify-between"><b>{t.fromName} → {t.toName}</b><span className={t.late ? "text-red-300" : "text-amber-300"}>{t.late ? "En retard · " : ""}{XFER_LABEL[t.status] ?? t.label}</span></div>
          <span className="text-white/60 text-xs">Créé le {fmtDay(t.createdAt)}{t.createdBy ? ` par ${t.createdBy}` : ""}{t.shippedAt ? ` · expédié le ${fmtDay(t.shippedAt)}${t.shippedBy ? ` par ${t.shippedBy}` : ""}` : ""}{t.dueOn ? ` · arrivée prévue ${fmtDay(t.dueOn)}` : ""}</span>
          {t.closeNote && <span className="text-xs text-white/70">Clôture : {t.closeNote}</span>}</div>
        <div className="card flex flex-col gap-1">{t.lines.map((l) => <div key={l.index} className="text-sm flex justify-between gap-2 border-b border-[var(--line)] pb-1 last:border-0"><span className="truncate">{l.name}</span><span className="text-white/70 text-right">{t.status === "draft" ? `${formatQty(l.sent)} prévu(s)` : `exp. ${formatQty(l.sent)} · reçu ${formatQty(l.received)}${l.left > 0 ? ` · reste ${formatQty(l.left)}` : ""}`}</span></div>)}
          {t.status !== "draft" && <p className="text-xs text-white/60">En transit : {formatQty(t.totals.inTransit)} — non disponible dans la boutique de destination avant réception.</p>}</div>
        {t.status === "draft" && t.direction === "out" && manager && <div className="flex gap-2"><button className="btn flex-1" onClick={() => setConfirm("ship")}>Valider le départ</button><button className="btn-ghost flex-1" onClick={() => setConfirm("cancel")}>Annuler</button></div>}
        {t.status === "draft" && t.direction === "in" && <p className="text-sm text-white/60">Transfert en préparation dans la boutique d'origine.</p>}
        {open && t.direction === "out" && <p className="text-sm text-amber-300">La réception se confirme depuis la boutique de destination ({t.toName}) : changez de boutique en haut de l'écran.</p>}
        {open && t.direction === "in" && <button className="btn" onClick={() => setPanel(panel === "recv" ? "" : "recv")}>Confirmer la réception</button>}
        {open && manager && <button className="btn-ghost" onClick={() => setPanel(panel === "close" ? "" : "close")}>Clôturer avec écart</button>}
        <Err e={ship.error} />
        {panel === "recv" && <RecvForm t={t} onDone={done} />}
        {panel === "close" && <CloseForm t={t} onDone={done} />}
        <section className="flex flex-col gap-1"><h3 className="text-sm font-semibold">Réceptions</h3>{t.history.length === 0 && <p className="text-xs text-white/50">Aucune réception enregistrée.</p>}{t.history.map((h) => <p key={h.key} className="text-xs text-white/70 border-t border-[var(--line)] pt-1">{fmtAt(h.at)}{h.by ? ` · ${h.by}` : ""} · {h.lines.map((l) => `${t.lines[l.index]?.name ?? "Ligne"} +${formatQty(l.qty)}`).join(", ")}{h.note ? ` — « ${h.note} »` : ""}</p>)}</section>
        {t.moves && t.moves.length > 0 && <section className="flex flex-col gap-1"><h3 className="text-sm font-semibold">Mouvements de stock (deux côtés)</h3>{t.moves.map((m) => <p key={m.id} className="text-xs text-white/70 border-t border-[var(--line)] pt-1">{fmtAt(m.at)} · {m.shop} · {m.kind === "transfer_out" ? "Sortie" : "Entrée"}{m.note ? ` — ${m.note}` : ""}</p>)}</section>}
        {confirm === "ship" && <Confirm text={`Valider le départ de ${t.number} ? Le stock de ${t.fromName} diminue maintenant ; la marchandise est en transit jusqu'à la réception.`} confirmLabel="Valider le départ" onNo={() => setConfirm("")} onYes={() => ship.mutate()} />}
        {confirm === "cancel" && <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-4" role="alertdialog"><div className="card w-full max-w-sm flex flex-col gap-2"><p>Annuler ce transfert préparé ? Aucun stock n'a bougé.</p><input className="input" aria-label="Motif d'annulation" placeholder="Motif" value={why} onChange={(e) => setWhy(e.target.value)} /><Err e={cancel.error} /><div className="flex gap-2"><button className="btn-ghost flex-1" onClick={() => setConfirm("")}>Retour</button><button className="btn flex-1" disabled={why.trim().length < 3 || cancel.isPending} onClick={() => cancel.mutate()}>Annuler le transfert</button></div></div></div>}
      </>}
    </Sheet>
  );
}
function RecvForm({ t, onDone }: { t: Xfer; onDone: () => void }) {
  const { session } = useSession(); const s = session!; const key = useRef(rid()); const [qty, setQty] = useState<Record<number, string>>(() => Object.fromEntries(t.lines.map((l) => [l.index, String(l.left)]))); const [note, setNote] = useState("");
  const m = useMutation({ mutationFn: () => api(s, "xfer.receive", { id: t.id, key: key.current, note: note || undefined, lines: t.lines.map((l) => ({ index: l.index, qty: (qty[l.index] ?? "0").trim().replace(",", ".") || "0" })) }), onSuccess: () => { key.current = rid(); onDone(); } });
  const valid = t.lines.every((l) => /^\d+([.,]\d{1,3})?$/.test((qty[l.index] ?? "").trim()) && Number((qty[l.index] ?? "").replace(",", ".")) <= l.left) && t.lines.some((l) => Number((qty[l.index] ?? "0").replace(",", ".")) > 0);
  return (
    <form className="card flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <p className="text-xs text-white/60">Saisissez ce qui est réellement arrivé. Réception partielle possible : le reste demeure en transit.</p>
      {t.lines.filter((l) => l.left > 0).map((l) => <div key={l.index} className="grid grid-cols-[1fr_5rem] gap-2 items-center"><span className="text-sm truncate">{l.name}<span className="block text-[11px] text-white/50">reste {formatQty(l.left)}</span></span><input className="input !px-2" aria-label={`Reçu ${l.name}`} inputMode="decimal" value={qty[l.index] ?? ""} onChange={(e) => setQty({ ...qty, [l.index]: e.target.value })} /></div>)}
      <input className="input" aria-label="Note de réception" maxLength={200} placeholder="Note (écart, état des colis…)" value={note} onChange={(e) => setNote(e.target.value)} />
      <Err e={m.error} />
      <button className="btn" disabled={m.isPending || !valid}>Enregistrer la réception</button>
    </form>
  );
}
function CloseForm({ t, onDone }: { t: Xfer; onDone: () => void }) {
  const { session } = useSession(); const s = session!; const [d, setD] = useState<"return_to_source" | "write_off">("return_to_source"); const [why, setWhy] = useState("");
  const m = useMutation({ mutationFn: () => api(s, "xfer.close", { id: t.id, disposition: d, reason: why }), onSuccess: onDone });
  return (
    <form className="card flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <p className="text-xs text-white/60">Il reste {formatQty(t.totals.inTransit)} non reçu. Clôturer rend le transfert définitif.</p>
      <select className="input" aria-label="Sort des manquants" value={d} onChange={(e) => setD(e.target.value as typeof d)}><option value="return_to_source">Retour au stock de départ</option><option value="write_off">Perte en transit (aucun retour en stock)</option></select>
      <input className="input" aria-label="Motif de clôture" maxLength={200} placeholder="Motif obligatoire" value={why} onChange={(e) => setWhy(e.target.value)} />
      <Err e={m.error} />
      <button className="btn" disabled={m.isPending || why.trim().length < 5}>Clôturer le transfert</button>
    </form>
  );
}
