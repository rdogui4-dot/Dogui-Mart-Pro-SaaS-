import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Star, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { api } from "@/lib/api";
import { DATABASE_ID, Query, tables } from "@/lib/appwrite";
import type { ArticleRow } from "@/lib/articles";
import { can, useSession } from "@/lib/session";
import { list, type Row, type Supplier, type VariantRow } from "@/lib/data";
import { Confirm, Sheet } from "@/components/ui";
import { formatFcfa } from "@/domain/money";
import { unitLabel } from "@/domain/articles";
import { methodLabel, marginStats, rankOffers, type Offer } from "@/domain/costing";
import { formatQty } from "@/domain/quantity";

export type LinkRow = Row<{ productId: string; variantId?: string; supplierId: string; supplierRef?: string; price: number; leadDays?: number; minQty?: number; feePct?: number; lastPrice?: number; lastPurchaseAt?: string; status?: string }>;
export type CostEventRow = Row<{ productId: string; variantId?: string; supplierId?: string; kind: string; unitCost?: number; landedCost?: number; qty?: number; costBefore?: number; costAfter?: number; method?: string; ref?: string }>;
const q = (table: string, productId: string, limit: number) => tables.listRows({ databaseId: DATABASE_ID, tableId: table, queries: [Query.equal("productId", productId), ...(table === "article_cost_events" ? [Query.orderDesc("$createdAt")] : []), Query.limit(limit)] });
export const useLinks = (productId: string) => useQuery({ queryKey: ["links", productId], queryFn: async () => (await q("article_suppliers", productId, 100)).rows as unknown as LinkRow[] });
export const useCostEvents = (productId: string) => useQuery({ queryKey: ["cost-events", productId], queryFn: async () => (await q("article_cost_events", productId, 50)).rows as unknown as CostEventRow[] });
const dateFr = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "");
const pct = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("fr-FR")} %`);

/** Fournisseurs d'un article (Pro) : conditions d'approvisionnement, comparaison, coût de revient et son évolution. */
export function SuppliersSheet({ a, variants, canManage, method, onClose, onChanged }: { a: ArticleRow; variants: VariantRow[]; canManage: boolean; method: string; onClose: () => void; onChanged: () => void }) {
  const { session } = useSession(); const s = session!;
  const live = variants.filter((v) => !v.archived);
  const [variantId, setVariantId] = useState(a.hasVariants ? live[0]?.$id ?? "" : "");
  const links = useLinks(a.$id); const events = useCostEvents(a.$id);
  const sups = useQuery({ queryKey: ["suppliers-names", s.shopId], enabled: can(s, "purchases"), queryFn: () => list<Supplier>("suppliers", s, [], 500) });
  const name = (id?: string) => sups.data?.find((x) => x.$id === id)?.name ?? (id ? "Fournisseur" : "—");
  const [edit, setEdit] = useState<LinkRow | "new" | null>(null); const [del, setDel] = useState<LinkRow | null>(null); const [err, setErr] = useState("");
  const mine = (links.data ?? []).filter((l) => (l.variantId ?? "") === variantId);
  const ranked = rankOffers(mine.map((l) => ({ ...l, id: l.$id, price: l.price, feePct: l.feePct, leadDays: l.leadDays, minQty: l.minQty, status: l.status })) as (Offer & LinkRow)[]);
  const evs = (events.data ?? []).filter((e) => (e.variantId ?? "") === variantId);
  const cur = a.hasVariants ? live.find((v) => v.$id === variantId) : a; const cost = cur?.cost ?? 0, price = cur?.price ?? 0; const m = marginStats(price, cost);
  const remove = useMutation({ mutationFn: (l: LinkRow) => api(s, "supplier.link.delete", { id: l.$id }), onSuccess: () => { setDel(null); setErr(""); void links.refetch(); onChanged(); }, onError: (e) => { setDel(null); setErr((e as Error).message); } });
  return (
    <Sheet title={`Fournisseurs & coûts · ${a.name}`} onClose={onClose} back>
      {a.hasVariants && (live.length ? <select className="input" aria-label="Variante" value={variantId} onChange={(e) => setVariantId(e.target.value)}>{live.map((v) => <option key={v.$id} value={v.$id}>{v.label}</option>)}</select> : <p className="text-sm text-amber-300">Créez d'abord une variante.</p>)}
      <div className="card flex flex-col gap-1 text-sm">
        <div className="flex justify-between"><span className="text-white/50">Coût de revient (stock)</span><b>{cost ? formatFcfa(cost) : "—"}</b></div>
        <div className="flex justify-between"><span className="text-white/50">Prix de vente</span><b className="gold-text">{formatFcfa(price)}</b></div>
        <div className="flex justify-between"><span className="text-white/50">Marge brute</span><b className={m.amount < 0 ? "text-red-300" : ""}>{cost ? formatFcfa(m.amount) : "—"}</b></div>
        <div className="flex justify-between"><span className="text-white/50">Taux de marge (sur le coût)</span><b>{cost ? pct(m.markupPct) : "—"}</b></div>
        <div className="flex justify-between"><span className="text-white/50">Taux de marque (sur le prix)</span><b>{cost ? pct(m.markPct) : "—"}</b></div>
        <p className="text-xs text-white/40 pt-1">Méthode de valorisation de la boutique : {methodLabel(method)}.</p>
      </div>
      {canManage && (!a.hasVariants || variantId) && <button className="btn flex items-center justify-center gap-2" onClick={() => setEdit("new")}><Plus size={18} />Ajouter un fournisseur</button>}
      {err && <p className="text-red-400 text-sm" role="alert">{err}</p>}
      {links.isLoading && <p className="text-sm text-white/50">Chargement…</p>}
      {links.error && <p className="text-sm text-red-400">{(links.error as Error).message}</p>}
      {!links.isLoading && (!a.hasVariants || variantId) && ranked.length === 0 && <p className="text-center text-white/50 text-sm py-2">Aucun fournisseur associé. Le premier achat réceptionné en créera un automatiquement.</p>}
      {ranked.map((o) => (
        <div key={o.$id} className={`card flex flex-col gap-1 ${o.status === "inactive" ? "opacity-60" : ""} ${o.best ? "border-[var(--gold)]" : ""}`}>
          <div className="flex justify-between items-baseline"><b className="flex items-center gap-1">{o.best && <Star size={14} className="text-[var(--gold)]" />}{name(o.supplierId)}</b><span className="gold-text font-bold">{formatFcfa(o.price)}</span></div>
          <div className="text-xs text-white/50">{[o.supplierRef && `réf. ${o.supplierRef}`, o.feePct ? `frais ${o.feePct} % → ${formatFcfa(o.effective)} effectif` : "", o.leadDays ? `délai ${o.leadDays} j` : "", o.minQty ? `minimum ${formatQty(o.minQty)} ${unitLabel(a.unit).toLowerCase()}` : "", o.lastPrice ? `dernier achat ${formatFcfa(o.lastPrice)}${o.lastPurchaseAt ? ` le ${dateFr(o.lastPurchaseAt)}` : ""}` : ""].filter(Boolean).join(" · ")}</div>
          <div className="text-xs">{o.best ? <span className="text-emerald-300">Meilleure offre (prix effectif, puis délai, puis minimum)</span> : o.status === "inactive" ? <span className="text-amber-300">Inactif</span> : <span className="text-white/40">{o.effective > (ranked[0]?.effective ?? 0) ? `+${formatFcfa(o.effective - (ranked[0]?.effective ?? 0))} par rapport à la meilleure offre` : "Même prix effectif que la meilleure offre"}</span>}</div>
          {canManage && <div className="flex gap-2 pt-1 text-sm"><button className="btn-ghost !py-2 flex items-center gap-1" onClick={() => setEdit(o)}><Pencil size={14} />Modifier</button><button className="btn-ghost !py-2 !text-red-300 flex items-center gap-1" onClick={() => setDel(o)}><Trash2 size={14} />Retirer</button></div>}
        </div>
      ))}
      <div className="card"><h3 className="font-semibold mb-1">Évolution des coûts d'achat</h3>
        {events.isLoading ? <p className="text-sm text-white/50">Chargement…</p> : events.error ? <p className="text-sm text-red-400">{(events.error as Error).message}</p> : evs.length === 0 ? <p className="text-sm text-white/50">Aucune réception enregistrée.</p> :
          <ul className="text-sm flex flex-col gap-2">{evs.map((e, i) => { const prev = evs[i + 1]?.unitCost; const d = prev && e.unitCost ? Math.round(((e.unitCost - prev) / prev) * 1000) / 10 : null; return (
            <li key={e.$id} className="flex justify-between gap-2"><span><span className="text-white/50">{dateFr(e.$createdAt)}</span> · {name(e.supplierId)}<br /><span className="text-xs text-white/40">{e.ref} · {formatQty(e.qty ?? 0)} reçus{e.landedCost !== e.unitCost ? ` · revient à ${formatFcfa(e.landedCost ?? 0)}` : ""} · stock {formatFcfa(e.costBefore ?? 0)} → {formatFcfa(e.costAfter ?? 0)}</span></span>
              <span className="text-right whitespace-nowrap">{formatFcfa(e.unitCost ?? 0)}{d !== null && d !== 0 && <span className={`block text-xs ${d > 0 ? "text-red-300" : "text-emerald-300"}`}>{d > 0 ? <TrendingUp size={12} className="inline" /> : <TrendingDown size={12} className="inline" />} {d > 0 ? "+" : ""}{d} %</span>}</span></li>); })}</ul>}
      </div>
      {del && <Confirm danger text={`Retirer ${name(del.supplierId)} de cet article ? L'historique des achats est conservé.`} confirmLabel="Retirer" onNo={() => setDel(null)} onYes={() => remove.mutate(del)} />}
      {edit && <LinkForm a={a} variantId={variantId} suppliers={sups.data ?? []} taken={mine.map((l) => l.supplierId)} initial={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={() => { void links.refetch(); onChanged(); }} />}
    </Sheet>
  );
}

