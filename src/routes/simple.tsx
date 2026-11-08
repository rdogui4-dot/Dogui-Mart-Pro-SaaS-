import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatFcfa } from "@/domain/money";
import { list, saveEntity, type Customer } from "@/lib/data";
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
    mutationFn: () => saveEntity(s, "customers", { name: f.name, phone: f.phone, ...(f.creditLimit ? { creditLimit: Number(f.creditLimit) } : {}) }),
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
