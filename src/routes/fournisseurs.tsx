import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Paperclip, Plus, Trash2, WifiOff } from "lucide-react";
import { api } from "@/lib/api";
import { compressImage } from "@/lib/articles";
import { list } from "@/lib/data";
import { useSession } from "@/lib/session";
import { Confirm, Sheet } from "@/components/ui";
import { planAllows } from "@/domain/features";
import { PO_LABEL } from "@/domain/purchasing-plus";
import { formatFcfa } from "@/domain/money";
import { useSubscription } from "./subscription";
import { AchatsPage } from "./achats";

type Doc = { fileId: string; name: string; mime: string; at: string };
type Sup = { id: string; name: string; legalName: string; contactPerson: string; phone: string; whatsapp: string; email: string; address: string; taxId: string; categories: string[]; paymentTerms: string; leadDays: number | null; notes: string; archived: boolean; balance?: number; docs?: Doc[] };
type SupList = { suppliers: (Sup & { balance: number; openOrders?: number })[]; categories: string[]; counts: { active: number; archived: number } };
type Line = { productId: string; variantId?: string; name: string; qty: number; unitPrice?: number; unitCost: number; discountPct?: number; received: number; remaining: number; lineHt?: number };
type Totals = { goodsHt: number; transport: number; otherFees: number; fees: number; totalHt: number; taxRatePct: number; tax: number; totalTtc: number; taxed: boolean };
type Po = { id: string; number: string; state: string; label: string; supplierId: string; supplier: string; createdOn: string; deliveryOn: string; late: boolean; totals: Totals; notes: string; docs: Doc[]; createdBy: string; lines: Line[]; billing?: string };
type Ev = { id: string; kind: string; by: string; at: string; detail: Record<string, unknown> };
type RLine = { productId: string; variantId?: string; name: string; ordered: number; receivedBefore: number; accepted: number; damaged: number; refused: number; missingAfter: number };
type Rec = { id: string; number: string; status: string; poId: string; po: string; supplier: string; deliveryNote: string; receivedOn: string; by: string; lines: RLine[]; accepted: number; damaged: number; refused: number; notes: string; docs: Doc[]; moves?: { id: string; productId: string; qty: number }[] };
type Pay = { id: string; amount: number; method: string; date: string; source: string; reference: string; by: string };
type Inv = { id: string; number: string; ref: string; supplierId: string; supplier: string; poId: string; receiptId: string; total: number; vat: number; paid: number; remaining: number; state: string; overdue: boolean; lateDays: number; issuedOn: string; dueOn: string; disputed: boolean; disputeReason: string; docs: Doc[]; payments: Pay[] };
type Dash = { period: { from: string; to: string }; suppliers: { active: number; archived: number }; orders: { pending: number; inProgress: number; orderedCount: number; orderedValue: number }; receipts: { count: number; value: number; damagedQty: number; refusedQty: number; lateCount: number; expected: { id: string; number: string; supplier: string; deliveryOn: string; remainingQty: number; remainingValue: number; late: boolean; lateDays: number }[] }; invoices: { issuedCount: number; invoiced: number; toPay: number; toPayCount: number; overdue: number; overdueCount: number; disputedCount: number; overdueList: { id: string; number: string; ref: string; supplier: string; remaining: number; dueOn: string; lateDays: number }[] }; payments: { count: number; paid: number; byMethod: Record<string, number> }; topSuppliers: { supplierId: string; name: string; value: number; orders: number }[]; topArticles: { productId: string; name: string; qty: number; value: number }[]; note: string };
type Cfg = { methods: { id: string; label: string }[]; taxRatePct: number; costNote: string };

const today = () => new Date().toISOString().slice(0, 10); const dayOff = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const num = (v: string) => Number(v.replace(/\s/g, "").replace(",", ".")); const dd = (d: string) => (d ? d.split("-").reverse().join("/") : "—");
const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 24);
const Err = ({ e }: { e: unknown }) => (e ? <p className="text-red-400 text-sm" role="alert">{(e as Error).message.replace(/^(DOUBLON_FACTURE|DOUBLON_POSSIBLE|DOUBLE_BL) : /, "")}</p> : null);
const TONE: Record<string, string> = { draft: "text-white/60", pending: "text-amber-300", validated: "text-sky-300", partial: "text-amber-300", received: "text-emerald-300", cancelled: "text-white/40", to_pay: "text-amber-300", paid: "text-emerald-300", dispute: "text-red-300" };
const INV_LABEL: Record<string, string> = { to_pay: "À payer", partial: "Partiellement payée", paid: "Payée", dispute: "En litige" };
const REC_LABEL: Record<string, string> = { draft: "Brouillon", validated: "Validée", cancelled: "Annulée" };
const EVENT: Record<string, string> = { create: "Créé", update: "Modifié", submit: "Soumis à validation", validate: "Validé", reject: "Renvoyé en brouillon", cancel: "Annulé", close: "Clôturé", amend: "Modification contrôlée", attach: "Document ajouté", archive: "Archivé", unarchive: "Réactivé", payment: "Paiement enregistré", paid: "Soldée", dispute: "Mise en litige", dispute_resolved: "Litige levé" };
const MLAB: Record<string, string> = { cash: "Espèces", card: "Banque / carte / virement", wave: "Wave", orange: "Orange Money", caisse: "Caisse" };
const toB64 = (f: File) => new Promise<string>((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] ?? ""); r.onerror = () => ko(new Error("Lecture du fichier impossible")); r.readAsDataURL(f); });
async function prepare(f: File): Promise<string> { if (f.type === "application/pdf") { if (f.size > 1_800_000) throw new Error("PDF trop lourd (1,8 Mo maximum)"); return toB64(f); } return compressImage(f); }
async function openDoc(d: Doc) {
  const env = import.meta.env; let fb = ""; try { fb = localStorage.getItem("cookieFallback") ?? ""; } catch { /* navigation privée */ }
  const res = await fetch(`${env.VITE_APPWRITE_ENDPOINT}/storage/buckets/articles/files/${d.fileId}/view`, { headers: { "X-Appwrite-Project": String(env.VITE_APPWRITE_PROJECT_ID), "X-Fallback-Cookies": fb }, credentials: "include" }); if (!res.ok) throw new Error("Document indisponible");
  const url = URL.createObjectURL(await res.blob()); window.open(url, "_blank", "noopener"); setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
const Field = ({ label, children }: { label: string; children: ReactNode }) => <label className="text-xs text-white/60 flex flex-col gap-1">{label}{children}</label>;
const History = ({ events }: { events: Ev[] }) => <div className="flex flex-col gap-1"><h3 className="text-sm font-semibold">Historique</h3>{events.map((e) => <p key={e.id} className="text-xs text-white/60 border-t border-[var(--line)] pt-1">{new Date(e.at).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · {EVENT[e.kind] ?? e.kind}{e.by ? ` · ${e.by}` : ""}{typeof e.detail.reason === "string" && e.detail.reason ? ` — « ${e.detail.reason} »` : ""}</p>)}</div>;

function Docs({ kind, id, docs, onDone }: { kind: "supplier" | "po" | "receipt" | "invoice"; id: string; docs: Doc[]; onDone: () => void }) {
  const { session } = useSession(); const s = session!; const m = useMutation({ mutationFn: async (f: File) => api(s, "purch.attach", { kind, id, name: f.name, data: await prepare(f) }), onSuccess: onDone }); const op = useMutation({ mutationFn: openDoc });
  return <div className="flex flex-col gap-1"><h3 className="text-sm font-semibold">Pièces jointes ({docs.length}/8)</h3>
    {docs.map((d) => <button key={d.fileId} className="text-left text-sm underline flex items-center gap-1" onClick={() => op.mutate(d)}><Paperclip size={14} />{d.name}</button>)}
    {docs.length < 8 && <label className="btn-ghost !py-2 text-sm text-center cursor-pointer">Ajouter un document (image ou PDF)<input type="file" className="hidden" accept="image/*,application/pdf" aria-label="Ajouter un document" onChange={(e) => { const f = e.target.files?.[0]; if (f) m.mutate(f); e.target.value = ""; }} /></label>}
    <Err e={m.error ?? op.error} /></div>;
}

/** Achats & fournisseurs (Business) : fournisseurs, commandes, réceptions, factures et paiements. Tous les chiffres viennent du serveur ; commandé, reçu, facturé et payé restent distincts. */
export function FournisseursPage() {
  const { session } = useSession(); const s = session!; const sub = useSubscription(); const allowed = planAllows(sub.data?.entitlement.plan.id, "purchasing"); const qc = useQueryClient();
  const [tab, setTab] = useState<"dash" | "sup" | "po" | "rec" | "inv">("dash"); const [sheet, setSheet] = useState<ReactNode>(null);
  const manager = s.role === "owner" || s.role === "manager"; const cfg = useQuery({ queryKey: ["purch-cfg", s.shopId], enabled: allowed, retry: 1, queryFn: () => api<Cfg>(s, "purch.config") });
  const refresh = () => void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("purch") || ["stock", "overview", "cash-current"].includes(String(q.queryKey[0])) });
  if (sub.isLoading) return <div className="card h-24 animate-pulse bg-white/5" aria-busy="true" />;
  if (!allowed) return <div className="flex flex-col gap-3"><h1 className="text-2xl font-bold">Achats</h1><div className="card flex flex-col gap-2 text-sm"><span className="flex items-center gap-2 font-semibold"><Lock size={16} className="text-[var(--gold)]" />Fournisseurs et commandes : formule Business</span><p className="text-white/60">Fiches fournisseurs, commandes avec validation, réceptions partielles, factures et paiements fournisseurs.</p><button className="btn text-center" onClick={() => window.location.assign(`${import.meta.env.BASE_URL}reglages?onglet=abonnement&formule=business`)}>Voir les formules</button></div><AchatsPage /></div>;
  const tabs: [typeof tab, string][] = [...(manager ? ([["dash", "Tableau"]] as [typeof tab, string][]) : []), ["sup", "Fournisseurs"], ["po", "Commandes"], ["rec", "Réceptions"], ...(manager ? ([["inv", "Factures"]] as [typeof tab, string][]) : [])]; const cur = tabs.some(([k]) => k === tab) ? tab : "sup";
  const open = (n: ReactNode) => setSheet(n); const close = () => setSheet(null);
  return <div className="flex flex-col gap-3">
    <h1 className="text-2xl font-bold">Achats & fournisseurs</h1>
    {!navigator.onLine && <div className="card border border-amber-400/40 text-sm flex gap-2" role="alert"><WifiOff size={16} className="text-amber-300 shrink-0 mt-0.5" /><span>Hors ligne : les achats nécessitent une connexion (validation, stock et paiements côté serveur).</span></div>}
    <nav aria-label="Sections" className="scroll-x">{tabs.map(([k, l]) => <button key={k} className="chip" aria-current={cur === k} onClick={() => setTab(k)}>{l}</button>)}</nav>
    {cur === "dash" && <Dashboard onOpen={open} close={close} refresh={refresh} cfg={cfg.data} />}
    {cur === "sup" && <Suppliers onOpen={open} close={close} refresh={refresh} />}
    {cur === "po" && <Orders onOpen={open} close={close} refresh={refresh} cfg={cfg.data} manager={manager} />}
    {cur === "rec" && <Receipts onOpen={open} close={close} refresh={refresh} />}
    {cur === "inv" && <Invoices onOpen={open} close={close} refresh={refresh} cfg={cfg.data} />}
    {sheet}
  </div>;
}
type Ctl = { onOpen: (n: ReactNode) => void; close: () => void; refresh: () => void };

