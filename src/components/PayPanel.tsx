import { useState } from "react";
import { Plus, QrCode, Trash2 } from "lucide-react";
import { formatFcfa, isQrMethod, type PaymentMethod } from "@/domain/money";
import { evaluatePay, METHOD_LABEL, type PayLine, type PayState } from "@/domain/pay";

const uid = () => Math.random().toString(36).slice(2, 10);
export const newPayLine = (method: PaymentMethod = "cash", amount = ""): PayLine => ({ id: uid(), method, amount, reference: "" });
type Props = { total: number; lines: PayLine[]; onChange: (l: PayLine[]) => void; hasCustomer: boolean; credit?: { balance: number; limit: number }; qrConfigured: Record<string, boolean>; onQr: (lineId: string) => void; disabled?: boolean; voucherOk?: boolean; onCheckVoucher?: (code: string) => Promise<string> };

/** Encaissement : une ou plusieurs lignes (espèces, Wave, Orange Money, carte, crédit), reste à payer et monnaie en direct. Les références saisies sont conservées avec le paiement ; l'application ne confirme AUCUN paiement externe. */
export function PayPanel({ total, lines, onChange, hasCustomer, credit, qrConfigured, onQr, disabled, voucherOk, onCheckVoucher }: Props) {
  const [vmsg, setVmsg] = useState<Record<string, string>>({});
  const st: PayState = evaluatePay(total, lines, { hasCustomer, credit });
  const set = (id: string, patch: Partial<PayLine>) => onChange(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const add = (m: PaymentMethod) => onChange([...lines, newPayLine(m, st.remaining > 0 ? String(st.remaining) : "")]);
  const methods: PaymentMethod[] = ["cash", "wave", "orange", "card", ...(hasCustomer ? ["credit" as const] : []), ...(voucherOk ? ["voucher" as const] : [])];
  return (
    <section className="flex flex-col gap-2" aria-label="Encaissement">
      {lines.map((l, i) => (
        <div key={l.id} className="card !p-2 flex flex-col gap-1.5">
          <div className="flex gap-1.5 items-center">
            <select className="input !py-2 !px-2 w-32 shrink-0" aria-label={`Moyen de paiement ${i + 1}`} disabled={disabled} value={l.method} onChange={(e) => set(l.id, { method: e.target.value as PaymentMethod, linkId: undefined })}>{methods.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}</select>
            <input className="input !py-2 flex-1 min-w-0" inputMode="numeric" aria-label={`Montant ${i + 1}`} placeholder={l.method === "cash" ? "Montant reçu" : "Montant"} disabled={disabled} value={l.amount} onChange={(e) => set(l.id, { amount: e.target.value })} />
            {lines.length > 1 && <button className="btn-ghost !p-2" aria-label={`Retirer le paiement ${i + 1}`} disabled={disabled} onClick={() => onChange(lines.filter((x) => x.id !== l.id))}><Trash2 size={16} /></button>}
          </div>
          {(isQrMethod(l.method) || l.method === "card") && <div className="flex gap-1.5 items-center">
            <input className="input !py-2 flex-1 min-w-0" aria-label={`Référence ${i + 1}`} placeholder={l.method === "card" ? "Référence TPE (facultatif)" : "Référence de la transaction (obligatoire)"} maxLength={64} disabled={disabled || !!l.linkId} value={l.linkId ? "Lien confirmé" : l.reference} onChange={(e) => set(l.id, { reference: e.target.value })} />
            {isQrMethod(l.method) && qrConfigured[l.method] && <button className="btn-ghost !p-2 text-xs flex items-center gap-1" disabled={disabled || !(Number(l.amount) > 0)} onClick={() => onQr(l.id)}><QrCode size={16} />QR</button>}
          </div>}
          {l.method === "voucher" && <div className="flex gap-1.5 items-center"><input className="input !py-2 flex-1 min-w-0" aria-label={`Code du bon ${i + 1}`} autoCapitalize="characters" placeholder="Code du bon d'achat (AV-…)" maxLength={24} disabled={disabled} value={l.reference} onChange={(e) => set(l.id, { reference: e.target.value.toUpperCase() })} />{onCheckVoucher && <button className="btn-ghost !py-2 !px-2 text-xs" disabled={disabled || l.reference.length < 4} onClick={() => void onCheckVoucher(l.reference).then((m) => setVmsg((x) => ({ ...x, [l.id]: m })))}>Vérifier</button>}</div>}
          {l.method === "voucher" && vmsg[l.id] && <p className="text-[11px] text-white/60" role="status">{vmsg[l.id]}</p>}
          {isQrMethod(l.method) && <p className="text-[11px] text-white/40">Référence saisie par le vendeur : elle n'est pas vérifiée auprès de l'opérateur.</p>}
        </div>
      ))}
      <div className="flex gap-1.5 flex-wrap">{methods.map((m) => <button key={m} className="btn-ghost !py-1 !px-2 text-xs flex items-center gap-1" disabled={disabled} onClick={() => add(m)}><Plus size={12} />{METHOD_LABEL[m]}</button>)}</div>
      <div className="grid grid-cols-3 gap-2 text-center text-sm" role="status" aria-live="polite">
        <div className="card !p-2"><div className="text-[11px] text-white/50">À payer</div><b>{formatFcfa(total)}</b></div>
        <div className="card !p-2"><div className="text-[11px] text-white/50">Reçu</div><b>{formatFcfa(st.paid)}</b></div>
        <div className={`card !p-2 ${st.remaining ? "border border-amber-400/40" : st.change ? "border border-emerald-400/40" : ""}`}><div className="text-[11px] text-white/50">{st.remaining ? "Reste à payer" : "Monnaie à rendre"}</div><b className={st.remaining ? "text-amber-300" : "text-emerald-300"}>{formatFcfa(st.remaining || st.change)}</b></div>
      </div>
      {!st.ok && lines.some((l) => l.amount.trim() !== "") && <ul className="text-xs text-amber-300 flex flex-col gap-0.5">{st.errors.filter((e) => !e.startsWith("Reste à payer")).map((e) => <li key={e}>• {e}</li>)}</ul>}
    </section>
  );
}
