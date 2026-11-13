import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { ChevronLeft, Image as ImageIcon, X } from "lucide-react";
import { useArticleImage } from "@/lib/articles";

export function Thumb({ id, size = 64, className = "" }: { id?: string; size?: number; className?: string }) {
  const url = useArticleImage(id, size >= 120 ? 400 : 160);
  return url ? <img src={url} alt="" className={`object-cover rounded-lg ${className}`} style={{ width: size, height: size }} /> : <div className={`rounded-lg bg-subtle flex items-center justify-center text-muted ${className}`} style={{ width: size, height: size }}><ImageIcon size={size / 3} /></div>;
}

export function Sheet({ title, onClose, children, back }: { title: string; onClose: () => void; children: ReactNode; back?: boolean }) {
  return (
    <div className="fixed inset-0 z-40 bg-[var(--bg)] overflow-y-auto" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-3 bg-[var(--surface)] border-b border-[var(--line)]">
        <button className="p-2" aria-label="Fermer" onClick={onClose}>{back ? <ChevronLeft /> : <X />}</button><h2 className="font-bold truncate">{title}</h2>
      </div>
      <div className="p-4 pb-28 flex flex-col gap-3 max-w-md mx-auto">{children}</div>
    </div>
  );
}

export function Confirm({ text, confirmLabel, danger, onYes, onNo }: { text: string; confirmLabel: string; danger?: boolean; onYes: () => void; onNo: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-[var(--overlay)] flex items-end sm:items-center justify-center p-4" role="alertdialog" aria-modal="true">
      <div className="card w-full max-w-sm flex flex-col gap-3"><p>{text}</p>
        <div className="flex gap-2"><button className="btn-ghost flex-1" onClick={onNo}>Annuler</button><button className={`flex-1 ${danger ? "btn-ghost !border-bad !text-bad" : "btn"}`} onClick={onYes}>{confirmLabel}</button></div></div>
    </div>
  );
}

/* ---- Composants de base du système de design (adoptés module par module). Tout passe par les jetons de couleur. ---- */

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0"><h1 className="text-2xl font-bold">{title}</h1>{subtitle && <p className="text-sm text-muted mt-0.5">{subtitle}</p>}</div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export type Tone = "info" | "ok" | "warn" | "bad";
const TONE_CLASS: Record<Tone, string> = { info: "bg-info-bg text-info border-info/30", ok: "bg-ok-bg text-ok border-ok/30", warn: "bg-warn-bg text-warn border-warn/30", bad: "bg-bad-bg text-bad border-bad/30" };

export function Notice({ tone = "info", title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={`rounded-lg border px-3 py-2.5 text-sm flex flex-col gap-0.5 ${TONE_CLASS[tone]}`}>
      {title && <b>{title}</b>}{children && <span>{children}</span>}
    </div>
  );
}

export function Badge({ tone = "info", children }: { tone?: Tone | "neutral"; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tone === "neutral" ? "bg-subtle text-soft border-line" : TONE_CLASS[tone]}`}>{children}</span>;
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 text-center py-8">
      <b>{title}</b>{hint && <p className="text-sm text-muted max-w-xs">{hint}</p>}{action}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string; locked?: boolean }[]; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="scroll-x">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} aria-current={value === t.id} className="chip" onClick={() => onChange(t.id)}>
          {t.label}{t.locked ? " (Pro)" : ""}
        </button>
      ))}
    </div>
  );
}

/** Tableau à partir de 768 px, liste de cartes empilées sur téléphone. Chaque colonne donne son libellé (repris dans la version empilée). */
export function DataTable<R>({ rows, columns, rowKey, onRow, empty }: { rows: R[]; columns: { label: string; cell: (r: R) => ReactNode; align?: "right" }[]; rowKey: (r: R) => string; onRow?: (r: R) => void; empty?: ReactNode }) {
  if (!rows.length) return <>{empty ?? <EmptyState title="Aucune donnée" />}</>;
  return (
    <>
      <table className="hidden md:table w-full text-sm">
        <thead><tr className="text-left text-muted border-b border-line">{columns.map((c) => <th key={c.label} scope="col" className={`py-2 px-2 font-medium ${c.align === "right" ? "text-right" : ""}`}>{c.label}</th>)}</tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={rowKey(r)} className={`border-b border-line ${onRow ? "cursor-pointer hover:bg-subtle" : ""}`} onClick={onRow ? () => onRow(r) : undefined}>
            {columns.map((c) => <td key={c.label} className={`py-2.5 px-2 ${c.align === "right" ? "text-right" : ""}`}>{c.cell(r)}</td>)}
          </tr>))}
        </tbody>
      </table>
      <ul className="md:hidden flex flex-col gap-2">{rows.map((r) => (
        <li key={rowKey(r)} className="card flex flex-col gap-1 text-sm" onClick={onRow ? () => onRow(r) : undefined}>
          {columns.map((c) => <div key={c.label} className="flex justify-between gap-3"><span className="text-muted">{c.label}</span><span className="text-right">{c.cell(r)}</span></div>)}
        </li>))}
      </ul>
    </>
  );
}

type ToastItem = { id: number; tone: Tone; text: string };
const ToastCtx = createContext<(tone: Tone, text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((tone: Tone, text: string) => {
    const id = Date.now() + Math.random(); setItems((x) => [...x.slice(-2), { id, tone, text }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), tone === "bad" ? 8000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed z-[60] inset-x-3 bottom-20 md:bottom-4 md:left-auto md:right-4 md:w-96 flex flex-col gap-2 pointer-events-none" aria-live="polite">
        {items.map((i) => <div key={i.id} className={`pointer-events-auto rounded-lg border px-3 py-2.5 text-sm bg-surface ${TONE_CLASS[i.tone]}`}>{i.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
