import { useQuery } from "@tanstack/react-query";
import { formatFcfa } from "@/domain/money";
import { list } from "@/lib/data";
import { useSession } from "@/lib/session";

type JE = { ref: string; account: string; debit: number; credit: number; label: string; date: string };
export function ComptaPage() {
  const { session } = useSession(); const s = session!;
  const rows = useQuery({ queryKey: ["journal"], queryFn: () => list<JE>("journal_entries", s, [], 1000) });
  const by = new Map<string, { d: number; c: number }>();
  for (const r of rows.data ?? []) { const a = by.get(r.account) ?? { d: 0, c: 0 }; a.d += r.debit; a.c += r.credit; by.set(r.account, a); }
  const sales = by.get("701")?.c ?? 0, purchases = by.get("601")?.d ?? 0;
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-bold">Comptabilité (SYSCOHADA)</h1>
      <div className="grid grid-cols-2 gap-2">
        <div className="card"><div className="text-xs text-white/50">Ventes HT (701)</div><b>{formatFcfa(sales)}</b></div>
        <div className="card"><div className="text-xs text-white/50">Achats HT (601)</div><b>{formatFcfa(purchases)}</b></div>
      </div>
      <div className="card">
        <h2 className="font-semibold mb-2">Balance des comptes</h2>
        <table className="w-full text-sm"><thead className="text-white/50"><tr><th className="text-left">Compte</th><th className="text-right">Débit</th><th className="text-right">Crédit</th></tr></thead>
          <tbody>{[...by.entries()].sort().map(([a, v]) => <tr key={a}><td>{a}</td><td className="text-right">{formatFcfa(v.d)}</td><td className="text-right">{formatFcfa(v.c)}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}
