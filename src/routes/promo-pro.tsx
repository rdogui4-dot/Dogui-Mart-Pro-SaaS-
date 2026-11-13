import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Calendar as CalIcon, Copy } from "lucide-react";
import { api } from "@/lib/api";
import { listAll } from "@/lib/data";
import { useSession } from "@/lib/session";
import { formatFcfa } from "@/domain/money";
import { FAMILIES, STATUS_LABEL, TIMEZONES, utcToZoned, zonedToUtc, type Family } from "@/domain/promotions";
import { FAMILY_LABEL, ProLock, TONE, fmtDate, fmtDay, type ListData, type PromoView } from "./promo-shared";

const kpi = (label: string, v: string, sub?: string) => <div className="card"><div className="text-muted text-xs">{label}</div><div className="font-semibold text-lg">{v}</div>{sub && <div className="text-xs text-muted">{sub}</div>}</div>;
const Err = ({ e }: { e: unknown }) => (e ? <p className="text-bad text-sm" role="alert">{(e as Error).message}</p> : null);

/** Calendrier : campagnes par jour (à l'heure de l'entreprise), chevauchements détectés, expirations proches. */
export function CalendarTab({ data, onOpen }: { data: ListData; onOpen: (p: PromoView) => void }) {
  const live = data.promos.filter((p) => p.status !== "ended" || Date.parse(p.endAt) > Date.now() - 7 * 864e5).sort((a, b) => a.startAt.localeCompare(b.startAt));
  const name = (id: string) => data.promos.find((p) => p.id === id)?.name ?? id;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted">Toutes les dates sont à l'heure de l'entreprise ({data.tz}). L'activation et l'expiration sont automatiques : le serveur contrôle la date à chaque vente.</p>
      {!!data.expiringSoon.length && <div className="card border border-warn/40 flex flex-col gap-1" role="status"><b className="text-sm flex items-center gap-1 text-warn"><AlertTriangle size={14} />Expirent dans moins de 3 jours</b>{data.expiringSoon.map((x) => <div key={x.id} className="text-sm">{x.name} <span className="text-muted">— fin {fmtDate(x.endAt, data.tz)}</span></div>)}</div>}
      {!!data.overlaps.length && <div className="card border border-warn/40 flex flex-col gap-1" role="status"><b className="text-sm flex items-center gap-1 text-warn"><Copy size={14} />Chevauchements ({data.overlaps.length})</b>{data.overlaps.map((o, i) => <div key={i} className="text-sm">« {name(o.a)} » et « {name(o.b)} » <span className="text-muted">— {o.why}. Le moteur n'en applique qu'une par article (la plus avantageuse) sauf cumul autorisé.</span></div>)}</div>}
      {!live.length && <p className="text-center text-muted text-sm py-6">Aucune campagne planifiée.</p>}
      <ul className="flex flex-col gap-2">{live.map((p) => (
        <li key={p.id}><button className="card w-full text-left flex flex-col gap-1" onClick={() => onOpen(p)}>
          <div className="flex justify-between gap-2"><b className="truncate flex items-center gap-1"><CalIcon size={14} className="text-accent-text shrink-0" />{p.name}</b><span className={`text-xs rounded-full px-2 py-0.5 shrink-0 ${TONE[p.effective]}`}>{STATUS_LABEL[p.effective]}</span></div>
          <div className="text-xs text-muted">{fmtDay(p.startAt, data.tz)} {fmtDate(p.startAt, data.tz).slice(-5)} → {fmtDay(p.endAt, data.tz)} {fmtDate(p.endAt, data.tz).slice(-5)}</div>
          <div className="text-xs text-muted">{FAMILY_LABEL[p.family ?? "simple"]}{p.foreign ? " · autre magasin" : ""}{p.frozen ? " · gelée (Pro requis)" : ""}</div></button></li>))}</ul>
    </div>
  );
}

