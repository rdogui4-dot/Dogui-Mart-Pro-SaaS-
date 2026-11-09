import { useState } from "react";
import { formatFcfa } from "@/domain/money";

/** Palette cohérente avec Dogui Mart Pro (or en tête), lisible sur fond sombre. */
export const PALETTE = ["#d4af37", "#4fb3a5", "#6c8cff", "#e07a5f", "#a78bfa", "#9aa3b2"];
const short = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(".0", "")} M` : n >= 1000 ? `${Math.round(n / 1000)} k` : String(n));

/** Histogramme interactif (toucher une barre affiche sa valeur). Axe à zéro, valeurs réelles uniquement. */
export function BarChart({ data, label, format = formatFcfa }: { data: { key: string; label: string; value: number; sub?: string }[]; label: string; format?: (n: number) => string }) {
  const [sel, setSel] = useState<number | null>(null); const max = Math.max(1, ...data.map((d) => d.value)); const W = 320, H = 130, P = 6; const bw = (W - P * 2) / Math.max(1, data.length);
  const cur = sel !== null ? data[sel] : undefined;
  return (
    <div>
      <div className="text-xs text-white/60 h-4" aria-live="polite">{cur ? `${cur.label} : ${format(cur.value)}${cur.sub ? ` · ${cur.sub}` : ""}` : `Max ${format(max)} · touchez une barre`}</div>
      <svg viewBox={`0 0 ${W} ${H + 16}`} className="w-full" role="img" aria-label={label}>
        <line x1={P} y1={H} x2={W - P} y2={H} stroke="currentColor" strokeOpacity={0.25} />
        {data.map((d, i) => { const h = d.value > 0 ? Math.max(2, (d.value / max) * (H - 14)) : 0; const x = P + i * bw; return (
          <g key={d.key} onClick={() => setSel(sel === i ? null : i)} style={{ cursor: "pointer" }}>
            <rect x={x} y={0} width={bw} height={H} fill="transparent" />
            <rect x={x + bw * 0.15} y={H - h} width={bw * 0.7} height={h} rx={2} fill={PALETTE[0]} fillOpacity={sel === null || sel === i ? 1 : 0.35} />
            {(data.length <= 10 || i % Math.ceil(data.length / 8) === 0) && <text x={x + bw / 2} y={H + 12} textAnchor="middle" fontSize={8} fill="currentColor" fillOpacity={0.6}>{d.label}</text>}
          </g>); })}
      </svg>
    </div>
  );
}

/** Courbe de période (aire) interactive : glisser/toucher pour lire un jour. */
export function LineChart({ data, label }: { data: { key: string; label: string; value: number; sub?: string }[]; label: string }) {
  const [sel, setSel] = useState<number | null>(null); const max = Math.max(1, ...data.map((d) => d.value)); const W = 320, H = 120, P = 6; const step = data.length > 1 ? (W - P * 2) / (data.length - 1) : 0;
  const pts = data.map((d, i) => [P + i * step, H - 4 - (d.value / max) * (H - 18)] as const); const path = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const cur = sel !== null ? data[sel] : undefined;
  const pick = (e: React.PointerEvent<SVGSVGElement>) => { const r = e.currentTarget.getBoundingClientRect(); const x = ((e.clientX - r.left) / r.width) * W; setSel(Math.max(0, Math.min(data.length - 1, Math.round((x - P) / (step || 1))))); };
  return (
    <div>
      <div className="text-xs text-white/60 h-4" aria-live="polite">{cur ? `${cur.label} : ${formatFcfa(cur.value)}${cur.sub ? ` · ${cur.sub}` : ""}` : `Max ${formatFcfa(max)} · touchez le graphique`}</div>
      <svg viewBox={`0 0 ${W} ${H + 16}`} className="w-full touch-none" role="img" aria-label={label} onPointerDown={pick} onPointerMove={(e) => e.buttons && pick(e)}>
        <line x1={P} y1={H} x2={W - P} y2={H} stroke="currentColor" strokeOpacity={0.25} />
        {data.length > 1 && <><path d={`${path} L${pts.at(-1)![0]},${H} L${pts[0]![0]},${H} Z`} fill={PALETTE[0]} fillOpacity={0.15} /><path d={path} fill="none" stroke={PALETTE[0]} strokeWidth={2} strokeLinejoin="round" /></>}
        {data.length === 1 && <circle cx={W / 2} cy={pts[0]![1]} r={4} fill={PALETTE[0]} />}
        {sel !== null && <><line x1={pts[sel]![0]} y1={0} x2={pts[sel]![0]} y2={H} stroke={PALETTE[0]} strokeOpacity={0.5} /><circle cx={pts[sel]![0]} cy={pts[sel]![1]} r={4} fill={PALETTE[0]} /></>}
        <text x={P} y={H + 12} fontSize={8} fill="currentColor" fillOpacity={0.6}>{data[0]?.label}</text><text x={W - P} y={H + 12} textAnchor="end" fontSize={8} fill="currentColor" fillOpacity={0.6}>{data.at(-1)?.label}</text>
        <text x={W - P} y={10} textAnchor="end" fontSize={8} fill="currentColor" fillOpacity={0.5}>{short(max)}</text>
      </svg>
    </div>
  );
}

/** Anneau de répartition avec légende (parts réelles, somme = 100 %). */
export function Donut({ data, label }: { data: { key: string; label: string; value: number }[]; label: string }) {
  const [sel, setSel] = useState<string | null>(null); const total = data.reduce((a, d) => a + d.value, 0); const R = 42, C = 2 * Math.PI * R; let off = 0;
  if (!(total > 0)) return null;
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 120 120" className="w-28 h-28 shrink-0 -rotate-90" role="img" aria-label={label}>
        {data.map((d, i) => { const len = (d.value / total) * C; const el = <circle key={d.key} cx={60} cy={60} r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth={sel === d.key ? 20 : 16} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} opacity={sel && sel !== d.key ? 0.4 : 1} onClick={() => setSel(sel === d.key ? null : d.key)} style={{ cursor: "pointer" }} />; off += len; return el; })}
      </svg>
      <ul className="flex-1 min-w-0 flex flex-col gap-1 text-sm">{data.map((d, i) => <li key={d.key}><button className="flex items-center gap-2 w-full text-left" onClick={() => setSel(sel === d.key ? null : d.key)}><span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} /><span className="truncate flex-1">{d.label}</span><span className="text-white/70 shrink-0">{Math.round((d.value / total) * 1000) / 10} %</span></button>{sel === d.key && <div className="text-xs text-white/50 pl-4">{formatFcfa(d.value)}</div>}</li>)}</ul>
    </div>
  );
}

/** Barres horizontales classées (top articles, catégories). */
export function HBars({ data, unit = "" }: { data: { key: string; label: string; value: number; sub?: string }[]; unit?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return <ul className="flex flex-col gap-2">{data.map((d, i) => <li key={d.key}><div className="flex justify-between gap-2 text-sm"><span className="truncate">{i + 1}. {d.label}</span><span className="shrink-0">{formatFcfa(d.value)}{unit}</span></div><div className="h-2 rounded bg-white/10"><div className="h-2 rounded" style={{ width: `${Math.max(2, (d.value / max) * 100)}%`, background: PALETTE[i % PALETTE.length] }} /></div>{d.sub && <div className="text-xs text-white/50">{d.sub}</div>}</li>)}</ul>;
}