// ------------------------------------------------------------------ tableau de bord
function Dashboard({ onOpen, close, refresh, cfg }: Ctl & { cfg?: Cfg }) {
  const { session } = useSession(); const s = session!; const [f, setF] = useState({ from: dayOff(-30), to: today(), supplierId: "" });
  const sups = useQuery({ queryKey: ["purch-sup-all", s.shopId], retry: 1, queryFn: () => api<SupList>(s, "purch.supplier.list", { status: "all" }) });
  const q = useQuery({ queryKey: ["purch-dash", s.shopId, f], retry: 1, queryFn: () => api<Dash>(s, "purch.dashboard", f) }); const d = q.data; const sel = "input !py-2 !px-2 text-sm";
  const K = ({ l, v, sub, tone }: { l: string; v: string; sub?: string; tone?: string }) => <div className="card flex flex-col"><span className="text-xs text-white/50">{l}</span><b className={`text-lg ${tone ?? ""}`}>{v}</b>{sub && <span className="text-xs text-white/50">{sub}</span>}</div>;
  return <div className="flex flex-col gap-3">
    <div className="grid grid-cols-2 gap-2"><label className="text-xs text-white/50">Du<input type="date" className={sel} aria-label="Du" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label><label className="text-xs text-white/50">Au<input type="date" className={sel} aria-label="Au" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
      <select className={`${sel} col-span-2`} aria-label="Fournisseur" value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}><option value="">Tous les fournisseurs</option>{sups.data?.suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
    {q.isLoading && <div className="card h-24 animate-pulse bg-white/5" aria-busy="true" />}<Err e={q.error} />
    {d && <>
      <div className="grid grid-cols-2 gap-2"><K l="Fournisseurs actifs" v={String(d.suppliers.active)} /><K l="Commandes en attente de validation" v={String(d.orders.pending)} /><K l="Commandes en cours" v={String(d.orders.inProgress)} sub="validées, à recevoir" /><K l="Livraisons en retard" v={String(d.receipts.lateCount)} tone={d.receipts.lateCount ? "text-red-300" : ""} /></div>
      <h2 className="font-semibold text-sm">Sur la période (quatre mesures distinctes)</h2>
      <div className="grid grid-cols-2 gap-2"><K l="Commandé" v={formatFcfa(d.orders.orderedValue)} sub={`${d.orders.orderedCount} commande(s) validée(s)`} /><K l="Reçu" v={formatFcfa(d.receipts.value)} sub={`${d.receipts.count} réception(s)${d.receipts.damagedQty + d.receipts.refusedQty ? ` · ${d.receipts.damagedQty + d.receipts.refusedQty} écart(s)` : ""}`} /><K l="Facturé" v={formatFcfa(d.invoices.invoiced)} sub={`${d.invoices.issuedCount} facture(s)`} /><K l="Payé" v={formatFcfa(d.payments.paid)} sub={`${d.payments.count} paiement(s)`} /></div>
      <p className="text-xs text-white/50">{d.note}</p>
      <h2 className="font-semibold text-sm">Soldes à date</h2>
      <div className="grid grid-cols-2 gap-2"><K l="Factures à payer" v={formatFcfa(d.invoices.toPay)} sub={`${d.invoices.toPayCount} facture(s)`} tone="text-amber-300" /><K l="Dont échues" v={formatFcfa(d.invoices.overdue)} sub={`${d.invoices.overdueCount} facture(s)${d.invoices.disputedCount ? ` · ${d.invoices.disputedCount} en litige` : ""}`} tone={d.invoices.overdue ? "text-red-300" : ""} /></div>
      {!!d.invoices.overdueList.length && <div className="flex flex-col gap-1"><h3 className="text-sm font-semibold">Factures échues</h3>{d.invoices.overdueList.map((i) => <button key={i.id} className="card text-left flex justify-between text-sm" onClick={() => onOpen(<InvoiceSheet id={i.id} close={close} refresh={refresh} cfg={cfg} />)}><span>{i.supplier}<span className="block text-xs text-white/50">{i.ref} · échue le {dd(i.dueOn)} ({i.lateDays} j)</span></span><b>{formatFcfa(i.remaining)}</b></button>)}</div>}
      <div className="flex flex-col gap-1"><h3 className="text-sm font-semibold">Réceptions attendues</h3>{!d.receipts.expected.length && <p className="text-sm text-white/50">Aucune commande validée en attente de livraison.</p>}{d.receipts.expected.map((e) => <button key={e.id} className="card text-left flex justify-between text-sm" onClick={() => onOpen(<OrderSheet id={e.id} close={close} refresh={refresh} cfg={cfg} manager onOpen={onOpen} />)}><span>{e.number} · {e.supplier}<span className={`block text-xs ${e.late ? "text-red-300" : "text-white/50"}`}>{e.deliveryOn ? `prévue le ${dd(e.deliveryOn)}${e.late ? ` — ${e.lateDays} j de retard` : ""}` : "date non précisée"} · {e.remainingQty} à recevoir</span></span><b>{formatFcfa(e.remainingValue)}</b></button>)}</div>
      <div className="flex flex-col gap-1"><h3 className="text-sm font-semibold">Principaux fournisseurs (commandé)</h3>{!d.topSuppliers.length && <p className="text-sm text-white/50">Aucune commande validée sur la période.</p>}{d.topSuppliers.map((x) => <p key={x.supplierId} className="flex justify-between text-sm border-t border-[var(--line)] pt-1"><span>{x.name}<span className="text-xs text-white/50"> · {x.orders} commande(s)</span></span><b>{formatFcfa(x.value)}</b></p>)}</div>
      <div className="flex flex-col gap-1"><h3 className="text-sm font-semibold">Principaux articles reçus</h3>{!d.topArticles.length && <p className="text-sm text-white/50">Aucune réception sur la période.</p>}{d.topArticles.map((x) => <p key={x.productId + x.name} className="flex justify-between text-sm border-t border-[var(--line)] pt-1"><span>{x.name}<span className="text-xs text-white/50"> · {x.qty} reçu(s)</span></span><b>{formatFcfa(x.value)}</b></p>)}</div>
    </>}
  </div>;
}