type CouponRow = { id: string; code: string; promotionId: string; promotionName: string; singleUse: boolean; maxUses?: number; usedCount: number; customerId?: string; validFrom?: string; validTo?: string; active: boolean; invalidAttempts: number };
type CouponsData = { coupons: CouponRow[]; invalidTotal: number; invalidUnknown: number; invalidRecent: { code: string; reason: string; at: string }[] };
const REASON: Record<string, string> = { unknown: "code inconnu", inactive: "désactivé", not_started: "pas encore valable", expired: "expiré", customer: "autre client", customer_required: "client requis", used_up: "limite atteinte", promo_unavailable: "campagne indisponible" };

/** Gestion des coupons : création (code personnalisé, usage unique, limite, période, client réservé, série), activation, suivi des utilisations ET des tentatives invalides. */
export function CouponsTab({ data, pro }: { data: ListData; pro: boolean }) {
  const { session } = useSession(); const s = session!; const qc = useQueryClient(); const tz = data.tz;
  const q = useQuery({ queryKey: ["coupons", s.shopId], enabled: pro, queryFn: () => api<CouponsData>(s, "coupons.list", {}) });
  const custs = useQuery({ queryKey: ["customers-all", s.shopId], enabled: pro, queryFn: () => listAll<{ name: string }>("customers", s) });
  const own = data.promos.filter((p) => !p.foreign && p.status !== "ended");
  const [f, setF] = useState({ promotionId: "", code: "", singleUse: false, maxUses: "", customerId: "", validFrom: "", validTo: "", count: "1" }); const [err, setErr] = useState("");
  const refresh = () => void qc.invalidateQueries({ queryKey: ["coupons"] }).then(() => qc.invalidateQueries({ queryKey: ["promotions-list"] }));
  const toIso = (v: string) => (v ? zonedToUtc(v, tz) : "");
  const create = useMutation({ mutationFn: () => api(s, "coupon.save", { promotionId: f.promotionId, ...(f.code.trim() ? { code: f.code.trim() } : {}), singleUse: f.singleUse, maxUses: f.maxUses.trim() || undefined, customerId: f.customerId || undefined, validFrom: toIso(f.validFrom) || undefined, validTo: toIso(f.validTo) || undefined, count: Number(f.count) || 1 }), onSuccess: () => { setErr(""); setF({ ...f, code: "", count: "1" }); refresh(); }, onError: (e) => setErr((e as Error).message) });
  const toggle = useMutation({ mutationFn: (c: CouponRow) => api(s, "coupon.save", { id: c.id, active: !c.active, maxUses: c.maxUses, validFrom: c.validFrom, validTo: c.validTo }), onSuccess: refresh, onError: (e) => setErr((e as Error).message) });
  if (!pro) return <ProLock what="Coupons personnalisés, à usage unique, limités, réservés à un client, avec suivi des utilisations et des tentatives invalides." />;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const lbl = (t: string, c: React.ReactNode) => <label className="flex flex-col gap-1 text-sm"><span className="text-muted">{t}</span>{c}</label>;
  const cname = (id?: string) => (id ? custs.data?.find((c) => c.$id === id)?.name ?? "client" : "");
  return (
    <div className="flex flex-col gap-3">
      <form className="card flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); setErr(""); create.mutate(); }}>
        <b className="text-sm">Nouveau coupon</b>
        {lbl("Campagne liée *", <select className="input" required value={f.promotionId} onChange={set("promotionId")}><option value="">Choisir…</option>{own.map((p) => <option key={p.id} value={p.id}>{p.name}{p.requiresCoupon ? " (coupon exigé)" : ""}</option>)}</select>)}
        <div className="grid grid-cols-2 gap-2">{lbl("Code (généré si vide)", <input className="input" maxLength={20} autoCapitalize="characters" disabled={Number(f.count) > 1} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />)}{lbl("Nombre de codes (série à usage unique)", <input className="input" inputMode="numeric" value={f.count} onChange={set("count")} />)}</div>
        <div className="grid grid-cols-2 gap-2">{lbl("Utilisations maximales", <input className="input" inputMode="numeric" disabled={f.singleUse} value={f.maxUses} onChange={set("maxUses")} />)}{lbl("Réservé au client", <select className="input" disabled={Number(f.count) > 1} value={f.customerId} onChange={set("customerId")}><option value="">Tous</option>{(custs.data ?? []).map((c) => <option key={c.$id} value={c.$id}>{c.name}</option>)}</select>)}</div>
        <div className="grid grid-cols-2 gap-2">{lbl("Valable du", <input className="input" type="datetime-local" value={f.validFrom} onChange={set("validFrom")} />)}{lbl("au", <input className="input" type="datetime-local" value={f.validTo} onChange={set("validTo")} />)}</div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.singleUse} onChange={(e) => setF({ ...f, singleUse: e.target.checked })} />Usage unique</label>
        <Err e={err ? new Error(err) : null} /><button className="btn" disabled={!f.promotionId || create.isPending}>{create.isPending ? "Création…" : "Créer"}</button>
      </form>
      {q.isLoading && <p className="text-sm text-muted">Chargement…</p>}<Err e={q.error} />
      {q.data && <>
        <div className="grid grid-cols-2 gap-2">{kpi("Coupons", String(q.data.coupons.length))}{kpi("Tentatives invalides", String(q.data.invalidTotal), `${q.data.invalidUnknown} code(s) inconnu(s)`)}</div>
        <ul className="flex flex-col gap-2">{q.data.coupons.map((c) => (
          <li key={c.id} className="card flex flex-col gap-1"><div className="flex justify-between gap-2"><b className="font-mono">{c.code}</b><span className={`text-xs rounded-full px-2 py-0.5 ${c.active ? "bg-ok-bg text-ok" : "bg-subtle text-muted"}`}>{c.active ? "Actif" : "Désactivé"}</span></div>
            <div className="text-xs text-muted">{c.promotionName} · {c.usedCount}{c.singleUse ? " / 1" : c.maxUses ? ` / ${c.maxUses}` : ""} utilisation(s){c.customerId ? ` · réservé à ${cname(c.customerId)}` : ""}{c.invalidAttempts ? ` · ${c.invalidAttempts} tentative(s) invalide(s)` : ""}</div>
            {(c.validFrom || c.validTo) && <div className="text-xs text-muted">{c.validFrom ? fmtDate(c.validFrom, tz) : "…"} → {c.validTo ? fmtDate(c.validTo, tz) : "…"}</div>}
            <button className="btn-ghost !py-1 text-sm self-start" onClick={() => toggle.mutate(c)}>{c.active ? "Désactiver" : "Réactiver"}</button></li>))}</ul>
        {!!q.data.invalidRecent.length && <section className="card flex flex-col gap-1" aria-label="Tentatives invalides récentes"><h3 className="font-semibold text-sm">Tentatives invalides récentes</h3>{q.data.invalidRecent.map((r, i) => <div key={i} className="text-sm flex justify-between border-t border-[var(--line)] pt-1"><span className="font-mono">{r.code}</span><span className="text-muted">{REASON[r.reason] ?? r.reason} · {fmtDate(r.at, tz)}</span></div>)}</section>}
      </>}
    </div>
  );
}
export type Analytics = {
  period: { from: string; to: string; tz: string }; reference: { from: string; to: string }; scope: string; campaigns: { created: number; byStatus: Record<string, number>; active: number };
  totals: { uses: number; discount: number; revenue: number; beneficiaries: number }; reference_totals: { uses: number; discount: number; revenue: number; beneficiaries: number }; comparison: { uses: number | null; discount: number | null; revenue: number | null }; comparisonNote: string;
  salesTotal: number; promoShareOfSalesPct: number | null; margin: { grossMargin: number | null; linesWithCost: number; linesWithoutCost: number; note: string };
  lowMargin: { saleNumber: string; promotion: string; article: string; finalAmount: number; cost: number; marginPct: number }[]; lowMarginByCampaign: { id: string; name: string; lines: number }[];
  byCampaign: { id: string; name: string; uses: number; discount: number; revenue: number }[]; byArticle: { id: string; name: string; qty: number; discount: number; revenue: number }[]; byCategory: { id: string; qty: number; discount: number; revenue: number }[];
  byStore: { id: string; name: string; uses: number; discount: number; revenue: number }[]; byDay: { day: string; uses: number; discount: number; revenue: number }[]; coupons: { top: { code: string; uses: number }[]; invalidAttempts: number };
  budgets: { id: string; name: string; budget: number; spent: number; remaining: number; perStore: { shopId: string; shop: string; budget: number; spent: number }[] }[]; truncated: boolean; note: string;
};
const delta = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v} %`);

function usePeriod() { const today = new Date().toISOString().slice(0, 10); return { today, init: new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10) }; }

/** Analyse de performance : chiffres réels uniquement ; `scope="all"` compare les magasins (propriétaire). */
export function AnalyticsTab({ pro, view }: { pro: boolean; view: "perf" | "stores" | "budgets" }) {
  const { session } = useSession(); const s = session!; const { today, init } = usePeriod(); const [from, setFrom] = useState(init); const [to, setTo] = useState(today);
  const scope = view === "stores" ? "all" : "shop";
  const q = useQuery({ queryKey: ["promo-analytics", s.shopId, from, to, scope], enabled: pro && (scope === "shop" || s.role === "owner"), queryFn: () => api<Analytics>(s, "promotions.analytics", { from, to, scope }) });
  if (!pro) return <ProLock what="Analyses de performance, budgets, comparaison entre magasins et marges réelles des campagnes." />;
  if (view === "stores" && s.role !== "owner") return <p className="text-sm text-muted card">La comparaison entre magasins est réservée au propriétaire.</p>;
  const d = q.data; const tz = d?.period.tz ?? "UTC"; const max = Math.max(1, ...(d?.byDay.map((x) => x.discount) ?? [1]));
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2"><label className="text-xs text-muted">Du<input className="input mt-1" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label><label className="text-xs text-muted">Au<input className="input mt-1" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label></div>
      {q.isLoading && <p className="text-sm text-muted">Calcul en cours…</p>}<Err e={q.error} />
      {d && view === "perf" && <>
        <div className="grid grid-cols-2 gap-2">{kpi("Campagnes créées", String(d.campaigns.created))}{kpi("Actives", String(d.campaigns.active))}{kpi("Utilisations", String(d.totals.uses), `préc. ${d.reference_totals.uses} · ${delta(d.comparison.uses)}`)}{kpi("Clients bénéficiaires", String(d.totals.beneficiaries))}{kpi("Remises accordées", formatFcfa(d.totals.discount), `préc. ${formatFcfa(d.reference_totals.discount)} · ${delta(d.comparison.discount)}`)}{kpi("CA des lignes en promotion", formatFcfa(d.totals.revenue), d.promoShareOfSalesPct === null ? undefined : `${d.promoShareOfSalesPct} % des ventes`)}</div>
        <div className="card"><div className="text-muted text-xs">Marge brute des lignes en promotion</div><div className="font-semibold text-lg">{d.margin.grossMargin === null ? "Non calculable" : formatFcfa(d.margin.grossMargin)}</div><p className="text-xs text-muted mt-1">{d.margin.note}</p></div>
        <p className="text-xs text-muted">{d.comparisonNote} Période de référence : {d.reference.from} → {d.reference.to}.</p>
        {!!d.lowMargin.length && <section className="card flex flex-col gap-1" aria-label="Ventes à faible marge"><h3 className="font-semibold text-sm flex items-center gap-1 text-warn"><AlertTriangle size={14} />Ventes en promotion sous la marge minimale ({d.lowMargin.length})</h3>{d.lowMargin.map((m, i) => <div key={i} className="text-sm flex justify-between gap-2 border-t border-[var(--line)] pt-1"><span className="truncate">{m.saleNumber} · {m.article}<span className="text-xs text-muted block">{m.promotion}</span></span><span className="shrink-0 text-right">{m.marginPct} %<span className="text-xs text-muted block">{formatFcfa(m.finalAmount)} / coût {formatFcfa(m.cost)}</span></span></div>)}</section>}
        <Block title="Remises par jour (heure de l'entreprise)">{!d.byDay.length ? <p className="text-sm text-muted">Aucune utilisation.</p> : d.byDay.map((x) => <div key={x.day} className="flex items-center gap-2 text-xs"><span className="w-20 text-muted">{x.day.slice(5)}</span><span className="h-2 rounded bg-accent" style={{ width: `${Math.max(2, Math.round(x.discount / max * 100))}%` }} /><span className="text-muted shrink-0">{formatFcfa(x.discount)}</span></div>)}</Block>
        <Block title="Par campagne">{d.byCampaign.map((x) => <Line key={x.id} a={x.name} b={`${x.uses} utilisation(s)`} c={`−${formatFcfa(x.discount)}`} d={`CA ${formatFcfa(x.revenue)}`} />)}{!d.byCampaign.length && <p className="text-sm text-muted">Aucune utilisation.</p>}</Block>
        <Block title="Par article">{d.byArticle.map((x) => <Line key={x.id} a={x.name} b={`${x.qty} vendu(s)`} c={`−${formatFcfa(x.discount)}`} d={`CA ${formatFcfa(x.revenue)}`} />)}</Block>
        <Block title="Par catégorie">{d.byCategory.map((x) => <Line key={x.id} a={x.id} b={`${x.qty} vendu(s)`} c={`−${formatFcfa(x.discount)}`} d={`CA ${formatFcfa(x.revenue)}`} />)}</Block>
        <Block title="Coupons">{d.coupons.top.map((x) => <Line key={x.code} a={x.code} b={`${x.uses} utilisation(s)`} />)}<p className="text-sm text-muted">Tentatives invalides : {d.coupons.invalidAttempts}</p></Block>
        {d.truncated && <p className="text-xs text-warn">Volume très important : certaines lignes n'ont pas été lues, les totaux peuvent être partiels.</p>}
        <p className="text-xs text-muted">{d.note} Fuseau : {tz}.</p>
      </>}
      {d && view === "stores" && <>
        <Block title="Comparaison des magasins (période)">{!d.byStore.length ? <p className="text-sm text-muted">Aucune utilisation sur la période.</p> : d.byStore.map((x) => <Line key={x.id} a={x.name} b={`${x.uses} utilisation(s)`} c={`−${formatFcfa(x.discount)}`} d={`CA ${formatFcfa(x.revenue)}`} />)}</Block>
        <p className="text-xs text-muted">Chaque magasin garde son stock et ses ventes : seules les remises et utilisations de promotions sont comparées. {d.note}</p>
      </>}
      {d && view === "budgets" && <>
        {!d.budgets.length && <p className="text-sm text-muted text-center py-6">Aucune campagne n'a de budget. Définissez-en un dans la création d'une campagne.</p>}
        {d.budgets.map((b) => { const pct = Math.min(100, Math.round(b.spent / b.budget * 100)); return <section key={b.id} className="card flex flex-col gap-1"><div className="flex justify-between gap-2"><b className="truncate">{b.name}</b><span className="text-sm">{formatFcfa(b.spent)} / {formatFcfa(b.budget)}</span></div>
          <div className="h-2 rounded bg-subtle"><div className={`h-2 rounded ${pct >= 90 ? "bg-bad" : "bg-accent"}`} style={{ width: `${pct}%` }} /></div><div className="text-xs text-muted">Reste {formatFcfa(b.remaining)} · remises réellement accordées, toutes boutiques</div>
          {b.perStore.map((x) => <div key={x.shopId} className="text-xs text-muted flex justify-between"><span>{x.shop} (budget local)</span><span>{formatFcfa(x.spent)} / {formatFcfa(x.budget)}</span></div>)}</section>; })}
      </>}
    </div>
  );
}
const Block = ({ title, children }: { title: string; children: React.ReactNode }) => <section className="card flex flex-col gap-1"><h3 className="font-semibold text-sm">{title}</h3>{children}</section>;
const Line = ({ a, b, c, d }: { a: string; b: string; c?: string; d?: string }) => <div className="text-sm flex justify-between gap-2 border-t border-[var(--line)] pt-1"><span className="truncate">{a}<span className="text-xs text-muted block">{b}</span></span>{c && <span className="shrink-0 text-right">{c}<span className="text-xs text-muted block">{d}</span></span>}</div>;

type Reco = { id: string; kind: string; title: string; why: string; data: Record<string, string | number>; limits: string; prefill?: { family?: string; name?: string; productIds?: string[]; comboProductIds?: string[] } };
/** Recommandations : justification, données utilisées et limites. Rien n'est créé ni activé automatiquement ; « Préparer » ouvre le formulaire pré-rempli. */
export function RecosTab({ pro, onPrepare }: { pro: boolean; onPrepare: (p: NonNullable<Reco["prefill"]>) => void }) {
  const { session } = useSession(); const s = session!;
  const q = useQuery({ queryKey: ["promo-recos", s.shopId], enabled: pro, queryFn: () => api<{ recommendations: Reco[]; generatedAt: string; note: string }>(s, "promotions.recommendations", {}) });
  if (!pro) return <ProLock what="Recommandations fondées sur vos ventes et votre stock : faible rotation, surstock, ventes liées, campagnes peu utilisées." />;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted">{q.data?.note ?? "Suggestions fondées sur vos données réelles. Rien n'est créé ni activé automatiquement."}</p>
      {q.isLoading && <p className="text-sm text-muted">Analyse en cours…</p>}<Err e={q.error} />
      {q.data && !q.data.recommendations.length && <p className="text-center text-muted text-sm py-6">Aucune recommandation pour le moment.</p>}
      {q.data?.recommendations.map((r) => (
        <section key={r.id} className="card flex flex-col gap-1"><b className="text-sm">{r.title}</b><p className="text-sm text-soft">{r.why}</p>
          {!!Object.keys(r.data).length && <p className="text-xs text-muted">Données : {Object.entries(r.data).map(([k, v]) => `${k} ${typeof v === "number" ? v.toLocaleString("fr-FR") : v}`).join(" · ")}</p>}
          {r.limits && <p className="text-xs text-muted">Limites : {r.limits}</p>}
          {r.prefill && <button className="btn-ghost !py-1 text-sm self-start" onClick={() => onPrepare(r.prefill!)}>Préparer une campagne (brouillon à valider)</button>}</section>))}
    </div>
  );
}

/** Réglages : fuseau horaire, plafonds, stratégie « meilleure offre » ou « priorité », priorité par type de remise. */
export function SettingsTab({ data, pro }: { data: ListData; pro: boolean }) {
  const { session } = useSession(); const s = session!; const qc = useQueryClient(); const st = data.settings;
  const [tz, setTz] = useState(st.tz); const [line, setLine] = useState(st.maxLinePct?.toString() ?? ""); const [cart, setCart] = useState(st.maxCartPct?.toString() ?? ""); const [strategy, setStrategy] = useState(st.strategy);
  const [rank, setRank] = useState<Family[]>(() => { const r = st.typeRank.filter((x): x is Family => FAMILIES.some((f) => f.id === x)); return [...r, ...(["combo", "bogo", "tiers", "requires", "cart", "simple"] as Family[]).filter((f) => !r.includes(f))]; });
  const [err, setErr] = useState(""); const [okMsg, setOk] = useState("");
  const save = useMutation({ mutationFn: () => api(s, "promotions.settings", { tz, ...(pro ? { maxLinePct: line.trim() ? Number(line) : null, maxCartPct: cart.trim() ? Number(cart) : null, strategy, typeRank: rank } : {}) }), onSuccess: () => { setErr(""); setOk("Réglages enregistrés."); void qc.invalidateQueries({ queryKey: ["promotions-list"] }); }, onError: (e) => { setOk(""); setErr((e as Error).message); } });
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= rank.length) return; const r = [...rank]; [r[i], r[j]] = [r[j]!, r[i]!]; setRank(r); };
  const lbl = (t: string, c: React.ReactNode) => <label className="flex flex-col gap-1 text-sm"><span className="text-muted">{t}</span>{c}</label>;
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <section className="card flex flex-col gap-2"><h3 className="font-semibold text-sm">Fuseau horaire de l'entreprise</h3>
        {lbl("Toutes les dates de campagnes sont saisies et affichées dans ce fuseau", <select className="input" value={tz} onChange={(e) => setTz(e.target.value)}>{[...new Set([tz, ...TIMEZONES])].map((z) => <option key={z}>{z}</option>)}</select>)}<p className="text-xs text-muted">Heure actuelle : {utcToZoned(data.now, tz).replace("T", " ")}</p></section>
      {!pro ? <ProLock what="Plafonds de remise, stratégie meilleure offre/priorité, priorité par type de remise." /> : <>
        <section className="card flex flex-col gap-2"><h3 className="font-semibold text-sm">Plafonds de remise (toutes campagnes)</h3>
          <div className="grid grid-cols-2 gap-2">{lbl("Par article (% du prix)", <input aria-label="aucun" className="input" inputMode="numeric" placeholder="aucun" value={line} onChange={(e) => setLine(e.target.value)} />)}{lbl("Par panier (% du panier)", <input aria-label="aucun" className="input" inputMode="numeric" placeholder="aucun" value={cart} onChange={(e) => setCart(e.target.value)} />)}</div></section>
        <section className="card flex flex-col gap-2"><h3 className="font-semibold text-sm">Règle de choix entre campagnes concurrentes</h3>
          {lbl("Stratégie", <select className="input" value={strategy} onChange={(e) => setStrategy(e.target.value as "best" | "priority")}><option value="best">Meilleure offre pour le client (la plus forte remise)</option><option value="priority">Priorité des campagnes (la plus prioritaire d'abord)</option></select>)}
          <p className="text-xs text-muted">Deux campagnes ne se cumulent que si toutes deux sont marquées « cumulables ». Une campagne non cumulable n'est jamais empilée automatiquement.</p>
          <b className="text-sm pt-1">Priorité par type de remise (en cas d'égalité)</b>
          <ol className="flex flex-col gap-1">{rank.map((f, i) => <li key={f} className="flex items-center gap-2 text-sm"><span className="w-5 text-muted">{i + 1}.</span><span className="flex-1">{FAMILY_LABEL[f]}</span><button type="button" className="btn-ghost !py-0.5 !px-2" aria-label={`Monter ${FAMILY_LABEL[f]}`} onClick={() => move(i, -1)}>↑</button><button type="button" className="btn-ghost !py-0.5 !px-2" aria-label={`Descendre ${FAMILY_LABEL[f]}`} onClick={() => move(i, 1)}>↓</button></li>)}</ol></section></>}
      <Err e={err ? new Error(err) : null} />{okMsg && <p className="text-ok text-sm" role="status">{okMsg}</p>}
      <button className="btn" disabled={save.isPending}>{save.isPending ? "Enregistrement…" : "Enregistrer"}</button>
      <p className="text-xs text-muted">La marge minimale de la boutique se règle dans Réglages → Promotions.</p>
    </form>
  );
}

/** Journal d'audit : qui a créé, modifié, activé, suspendu une campagne ou un coupon, et quand. */
export function JournalTab({ tz }: { tz: string }) {
  const { session } = useSession(); const s = session!;
  const q = useQuery({ queryKey: ["promo-journal", s.shopId], queryFn: () => api<{ entries: { at: string; action: string; detail: string; user: string }[]; truncated: boolean }>(s, "promotions.journal", {}) });
  const LABEL = useMemo<Record<string, string>>(() => ({ "promotion.create": "Création", "promotion.update": "Modification", "promotion.enabled": "Activation", "promotion.suspended": "Suspension", "promotion.ended": "Fin", "promotion.delete": "Suppression", "promotion.storeRule": "Règle de magasin", "promotion.storeRule.clear": "Règle de magasin retirée", "promotion.settings": "Réglages", "coupon.create": "Coupon créé", "coupon.update": "Coupon modifié" }), []);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted">Historique des actions sur les promotions et les coupons de cette boutique.</p>
      {q.isLoading && <p className="text-sm text-muted">Chargement…</p>}<Err e={q.error} />
      {q.data && !q.data.entries.length && <p className="text-center text-muted text-sm py-6">Aucune action enregistrée.</p>}
      {q.data?.entries.map((e, i) => <div key={i} className="card text-sm flex flex-col"><span className="flex justify-between gap-2"><b>{LABEL[e.action] ?? e.action}</b><span className="text-xs text-muted">{e.at ? fmtDate(e.at, tz) : ""}</span></span><span className="text-soft break-words">{e.detail}</span><span className="text-xs text-muted">{e.user}</span></div>)}
    </div>
  );
}
