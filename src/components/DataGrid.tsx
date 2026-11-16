import type { ReactNode } from "react";

/** Tableau de liste pour grand écran : en-têtes `scope`, ligne cliquable (et accessible au clavier par le premier bouton de la ligne), chiffres alignés à droite. */
export type Column<R> = { label: string; cell: (r: R) => ReactNode; align?: "right"; className?: string };
export function DataGrid<R>({ rows, columns, rowKey, onRow, label }: { rows: R[]; columns: Column<R>[]; rowKey: (r: R) => string; onRow?: (r: R) => void; label: string }) {
  return (
    <div className="card !p-0 overflow-x-auto">
      <table className="w-full text-sm" aria-label={label}>
        <thead><tr className="text-left text-muted border-b border-line">{columns.map((c) => <th key={c.label} scope="col" className={`py-2.5 px-3 font-medium ${c.align === "right" ? "text-right" : ""}`}>{c.label}</th>)}</tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={rowKey(r)} className={`border-b border-line last:border-0 ${onRow ? "cursor-pointer hover:bg-subtle" : ""}`} onClick={onRow ? () => onRow(r) : undefined}>
            {columns.map((c, i) => (
              <td key={c.label} className={`py-2.5 px-3 ${c.align === "right" ? "text-right tabular-nums" : ""} ${c.className ?? ""}`}>
                {i === 0 && onRow ? <button className="text-left font-semibold hover:underline" onClick={(e) => { e.stopPropagation(); onRow(r); }}>{c.cell(r)}</button> : c.cell(r)}
              </td>
            ))}
          </tr>))}
        </tbody>
      </table>
    </div>
  );
}

/** Pastille de statut : le texte porte le sens (la couleur n'est jamais seule). */
export function StatusPill({ tone, children }: { tone: "ok" | "warn" | "bad" | "info" | "muted"; children: ReactNode }) {
  const c = { ok: "bg-ok-bg text-ok", warn: "bg-warn-bg text-warn", bad: "bg-bad-bg text-bad", info: "bg-info-bg text-info", muted: "bg-subtle text-soft" }[tone];
  return <span className={`inline-block text-xs rounded-full px-2 py-0.5 ${c}`}>{children}</span>;
}
