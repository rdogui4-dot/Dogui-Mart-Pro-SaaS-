import type { ReactNode } from "react";
import { ChevronLeft, Image as ImageIcon, X } from "lucide-react";
import { useArticleImage } from "@/lib/articles";

export function Thumb({ id, size = 64, className = "" }: { id?: string; size?: number; className?: string }) {
  const url = useArticleImage(id, size >= 120 ? 400 : 160);
  return url ? <img src={url} alt="" className={`object-cover rounded-2xl ${className}`} style={{ width: size, height: size }} /> : <div className={`rounded-2xl bg-white/5 flex items-center justify-center text-white/30 ${className}`} style={{ width: size, height: size }}><ImageIcon size={size / 3} /></div>;
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
    <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-4" role="alertdialog" aria-modal="true">
      <div className="card w-full max-w-sm flex flex-col gap-3"><p>{text}</p>
        <div className="flex gap-2"><button className="btn-ghost flex-1" onClick={onNo}>Annuler</button><button className={`flex-1 ${danger ? "btn-ghost !border-red-400 !text-red-300" : "btn"}`} onClick={onYes}>{confirmLabel}</button></div></div>
    </div>
  );
}
