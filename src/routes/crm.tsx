import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Phone, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Confirm, Sheet } from "@/components/ui";
import { formatFcfa } from "@/domain/money";
import { planAllows } from "@/domain/features";
import { useSubscription } from "./subscription";
import { ProAnalytics, ProAutomations, ProCampaigns, ProInsight, ProLoyalty, ProSegments, ProTeams } from "./crm-pro";
import { OPEN_STAGES, SEGMENT_LABEL, SOURCES, STAGES, STAGE_LABEL, STAGE_PROB, TASK_KINDS, type Segment, type Stage } from "@/domain/crm";

// ------------------------------------------------------------------ types (réponses du serveur)
type Cust = { id: string; name: string; phone: string; email: string; company: string; source: string; ownerId: string; owner: string; tags: string[]; points: number; tier: string; creditBalance: number; salesCount: number; total: number; lastSaleAt: string | null; daysSince: number | null; segment: Segment; segmentLabel: string; openTasks: number };
type CustList = { customers: Cust[]; total: number; segments: Record<string, number>; inactiveDays: number; note: string };
type TL = { at: string; type: string; title: string; detail: string; amount?: number; by?: string };
type Task = { id: string; kind: string; kindLabel: string; title: string; dueAt: string; status: "open" | "done" | "cancelled"; overdue: boolean; ownerId: string; owner: string; leadId: string; customerId: string; oppId: string; party: string; notes: string; outcome: string; createdBy: string; createdAt: string; doneAt: string; doneBy: string };
type Opp = { id: string; title: string; leadId: string; customerId: string; party: string; stage: Stage; stageLabel: string; value: number; probability: number; weighted: number; dueOn: string; overdue: boolean; owner: string; ownerId: string; nextAction: string; nextActionOn: string; lostReason: string; closedAt: string; closedBy: string; notes: string };
type CustFull = { id: string; name: string; phone: string; email: string; company: string; address: string; source: string; ownerId: string; owner: string; tags: string[]; prefs: Record<string, string>; consents: { sms: boolean; email: boolean; whatsapp: boolean; call: boolean; at: string; by: string }; archived: boolean; createdAt: string; loyalty: { points: number; annualSpend: number; tier: string }; credit: { limit: number; balance: number }; stats: { salesCount: number; total: number; average: number; firstSaleAt: string | null; lastSaleAt: string | null; daysSince: number | null; promoSaved: number; promoCount: number }; segment: Segment; segmentLabel: string; topArticles: { name: string; qty: number; value: number }[]; timeline: TL[]; tasks: Task[]; opps: Opp[]; canManage: boolean };
type Lead = { id: string; name: string; phone: string; email: string; company: string; address: string; source: string; stage: Stage; stageLabel: string; ownerId: string; owner: string; notes: string; tags: string[]; prefs: Record<string, string>; consents: { sms: boolean; email: boolean; whatsapp: boolean; call: boolean }; lostReason: string; customerId: string; convertedAt: string; createdAt: string; createdBy: string; archived: boolean; openValue?: number | null };
type LeadFull = Lead & { timeline: TL[]; tasks: Task[]; opps: Opp[]; canManage: boolean };
type Owners = { owners: { id: string; name: string }[]; me: string; manager: boolean };
type Party = { kind: "customer" | "lead"; id: string; name: string };