// ------------------------------------------------------------------ fournisseurs
function Suppliers({ onOpen, close, refresh }: Ctl) {
  const { session } = useSession(); const s = session!; const [f, setF] = useState({ q: "", status: "active", category: "" });
  const q = useQuery({ queryKey: ["purch-sup", s.shopId, f], retry: 1, queryFn: () => api<SupList>(s, "purch.supplier.list", f) }); const sel = "input !py-2 !px-2 text-sm";
  return <div className="flex flex-col gap-2">
    <div className="flex gap-2"><input className="input flex-1" aria-label="Rechercher un fournisseur" placeholder="Nom, contact, téléphone…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /><button className="btn !py-2 flex items-center gap-1" onClick={() => onOpen(<SupplierForm close={close} done={() => { close(); refresh(); }} />)}><Plus size={16} />Nouveau</button></div>
    <div className="grid grid-cols-2 gap-2"><select className={sel} aria-label="Statut" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="active">Actifs</option><option value="archived">Archivés</option><option value="all">Tous</option></select>
      <select className={sel} aria-label="Catégorie" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">Toutes catégories</option>{q.data?.categories.map((c) => <option key={c}>{c}</option>)}</select></div>
    {q.isLoading && <div className="card h-20 animate-pulse bg-white/5" aria-busy="true" />}<Err e={q.error} />
    {q.data && !q.data.suppliers.length && <p className="text-center text-white/50 text-sm py-6">Aucun fournisseur avec ces filtres.</p>}
    {q.data?.suppliers.map((x) => <button key={x.id} className="card text-left flex justify-between gap-2" onClick={() => onOpen(<SupplierSheet id={x.id} close={close} refresh={refresh} onOpen={onOpen} />)}><span className="min-w-0"><b className="block truncate">{x.name}{x.archived && <span className="text-xs text-white/40"> · archivé</span>}</b><span className="text-xs text-white/50 block truncate">{[x.contactPerson, x.phone, x.categories.join(", ")].filter(Boolean).join(" · ") || "—"}</span></span>{x.balance > 0 && <span className="text-right text-sm"><span className="text-xs text-white/50 block">Solde dû</span><b className="text-amber-300">{formatFcfa(x.balance)}</b></span>}</button>)}
  </div>;
}