function LinkForm({ a, variantId, suppliers, taken, initial, onClose, onSaved }: { a: ArticleRow; variantId: string; suppliers: Row<Supplier>[]; taken: string[]; initial: LinkRow | null; onClose: () => void; onSaved: () => void }) {
  const { session } = useSession(); const s = session!; const edit = !!initial;
  const [f, setF] = useState({ supplierId: initial?.supplierId ?? "", supplierRef: initial?.supplierRef ?? "", price: String(initial?.price ?? a.cost ?? ""), leadDays: initial?.leadDays ? String(initial.leadDays) : "", minQty: initial?.minQty ? String(initial.minQty).replace(".", ",") : "", feePct: initial?.feePct ? String(initial.feePct).replace(".", ",") : "", status: initial?.status ?? "active" });
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [done, setDone] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const choices = suppliers.filter((x) => edit ? x.$id === f.supplierId : !taken.includes(x.$id));
  const valid = f.supplierId && /^\d+$/.test(f.price.replace(/\s/g, ""));
  const lbl = (t: string, c: ReactNode) => <label className="flex flex-col gap-1 text-sm"><span className="text-white/60">{t}</span>{c}</label>;
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(""); setDone("");
    try { await api(s, "supplier.link.save", { productId: a.$id, ...(variantId ? { variantId } : {}), supplierId: f.supplierId, supplierRef: f.supplierRef, price: f.price.replace(/\s/g, ""), leadDays: f.leadDays, minQty: f.minQty.replace(",", "."), feePct: f.feePct.replace(",", "."), status: f.status }); onSaved(); setDone("Fournisseur enregistré."); setTimeout(onClose, 600); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <Sheet title={edit ? "Modifier le fournisseur" : "Ajouter un fournisseur"} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {lbl("Fournisseur *", <select className="input" required disabled={edit} value={f.supplierId} onChange={set("supplierId")}><option value="">Choisir…</option>{choices.map((x) => <option key={x.$id} value={x.$id}>{x.name}</option>)}</select>)}
        {!edit && choices.length === 0 && <p className="text-xs text-amber-300">Aucun fournisseur disponible : créez-les dans Achats → Fournisseurs.</p>}
        <div className="grid grid-cols-2 gap-2">{lbl("Prix d'achat (FCFA) *", <input className="input" inputMode="numeric" required value={f.price} onChange={set("price")} />)}{lbl("Référence fournisseur", <input className="input" maxLength={64} value={f.supplierRef} onChange={set("supplierRef")} />)}</div>
        <div className="grid grid-cols-3 gap-2">{lbl("Délai (jours)", <input className="input" inputMode="numeric" value={f.leadDays} onChange={set("leadDays")} />)}{lbl("Minimum", <input className="input" inputMode="decimal" value={f.minQty} onChange={set("minQty")} />)}{lbl("Frais (%)", <input className="input" inputMode="decimal" value={f.feePct} onChange={set("feePct")} />)}</div>
        <p className="text-xs text-white/40">Les frais (%) s'ajoutent au prix d'achat dans le coût de revient à chaque réception chez ce fournisseur.</p>
        {lbl("Statut", <select className="input" value={f.status} onChange={set("status")}><option value="active">Actif</option><option value="inactive">Inactif</option></select>)}
        {err && <p className="text-red-400 text-sm" role="alert">{err}</p>}{done && <p className="text-emerald-400 text-sm" role="status">{done}</p>}
        <button className="btn" disabled={busy || !valid}>{busy ? "Enregistrement…" : "Enregistrer"}</button>
      </form>
    </Sheet>
  );
}

