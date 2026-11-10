import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Lock, Pencil, Plus, Tag, Trash2 } from "lucide-react";
import { Query } from "@/lib/appwrite";
import { api } from "@/lib/api";
import { list, listAll, type Row } from "@/lib/data";
import { useProductsAll } from "@/lib/queries";
import { can, useSession } from "@/lib/session";
import { Confirm, Sheet } from "@/components/ui";
import { planAllows } from "@/domain/features";
import { formatFcfa } from "@/domain/money";
import { FAMILIES, LOYALTY_TIERS, PROMO_KINDS, PROMO_SCOPES, STATUS_LABEL, utcToZoned, zonedToUtc, type Family, type PromoKind, type PromoStatus, type StoreScope } from "@/domain/promotions";
import { CUSTOMER_CATEGORIES } from "@/domain/pricing";
import { useSubscription } from "./subscription";
import { FAMILY_LABEL, ItemPicker, ProLock, TONE, fmtDate, usePromoList, type ListData, type PromoView } from "./promo-shared";
import { AnalyticsTab, CalendarTab, CouponsTab, JournalTab, RecosTab, SettingsTab } from "./promo-pro";

type UsageRow = Row<{ promotionId: string; saleNumber?: string; customerId?: string; discount: number; baseAmount?: number; finalAmount?: number; usedAt?: string; code?: string; family?: string }>;
type Stats = { period: { from: string; to: string }; created: number; byStatus: Record<PromoStatus, number>; uses: number; discountTotal: number; promoRevenue: number; items: { id: string; name: string; status: PromoStatus; uses: number; discount: number; revenue: number }[]; note: string };
type Prefill = { family?: string; name?: string; productIds?: string[]; comboProductIds?: string[] };
type Tab = "list" | "calendar" | "coupons" | "budgets" | "perf" | "stores" | "recos" | "settings" | "journal" | "results";
const TABS: { k: Tab; l: string; pro?: boolean }[] = [{ k: "list", l: "Campagnes" }, { k: "calendar", l: "Calendrier" }, { k: "coupons", l: "Coupons", pro: true }, { k: "budgets", l: "Budgets", pro: true }, { k: "perf", l: "Performance", pro: true }, { k: "stores", l: "Magasins", pro: true }, { k: "recos", l: "Conseils", pro: true }, { k: "settings", l: "Réglages" }, { k: "journal", l: "Journal" }, { k: "results", l: "Résultats" }];

/** Module Promotions : UN moteur pour Business et Pro. Business : remises simples. Pro : prix dégressifs, achetez X obtenez Y, packs, conditions, coupons, ciblage clients,
 *  budgets, multi-magasins, analyses, conseils. Chaque calcul d'éligibilité et de remise est fait par le serveur ; ici on saisit, on affiche et on explique. */
export function PromotionsPage() {
  const { session } = useSession(); const s = session!;
  const sub = useSubscription(); const plan = sub.data?.entitlement.plan.id; const allowed = planAllows(plan, "promotions"); const pro = planAllows(plan, "promotionsPro"); const manager = (s.role === "owner" || s.role === "manager") && can(s, "stock");
  const lst = usePromoList(allowed && manager); const prods = useProductsAll(allowed);
  const qc = useQueryClient(); const [tab, setTab] = useState<Tab>("list"); const [edit, setEdit] = useState<{ p: PromoView | null; prefill?: Prefill } | null>(null); const [open, setOpen] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["promotions-list"] }).then(() => qc.invalidateQueries({ queryKey: ["promotion-stats"] }));
  if (!allowed) return (
    <div className="flex flex-col gap-3"><h1 className="text-2xl font-bold">Promotions</h1>
      <div className="card flex flex-col gap-2 text-sm"><span className="flex items-center gap-2 font-semibold"><Lock size={16} className="text-[var(--gold)]" />Réservé à la formule Business</span><span className="text-white/60">Remises programmées, codes promotionnels et suivi des résultats.</span><button className="btn !py-2" onClick={() => window.location.assign(`${import.meta.env.BASE_URL}reglages?onglet=abonnement&formule=business`)}>Passer à Business</button></div></div>
  );
  if (!manager) return <div className="flex flex-col gap-3"><h1 className="text-2xl font-bold">Promotions</h1><p className="card text-sm text-white/70">La gestion des promotions est réservée au gérant et au propriétaire. Les promotions actives s'appliquent automatiquement à la caisse.</p></div>;
  const d = lst.data; const openP = d?.promos.find((p) => p.id === open) ?? null;
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">Promotions</h1>
      <nav aria-label="Sections" className="scroll-x">{TABS.map((t) => <button key={t.k} className="chip" aria-current={tab === t.k} onClick={() => setTab(t.k)}>{t.l}{t.pro && !pro ? " 🔒" : ""}</button>)}</nav>
      {lst.isLoading && <p className="text-white/50 text-sm">Chargement…</p>}{lst.error && <p className="text-red-400 text-sm" role="alert">{(lst.error as Error).message}</p>}
      {d && tab === "list" && <CampaignList d={d} pro={pro} onNew={() => setEdit({ p: null })} onOpen={(p) => setOpen(p.id)} products={prods.data ?? []} />}
      {d && tab === "calendar" && <CalendarTab data={d} onOpen={(p) => setOpen(p.id)} />}
      {d && tab === "coupons" && <CouponsTab data={d} pro={pro} />}
      {tab === "budgets" && <AnalyticsTab pro={pro} view="budgets" />}
      {tab === "perf" && <AnalyticsTab pro={pro} view="perf" />}
      {tab === "stores" && <AnalyticsTab pro={pro} view="stores" />}
      {tab === "recos" && <RecosTab pro={pro} onPrepare={(pf) => setEdit({ p: null, prefill: pf })} />}
      {d && tab === "settings" && <SettingsTab data={d} pro={pro} />}
      {d && tab === "journal" && <JournalTab tz={d.tz} />}
      {tab === "results" && <Results />}
      {d && edit && <PromotionForm d={d} pro={pro} initial={edit.p} prefill={edit.prefill} products={prods.data ?? []} onClose={() => setEdit(null)} onSaved={refresh} />}
      {d && openP && <PromotionDetail d={d} p={openP} pro={pro} products={prods.data ?? []} onClose={() => setOpen(null)} onEdit={() => { setEdit({ p: openP }); setOpen(null); }} onChanged={refresh} />}
    </div>
  );
}

