import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Lock, Printer, Ticket, TicketCheck, Wallet } from "lucide-react";
import { CaisseTabs } from "@/components/CaisseTabs";
import { KpiRow, KpiTile, ModuleHeader, StatusBadge, type StatusTone } from "@/components/kit";
import { Confirm, Sheet } from "@/components/ui";
import { planAllows } from "@/domain/features";
import { issuerOf, type DocModel } from "@/domain/documents";
import { formatFcfa } from "@/domain/money";
import { api } from "@/lib/api";
import { getShop } from "@/lib/data";
import { deliverPdf, pdfBlob } from "@/lib/pdf";
import { useSession } from "@/lib/session";
import { useSubscription } from "./subscription";

type V = { code: string; initial: number; balance: number; uses: number; state: string; expiresAt: string; createdAt: string; customer: string; ref: string };
type Detail = { code: string; initial: number; balance: number; state: string; expiresAt: string; createdAt: string; origin: string; customer: string; history: { at: string; amount: number; kind: "used" | "restored"; sale: string }[] };
const STATE: Record<string, { l: string; t: StatusTone }> = { active: { l: "Actif", t: "ok" }, spent: { l: "Épuisé", t: "muted" }, expired: { l: "Expiré", t: "warn" }, disabled: { l: "Désactivé", t: "bad" } };
const d10 = (iso: string) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "—");