const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 24);
const Err = ({ e }: { e: unknown }) => (e ? <p className="text-red-400 text-sm" role="alert">{(e as Error).message.replace(/^DOUBLON_POSSIBLE : /, "")}</p> : null);
const Field = ({ label, children }: { label: string; children: ReactNode }) => <label className="text-xs text-white/60 flex flex-col gap-1">{label}{children}</label>;
const Kpi = ({ label, value, tone = "", hint, onClick }: { label: string; value: ReactNode; tone?: string; hint?: string; onClick?: () => void }) => { const inner = <><div className="text-white/50 text-xs">{label}</div><div className={`font-semibold ${tone}`}>{value}</div>{hint && <div className="text-[11px] text-white/40">{hint}</div>}</>; return onClick ? <button className="card text-left" onClick={onClick}>{inner}</button> : <div className="card">{inner}</div>; };
const fmtAt = (d: string) => (d ? new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const fmtDay = (d: string) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
const localInput = (d = new Date(Date.now() + 864e5)) => { const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00`; };
const TL_LABEL: Record<string, string> = { sale: "Vente", return: "Retour", note: "Note", call: "Appel", meeting: "Rendez-vous", whatsapp: "WhatsApp", email: "E-mail", stage: "Étape", conversion: "Conversion", campaign: "Campagne", optout: "Désabonnement", task: "Agenda", consent: "Consentements", create: "Création", lost: "Perdu", reopen: "Réouverture" };
const SEG_TONE: Record<string, string> = { new: "text-sky-300", active: "text-emerald-300", loyal: "text-[var(--gold)]", inactive: "text-amber-300", dormant: "text-red-300", never: "text-white/50" };
const telHref = (p: string) => `tel:${p}`;
type Tab = "dash" | "cust" | "lead" | "opp" | "agenda" | "credit" | "seg" | "camp" | "auto" | "team" | "ana" | "loy";
const useOwners = () => { const { session } = useSession(); const s = session!; return useQuery({ queryKey: ["crm", "owners", s.shopId], retry: 1, staleTime: 5 * 60_000, queryFn: () => api<Owners>(s, "crm.owners") }); };

/** CRM Business : clients, prospects et pipeline, opportunités, agenda de relances, tableau de bord. Tous les chiffres viennent du serveur et des ventes réelles. */
export function CrmHub({ legacy }: { legacy: ReactNode }) {
  const { session } = useSession(); const s = session!; const mgr = s.role === "owner" || s.role === "manager"; const [tab, setTab] = useState<Tab>(mgr ? "dash" : "cust"); const [seg, setSeg] = useState<string>(""); const pro = planAllows(useSubscription().data?.entitlement.plan.id, "crmPro");
  const tabs: [Tab, string][] = [...(mgr ? ([["dash", "Tableau"]] as [Tab, string][]) : []), ["cust", "Clients"], ["lead", "Prospects"], ...(mgr ? ([["opp", "Opportunités"]] as [Tab, string][]) : []), ["agenda", "Agenda"], ...(pro && mgr ? ([["seg", "Segments"], ["camp", "Campagnes"], ["auto", "Automatisations"], ["team", "Équipes"], ["ana", "Analyses"], ["loy", "Fidélité"]] as [Tab, string][]) : []), ["credit", "Crédit & fidélité"]];
  return (
    <div className="flex flex-col gap-4">
      <h1 className="sr-only">Clients & CRM</h1>
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Sections du CRM">{tabs.map(([k, l]) => <button key={k} role="tab" className="chip" aria-current={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === "dash" && <Dashboard onSegment={(x) => { setSeg(x); setTab("cust"); }} onTab={setTab} />}
      {tab === "cust" && <Customers key={seg} seg={seg} />}
      {tab === "lead" && <Leads />}
      {tab === "opp" && mgr && <Opps />}
      {tab === "agenda" && <Agenda />}
      {pro && mgr && tab === "seg" && <ProSegments />}
      {pro && mgr && tab === "camp" && <ProCampaigns />}
      {pro && mgr && tab === "auto" && <ProAutomations />}
      {pro && mgr && tab === "team" && <ProTeams />}
      {pro && mgr && tab === "ana" && <ProAnalytics />}
      {pro && mgr && tab === "loy" && <ProLoyalty />}
      {tab === "credit" && legacy}
    </div>
  );
}

// ------------------------------------------------------------------ tableau de bord
type Dash = { period: { days: number; from: string; to: string }; inactiveDays: number; customers: { total: number; segments: Record<string, number>; newInPeriod: number }; leads: { total: number; byStage: Record<string, number>; createdInPeriod: number; convertedInPeriod: number; conversionRate: number | null; open: number }; pipeline: { openCount: number; openValue: number; weighted: number; overdue: number; wonCount: number; wonValue: number; lostCount: number; lostValue: number; byStage: { stage: string; label: string; count: number; value: number }[] }; agenda: { open: number; overdue: number; today: number; next7: number; bySeller: { name: string; open: number; overdue: number }[] }; topCustomers: { id: string; name: string; total: number; salesCount: number }[]; inactive: { id: string; name: string; phone: string; days: number | null; total: number; salesCount: number }[]; inactiveCount: number; sources: { source: string; label: string; count: number }[]; notes: string[] };
function Dashboard({ onSegment, onTab }: { onSegment: (s: string) => void; onTab: (t: Tab) => void }) {
  const { session } = useSession(); const s = session!; const [days, setDays] = useState(30); const [open, setOpen] = useState<string | null>(null); const [relance, setRelance] = useState<{ id: string; name: string } | null>(null);
  const q = useQuery({ queryKey: ["crm", "dash", s.shopId, days], retry: 1, queryFn: () => api<Dash>(s, "crm.dashboard", { days }) }); const d = q.data;
  return (
    <div className="flex flex-col gap-3">
      <Field label="Période"><select className="input" aria-label="Période du tableau de bord" value={days} onChange={(e) => setDays(Number(e.target.value))}>{[7, 30, 90, 365].map((x) => <option key={x} value={x}>{x} jours</option>)}</select></Field>
      {q.isLoading && <p className="text-sm text-white/60" role="status">Chargement…</p>}<Err e={q.error} />
      {d && <>
        <div className="grid grid-cols-2 gap-2">
          <Kpi label="Clients" value={d.customers.total} hint={`${d.customers.newInPeriod} nouveau(x) sur la période`} onClick={() => onSegment("")} />
          <Kpi label="Clients inactifs" value={d.inactiveCount} tone={d.inactiveCount ? "text-amber-300" : ""} hint={`Sans achat depuis plus de ${d.inactiveDays} j`} onClick={() => onSegment("inactive")} />
          <Kpi label="Prospects ouverts" value={d.leads.open} onClick={() => onTab("lead")} hint={d.leads.conversionRate !== null ? `Conversion ${d.leads.conversionRate} %` : "Pas encore de prospects créés sur la période"} />
          <Kpi label="Opportunités en cours" value={d.pipeline.openCount} onClick={() => onTab("opp")} hint={`${formatFcfa(d.pipeline.openValue)} · pondéré ${formatFcfa(d.pipeline.weighted)}`} />
          <Kpi label="Relances en retard" value={d.agenda.overdue} tone={d.agenda.overdue ? "text-red-300" : ""} onClick={() => onTab("agenda")} hint={`${d.agenda.today} aujourd'hui · ${d.agenda.next7} sous 7 j`} />
          <Kpi label="Gagné (période)" value={formatFcfa(d.pipeline.wonValue)} tone="text-emerald-300" hint={`${d.pipeline.wonCount} gagnée(s) · ${d.pipeline.lostCount} perdue(s)`} />
        </div>
        <section className="card flex flex-col gap-1"><h2 className="font-semibold">Clients par segment</h2>{(Object.keys(SEGMENT_LABEL) as Segment[]).map((k) => <button key={k} className="text-sm flex justify-between border-t border-[var(--line)] pt-1" onClick={() => onSegment(k)}><span className={SEG_TONE[k]}>{SEGMENT_LABEL[k]}</span><span className="text-white/60">{d.customers.segments[k] ?? 0}</span></button>)}</section>
        <section className="card flex flex-col gap-1"><h2 className="font-semibold">Pipeline des opportunités</h2>{d.pipeline.byStage.map((x) => <div key={x.stage} className="text-sm flex justify-between border-t border-[var(--line)] pt-1"><span>{x.label}</span><span className="text-white/60">{x.count} · {formatFcfa(x.value)}</span></div>)}{d.pipeline.overdue > 0 && <p className="text-xs text-red-300">{d.pipeline.overdue} opportunité(s) dépassent leur échéance.</p>}</section>
        <section className="card flex flex-col gap-1"><h2 className="font-semibold">Clients à relancer ({d.inactiveCount})</h2>{d.inactive.length === 0 && <p className="text-sm text-white/60">Aucun client inactif : chacun a acheté récemment.</p>}
          {d.inactive.map((c) => <div key={c.id} className="border-t border-[var(--line)] pt-1 flex items-center justify-between gap-2"><button className="text-left min-w-0" onClick={() => setOpen(c.id)}><span className="block truncate text-sm font-medium">{c.name}</span><span className="block text-xs text-white/50">{c.days} j sans achat · {c.salesCount} achat(s) · {formatFcfa(c.total)}</span></button><button className="btn-ghost !py-1 !px-3 text-sm" onClick={() => setRelance({ id: c.id, name: c.name })}>Relancer</button></div>)}</section>
        <section className="card flex flex-col gap-1"><h2 className="font-semibold">Meilleurs clients</h2>{d.topCustomers.length === 0 && <p className="text-sm text-white/60">Aucune vente rattachée à un client pour le moment.</p>}{d.topCustomers.map((c) => <button key={c.id} className="text-sm flex justify-between border-t border-[var(--line)] pt-1" onClick={() => setOpen(c.id)}><span className="truncate">{c.name}</span><span className="text-white/60">{formatFcfa(c.total)} · {c.salesCount} achat(s)</span></button>)}</section>
        <section className="card flex flex-col gap-1"><h2 className="font-semibold">Agenda par collègue</h2>{d.agenda.bySeller.length === 0 && <p className="text-sm text-white/60">Aucune relance ouverte.</p>}{d.agenda.bySeller.map((x) => <div key={x.name} className="text-sm flex justify-between border-t border-[var(--line)] pt-1"><span>{x.name}</span><span className={x.overdue ? "text-red-300" : "text-white/60"}>{x.open} ouverte(s) · {x.overdue} en retard</span></div>)}</section>
        <section className="card flex flex-col gap-1"><h2 className="font-semibold">Origines</h2>{d.sources.map((x) => <div key={x.source} className="text-sm flex justify-between border-t border-[var(--line)] pt-1"><span>{x.label}</span><span className="text-white/60">{x.count}</span></div>)}</section>
        <div className="text-[11px] text-white/40 flex flex-col gap-1">{d.notes.map((n) => <p key={n}>{n}</p>)}</div>
      </>}
      {open && <CustomerSheet id={open} onClose={() => setOpen(null)} />}
      {relance && <TaskForm title={`Relancer ${relance.name}`} initial={{ kind: "followup", title: `Relancer ${relance.name}`, party: { kind: "customer", id: relance.id, name: relance.name } }} onClose={() => setRelance(null)} onSaved={() => setRelance(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------ clients
function Customers({ seg }: { seg: string }) {
  const { session } = useSession(); const s = session!; const [f, setF] = useState({ q: "", segment: seg, source: "", mine: false, sort: "name" }); const [limit, setLimit] = useState(40); const [open, setOpen] = useState<string | null>(null); const [form, setForm] = useState(false);
  const q = useQuery({ queryKey: ["crm", "cust", s.shopId, f, limit], retry: 1, placeholderData: (p) => p, queryFn: () => api<CustList>(s, "crm.customers", { q: f.q || undefined, segment: f.segment || undefined, source: f.source || undefined, owner: f.mine ? "mine" : undefined, sort: f.sort, limit }) }); const d = q.data;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2"><input aria-label="Rechercher un client" className="input" placeholder="Nom, téléphone, e-mail, entreprise" value={f.q} onChange={(e) => { setF({ ...f, q: e.target.value }); setLimit(40); }} /><button className="btn !px-3" aria-label="Nouveau client" onClick={() => setForm(true)}><Plus /></button></div>
      <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Filtrer par segment">{([["", "Tous"], ...(Object.keys(SEGMENT_LABEL) as Segment[]).map((k) => [k, `${SEGMENT_LABEL[k].split(" (")[0]}${d ? ` (${d.segments[k] ?? 0})` : ""}`])] as [string, string][]).map(([k, l]) => <button key={k} className="chip" aria-current={f.segment === k} onClick={() => { setF({ ...f, segment: k }); setLimit(40); }}>{l}</button>)}</div>
      <div className="grid grid-cols-3 gap-2"><select aria-label="Origine" className="input !px-2 text-sm" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}><option value="">Toutes origines</option>{Object.entries(SOURCES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select aria-label="Tri" className="input !px-2 text-sm" value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })}><option value="name">Nom</option><option value="recent">Dernier achat</option><option value="spent">Chiffre le plus élevé</option><option value="inactive">Plus anciens achats</option></select>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.mine} onChange={(e) => setF({ ...f, mine: e.target.checked })} />Mes clients</label></div>
      {q.isLoading && <p className="text-sm text-white/60" role="status">Chargement…</p>}<Err e={q.error} />
      {d && d.total === 0 && <p className="card text-sm text-white/70">{f.q || f.segment || f.source || f.mine ? "Aucun client ne correspond à ces filtres." : "Aucun client pour le moment. Créez une fiche avec « + » : elle se mettra à jour toute seule à chaque vente rattachée à ce client."}</p>}
      <ul className="flex flex-col gap-2">{(d?.customers ?? []).map((c) => (
        <li key={c.id}><button className="card w-full text-left flex justify-between gap-2" onClick={() => setOpen(c.id)}>
          <span className="min-w-0"><span className="block truncate font-medium">{c.name}{c.company ? ` · ${c.company}` : ""}</span><span className="block text-xs text-white/50 truncate">{c.phone || c.email || "Sans contact"}{c.owner ? ` · ${c.owner}` : ""}</span><span className={`block text-xs ${SEG_TONE[c.segment]}`}>{c.segmentLabel}{c.daysSince !== null ? ` · dernier achat il y a ${c.daysSince} j` : ""}{c.openTasks ? ` · ${c.openTasks} relance(s)` : ""}</span></span>
          <span className="text-right text-sm shrink-0">{formatFcfa(c.total)}<span className="block text-xs text-white/50">{c.salesCount} achat(s)</span>{c.creditBalance > 0 && <span className="block text-xs text-red-300">Doit {formatFcfa(c.creditBalance)}</span>}</span></button></li>))}</ul>
      {d && d.total > (d.customers.length) && <button className="btn-ghost" disabled={q.isFetching} onClick={() => setLimit(limit + 40)}>Voir plus ({d.total - d.customers.length})</button>}
      {d && <p className="text-[11px] text-white/40">{d.total} client(s). {d.note}</p>}
      {open && <CustomerSheet id={open} onClose={() => setOpen(null)} />}
      {form && <PartyForm kind="customer" onClose={() => setForm(false)} onSaved={(id) => { setForm(false); setOpen(id); }} />}
    </div>
  );
}

function ContactBar({ phone, email, consents }: { phone: string; email: string; consents?: { sms: boolean; whatsapp: boolean; email: boolean; call: boolean } }) {
  if (!phone && !email) return <p className="text-xs text-white/50">Aucun contact enregistré.</p>;
  return <div className="flex gap-2 flex-wrap">{phone && <a className="btn-ghost !py-1 !px-3 text-sm flex items-center gap-1" href={telHref(phone)}><Phone size={14} />Appeler</a>}{email && <a className="btn-ghost !py-1 !px-3 text-sm" href={`mailto:${email}`}>E-mail</a>}{consents && !consents.whatsapp && !consents.sms && !consents.email && !consents.call && <span className="text-[11px] text-amber-300 self-center">Aucun consentement de démarchage enregistré : contactez pour un échange lié à sa commande.</span>}</div>;
}
function Timeline({ items }: { items: TL[] }) {
  return <section className="flex flex-col gap-1"><h3 className="text-sm font-semibold">Chronologie</h3>{items.length === 0 && <p className="text-xs text-white/50">Aucune interaction enregistrée.</p>}{items.map((e, i) => <p key={i} className="text-xs text-white/70 border-t border-[var(--line)] pt-1"><span className="text-white/50">{fmtAt(e.at)}</span> · <b>{e.type === "sale" || e.type === "return" ? e.title : TL_LABEL[e.type] ?? e.type}</b>{e.detail ? ` — ${e.detail}` : ""}{e.amount !== undefined ? <b className={e.amount < 0 ? " text-red-300" : " text-emerald-300"}> {formatFcfa(e.amount)}</b> : null}{e.by ? ` · ${e.by}` : ""}</p>)}</section>;
}
function CustomerSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { session } = useSession(); const s = session!; const pro = planAllows(useSubscription().data?.entitlement.plan.id, "crmPro"); const qc = useQueryClient(); const q = useQuery({ queryKey: ["crm", "cust1", s.shopId, id], retry: 1, queryFn: () => api<CustFull>(s, "crm.customer", { id }) }); const c = q.data; const [mode, setMode] = useState<"" | "edit" | "note" | "task" | "opp">("");
  const done = () => { setMode(""); void qc.invalidateQueries({ queryKey: ["crm"] }); };
  return (
    <Sheet title={c?.name ?? "Fiche client"} onClose={onClose} back>
      {q.isLoading && <p className="text-sm text-white/60" role="status">Chargement…</p>}<Err e={q.error} />
      {c && <>
        <div className="card flex flex-col gap-1 text-sm"><span className={`font-semibold ${SEG_TONE[c.segment]}`}>{c.segmentLabel}</span><span className="text-white/70">{c.company && `${c.company} · `}{c.phone || "Sans téléphone"}{c.email ? ` · ${c.email}` : ""}</span>{c.address && <span className="text-white/60 text-xs">{c.address}</span>}<span className="text-xs text-white/50">{c.source ? `Origine : ${SOURCES[c.source] ?? c.source} · ` : ""}{c.owner ? `Responsable : ${c.owner} · ` : ""}client depuis le {fmtDay(c.createdAt)}</span>{c.tags.length > 0 && <span className="text-xs text-[var(--gold)]">{c.tags.map((t) => `#${t}`).join(" ")}</span>}</div>
        <ContactBar phone={c.phone} email={c.email} consents={c.consents} />
        <div className="grid grid-cols-2 gap-2"><Kpi label="Achats confirmés" value={c.stats.salesCount} hint={`Panier moyen ${formatFcfa(c.stats.average)}`} /><Kpi label="Total dépensé" value={formatFcfa(c.stats.total)} hint={c.stats.lastSaleAt ? `Dernier achat : ${fmtDay(c.stats.lastSaleAt)} (${c.stats.daysSince} j)` : "Aucun achat"} />
          <Kpi label="Fidélité" value={`${c.loyalty.points} pts`} hint={`Niveau ${c.loyalty.tier}`} /><Kpi label="Crédit" value={c.credit.balance > 0 ? `Doit ${formatFcfa(c.credit.balance)}` : "À jour"} tone={c.credit.balance > 0 ? "text-red-300" : ""} hint={c.credit.limit ? `Plafond ${formatFcfa(c.credit.limit)}` : undefined} /></div>
        {c.stats.promoCount > 0 && <p className="text-xs text-white/60">{c.stats.promoCount} promotion(s) utilisée(s) · économies {formatFcfa(c.stats.promoSaved)}</p>}
        <p className="text-xs text-white/50">Consentements : appel {c.consents.call ? "oui" : "non"} · SMS {c.consents.sms ? "oui" : "non"} · e-mail {c.consents.email ? "oui" : "non"} · WhatsApp {c.consents.whatsapp ? "oui" : "non"}{c.consents.at ? ` (enregistrés le ${fmtDay(c.consents.at)}${c.consents.by ? ` par ${c.consents.by}` : ""})` : ""}{c.prefs.channel ? ` · canal préféré : ${c.prefs.channel}` : ""}{c.prefs.bestTime ? ` · ${c.prefs.bestTime}` : ""}</p>
        <div className="grid grid-cols-2 gap-2"><button className="btn-ghost" onClick={() => setMode("edit")}>Modifier</button><button className="btn-ghost" onClick={() => setMode("note")}>Ajouter une note</button><button className="btn-ghost" onClick={() => setMode("task")}>Planifier une relance</button>{c.canManage && <button className="btn-ghost" onClick={() => setMode("opp")}>Nouvelle opportunité</button>}</div>
        {c.topArticles.length > 0 && <section className="flex flex-col gap-1"><h3 className="text-sm font-semibold">Articles les plus achetés</h3>{c.topArticles.map((a) => <p key={a.name} className="text-xs text-white/70 flex justify-between border-t border-[var(--line)] pt-1"><span>{a.name}</span><span>{a.qty} u. · {formatFcfa(a.value)}</span></p>)}</section>}
        {pro && <ProInsight customerId={c.id} />}
        <TaskList tasks={c.tasks} onChanged={done} />
        {c.opps.length > 0 && <section className="flex flex-col gap-1"><h3 className="text-sm font-semibold">Opportunités</h3>{c.opps.map((o) => <p key={o.id} className="text-xs text-white/70 border-t border-[var(--line)] pt-1">{o.title} · {o.stageLabel} · {formatFcfa(o.value)} ({o.probability} %)</p>)}</section>}
        <Timeline items={c.timeline} />
        {mode === "edit" && <PartyForm kind="customer" initial={c} onClose={() => setMode("")} onSaved={done} />}
        {mode === "note" && <NoteForm target={{ customerId: c.id }} onClose={() => setMode("")} onSaved={done} />}
        {mode === "task" && <TaskForm title={`Relance · ${c.name}`} initial={{ kind: "followup", title: "", party: { kind: "customer", id: c.id, name: c.name } }} onClose={() => setMode("")} onSaved={done} />}
        {mode === "opp" && <OppForm initial={{ party: { kind: "customer", id: c.id, name: c.name } }} onClose={() => setMode("")} onSaved={done} />}
      </>}
    </Sheet>
  );
}

