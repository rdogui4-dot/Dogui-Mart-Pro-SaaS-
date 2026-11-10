import type { InputHTMLAttributes } from "react";

/** Groupe les milliers à la saisie (100 000) et n'accepte que des chiffres : un montant en FCFA est un entier. La valeur remontée reste une chaîne lisible par `Number(v.replace(/\s/g, ""))`. */
export const groupDigits = (raw: string): string => raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
export function AmountInput({ value, onChange, hint, ...rest }: { value: string; onChange: (v: string) => void; hint?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "inputMode">) {
  return <label className="flex flex-col gap-1">
    <span className="relative block"><input {...rest} className={`input !pr-14 ${rest.className ?? ""}`} inputMode="numeric" pattern="[0-9  ]*" autoComplete="off" enterKeyHint="done" value={value} onChange={(e) => onChange(groupDigits(e.target.value))} /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/40 pointer-events-none" aria-hidden="true">FCFA</span></span>
    {hint && <span className="text-[11px] text-white/40">{hint}</span>}
  </label>;
}