/** Avoirs (bons d'achat, caisse Pro) : solde réel calculé par le serveur, historique des utilisations et des montants rendus, réimpression, désactivation motivée et tracée. */
export function AvoirsPage() {
  const { session } = useSession(); const s = session!; const plan = useSubscription().data?.entitlement.plan.id; const pro = planAllows(plan, "smartPosPro"); const manager = s.role === "owner" || s.role === "manager";
  const [state, setState] = useState(""); const [q, setQ] = useState(""); const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["vouchers", s.shopId], enabled: pro && manager, retry: 1, queryFn: () => api<{ vouchers: V[]; totals: { count: number; active: number; outstanding: number } }>(s, "voucher.list", {}) });
  const shown = useMemo(() => (list.data?.vouchers ?? []).filter((v) => (!state || v.state === state) && (!q.trim() || `${v.code} ${v.customer}`.toUpperCase().includes(q.trim().toUpperCase()))), [list.data, state, q]);
  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const v of list.data?.vouchers ?? []) c[v.state] = (c[v.state] ?? 0) + 1; return c; }, [list.data]);
  if (!pro || !manager) return <div className="flex flex-col gap-3"><h1 className="text-2xl font-bold">Avoirs</h1><div className="card flex flex-col gap-2 text-sm"><span className="flex items-center gap-2 font-semibold"><Lock size={16} className="text-accent-text" />{pro ? "Réservé au gérant" : "Réservé à la formule Pro"}</span><span className="text-muted">Suivi des avoirs émis : solde, utilisations, réimpression et désactivation.</span></div></div>;
  return (
    <div className="flex flex-col gap-3">
      <ModuleHeader icon={Ticket} title="Avoirs" subtitle="Bons d'achat émis par la boutique : solde, utilisations et montants rendus." />
      <CaisseTabs current="/avoirs" />
      <KpiRow cols={4}>
        <KpiTile icon={TicketCheck} tint="green" label="Avoirs actifs" value={list.data?.totals.active ?? "—"} loading={list.isLoading} />
        <KpiTile icon={Wallet} tint="amber" label="Encours à honorer" value={list.data ? formatFcfa(list.data.totals.outstanding) : "—"} sub="somme des soldes actifs" loading={list.isLoading} />
        <KpiTile icon={Ticket} tint="blue" label="Avoirs émis" value={list.data?.totals.count ?? "—"} loading={list.isLoading} />
        <KpiTile icon={Ban} tint="rose" label="Désactivés / expirés" value={list.data ? (counts.disabled ?? 0) + (counts.expired ?? 0) : "—"} loading={list.isLoading} />
      </KpiRow>
      <nav aria-label="État des avoirs" className="scroll-x">{([["", "Tous", list.data?.vouchers.length ?? 0], ["active", "Actifs", counts.active ?? 0], ["spent", "Épuisés", counts.spent ?? 0], ["expired", "Expirés", counts.expired ?? 0], ["disabled", "Désactivés", counts.disabled ?? 0]] as const).map(([k, l, n]) => <button key={k} className="chip" aria-current={state === k} onClick={() => setState(k)}>{l} ({n})</button>)}</nav>
      <input className="input" aria-label="Rechercher un avoir" placeholder="Code de l'avoir ou client" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.error && <p className="text-bad text-sm" role="alert">{(list.error as Error).message} <button className="underline" onClick={() => void list.refetch()}>Réessayer</button></p>}
      {list.isLoading && <div className="card h-16 animate-pulse bg-subtle" aria-busy="true" />}
      {list.data && !shown.length && <p className="text-center text-muted text-sm py-6">{list.data.vouchers.length ? "Aucun avoir pour ce filtre." : "Aucun avoir émis : un avoir se crée lors d'un retour remboursé « Nouvel avoir »."}</p>}
      {shown.map((v) => <button key={v.code} className="card text-left flex justify-between gap-2" onClick={() => setOpen(v.code)}>
        <span className="min-w-0"><b className="font-mono">{v.code}</b><span className="text-xs text-muted block truncate">{v.customer || "Non nominatif"} · émis le {d10(v.createdAt)} · {v.uses} utilisation(s)</span><span className="text-xs text-muted">Valable jusqu'au {d10(v.expiresAt)}</span></span>
        <span className="text-right shrink-0"><b>{formatFcfa(v.balance)}</b><span className="block text-xs text-muted">sur {formatFcfa(v.initial)}</span><StatusBadge tone={STATE[v.state]?.t ?? "muted"}>{STATE[v.state]?.l ?? v.state}</StatusBadge></span>
      </button>)}
      {open && <VoucherSheet code={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function VoucherSheet({ code, onClose }: { code: string; onClose: () => void }) {
  const { session } = useSession(); const s = session!; const qc = useQueryClient(); const [why, setWhy] = useState(""); const [ask, setAsk] = useState(false); const [busy, setBusy] = useState(""); const [perr, setPerr] = useState("");
  const d = useQuery({ queryKey: ["voucher", code], retry: 1, queryFn: () => api<Detail>(s, "voucher.get", { code }) }); const shop = useQuery({ queryKey: ["shop"], queryFn: () => getShop(s), staleTime: 300_000 });
  const off = useMutation({ mutationFn: () => api(s, "voucher.disable", { code, reason: why.trim() }), onSuccess: () => { setAsk(false); void qc.invalidateQueries({ queryKey: ["voucher", code] }); void qc.invalidateQueries({ queryKey: ["vouchers"] }); }, onError: () => setAsk(false) });
  async function print(w: 58 | 80) {
    if (!d.data) return; setBusy(String(w)); setPerr("");
    try { const x = d.data; const m: DocModel = { kind: "receipt", title: "AVOIR - BON D'ACHAT", number: x.code, date: new Date().toLocaleString("fr-FR"), issuer: issuerOf(shop.data ?? null), partyLabel: "Titulaire", party: { name: x.customer || "Non nominatif" }, rows: [], totals: [{ label: "SOLDE DISPONIBLE", value: x.balance, strong: true }, { label: "Montant initial", value: x.initial }], qr: x.code, footer: [`Code : ${x.code}`, `Valable jusqu'au ${d10(x.expiresAt)}`, ...(x.customer ? ["Avoir nominatif : présenter une pièce ou le compte client"] : []), "Solde vérifié par la caisse à chaque utilisation"] };
      await deliverPdf(await pdfBlob(m, w), `${x.code}-${w}mm.pdf`); } catch (e) { setPerr((e as Error).message); } finally { setBusy(""); }
  }
  const x = d.data;
  return (
    <Sheet title={`Avoir ${code}`} onClose={onClose} back>
      {d.isLoading && <div className="card h-24 animate-pulse bg-subtle" />}{d.error && <p className="text-bad text-sm" role="alert">{(d.error as Error).message}</p>}
      {x && <>
        <div className="card flex flex-col gap-1 text-sm">
          <div className="flex justify-between"><span className="text-muted">État</span><StatusBadge tone={STATE[x.state]?.t ?? "muted"}>{STATE[x.state]?.l ?? x.state}</StatusBadge></div>
          <div className="flex justify-between font-semibold"><span>Solde disponible</span><span>{formatFcfa(x.balance)}</span></div>
          <div className="flex justify-between"><span className="text-muted">Montant initial</span><span>{formatFcfa(x.initial)}</span></div>
          <div className="flex justify-between"><span className="text-muted">Titulaire</span><span>{x.customer || "Non nominatif"}</span></div>
          <div className="flex justify-between"><span className="text-muted">Émis le</span><span>{d10(x.createdAt)}{x.origin ? ` · vente ${x.origin}` : ""}</span></div>
          <div className="flex justify-between"><span className="text-muted">Valable jusqu'au</span><span>{d10(x.expiresAt)}</span></div>
        </div>
        <h3 className="font-semibold text-sm">Historique</h3>
        {!x.history.length && <p className="text-sm text-muted">Pas encore utilisé.</p>}
        {x.history.map((h, i) => <div key={i} className="flex justify-between gap-2 text-sm border-t border-[var(--line)] pt-1"><span>{h.kind === "used" ? "Utilisé" : "Rendu (retour)"}{h.sale ? ` · vente ${h.sale}` : ""}<span className="block text-xs text-muted">{h.at ? new Date(h.at).toLocaleString("fr-FR") : ""}</span></span><b className={h.kind === "used" ? "text-warn" : "text-ok"}>{h.kind === "used" ? "−" : "+"}{formatFcfa(Math.abs(h.amount))}</b></div>)}
        <div className="grid grid-cols-2 gap-2">{([80, 58] as const).map((w) => <button key={w} className="btn-ghost text-sm flex items-center justify-center gap-1" disabled={!!busy} onClick={() => void print(w)}><Printer size={14} />{busy === String(w) ? "…" : `Réimprimer ${w} mm`}</button>)}</div>
        {perr && <p className="text-bad text-sm" role="alert">{perr}</p>}
        {x.state === "active" && <div className="card flex flex-col gap-2"><b className="text-sm">Désactiver l'avoir</b><span className="text-xs text-muted">Le solde ne pourra plus être utilisé. Opération tracée dans le journal.</span>
          <input className="input" aria-label="Motif de la désactivation" placeholder="Motif (obligatoire)" maxLength={200} value={why} onChange={(e) => setWhy(e.target.value)} />
          {off.error && <p className="text-bad text-sm" role="alert">{(off.error as Error).message}</p>}
          <button className="btn-ghost !text-bad" disabled={why.trim().length < 3 || off.isPending} onClick={() => setAsk(true)}>Désactiver</button></div>}
        {ask && <Confirm danger text={`Désactiver l'avoir ${x.code} (solde ${formatFcfa(x.balance)}) ?`} confirmLabel="Désactiver" onNo={() => setAsk(false)} onYes={() => off.mutate()} />}
      </>}
    </Sheet>
  );
}
