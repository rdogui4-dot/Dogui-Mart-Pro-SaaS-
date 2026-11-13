import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { DATABASE_ID, Query, tables } from "@/lib/appwrite";
import type { ArticleRow } from "@/lib/articles";
import type { RuleRow, UnitRow, VariantRow } from "@/lib/data";
import { useSession } from "@/lib/session";
import { Confirm, Sheet } from "@/components/ui";
import { formatFcfa } from "@/domain/money";
import { unitLabel } from "@/domain/articles";
import { CUSTOMER_CATEGORIES, KIND_LABEL, RULE_KINDS, categoryLabel, type RuleKind } from "@/domain/pricing";
import { formatQty } from "@/domain/quantity";

export const useRules = (productId: string) => useQuery({
  queryKey: ["rules", productId],
  queryFn: async () => (await tables.listRows({ databaseId: DATABASE_ID, tableId: "article_price_rules", queries: [Query.equal("productId", productId), Query.limit(100)] })).rows as unknown as RuleRow[],
});
const dateFr = (iso?: string) => (iso ? new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
const toLocalInput = (iso?: string) => { if (!iso) return ""; const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
const status = (r: RuleRow, now = Date.now()) => (r.active === false ? "Désactivé" : r.kind !== "promo" ? "" : r.startsAt && Date.parse(r.startsAt) > now ? "À venir" : r.endsAt && Date.parse(r.endsAt) <= now ? "Terminée" : "En cours");

/** Tarifs d'un article (Pro) : promotions, prix par catégorie de clients, prix par quantité. Le prix appliqué à chaque vente est figé dans la ligne de vente. */
export function PricingSheet({ a, variants, units, canManage, onClose, onChanged }: { a: ArticleRow; variants: VariantRow[]; units: UnitRow[]; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const { session } = useSession(); const s = session!;
  const rules = useRules(a.$id);
  const live = variants.filter((v) => !v.archived);
  const [variantId, setVariantId] = useState(a.hasVariants ? live[0]?.$id ?? "" : "");
  const [edit, setEdit] = useState<RuleRow | "new" | null>(null); const [del, setDel] = useState<RuleRow | null>(null); const [err, setErr] = useState("");
  const shown = (rules.data ?? []).filter((r) => (r.variantId ?? "") === variantId).sort((x, y) => x.kind.localeCompare(y.kind) || x.price - y.price);
  const remove = useMutation({ mutationFn: (r: RuleRow) => api(s, "price.rule.delete", { id: r.$id }), onSuccess: () => { setDel(null); setErr(""); void rules.refetch(); onChanged(); }, onError: (e) => { setDel(null); setErr((e as Error).message); } });
  const describe = (r: RuleRow) => [r.unit ? `par ${unitLabel(r.unit).toLowerCase()}` : "", r.minQty ? `dès ${formatQty(r.minQty)}${r.unit ? "" : ` ${unitLabel(a.unit).toLowerCase()}`}` : "", r.customerCategory ? `clients ${categoryLabel(r.customerCategory).toLowerCase()}` : "", r.startsAt ? `du ${dateFr(r.startsAt)} au ${dateFr(r.endsAt)}` : "", r.priority ? `priorité ${r.priority}` : ""].filter(Boolean).join(" · ");
  return (
    <Sheet title={`Tarifs · ${a.name}`} onClose={onClose} back>
      <p className="text-sm text-muted">Prix de base : <b className="text-accent-text">{formatFcfa(a.hasVariants ? (live.find((v) => v.$id === variantId)?.price ?? 0) : a.price)}</b> par {unitLabel(a.unit).toLowerCase()}. Ordre d'application : promotion en cours, puis prix par catégorie de clients, puis prix par quantité, puis prix de base.</p>
      {a.hasVariants && (live.length ? <select className="input" aria-label="Variante" value={variantId} onChange={(e) => setVariantId(e.target.value)}>{live.map((v) => <option key={v.$id} value={v.$id}>{v.label}</option>)}</select> : <p className="text-sm text-warn">Créez d'abord une variante : les tarifs d'un article décliné se définissent par variante.</p>)}
      {canManage && (!a.hasVariants || variantId) && <button className="btn flex items-center justify-center gap-2" onClick={() => setEdit("new")}><Plus size={18} />Ajouter un tarif</button>}
      {err && <p className="text-bad text-sm" role="alert">{err}</p>}
      {rules.isLoading && <p className="text-muted text-sm">Chargement…</p>}
      {rules.error && <p className="text-bad text-sm">{(rules.error as Error).message}</p>}
      {!rules.isLoading && (!a.hasVariants || variantId) && shown.length === 0 && <p className="text-center text-muted text-sm py-3">Aucun tarif spécial : le prix de base s'applique.</p>}
      {shown.map((r) => (
        <div key={r.$id} className={`card flex flex-col gap-1 ${r.active === false ? "opacity-60" : ""}`}>
          <div className="flex justify-between items-baseline"><b>{r.label || KIND_LABEL[r.kind as RuleKind]}</b><span className="text-accent-text font-bold">{formatFcfa(r.price)}</span></div>
          <div className="text-xs text-muted">{KIND_LABEL[r.kind as RuleKind]}{describe(r) ? ` · ${describe(r)}` : ""}</div>
          {status(r) && <span className={`text-xs ${status(r) === "En cours" ? "text-ok" : "text-warn"}`}>{status(r)}</span>}
          {canManage && <div className="flex gap-2 pt-1 text-sm"><button className="btn-ghost !py-2 flex items-center gap-1" onClick={() => setEdit(r)}><Pencil size={14} />Modifier</button><button className="btn-ghost !py-2 !text-bad flex items-center gap-1" onClick={() => setDel(r)}><Trash2 size={14} />Supprimer</button></div>}
        </div>
      ))}
      {del && <Confirm danger text={`Supprimer ce tarif (${formatFcfa(del.price)}) ? Les ventes déjà faites gardent leur prix.`} confirmLabel="Supprimer" onNo={() => setDel(null)} onYes={() => remove.mutate(del)} />}
      {edit && <RuleForm a={a} variantId={variantId} units={units} initial={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={() => { void rules.refetch(); onChanged(); }} />}
    </Sheet>
  );
}

function RuleForm({ a, variantId, units, initial, onClose, onSaved }: { a: ArticleRow; variantId: string; units: UnitRow[]; initial: RuleRow | null; onClose: () => void; onSaved: () => void }) {
  const { session } = useSession(); const s = session!; const edit = !!initial; const requestId = useRef(crypto.randomUUID());
  const [f, setF] = useState({ kind: (initial?.kind ?? "quantity") as RuleKind, price: String(initial?.price ?? ""), unit: initial?.unit ?? "", minQty: initial?.minQty ? String(initial.minQty).replace(".", ",") : "", customerCategory: initial?.customerCategory ?? "", startsAt: toLocalInput(initial?.startsAt), endsAt: toLocalInput(initial?.endsAt), priority: String(initial?.priority ?? 0), label: initial?.label ?? "", active: initial?.active !== false });
  const [err, setErr] = useState(""); const [warn, setWarn] = useState(""); const [busy, setBusy] = useState(false); const [done, setDone] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });
  const needQty = f.kind === "quantity", needCat = f.kind === "category", promo = f.kind === "promo";
  const valid = /^\d+$/.test(f.price.replace(/\s/g, "")) && (!needQty || f.minQty.trim()) && (!needCat || f.customerCategory) && (!promo || (f.startsAt && f.endsAt));
  const lbl = (t: string, c: ReactNode) => <label className="flex flex-col gap-1 text-sm"><span className="text-muted">{t}</span>{c}</label>;
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(""); setDone(""); setWarn("");
    try {
      const body = { productId: a.$id, ...(variantId ? { variantId } : {}), kind: f.kind, price: f.price.replace(/\s/g, ""), unit: f.unit, minQty: f.minQty.replace(",", "."), customerCategory: f.customerCategory,
        ...(promo ? { startsAt: f.startsAt ? new Date(f.startsAt).toISOString() : "", endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : "" } : {}), priority: f.priority, label: f.label, active: f.active };
      const r = await api<{ belowCost?: boolean }>(s, "price.rule.save", edit ? { ...body, id: initial!.$id } : { ...body, requestId: requestId.current });
      onSaved(); setDone("Tarif enregistré."); if (r.belowCost) setWarn("Attention : ce prix est inférieur au prix d'achat.");
      setTimeout(onClose, r.belowCost ? 1800 : 700);
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <Sheet title={edit ? "Modifier le tarif" : "Nouveau tarif"} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {lbl("Type de tarif", <select className="input" value={f.kind} onChange={set("kind")}>{RULE_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>)}
        <div className="grid grid-cols-2 gap-2">
          {lbl("Prix (FCFA) *", <input className="input" inputMode="numeric" required value={f.price} onChange={set("price")} />)}
          {lbl("Vendu par", <select className="input" value={f.unit} onChange={set("unit")}><option value="">{unitLabel(a.unit)} (base)</option>{units.filter((u) => u.active !== false).map((u) => <option key={u.$id} value={u.unit}>{unitLabel(u.unit)}</option>)}</select>)}
        </div>
        {lbl(`Quantité minimale${needQty ? " *" : " (facultatif)"}`, <input aria-label="ex. 10" className="input" inputMode="decimal" value={f.minQty} onChange={set("minQty")} placeholder="ex. 10" />)}
        {lbl(`Catégorie de clients${needCat ? " *" : ""}`, <select className="input" value={f.customerCategory} onChange={set("customerCategory")}><option value="">Tous les clients</option>{CUSTOMER_CATEGORIES.filter((c) => c.id).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>)}
        {promo && <div className="grid grid-cols-1 gap-2">{lbl("Début *", <input className="input" type="datetime-local" required value={f.startsAt} onChange={set("startsAt")} />)}{lbl("Fin *", <input className="input" type="datetime-local" required value={f.endsAt} onChange={set("endsAt")} />)}</div>}
        <div className="grid grid-cols-2 gap-2">{lbl("Priorité (-100 à 100)", <input className="input" inputMode="numeric" value={f.priority} onChange={set("priority")} />)}{lbl("Libellé (facultatif)", <input className="input" maxLength={60} value={f.label} onChange={set("label")} />)}</div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={set("active")} />Tarif actif</label>
        {err && <p className="text-bad text-sm" role="alert">{err}</p>}{done && <p className="text-ok text-sm" role="status">{done}</p>}
        {warn && <p className="text-warn text-sm flex gap-1"><AlertTriangle size={16} />{warn}</p>}
        <button className="btn" disabled={busy || !valid}>{busy ? "Enregistrement…" : "Enregistrer"}</button>
      </form>
    </Sheet>
  );
}