type Profit = { period: { from: string; to: string; days: number }; items: ProfitItem[]; categories: ProfitItem[]; truncated: boolean; itemsTotal: number };
type ProfitItem = { key: string; name: string; qty: number; revenueHt: number; cogs: number; margin: number; marginPct: number | null; markupPct: number | null; costedPct: number };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const RANGES = [["7 jours", 7], ["30 jours", 30], ["90 jours", 90]] as const;

/** Rentabilité par article et par catégorie sur une période (Pro) : chiffre d'affaires hors TVA, coût figé à la vente, marge. */
export function ProfitSheet({ onClose }: { onClose: () => void }) {
  const { session } = useSession(); const s = session!;
  const [days, setDays] = useState<number>(30); const [tab, setTab] = useState<"items" | "categories">("items");
  const data = useQuery({ queryKey: ["profit", s.shopId, days], queryFn: () => { const to = new Date(); const from = new Date(Date.now() - (days - 1) * 86_400_000); return api<Profit>(s, "article.profitability", { from: iso(from), to: iso(to) }); } });
  const rows = tab === "items" ? data.data?.items : data.data?.categories;
  const tot = (data.data?.categories ?? []).reduce((a, c) => ({ rev: a.rev + c.revenueHt, margin: a.margin + c.margin }), { rev: 0, margin: 0 });
  return (
    <Sheet title="Rentabilité" onClose={onClose} back>
      <div className="scroll-x">{RANGES.map(([l, d]) => <button key={d} className="chip" aria-current={days === d} onClick={() => setDays(d)}>{l}</button>)}</div>
      <div className="grid grid-cols-2 gap-2"><div className="kpi"><b>{formatFcfa(tot.rev)}</b><span>CA hors TVA</span></div><div className="kpi"><b className={tot.margin < 0 ? "text-red-300" : ""}>{formatFcfa(tot.margin)}</b><span>Marge brute</span></div></div>
      <div className="scroll-x"><button className="chip" aria-current={tab === "items"} onClick={() => setTab("items")}>Par article</button><button className="chip" aria-current={tab === "categories"} onClick={() => setTab("categories")}>Par catégorie</button></div>
      {data.isLoading && <div className="flex flex-col gap-2" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="card h-16 animate-pulse" />)}</div>}
      {data.error && <div className="card text-sm"><p className="text-red-400">{(data.error as Error).message}</p><button className="btn-ghost mt-2" onClick={() => void data.refetch()}>Réessayer</button></div>}
      {data.data && rows?.length === 0 && <p className="text-center text-white/50 text-sm py-4">Aucune vente sur cette période.</p>}
      {rows?.map((r) => (
        <div key={r.key} className="card flex flex-col gap-1">
          <div className="flex justify-between gap-2"><b className="truncate">{r.name}</b><b className={r.margin < 0 ? "text-red-300" : "gold-text"}>{formatFcfa(r.margin)}</b></div>
          <div className="text-xs text-white/50">{formatQty(r.qty)} vendus · CA {formatFcfa(r.revenueHt)} · coût {formatFcfa(r.cogs)} · marque {pct(r.marginPct)} · marge {pct(r.markupPct)}</div>
          {r.costedPct < 100 && <div className="text-xs text-amber-300">Coût connu pour {r.costedPct} % du CA seulement : marge partielle.</div>}
        </div>
      ))}
      {data.data && data.data.itemsTotal > data.data.items.length && tab === "items" && <p className="text-xs text-white/40 text-center">{data.data.items.length} premiers articles sur {data.data.itemsTotal}.</p>}
      {data.data?.truncated && <p className="text-xs text-amber-300 text-center">Volume très élevé : les ventes les plus anciennes de la période ne sont pas toutes comptées.</p>}
      <p className="text-xs text-white/40">Marge = CA hors TVA − coût figé au moment de chaque vente. Taux de marque = marge / prix ; taux de marge = marge / coût.</p>
    </Sheet>
  );
}