// ------------------------------------------------------------------ formulaire client / prospect (même champs)
function PartyForm({ kind, initial, onClose, onSaved }: { kind: "customer" | "lead"; initial?: { id: string; name: string; phone: string; email: string; company: string; address: string; source: string; ownerId: string; tags: string[]; prefs: Record<string, string>; consents: { sms: boolean; email: boolean; whatsapp: boolean; call: boolean }; notes?: string }; onClose: () => void; onSaved: (id: string) => void }) {
  const { session } = useSession(); const s = session!; const key = useRef(rid()); const owners = useOwners(); const lead = kind === "lead";
  const [v, setV] = useState({ name: initial?.name ?? "", phone: initial?.phone ?? "", email: initial?.email ?? "", company: initial?.company ?? "", address: initial?.address ?? "", source: initial?.source ?? "", ownerId: initial?.ownerId ?? "", tags: (initial?.tags ?? []).join(", "), channel: initial?.prefs?.channel ?? "", bestTime: initial?.prefs?.bestTime ?? "", notes: initial?.notes ?? "", call: initial?.consents.call ?? false, sms: initial?.consents.sms ?? false, email2: initial?.consents.email ?? false, wa: initial?.consents.whatsapp ?? false }); const [dup, setDup] = useState(false);
  const body = (confirmDuplicate: boolean) => ({ ...(initial ? { id: initial.id } : { requestKey: key.current }), name: v.name, phone: v.phone, email: v.email, company: v.company, address: v.address, source: v.source, tags: v.tags, prefs: { channel: v.channel, bestTime: v.bestTime, language: initial?.prefs?.language ?? "", interest: initial?.prefs?.interest ?? "" }, consents: { call: v.call, sms: v.sms, email: v.email2, whatsapp: v.wa }, ...(lead ? { notes: v.notes } : {}), ...(v.ownerId && owners.data?.manager ? { ownerId: v.ownerId } : {}), ...(confirmDuplicate ? { confirmDuplicate: true } : {}) });
  const m = useMutation({ mutationFn: (c: boolean) => api<{ id: string }>(s, lead ? "crm.lead.save" : "crm.customer.save", body(c)), onSuccess: (r) => { key.current = rid(); setDup(false); onSaved(r.id); }, onError: (e) => setDup(/DOUBLON_POSSIBLE/.test((e as Error).message)) });
  return (
    <Sheet title={`${initial ? "Modifier" : lead ? "Nouveau prospect" : "Nouveau client"}`} onClose={onClose} back>
      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); m.mutate(false); }}>
        <Field label="Nom *"><input className="input" aria-label="Nom" required maxLength={160} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2"><Field label="Téléphone"><input className="input" aria-label="Téléphone" inputMode="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field><Field label="E-mail"><input className="input" aria-label="E-mail" inputMode="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field></div>
        <Field label="Entreprise"><input className="input" aria-label="Entreprise" maxLength={160} value={v.company} onChange={(e) => setV({ ...v, company: e.target.value })} /></Field>
        <Field label="Adresse"><input className="input" aria-label="Adresse" maxLength={240} value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2"><Field label="Origine"><select className="input" aria-label="Origine du contact" value={v.source} onChange={(e) => setV({ ...v, source: e.target.value })}><option value="">Non renseignée</option>{Object.entries(SOURCES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Canal préféré"><select className="input" aria-label="Canal préféré" value={v.channel} onChange={(e) => setV({ ...v, channel: e.target.value })}><option value="">Aucun</option><option value="call">Appel</option><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="email">E-mail</option></select></Field></div>
        {owners.data?.manager && <Field label="Responsable"><select className="input" aria-label="Responsable" value={v.ownerId} onChange={(e) => setV({ ...v, ownerId: e.target.value })}><option value="">{initial ? "Inchangé" : "Moi"}</option>{owners.data.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>}
        <Field label="Meilleur moment pour le joindre"><input className="input" aria-label="Meilleur moment" maxLength={40} placeholder="ex. après 17 h" value={v.bestTime} onChange={(e) => setV({ ...v, bestTime: e.target.value })} /></Field>
        <Field label="Étiquettes (séparées par des virgules)"><input className="input" aria-label="Étiquettes" value={v.tags} onChange={(e) => setV({ ...v, tags: e.target.value })} /></Field>
        {lead && <Field label="Besoin, notes"><textarea className="input" rows={3} aria-label="Notes du prospect" maxLength={1000} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>}
        <fieldset className="card flex flex-col gap-1"><legend className="text-xs text-white/60 px-1">Consentements de communication (recueillis auprès de la personne)</legend>
          <label className="text-sm flex gap-2"><input type="checkbox" aria-label="Consentement appel" checked={v.call} onChange={(e) => setV({ ...v, call: e.target.checked })} />Appel téléphonique</label><label className="text-sm flex gap-2"><input type="checkbox" aria-label="Consentement WhatsApp" checked={v.wa} onChange={(e) => setV({ ...v, wa: e.target.checked })} />WhatsApp</label><label className="text-sm flex gap-2"><input type="checkbox" aria-label="Consentement SMS" checked={v.sms} onChange={(e) => setV({ ...v, sms: e.target.checked })} />SMS</label><label className="text-sm flex gap-2"><input type="checkbox" aria-label="Consentement e-mail" checked={v.email2} onChange={(e) => setV({ ...v, email2: e.target.checked })} />E-mail</label></fieldset>
        <Err e={m.error} />
        {dup && <button type="button" className="btn-ghost" disabled={m.isPending} onClick={() => m.mutate(true)}>C'est une autre personne : enregistrer quand même</button>}
        <button className="btn" disabled={m.isPending || v.name.trim().length < 2}>Enregistrer</button>
      </form>
    </Sheet>
  );
}

