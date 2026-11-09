import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { discardRejected, rejectedSales, retryRejected, syncPending, type PendingSale } from "@/lib/offline";
import { Confirm } from "./ui";

/** Ventes saisies hors ligne que le serveur a REFUSÉES (stock insuffisant, numéro de série vendu…) : le commerçant doit décider, rien n'est perdu en silence. */
export function RejectedSales() {
  const [rows, setRows] = useState<PendingSale[]>([]); const [ask, setAsk] = useState<PendingSale | null>(null); const [busy, setBusy] = useState(false);
  const load = () => void rejectedSales().then(setRows);
  useEffect(() => { load(); }, []);
  if (!rows.length) return null;
  const total = (p: PendingSale) => p.payments.reduce((a, x) => a + Number(x.amount ?? 0), 0);
  return (
    <section className="card flex flex-col gap-2 border-red-400/60" aria-label="Ventes à vérifier">
      <h2 className="font-semibold flex items-center gap-2 text-red-300"><AlertTriangle size={16} />Ventes à vérifier ({rows.length})</h2>
      <p className="text-xs text-white/60">Ces ventes ont été saisies hors ligne mais le serveur les a refusées. Corrigez la cause (stock, numéro de série…) puis « Réessayer », ou abandonnez la vente.</p>
      {rows.map((p) => (
        <div key={p.clientId} className="border-t border-[var(--line)] pt-2 flex flex-col gap-1">
          <div className="flex justify-between gap-2 text-sm"><span>{new Date(p.soldAt).toLocaleString("fr-FR")} · {p.lines.length} ligne{p.lines.length > 1 ? "s" : ""}</span><b>{total(p).toLocaleString("fr-FR")} FCFA</b></div>
          <p className="text-xs text-red-300" role="alert">{p.error}</p>
          <div className="flex gap-2"><button className="btn-ghost !py-2" disabled={busy} onClick={() => { setBusy(true); void retryRejected(p.clientId).then(() => syncPending()).then(load).finally(() => setBusy(false)); }}>Réessayer</button><button className="btn-ghost !py-2 !text-red-300" disabled={busy} onClick={() => setAsk(p)}>Abandonner</button></div>
        </div>
      ))}
      {ask && <Confirm danger text="Abandonner cette vente ? Elle ne sera pas enregistrée (le client a peut-être déjà payé : régularisez-le)." confirmLabel="Abandonner" onNo={() => setAsk(null)} onYes={() => { const id = ask.clientId; setAsk(null); void discardRejected(id).then(load); }} />}
    </section>
  );
}
