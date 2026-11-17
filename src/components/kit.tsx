/** Système de design du kit « 24 interfaces » (lot K0). Composants partagés par tous les modules ; tout passe par les jetons de couleur.
 *  Règle : ces composants n'inventent aucune valeur. Un indicateur, une variation ou un constat MASTER n'est affiché que si l'écran appelant le fournit (calcul serveur). */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Ban, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock, FileText, Info, Lock, RefreshCw, Search, Truck, X, XCircle, type LucideIcon } from "lucide-react";
import { Sheet } from "@/components/ui";

export type Tint = "blue" | "green" | "amber" | "violet" | "cyan" | "rose";
const TINT: Record<Tint, string> = {
  blue: "bg-[var(--tint-blue-bg)] text-[var(--tint-blue)]", green: "bg-[var(--tint-green-bg)] text-[var(--tint-green)]", amber: "bg-[var(--tint-amber-bg)] text-[var(--tint-amber)]",
  violet: "bg-[var(--tint-violet-bg)] text-[var(--tint-violet)]", cyan: "bg-[var(--tint-cyan-bg)] text-[var(--tint-cyan)]", rose: "bg-[var(--tint-rose-bg)] text-[var(--tint-rose)]",
};

/** En-tête de module : pictogramme bleu, titre, sous-titre, actions (au plus une action principale en or). */
export function ModuleHeader({ icon: I, title, subtitle, actions }: { icon: LucideIcon; title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start gap-3">
      <span className="hidden sm:flex shrink-0 size-12 rounded-xl items-center justify-center text-accent" aria-hidden="true"><I size={34} strokeWidth={1.75} /></span>
      <div className="min-w-0 flex-1"><h1 className="text-2xl md:text-[1.75rem] font-bold leading-tight text-brand">{title}</h1>{subtitle && <p className="text-sm text-muted mt-0.5">{subtitle}</p>}</div>
      {actions && <div className="flex flex-wrap gap-2 w-full sm:w-auto">{actions}</div>}
    </header>
  );
}

export type Delta = { text: string; dir: "up" | "down"; good: boolean };
/** Carte indicateur du kit : pastille d'icône teintée, libellé, valeur, précision (période, source) et variation éventuelle (fournie par le serveur, jamais calculée ici). */
export function KpiTile({ icon: I, tint = "blue", label, value, sub, delta, loading }: { icon: LucideIcon; tint?: Tint; label: string; value: ReactNode; sub?: ReactNode; delta?: Delta; loading?: boolean }) {
  return (
    <div className="card !p-3 sm:!p-3.5 flex items-center gap-2.5 sm:gap-3 min-w-0" role="group" aria-label={label}>
      <span className={`shrink-0 size-9 sm:size-11 rounded-full max-[399px]:hidden flex items-center justify-center ${TINT[tint]}`} aria-hidden="true"><I size={20} /></span>
      <div className="min-w-0">
        <p className="text-[0.8125rem] leading-4 text-soft line-clamp-2">{label}</p>
        {loading ? <span className="block h-6 w-24 mt-1 rounded bg-subtle animate-pulse" aria-busy="true" /> : <p className="text-base sm:text-lg 2xl:text-xl font-bold leading-6 sm:leading-7 text-brand whitespace-nowrap">{value}</p>}
        {delta && !loading && (
          <p className={`text-[0.8125rem] font-semibold inline-flex items-center gap-0.5 ${delta.good ? "text-ok" : "text-bad"}`}>
            {delta.dir === "up" ? <ArrowUpRight size={14} aria-hidden="true" /> : <ArrowDownRight size={14} aria-hidden="true" />}<span>{delta.text}</span>
          </p>
        )}
        {sub && !loading && <p className="text-xs text-muted line-clamp-2">{sub}</p>}
      </div>
    </div>
  );
}
/** Rangée d'indicateurs : 2 colonnes sur téléphone, 3 sur tablette, jusqu'à 5 sur grand écran. */
export function KpiRow({ children, cols = 5 }: { children: ReactNode; cols?: 4 | 5 }) {
  return <div className={`grid grid-cols-2 md:grid-cols-3 gap-3 ${cols === 5 ? "xl:grid-cols-5" : "xl:grid-cols-4"}`}>{children}</div>;
}

