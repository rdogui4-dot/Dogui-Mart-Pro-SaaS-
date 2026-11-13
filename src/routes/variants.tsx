import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Archive, Camera, Image as ImageIcon, Pencil, Plus, ScanLine, Trash2, Undo2, X } from "lucide-react";
import { api } from "@/lib/api";
import { compressImage, useArticleImage, type ArticleRow } from "@/lib/articles";
import { variantQty, type VariantRow } from "@/lib/data";
import { useSession } from "@/lib/session";
import { Scanner } from "@/components/Scanner";
import { Confirm, Sheet, Thumb } from "@/components/ui";
import { formatFcfa } from "@/domain/money";
import { marginOf, sellsAtLoss, unitLabel } from "@/domain/articles";
import { formatQty, scaleOf } from "@/domain/quantity";
import { isLow } from "@/domain/stock";
import { ATTRIBUTE_SUGGESTIONS, MAX_ATTRIBUTES, parseAttributes, type Attribute } from "@/domain/variants";

/** Gestion des variantes d'un article (Pro) : liste, création, modification, inventaire par variante, archivage, suppression. */
export function VariantsSheet({ a, variants, levels, canManage, onClose, onChanged }: { a: ArticleRow; variants: VariantRow[]; levels?: Map<string, number>; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const { session } = useSession(); const s = session!; const scale = scaleOf(a);
  const [edit, setEdit] = useState<VariantRow | "new" | null>(null);
  const [ask, setAsk] = useState<null | { kind: "archive" | "restore" | "delete" | "count"; v: VariantRow }>(null); const [counted, setCounted] = useState(""); const [err, setErr] = useState("");
  const act = useMutation({
    mutationFn: async ({ kind, v }: { kind: "archive" | "restore" | "delete" | "count"; v: VariantRow }) => {
      if (kind === "delete") return api(s, "variant.delete", { id: v.$id });
      if (kind === "count") return api(s, "stock.adjust", { productId: a.$id, variantId: v.$id, counted });
      return api(s, "variant.archive", { id: v.$id, archived: kind === "archive" });
    },
    onSuccess: () => { setAsk(null); setErr(""); onChanged(); },
    onError: (e) => { setAsk(null); setErr((e as Error).message); },
  });
  const canDelete = s.role === "owner" || s.role === "manager";
  return (
    <Sheet title={`Variantes · ${a.name}`} onClose={onClose} back>
      <p className="text-sm text-muted">Chaque variante a son SKU, ses prix, son stock et son seuil d'alerte. Unité : <b>{unitLabel(a.unit)}</b>.</p>
      {canManage && <button className="btn flex items-center justify-center gap-2" onClick={() => setEdit("new")}><Plus size={18} />Ajouter une variante</button>}
      {err && <p className="text-bad text-sm" role="alert">{err}</p>}
      {variants.length === 0 && <p className="text-center text-muted text-sm py-4">Aucune variante.</p>}
      {variants.map((v) => {
        const n = variantQty(levels, v, scale); const low = isLow(n, v.minStock ?? 0);
        return (
          <div key={v.$id} className={`card flex flex-col gap-2 ${v.archived ? "opacity-60" : ""}`}>
            <div className="flex gap-3 items-center">
              <Thumb id={v.imageFileId} size={52} />
              <div className="flex-1 min-w-0"><div className="font-semibold truncate">{v.label}</div><div className="text-xs text-muted truncate">{parseAttributes(v.attributes).map((x) => `${x.name} : ${x.value}`).join(" · ")}{v.sku ? ` · ${v.sku}` : ""}</div></div>
              <div className="text-right"><div className="text-accent-text font-bold">{formatFcfa(v.price)}</div><div className={`text-xs ${low ? "text-bad" : "text-muted"}`}>{formatQty(n)} en stock</div></div>
            </div>
            {v.archived && <span className="text-xs text-warn">Archivée</span>}
            {sellsAtLoss(v.price, v.cost ?? 0) && <p className="text-xs text-warn flex gap-1"><AlertTriangle size={14} />Vente à perte (prix de vente inférieur au prix d'achat).</p>}
            {canManage && (
              <div className="flex gap-2 flex-wrap text-sm">
                <button className="btn-ghost !py-2 flex items-center gap-1" onClick={() => setEdit(v)}><Pencil size={14} />Modifier</button>
                <button className="btn-ghost !py-2" onClick={() => { setCounted(String(n).replace(".", ",")); setAsk({ kind: "count", v }); }}>Compter</button>
                {v.archived ? <button className="btn-ghost !py-2 flex items-center gap-1" onClick={() => setAsk({ kind: "restore", v })}><Undo2 size={14} />Restaurer</button> : <button className="btn-ghost !py-2 flex items-center gap-1" onClick={() => setAsk({ kind: "archive", v })}><Archive size={14} />Archiver</button>}
                {canDelete && <button className="btn-ghost !py-2 !text-bad flex items-center gap-1" onClick={() => setAsk({ kind: "delete", v })}><Trash2 size={14} />Supprimer</button>}
              </div>
            )}
          </div>
        );
      })}
      {ask?.kind === "archive" && <Confirm text={`Archiver la variante « ${ask.v.label} » ? Elle ne sera plus proposée à la vente ; son historique est conservé.`} confirmLabel="Archiver" onNo={() => setAsk(null)} onYes={() => act.mutate(ask)} />}
      {ask?.kind === "restore" && <Confirm text={`Restaurer la variante « ${ask.v.label} » ?`} confirmLabel="Restaurer" onNo={() => setAsk(null)} onYes={() => act.mutate(ask)} />}
      {ask?.kind === "delete" && <Confirm danger text={`Supprimer définitivement « ${ask.v.label} » ? Possible seulement si elle n'a jamais été vendue, commandée ni transférée.`} confirmLabel="Supprimer" onNo={() => setAsk(null)} onYes={() => act.mutate(ask)} />}
      {ask?.kind === "count" && (
        <div className="fixed inset-0 z-50 bg-[var(--overlay)] flex items-end justify-center p-4"><div className="card w-full max-w-sm flex flex-col gap-3">
          <p>Inventaire de « {a.name} — {ask.v.label} » : quantité réellement comptée ?</p>
          <input className="input" inputMode="decimal" autoFocus value={counted} onChange={(e) => setCounted(e.target.value)} />
          <p className="text-xs text-muted">L'écart sera tracé comme mouvement d'inventaire de cette variante.</p>
          <div className="flex gap-2"><button className="btn-ghost flex-1" onClick={() => setAsk(null)}>Annuler</button><button className="btn flex-1" disabled={act.isPending || !/^\d+([.,]\d{1,3})?$/.test(counted)} onClick={() => act.mutate(ask)}>Valider</button></div></div></div>
      )}
      {edit && <VariantForm a={a} initial={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={onChanged} />}
    </Sheet>
  );
}

function VariantForm({ a, initial, onClose, onSaved }: { a: ArticleRow; initial: VariantRow | null; onClose: () => void; onSaved: () => void }) {
  const { session } = useSession(); const s = session!; const edit = !!initial; const requestId = useRef(crypto.randomUUID());
  const [attrs, setAttrs] = useState<Attribute[]>(initial ? parseAttributes(initial.attributes) : [{ name: "Taille", value: "" }]);
  const [f, setF] = useState({ sku: initial?.sku ?? "", barcode: initial?.barcode ?? "", price: String(initial?.price ?? a.price), cost: String(initial?.cost ?? a.cost ?? ""), minStock: String(initial?.minStock ?? a.minStock ?? 0), qty: "" });
  const [photo, setPhoto] = useState<File | null>(null); const [removePhoto, setRemovePhoto] = useState(false); const [preview, setPreview] = useState<string | null>(null);
  const [scan, setScan] = useState(false); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [done, setDone] = useState("");
  const existing = useArticleImage(initial?.imageFileId, 400);
  useEffect(() => { if (!photo) { setPreview(null); return; } const u = URL.createObjectURL(photo); setPreview(u); return () => URL.revokeObjectURL(u); }, [photo]);
  const scale = scaleOf(a);
  const int = (v: string) => v === "" || /^\d+$/.test(v.replace(/\s/g, ""));
  const dec = (v: string) => v === "" || (/^\d+([.,]\d{1,3})?$/.test(v.trim()) && (v.split(/[.,]/)[1] ?? "").length <= scale);
  const price = Number(f.price) || 0, cost = Number(f.cost) || 0; const m = marginOf(price, cost);
  const valid = attrs.length > 0 && attrs.every((x) => x.name.trim() && x.value.trim()) && f.price !== "" && int(f.price) && int(f.cost) && int(f.minStock) && (edit || dec(f.qty));
  const setAttr = (i: number, p: Partial<Attribute>) => setAttrs((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const lbl = (t: string, c: ReactNode) => <label className="flex flex-col gap-1 text-sm"><span className="text-muted">{t}</span>{c}</label>;

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(""); setDone("");
    let id = initial?.$id ?? "";
    try {
      const body = { productId: a.$id, attributes: attrs, sku: f.sku, barcode: f.barcode, price: f.price.replace(/\s/g, ""), cost: f.cost.replace(/\s/g, ""), minStock: f.minStock };
      const r = await api<{ id: string }>(s, "variant.save", edit ? { ...body, id } : { ...body, requestId: requestId.current, initialQty: f.qty ? f.qty.trim() : 0 });
      id = r.id; onSaved();
    } catch (x) { setErr((x as Error).message); setBusy(false); return; }
    try { // la photo n'est confirmée qu'après réponse positive du serveur
      if (photo) await api(s, "article.image", { id: a.$id, variantId: id, data: await compressImage(photo) });
      else if (removePhoto && initial?.imageFileId) await api(s, "article.image", { id: a.$id, variantId: id, data: null });
      onSaved(); setDone(edit ? "Variante modifiée." : "Variante créée."); setBusy(false); setTimeout(onClose, 700);
    } catch (x) { setBusy(false); setErr(`La variante est enregistrée, mais la photo a échoué : ${(x as Error).message}`); onSaved(); if (!edit) requestId.current = crypto.randomUUID(); }
  }
  return (
    <Sheet title={edit ? "Modifier la variante" : "Nouvelle variante"} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          {preview ? <img src={preview} alt="Aperçu" className="w-24 h-24 rounded-lg object-cover" /> : removePhoto ? <Thumb size={96} /> : <Thumb id={initial?.imageFileId} size={96} />}
          <div className="flex flex-col gap-2 flex-1">
            <label className="btn-ghost flex items-center justify-center gap-2 cursor-pointer text-sm"><Camera size={18} />Prendre une photo<input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { setPhoto(e.target.files?.[0] ?? null); setRemovePhoto(false); }} /></label>
            <label className="btn-ghost flex items-center justify-center gap-2 cursor-pointer text-sm"><ImageIcon size={18} />Galerie<input type="file" accept="image/*" className="sr-only" onChange={(e) => { setPhoto(e.target.files?.[0] ?? null); setRemovePhoto(false); }} /></label>
            {(photo || (initial?.imageFileId && existing && !removePhoto)) && <button type="button" className="text-xs text-bad text-left" onClick={() => { setPhoto(null); setRemovePhoto(true); }}>Retirer la photo</button>}
          </div>
        </div>
        <fieldset className="flex flex-col gap-2"><legend className="text-sm text-soft mb-1">Attributs *</legend>
          {attrs.map((x, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <input className="input !px-3" aria-label="Nom de l'attribut" list="attr-names" placeholder="Taille, Couleur…" maxLength={30} value={x.name} onChange={(e) => setAttr(i, { name: e.target.value })} />
              <input className="input !px-3" aria-label="Valeur" placeholder="M, Rouge…" maxLength={40} value={x.value} onChange={(e) => setAttr(i, { value: e.target.value })} />
              {attrs.length > 1 ? <button type="button" className="p-2 text-bad" aria-label="Retirer l'attribut" onClick={() => setAttrs(attrs.filter((_, j) => j !== i))}><X size={18} /></button> : <span />}
            </div>
          ))}
          <datalist id="attr-names">{ATTRIBUTE_SUGGESTIONS.map((n) => <option key={n} value={n} />)}</datalist>
          {attrs.length < MAX_ATTRIBUTES && <button type="button" className="btn-ghost !py-2 text-sm" onClick={() => setAttrs([...attrs, { name: ATTRIBUTE_SUGGESTIONS.find((n) => !attrs.some((x) => x.name.toLowerCase() === n.toLowerCase())) ?? "", value: "" }])}>+ Ajouter un attribut</button>}
        </fieldset>
        <div className="grid grid-cols-2 gap-2">{lbl("Référence / SKU", <input className="input" maxLength={64} value={f.sku} onChange={set("sku")} />)}
          {lbl("Code-barres", <div className="flex gap-2"><input className="input" maxLength={64} value={f.barcode} onChange={set("barcode")} /><button type="button" className="btn-ghost !px-3" aria-label="Scanner" onClick={() => setScan(true)}><ScanLine size={18} /></button></div>)}</div>
        <div className="grid grid-cols-2 gap-2">{lbl("Prix de vente (FCFA) *", <input className="input" inputMode="numeric" required value={f.price} onChange={set("price")} />)}{lbl("Prix d'achat (FCFA)", <input className="input" inputMode="numeric" value={f.cost} onChange={set("cost")} />)}</div>
        {f.price !== "" && <p className={`text-sm ${sellsAtLoss(price, cost) ? "text-warn" : "text-muted"}`}>{sellsAtLoss(price, cost) ? "Prix de vente inférieur au prix d'achat : vente à perte." : cost ? `Marge brute indicative : ${formatFcfa(m.amount)}${m.pct !== null ? ` (${m.pct} %)` : ""}` : "Renseignez le prix d'achat pour voir la marge."}</p>}
        <div className="grid grid-cols-2 gap-2">{lbl("Seuil d'alerte", <input className="input" inputMode="numeric" value={f.minStock} onChange={set("minStock")} />)}
          {!edit && lbl("Stock initial", <input className="input" inputMode="decimal" value={f.qty} onChange={set("qty")} />)}</div>
        {err && <p className="text-bad text-sm" role="alert">{err}</p>}{done && <p className="text-ok text-sm" role="status">{done}</p>}
        <button className="btn" disabled={busy || !valid}>{busy ? "Enregistrement…" : edit ? "Enregistrer" : "Créer la variante"}</button>
      </form>
      {scan && <Scanner onCode={(c) => { setF((x) => ({ ...x, barcode: c })); setScan(false); }} onClose={() => setScan(false)} />}
    </Sheet>
  );
}
