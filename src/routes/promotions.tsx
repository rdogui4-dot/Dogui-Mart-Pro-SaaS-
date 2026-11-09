import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Pencil, Plus, Tag, Trash2 } from "lucide-react";
import { Query } from "@/lib/appwrite";
import { api } from "@/lib/api";
import { list, listAll, type Row } from "@/lib/data";
import { useProductsAll } from "@/lib/queries";
import { can, useSession } from "@/lib/session";
import { Confirm, Sheet } from "@/components/ui";
import { planAllows } from "@/domain/features";
import { formatFcfa } from "@/domain/money";
import { PROMO_KINDS, PROMO_SCOPES, STATUS_LABEL, describeDiscount, promoStatus, type PromoStatus } from "@/domain/promotions";
import { useSubscription } from "./subscription";

type PromoRow = Row<{ name: string; description?: string; code?: string; kind: "percent" | "amount" | "price"; scope: "items" | "category" | "cart"; discountValue: number; category?: string; startAt: string; endAt: string; status: "draft" | "enabled" | "suspended" | "ended"; minQty?: number; minCart?: number; usageLimit?: number; usageCount?: number; perCustomerLimit?: number; priority?: number; allowBelowMargin?: boolean }>;
type ItemRow = Row<{ promotionId: string; productId: string }>;
type UsageRow = Row<{ promotionId: string; saleNumber?: string; customerId?: string; discount: number; baseAmount?: number; finalAmount?: number; usedAt?: string; code?: string }>;
type Stats = { period: { from: string; to: string }; created: number; byStatus: Record<PromoStatus, number>; uses: number; discountTotal: number; promoRevenue: number; items: { id: string; name: string; status: PromoStatus; uses: number; discount: number; revenue: number }[]; note: string };