// ------------------------------------------------------------------ notes, relances
function NoteForm({ target, onClose, onSaved }: { target: { customerId?: string; leadId?: string; oppId?: string }; onClose: () => void; onSaved: () => void }) {
  const { session } = useSession(); const s = session!; const key = useRef(rid()); const [kind, setKind] = useState("note"); const [text, setText] = useState("");
  const m = useMutation({ mutationFn: () => api(s, "crm.note", { requestKey: key.current, ...target, kind, text }), onSuccess: () => { key.current = rid(); onSaved(); } });
  return (
    <Sheet title="Ajouter une note" onClose={onClose} back>
      <Field label="Type d'interaction"><select className="input" aria-label="Type d'interaction" value={kind} onChange={(e) => setKind(e.target.value)}><option value="note">Note</option><option value="call">Appel</option><option value="meeting">Rendez-vous</option><option value="whatsapp">WhatsApp</option><option value="email">E-mail</option></select></Field>
      <Field label="Contenu"><textarea className="input" rows={4} aria-label="Contenu de la note" maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      <p className="text-xs text-white/50">La note est datée, signée et ne peut plus être modifiée ni supprimée.</p><Err e={m.error} /><button className="btn" disabled={m.isPending || text.trim().length < 2} onClick={() => m.mutate()}>Enregistrer la note</button>
    </Sheet>
  );
}
function PartyPicker({ value, onChange, allowOpp }: { value: Party | null; onChange: (p: Party | null) => void; allowOpp?: boolean }) {
  const { session } = useSession(); const s = session!; const [q, setQ] = useState(""); void allowOpp;
  const cs = useQuery({ queryKey: ["crm", "pick-c", s.shopId, q], enabled: q.trim().length >= 2, queryFn: () => api<CustList>(s, "crm.customers", { q, limit: 5 }) }); const ls = useQuery({ queryKey: ["crm", "pick-l", s.shopId, q], enabled: q.trim().length >= 2, queryFn: () => api<{ leads: Lead[] }>(s, "crm.leads", { q, limit: 5 }) });
  if (value) return <div className="card flex justify-between items-center text-sm"><span>{value.kind === "customer" ? "Client" : "Prospect"} : <b>{value.name}</b></span><button type="button" className="text-[var(--gold)]" onClick={() => onChange(null)}>Changer</button></div>;
  return <div className="flex flex-col gap-1"><input className="input" aria-label="Rechercher un client ou un prospect" placeholder="Rechercher un client ou un prospect (2 lettres)" value={q} onChange={(e) => setQ(e.target.value)} />
    {(cs.data?.customers ?? []).map((c) => <button type="button" key={c.id} className="card text-left text-sm" onClick={() => onChange({ kind: "customer", id: c.id, name: c.name })}>Client · {c.name}</button>)}{(ls.data?.leads ?? []).filter((l) => l.stage !== "won" && l.stage !== "lost").map((l) => <button type="button" key={l.id} className="card text-left text-sm" onClick={() => onChange({ kind: "lead", id: l.id, name: l.name })}>Prospect · {l.name}</button>)}</div>;
}
function TaskForm({ title, initial, onClose, onSaved, edit }: { title: string; initial: { kind: string; title: string; party: Party | null; dueAt?: string; notes?: string; ownerId?: string }; onClose: () => void; onSaved: () => void; edit?: string }) {
  const { session } = useSession(); const s = session!; const qc = useQueryClient(); const key = useRef(rid()); const owners = useOwners(); const [v, setV] = useState({ kind: initial.kind, title: initial.title, due: initial.dueAt ? localInput(new Date(initial.dueAt)) : localInput(), notes: initial.notes ?? "", ownerId: initial.ownerId ?? "" }); const [party, setParty] = useState<Party | null>(initial.party);
  const m = useMutation({ mutationFn: () => api(s, "crm.task.save", { ...(edit ? { id: edit } : { requestKey: key.current, ...(party ? (party.kind === "customer" ? { customerId: party.id } : { leadId: party.id }) : {}) }), kind: v.kind, title: v.title, dueAt: new Date(v.due).toISOString(), notes: v.notes, ...(v.ownerId && owners.data?.manager ? { ownerId: v.ownerId } : {}) }), onSuccess: () => { key.current = rid(); void qc.invalidateQueries({ queryKey: ["crm"] }); onSaved(); } });
  return (
    <Sheet title={title} onClose={onClose} back>
      <div className="grid grid-cols-2 gap-2"><Field label="Type"><select className="input" aria-label="Type d'élément d'agenda" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>{Object.entries(TASK_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field><Field label="Échéance"><input className="input" type="datetime-local" aria-label="Échéance" value={v.due} onChange={(e) => setV({ ...v, due: e.target.value })} /></Field></div>
      <Field label="Intitulé"><input className="input" aria-label="Intitulé" maxLength={200} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
      {!edit && <PartyPicker value={party} onChange={setParty} />}
      {owners.data?.manager && <Field label="Responsable"><select className="input" aria-label="Responsable de la relance" value={v.ownerId} onChange={(e) => setV({ ...v, ownerId: e.target.value })}><option value="">Moi</option>{owners.data.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>}
      <Field label="Notes"><textarea className="input" rows={3} aria-label="Notes de la relance" maxLength={1000} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      <Err e={m.error} /><button className="btn" disabled={m.isPending || v.title.trim().length < 2 || !v.due} onClick={() => m.mutate()}>{edit ? "Enregistrer" : "Planifier"}</button>
    </Sheet>
  );
}
function TaskRow({ t, onChanged, showParty }: { t: Task; onChanged: () => void; showParty?: boolean }) {
  const { session } = useSession(); const s = session!; const [mode, setMode] = useState<"" | "done" | "cancel" | "edit">(""); const [text, setText] = useState(""); const [next, setNext] = useState(false); const [nd, setNd] = useState(localInput(new Date(Date.now() + 7 * 864e5)));
  const done = useMutation({ mutationFn: () => api(s, "crm.task.done", { id: t.id, outcome: text, ...(next ? { next: { kind: t.kind === "followup" ? "followup" : "call", title: `Relance : ${t.title}`.slice(0, 200), dueAt: new Date(nd).toISOString() } } : {}) }), onSuccess: () => { setMode(""); onChanged(); } });
  const cancel = useMutation({ mutationFn: () => api(s, "crm.task.cancel", { id: t.id, reason: text }), onSuccess: () => { setMode(""); onChanged(); } });
  return (
    <li className="card flex flex-col gap-1">
      <div className="flex justify-between gap-2"><b className="text-sm">{t.kindLabel} · {t.title}</b><span className={`text-xs shrink-0 ${t.status === "done" ? "text-emerald-300" : t.status === "cancelled" ? "text-white/40" : t.overdue ? "text-red-300" : "text-amber-300"}`}>{t.status === "done" ? "Faite" : t.status === "cancelled" ? "Annulée" : t.overdue ? "En retard" : "À faire"}</span></div>
      <span className="text-xs text-white/60">{fmtAt(t.dueAt)}{showParty && t.party ? ` · ${t.party}` : ""} · responsable {t.owner || "—"} · créée par {t.createdBy || "—"} le {fmtDay(t.createdAt)}</span>
      {t.notes && <span className="text-xs text-white/60">{t.notes}</span>}{t.status !== "open" && <span className="text-xs text-white/50">{t.status === "done" ? "Faite" : "Annulée"} par {t.doneBy || "—"} le {fmtAt(t.doneAt)}{t.outcome ? ` — « ${t.outcome} »` : ""}</span>}
      {t.status === "open" && <div className="flex gap-2 flex-wrap"><button className="btn-ghost !py-1 !px-3 text-sm" onClick={() => setMode("done")}>Faite</button><button className="btn-ghost !py-1 !px-3 text-sm" onClick={() => setMode("edit")}>Modifier</button><button className="btn-ghost !py-1 !px-3 text-sm" onClick={() => setMode("cancel")}>Annuler</button></div>}
      {mode === "done" && <div className="flex flex-col gap-1 border-t border-[var(--line)] pt-1"><input className="input" aria-label="Résultat" maxLength={300} placeholder="Résultat (ce qui a été dit ou décidé)" value={text} onChange={(e) => setText(e.target.value)} /><label className="text-sm flex gap-2"><input type="checkbox" checked={next} onChange={(e) => setNext(e.target.checked)} />Planifier une relance suivante</label>{next && <input className="input" type="datetime-local" aria-label="Date de la relance suivante" value={nd} onChange={(e) => setNd(e.target.value)} />}<Err e={done.error} /><button className="btn !py-2" disabled={done.isPending} onClick={() => done.mutate()}>Marquer comme faite</button></div>}
      {mode === "cancel" && <div className="flex flex-col gap-1 border-t border-[var(--line)] pt-1"><input className="input" aria-label="Motif d'annulation" maxLength={300} placeholder="Motif obligatoire" value={text} onChange={(e) => setText(e.target.value)} /><Err e={cancel.error} /><button className="btn !py-2" disabled={cancel.isPending || text.trim().length < 3} onClick={() => cancel.mutate()}>Annuler cette relance</button></div>}
      {mode === "edit" && <TaskForm title="Modifier" edit={t.id} initial={{ kind: t.kind, title: t.title, party: null, dueAt: t.dueAt, notes: t.notes, ownerId: t.ownerId }} onClose={() => setMode("")} onSaved={() => { setMode(""); onChanged(); }} />}
    </li>
  );
}
function TaskList({ tasks, onChanged }: { tasks: Task[]; onChanged: () => void }) {
  return <section className="flex flex-col gap-1"><h3 className="text-sm font-semibold">Relances et rendez-vous</h3>{tasks.length === 0 && <p className="text-xs text-white/50">Aucune relance planifiée.</p>}<ul className="flex flex-col gap-2">{tasks.map((t) => <TaskRow key={t.id} t={t} onChanged={onChanged} />)}</ul></section>;
}

// ------------------------------------------------------------------ prospects
function Leads() {
  const { session } = useSession(); const s = session!; const [f, setF] = useState({ q: "", stage: "", mine: false }); const [open, setOpen] = useState<string | null>(null); const [form, setForm] = useState(false);
  const q = useQuery({ queryKey: ["crm", "leads", s.shopId, f], retry: 1, placeholderData: (p) => p, queryFn: () => api<{ leads: Lead[]; total: number; counts: Record<string, number> }>(s, "crm.leads", { q: f.q || undefined, stage: f.stage || undefined, owner: f.mine ? "mine" : undefined }) }); const d = q.data;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2"><input aria-label="Rechercher un prospect" className="input" placeholder="Nom, téléphone, entreprise" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /><button className="btn !px-3" aria-label="Nouveau prospect" onClick={() => setForm(true)}><Plus /></button></div>
      <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Étapes du pipeline"><button className="chip" aria-current={f.stage === ""} onClick={() => setF({ ...f, stage: "" })}>Toutes</button>{STAGES.map((k) => <button key={k} className="chip" aria-current={f.stage === k} onClick={() => setF({ ...f, stage: k })}>{STAGE_LABEL[k]}{d ? ` (${d.counts[k] ?? 0})` : ""}</button>)}</div>
      <label className="text-sm flex gap-2"><input type="checkbox" checked={f.mine} onChange={(e) => setF({ ...f, mine: e.target.checked })} />Mes prospects</label>
      {q.isLoading && <p className="text-sm text-white/60" role="status">Chargement…</p>}<Err e={q.error} />
      {d && d.total === 0 && <p className="card text-sm text-white/70">{f.q || f.stage || f.mine ? "Aucun prospect ne correspond." : "Aucun prospect. Un prospect n'est pas un client : il le devient seulement quand vous le convertissez après une vraie vente ou un accord."}</p>}
      <ul className="flex flex-col gap-2">{(d?.leads ?? []).map((l) => <li key={l.id}><button className="card w-full text-left flex justify-between gap-2" onClick={() => setOpen(l.id)}><span className="min-w-0"><span className="block truncate font-medium">{l.name}{l.company ? ` · ${l.company}` : ""}</span><span className="block text-xs text-white/50 truncate">{l.phone || l.email || "Sans contact"}{l.owner ? ` · ${l.owner}` : ""}{l.source ? ` · ${SOURCES[l.source] ?? l.source}` : ""}</span></span><span className={`text-xs shrink-0 ${l.stage === "lost" ? "text-red-300" : l.stage === "won" ? "text-emerald-300" : "text-amber-300"}`}>{l.stageLabel}{l.openValue ? <span className="block text-white/60">{formatFcfa(l.openValue)}</span> : null}</span></button></li>)}</ul>
      {open && <LeadSheet id={open} onClose={() => setOpen(null)} />}
      {form && <PartyForm kind="lead" onClose={() => setForm(false)} onSaved={(id) => { setForm(false); setOpen(id); }} />}
    </div>
  );
}
function LeadSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { session } = useSession(); const s = session!; const pro = planAllows(useSubscription().data?.entitlement.plan.id, "crmPro"); const qc = useQueryClient(); const q = useQuery({ queryKey: ["crm", "lead1", s.shopId, id], retry: 1, queryFn: () => api<LeadFull>(s, "crm.lead", { id }) }); const l = q.data; const [mode, setMode] = useState<"" | "edit" | "note" | "task" | "opp" | "lost" | "convert">(""); const [reason, setReason] = useState("");
  const refresh = () => { setMode(""); void qc.invalidateQueries({ queryKey: ["crm"] }); };
  const stage = useMutation({ mutationFn: (v: { stage: Stage; reason?: string }) => api(s, "crm.lead.stage", { id, ...v }), onSuccess: refresh });
  const arch = useMutation({ mutationFn: (a: boolean) => api(s, "crm.lead.archive", { id, archived: a }), onSuccess: () => { refresh(); onClose(); } });
  const open = l && l.stage !== "won" && l.stage !== "lost";
  return (
    <Sheet title={l?.name ?? "Prospect"} onClose={onClose} back>
      {q.isLoading && <p className="text-sm text-white/60" role="status">Chargement…</p>}<Err e={q.error} />
      {l && <>
        <div className="card flex flex-col gap-1 text-sm"><span className="font-semibold text-amber-300">{l.stageLabel}</span><span className="text-white/70">{l.company && `${l.company} · `}{l.phone || "Sans téléphone"}{l.email ? ` · ${l.email}` : ""}</span>{l.address && <span className="text-xs text-white/60">{l.address}</span>}<span className="text-xs text-white/50">{l.source ? `Origine : ${SOURCES[l.source] ?? l.source} · ` : ""}{l.owner ? `Responsable : ${l.owner} · ` : ""}créé le {fmtDay(l.createdAt)}{l.createdBy ? ` par ${l.createdBy}` : ""}</span>{l.notes && <span className="text-sm">{l.notes}</span>}{l.lostReason && <span className="text-xs text-red-300">Perdu : {l.lostReason}</span>}{l.customerId && <span className="text-xs text-emerald-300">Converti en client le {fmtDay(l.convertedAt)}</span>}</div>
        <ContactBar phone={l.phone} email={l.email} consents={l.consents} />
        {open && <Field label="Étape du pipeline"><select className="input" aria-label="Étape du prospect" value={l.stage} onChange={(e) => (e.target.value === "lost" ? setMode("lost") : stage.mutate({ stage: e.target.value as Stage }))}>{OPEN_STAGES.map((k) => <option key={k} value={k}>{STAGE_LABEL[k]} (≈ {STAGE_PROB[k]} %)</option>)}<option value="lost">Perdu…</option></select></Field>}
        <Err e={stage.error ?? arch.error} />
        <div className="grid grid-cols-2 gap-2">{open && <button className="btn-ghost" onClick={() => setMode("edit")}>Modifier</button>}<button className="btn-ghost" onClick={() => setMode("note")}>Ajouter une note</button>{open && <button className="btn-ghost" onClick={() => setMode("task")}>Planifier une relance</button>}{open && l.canManage && <button className="btn-ghost" onClick={() => setMode("opp")}>Nouvelle opportunité</button>}
          {open && <button className="btn col-span-2" onClick={() => setMode("convert")}>Convertir en client</button>}{l.stage === "lost" && l.canManage && <button className="btn-ghost col-span-2" onClick={() => stage.mutate({ stage: "new" })}>Rouvrir le prospect</button>}{l.canManage && <button className="btn-ghost col-span-2" onClick={() => arch.mutate(!l.archived)}>{l.archived ? "Désarchiver" : "Archiver"}</button>}</div>
        {pro && <ProInsight leadId={l.id} />}
        <TaskList tasks={l.tasks} onChanged={refresh} />
        {l.opps.length > 0 && <section className="flex flex-col gap-1"><h3 className="text-sm font-semibold">Opportunités</h3>{l.opps.map((o) => <p key={o.id} className="text-xs text-white/70 border-t border-[var(--line)] pt-1">{o.title} · {o.stageLabel} · {formatFcfa(o.value)} ({o.probability} %)</p>)}</section>}
        <Timeline items={l.timeline} />
        {mode === "edit" && <PartyForm kind="lead" initial={l} onClose={() => setMode("")} onSaved={refresh} />}
        {mode === "note" && <NoteForm target={{ leadId: l.id }} onClose={() => setMode("")} onSaved={refresh} />}
        {mode === "task" && <TaskForm title={`Relance · ${l.name}`} initial={{ kind: "followup", title: "", party: { kind: "lead", id: l.id, name: l.name } }} onClose={() => setMode("")} onSaved={refresh} />}
        {mode === "opp" && <OppForm initial={{ party: { kind: "lead", id: l.id, name: l.name } }} onClose={() => setMode("")} onSaved={refresh} />}
        {mode === "lost" && <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-4" role="alertdialog"><div className="card w-full max-w-sm flex flex-col gap-2"><p>Marquer ce prospect comme perdu ?</p><input className="input" aria-label="Motif de perte" placeholder="Motif (obligatoire)" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} /><div className="flex gap-2"><button className="btn-ghost flex-1" onClick={() => setMode("")}>Retour</button><button className="btn flex-1" disabled={reason.trim().length < 3 || stage.isPending} onClick={() => stage.mutate({ stage: "lost", reason })}>Confirmer</button></div></div></div>}
        {mode === "convert" && <Convert lead={l} onClose={() => setMode("")} onDone={refresh} />}
      </>}
    </Sheet>
  );
}
function Convert({ lead, onClose, onDone }: { lead: Lead; onClose: () => void; onDone: () => void }) {
  const { session } = useSession(); const s = session!; const [confirm, setConfirm] = useState(false);
  const m = useMutation({ mutationFn: (b: { existingCustomerId?: string; confirmDuplicate?: boolean }) => api(s, "crm.lead.convert", { id: lead.id, ...b }), onSuccess: onDone });
  const dup = m.error && /DOUBLON_POSSIBLE/.test((m.error as Error).message); const same = useQuery({ queryKey: ["crm", "same", s.shopId, lead.id], enabled: !!dup && !!(lead.phone || lead.email), queryFn: () => api<CustList>(s, "crm.customers", { q: lead.phone || lead.email, limit: 5 }) });
  return (
    <Sheet title="Convertir en client" onClose={onClose} back>
      <p className="text-sm text-white/80">Un prospect devient client par une <b>action réelle</b> : accord, vente ou commande. La fiche client est créée une seule fois avec ses informations, ses opportunités, ses relances et son historique.</p>
      <Err e={m.error} />
      {dup && <>{(same.data?.customers ?? []).map((c) => <button key={c.id} className="btn-ghost" disabled={m.isPending} onClick={() => m.mutate({ existingCustomerId: c.id })}>Rattacher au client existant : {c.name}</button>)}<button className="btn-ghost" disabled={m.isPending} onClick={() => m.mutate({ confirmDuplicate: true })}>C'est une autre personne : créer un nouveau client</button></>}
      {!dup && <button className="btn" disabled={m.isPending} onClick={() => setConfirm(true)}>Convertir {lead.name} en client</button>}
      {confirm && <Confirm text={`Convertir ${lead.name} en client ? Cette action est définitive.`} confirmLabel="Convertir" onNo={() => setConfirm(false)} onYes={() => { setConfirm(false); m.mutate({}); }} />}
    </Sheet>
  );
}

// ------------------------------------------------------------------ opportunités
function OppForm({ initial, onClose, onSaved, edit }: { initial: { party: Party | null; opp?: Opp }; onClose: () => void; onSaved: () => void; edit?: Opp }) {
  const { session } = useSession(); const s = session!; const key = useRef(rid()); const owners = useOwners(); const o = edit ?? initial.opp; const [party, setParty] = useState<Party | null>(initial.party);
  const [v, setV] = useState({ title: o?.title ?? "", value: o ? String(o.value) : "", stage: (o?.stage ?? "qualified") as Stage, prob: o ? String(o.probability) : String(STAGE_PROB.qualified), dueOn: o?.dueOn ?? "", nextAction: o?.nextAction ?? "", nextActionOn: o?.nextActionOn ?? "", ownerId: o?.ownerId ?? "", notes: o?.notes ?? "" });
  const m = useMutation({ mutationFn: () => api(s, "crm.opp.save", { ...(edit ? { id: edit.id } : { requestKey: key.current, stage: v.stage, ...(party ? (party.kind === "customer" ? { customerId: party.id } : { leadId: party.id }) : {}) }), title: v.title, value: v.value.replace(/\s/g, ""), probability: v.prob, dueOn: v.dueOn, nextAction: v.nextAction, nextActionOn: v.nextActionOn, notes: v.notes, ...(v.ownerId && owners.data?.manager ? { ownerId: v.ownerId } : {}) }), onSuccess: () => { key.current = rid(); onSaved(); } });
  return (
    <Sheet title={edit ? "Modifier l'opportunité" : "Nouvelle opportunité"} onClose={onClose} back>
      {!edit && <PartyPicker value={party} onChange={setParty} />}
      <Field label="Intitulé"><input className="input" aria-label="Intitulé de l'opportunité" maxLength={160} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-2"><Field label="Valeur estimée (FCFA)"><input className="input" aria-label="Valeur estimée" inputMode="numeric" value={v.value} onChange={(e) => setV({ ...v, value: e.target.value.replace(/[^\d]/g, "") })} /></Field><Field label="Probabilité (%)"><input className="input" aria-label="Probabilité" inputMode="numeric" value={v.prob} onChange={(e) => setV({ ...v, prob: e.target.value.replace(/\D/g, "") })} /></Field></div>
      {!edit && <Field label="Étape de départ"><select className="input" aria-label="Étape de départ" value={v.stage} onChange={(e) => setV({ ...v, stage: e.target.value as Stage, prob: String(STAGE_PROB[e.target.value as Stage]) })}>{(["qualified", "proposal", "negotiation"] as Stage[]).map((k) => <option key={k} value={k}>{STAGE_LABEL[k]}</option>)}</select></Field>}
      <div className="grid grid-cols-2 gap-2"><Field label="Échéance"><input className="input" type="date" aria-label="Échéance de l'opportunité" value={v.dueOn} onChange={(e) => setV({ ...v, dueOn: e.target.value })} /></Field><Field label="Prochaine action le"><input className="input" type="date" aria-label="Date de la prochaine action" value={v.nextActionOn} onChange={(e) => setV({ ...v, nextActionOn: e.target.value })} /></Field></div>
      <Field label="Prochaine action"><input className="input" aria-label="Prochaine action" maxLength={200} value={v.nextAction} onChange={(e) => setV({ ...v, nextAction: e.target.value })} /></Field>
      {owners.data?.manager && <Field label="Responsable"><select className="input" aria-label="Responsable de l'opportunité" value={v.ownerId} onChange={(e) => setV({ ...v, ownerId: e.target.value })}><option value="">{edit ? "Inchangé" : "Moi"}</option>{owners.data.owners.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>}
      <Err e={m.error} /><button className="btn" disabled={m.isPending || v.title.trim().length < 2 || (!edit && !party)} onClick={() => m.mutate()}>{edit ? "Enregistrer" : "Créer l'opportunité"}</button>
    </Sheet>
  );
}
function Opps() {
  const { session } = useSession(); const s = session!; const qc = useQueryClient(); const [f, setF] = useState({ status: "open", q: "", mine: false }); const [open, setOpen] = useState<Opp | null>(null); const [form, setForm] = useState(false);
  const q = useQuery({ queryKey: ["crm", "opps", s.shopId, f], retry: 1, placeholderData: (p) => p, queryFn: () => api<{ opportunities: Opp[]; total: number; totals: { openCount: number; openValue: number; weighted: number; overdue: number }; note: string }>(s, "crm.opps", { status: f.status || undefined, q: f.q || undefined, owner: f.mine ? "mine" : undefined }) }); const d = q.data;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2"><input aria-label="Rechercher une opportunité" className="input" placeholder="Intitulé, client ou prospect" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /><button className="btn !px-3" aria-label="Nouvelle opportunité" onClick={() => setForm(true)}><Plus /></button></div>
      <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Statut des opportunités">{([["open", "En cours"], ["won", "Gagnées"], ["lost", "Perdues"], ["", "Toutes"]] as const).map(([k, l]) => <button key={k} className="chip" aria-current={f.status === k} onClick={() => setF({ ...f, status: k })}>{l}</button>)}</div>
      <label className="text-sm flex gap-2"><input type="checkbox" checked={f.mine} onChange={(e) => setF({ ...f, mine: e.target.checked })} />Mes opportunités</label>
      {d && <div className="grid grid-cols-2 gap-2"><Kpi label="En cours" value={d.totals.openCount} hint={formatFcfa(d.totals.openValue)} /><Kpi label="Valeur pondérée" value={formatFcfa(d.totals.weighted)} hint={d.totals.overdue ? `${d.totals.overdue} en retard` : "Estimation commerciale"} tone={d.totals.overdue ? "text-amber-300" : ""} /></div>}
      {q.isLoading && <p className="text-sm text-white/60" role="status">Chargement…</p>}<Err e={q.error} />
      {d && d.total === 0 && <p className="card text-sm text-white/70">Aucune opportunité{f.status === "open" ? " en cours" : ""}. Créez-en depuis ici ou depuis la fiche d'un client ou d'un prospect.</p>}
      <ul className="flex flex-col gap-2">{(d?.opportunities ?? []).map((o) => <li key={o.id}><button className="card w-full text-left flex justify-between gap-2" onClick={() => setOpen(o)}><span className="min-w-0"><span className="block truncate font-medium">{o.title}</span><span className="block text-xs text-white/50 truncate">{o.party || "—"} · {o.owner || "—"}{o.dueOn ? ` · échéance ${fmtDay(o.dueOn)}` : ""}</span>{o.nextAction && <span className="block text-xs text-white/60 truncate">Prochaine action : {o.nextAction}{o.nextActionOn ? ` (${fmtDay(o.nextActionOn)})` : ""}</span>}</span><span className="text-right text-sm shrink-0"><span className={o.overdue ? "text-red-300" : o.stage === "won" ? "text-emerald-300" : o.stage === "lost" ? "text-white/40" : ""}>{o.stageLabel}{o.overdue ? " · en retard" : ""}</span><span className="block">{formatFcfa(o.value)}</span><span className="block text-xs text-white/50">{o.probability} % → {formatFcfa(o.weighted)}</span></span></button></li>)}</ul>
      {d && <p className="text-[11px] text-white/40">{d.note}</p>}
      {open && <OppSheet o={open} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); void qc.invalidateQueries({ queryKey: ["crm"] }); }} />}
      {form && <OppForm initial={{ party: null }} onClose={() => setForm(false)} onSaved={() => { setForm(false); void qc.invalidateQueries({ queryKey: ["crm"] }); }} />}
    </div>
  );
}
function OppSheet({ o, onClose, onChanged }: { o: Opp; onClose: () => void; onChanged: () => void }) {
  const { session } = useSession(); const s = session!; const isOpen = o.stage !== "won" && o.stage !== "lost"; const [mode, setMode] = useState<"" | "edit" | "lost" | "note" | "task">(""); const [reason, setReason] = useState(""); const [msg, setMsg] = useState("");
  const stage = useMutation({ mutationFn: (v: { stage: Stage; reason?: string }) => api<{ suggestConvert?: boolean }>(s, "crm.opp.stage", { id: o.id, ...v }), onSuccess: (r, v) => { if (r.suggestConvert && v.stage === "won") { setMsg("Opportunité gagnée. Le prospect n'est pas encore client : convertissez-le depuis sa fiche."); return; } onChanged(); } });
  return (
    <Sheet title={o.title} onClose={msg ? onChanged : onClose} back>
      <div className="card text-sm flex flex-col gap-1"><b className={o.stage === "won" ? "text-emerald-300" : o.stage === "lost" ? "text-red-300" : "text-amber-300"}>{o.stageLabel}</b><span>{o.party} · {formatFcfa(o.value)} · {o.probability} % → {formatFcfa(o.weighted)}</span><span className="text-xs text-white/60">Responsable {o.owner || "—"}{o.dueOn ? ` · échéance ${fmtDay(o.dueOn)}${o.overdue ? " (dépassée)" : ""}` : ""}</span>{o.nextAction && <span className="text-xs">Prochaine action : {o.nextAction}{o.nextActionOn ? ` le ${fmtDay(o.nextActionOn)}` : ""}</span>}{o.notes && <span className="text-xs text-white/60">{o.notes}</span>}{o.closedAt && <span className="text-xs text-white/50">Clôturée le {fmtAt(o.closedAt)}{o.closedBy ? ` par ${o.closedBy}` : ""}{o.lostReason ? ` — ${o.lostReason}` : ""}</span>}</div>
      {msg && <p className="card text-sm text-emerald-300" role="status">{msg}</p>}<Err e={stage.error} />
      {isOpen && !msg && <><Field label="Étape"><select className="input" aria-label="Étape de l'opportunité" value={o.stage} onChange={(e) => stage.mutate({ stage: e.target.value as Stage })}>{(["qualified", "proposal", "negotiation"] as Stage[]).map((k) => <option key={k} value={k}>{STAGE_LABEL[k]}</option>)}</select></Field>
        <div className="grid grid-cols-2 gap-2"><button className="btn" disabled={stage.isPending} onClick={() => stage.mutate({ stage: "won" })}>Marquer gagnée</button><button className="btn-ghost" onClick={() => setMode("lost")}>Marquer perdue</button><button className="btn-ghost" onClick={() => setMode("edit")}>Modifier</button><button className="btn-ghost" onClick={() => setMode("task")}>Planifier une relance</button><button className="btn-ghost col-span-2" onClick={() => setMode("note")}>Ajouter une note</button></div></>}
      {!isOpen && !msg && <button className="btn-ghost" disabled={stage.isPending} onClick={() => stage.mutate({ stage: "negotiation" })}>Rouvrir en négociation</button>}
      {mode === "edit" && <OppForm initial={{ party: null }} edit={o} onClose={() => setMode("")} onSaved={onChanged} />}
      {mode === "note" && <NoteForm target={{ oppId: o.id }} onClose={() => setMode("")} onSaved={() => { setMode(""); }} />}
      {mode === "task" && <TaskForm title={`Relance · ${o.title}`} initial={{ kind: "followup", title: "", party: null }} onClose={() => setMode("")} onSaved={() => setMode("")} />}
      {mode === "lost" && <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-4" role="alertdialog"><div className="card w-full max-w-sm flex flex-col gap-2"><p>Marquer cette opportunité comme perdue ?</p><input className="input" aria-label="Motif de perte de l'opportunité" placeholder="Motif (obligatoire)" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} /><div className="flex gap-2"><button className="btn-ghost flex-1" onClick={() => setMode("")}>Retour</button><button className="btn flex-1" disabled={reason.trim().length < 3 || stage.isPending} onClick={() => stage.mutate({ stage: "lost", reason })}>Confirmer</button></div></div></div>}
    </Sheet>
  );
}

// ------------------------------------------------------------------ agenda
function Agenda() {
  const { session } = useSession(); const s = session!; const qc = useQueryClient(); const owners = useOwners(); const [f, setF] = useState({ status: "open", kind: "", owner: "", overdue: false }); const [form, setForm] = useState(false);
  const q = useQuery({ queryKey: ["crm", "tasks", s.shopId, f], retry: 1, placeholderData: (p) => p, queryFn: () => api<{ tasks: Task[]; total: number; counts: { open: number; overdue: number; today: number }; scope: string }>(s, "crm.tasks", { status: f.status || undefined, kind: f.kind || undefined, owner: f.owner || undefined, overdue: f.overdue || undefined }) }); const d = q.data;
  const grouped = new Map<string, Task[]>(); for (const t of d?.tasks ?? []) { const k = t.dueAt.slice(0, 10); (grouped.get(k) ?? grouped.set(k, []).get(k)!).push(t); }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 items-center"><div className="flex gap-2 flex-1 overflow-x-auto" role="group" aria-label="Filtrer l'agenda">{([["open", "À faire"], ["done", "Faites"], ["cancelled", "Annulées"], ["", "Toutes"]] as const).map(([k, l]) => <button key={k} className="chip" aria-current={f.status === k && !f.overdue} onClick={() => setF({ ...f, status: k, overdue: false })}>{l}</button>)}<button className="chip" aria-current={f.overdue} onClick={() => setF({ ...f, status: "open", overdue: true })}>En retard{d ? ` (${d.counts.overdue})` : ""}</button></div><button className="btn !px-3" aria-label="Nouvelle relance" onClick={() => setForm(true)}><Plus /></button></div>
      <div className="grid grid-cols-2 gap-2"><select aria-label="Type" className="input !px-2 text-sm" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="">Tous types</option>{Object.entries(TASK_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {owners.data?.manager ? <select aria-label="Responsable" className="input !px-2 text-sm" value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })}><option value="">Tous les collègues</option><option value="mine">Mes éléments</option>{owners.data.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select> : <p className="text-xs text-white/50 self-center">Vos relances et celles que vous avez créées.</p>}</div>
      {q.isLoading && <p className="text-sm text-white/60" role="status">Chargement…</p>}<Err e={q.error} />
      {d && d.total === 0 && <p className="card text-sm text-white/70 flex gap-2"><CalendarClock size={16} className="shrink-0 mt-0.5" />{f.status === "open" ? "Rien à faire pour le moment. Planifiez un appel, un rendez-vous ou une relance avec « + »." : "Aucun élément ne correspond."}</p>}
      {[...grouped.entries()].map(([day, ts]) => <section key={day} className="flex flex-col gap-2"><h2 className="text-xs uppercase tracking-wide text-white/50">{day === new Date().toISOString().slice(0, 10) ? "Aujourd'hui" : fmtDay(day)}</h2><ul className="flex flex-col gap-2">{ts.map((t) => <TaskRow key={t.id} t={t} showParty onChanged={() => void qc.invalidateQueries({ queryKey: ["crm"] })} />)}</ul></section>)}
      {form && <TaskForm title="Nouvel élément d'agenda" initial={{ kind: "followup", title: "", party: null }} onClose={() => setForm(false)} onSaved={() => setForm(false)} />}
    </div>
  );
}
