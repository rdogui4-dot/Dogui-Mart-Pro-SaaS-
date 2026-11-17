import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, Image as ImageIcon, X } from "lucide-react";
import { useArticleImage } from "@/lib/articles";

export function Thumb({ id, size = 64, className = "" }: { id?: string; size?: number; className?: string }) {
  const url = useArticleImage(id, size >= 120 ? 400 : 160);
  return url ? <img src={url} alt="" width={size} height={size} loading="lazy" decoding="async" className={`object-cover rounded-lg ${className}`} style={{ width: size, height: size }} /> : <div className={`rounded-lg bg-subtle flex items-center justify-center text-muted ${className}`} style={{ width: size, height: size }}><ImageIcon size={size / 3} /></div>;
}

/** size : « md » (28 rem, défaut), « lg » (44 rem, formulaires à deux colonnes sur grand écran), « panel » (volet latéral ancré à droite sur grand écran, plein écran sur téléphone),
 *  « modal » (fenêtre centrée de 48 rem sur écran ≥ 768 px avec fond atténué, plein écran sur téléphone). panel et modal : Échap et clic à l'extérieur ferment, le focus est rendu à l'élément d'origine. */
export function Sheet({ title, onClose, children, back, size = "md" }: { title: string; onClose: () => void; children: ReactNode; back?: boolean; size?: "md" | "lg" | "panel" | "modal" }) {
  const ref = useRef<HTMLDivElement>(null);
  const floating = size === "panel" || size === "modal";
  useEffect(() => { // toutes les fenêtres : focus à l'ouverture, Échap pour fermer, focus rendu à la fermeture (cahier §17)
    const prev = document.activeElement as HTMLElement | null; ref.current?.focus();
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const all = document.querySelectorAll('[role="dialog"], [role="alertdialog"]'); if (all[all.length - 1] !== ref.current) return; // une fenêtre plus haute (confirmation, fiche) garde la main
      onClose();
    };
    window.addEventListener("keydown", h);
    return () => { window.removeEventListener("keydown", h); try { prev?.focus?.(); } catch { /* élément disparu */ } };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const where = size === "panel" ? "inset-0 md:inset-y-0 md:left-auto md:right-0 md:w-[34rem] md:max-w-full md:border-l md:border-line"
    : size === "modal" ? "inset-0 md:m-auto md:w-[48rem] md:max-w-[calc(100vw-2rem)] md:h-[88vh] md:rounded-xl md:border md:border-line md:shadow-xl" : "inset-0";
  const inner = size === "lg" ? "max-w-md md:max-w-3xl" : size === "panel" || size === "modal" ? "max-w-md md:max-w-none" : "max-w-md";
  return (
    <>
      {floating && <div className="hidden md:block fixed inset-0 z-30 bg-[var(--overlay)]" aria-hidden="true" onClick={onClose} />}
      <div ref={ref} tabIndex={-1} className={`sheet-in d3-sheet-${size} fixed z-40 bg-[var(--bg)] overflow-y-auto outline-none ${where}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-3 bg-[var(--surface)] border-b border-[var(--line)]">
          <button className="p-2" aria-label="Fermer" onClick={onClose}>{back ? <ChevronLeft /> : <X />}</button><h2 className="font-bold truncate">{title}</h2>
        </div>
        <div className={`p-4 pb-28 flex flex-col gap-3 mx-auto w-full ${inner}`}>{children}</div>
      </div>
    </>
  );
}

export function Confirm({ text, confirmLabel, danger, onYes, onNo }: { text: string; confirmLabel: string; danger?: boolean; onYes: () => void; onNo: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-[var(--overlay)] flex items-end sm:items-center justify-center p-4" role="alertdialog" aria-modal="true">
      <div className="card pop-in w-full max-w-sm flex flex-col gap-3"><p>{text}</p>
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

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 text-center py-8">
      <b>{title}</b>{hint && <p className="text-sm text-muted max-w-xs">{hint}</p>}{action}
    </div>
  );
}

/** Avertissement réglementaire ou méthodologique : texte intégral conservé ; sur téléphone, une ligne puis « Lire la suite ». */
export function Disclaimer({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-xs text-muted">
      <p className={open ? "" : "line-clamp-1 md:line-clamp-none"}>{children}</p>
      {!open && <button type="button" className="md:hidden underline text-soft" onClick={() => setOpen(true)}>Lire la suite</button>}
    </div>
  );
}
