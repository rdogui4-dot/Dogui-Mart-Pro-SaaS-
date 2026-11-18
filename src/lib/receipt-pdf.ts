/** Reçu de paiement d'abonnement (A4) : atteste un paiement Selar validé par la plateforme. Ce n'est pas une facture : aucune numérotation fiscale. */
import { PERIOD_LABEL } from "@/domain/subscriptions";
import type { Receipt } from "@/domain/subscription-kit";
import { pdfMoney } from "./pdf";

const GOLD: [number, number, number] = [201, 162, 39];
const dateFr = (iso: string) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }) : "—");

export async function receiptPdf(r: Receipt): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" }); const M = 18, R = 192; let y = 22;
  const font = (size: number, bold = false, gray = 25) => doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(size).setTextColor(gray);
  font(16, true); doc.text("DOGUI MART PRO", M, y); font(9, false, 110); doc.text("Abonnement à la plateforme", M, y + 5);
  font(18, true); doc.text("REÇU DE PAIEMENT", R, y, { align: "right" }); font(9, false, 110); doc.text(`Réf. ${r.reference}`, R, y + 5, { align: "right" });
  doc.setFillColor(...GOLD).rect(M, y + 9, R - M, 0.8, "F"); y += 20;

  font(9, true, 110); doc.text("REÇU PAR", M, y); y += 5; font(10.5, true); doc.text(r.customer.companyName || r.customer.name, M, y); y += 5; font(9.5);
  for (const l of [r.customer.companyName && r.customer.name !== r.customer.companyName ? r.customer.name : "", r.customer.address, r.customer.phone ? `Tél. ${r.customer.phone}` : "", r.customer.legal, r.payerEmail ? `E-mail du paiement : ${r.payerEmail}` : ""].filter(Boolean)) { doc.text(l, M, y); y += 4.6; }
  y += 6;

  const rows: [string, string][] = [
    ["Formule", r.planName], ["Durée", `${PERIOD_LABEL[r.period]}${r.count > 1 ? ` × ${r.count}` : ""}`],
    ["Période couverte", `du ${dateFr(r.startsAt)} au ${dateFr(r.endsAt)}`], ["Demande créée le", dateFr(r.requestedAt)],
    ["Moyen de paiement", "Selar (Wave, Orange Money ou carte)"], ["Référence de commande Selar", r.txRef || "—"], ["Statut", "Paiement validé par la plateforme"],
  ];
  doc.setDrawColor(220);
  for (const [k, v] of rows) { font(9.5, false, 110); doc.text(k, M, y); font(9.5, true); doc.text(v, R, y, { align: "right" }); doc.line(M, y + 2.5, R, y + 2.5); y += 8; }
  y += 4; doc.setFillColor(248, 244, 230).roundedRect(M, y, R - M, 16, 2, 2, "F");
  font(11, true); doc.text("Montant payé", M + 5, y + 10); font(15, true); doc.text(`${pdfMoney(r.amount)} FCFA`, R - 5, y + 10.5, { align: "right" }); y += 26;

  font(8.5, false, 110);
  for (const l of doc.splitTextToSize("Ce reçu atteste le paiement de l'abonnement indiqué, vérifié par la plateforme dans Selar. Il ne constitue pas une facture. Document produit par l'application à partir des données enregistrées.", R - M) as string[]) { doc.text(l, M, y); y += 4.2; }
  font(8, false, 140); doc.text(`Édité le ${dateFr(new Date().toISOString())}`, M, 285);
  return doc.output("blob");
}
