import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatFcfa } from "@/domain/money";
import { list, saveEntity, type Customer } from "@/lib/data";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { CUSTOMER_CATEGORIES, categoryLabel } from "@/domain/pricing";
import { planAllows } from "@/domain/features";
import { useSubscription } from "./subscription";
import { tierFor } from "@/domain/loyalty";

function Page({ title, children }: { title: string; children: ReactNode }) {
  return <div className="flex flex-col gap-3"><h1 className="text-xl font-bold">{title}</h1>{children}</div>;
}

export function ClientsPage() {
  const { session } = useSession(); const s = session!; const qc = useQueryClient();
  const rows = useQuery({ queryKey: ["customers"], queryFn: () => list<Customer>("customers", s, [], 500) });
  const canCategory = (s.role === "owner" || s.role === "manager") && planAllows(useSubscription().data?.entitlement.plan.id, "tieredPricing");
  const [catErr, setCatErr] = useState("");
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
        <input className="input" placeholder="Nom" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input className="input" inputMode="tel" placeholder="Téléphone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <input className="input" inputMode="numeric" placeholder="Plafond de crédit (FCFA)" value={f.creditLimit} onChange={(e) => setF({ ...f, creditLimit: e.target.value })} />
        <button className="btn">Ajouter le client</button>
      </form>
      {catErr && <p className="text-red-400 text-sm" role="alert">{catErr}</p>}
      {(rows.data ?? []).map((c) => (
        <div key={c.$id} className="card flex justify-between">
          <div><div className="font-medium">{c.name}</div><div className="text-xs text-white/50">{c.phone} · {tierFor(c.annualSpend ?? 0)} · {c.points ?? 0} pts{c.category ? ` · ${categoryLabel(c.category)}` : ""}</div>
            {canCategory && <select aria-label={`Catégorie tarifaire de ${c.name}`} className="mt-1 rounded-lg bg-white/5 border border-white/15 px-2 py-1 text-xs" value={c.category ?? ""} onChange={(e) => setCategory.mutate({ id: c.$id, category: e.target.value })}>{CUSTOMER_CATEGORIES.map((x) => <option key={x.id} value={x.id}>Tarif {x.label.toLowerCase()}</option>)}</select>}</div>
          <div className="text-right text-sm">{(c.creditBalance ?? 0) > 0 ? <span className="text-red-400">Doit {formatFcfa(c.creditBalance ?? 0)}</span> : "À jour"}</div>
        </div>
      ))}
    </Page>
  );
}
