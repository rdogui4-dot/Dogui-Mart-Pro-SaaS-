import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatFcfa } from "@/domain/money";
import { create, list, type Customer, type Supplier } from "@/lib/data";
import { useSession } from "@/lib/session";
import { tierFor } from "@/domain/loyalty";

function Page({ title, children }: { title: string; children: ReactNode }) {
  return <div className="flex flex-col gap-3"><h1 className="text-xl font-bold">{title}</h1>{children}</div>;
}

export function ClientsPage() {
  const { session } = useSession(); const s = session!; const qc = useQueryClient();
  const rows = useQuery({ queryKey: ["customers"], queryFn: () => list<Customer>("customers", s, [], 500) });
  const [f, setF] = useState({ name: "", phone: "", creditLimit: "" });
  const add = useMutation({
    mutationFn: () => create("customers", s, { name: f.name, phone: f.phone, creditLimit: Number(f.creditLimit) || 0, creditBalance: 0, points: 0, annualSpend: 0 }),
    onSuccess: () => { setF({ name: "", phone: "", creditLimit: "" }); void qc.invalidateQueries({ queryKey: ["customers"] }); },
  });
  const owing = (rows.data ?? []).reduce((a, c) => a + (c.creditBalance ?? 0), 0);
  return (
    <Page title="Clients & fidélité">
      <div className="card">Créances clients : <b className="text-[var(--gold)]">{formatFcfa(owing)}</b></div>
      <form className="card flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <input className="input" placeholder="Nom" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input className="input" inputMode="tel" placeholder="Téléphone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <input className="input" inputMode="numeric" placeholder="Plafond de crédit (FCFA)" value={f.creditLimit} onChange={(e) => setF({ ...f, creditLimit: e.target.value })} />
        <button className="btn">Ajouter le client</button>
      </form>
      {(rows.data ?? []).map((c) => (
        <div key={c.$id} className="card flex justify-between">
          <div><div className="font-medium">{c.name}</div><div className="text-xs text-white/50">{c.phone} · {tierFor(c.annualSpend ?? 0)} · {c.points ?? 0} pts</div></div>
          <div className="text-right text-sm">{(c.creditBalance ?? 0) > 0 ? <span className="text-red-400">Doit {formatFcfa(c.creditBalance ?? 0)}</span> : "À jour"}</div>
        </div>
      ))}
    </Page>
  );
}

export function AchatsPage() {
  const { session } = useSession(); const s = session!; const qc = useQueryClient();
  const rows = useQuery({ queryKey: ["suppliers"], queryFn: () => list<Supplier>("suppliers", s, [], 500) });
  const [f, setF] = useState({ name: "", phone: "" });
  const add = useMutation({
    mutationFn: () => create("suppliers", s, { name: f.name, phone: f.phone, balance: 0 }),
    onSuccess: () => { setF({ name: "", phone: "" }); void qc.invalidateQueries({ queryKey: ["suppliers"] }); },
  });
  return (
    <Page title="Achats & fournisseurs">
      <form className="card flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <input className="input" placeholder="Fournisseur" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input className="input" inputMode="tel" placeholder="Téléphone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <button className="btn">Ajouter le fournisseur</button>
      </form>
      {(rows.data ?? []).map((x) => <div key={x.$id} className="card flex justify-between"><span>{x.name}</span><span className="text-white/50">{x.phone}</span></div>)}
      <p className="text-xs text-white/40">Bons de commande et réception : prochaine étape (voir ROADMAP.md).</p>
    </Page>
  );
}
