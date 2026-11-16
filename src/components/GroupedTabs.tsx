import { Lock } from "lucide-react";

/** Onglets regroupés en rangées étiquetées (une rangée par groupe, qui passe à la ligne sur grand écran) ; un onglet verrouillé par la formule garde une icône de cadenas. */
export type TabItem<K extends string> = { key: K; label: string; locked?: boolean };
export function GroupedTabs<K extends string>({ groups, value, onChange, label }: { groups: { label: string; items: TabItem<K>[] }[]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <div className="flex flex-col gap-1.5" aria-label={label}>
      {groups.filter((g) => g.items.length > 0).map((g) => (
        <div key={g.label} className="flex items-center gap-2 min-w-0">
          <span className="hidden md:block w-20 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted">{g.label}</span>
          <div className="flex gap-2 overflow-x-auto md:overflow-visible md:flex-wrap pb-1" role="tablist" aria-label={`${label} — ${g.label}`}>
            {g.items.map((t) => (
              <button key={t.key} role="tab" aria-selected={value === t.key} aria-current={value === t.key} className="chip inline-flex items-center gap-1.5" onClick={() => onChange(t.key)}>
                {t.label}{t.locked && <Lock size={12} aria-label="Réservé à une formule supérieure" />}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
