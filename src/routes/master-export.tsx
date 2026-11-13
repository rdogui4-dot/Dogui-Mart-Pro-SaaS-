/** Barre d'export (PDF / Excel / CSV) des écrans MASTER DOGUI : exporte exactement ce qui est affiché, via le modèle d'export commun. */
import { useState } from "react";
import { exportReport, type ExportFormat } from "@/lib/report-export";
import type { ReportData } from "@/domain/exports";

const FORMATS: [ExportFormat, string][] = [["pdf", "PDF"], ["xlsx", "Excel"], ["csv", "CSV"]];
export function ExportBar({ build, label = "Exporter" }: { build: () => ReportData; label?: string }) {
  const [busy, setBusy] = useState<ExportFormat | null>(null); const [err, setErr] = useState("");
  const go = async (f: ExportFormat) => { setBusy(f); setErr(""); try { await exportReport(build(), f); } catch (e) { setErr(`Export impossible : ${(e as Error).message}`); } setBusy(null); };
  return (
    <div className="flex items-center gap-2 flex-wrap" role="group" aria-label={label}><span className="text-[11px] text-white/40">{label} :</span>
      {FORMATS.map(([f, l]) => <button key={f} type="button" className="chip" disabled={busy !== null} aria-label={`${label} en ${l}`} onClick={() => void go(f)}>{busy === f ? "…" : l}</button>)}
      {err && <span className="text-[11px] text-red-400" role="alert">{err}</span>}</div>
  );
}
