import { metaLines, safeFileName, toCsv, toXlsx, type ReportData } from "@/domain/exports";

const GOLD: [number, number, number] = [201, 162, 39];
const fmt = (c: string | number | null): string => (c === null || c === undefined ? "—" : typeof c === "number" ? c.toLocaleString("fr-FR", { maximumFractionDigits: 2 }).replace(/[  ]/g, " ") : c);

/** PDF A4 paysage : en-tête (titre, période, magasins, filtres), un tableau par section avec sauts de page, méthodes et limites en fin de document. */
export async function reportPdf(r: ReportData): Promise<Blob> {
  const { jsPDF } = await import("jspdf"); const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" }); const W = 297, H = 210, M = 10; let y = M; let page = 1;
  const footer = () => { doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(120); doc.text(`Dogui Mart Pro — ${r.title} — page ${page}`, W / 2, H - 5, { align: "center" }); doc.setTextColor(0); };
  const need = (h: number) => { if (y + h > H - 12) { footer(); doc.addPage(); page++; y = M; } };
  doc.setFont("helvetica", "bold").setFontSize(16).setTextColor(...GOLD); doc.text(r.title, M, y + 5); y += 10; doc.setTextColor(0).setFontSize(8.5).setFont("helvetica", "normal");
  for (const [k, v] of metaLines(r)) { const lines = doc.splitTextToSize(`${k} : ${v}`, W - 2 * M) as string[]; for (const l of lines) { doc.text(l, M, y); y += 4; } }
  y += 2;
  for (const s of r.sections) {
    need(14); doc.setFont("helvetica", "bold").setFontSize(10.5).text(s.name, M, y); y += 5; const n = s.columns.length; const cw = (W - 2 * M) / n; const colW = Array(n).fill(cw) as number[];
    const row = (cells: (string | number | null)[], bold: boolean) => { doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(7.5); const wrapped = cells.map((c, i) => (doc.splitTextToSize(fmt(c), colW[i]! - 2) as string[]).slice(0, 3)); const h = Math.max(...wrapped.map((w) => w.length)) * 3.4 + 1.6; need(h);
      if (bold) { doc.setFillColor(243, 234, 208); doc.rect(M, y - 3.2, W - 2 * M, h, "F"); } wrapped.forEach((w, i) => { const x = M + colW.slice(0, i).reduce((a, b) => a + b, 0); const num = typeof cells[i] === "number"; w.forEach((t, k) => doc.text(t, num ? x + colW[i]! - 1 : x + 1, y + k * 3.4, { align: num ? "right" : "left" })); }); doc.setDrawColor(220).line(M, y - 3.2 + h, W - M, y - 3.2 + h); y += h; };
    row(s.columns, true); if (!s.rows.length) { need(6); doc.setFont("helvetica", "italic").setFontSize(8).text("Aucune donnée sur la période et les filtres choisis.", M + 1, y + 1); y += 6; } for (const rw of s.rows.slice(0, 400)) row(rw, false); if (s.rows.length > 400) { need(6); doc.setFont("helvetica", "italic").setFontSize(8).text(`… ${s.rows.length - 400} ligne(s) de plus : utilisez l'export Excel ou CSV pour le détail complet.`, M + 1, y + 1); y += 6; } y += 4;
  }
  if (r.notes.length) { need(12); doc.setFont("helvetica", "bold").setFontSize(10).text("Méthodes et limites", M, y); y += 5; doc.setFont("helvetica", "normal").setFontSize(8); for (const n of r.notes) for (const l of doc.splitTextToSize(`• ${n}`, W - 2 * M) as string[]) { need(4); doc.text(l, M, y); y += 3.8; } }
  footer(); return doc.output("blob");
}

export type ExportFormat = "pdf" | "xlsx" | "csv";
const MIME: Record<ExportFormat, string> = { pdf: "application/pdf", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv;charset=utf-8" };
/** Génère le fichier à partir des lignes renvoyées par le serveur (mêmes filtres que l'écran), puis le partage (Android) ou le télécharge. */
export async function exportReport(r: ReportData, format: ExportFormat): Promise<void> {
  const name = safeFileName(r, format); const blob = format === "pdf" ? await reportPdf(r) : format === "xlsx" ? new Blob([toXlsx(r) as BlobPart], { type: MIME.xlsx }) : new Blob([toCsv(r)], { type: MIME.csv });
  const file = new File([blob], name, { type: MIME[format] });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if ((e as DOMException).name === "AbortError") return; } }
  const url = URL.createObjectURL(blob); Object.assign(document.createElement("a"), { href: url, download: name }).click(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
