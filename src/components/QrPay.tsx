import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { api } from "@/lib/api";
import { formatFcfa } from "@/domain/money";
import type { Session } from "@/lib/session";

type Link = { id: string; url: string; reference: string; amount: number; expiresAt: string };

/** Génère le lien Wave/Orange Business, l'affiche en QR code, puis attend la confirmation de réception. */
export function QrPay({ session, provider, amount, onPaid, onCancel }: {
  session: Session; provider: "wave" | "orange"; amount: number; onPaid: (linkId: string) => void; onCancel: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [link, setLink] = useState<Link | null>(null);
  const [tx, setTx] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { api<Link>(session, "payment_link.create", { provider, amount }).then(setLink).catch((e: Error) => setErr(e.message)); }, [session, provider, amount]);
  useEffect(() => { if (link && canvas.current) void QRCode.toCanvas(canvas.current, link.url, { width: 260, margin: 2, color: { dark: "#000", light: "#fff" } }); }, [link]);

  async function confirm() {
    setBusy(true); setErr("");
    try { await api(session, "payment_link.confirm", { linkId: link!.id, txRef: tx }); onPaid(link!.id); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function cancel() { if (link) await api(session, "payment_link.cancel", { linkId: link.id }).catch(() => {}); onCancel(); }

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center gap-3 p-6">
      <h2 className="text-xl font-bold capitalize">{provider} Business · {formatFcfa(amount)}</h2>
      {link ? <canvas ref={canvas} className="rounded-xl" /> : !err && <p className="text-white/60">Création du lien…</p>}
      {link && <>
        <p className="text-sm text-white/60">Réf. {link.reference} — le client scanne, paie, puis saisissez l'ID de transaction reçu.</p>
        <input className="input max-w-xs" placeholder="ID de transaction (SMS / app Business)" value={tx} onChange={(e) => setTx(e.target.value)} />
        <button className="btn w-full max-w-xs" disabled={busy || tx.trim().length < 6} onClick={confirm}>Paiement reçu</button>
      </>}
      {err && <p className="text-red-400 text-center">{err}</p>}
      <button className="btn-ghost w-full max-w-xs" onClick={cancel}>Annuler</button>
    </div>
  );
}
