import { CrmHub } from "./crm";
import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatFcfa } from "@/domain/money";
import { list, saveEntity, type Customer, type Row } from "@/lib/data";
import { api } from "@/lib/api";
import { can, useSession } from "@/lib/session";
import { CUSTOMER_CATEGORIES, categoryLabel } from "@/domain/pricing";
import { planAllows } from "@/domain/features";
import { useSubscription } from "./subscription";
import { tierFor } from "@/domain/loyalty";

/** Encaissement d'un remboursement de crédit client (espèces, Wave ou Orange) : écrit au journal, réduit la créance. */
function RepayDialog({ c, onClose, onDone }: { c: Row<Customer>; onClose: () => void; onDone: () => void }) {
  const { session } = useSession(); const s = session!; const due = c.creditBalance ?? 0;
  const repayId = useRef(crypto.randomUUID()); const [amount, setAmount] = useState(String(due)); const [method, setMethod] = useState<"cash" | "wave" | "orange">("cash"); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const n = Number(amount.replace(/\s/g, ""));
  async function go() {
    setBusy(true); setErr("");
    try { await api(s, "credit.repay", { customerId: c.$id, amount: n, method, repayId: repayId.current }); onDone(); onClose(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-end justify-center p-4" role="dialog" aria-modal="true" aria-label="Remboursement">
      <div className="card w-full max-w-sm flex flex-col gap-3">
        <b>Remboursement · {c.name}</b><p className="text-sm text-white/60">Reste dû : {formatFcfa(due)}</p>
        <input className="input" inputMode="numeric" aria-label="Montant encaissé" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
        <select className="input" aria-label="Mode de paiement" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}><option value="cash">Espèces</option><option value="wave">Wave</option><option value="orange">Orange Money</option></select>
        {err && <p className="text-red-400 text-sm" role="alert">{err}</p>}
        <div className="flex gap-2"><button className="btn-ghost flex-1" onClick={onClose}>Annuler</button><button className="btn flex-1" disabled={busy || !(n > 0) || n > due} onClick={() => void go()}>Encaisser</button></div>
      </div>
    </div>
  );
}

function Page({ title, children }: { title: string; children: ReactNode }) {
  return <div className="flex flex-col gap-3"><h1 className="text-xl font-bold">{title}</h1>{children}</div>;
}

/** Formule Business et + : CRM (clients, prospects, pipeline, agenda) ; la page de crédit et de fidélité reste disponible en onglet. */
export function ClientsPage() {
  const plan = useSubscription().data?.entitlement.plan.id;
  if (!plan || !planAllows(plan, "crm")) return <LegacyClients />;
  return <CrmHub legacy={<LegacyClients />} />;
}

function LegacyClients() {
  const { session } = useSession(); const s = session!; const qc = useQueryClient();
  const rows = useQuery({ queryKey: ["customers"], queryFn: () => list<Customer>("customers", s, [], 500) });
  const canCategory = (s.role === "owner" || s.role === "manager") && planAllows(useSubscription().data?.entitlement.plan.id, "tieredPricing");
  const [catErr, setCatErr] = useState(""); const [repay, setRepay] = useState<Row<Customer> | null>(null);
  const setCategory = useMutation({ mutationFn: ({ id, category }: { id: string; category: string }) => saveEntity(s, "customers", { category }, id), onSuccess: () => { setCatErr(""); void qc.invalidateQueries({ queryKey: ["customers"] }); }, onError: (e) => setCatErr((e as Error).message) });
  const [f, setF] = useState({ name: "", phone: "", creditLimit: "" });
  const add = useMutation({
    mutationFn: () => saveEntity(s, "customers", { name: f.name, phone: f.phone, ...(f.creditLimit ? { creditLimit: Number(f.creditLimit) } : {}) }),
    onSuccess: () => { setF({ name: "", phone: "", creditLimit: "" }); void qc.invalidateQueries({ queryKey: ["customers"] }); },
  });
  const owing = (rows.data ?? []).reduce((a, c) => a + (c.creditBalance ?? 0), 0);
  return (
    <Page title="Clients & fidélité">
      <div className="card">Créances clients : <b className="text-[var(--gold)]">{formatFcfa(owing)}</b></div>
      <form className="card flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <input aria-label="Nom" className="input" placeholder="Nom" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input aria-label="Téléphone" className="input" inputMode="tel" placeholder="Téléphone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <input aria-label="Plafond de crédit (FCFA)" className="input" inputMode="numeric" placeholder="Plafond de crédit (FCFA)" value={f.creditLimit} onChange={(e) => setF({ ...f, creditLimit: e.target.value })} />
        <button className="btn">Ajouter le client</button>
      </form>
      {catErr && <p className="text-red-400 text-sm" role="alert">{catErr}</p>}
      {(rows.data ?? []).map((c) => (
        <div key={c.$id} className="card flex justify-between">
          <div><div className="font-medium">{c.name}</div><div className="text-xs text-white/50">{c.phone} · {tierFor(c.annualSpend ?? 0)} · {c.points ?? 0} pts{c.category ? ` · ${categoryLabel(c.category)}` : ""}</div>
            {canCategory && <select aria-label={`Catégorie tarifaire de ${c.name}`} className="mt-1 rounded-lg bg-white/5 border border-white/15 px-2 py-1 text-xs" value={c.category ?? ""} onChange={(e) => setCategory.mutate({ id: c.$id, category: e.target.value })}>{CUSTOMER_CATEGORIES.map((x) => <option key={x.id} value={x.id}>Tarif {x.label.toLowerCase()}</option>)}</select>}</div>
          <div className="text-right text-sm">{(c.creditBalance ?? 0) > 0 ? <><span className="text-red-400">Doit {formatFcfa(c.creditBalance ?? 0)}</span>{can(s, "pos") && <button className="btn-ghost !py-1 !px-3 text-xs mt-1 block ml-auto" onClick={() => setRepay(c)}>Encaisser</button>}</> : "À jour"}</div>
        </div>
      ))}
    {repay && <RepayDialog c={repay} onClose={() => setRepay(null)} onDone={() => void qc.invalidateQueries()} />}
    </Page>
  );
}
