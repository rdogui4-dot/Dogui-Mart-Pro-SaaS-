import type { jsPDF } from "jspdf";
import { plainMoney, type DocModel } from "@/domain/documents";

export const pdfMoney = plainMoney;
const GOLD: [number, number, number] = [201, 162, 39];

/** Construit le PDF (A4 pour factures et bons de commande, rouleau 80 mm pour le ticket). */
export async function buildPdf(m: DocModel, width: 58 | 80 = 80): Promise<jsPDF> {
  const { jsPDF } = await import("jspdf");
  if (m.kind === "receipt") { const doc = new jsPDF({ unit: "mm", format: [width, receiptHeight(m)] }); const qr = m.qr ? (await import("qrcode")).default : null; return receipt(doc, m, qr ? await qr.toDataURL(m.qr!, { margin: 1, width: 240 }) : undefined); }
  return a4(new jsPDF({ unit: "mm", format: "a4" }), m);
}
export async function pdfBlob(m: DocModel, width: 58 | 80 = 80): Promise<Blob> { return (await buildPdf(m, width)).output("blob"); }

const receiptHeight = (m: DocModel) => 40 + (m.issuer.lines?.length ?? 0) * 4 + m.rows.length * 9 + m.totals.length * 5 + m.footer.length * 5 + (m.qr ? 34 : 0);

function receipt(doc: jsPDF, m: DocModel, qrImg?: string): jsPDF {
  const W = doc.internal.pageSize.getWidth(), M = 4; let y = 8;
  const center = (t: string, size = 9, bold = false) => { doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(size); doc.text(t, W / 2, y, { align: "center" }); y += size * 0.45 + 1; };
  center(m.issuer.name, 12, true); for (const l of m.issuer.lines ?? []) center(l, 8);
  y += 1; center(`${m.title}`, 9, true); center(`N° ${m.number}`, 8); center(m.date, 8);
  doc.setLineDashPattern([0.6, 0.6], 0).line(M, y, W - M, y); y += 4; doc.setLineDashPattern([], 0);
  doc.setFontSize(8.5);
  for (const r of m.rows) {
    doc.setFont("helvetica", "bold").text(doc.splitTextToSize(r.label, W - 2 * M)[0] as string, M, y); y += 4;
    doc.setFont("helvetica", "normal").text(`${r.qty} x ${pdfMoney(r.unit)}`, M, y); doc.text(pdfMoney(r.total), W - M, y, { align: "right" }); y += 5;
  }
  doc.setLineDashPattern([0.6, 0.6], 0).line(M, y - 2, W - M, y - 2); y += 2; doc.setLineDashPattern([], 0);
  for (const t of m.totals) { doc.setFont("helvetica", t.strong ? "bold" : "normal").setFontSize(t.strong ? 10 : 8.5); doc.text(t.label, M, y); doc.text(pdfMoney(t.value), W - M, y, { align: "right" }); y += 5; }
  y += 2; for (const f of m.footer) center(f, 8);
  if (qrImg) { const q = Math.min(28, W - 2 * M); doc.addImage(qrImg, "PNG", (W - q) / 2, y, q, q); y += q + 3; doc.setFontSize(6); doc.text("Vérifier ce ticket dans Dogui Mart Pro", W / 2, y, { align: "center" }); }
  return doc;
}

function a4(doc: jsPDF, m: DocModel): jsPDF {
  const W = 210, M = 15, R = W - M; let y = 20;
  const text = (t: string, x: number, size: number, bold = false, align: "left" | "right" = "left") => { doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(size); doc.text(t, x, y, { align }); };
  // En-tête
  doc.setFillColor(...GOLD).rect(0, 0, W, 4, "F");
  text(m.issuer.name, M, 18, true); const top = y; y = top + 6;
  for (const l of m.issuer.lines ?? []) { text(l, M, 9); y += 4.5; }
  const left = y; y = top; text(m.title, R, 20, true, "right"); y += 8; text(`N° ${m.number}`, R, 10, false, "right"); y += 5;
  text(`Date : ${m.date}`, R, 10, false, "right"); if (m.dueDate) { y += 5; text(`Échéance : ${m.dueDate}`, R, 10, false, "right"); }
  y = Math.max(left, y) + 8;
  // Tiers
  doc.setDrawColor(200).roundedRect(M, y, 85, 8 + (m.party.lines?.length ?? 0) * 4.5 + 8, 2, 2);
  y += 6; doc.setTextColor(120); text(m.partyLabel.toUpperCase(), M + 4, 8); doc.setTextColor(0); y += 5; text(m.party.name, M + 4, 11, true);
  for (const l of m.party.lines ?? []) { y += 4.5; text(l, M + 4, 9); }
  y += 12;
  // Tableau
  const cols = { label: M + 2, qty: 125, unit: 157, total: R - 2 };
  const header = () => { doc.setFillColor(...GOLD).rect(M, y - 5, R - M, 8, "F"); doc.setTextColor(20); const [h1, h2, h3, h4] = m.columns ?? ["Désignation", "Qté", "P.U.", "Total"]; text(h1, cols.label, 10, true); text(h2, cols.qty, 10, true, "right"); text(h3, cols.unit, 10, true, "right"); text(h4, cols.total, 10, true, "right"); doc.setTextColor(0); y += 8; };
  header();
  m.rows.forEach((r, i) => {
    const label = doc.setFont("helvetica", "normal").setFontSize(10).splitTextToSize(r.label, 95) as string[];
    const h = label.length * 5 + 2;
    if (y + h > 255) { doc.addPage(); y = 20; header(); }
    if (i % 2) doc.setFillColor(247, 244, 232).rect(M, y - 4, R - M, h, "F");
    label.forEach((ln, k) => { y += k ? 5 : 0; text(ln, cols.label, 10); });
    y -= (label.length - 1) * 5;
    text(String(r.qty), cols.qty, 10, false, "right"); text(pdfMoney(r.unit), cols.unit, 10, false, "right"); text(pdfMoney(r.total), cols.total, 10, false, "right");
    y += h;
  });
  // Totaux
  if (y + m.totals.length * 7 + 25 > 280) { doc.addPage(); y = 20; }
  y += 3; doc.setDrawColor(200).line(110, y - 3, R, y - 3);
  for (const t of m.totals) { text(t.label, 112, t.strong ? 11 : 10, !!t.strong); text(pdfMoney(t.value), R - 2, t.strong ? 11 : 10, !!t.strong, "right"); y += 6.5; }
  y += 6; for (const f of m.footer) { doc.setTextColor(90); text(f, M, 9); y += 4.5; }
  // Pied de page
  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) { doc.setPage(p); doc.setTextColor(150).setFont("helvetica", "normal").setFontSize(8); doc.text(`${m.issuer.name} — ${m.number} — page ${p}/${n}`, W / 2, 289, { align: "center" }); }
  return doc;
}

/** Android : feuille de partage native (WhatsApp, e-mail, impression…) ; sinon téléchargement. */
export async function deliverPdf(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: "application/pdf" });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: filename }); return; } catch (e) { if ((e as DOMException).name === "AbortError") return; } }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename }); a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