function CampaignList({ d, pro, onNew, onOpen, products }: { d: ListData; pro: boolean; onNew: () => void; onOpen: (p: PromoView) => void; products: { $id: string; name: string; category?: string; archived?: boolean }[] }) {
  const [filter, setFilter] = useState<"all" | PromoStatus>("all"); const [fam, setFam] = useState<"" | Family>(""); const [q, setQ] = useState(""); const [art, setArt] = useState(""); const [cat, setCat] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const categories = useMemo(() => [...new Set(products.map((p) => p.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "fr")), [products]);
  const shown = d.promos.filter((p) => (filter === "all" || p.effective === filter) && (!fam || (p.family ?? "simple") === fam) && (!q.trim() || `${p.name} ${p.code ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())) && (!art || p.itemIds.includes(art) || (p.comboRefs ?? []).some((c) => c.productId === art))
    && (!cat || (p.scope === "category" && (p.category ?? "").toLowerCase() === cat.toLowerCase()) || p.itemIds.some((id) => products.find((x) => x.$id === id)?.category === cat)) && (!from || p.endAt.slice(0, 10) >= from) && (!to || p.startAt.slice(0, 10) <= to)).sort((a, b) => b.startAt.localeCompare(a.startAt));
  const frozen = d.promos.filter((p) => p.frozen && p.status !== "ended").length;
  return (
    <>
      <button className="btn flex items-center justify-center gap-2" onClick={onNew}><Plus size={18} />Nouvelle campagne</button>
      {!pro && frozen > 0 && <div className="card border border-amber-400/40 text-sm flex gap-2" role="status"><AlertTriangle size={16} className="text-amber-300 shrink-0 mt-0.5" /><span>{frozen} campagne(s) avancée(s) sont <b>gelées</b> : votre formule n'inclut plus Promotions Pro. Elles sont conservées avec leur historique mais ne s'appliquent plus ; elles reprendront avec la formule Pro. Vous pouvez les suspendre ou les terminer.</span></div>}
      <div className="scroll-x">{([["all", "Toutes"], ["active", "Actives"], ["scheduled", "Programmées"], ["draft", "Brouillons"], ["suspended", "Suspendues"], ["ended", "Terminées"]] as const).map(([k, l]) => <button key={k} className="chip" aria-current={filter === k} onClick={() => setFilter(k)}>{l}</button>)}</div>
      <input aria-label="Rechercher (nom ou code)" className="input" placeholder="Rechercher (nom ou code)" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <select className="input !px-2" aria-label="Filtrer par type" value={fam} onChange={(e) => setFam(e.target.value as Family | "")}><option value="">Tous les types</option>{FAMILIES.map((f) => <option key={f.id} value={f.id}>{FAMILY_LABEL[f.id]}</option>)}</select>
        <select className="input !px-2" aria-label="Filtrer par article" value={art} onChange={(e) => setArt(e.target.value)}><option value="">Tous les articles</option>{products.filter((p) => !p.archived).map((p) => <option key={p.$id} value={p.$id}>{p.name}</option>)}</select>
        <select className="input !px-2" aria-label="Filtrer par catégorie" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Toutes catégories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <span />
        <label className="text-xs text-white/60">Période du<input className="input mt-1" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label className="text-xs text-white/60">au<input className="input mt-1" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {!shown.length && <p className="text-center text-white/50 text-sm py-6">{d.promos.length ? "Aucune campagne ne correspond aux filtres." : "Aucune campagne. Créez la première : aucune n'est ajoutée automatiquement."}</p>}
      <ul className="flex flex-col gap-2">{shown.map((p) => (
        <li key={p.id}><button className="card w-full text-left flex flex-col gap-1" onClick={() => onOpen(p)}>
          <div className="flex justify-between gap-2"><b className="truncate flex items-center gap-1"><Tag size={14} className="text-[var(--gold)] shrink-0" />{p.name}</b><span className={`text-xs rounded-full px-2 py-0.5 shrink-0 ${p.frozen ? "bg-amber-500/20 text-amber-300" : TONE[p.effective]}`}>{p.frozen && p.effective === "active" ? "Gelée" : STATUS_LABEL[p.effective]}</span></div>
          <div className="text-sm gold-text font-bold">{p.describe}{p.code ? <span className="ml-2 text-xs text-white/60 font-normal">code {p.code}</span> : null}</div>
          <div className="text-xs text-white/50">{FAMILY_LABEL[p.family ?? "simple"]} · {fmtDate(p.startAt, d.tz)} → {fmtDate(p.endAt, d.tz)} · {p.uses} utilisation{p.uses > 1 ? "s" : ""}{p.usageLimit ? ` / ${p.usageLimit}` : ""}{p.foreign ? " · autre magasin" : ""}{p.requiresCoupon ? " · coupon" : ""}{p.stackable ? " · cumulable" : ""}</div>
        </button></li>))}</ul>
    </>
  );
}

type TierF = { minQty: string; kind: PromoKind; value: string };
const num = (v: string) => (v.trim() === "" ? undefined : v.trim());

function PromotionForm({ d, pro, initial, prefill, products, onClose, onSaved }: { d: ListData; pro: boolean; initial: PromoView | null; prefill?: Prefill; products: { $id: string; name: string; price: number; category?: string; archived?: boolean; kind?: string }[]; onClose: () => void; onSaved: () => void }) {
  const { session } = useSession(); const s = session!; const tz = d.tz; const used = (initial?.usageCount ?? 0) > 0 || (initial?.uses ?? 0) > 0; const c0 = initial?.customerRules;
  const [f, setF] = useState({
    name: initial?.name ?? prefill?.name ?? "", description: initial?.description ?? "", objective: initial?.objective ?? "", code: initial?.code ?? "", family: (initial?.family ?? (prefill?.family as Family | undefined) ?? "simple") as Family, kind: (initial?.kind ?? "percent") as PromoKind, scope: initial?.scope ?? "items", value: initial && !["bogo", "tiers"].includes(initial.family ?? "") ? String(initial.value) : "", category: initial?.category ?? "",
    startAt: utcToZoned(initial?.startAt ?? new Date().toISOString(), tz), endAt: utcToZoned(initial?.endAt ?? new Date(Date.now() + 7 * 864e5).toISOString(), tz), minQty: initial?.minQty ? String(initial.minQty) : "", minCart: initial?.minCart ? String(initial.minCart) : "", usageLimit: initial?.usageLimit ? String(initial.usageLimit) : "", perCustomerLimit: initial?.perCustomerLimit ? String(initial.perCustomerLimit) : "", priority: String(initial?.priority ?? 0), allowBelowMargin: initial?.allowBelowMargin === true,
    stackable: initial?.stackable === true, requiresCoupon: initial?.requiresCoupon === true, budget: initial?.budget ? String(initial.budget) : "", maxLinePct: initial?.maxLinePct ? String(initial.maxLinePct) : "", maxCartDiscount: initial?.maxCartDiscount ? String(initial.maxCartDiscount) : "", minMarginPct: initial?.minMarginPct !== undefined ? String(initial.minMarginPct) : "", storeScope: (initial?.storeScope ?? "this") as StoreScope, tierBasis: initial?.tierBasis ?? "line",
    bogoBuy: String(initial?.bogo?.buy ?? 2), bogoGet: String(initial?.bogo?.get ?? 1), bogoPct: String(initial?.bogo?.pct ?? 100), comboPrice: initial?.family === "combo" ? String(initial.value) : "", newDays: c0?.newDays ? String(c0.newDays) : "",
  });
  const [tiers, setTiers] = useState<TierF[]>((initial?.tiers ?? [{ minQty: 3, kind: "percent", value: 10 }]).map((t) => ({ minQty: String(t.minQty), kind: t.kind, value: String(t.value) })));
  const [ids, setIds] = useState<{ productId: string; qty?: number }[]>((initial?.itemIds ?? prefill?.productIds ?? []).map((productId) => ({ productId })));
  const [excl, setExcl] = useState<{ productId: string; qty?: number }[]>((initial?.excludeIds ?? []).map((productId) => ({ productId })));
  const [req, setReq] = useState<{ productId: string; qty?: number }[]>(initial?.requireRefs ?? []);
  const [combo, setCombo] = useState<{ productId: string; qty?: number }[]>(initial?.comboRefs ?? (prefill?.comboProductIds ?? []).map((productId) => ({ productId, qty: 1 })));
  const [shopIds, setShopIds] = useState<string[]>(initial?.shopIds ?? []); const [cats, setCats] = useState<string[]>(c0?.categories ?? []); const [loy, setLoy] = useState<string[]>(c0?.loyalty ?? []); const [custIds, setCustIds] = useState<string[]>(c0?.customerIds ?? []);
  const custs = useQuery({ queryKey: ["customers-all", s.shopId], enabled: pro, queryFn: () => listAll<{ name: string }>("customers", s) });
  const [err, setErr] = useState(""); const requestId = useMemo(() => crypto.randomUUID(), []);
  const targeted = f.family === "simple" || f.family === "tiers" || f.family === "bogo";
  const save = useMutation({
    mutationFn: () => api(s, "promotion.save", {
      ...(initial ? { id: initial.id } : { requestId }),
      productIds: (targeted && f.scope === "items") || (f.family === "requires" && f.scope === "items") ? ids.map((x) => x.productId) : [], excludeIds: excl.map((x) => x.productId), requireItems: f.family === "requires" ? req : [], comboItems: f.family === "combo" ? combo : [], shopIds: f.storeScope === "some" ? shopIds : [],
      data: { name: f.name, description: f.description, objective: f.objective, code: f.code, family: f.family, kind: f.kind, scope: targeted || f.family === "requires" ? f.scope : "items", value: f.value.trim(), category: targeted || f.family === "requires" ? (f.scope === "category" ? f.category : "") : "", startAt: zonedToUtc(f.startAt, tz), endAt: zonedToUtc(f.endAt, tz),
        minQty: num(f.minQty), minCart: num(f.minCart), usageLimit: num(f.usageLimit), perCustomerLimit: num(f.perCustomerLimit), priority: f.priority, allowBelowMargin: f.allowBelowMargin,
        stackable: f.stackable, requiresCoupon: f.requiresCoupon, budget: num(f.budget), maxLinePct: num(f.maxLinePct), maxCartDiscount: num(f.maxCartDiscount), minMarginPct: num(f.minMarginPct), storeScope: f.storeScope, tierBasis: f.tierBasis,
        tiers: f.family === "tiers" ? tiers.map((t) => ({ minQty: t.minQty, kind: t.kind, value: t.value })) : [], bogoBuy: f.bogoBuy, bogoGet: f.bogoGet, bogoPct: f.bogoPct, comboPrice: f.comboPrice,
        customerRules: { categories: cats, customerIds: custIds, loyalty: loy, ...(num(f.newDays) ? { newDays: f.newDays } : {}) } },
    }),
    onSuccess: () => { onSaved(); onClose(); }, onError: (e) => setErr((e as Error).message),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const lbl = (t: string, c: React.ReactNode) => <label className="flex flex-col gap-1 text-sm"><span className="text-white/60">{t}</span>{c}</label>;
  const tog = (arr: string[], set: (v: string[]) => void, v: string) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const locked = used; const fam = FAMILIES.find((x) => x.id === f.family)!;
  const needsItems = targeted && f.scope === "items"; const needVal = f.family === "simple" || f.family === "requires" || f.family === "cart";
  const valid = f.name.trim().length >= 2 && f.startAt && f.endAt && (!needVal || f.value.trim() !== "") && (!needsItems || ids.length > 0) && (!(targeted || f.family === "requires") || f.scope !== "category" || f.category) && (f.family !== "combo" || (combo.length > 0 && f.comboPrice.trim() !== "")) && (f.family !== "requires" || req.length > 0) && (f.family !== "cart" || f.minCart.trim() !== "") && (f.family !== "tiers" || tiers.every((t) => t.minQty && t.value)) && (f.storeScope !== "some" || shopIds.length > 0);
  return (
    <Sheet title={initial ? "Modifier la campagne" : "Nouvelle campagne"} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); setErr(""); save.mutate(); }}>
        {initial?.frozen && <p className="text-xs text-amber-300">Cette campagne avancée est gelée (formule sans Promotions Pro) : elle ne peut pas être modifiée sans la formule Pro.</p>}
        {locked && <p className="text-xs text-amber-300">Cette campagne a déjà été utilisée : son type, sa valeur, sa portée, son code, ses articles, ses paliers et ses lots ne changent plus (l'historique reste fidèle). Vous pouvez ajuster le nom, la période, les limites, le budget et le ciblage.</p>}
        {lbl("Nom de la campagne *", <input className="input" required minLength={2} maxLength={120} value={f.name} onChange={set("name")} />)}
        {lbl("Objectif commercial", <input aria-label="Ex. écouler le stock de saison" className="input" maxLength={200} placeholder="Ex. écouler le stock de saison" value={f.objective} onChange={set("objective")} />)}
        {lbl("Description", <textarea className="input" rows={2} maxLength={500} value={f.description} onChange={set("description")} />)}
        {lbl("Code de campagne", <input aria-label="Ex. RENTREE26 (généré si vide)" className="input" maxLength={20} autoCapitalize="characters" disabled={locked} placeholder="Ex. RENTREE26 (généré si vide)" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />)}
        <p className="text-xs text-white/50 -mt-2">Identifiant de la campagne : elle s'applique automatiquement à la caisse (sauf si un coupon est exigé).</p>
        {lbl("Type de promotion *", <select className="input" disabled={locked} value={f.family} onChange={(e) => setF({ ...f, family: e.target.value as Family, ...(e.target.value === "combo" ? { kind: "price" as PromoKind } : f.kind === "price" && e.target.value !== "simple" ? { kind: "percent" as PromoKind } : {}) })}>{FAMILIES.map((x) => <option key={x.id} value={x.id} disabled={x.pro && !pro}>{FAMILY_LABEL[x.id]}{x.pro && !pro ? " — Pro" : ""}</option>)}</select>)}
        <p className="text-xs text-white/50 -mt-2">{fam.help}</p>
        {needVal && <>
          {lbl("Type de remise *", <select className="input" disabled={locked} value={f.kind} onChange={set("kind")}>{PROMO_KINDS.filter((k) => !(f.family === "cart" && k.id === "price")).map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select>)}
          {lbl(f.kind === "percent" ? "Pourcentage (1 à 100) *" : f.kind === "amount" ? (f.family === "cart" ? "Montant de la remise (FCFA, sur le panier) *" : "Montant de la remise (FCFA, par unité) *") : "Prix promotionnel (FCFA, par unité) *", <input className="input" inputMode="numeric" required disabled={locked} value={f.value} onChange={set("value")} />)}
        </>}
        {f.family === "tiers" && <div className="card flex flex-col gap-2"><b className="text-sm">Paliers de quantité *</b>
          {tiers.map((t, i) => <div key={i} className="grid grid-cols-[1fr_1.4fr_1fr_auto] gap-1 items-end"><input className="input !px-2" aria-label={`Quantité palier ${i + 1}`} placeholder="dès qté" inputMode="decimal" disabled={locked} value={t.minQty} onChange={(e) => setTiers(tiers.map((x, k) => (k === i ? { ...x, minQty: e.target.value } : x)))} />
            <select className="input !px-1" aria-label={`Type palier ${i + 1}`} disabled={locked} value={t.kind} onChange={(e) => setTiers(tiers.map((x, k) => (k === i ? { ...x, kind: e.target.value as PromoKind } : x)))}>{PROMO_KINDS.map((k) => <option key={k.id} value={k.id}>{k.id === "percent" ? "%" : k.id === "amount" ? "FCFA/unité" : "Prix"}</option>)}</select>
            <input className="input !px-2" aria-label={`Valeur palier ${i + 1}`} inputMode="numeric" disabled={locked} value={t.value} onChange={(e) => setTiers(tiers.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)))} />
            <button type="button" className="btn-ghost !px-2" aria-label={`Retirer palier ${i + 1}`} disabled={locked || tiers.length < 2} onClick={() => setTiers(tiers.filter((_, k) => k !== i))}>✕</button></div>)}
          <button type="button" className="btn-ghost !py-1 text-sm self-start" disabled={locked || tiers.length >= 10} onClick={() => setTiers([...tiers, { minQty: "", kind: "percent", value: "" }])}>+ Ajouter un palier</button>
          {lbl("Quantité comptée", <select className="input" disabled={locked} value={f.tierBasis} onChange={set("tierBasis")}><option value="line">Par article (chaque ligne)</option><option value="cumulative">Cumulée sur tous les articles de la campagne</option></select>)}</div>}
        {f.family === "bogo" && <div className="card grid grid-cols-3 gap-2">{lbl("Achetés (X)", <input className="input" inputMode="numeric" disabled={locked} value={f.bogoBuy} onChange={set("bogoBuy")} />)}{lbl("Offerts (Y)", <input className="input" inputMode="numeric" disabled={locked} value={f.bogoGet} onChange={set("bogoGet")} />)}{lbl("Remise sur Y (%)", <input className="input" inputMode="numeric" disabled={locked} value={f.bogoPct} onChange={set("bogoPct")} />)}<p className="col-span-3 text-xs text-white/50">Les Y articles les moins chers de chaque lot de X+Y sont remisés (100 % = gratuits). Un lot gratuit exige l'autorisation « sous la marge » ci-dessous.</p></div>}
        {f.family === "combo" && <>{lbl("Prix de l'ensemble (FCFA) *", <input className="input" inputMode="numeric" disabled={locked} value={f.comboPrice} onChange={set("comboPrice")} />)}<ItemPicker title="Articles du pack *" products={products} value={combo} onChange={setCombo} qty disabled={locked} max={10} /><p className="text-xs text-white/50 -mt-1">Le pack ne s'applique que si tous les articles sont dans le panier, dans les quantités indiquées (autant de packs que possible).</p></>}
        {f.family === "requires" && <ItemPicker title="Articles requis dans le panier *" products={products} value={req} onChange={setReq} qty disabled={locked} max={10} />}
        {(targeted || f.family === "requires") && <>
          {lbl(f.family === "requires" ? "Articles remisés" : "La campagne regroupe *", <select className="input" disabled={locked} value={f.scope} onChange={set("scope")}>{PROMO_SCOPES.filter((x) => !(f.kind === "price" && x.id !== "items")).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>)}
          {f.scope === "category" && lbl("Catégorie *", <select className="input" disabled={locked} value={f.category} onChange={set("category")}><option value="">Choisir…</option>{[...new Set(products.map((p) => p.category).filter((c): c is string => !!c))].map((c) => <option key={c} value={c}>{c}</option>)}</select>)}
          {f.scope === "items" && <ItemPicker title={f.family === "requires" ? "Articles remisés (vide = les articles requis)" : "Articles concernés *"} products={products} value={ids} onChange={setIds} disabled={locked} />}
        </>}
        <div className="grid grid-cols-1 gap-2">{lbl(`Début * (heure ${tz})`, <input className="input" type="datetime-local" required value={f.startAt} onChange={set("startAt")} />)}{lbl(`Fin * (heure ${tz})`, <input className="input" type="datetime-local" required value={f.endAt} onChange={set("endAt")} />)}</div>
        <h3 className="font-semibold text-sm pt-1">Conditions et limites (facultatives)</h3>
        <div className="grid grid-cols-2 gap-2">
          {f.family !== "tiers" && lbl("Quantité minimale", <input className="input" inputMode="decimal" value={f.minQty} onChange={set("minQty")} />)}{lbl(f.family === "cart" ? "Panier minimal (FCFA) *" : "Panier minimal (FCFA)", <input className="input" inputMode="numeric" value={f.minCart} onChange={set("minCart")} />)}
          {lbl("Utilisations maximales", <input className="input" inputMode="numeric" value={f.usageLimit} onChange={set("usageLimit")} />)}{lbl("Maximum par client", <input className="input" inputMode="numeric" value={f.perCustomerLimit} onChange={set("perCustomerLimit")} />)}
        </div>
        {lbl("Priorité (0 à 100)", <input className="input" inputMode="numeric" value={f.priority} onChange={set("priority")} />)}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={locked} className="mt-1" checked={f.allowBelowMargin} onChange={(e) => setF({ ...f, allowBelowMargin: e.target.checked })} /><span>Autoriser la vente sous la marge minimale <span className="text-xs text-white/50 block">Sinon la campagne est ignorée (ou refusée à la création) si le prix final passe sous le coût de revient + marge. Si le coût est inconnu et qu'une marge est exigée, aucune remise n'est accordée.</span></span></label>
        <section className="card flex flex-col gap-2"><h3 className="font-semibold text-sm flex items-center gap-1">Options avancées {!pro && <span className="text-xs text-[var(--gold)] flex items-center gap-1"><Lock size={12} />Pro</span>}</h3>
          {!pro ? <p className="text-xs text-white/50">Cumul, coupon, budget, plafonds, marge de campagne, magasins et ciblage clients sont inclus dans la formule Pro.</p> : <>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" disabled={f.family === "bogo" || f.family === "combo"} checked={f.stackable} onChange={(e) => setF({ ...f, stackable: e.target.checked })} /><span>Cumulable <span className="text-xs text-white/50 block">Se combine uniquement avec d'autres campagnes cumulables. Jamais avec une non-cumulable. Les lots (X+Y, packs) ne se cumulent pas.</span></span></label>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={f.requiresCoupon} onChange={(e) => setF({ ...f, requiresCoupon: e.target.checked })} /><span>Coupon exigé <span className="text-xs text-white/50 block">Le caissier saisit un coupon valide (créé dans l'onglet Coupons).</span></span></label>
            <div className="grid grid-cols-2 gap-2">{lbl("Budget (FCFA de remises)", <input className="input" inputMode="numeric" value={f.budget} onChange={set("budget")} />)}{lbl("Marge minimale campagne (%)", <input className="input" inputMode="numeric" value={f.minMarginPct} onChange={set("minMarginPct")} />)}{lbl("Plafond par article (%)", <input className="input" inputMode="numeric" value={f.maxLinePct} onChange={set("maxLinePct")} />)}{lbl("Plafond par panier (FCFA)", <input className="input" inputMode="numeric" value={f.maxCartDiscount} onChange={set("maxCartDiscount")} />)}</div>
            <ItemPicker title="Articles exclus" products={products} value={excl} onChange={setExcl} />
            {lbl("Magasins", <select className="input" value={f.storeScope} onChange={set("storeScope")}><option value="this">Ce magasin seulement</option><option value="all">Tous les magasins</option><option value="some">Magasins choisis</option></select>)}
            {f.storeScope !== "this" && <p className="text-xs text-white/50">Les articles des autres magasins sont reconnus par leur référence (SKU) ; chaque magasin garde son stock et ses ventes.</p>}
            {f.storeScope === "some" && <div className="flex flex-wrap gap-2">{d.shops.map((sh) => <label key={sh.id} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={shopIds.includes(sh.id)} onChange={() => tog(shopIds, setShopIds, sh.id)} />{sh.name}</label>)}</div>}
            <b className="text-sm pt-1">Clients ciblés (vide = tous)</b>
            <div className="flex flex-wrap gap-3 text-sm">{CUSTOMER_CATEGORIES.filter((c) => c.id).map((c) => <label key={c.id} className="flex items-center gap-1"><input type="checkbox" checked={cats.includes(c.id)} onChange={() => tog(cats, setCats, c.id)} />{c.label}</label>)}{LOYALTY_TIERS.map((t) => <label key={t} className="flex items-center gap-1"><input type="checkbox" checked={loy.includes(t)} onChange={() => tog(loy, setLoy, t)} />Fidélité {t}</label>)}</div>
            {lbl("Nouveaux clients (inscrits depuis moins de … jours)", <input className="input" inputMode="numeric" value={f.newDays} onChange={set("newDays")} />)}
            <details><summary className="text-sm cursor-pointer text-white/70">Clients précis ({custIds.length})</summary><div className="max-h-36 overflow-y-auto flex flex-col gap-1 pt-1">{(custs.data ?? []).map((c) => <label key={c.$id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={custIds.includes(c.$id)} onChange={() => tog(custIds, setCustIds, c.$id)} />{c.name}</label>)}</div></details>
          </>}
        </section>
        <p className="text-xs text-white/50">Par défaut une seule promotion s'applique par ligne : la plus avantageuse (ou la plus prioritaire selon vos réglages). Jamais cumulée avec un prix de tarification spécial ni une remise manuelle.</p>
        {err && <p className="text-red-400 text-sm" role="alert">{err}</p>}
        <button className="btn" disabled={save.isPending || !valid}>{save.isPending ? "Enregistrement…" : initial ? "Enregistrer" : "Créer (brouillon)"}</button>
      </form>
    </Sheet>
  );
}

function PromotionDetail({ d, p, pro, products, onClose, onEdit, onChanged }: { d: ListData; p: PromoView; pro: boolean; products: { $id: string; name: string }[]; onClose: () => void; onEdit: () => void; onChanged: () => void }) {
  const { session } = useSession(); const s = session!; const tz = d.tz; const st = p.effective; const own = !p.foreign;
  const [ask, setAsk] = useState<null | "enabled" | "suspended" | "ended" | "delete">(null); const [err, setErr] = useState(""); const [lv, setLv] = useState(p.localValue !== undefined ? String(p.localValue) : ""); const [lb, setLb] = useState(p.localBudget !== undefined ? String(p.localBudget) : "");
  const usage = useQuery({ queryKey: ["promotion-usage", p.id], enabled: own, queryFn: () => list<UsageRow>("promotion_usage", s, [Query.equal("promotionId", p.id), Query.orderDesc("usedAt")], 200) });
  const act = useMutation({
    mutationFn: async (a: "enabled" | "suspended" | "ended" | "delete") => (a === "delete" ? api(s, "promotion.delete", { id: p.id }) : api(s, "promotion.status", { id: p.id, to: a })),
    onSuccess: (_r, a) => { setAsk(null); setErr(""); onChanged(); if (a === "delete") onClose(); }, onError: (e) => { setAsk(null); setErr((e as Error).message); },
  });
  const rule = useMutation({ mutationFn: (b: object) => api(s, "promotion.storeRule", { id: p.id, ...b }), onSuccess: () => { setErr(""); onChanged(); }, onError: (e) => setErr((e as Error).message) });
  const rows = usage.data ?? []; const sum = (k: "discount" | "finalAmount") => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const name = (id: string) => products.find((x) => x.$id === id)?.name ?? "Article"; const row = (k: string, v: React.ReactNode) => <div className="flex justify-between gap-3 text-sm py-1.5 border-b border-[var(--line)]"><span className="text-white/50">{k}</span><span className="text-right">{v || "—"}</span></div>;
  const shopName = (id: string) => d.shops.find((x) => x.id === id)?.name ?? id; const cr = p.customerRules;
  return (
    <Sheet title={p.name} onClose={onClose} back>
      <div className="flex items-center gap-2 flex-wrap"><span className={`text-xs rounded-full px-2 py-0.5 ${TONE[st]}`}>{STATUS_LABEL[st]}</span><span className="text-xs text-white/50">{FAMILY_LABEL[p.family ?? "simple"]}</span><b className="gold-text">{p.describe}</b></div>
      {p.frozen && <p className="card border border-amber-400/40 text-sm text-amber-200" role="status">Campagne gelée : la formule actuelle n'inclut pas Promotions Pro. Elle est conservée (historique intact) mais n'est plus appliquée.</p>}
      {p.objective && <p className="text-sm text-white/70">Objectif : {p.objective}</p>}{p.description && <p className="text-sm text-white/70">{p.description}</p>}
      <div className="card">
        {row("Code", p.code)}{row("Période", `${fmtDate(p.startAt, tz)} → ${fmtDate(p.endAt, tz)}`)}
        {row("Concerne", (p.family === "combo" ? p.comboRefs.map((c) => `${c.qty} × ${name(c.productId)}`).join(" + ") : p.family === "cart" ? "Tout le panier" : p.scope === "items" ? p.itemIds.map(name).join(", ") : `Catégorie « ${p.category} »`) as string)}
        {!!p.requireRefs.length && row("Articles requis", p.requireRefs.map((c) => `${c.qty} × ${name(c.productId)}`).join(", "))}{!!p.excludeIds?.length && row("Exclus", p.excludeIds.map(name).join(", "))}
        {row("Quantité minimale", p.minQty ? String(p.minQty) : "")}{row("Panier minimal", p.minCart ? formatFcfa(p.minCart) : "")}{row("Limite d'utilisation", p.usageLimit ? `${p.uses} / ${p.usageLimit}` : `${p.uses} (illimitée)`)}{row("Limite par client", p.perCustomerLimit ? String(p.perCustomerLimit) : "")}{row("Priorité", String(p.priority ?? 0))}{row("Sous la marge minimale", p.allowBelowMargin ? "Autorisée" : "Interdite")}
        {p.advanced && <>{row("Cumulable", p.stackable ? "Oui (avec d'autres cumulables)" : "Non")}{row("Coupon exigé", p.requiresCoupon ? `Oui (${p.couponCount} coupon(s))` : "Non")}{row("Budget", p.budget ? `${formatFcfa(p.budgetUsed)} / ${formatFcfa(p.budget)}` : "")}{row("Marge minimale campagne", p.minMarginPct !== undefined ? `${p.minMarginPct} %` : "")}{row("Plafond par article", p.maxLinePct ? `${p.maxLinePct} %` : "")}{row("Plafond par panier", p.maxCartDiscount ? formatFcfa(p.maxCartDiscount) : "")}
          {row("Magasins", p.storeScope === "all" ? "Tous" : p.storeScope === "some" ? (p.shopIds ?? []).map(shopName).join(", ") : "Ce magasin")}{!!(cr && (cr.categories.length || cr.loyalty.length || cr.customerIds.length || cr.newDays)) && row("Clients ciblés", [...cr.categories.map((c) => CUSTOMER_CATEGORIES.find((x) => x.id === c)?.label ?? c), ...cr.loyalty.map((l) => `fidélité ${l}`), ...(cr.customerIds.length ? [`${cr.customerIds.length} client(s) précis`] : []), ...(cr.newDays ? [`nouveaux (${cr.newDays} j)`] : [])].join(", "))}</>}
      </div>
      {err && <p className="text-red-400 text-sm" role="alert">{err}</p>}
      {own && <div className="flex gap-2 flex-wrap text-sm">
        {p.status === "draft" && <button className="btn" onClick={() => setAsk("enabled")}>Activer</button>}{p.status === "suspended" && <button className="btn" onClick={() => setAsk("enabled")}>Reprendre</button>}
        {p.status === "enabled" && <button className="btn-ghost" onClick={() => setAsk("suspended")}>Suspendre</button>}{(p.status === "enabled" || p.status === "suspended") && <button className="btn-ghost" onClick={() => setAsk("ended")}>Terminer maintenant</button>}
        {p.status !== "ended" && <button className="btn-ghost flex items-center gap-1" onClick={onEdit}><Pencil size={14} />Modifier</button>}{!p.uses && <button className="btn-ghost !text-red-300 flex items-center gap-1" onClick={() => setAsk("delete")}><Trash2 size={14} />Supprimer</button>}
      </div>}
      {pro && (p.storeScope !== "this" || p.foreign) && p.status !== "draft" && <section className="card flex flex-col gap-2"><h3 className="font-semibold text-sm">Autorisation locale — {shopName(s.shopId)}</h3>
        <div className="flex gap-2 flex-wrap"><button className="btn-ghost !py-1 text-sm" onClick={() => rule.mutate({ shopId: s.shopId, enabled: !p.localEnabled, value: p.localValue, budget: p.localBudget })}>{p.localEnabled ? "Suspendre dans ce magasin" : "Réactiver dans ce magasin"}</button></div>
        {p.family !== "tiers" && p.family !== "bogo" && <div className="grid grid-cols-2 gap-2"><label className="text-xs text-white/60">{p.kind === "percent" ? "Pourcentage local" : p.kind === "price" ? "Prix local" : "Montant local"}<input className="input mt-1" inputMode="numeric" value={lv} onChange={(e) => setLv(e.target.value)} /></label><label className="text-xs text-white/60">Budget local (FCFA)<input className="input mt-1" inputMode="numeric" value={lb} onChange={(e) => setLb(e.target.value)} /></label></div>}
        <button className="btn !py-2 text-sm" onClick={() => rule.mutate({ shopId: s.shopId, enabled: p.localEnabled, value: lv || undefined, budget: lb || undefined })}>Enregistrer la règle locale</button><p className="text-xs text-white/40">Remises accordées dans ce magasin : {formatFcfa(p.budgetUsedHere)}. Chaque magasin garde son stock et ses ventes.</p></section>}
      {own && <><h3 className="font-semibold">Historique des utilisations</h3>
        <div className="grid grid-cols-3 gap-2 text-center"><div className="card"><div className="text-xs text-white/50">Utilisations</div><b>{rows.length}</b></div><div className="card"><div className="text-xs text-white/50">Remises</div><b>{formatFcfa(sum("discount"))}</b></div><div className="card"><div className="text-xs text-white/50">CA net</div><b>{formatFcfa(sum("finalAmount"))}</b></div></div>
        <p className="text-xs text-white/40">Le CA net est le montant encaissé sur les lignes en promotion, après remise : ce n'est pas un bénéfice.</p>
        {usage.isLoading ? <p className="text-sm text-white/50">Chargement…</p> : !rows.length ? <p className="text-sm text-white/50">Aucune utilisation pour le moment.</p> : rows.map((r) => <div key={r.$id} className="flex justify-between gap-2 text-sm border-t border-[var(--line)] pt-1"><span>{r.saleNumber ?? "—"}<span className="text-xs text-white/50 block">{r.usedAt ? fmtDate(r.usedAt, tz) : ""}</span></span><span className="text-right">−{formatFcfa(r.discount)}<span className="text-xs text-white/50 block">{formatFcfa(r.finalAmount ?? 0)} encaissé</span></span></div>)}</>}
      {!pro && p.advanced && own && <ProLock what="Pour modifier ou réactiver cette campagne avancée." />}
      {ask === "enabled" && <Confirm text={p.status === "draft" ? `Activer « ${p.name} » ? Elle s'appliquera automatiquement aux ventes dès le ${fmtDate(p.startAt, tz)} (programmée si cette date est future).` : `Reprendre « ${p.name} » ?`} confirmLabel="Confirmer" onNo={() => setAsk(null)} onYes={() => act.mutate("enabled")} />}
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