function SupplierForm({ sup, close, done }: { sup?: Sup; close: () => void; done: () => void }) {
  const { session } = useSession(); const s = session!; const [f, setF] = useState({ name: sup?.name ?? "", legalName: sup?.legalName ?? "", contactPerson: sup?.contactPerson ?? "", phone: sup?.phone ?? "", whatsapp: sup?.whatsapp ?? "", email: sup?.email ?? "", address: sup?.address ?? "", taxId: sup?.taxId ?? "", categories: sup?.categories.join(", ") ?? "", paymentTerms: sup?.paymentTerms ?? "", leadDays: sup?.leadDays == null ? "" : String(sup.leadDays), notes: sup?.notes ?? "" }); const [dup, setDup] = useState(false);
  const m = useMutation({ mutationFn: (confirmDuplicate: boolean) => api(s, "purch.supplier.save", { ...(sup ? { id: sup.id } : { clientId: rid() }), ...f, categories: f.categories.split(",").map((x) => x.trim()).filter(Boolean), leadDays: f.leadDays === "" ? null : num(f.leadDays), confirmDuplicate }), onSuccess: done, onError: (e) => setDup(/existe déjà|doublon/i.test((e as Error).message)) });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return <Sheet title={sup ? "Modifier le fournisseur" : "Nouveau fournisseur"} onClose={close} back>
    <Field label="Nom commercial *"><input className="input" aria-label="Nom commercial" value={f.name} onChange={set("name")} /></Field><Field label="Raison sociale"><input className="input" aria-label="Raison sociale" value={f.legalName} onChange={set("legalName")} /></Field>
    <Field label="Personne de contact"><input className="input" aria-label="Personne de contact" value={f.contactPerson} onChange={set("contactPerson")} /></Field>
    <div className="grid grid-cols-2 gap-2"><Field label="Téléphone"><input className="input" inputMode="tel" aria-label="Téléphone" value={f.phone} onChange={set("phone")} /></Field><Field label="WhatsApp"><input className="input" inputMode="tel" aria-label="WhatsApp" value={f.whatsapp} onChange={set("whatsapp")} /></Field></div>
    <Field label="E-mail"><input className="input" type="email" aria-label="E-mail" value={f.email} onChange={set("email")} /></Field><Field label="Adresse"><input className="input" aria-label="Adresse" value={f.address} onChange={set("address")} /></Field>
    <Field label="Identifiant fiscal (NINEA…)"><input className="input" aria-label="Identifiant fiscal" value={f.taxId} onChange={set("taxId")} /></Field>
    <Field label="Catégories d'articles (séparées par des virgules)"><input className="input" aria-label="Catégories d'articles" value={f.categories} onChange={set("categories")} /></Field>
    <div className="grid grid-cols-2 gap-2"><Field label="Conditions de paiement"><input className="input" placeholder="30 jours" aria-label="Conditions de paiement" value={f.paymentTerms} onChange={set("paymentTerms")} /></Field><Field label="Délai habituel (jours)"><input className="input" inputMode="numeric" aria-label="Délai habituel" value={f.leadDays} onChange={set("leadDays")} /></Field></div>
    <Field label="Notes"><textarea className="input" rows={3} aria-label="Notes" value={f.notes} onChange={set("notes")} /></Field>
    <Err e={m.error} />{dup && <p className="text-sm text-amber-300">Un fournisseur porte déjà ce nom. Enregistrez quand même seulement s'il s'agit d'une autre société.</p>}
    <button className="btn" disabled={m.isPending || !f.name.trim()} onClick={() => m.mutate(dup)}>{m.isPending ? "Enregistrement…" : dup ? "Enregistrer malgré le doublon" : "Enregistrer"}</button>
  </Sheet>;
}

type SupDetail = Sup & { balance: number; orders: { id: string; number: string; state: string; total: number; createdOn: string }[]; receipts: { id: string; number: string; status: string; receivedOn: string; deliveryNote: string }[]; invoices: Inv[]; payments: (Pay & { invoice: string; invoiceId: string })[]; events: Ev[]; balanceNote: string };
function SupplierSheet({ id, close, refresh, onOpen }: { id: string; close: () => void; refresh: () => void; onOpen: Ctl["onOpen"] }) {
  const { session } = useSession(); const s = session!; const qc = useQueryClient(); const manager = s.role === "owner" || s.role === "manager";
  const q = useQuery({ queryKey: ["purch-sup-get", id], retry: 1, queryFn: () => api<SupDetail>(s, "purch.supplier.get", { id }) }); const d = q.data; const [confirm, setConfirm] = useState<"archive" | "delete" | null>(null); const [why, setWhy] = useState("");
  const reload = () => { void qc.invalidateQueries({ queryKey: ["purch-sup-get", id] }); refresh(); };
  const arch = useMutation({ mutationFn: () => api(s, "purch.supplier.archive", { id, archived: !d?.archived, reason: why }), onSuccess: () => { setConfirm(null); reload(); } });
  const del = useMutation({ mutationFn: () => api(s, "purch.supplier.delete", { id }), onSuccess: () => { close(); refresh(); } });
  return <Sheet title={d?.name ?? "Fournisseur"} onClose={close} back>
    {q.isLoading && <div className="card h-24 animate-pulse bg-white/5" aria-busy="true" />}<Err e={q.error} />
    {d && <>
      <div className="card flex flex-col gap-1 text-sm">{d.legalName && <p>{d.legalName}</p>}{[["Contact", d.contactPerson], ["Téléphone", d.phone], ["WhatsApp", d.whatsapp], ["E-mail", d.email], ["Adresse", d.address], ["Identifiant fiscal", d.taxId], ["Catégories", d.categories.join(", ")], ["Conditions", d.paymentTerms], ["Délai habituel", d.leadDays == null ? "" : `${d.leadDays} jour(s)`], ["Notes", d.notes]].filter(([, v]) => v).map(([k, v]) => <p key={k}><span className="text-white/50">{k} : </span>{v}</p>)}{d.archived && <p className="text-amber-300">Fournisseur archivé</p>}</div>
      <div className="card flex justify-between items-center"><span className="text-sm">Solde dû<span className="block text-xs text-white/50">{d.balanceNote}</span></span><b className={d.balance > 0 ? "text-amber-300" : ""}>{formatFcfa(d.balance)}</b></div>
      <div className="flex gap-2 flex-wrap"><button className="btn-ghost !py-2 text-sm" onClick={() => onOpen(<SupplierForm sup={d} close={close} done={() => { close(); refresh(); }} />)}>Modifier</button>{manager && <button className="btn-ghost !py-2 text-sm" onClick={() => setConfirm("archive")}>{d.archived ? "Réactiver" : "Archiver"}</button>}{manager && <button className="btn-ghost !py-2 text-sm !border-red-400/60 !text-red-300" onClick={() => setConfirm("delete")}>Supprimer</button>}</div>
      <Section title={`Commandes (${d.orders.length})`}>{d.orders.map((o) => <p key={o.id} className="flex justify-between text-sm"><span>{o.number}<span className={`text-xs ${TONE[o.state] ?? ""}`}> · {PO_LABEL[o.state as keyof typeof PO_LABEL] ?? o.state}</span></span><span>{formatFcfa(o.total)}</span></p>)}</Section>
      <Section title={`Réceptions (${d.receipts.length})`}>{d.receipts.map((r) => <p key={r.id} className="flex justify-between text-sm"><span>{r.number} · BL {r.deliveryNote}</span><span className="text-xs text-white/50">{REC_LABEL[r.status] ?? r.status} · {dd(r.receivedOn)}</span></p>)}</Section>
      {manager && <Section title={`Factures (${d.invoices.length})`}>{d.invoices.map((i) => <p key={i.id} className="flex justify-between text-sm"><span>{i.number} · {i.ref}<span className={`text-xs ${TONE[i.state] ?? ""}`}> · {INV_LABEL[i.state] ?? i.state}</span></span><span>{formatFcfa(i.total)}</span></p>)}</Section>}
      {manager && <Section title={`Paiements (${d.payments.length})`}>{d.payments.map((p) => <p key={p.id} className="flex justify-between text-sm"><span>{p.invoice}<span className="text-xs text-white/50"> · {dd(p.date)} · {p.source === "till" ? "caisse" : MLAB[p.method] ?? p.method}</span></span><span>{formatFcfa(p.amount)}</span></p>)}</Section>}
      <Docs kind="supplier" id={id} docs={d.docs ?? []} onDone={reload} /><History events={d.events} />
    </>}
    {confirm === "archive" && <Sheet title={d?.archived ? "Réactiver le fournisseur" : "Archiver le fournisseur"} onClose={() => setConfirm(null)} back><p className="text-sm text-white/60">{d?.archived ? "Il pourra de nouveau recevoir des commandes." : "Son historique est conservé ; il ne pourra plus recevoir de nouvelles commandes."}</p>{!d?.archived && <Field label="Motif *"><textarea className="input" rows={2} aria-label="Motif d'archivage" value={why} onChange={(e) => setWhy(e.target.value)} /></Field>}<Err e={arch.error} /><button className="btn" disabled={arch.isPending || (!d?.archived && why.trim().length < 3)} onClick={() => arch.mutate()}>{d?.archived ? "Réactiver" : "Archiver"}</button></Sheet>}
    {confirm === "delete" && <Confirm danger text="Supprimer définitivement ce fournisseur ? Impossible s'il a un historique commercial (archivez-le alors)." confirmLabel="Supprimer" onYes={() => { setConfirm(null); del.mutate(); }} onNo={() => setConfirm(null)} />}
    <Err e={arch.error ?? del.error} />
  </Sheet>;
}
const Section = ({ title, children }: { title: string; children: ReactNode }) => <div className="flex flex-col gap-1"><h3 className="text-sm font-semibold">{title}</h3>{children}</div>;

// ------------------------------------------------------------------ commandes
function Orders({ onOpen, close, refresh, cfg, manager }: Ctl & { cfg?: Cfg; manager: boolean }) {
  const { session } = useSession(); const s = session!; const [f, setF] = useState({ q: "", status: "", supplierId: "" });
  const q = useQuery({ queryKey: ["purch-po", s.shopId, f], retry: 1, queryFn: () => api<{ orders: Po[]; total: number }>(s, "purch.po.list", f) }); const sups = useQuery({ queryKey: ["purch-sup-all", s.shopId], retry: 1, queryFn: () => api<SupList>(s, "purch.supplier.list", { status: "all" }) }); const sel = "input !py-2 !px-2 text-sm";
  return <div className="flex flex-col gap-2">
    <div className="flex gap-2"><input className="input flex-1" aria-label="Rechercher une commande" placeholder="Numéro ou fournisseur" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /><button className="btn !py-2 flex items-center gap-1" onClick={() => onOpen(<OrderForm cfg={cfg} close={close} done={() => { close(); refresh(); }} />)}><Plus size={16} />Nouvelle</button></div>
    <div className="grid grid-cols-2 gap-2"><select className={sel} aria-label="Statut" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">Tous statuts</option><option value="open">En cours</option>{Object.entries(PO_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      <select className={sel} aria-label="Fournisseur" value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}><option value="">Tous fournisseurs</option>{sups.data?.suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
    {q.isLoading && <div className="card h-20 animate-pulse bg-white/5" aria-busy="true" />}<Err e={q.error} />
    {q.data && !q.data.orders.length && <p className="text-center text-white/50 text-sm py-6">Aucune commande avec ces filtres.</p>}
    {q.data?.orders.map((o) => <button key={o.id} className="card text-left flex justify-between gap-2" onClick={() => onOpen(<OrderSheet id={o.id} close={close} refresh={refresh} cfg={cfg} manager={manager} onOpen={onOpen} />)}><span className="min-w-0"><b className="block truncate">{o.number} · {o.supplier}</b><span className={`text-xs ${TONE[o.state] ?? ""}`}>{o.label}</span><span className="text-xs text-white/50"> · {dd(o.createdOn)}{o.deliveryOn ? ` · livraison ${dd(o.deliveryOn)}` : ""}</span>{o.late && <span className="text-xs text-red-300"> · en retard</span>}</span><b className="text-sm">{formatFcfa(o.totals.totalTtc)}</b></button>)}
  </div>;
}

type FLine = { productId: string; name: string; qty: string; price: string; disc: string };
function OrderForm({ po, cfg, close, done }: { po?: Po; cfg?: Cfg; close: () => void; done: () => void }) {
  const { session } = useSession(); const s = session!; const sups = useQuery({ queryKey: ["purch-sup", s.shopId, "active"], retry: 1, queryFn: () => api<SupList>(s, "purch.supplier.list", { status: "active" }) }); const prods = useQuery({ queryKey: ["purch-products", s.shopId], queryFn: () => list<{ name: string; archived?: boolean; kind?: string; hasVariants?: boolean; cost?: number }>("products", s, [], 1000) });
  const [f, setF] = useState({ supplierId: po?.supplierId ?? "", deliveryOn: po?.deliveryOn ?? "", transportFee: po?.totals.transport ? String(po.totals.transport) : "", otherFees: po?.totals.otherFees ? String(po.totals.otherFees) : "", notes: po?.notes ?? "" });
  const [lines, setLines] = useState<FLine[]>(po?.lines.map((l) => ({ productId: l.productId, name: l.name, qty: String(l.qty), price: String(l.unitPrice ?? l.unitCost), disc: l.discountPct ? String(l.discountPct) : "" })) ?? []); const [pick, setPick] = useState(""); const [key] = useState(() => rid());
  const options = (prods.data ?? []).filter((p) => !p.archived && p.kind !== "bundle" && !p.hasVariants && !lines.some((l) => l.productId === p.$id) && (!pick || p.name.toLowerCase().includes(pick.toLowerCase()))).slice(0, 8);
  const valid = f.supplierId && lines.length && lines.every((l) => num(l.qty) > 0 && l.price !== "" && num(l.price) >= 0);
  const goods = lines.reduce((a, l) => a + Math.round(num(l.qty || "0") * num(l.price || "0") * (1 - num(l.disc || "0") / 100)), 0); const fees = num(f.transportFee || "0") + num(f.otherFees || "0"); const tax = cfg && cfg.taxRatePct > 0 ? Math.round(((goods + fees) * cfg.taxRatePct) / 100) : 0;
  const m = useMutation({ mutationFn: () => api(s, "purch.po.save", { ...(po ? { id: po.id } : { clientId: key }), supplierId: f.supplierId, deliveryOn: f.deliveryOn || undefined, transportFee: f.transportFee || 0, otherFees: f.otherFees || 0, notes: f.notes, lines: lines.map((l) => ({ productId: l.productId, qty: num(l.qty), unitPrice: num(l.price), discountPct: l.disc === "" ? 0 : num(l.disc) })) }), onSuccess: done });
  const upd = (i: number, k: keyof FLine, v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return <Sheet title={po ? `Modifier ${po.number}` : "Nouvelle commande"} onClose={close} back>
    <Field label="Fournisseur *"><select className="input" aria-label="Fournisseur" value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}><option value="">Choisir…</option>{sups.data?.suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
    {sups.data && !sups.data.suppliers.length && <p className="text-sm text-amber-300">Créez d'abord un fournisseur (onglet Fournisseurs).</p>}
    <Field label="Livraison prévue"><input type="date" className="input" min={today()} aria-label="Livraison prévue" value={f.deliveryOn} onChange={(e) => setF({ ...f, deliveryOn: e.target.value })} /></Field>
    <h3 className="text-sm font-semibold">Articles</h3>
    {lines.map((l, i) => <div key={l.productId} className="card flex flex-col gap-2"><div className="flex justify-between gap-2"><b className="text-sm">{l.name}</b><button aria-label={`Retirer ${l.name}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 size={16} /></button></div>
      <div className="grid grid-cols-3 gap-2"><Field label="Quantité"><input className="input" inputMode="decimal" aria-label={`Quantité ${l.name}`} value={l.qty} onChange={(e) => upd(i, "qty", e.target.value)} /></Field><Field label="Prix d'achat"><input className="input" inputMode="numeric" aria-label={`Prix ${l.name}`} value={l.price} onChange={(e) => upd(i, "price", e.target.value)} /></Field><Field label="Remise %"><input className="input" inputMode="decimal" aria-label={`Remise ${l.name}`} value={l.disc} onChange={(e) => upd(i, "disc", e.target.value)} /></Field></div></div>)}
    <input className="input" aria-label="Ajouter un article" placeholder="Ajouter un article du catalogue…" value={pick} onChange={(e) => setPick(e.target.value)} />
    {pick && options.map((p) => <button key={p.$id} className="card text-left text-sm" onClick={() => { setLines([...lines, { productId: p.$id, name: p.name, qty: "1", price: p.cost ? String(p.cost) : "", disc: "" }]); setPick(""); }}>{p.name}</button>)}
    <div className="grid grid-cols-2 gap-2"><Field label="Frais de transport"><input className="input" inputMode="numeric" aria-label="Frais de transport" value={f.transportFee} onChange={(e) => setF({ ...f, transportFee: e.target.value })} /></Field><Field label="Autres frais"><input className="input" inputMode="numeric" aria-label="Autres frais" value={f.otherFees} onChange={(e) => setF({ ...f, otherFees: e.target.value })} /></Field></div>
    <Field label="Notes"><textarea className="input" rows={2} aria-label="Notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
    <div className="card text-sm flex flex-col gap-1"><p className="flex justify-between"><span>Total HT (frais inclus)</span><b>{formatFcfa(goods + fees)}</b></p>{cfg && cfg.taxRatePct > 0 ? <p className="flex justify-between"><span>Taxe ({cfg.taxRatePct} %)</span><span>{formatFcfa(tax)}</span></p> : <p className="text-xs text-white/50">Aucune taxe configurée : pas de TVA ajoutée.</p>}<p className="flex justify-between"><span>Total TTC</span><b>{formatFcfa(goods + fees + tax)}</b></p></div>
    <Err e={m.error} /><button className="btn" disabled={!valid || m.isPending} onClick={() => m.mutate()}>{m.isPending ? "Enregistrement…" : "Enregistrer le brouillon"}</button>
  </Sheet>;
}

type PoDetail = Po & { events: Ev[]; receiptsList: { id: string; number: string; status: string; receivedOn: string; deliveryNote: string }[]; invoicesList: Inv[] };
function OrderSheet({ id, close, refresh, cfg, manager, onOpen }: { id: string; close: () => void; refresh: () => void; cfg?: Cfg; manager: boolean; onOpen: Ctl["onOpen"] }) {
  const { session } = useSession(); const s = session!; const qc = useQueryClient(); const q = useQuery({ queryKey: ["purch-po-get", id], retry: 1, queryFn: () => api<PoDetail>(s, "purch.po.get", { id }) }); const d = q.data;
  const [ask, setAsk] = useState<null | { kind: "cancel" | "reject" | "close" | "amend"; title: string }>(null); const [why, setWhy] = useState(""); const [edit, setEdit] = useState<Record<string, string>>({}); const reload = () => { void qc.invalidateQueries({ queryKey: ["purch-po-get", id] }); refresh(); };
  const act = useMutation({ mutationFn: (a: { action: string; body?: object }) => api(s, `purch.po.${a.action}`, { id, ...a.body }), onSuccess: () => { setAsk(null); setWhy(""); reload(); } });
  const lineBody = d ? d.lines.map((l) => ({ productId: l.productId, variantId: l.variantId, qty: edit[l.productId] ? num(edit[l.productId]!) : l.qty, unitPrice: l.unitPrice ?? l.unitCost, discountPct: l.discountPct ?? 0 })) : [];
  return <Sheet title={d ? d.number : "Commande"} onClose={close} back>
    {q.isLoading && <div className="card h-24 animate-pulse bg-white/5" aria-busy="true" />}<Err e={q.error} />
    {d && <>
      <div className="card flex flex-col gap-1 text-sm"><p className="flex justify-between"><b>{d.supplier}</b><span className={TONE[d.state]}>{d.label}</span></p><p className="text-white/60">Créée le {dd(d.createdOn)}{d.deliveryOn ? ` · livraison prévue le ${dd(d.deliveryOn)}` : ""}{d.late ? " · EN RETARD" : ""}</p>{d.notes && <p>{d.notes}</p>}
        {d.lines.map((l) => <p key={l.productId + (l.variantId ?? "")} className="flex justify-between gap-2 border-t border-[var(--line)] pt-1"><span>{l.name}<span className="block text-xs text-white/50">commandé {l.qty} · reçu {l.received} · reste {l.remaining}{l.discountPct ? ` · remise ${l.discountPct} %` : ""}</span></span><span>{formatFcfa(l.lineHt ?? Math.round(l.qty * l.unitCost))}</span></p>)}
        <p className="flex justify-between border-t border-[var(--line)] pt-1"><span>Marchandises</span><span>{formatFcfa(d.totals.goodsHt)}</span></p>{d.totals.fees > 0 && <p className="flex justify-between"><span>Frais (transport {formatFcfa(d.totals.transport)}, autres {formatFcfa(d.totals.otherFees)})</span><span>{formatFcfa(d.totals.fees)}</span></p>}<p className="flex justify-between"><span>Total HT</span><b>{formatFcfa(d.totals.totalHt)}</b></p>{d.totals.taxed && <p className="flex justify-between"><span>Taxe ({d.totals.taxRatePct} %)</span><span>{formatFcfa(d.totals.tax)}</span></p>}<p className="flex justify-between"><span>Total TTC</span><b>{formatFcfa(d.totals.totalTtc)}</b></p>
        <p className="text-xs text-white/50">Une commande validée ne modifie pas le stock : seul le stock RÉCEPTIONNÉ compte.</p></div>
      <div className="flex gap-2 flex-wrap">
        {d.state === "draft" && <><button className="btn-ghost !py-2 text-sm" onClick={() => onOpen(<OrderForm po={d} cfg={cfg} close={close} done={() => { close(); refresh(); }} />)}>Modifier</button><button className="btn !py-2 text-sm" disabled={act.isPending} onClick={() => act.mutate({ action: "submit" })}>Soumettre à validation</button>{s.role === "owner" && <button className="btn-ghost !py-2 text-sm" onClick={() => act.mutate({ action: "validate" })}>Valider directement</button>}</>}
        {d.state === "pending" && manager && <><button className="btn !py-2 text-sm" disabled={act.isPending} onClick={() => act.mutate({ action: "validate" })}>Valider la commande</button><button className="btn-ghost !py-2 text-sm" onClick={() => setAsk({ kind: "reject", title: "Renvoyer en brouillon" })}>Renvoyer</button></>}
        {(d.state === "validated" || d.state === "partial") && <button className="btn !py-2 text-sm" onClick={() => onOpen(<ReceiptForm po={d} close={close} done={() => { close(); refresh(); }} />)}>Réceptionner</button>}
        {(d.state === "validated" || d.state === "partial") && manager && <button className="btn-ghost !py-2 text-sm" onClick={() => setAsk({ kind: "amend", title: "Modification contrôlée (quantités)" })}>Modifier (avec motif)</button>}
        {d.state === "partial" && manager && <button className="btn-ghost !py-2 text-sm" onClick={() => setAsk({ kind: "close", title: "Clôturer : le reste ne sera pas livré" })}>Clôturer le reste</button>}
        {["draft", "pending", "validated"].includes(d.state) && <button className="btn-ghost !py-2 text-sm !border-red-400/60 !text-red-300" onClick={() => setAsk({ kind: "cancel", title: "Annuler la commande" })}>Annuler</button>}
      </div>
      <Err e={act.error} />
      <Section title={`Réceptions (${d.receiptsList.length})`}>{d.receiptsList.map((r) => <button key={r.id} className="text-left text-sm flex justify-between" onClick={() => onOpen(<ReceiptSheet id={r.id} close={close} refresh={refresh} />)}><span>{r.number} · BL {r.deliveryNote}</span><span className="text-xs text-white/50">{REC_LABEL[r.status] ?? r.status} · {dd(r.receivedOn)}</span></button>)}</Section>
      {manager && <Section title={`Factures liées (${d.invoicesList.length})`}>{d.invoicesList.map((i) => <button key={i.id} className="text-left text-sm flex justify-between" onClick={() => onOpen(<InvoiceSheet id={i.id} close={close} refresh={refresh} cfg={cfg} />)}><span>{i.number} · {i.ref}</span><span>{formatFcfa(i.total)}</span></button>)}{!d.invoicesList.length && <p className="text-xs text-white/50">{d.billing === "not_invoiced" ? "Reçue mais pas encore facturée." : "Aucune facture liée."}</p>}</Section>}
      <Docs kind="po" id={id} docs={d.docs} onDone={reload} /><History events={d.events} />
    </>}
    {ask && <Sheet title={ask.title} onClose={() => setAsk(null)} back>
      {ask.kind === "amend" && d && <><p className="text-sm text-white/60">Changez les quantités (jamais en dessous du déjà reçu). La modification est historisée avec avant/après.</p>{d.lines.map((l) => <Field key={l.productId} label={`${l.name} (reçu ${l.received})`}><input className="input" inputMode="decimal" aria-label={`Nouvelle quantité ${l.name}`} defaultValue={l.qty} onChange={(e) => setEdit({ ...edit, [l.productId]: e.target.value })} /></Field>)}</>}
      <Field label={ask.kind === "reject" ? "Motif (facultatif)" : "Motif *"}><textarea className="input" rows={2} aria-label="Motif" value={why} onChange={(e) => setWhy(e.target.value)} /></Field><Err e={act.error} />
      <button className="btn" disabled={act.isPending || (ask.kind !== "reject" && why.trim().length < 3)} onClick={() => act.mutate({ action: ask.kind, body: ask.kind === "amend" ? { reason: why, lines: lineBody } : { reason: why } })}>{act.isPending ? "Envoi…" : "Confirmer"}</button></Sheet>}
  </Sheet>;
}

// ------------------------------------------------------------------ réceptions
function Receipts({ onOpen, close, refresh }: Ctl) {
  const { session } = useSession(); const s = session!; const [status, setStatus] = useState("");
  const q = useQuery({ queryKey: ["purch-rec", s.shopId, status], retry: 1, queryFn: () => api<{ receipts: Rec[] }>(s, "purch.receipt.list", { status }) });
  return <div className="flex flex-col gap-2">
    <select className="input !py-2 text-sm" aria-label="Statut" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Tous statuts</option>{Object.entries(REC_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
    <p className="text-xs text-white/50">Pour réceptionner : ouvrez une commande validée puis « Réceptionner ».</p>
    {q.isLoading && <div className="card h-20 animate-pulse bg-white/5" aria-busy="true" />}<Err e={q.error} />
    {q.data && !q.data.receipts.length && <p className="text-center text-white/50 text-sm py-6">Aucune réception.</p>}
    {q.data?.receipts.map((r) => <button key={r.id} className="card text-left flex justify-between gap-2" onClick={() => onOpen(<ReceiptSheet id={r.id} close={close} refresh={refresh} />)}><span className="min-w-0"><b className="block truncate">{r.number} · {r.supplier}</b><span className="text-xs text-white/50">{r.po} · BL {r.deliveryNote} · {dd(r.receivedOn)}</span></span><span className="text-right text-xs"><span className={r.status === "validated" ? "text-emerald-300" : "text-amber-300"}>{REC_LABEL[r.status] ?? r.status}</span><span className="block">{r.accepted} acceptés{r.damaged + r.refused ? ` · ${r.damaged + r.refused} écart(s)` : ""}</span></span></button>)}
  </div>;
}

function ReceiptForm({ po, close, done }: { po: Po; close: () => void; done: () => void }) {
  const { session } = useSession(); const s = session!; const open = po.lines.filter((l) => l.remaining > 0); const [bl, setBl] = useState(""); const [on, setOn] = useState(today()); const [notes, setNotes] = useState(""); const [key] = useState(() => rid()); const [dup, setDup] = useState(false);
  const [v, setV] = useState<Record<string, { a: string; d: string; r: string }>>({}); const g = (l: Line) => v[l.productId + (l.variantId ?? "")] ?? { a: "", d: "", r: "" }; const set = (l: Line, k: "a" | "d" | "r", x: string) => setV({ ...v, [l.productId + (l.variantId ?? "")]: { ...g(l), [k]: x } });
  const lines = open.map((l) => ({ productId: l.productId, ...(l.variantId ? { variantId: l.variantId } : {}), accepted: g(l).a === "" ? 0 : num(g(l).a), damaged: g(l).d === "" ? 0 : num(g(l).d), refused: g(l).r === "" ? 0 : num(g(l).r) })).filter((l) => l.accepted + l.damaged + l.refused > 0);
  const m = useMutation({ mutationFn: async (confirmDuplicate: boolean) => { const r = await api<{ id: string }>(s, "purch.receipt.save", { clientId: key, poId: po.id, deliveryNote: bl, receivedOn: on, notes, lines, confirmDuplicate }); return r; }, onSuccess: done, onError: (e) => setDup(/DOUBLE_BL/.test((e as Error).message)) });
  return <Sheet title={`Réception — ${po.number}`} onClose={close} back>
    <p className="text-sm text-white/60">Enregistre un brouillon de réception : le stock n'est créé qu'à la validation. Seules les quantités <b>acceptées</b> entrent en stock.</p>
    <Field label="N° du bon de livraison *"><input className="input" aria-label="Numéro du bon de livraison" value={bl} onChange={(e) => { setBl(e.target.value); setDup(false); }} /></Field><Field label="Date de réception"><input type="date" className="input" max={today()} aria-label="Date de réception" value={on} onChange={(e) => setOn(e.target.value)} /></Field>
    {open.map((l) => <div key={l.productId + (l.variantId ?? "")} className="card flex flex-col gap-2"><p className="text-sm"><b>{l.name}</b><span className="block text-xs text-white/50">commandé {l.qty} · déjà reçu {l.received} · reste {l.remaining}</span></p>
      <div className="grid grid-cols-3 gap-2"><Field label="Acceptée"><input className="input" inputMode="decimal" aria-label={`Acceptée ${l.name}`} value={g(l).a} onChange={(e) => set(l, "a", e.target.value)} /></Field><Field label="Endommagée"><input className="input" inputMode="decimal" aria-label={`Endommagée ${l.name}`} value={g(l).d} onChange={(e) => set(l, "d", e.target.value)} /></Field><Field label="Refusée"><input className="input" inputMode="decimal" aria-label={`Refusée ${l.name}`} value={g(l).r} onChange={(e) => set(l, "r", e.target.value)} /></Field></div>
      {num(g(l).a || "0") + num(g(l).d || "0") + num(g(l).r || "0") > 0 && <p className="text-xs text-white/50">Manquant après cette réception : {Math.max(0, l.remaining - num(g(l).a || "0"))}</p>}</div>)}
    <Field label="Notes"><textarea className="input" rows={2} aria-label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    <Err e={m.error} />{dup && <p className="text-sm text-amber-300">Ce bon de livraison a déjà servi. Confirmez seulement s'il s'agit d'une livraison distincte.</p>}
    <button className="btn" disabled={!bl.trim() || !lines.length || m.isPending} onClick={() => m.mutate(dup)}>{m.isPending ? "Enregistrement…" : dup ? "Enregistrer malgré le doublon" : "Enregistrer la réception"}</button>
  </Sheet>;
}

function ReceiptSheet({ id, close, refresh }: { id: string; close: () => void; refresh: () => void }) {
  const { session } = useSession(); const s = session!; const qc = useQueryClient(); const q = useQuery({ queryKey: ["purch-rec-get", id], retry: 1, queryFn: () => api<Rec & { events: Ev[]; movesNote: string }>(s, "purch.receipt.get", { id }) }); const d = q.data; const [ask, setAsk] = useState<"validate" | "cancel" | null>(null); const [why, setWhy] = useState(""); const [ret, setRet] = useState(false); const [rq, setRq] = useState<Record<string, string>>({}); const [rkey] = useState(() => rid());
  const retM = useMutation({ mutationFn: () => api(s, "purch.return", { receiptId: id, returnKey: rkey, reason: why, lines: Object.entries(rq).filter(([, v]) => num(v || "0") > 0).map(([k, v]) => { const [productId, variantId] = k.split("|"); return { productId, ...(variantId ? { variantId } : {}), qty: num(v) }; }) }), onSuccess: () => { setRet(false); setWhy(""); reload(); } });
  const reload = () => { void qc.invalidateQueries({ queryKey: ["purch-rec-get", id] }); refresh(); }; const act = useMutation({ mutationFn: (a: "validate" | "cancel") => api(s, `purch.receipt.${a}`, { id, reason: why }), onSuccess: () => { setAsk(null); reload(); } });
  return <Sheet title={d ? d.number : "Réception"} onClose={close} back>
    {q.isLoading && <div className="card h-24 animate-pulse bg-white/5" aria-busy="true" />}<Err e={q.error} />
    {d && <>
      <div className="card flex flex-col gap-1 text-sm"><p className="flex justify-between"><b>{d.po}</b><span className={d.status === "validated" ? "text-emerald-300" : "text-amber-300"}>{REC_LABEL[d.status] ?? d.status}</span></p><p className="text-white/60">BL {d.deliveryNote} · reçue le {dd(d.receivedOn)}{d.by ? ` · ${d.by}` : ""}</p>{d.notes && <p>{d.notes}</p>}
        {d.lines.map((l) => <p key={l.productId + (l.variantId ?? "")} className="border-t border-[var(--line)] pt-1"><b>{l.name}</b><span className="block text-xs text-white/60">commandé {l.ordered} · déjà reçu {l.receivedBefore} · acceptée <b className="text-emerald-300">{l.accepted}</b>{l.damaged ? ` · endommagée ${l.damaged}` : ""}{l.refused ? ` · refusée ${l.refused}` : ""} · manquant {l.missingAfter}</span></p>)}
        {d.status === "validated" && <p className="text-xs text-white/50 border-t border-[var(--line)] pt-1">{d.moves?.length ?? 0} mouvement(s) de stock créé(s). {d.movesNote}</p>}</div>
      <div className="flex gap-2">{d.status === "validated" && <button className="btn-ghost !py-2 text-sm" onClick={() => setRet(true)}>Retour fournisseur</button>}{d.status === "draft" && <><button className="btn !py-2 text-sm" disabled={act.isPending} onClick={() => setAsk("validate")}>Valider (crée le stock)</button><button className="btn-ghost !py-2 text-sm !border-red-400/60 !text-red-300" onClick={() => setAsk("cancel")}>Annuler le brouillon</button></>}</div>
      <Err e={act.error} /><Docs kind="receipt" id={id} docs={d.docs} onDone={reload} /><History events={d.events} />
    </>}
    {ret && d && <Sheet title="Retour fournisseur" onClose={() => setRet(false)} back><p className="text-sm text-white/60">Sort du stock les quantités retournées (mouvement tracé) ; limité à ce qui a été accepté. La dette n'est pas modifiée : traitez l'avoir par un litige sur la facture.</p>{d.lines.filter((l) => l.accepted > 0).map((l) => <Field key={l.productId + (l.variantId ?? "")} label={`${l.name} (acceptés ${l.accepted})`}><input className="input" inputMode="decimal" aria-label={`Retour ${l.name}`} value={rq[`${l.productId}|${l.variantId ?? ""}`] ?? ""} onChange={(e) => setRq({ ...rq, [`${l.productId}|${l.variantId ?? ""}`]: e.target.value })} /></Field>)}<Field label="Motif *"><textarea className="input" rows={2} aria-label="Motif du retour" value={why} onChange={(e) => setWhy(e.target.value)} /></Field><Err e={retM.error} /><button className="btn" disabled={why.trim().length < 3 || !Object.values(rq).some((v) => num(v || "0") > 0) || retM.isPending} onClick={() => retM.mutate()}>{retM.isPending ? "Envoi…" : "Confirmer le retour"}</button></Sheet>}
    {ask === "validate" && <Confirm text="Valider cette réception ? Les quantités acceptées entreront en stock une seule fois ; ni les endommagées ni les refusées." confirmLabel="Valider" onYes={() => act.mutate("validate")} onNo={() => setAsk(null)} />}
    {ask === "cancel" && <Sheet title="Annuler la réception" onClose={() => setAsk(null)} back><Field label="Motif *"><textarea className="input" rows={2} aria-label="Motif" value={why} onChange={(e) => setWhy(e.target.value)} /></Field><Err e={act.error} /><button className="btn" disabled={why.trim().length < 3 || act.isPending} onClick={() => act.mutate("cancel")}>Confirmer l'annulation</button></Sheet>}
  </Sheet>;
}

// ------------------------------------------------------------------ factures et paiements
function Invoices({ onOpen, close, refresh, cfg }: Ctl & { cfg?: Cfg }) {
  const { session } = useSession(); const s = session!; const [f, setF] = useState({ status: "", supplierId: "", overdue: false });
  const q = useQuery({ queryKey: ["purch-inv", s.shopId, f], retry: 1, queryFn: () => api<{ invoices: Inv[]; totals: { toPay: number; overdue: number; count: number } }>(s, "purch.invoice.list", { ...f, overdue: f.overdue || undefined }) }); const sups = useQuery({ queryKey: ["purch-sup-all", s.shopId], retry: 1, queryFn: () => api<SupList>(s, "purch.supplier.list", { status: "all" }) }); const sel = "input !py-2 !px-2 text-sm";
  return <div className="flex flex-col gap-2">
    <div className="flex justify-end"><button className="btn !py-2 flex items-center gap-1" onClick={() => onOpen(<InvoiceForm close={close} done={() => { close(); refresh(); }} />)}><Plus size={16} />Facture reçue</button></div>
    <div className="grid grid-cols-2 gap-2"><select className={sel} aria-label="Statut" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">Tous statuts</option>{Object.entries(INV_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><select className={sel} aria-label="Fournisseur" value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}><option value="">Tous fournisseurs</option>{sups.data?.suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
    <label className="text-sm flex gap-2 items-center"><input type="checkbox" checked={f.overdue} onChange={(e) => setF({ ...f, overdue: e.target.checked })} />Échues seulement</label>
    {q.data && <p className="text-xs text-white/50">{q.data.totals.count} facture(s) · reste à payer {formatFcfa(q.data.totals.toPay)} · dont échu {formatFcfa(q.data.totals.overdue)}</p>}
    {q.isLoading && <div className="card h-20 animate-pulse bg-white/5" aria-busy="true" />}<Err e={q.error} />
    {q.data && !q.data.invoices.length && <p className="text-center text-white/50 text-sm py-6">Aucune facture fournisseur.</p>}
    {q.data?.invoices.map((i) => <button key={i.id} className="card text-left flex justify-between gap-2" onClick={() => onOpen(<InvoiceSheet id={i.id} close={close} refresh={refresh} cfg={cfg} />)}><span className="min-w-0"><b className="block truncate">{i.supplier} · {i.ref}</b><span className={`text-xs ${TONE[i.state] ?? ""}`}>{INV_LABEL[i.state] ?? i.state}</span><span className="text-xs text-white/50"> · échéance {dd(i.dueOn)}</span>{i.overdue && <span className="text-xs text-red-300"> · échue ({i.lateDays} j)</span>}</span><span className="text-right text-sm"><b>{formatFcfa(i.total)}</b>{i.remaining > 0 && i.remaining < i.total && <span className="block text-xs text-amber-300">reste {formatFcfa(i.remaining)}</span>}</span></button>)}
  </div>;
}

function InvoiceForm({ close, done }: { close: () => void; done: () => void }) {
  const { session } = useSession(); const s = session!; const sups = useQuery({ queryKey: ["purch-sup", s.shopId, "active"], retry: 1, queryFn: () => api<SupList>(s, "purch.supplier.list", { status: "active" }) });
  const [f, setF] = useState({ supplierId: "", poId: "", ref: "", issuedOn: today(), dueOn: dayOff(30), total: "", vat: "", notes: "" }); const [key] = useState(() => rid()); const [dup, setDup] = useState<string>("");
  const pos = useQuery({ queryKey: ["purch-po-sup", f.supplierId], enabled: !!f.supplierId, retry: 1, queryFn: () => api<{ orders: Po[] }>(s, "purch.po.list", { supplierId: f.supplierId }) }); const linkable = (pos.data?.orders ?? []).filter((o) => ["validated", "partial", "received"].includes(o.state));
  const m = useMutation({ mutationFn: (confirmDuplicate: boolean) => api(s, "purch.invoice.save", { clientId: key, ...f, poId: f.poId || undefined, total: num(f.total), vat: f.vat === "" ? 0 : num(f.vat), confirmDuplicate }), onSuccess: done, onError: (e) => setDup(/^DOUBLON_POSSIBLE/.test((e as Error).message) ? "possible" : "") });
  return <Sheet title="Facture fournisseur reçue" onClose={close} back>
    <p className="text-xs text-white/60">Une facture enregistre une dette : ce n'est <b>pas</b> un décaissement. L'argent ne sort qu'au paiement.</p>
    <Field label="Fournisseur *"><select className="input" aria-label="Fournisseur" value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value, poId: "" })}><option value="">Choisir…</option>{sups.data?.suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
    {!!f.supplierId && <Field label="Commande liée (facultatif)"><select className="input" aria-label="Commande liée" value={f.poId} onChange={(e) => setF({ ...f, poId: e.target.value })}><option value="">Aucune</option>{linkable.map((o) => <option key={o.id} value={o.id}>{o.number} · {formatFcfa(o.totals.totalTtc)}</option>)}</select></Field>}
    <Field label="Référence de la facture *"><input className="input" aria-label="Référence de la facture" value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} /></Field>
    <div className="grid grid-cols-2 gap-2"><Field label="Émise le"><input type="date" className="input" max={today()} aria-label="Date d'émission" value={f.issuedOn} onChange={(e) => setF({ ...f, issuedOn: e.target.value })} /></Field><Field label="Échéance"><input type="date" className="input" min={f.issuedOn} aria-label="Échéance" value={f.dueOn} onChange={(e) => setF({ ...f, dueOn: e.target.value })} /></Field></div>
    <div className="grid grid-cols-2 gap-2"><Field label="Montant TTC *"><input className="input" inputMode="numeric" aria-label="Montant de la facture" value={f.total} onChange={(e) => setF({ ...f, total: e.target.value })} /></Field><Field label="dont TVA"><input className="input" inputMode="numeric" aria-label="TVA" value={f.vat} onChange={(e) => setF({ ...f, vat: e.target.value })} /></Field></div>
    <Err e={m.error} />{dup && <p className="text-sm text-amber-300">Une facture de même montant existe à des dates proches. Confirmez seulement s'il s'agit d'une autre facture.</p>}
    <button className="btn" disabled={!f.supplierId || !f.ref.trim() || !f.total || m.isPending} onClick={() => m.mutate(!!dup)}>{m.isPending ? "Enregistrement…" : dup ? "Enregistrer malgré le doute" : "Enregistrer la facture"}</button>
  </Sheet>;
}

function InvoiceSheet({ id, close, refresh, cfg }: { id: string; close: () => void; refresh: () => void; cfg?: Cfg }) {
  const { session } = useSession(); const s = session!; const qc = useQueryClient(); const q = useQuery({ queryKey: ["purch-inv-get", id], retry: 1, queryFn: () => api<Inv & { events: Ev[] }>(s, "purch.invoice.get", { id }) }); const d = q.data;
  const [amount, setAmount] = useState(""); const [method, setMethod] = useState("cash"); const [source, setSource] = useState<"external" | "till">("external"); const [reference, setReference] = useState(""); const [payKey, setPayKey] = useState(() => rid()); const [why, setWhy] = useState(""); const [dispute, setDispute] = useState(false);
  const reload = () => { void qc.invalidateQueries({ queryKey: ["purch-inv-get", id] }); refresh(); };
  const pay = useMutation({ mutationFn: () => api(s, "purch.invoice.pay", { id, paymentKey: payKey, amount: num(amount), method, source, reference }), onSuccess: () => { setAmount(""); setReference(""); setPayKey(rid()); reload(); } });
  const dis = useMutation({ mutationFn: (resolve: boolean) => api(s, "purch.invoice.dispute", { id, reason: why, resolve }), onSuccess: () => { setDispute(false); setWhy(""); reload(); } });
  return <Sheet title={d ? `${d.number} · ${d.ref}` : "Facture"} onClose={close} back>
    {q.isLoading && <div className="card h-24 animate-pulse bg-white/5" aria-busy="true" />}<Err e={q.error} />
    {d && <>
      <div className="card flex flex-col gap-1 text-sm"><p className="flex justify-between"><b>{d.supplierId && "Facture fournisseur"}</b><span className={TONE[d.state]}>{INV_LABEL[d.state] ?? d.state}</span></p><p className="flex justify-between"><span>Montant</span><b>{formatFcfa(d.total)}</b></p>{d.vat > 0 && <p className="flex justify-between"><span>dont TVA</span><span>{formatFcfa(d.vat)}</span></p>}<p className="flex justify-between"><span>Payé</span><span>{formatFcfa(d.paid)}</span></p><p className="flex justify-between"><span>Reste dû</span><b className={d.remaining ? "text-amber-300" : "text-emerald-300"}>{formatFcfa(d.remaining)}</b></p><p className="text-white/60 text-xs">Émise le {dd(d.issuedOn)} · échéance {dd(d.dueOn)}{d.overdue ? ` · échue depuis ${d.lateDays} jour(s)` : ""}</p>{d.disputed && <p className="text-red-300">Litige : {d.disputeReason}</p>}</div>
      {!!d.payments.length && <Section title="Paiements">{d.payments.map((p) => <p key={p.id} className="flex justify-between text-sm"><span>{dd(p.date)} · {p.source === "till" ? "Caisse (espèces)" : MLAB[p.method] ?? p.method}{p.reference ? ` · ${p.reference}` : ""}</span><b>{formatFcfa(p.amount)}</b></p>)}</Section>}
      {d.remaining > 0 && !d.disputed && <div className="card flex flex-col gap-2"><h3 className="text-sm font-semibold">Enregistrer un paiement</h3>
        <p className="text-xs text-white/50">Un paiement est une sortie d'argent réelle ; il n'est jamais compté comme dépense d'exploitation.</p>
        <Field label="Payé depuis"><select className="input" aria-label="Origine du paiement" value={source} onChange={(e) => setSource(e.target.value as never)}><option value="external">Hors caisse (banque, mobile money, espèces du coffre)</option><option value="till">La caisse ouverte (espèces)</option></select></Field>
        {source === "external" && <Field label="Moyen de paiement"><select className="input" aria-label="Moyen de paiement" value={method} onChange={(e) => setMethod(e.target.value)}>{(cfg?.methods ?? [{ id: "cash", label: "Espèces" }]).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></Field>}
        <div className="grid grid-cols-2 gap-2"><Field label="Montant"><input className="input" inputMode="numeric" aria-label="Montant du paiement" placeholder={String(d.remaining)} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field><Field label="Référence"><input className="input" aria-label="Référence du paiement" value={reference} onChange={(e) => setReference(e.target.value)} /></Field></div>
        <button className="btn-ghost !py-1 text-xs self-start" onClick={() => setAmount(String(d.remaining))}>Solder ({formatFcfa(d.remaining)})</button><Err e={pay.error} />
        <button className="btn" disabled={!num(amount || "0") || pay.isPending} onClick={() => pay.mutate()}>{pay.isPending ? "Enregistrement…" : "Payer"}</button></div>}
      <div className="flex gap-2">{d.disputed ? <button className="btn-ghost !py-2 text-sm" onClick={() => setDispute(true)}>Lever le litige</button> : d.remaining > 0 && <button className="btn-ghost !py-2 text-sm" onClick={() => setDispute(true)}>Mettre en litige</button>}</div>
      <Err e={dis.error} /><Docs kind="invoice" id={id} docs={d.docs} onDone={reload} /><History events={d.events} />
    </>}
    {dispute && d && <Sheet title={d.disputed ? "Lever le litige" : "Mettre en litige"} onClose={() => setDispute(false)} back><Field label="Motif *"><textarea className="input" rows={2} aria-label="Motif" value={why} onChange={(e) => setWhy(e.target.value)} /></Field><Err e={dis.error} /><button className="btn" disabled={why.trim().length < 3 || dis.isPending} onClick={() => dis.mutate(d.disputed)}>Confirmer</button></Sheet>}
  </Sheet>;
}