export type StatusTone = "ok" | "info" | "warn" | "bad" | "muted" | "progress";
const STATUS_STYLE: Record<StatusTone, { cls: string; icon: LucideIcon }> = {
  ok: { cls: "bg-ok-bg text-ok", icon: Check }, info: { cls: "bg-info-bg text-info", icon: Truck }, progress: { cls: "bg-warn-bg text-warn", icon: Clock },
  warn: { cls: "bg-warn-bg text-warn", icon: AlertTriangle }, bad: { cls: "bg-bad-bg text-bad", icon: XCircle }, muted: { cls: "bg-subtle text-soft", icon: FileText },
};
/** Badge de statut : texte + pictogramme (la couleur n'est jamais seule porteuse du sens). */
export function StatusBadge({ tone, children, icon }: { tone: StatusTone; children: ReactNode; icon?: LucideIcon | null }) {
  const s = STATUS_STYLE[tone]; const I = icon === undefined ? s.icon : icon;
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold rounded-full px-2.5 py-1 ${s.cls}`}>{I && <I size={13} aria-hidden="true" />}{children}</span>;
}

export type PillTab<K extends string> = { key: K; label: string; icon?: LucideIcon; count?: number; locked?: boolean };
/** Onglets en pilule du kit (rôle tablist, flèches gauche/droite, Début/Fin). Défilent horizontalement sur téléphone. */
export function PillTabs<K extends string>({ items, value, onChange, label, idBase }: { items: PillTab<K>[]; value: K; onChange: (k: K) => void; label: string; idBase?: string }) {
  const auto = useId(); const base = idBase ?? `pt${auto.replace(/:/g, "")}`;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const n = items.length; let j = -1;
    if (e.key === "ArrowRight") j = (i + 1) % n; else if (e.key === "ArrowLeft") j = (i - 1 + n) % n; else if (e.key === "Home") j = 0; else if (e.key === "End") j = n - 1;
    if (j < 0) return; e.preventDefault(); refs.current[j]?.focus(); onChange(items[j]!.key);
  };
  return (
    <div role="tablist" aria-label={label} className="scroll-x !gap-2">
      {items.map((t, i) => {
        const on = t.key === value; const I = t.icon;
        return (
          <button key={t.key} ref={(el) => { refs.current[i] = el; }} id={`${base}-${t.key}`} role="tab" type="button" aria-selected={on} aria-controls={`${base}-panel`} tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.key)} onKeyDown={(e) => onKey(e, i)}
            className={`shrink-0 inline-flex items-center gap-2 rounded-xl px-4 min-h-11 text-sm font-semibold border transition ${on ? "bg-accent text-accent-ink border-accent shadow-[var(--shadow-card)]" : "bg-surface text-main border-line hover:bg-subtle"}`}>
            {I && <I size={18} aria-hidden="true" />}<span>{t.label}</span>
            {t.count !== undefined && <span className={`text-xs rounded-full px-1.5 ${on ? "bg-white/20" : "bg-subtle text-soft"}`}>{t.count}</span>}
            {t.locked && <Lock size={14} aria-label="Réservé à une offre supérieure" />}
          </button>
        );
      })}
    </div>
  );
}
/** Panneau associé aux onglets (à placer sous PillTabs avec le même idBase). */
export function TabPanel({ idBase, active, children }: { idBase: string; active: string; children: ReactNode }) {
  return <div id={`${idBase}-panel`} role="tabpanel" aria-labelledby={`${idBase}-${active}`} tabIndex={0} className="outline-none flex flex-col gap-4">{children}</div>;
}

/** Barre de recherche et de filtres : la recherche s'étire, les filtres (listes déroulantes) suivent ; tout passe à la ligne sur téléphone. */
export function FilterBar({ query, onQuery, placeholder, children }: { query: string; onQuery: (q: string) => void; placeholder: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <label className="relative flex-1 min-w-[14rem]"><span className="sr-only">{placeholder}</span>
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden="true" />
        <input className="input !pl-10" type="search" value={query} onChange={(e) => onQuery(e.target.value)} placeholder={placeholder} />
      </label>
      {children}
    </div>
  );
}
/** Liste déroulante de filtre avec libellé visible (« Statut : Tous »). */
export function FilterSelect<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: { value: V; label: string }[]; onChange: (v: V) => void }) {
  return (
    <label className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line-strong)] bg-surface px-3 min-h-11 text-sm">
      <span className="text-soft whitespace-nowrap">{label} :</span>
      <select className="bg-transparent font-medium outline-none py-2 pr-1" value={value} onChange={(e) => onChange(e.target.value as V)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
    </label>
  );
}

/** Pagination : « 1–12 sur 124 », précédente / suivante, numéros (avec ellipses). Masquée s'il n'y a qu'une page. */
export function Pagination({ page, pageSize, total, onPage, label = "Pagination" }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; label?: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize)); if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1, to = Math.min(total, page * pageSize);
  const nums: (number | "…")[] = []; for (let p = 1; p <= pages; p++) { if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p); else if (nums[nums.length - 1] !== "…") nums.push("…"); }
  const b = "min-w-10 min-h-10 rounded-lg border text-sm font-semibold inline-flex items-center justify-center";
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-soft">{from}–{to} sur {total}</p>
      <div className="flex items-center gap-1">
        <button type="button" className={`${b} border-line bg-surface disabled:opacity-40`} aria-label="Page précédente" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={18} /></button>
        {nums.map((n, i) => n === "…" ? <span key={`e${i}`} className="px-1 text-muted" aria-hidden="true">…</span> :
          <button key={n} type="button" className={`${b} ${n === page ? "bg-accent text-accent-ink border-accent" : "border-line bg-surface"}`} aria-current={n === page ? "page" : undefined} aria-label={`Page ${n}`} onClick={() => onPage(n)}>{n}</button>)}
        <button type="button" className={`${b} border-line bg-surface disabled:opacity-40`} aria-label="Page suivante" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight size={18} /></button>
      </div>
    </nav>
  );
}

export type DetailSpec = { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; headerAction?: ReactNode };
/** Liste + panneau de détail. Côte à côte quand la zone disponible mesure au moins `min` px (mesurée, pas la largeur d'écran) ;
 *  sinon le détail s'ouvre en fiche (volet à droite sur tablette, plein écran sur téléphone). */
export function DetailLayout({ panel, children, placeholder, min = 1100 }: { panel: DetailSpec | null; children: ReactNode; placeholder?: ReactNode; min?: number }) {
  const ref = useRef<HTMLDivElement>(null); const [wide, setWide] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return; const m = () => setWide(el.clientWidth >= min); m();
    if (typeof ResizeObserver === "undefined") return; const ro = new ResizeObserver(m); ro.observe(el); return () => ro.disconnect();
  }, [min]);
  return (
    <div ref={ref} className={`grid gap-4 items-start ${wide ? "grid-cols-[minmax(0,1fr)_22rem]" : ""}`}>
      <div className="flex flex-col gap-3 min-w-0">{children}</div>
      {wide ? (panel ? <DetailAside {...panel} /> : placeholder ? <div className="text-sm text-muted card">{placeholder}</div> : null)
        : panel && <Sheet title={panel.title} onClose={panel.onClose} size="panel">{panel.children}{panel.footer && <div className="flex flex-wrap gap-2 pt-2">{panel.footer}</div>}</Sheet>}
    </div>
  );
}
function DetailAside({ title, onClose, children, footer, headerAction }: DetailSpec) {
  return (
    <aside aria-label={title} className="card !p-0 overflow-hidden flex flex-col self-start sticky top-4 max-h-[calc(100vh-2rem)] pop-in">
      <div className="flex items-center gap-2 px-4 py-3 bg-[var(--nav-bg)] text-[var(--nav-text)]">
        <h2 className="font-bold flex-1 truncate">{title}</h2>{headerAction}
        <button type="button" className="icon-btn !min-h-9 !min-w-9 rounded-lg hover:bg-[var(--nav-hover)]" aria-label="Fermer le détail" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="p-4 flex flex-col gap-3 overflow-y-auto">{children}</div>
      {footer && <div className="px-4 py-3 border-t border-line flex flex-wrap gap-2">{footer}</div>}
    </aside>
  );
}

export type Insight = { id: string; text: string; tone?: "ok" | "warn" | "info"; to?: string; toLabel?: string };
/** Encart « MASTER DOGUI — Module » : constats calculés par le serveur à partir des données réelles, avec leur source.
 *  Aucune action n'est exécutée automatiquement : un constat peut seulement mener vers l'écran où l'utilisateur agit lui-même. */
export function InsightCard({ module, items, source, loading, emptyText = "Aucun constat pour la période : rien à signaler à partir de vos données." }: { module: string; items: Insight[]; source: string; loading?: boolean; emptyText?: string }) {
  const sym = `url(${import.meta.env.BASE_URL}master-symbol.svg)`;
  return (
    <section aria-label={`MASTER DOGUI — ${module}`} className="rounded-2xl border p-4 flex flex-col gap-3 bg-[var(--gold-soft)] border-[color-mix(in_srgb,var(--gold)_45%,transparent)]">
      <h2 className="font-bold text-brand inline-flex items-center gap-2">
        <span aria-hidden="true" className="size-6 shrink-0 bg-[var(--gold)]" style={{ WebkitMaskImage: sym, maskImage: sym, WebkitMaskSize: "contain", maskSize: "contain", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat" }} />
        MASTER DOGUI — {module}
      </h2>
      {loading ? <div className="flex flex-col gap-2" aria-busy="true" aria-label="Analyse en cours">{[0, 1, 2].map((i) => <span key={i} className="h-4 rounded bg-[var(--surface)] animate-pulse" />)}</div>
        : items.length === 0 ? <p className="text-sm text-soft">{emptyText}</p>
        : <ul className="flex flex-col gap-2">{items.map((it) => (
          <li key={it.id} className="flex gap-2 text-sm text-main">
            {it.tone === "warn" ? <AlertTriangle size={18} className="shrink-0 text-warn mt-0.5" aria-hidden="true" /> : it.tone === "info" ? <Info size={18} className="shrink-0 text-info mt-0.5" aria-hidden="true" /> : <CheckCircle2 size={18} className="shrink-0 text-ok mt-0.5" aria-hidden="true" />}
            <span>{it.text}{it.to && <> <a className="font-semibold text-accent-text underline" href={it.to}>{it.toLabel ?? "Voir"}</a></>}</span>
          </li>))}</ul>}
      <p className="text-xs text-soft">Source : {source}. Aucune action n'est lancée sans votre validation.</p>
    </section>
  );
}

/* ---- États d'interface (obligatoires pour chaque écran du kit) ---- */
export function LoadingState({ label = "Chargement", rows = 4 }: { label?: string; rows?: number }) {
  return <div className="card flex flex-col gap-2.5" aria-busy="true" aria-label={label} role="status">{Array.from({ length: rows }, (_, i) => <span key={i} className="h-5 rounded bg-subtle animate-pulse" style={{ width: `${92 - i * 9}%` }} />)}<span className="sr-only">{label}…</span></div>;
}
export function ErrorState({ title = "Chargement impossible", message, onRetry }: { title?: string; message?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="card flex flex-col items-center text-center gap-2 py-8 border-[color-mix(in_srgb,var(--bad)_35%,transparent)]">
      <XCircle className="text-bad" aria-hidden="true" /><b>{title}</b>{message && <p className="text-sm text-soft max-w-sm">{message}</p>}
      {onRetry && <button type="button" className="btn-ghost inline-flex items-center gap-2" onClick={onRetry}><RefreshCw size={16} aria-hidden="true" />Réessayer</button>}
    </div>
  );
}
/** Données partielles : ce qui manque est nommé, rien n'est extrapolé. */
export function PartialNotice({ missing }: { missing: string[] }) {
  if (!missing.length) return null;
  return <div role="status" className="rounded-lg border px-3 py-2.5 text-sm bg-warn-bg text-warn border-[color-mix(in_srgb,var(--warn)_30%,transparent)] flex gap-2"><AlertTriangle size={18} className="shrink-0" aria-hidden="true" /><span><b>Données partielles.</b> Non disponible : {missing.join(", ")}. Les totaux affichés n'en tiennent pas compte.</span></div>;
}
export function DeniedState({ reason = "Votre rôle ne donne pas accès à cette partie.", hint = "Demandez au propriétaire du commerce de modifier vos accès." }: { reason?: string; hint?: string }) {
  return <div role="alert" className="card flex flex-col items-center text-center gap-2 py-8"><Ban className="text-muted" aria-hidden="true" /><b>Accès refusé</b><p className="text-sm text-soft max-w-sm">{reason}</p><p className="text-xs text-muted">{hint}</p></div>;
}
/** Fonction réservée à une offre supérieure : désactivée, avec la raison (jamais un bouton inerte sans explication). */
export function LockedState({ feature, plan, action }: { feature: string; plan: string; action?: ReactNode }) {
  return <div className="card flex flex-col items-center text-center gap-2 py-8 bg-subtle"><Lock className="text-muted" aria-hidden="true" /><b>{feature}</b><p className="text-sm text-soft max-w-sm">Disponible avec l'offre {plan}. Vos données sont conservées et réapparaissent dès l'activation.</p>{action}</div>;
}
/** Succès confirmé : affiché seulement après la réponse du serveur. */
export function SuccessNotice({ children }: { children: ReactNode }) {
  return <div role="status" className="d3-saved rounded-lg border px-3 py-2.5 text-sm bg-ok-bg text-ok border-[color-mix(in_srgb,var(--ok)_30%,transparent)] flex gap-2"><CheckCircle2 size={18} className="shrink-0" aria-hidden="true" /><span>{children}</span></div>;
}

/** Barre d'actions groupées (apparaît dès qu'une ligne est sélectionnée). */
export function BulkBar({ count, onClear, children }: { count: number; onClear: () => void; children: ReactNode }) {
  if (!count) return null;
  return (
    <div role="region" aria-label="Actions groupées" className="card !py-2.5 flex flex-wrap items-center gap-2 pop-in">
      <b className="text-sm">{count} sélectionné{count > 1 ? "s" : ""}</b><div className="flex flex-wrap gap-2 flex-1">{children}</div>
      <button type="button" className="text-sm text-soft underline" onClick={onClear}>Tout désélectionner</button>
    </div>
  );
}

export type KitColumn<R> = { key: string; label: string; cell: (r: R) => ReactNode; align?: "right" | "center"; hideBelow?: "md" | "lg"; nowrap?: boolean };
/** Tableau du kit : en-tête teinté, cases à cocher optionnelles, colonne d'actions ; sur téléphone, chaque ligne devient une carte (renderCard). */
export function KitTable<R>({ rows, columns, rowKey, label, selected, onSelect, actions, renderCard, onRow }: {
  rows: R[]; columns: KitColumn<R>[]; rowKey: (r: R) => string; label: string; selected?: Set<string>; onSelect?: (next: Set<string>) => void;
  actions?: (r: R) => ReactNode; renderCard?: (r: R) => ReactNode; onRow?: (r: R) => void;
}) {
  const sel = selected ?? new Set<string>(); const all = rows.length > 0 && rows.every((r) => sel.has(rowKey(r)));
  const toggle = (k: string) => { const n = new Set(sel); if (n.has(k)) n.delete(k); else n.add(k); onSelect?.(n); };
  const hide = (c: KitColumn<R>) => c.hideBelow === "lg" ? "hidden lg:table-cell" : c.hideBelow === "md" ? "hidden md:table-cell" : "";
  const al = (c: KitColumn<R>) => c.align === "right" ? "text-right tabular-nums whitespace-nowrap" : c.align === "center" ? "text-center" : "text-left";
  return (
    <>
      {renderCard && <ul className="md:hidden flex flex-col gap-2" aria-label={label}>{rows.map((r) => <li key={rowKey(r)} className="card !p-3">{renderCard(r)}</li>)}</ul>}
      <div className={`${renderCard ? "hidden md:block" : ""} overflow-x-auto rounded-xl border border-line`}>
        <table className="w-full text-[0.875rem] leading-5" aria-label={label}>
          <thead className="bg-[var(--tint-blue-bg)] text-brand">
            <tr>
              {onSelect && <th scope="col" className="w-10 px-3 py-2.5"><input type="checkbox" className="size-4 accent-[var(--accent)]" aria-label="Tout sélectionner" checked={all} onChange={() => onSelect(all ? new Set() : new Set(rows.map(rowKey)))} /></th>}
              {columns.map((c) => <th key={c.key} scope="col" className={`px-3 py-2.5 font-semibold ${al(c)} ${hide(c)}`}>{c.label}</th>)}
              {actions && <th scope="col" className="px-3 py-2.5 font-semibold text-center">Actions</th>}
            </tr>
          </thead>
          <tbody className="bg-surface">{rows.map((r) => { const k = rowKey(r); return (
            <tr key={k} className={`border-t border-line ${onRow ? "d3-row hover:bg-subtle cursor-pointer" : ""} ${sel.has(k) ? "bg-accent-soft" : ""}`} onClick={onRow ? () => onRow(r) : undefined}>
              {onSelect && <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}><input type="checkbox" className="size-4 accent-[var(--accent)]" aria-label={`Sélectionner la ligne ${k}`} checked={sel.has(k)} onChange={() => toggle(k)} /></td>}
              {columns.map((c) => <td key={c.key} className={`px-3 py-2.5 ${al(c)} ${hide(c)} ${c.nowrap ? "whitespace-nowrap" : ""}`}>{c.cell(r)}</td>)}
              {actions && <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}><div className="flex justify-center gap-0.5">{actions(r)}</div></td>}
            </tr>); })}
          </tbody>
        </table>
      </div>
    </>
  );
}
/** Bouton d'action de ligne (œil, crayon, …) : 40 px, nom accessible obligatoire. */
export function RowAction({ icon: I, label, onClick, danger }: { icon: LucideIcon; label: string; onClick: () => void; danger?: boolean }) {
  return <button type="button" className={`icon-btn !min-h-10 !min-w-10 rounded-lg hover:bg-subtle ${danger ? "text-bad" : "text-brand"}`} aria-label={label} title={label} onClick={onClick}><I size={18} /></button>;
}

/** Section de carte avec titre et lien « Voir tout » optionnel. */
export function Panel({ title, icon: I, action, children, className = "" }: { title: string; icon?: LucideIcon; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={`card flex flex-col gap-3 min-w-0 ${className}`}>
      <div className="flex items-center gap-2"><h2 className="font-bold text-brand flex-1 inline-flex items-center gap-2">{I && <I size={20} className="text-accent" aria-hidden="true" />}{title}</h2>{action}</div>
      {children}
    </section>
  );
}

/** Étapes (assistant, flux de travail) : terminée, en cours, à venir. */
export function Stepper({ steps, current, label, compact }: { steps: string[]; current: number; label: string; compact?: boolean }) {
  if (compact) { const cur = Math.min(current, steps.length - 1); const done = current >= steps.length; return (
    <div className="flex flex-col gap-1.5"><ol aria-label={label} className="flex items-center gap-1.5">{steps.map((st, i) => { const d = i < current, on = i === current; return (
      <li key={st} className="flex items-center gap-1.5 flex-1 last:flex-none" aria-current={on ? "step" : undefined}><span className={`shrink-0 size-6 rounded-full inline-flex items-center justify-center text-xs font-bold ${d ? "bg-ok text-white" : on ? "bg-accent text-accent-ink" : "bg-subtle text-soft"}`}>{d ? <Check size={13} aria-hidden="true" /> : i + 1}<span className="sr-only">{st}{d ? " (terminée)" : ""}</span></span>{i < steps.length - 1 && <span className={`h-0.5 flex-1 rounded ${d ? "bg-ok" : "bg-line"}`} aria-hidden="true" />}</li>); })}</ol>
      <p className="text-xs text-soft">{done ? `Toutes les étapes terminées · ${steps[steps.length - 1]}` : `Étape ${cur + 1} sur ${steps.length} · `}{!done && <b className="text-brand">{steps[cur]}</b>}</p></div>); }
  return (
    <ol aria-label={label} className="flex items-center gap-2">
      {steps.map((s, i) => { const done = i < current, on = i === current; return (
        <li key={s} className="flex items-center gap-2 flex-1 last:flex-none min-w-0" aria-current={on ? "step" : undefined}>
          <span className={`shrink-0 size-8 rounded-full inline-flex items-center justify-center text-sm font-bold ${done ? "bg-ok text-white" : on ? "bg-accent text-accent-ink" : "bg-subtle text-soft"}`}>{done ? <Check size={16} aria-label="terminée" /> : i + 1}</span>
          <span className={`text-sm truncate ${on ? "font-semibold text-brand" : "text-soft hidden sm:inline"}`}>{s}</span>
          {i < steps.length - 1 && <span className={`hidden sm:block h-0.5 flex-1 rounded ${done ? "bg-accent" : "bg-line"}`} aria-hidden="true" />}
        </li>); })}
    </ol>
  );
}