const TONE: Record<PromoStatus, string> = { draft: "bg-white/10 text-white/70", scheduled: "bg-sky-500/20 text-sky-300", active: "bg-emerald-500/20 text-emerald-300", suspended: "bg-amber-500/20 text-amber-300", ended: "bg-white/10 text-white/50" };
const stat = (p: PromoRow, now = new Date()): PromoStatus => promoStatus({ status: p.status, startAt: p.startAt, endAt: p.endAt }, now);
const fmtDate = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
const toLocalInput = (iso?: string) => { const d = iso ? new Date(iso) : new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

/** Module Promotions (Business) : liste, création/modification, détail avec historique, résultats. Les calculs d'éligibilité et de remise sont faits par le serveur. */
export function PromotionsPage() {
  const { session } = useSession(); const s = session!; const qc = useQueryClient();
  const sub = useSubscription(); const allowed = planAllows(sub.data?.entitlement.plan.id, "promotions"); const manager = (s.role === "owner" || s.role === "manager") && can(s, "stock");
  const promos = useQuery({ queryKey: ["promotions", s.shopId], enabled: allowed, queryFn: () => listAll<PromoRow["$id"] extends string ? Omit<PromoRow, keyof Row<object>> : never>("promotions", s) as unknown as Promise<PromoRow[]> });
  const items = useQuery({ queryKey: ["promotion-items", s.shopId], enabled: allowed, queryFn: () => listAll<{ promotionId: string; productId: string }>("promotion_items", s) as unknown as Promise<ItemRow[]> });
  const prods = useProductsAll(allowed);
  const [tab, setTab] = useState<"list" | "results">("list"); const [filter, setFilter] = useState<"all" | PromoStatus>("all"); const [q, setQ] = useState(""); const [art, setArt] = useState(""); const [cat, setCat] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [edit, setEdit] = useState<PromoRow | "new" | null>(null); const [open, setOpen] = useState<PromoRow | null>(null);
  const now = new Date(); const refresh = () => void qc.invalidateQueries({ queryKey: ["promotions"] }).then(() => qc.invalidateQueries({ queryKey: ["promotion-items"] }));
  const categories = useMemo(() => [...new Set((prods.data ?? []).map((p) => p.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "fr")), [prods.data]);
  const itemsOf = (id: string) => (items.data ?? []).filter((i) => i.promotionId === id).map((i) => i.productId);
  const shown = (promos.data ?? []).filter((p) => (filter === "all" || stat(p, now) === filter) && (!q.trim() || `${p.name} ${p.code ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())) && (!art || itemsOf(p.$id).includes(art)) && (!cat || (p.scope === "category" && (p.category ?? "").toLowerCase() === cat.toLowerCase()) || itemsOf(p.$id).some((id) => prods.data?.find((x) => x.$id === id)?.category === cat))
    && (!from || p.endAt.slice(0, 10) >= from) && (!to || p.startAt.slice(0, 10) <= to)).sort((a, b) => b.startAt.localeCompare(a.startAt));
  if (!allowed) return (
    <div className="flex flex-col gap-3"><h1 className="text-2xl font-bold">Promotions</h1>
      <div className="card flex flex-col gap-2 text-sm"><span className="flex items-center gap-2 font-semibold"><Lock size={16} className="text-[var(--gold)]" />Réservé à la formule Business</span><span className="text-white/60">Remises programmées, codes promotionnels et suivi des résultats.</span><button className="btn !py-2" onClick={() => window.location.assign(`${import.meta.env.BASE_URL}reglages?onglet=abonnement&formule=business`)}>Passer à Business</button></div></div>
  );
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">Promotions</h1>
      <nav aria-label="Sections" className="scroll-x">{([["list", "Promotions"], ["results", "Résultats"]] as const).map(([k, l]) => <button key={k} className="chip" aria-current={tab === k} onClick={() => setTab(k)}>{l}</button>)}</nav>
      {tab === "results" && <Results />}
      {tab === "list" && <>
        {manager && <button className="btn flex items-center justify-center gap-2" onClick={() => setEdit("new")}><Plus size={18} />Nouvelle promotion</button>}
        <div className="scroll-x">{([["all", "Toutes"], ["active", "Actives"], ["scheduled", "Programmées"], ["draft", "Brouillons"], ["suspended", "Suspendues"], ["ended", "Terminées"]] as const).map(([k, l]) => <button key={k} className="chip" aria-current={filter === k} onClick={() => setFilter(k)}>{l}</button>)}</div>
        <input className="input" placeholder="Rechercher (nom ou code)" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <select className="input !px-2" aria-label="Filtrer par article" value={art} onChange={(e) => setArt(e.target.value)}><option value="">Tous les articles</option>{(prods.data ?? []).filter((p) => !p.archived).map((p) => <option key={p.$id} value={p.$id}>{p.name}</option>)}</select>
          <select className="input !px-2" aria-label="Filtrer par catégorie" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Toutes catégories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <label className="text-xs text-white/60">Période du<input className="input mt-1" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="text-xs text-white/60">au<input className="input mt-1" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        {promos.isLoading && <p className="text-white/50 text-sm">Chargement…</p>}
        {!promos.isLoading && !shown.length && <p className="text-center text-white/50 text-sm py-6">{(promos.data ?? []).length ? "Aucune promotion ne correspond aux filtres." : "Aucune promotion. Créez la première : aucune n'est ajoutée automatiquement."}</p>}
        <ul className="flex flex-col gap-2">{shown.map((p) => { const st = stat(p, now); return (
          <li key={p.$id}><button className="card w-full text-left flex flex-col gap-1" onClick={() => setOpen(p)}>
            <div className="flex justify-between gap-2"><b className="truncate flex items-center gap-1"><Tag size={14} className="text-[var(--gold)] shrink-0" />{p.name}</b><span className={`text-xs rounded-full px-2 py-0.5 shrink-0 ${TONE[st]}`}>{STATUS_LABEL[st]}</span></div>
            <div className="text-sm gold-text font-bold">{describeDiscount({ kind: p.kind, value: p.discountValue })}{p.code ? <span className="ml-2 text-xs text-white/60 font-normal">code {p.code}</span> : null}</div>
            <div className="text-xs text-white/50">{fmtDate(p.startAt)} → {fmtDate(p.endAt)} · {p.usageCount ?? 0}{p.usageLimit ? ` / ${p.usageLimit}` : ""} utilisation{(p.usageCount ?? 0) > 1 ? "s" : ""}</div>
          </button></li>); })}</ul>
      </>}
      {edit && <PromotionForm initial={edit === "new" ? null : edit} itemIds={edit === "new" ? [] : itemsOf(edit.$id)} products={prods.data ?? []} categories={categories} onClose={() => setEdit(null)} onSaved={refresh} />}
      {open && <PromotionDetail p={promos.data?.find((x) => x.$id === open.$id) ?? open} itemIds={itemsOf(open.$id)} products={prods.data ?? []} manager={manager} onClose={() => setOpen(null)} onEdit={() => { setEdit(open); setOpen(null); }} onChanged={refresh} />}
    </div>
  );
}

function PromotionForm({ initial, itemIds, products, categories, onClose, onSaved }: { initial: PromoRow | null; itemIds: string[]; products: { $id: string; name: string; price: number; category?: string; archived?: boolean; kind?: string }[]; categories: string[]; onClose: () => void; onSaved: () => void }) {
  const { session } = useSession(); const s = session!; const used = (initial?.usageCount ?? 0) > 0;
  const [f, setF] = useState({ name: initial?.name ?? "", description: initial?.description ?? "", code: initial?.code ?? "", kind: initial?.kind ?? "percent", scope: initial?.scope ?? "items", value: initial ? String(initial.discountValue) : "", category: initial?.category ?? "",
    startAt: toLocalInput(initial?.startAt), endAt: toLocalInput(initial?.endAt ?? new Date(Date.now() + 7 * 864e5).toISOString()), minQty: initial?.minQty ? String(initial.minQty) : "", minCart: initial?.minCart ? String(initial.minCart) : "", usageLimit: initial?.usageLimit ? String(initial.usageLimit) : "", perCustomerLimit: initial?.perCustomerLimit ? String(initial.perCustomerLimit) : "", priority: String(initial?.priority ?? 0), allowBelowMargin: initial?.allowBelowMargin === true });
  const [ids, setIds] = useState<string[]>(itemIds); const [find, setFind] = useState(""); const [err, setErr] = useState(""); const requestId = useMemo(() => crypto.randomUUID(), []);
  const save = useMutation({
    mutationFn: () => api(s, "promotion.save", { ...(initial ? { id: initial.$id } : { requestId }), productIds: f.scope === "items" ? ids : [], data: { ...f, startAt: new Date(f.startAt).toISOString(), endAt: new Date(f.endAt).toISOString(), value: f.value.trim() } }),
    onSuccess: () => { onSaved(); onClose(); }, onError: (e) => setErr((e as Error).message),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const locked = used; const lbl = (t: string, c: React.ReactNode) => <label className="flex flex-col gap-1 text-sm"><span className="text-white/60">{t}</span>{c}</label>;
  const pick = products.filter((p) => !p.archived && p.kind !== "bundle" || ids.includes(p.$id)).filter((p) => !find.trim() || p.name.toLowerCase().includes(find.trim().toLowerCase()));
  const valid = f.name.trim().length >= 2 && f.value.trim() !== "" && f.startAt && f.endAt && (f.scope !== "items" || ids.length > 0) && (f.scope !== "category" || f.category);
  return (
    <Sheet title={initial ? "Modifier la promotion" : "Nouvelle promotion"} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); setErr(""); save.mutate(); }}>
        {locked && <p className="text-xs text-amber-300">Cette promotion a déjà été utilisée : son type, sa valeur, sa portée, son code et ses articles ne changent plus (l'historique reste fidèle). Vous pouvez ajuster le nom, la période et les limites.</p>}
        {lbl("Nom de la promotion *", <input className="input" required minLength={2} maxLength={120} value={f.name} onChange={set("name")} />)}
        {lbl("Description", <textarea className="input" rows={2} maxLength={500} value={f.description} onChange={set("description")} />)}
        {lbl("Code promotionnel (facultatif)", <input className="input" maxLength={20} autoCapitalize="characters" disabled={locked} placeholder="Ex. ETE10 — le client doit le donner" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />)}
        {lbl("Type de remise *", <select className="input" disabled={locked} value={f.kind} onChange={set("kind")}>{PROMO_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select>)}
        {lbl(f.kind === "percent" ? "Pourcentage (1 à 100) *" : f.kind === "amount" ? "Montant de la remise (FCFA, par unité) *" : "Prix promotionnel (FCFA, par unité) *", <input className="input" inputMode="numeric" required disabled={locked} value={f.value} onChange={set("value")} />)}
        {lbl("Concerne *", <select className="input" disabled={locked} value={f.scope} onChange={set("scope")}>{PROMO_SCOPES.filter((x) => !(f.kind === "price" && x.id !== "items")).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>)}
        {f.scope === "category" && lbl("Catégorie *", <select className="input" disabled={locked} value={f.category} onChange={set("category")}><option value="">Choisir…</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select>)}
        {f.scope === "cart" && <p className="text-xs text-white/50">Un code promotionnel est obligatoire : la remise s'applique à toute la vente quand le client le donne.</p>}
        {f.scope === "items" && (
          <div className="card flex flex-col gap-2"><b className="text-sm">Articles concernés ({ids.length}) *</b>
            <input className="input" placeholder="Rechercher un article" value={find} onChange={(e) => setFind(e.target.value)} />
            <div className="max-h-48 overflow-y-auto flex flex-col gap-1">{pick.slice(0, 80).map((p) => <label key={p.$id} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={locked} checked={ids.includes(p.$id)} onChange={(e) => setIds(e.target.checked ? [...ids, p.$id] : ids.filter((x) => x !== p.$id))} /><span className="flex-1 truncate">{p.name}</span><span className="text-white/50 text-xs">{formatFcfa(p.price)}</span></label>)}</div></div>
        )}
        <div className="grid grid-cols-1 gap-2">{lbl("Début *", <input className="input" type="datetime-local" required value={f.startAt} onChange={set("startAt")} />)}{lbl("Fin *", <input className="input" type="datetime-local" required value={f.endAt} onChange={set("endAt")} />)}</div>
        <h3 className="font-semibold text-sm pt-1">Conditions (facultatives)</h3>
        <div className="grid grid-cols-2 gap-2">
          {lbl("Quantité minimale", <input className="input" inputMode="decimal" value={f.minQty} onChange={set("minQty")} />)}{lbl("Panier minimal (FCFA)", <input className="input" inputMode="numeric" value={f.minCart} onChange={set("minCart")} />)}
          {lbl("Utilisations maximales", <input className="input" inputMode="numeric" value={f.usageLimit} onChange={set("usageLimit")} />)}{lbl("Maximum par client", <input className="input" inputMode="numeric" value={f.perCustomerLimit} onChange={set("perCustomerLimit")} />)}
        </div>
        {lbl("Priorité (0 à 100 ; en cas d'égalité de remise)", <input className="input" inputMode="numeric" value={f.priority} onChange={set("priority")} />)}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={locked} className="mt-1" checked={f.allowBelowMargin} onChange={(e) => setF({ ...f, allowBelowMargin: e.target.checked })} /><span>Autoriser la vente sous la marge minimale <span className="text-xs text-white/50 block">Sinon la promotion est refusée à la création, et ignorée à la caisse si le prix final passe sous coût + marge.</span></span></label>
        <p className="text-xs text-white/50">Une promotion n'est jamais cumulée avec une autre sur une même ligne (la plus avantageuse s'applique), ni avec un prix de tarification spécial ou une remise manuelle.</p>
        {err && <p className="text-red-400 text-sm" role="alert">{err}</p>}
        <button className="btn" disabled={save.isPending || !valid}>{save.isPending ? "Enregistrement…" : initial ? "Enregistrer" : "Créer (brouillon)"}</button>
      </form>
    </Sheet>
  );
}

function PromotionDetail({ p, itemIds, products, manager, onClose, onEdit, onChanged }: { p: PromoRow; itemIds: string[]; products: { $id: string; name: string }[]; manager: boolean; onClose: () => void; onEdit: () => void; onChanged: () => void }) {
  const { session } = useSession(); const s = session!; const st = stat(p);
  const [ask, setAsk] = useState<null | "enabled" | "suspended" | "ended" | "delete">(null); const [err, setErr] = useState("");
  const usage = useQuery({ queryKey: ["promotion-usage", p.$id], queryFn: () => list<UsageRow>("promotion_usage", s, [Query.equal("promotionId", p.$id), Query.orderDesc("usedAt")], 200) });
  const act = useMutation({
    mutationFn: async (a: "enabled" | "suspended" | "ended" | "delete") => (a === "delete" ? api(s, "promotion.delete", { id: p.$id }) : api(s, "promotion.status", { id: p.$id, to: a })),
    onSuccess: (_r, a) => { setAsk(null); setErr(""); onChanged(); if (a === "delete") onClose(); }, onError: (e) => { setAsk(null); setErr((e as Error).message); },
  });
  const rows = usage.data ?? []; const sum = (k: "discount" | "finalAmount") => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const name = (id: string) => products.find((x) => x.$id === id)?.name ?? "Article"; const row = (k: string, v: React.ReactNode) => <div className="flex justify-between gap-3 text-sm py-1.5 border-b border-[var(--line)]"><span className="text-white/50">{k}</span><span className="text-right">{v || "—"}</span></div>;
  return (
    <Sheet title={p.name} onClose={onClose} back>
      <div className="flex items-center gap-2"><span className={`text-xs rounded-full px-2 py-0.5 ${TONE[st]}`}>{STATUS_LABEL[st]}</span><b className="gold-text">{describeDiscount({ kind: p.kind, value: p.discountValue })}</b></div>
      {p.description && <p className="text-sm text-white/70">{p.description}</p>}
      <div className="card">
        {row("Code", p.code)}{row("Période", `${fmtDate(p.startAt)} → ${fmtDate(p.endAt)}`)}{row("Concerne", p.scope === "items" ? itemIds.map(name).join(", ") : p.scope === "category" ? `Catégorie « ${p.category} »` : "Toute la vente (avec code)")}
        {row("Quantité minimale", p.minQty ? String(p.minQty) : "")}{row("Panier minimal", p.minCart ? formatFcfa(p.minCart) : "")}{row("Limite d'utilisation", p.usageLimit ? `${p.usageCount ?? 0} / ${p.usageLimit}` : `${p.usageCount ?? 0} (illimitée)`)}{row("Limite par client", p.perCustomerLimit ? String(p.perCustomerLimit) : "")}{row("Priorité", String(p.priority ?? 0))}{row("Sous la marge minimale", p.allowBelowMargin ? "Autorisée" : "Interdite")}
      </div>
      {err && <p className="text-red-400 text-sm" role="alert">{err}</p>}
      {manager && <div className="flex gap-2 flex-wrap text-sm">
        {(st === "draft") && <button className="btn" onClick={() => setAsk("enabled")}>Activer</button>}{p.status === "suspended" && <button className="btn" onClick={() => setAsk("enabled")}>Reprendre</button>}
        {p.status === "enabled" && <button className="btn-ghost" onClick={() => setAsk("suspended")}>Suspendre</button>}{(p.status === "enabled" || p.status === "suspended") && <button className="btn-ghost" onClick={() => setAsk("ended")}>Terminer maintenant</button>}
        {p.status !== "ended" && <button className="btn-ghost flex items-center gap-1" onClick={onEdit}><Pencil size={14} />Modifier</button>}{!(p.usageCount ?? 0) && <button className="btn-ghost !text-red-300 flex items-center gap-1" onClick={() => setAsk("delete")}><Trash2 size={14} />Supprimer</button>}
      </div>}
      <h3 className="font-semibold">Historique des utilisations</h3>
      <div className="grid grid-cols-3 gap-2 text-center"><div className="card"><div className="text-xs text-white/50">Utilisations</div><b>{rows.length}</b></div><div className="card"><div className="text-xs text-white/50">Remises</div><b>{formatFcfa(sum("discount"))}</b></div><div className="card"><div className="text-xs text-white/50">CA net</div><b>{formatFcfa(sum("finalAmount"))}</b></div></div>
      <p className="text-xs text-white/40">Le CA net est le montant encaissé sur les lignes en promotion, après remise : ce n'est pas un bénéfice.</p>
      {usage.isLoading ? <p className="text-sm text-white/50">Chargement…</p> : !rows.length ? <p className="text-sm text-white/50">Aucune utilisation pour le moment.</p> : rows.map((r) => <div key={r.$id} className="flex justify-between gap-2 text-sm border-t border-[var(--line)] pt-1"><span>{r.saleNumber ?? "—"}<span className="text-xs text-white/50 block">{r.usedAt ? fmtDate(r.usedAt) : ""}</span></span><span className="text-right">−{formatFcfa(r.discount)}<span className="text-xs text-white/50 block">{formatFcfa(r.finalAmount ?? 0)} encaissé</span></span></div>)}
      {ask === "enabled" && <Confirm text={st === "draft" || p.status === "draft" ? `Activer « ${p.name} » ? Elle s'appliquera automatiquement aux ventes dès le ${fmtDate(p.startAt)} (programmée si cette date est future).` : `Reprendre « ${p.name} » ?`} confirmLabel="Confirmer" onNo={() => setAsk(null)} onYes={() => act.mutate("enabled")} />}
      {ask === "suspended" && <Confirm text={`Suspendre « ${p.name} » ? Elle ne sera plus appliquée tant que vous ne la reprenez pas.`} confirmLabel="Suspendre" onNo={() => setAsk(null)} onYes={() => act.mutate("suspended")} />}
      {ask === "ended" && <Confirm danger text={`Terminer « ${p.name} » maintenant ? Cette action est définitive (l'historique est conservé).`} confirmLabel="Terminer" onNo={() => setAsk(null)} onYes={() => act.mutate("ended")} />}
      {ask === "delete" && <Confirm danger text={`Supprimer « ${p.name} » ? Possible seulement parce qu'elle n'a jamais été utilisée.`} confirmLabel="Supprimer" onNo={() => setAsk(null)} onYes={() => act.mutate("delete")} />}
    </Sheet>
  );
}

function Results() {
  const { session } = useSession(); const s = session!; const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10)); const [to, setTo] = useState(today);
  const q = useQuery({ queryKey: ["promotion-stats", s.shopId, from, to], queryFn: () => api<Stats>(s, "promotions.stats", { from, to }) });
  const d = q.data; const kpi = (label: string, v: string) => <div className="card"><div className="text-white/50 text-xs">{label}</div><div className="font-semibold text-lg">{v}</div></div>;
  return (
    <>
      <div className="grid grid-cols-2 gap-2"><label className="text-xs text-white/60">Du<input className="input mt-1" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label><label className="text-xs text-white/60">Au<input className="input mt-1" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label></div>
      {q.isLoading && <p className="text-white/50 text-sm">Calcul en cours…</p>}{q.error && <p className="text-red-400 text-sm" role="alert">{(q.error as Error).message}</p>}
      {d && <>
        <div className="grid grid-cols-2 gap-2">
          {kpi("Promotions créées", String(d.created))}{kpi("Actives", String(d.byStatus.active))}{kpi("Programmées", String(d.byStatus.scheduled))}{kpi("Terminées", String(d.byStatus.ended))}
          {kpi("Utilisations (période)", String(d.uses))}{kpi("Remises accordées", formatFcfa(d.discountTotal))}
        </div>
        <div className="card"><div className="text-white/50 text-xs">Chiffre d'affaires des lignes en promotion (net de remise)</div><div className="font-semibold text-lg">{formatFcfa(d.promoRevenue)}</div><p className="text-xs text-white/40 mt-1">{d.note}</p></div>
        <section className="card flex flex-col gap-1" aria-label="Détail par promotion"><h2 className="font-semibold">Par promotion</h2>{!d.items.length ? <p className="text-sm text-white/50">Aucune utilisation sur la période.</p> : d.items.map((i) => <div key={i.id} className="flex justify-between gap-2 text-sm border-t border-[var(--line)] pt-1"><span className="truncate">{i.name}<span className="text-xs text-white/50 block">{STATUS_LABEL[i.status]} · {i.uses} utilisation{i.uses > 1 ? "s" : ""}</span></span><span className="text-right shrink-0">−{formatFcfa(i.discount)}<span className="text-xs text-white/50 block">CA net {formatFcfa(i.revenue)}</span></span></div>)}</section>
      </>}
    </>
  );
}
