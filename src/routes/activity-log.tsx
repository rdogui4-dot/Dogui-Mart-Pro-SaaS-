import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { DataGrid } from "@/components/DataGrid";
import { useMinWidth } from "@/lib/media";

type Entry = { id: string; at: string; action: string; module: string; detail: string; by: string };
const when = (iso: string) => (iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—");

/** Journal d'activité (lecture seule) : traces réelles de la boutique active, auteur, module, date. Propriétaire et gérant. */
export function ActivityLog() {
  const { session } = useSession(); const s = session!; const wide = useMinWidth(1024); const [mod, setMod] = useState("");
  const q = useQuery({ queryKey: ["activity", s.shopId, mod], retry: 1, queryFn: () => api<{ entries: Entry[]; count: number; shown: number; modules: { id: string; label: string }[]; note: string }>(s, "activity.list", { module: mod || undefined }) });
  const d = q.data;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col md:flex-row md:items-end gap-2 md:justify-between">
        <label className="text-xs text-muted flex flex-col gap-1 md:w-64">Module<select className="input" aria-label="Filtrer par module" value={mod} onChange={(e) => setMod(e.target.value)}><option value="">Tous les modules</option>{(d?.modules ?? []).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
        {d && <p className="text-xs text-muted">{d.shown} ligne(s) affichée(s) sur {d.count}</p>}
      </div>
      {q.error && <p className="text-bad text-sm" role="alert">{(q.error as Error).message}</p>}
      {q.isLoading && <div className="card h-24 animate-pulse bg-subtle" aria-busy="true" />}
      {d && d.entries.length === 0 && <p className="card text-sm text-muted">Aucune activité enregistrée pour cette boutique{mod ? " dans ce module" : ""}.</p>}
      {d && d.entries.length > 0 && (wide
        ? <DataGrid label="Journal d'activité" rows={d.entries} rowKey={(e) => e.id} columns={[{ label: "Date", cell: (e) => when(e.at) }, { label: "Auteur", cell: (e) => e.by }, { label: "Module", cell: (e) => e.module }, { label: "Action", cell: (e) => <span className="font-mono text-xs">{e.action}</span> }, { label: "Détail", cell: (e) => <span className="text-soft">{e.detail || "—"}</span> }]} />
        : <ul className="flex flex-col gap-2">{d.entries.map((e) => <li key={e.id} className="card text-sm flex flex-col gap-0.5"><span className="flex justify-between gap-2"><b>{e.module}</b><span className="text-xs text-muted">{when(e.at)}</span></span><span className="text-soft">{e.detail || e.action}</span><span className="text-xs text-muted">{e.by} · <span className="font-mono">{e.action}</span></span></li>)}</ul>)}
      {d && <p className="text-xs text-muted">{d.note}</p>}
    </div>
  );
}
