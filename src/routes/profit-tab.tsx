import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Coins, Percent, Receipt, RefreshCw, ShoppingCart, TrendingUp, WifiOff } from "lucide-react";
import { ErrorState, KpiRow, KpiTile, LoadingState, Panel, type Delta } from "@/components/kit";
import { HBars, MultiLine } from "@/components/charts";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatFcfa } from "@/domain/money";
import { PRESETS, type PresetId } from "@/domain/overview";

type Group = { key: string; name: string; revenueHt: number; qty: number; cogs: number | null; margin: number | null; marginRate: number | null; markup: number | null; coveragePct: number; indicativeMargin: number; linesWithoutCost: number };
type Totals = { count: number; revenueHt: number; cogs: number | null; costedCogs: number; profit: number | null; partialProfit: number; partialMarginRate: number | null; partialMarkup: number | null; complete: boolean; marginRate: number | null; markup: number | null; coveragePct: number; linesTotal: number; linesWithoutCost: number };
type Point = { key: string; revenueHt: number; profit: number | null; partialProfit: number; complete: boolean };
export type GrossProfit = {
  tz: string; period: { from: string; to: string; label: string; days: number }; prevPeriod: { from: string; to: string } | null; truncated: boolean;
  scope: { shopId: string; shops: { id: string; name: string }[] }; totals: Totals;
  prevTotals: { revenueHt: number; profit: number | null; partialProfit: number; complete: boolean; marginRate: number | null; count: number } | null;
  deltas: { revenueHt: number | null; profit: number | null; profitIsPartial: boolean; marginRatePts: number | null } | null;
  series: Point[]; prevSeries: Point[]; best: Group[]; weak: Group[]; byCategory: Group[]; byShop: (Group & { name: string })[];
  contribution: { key: string; marginSharePct: number | null }[]; lowMargin: { thresholdPct: number; count: number; topArticles: { name: string; lines: number }[] };
  missingCost: { productId: string; name: string; lines: number; revenueHt: number }[]; notes: string[];
};
export type ProfitFilters = { preset: PresetId; setPreset: (p: PresetId) => void; from: string; setFrom: (v: string) => void; to: string; setTo: (v: string) => void; shop: string; setShop: (v: string) => void };

const dd = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const pct = (n: number | null, d = 1) => (n === null ? "—" : `${n.toLocaleString("fr-FR", { maximumFractionDigits: d })} %`);
const delta = (v: number | null | undefined, good = true): Delta | undefined => (v === null || v === undefined ? undefined : { text: `${v > 0 ? "+" : ""}${v.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`, dir: v >= 0 ? "up" : "down", good: v >= 0 === good });
const label = (key: string, gran: "day" | "month") => (gran === "day" ? dd(key) : key.slice(5) + "/" + key.slice(2, 4));

/** Onglet « Bénéfice brut » du tableau de bord : calculé par le serveur (action `dashboard.profit`), même moteur et mêmes coûts figés que la rentabilité du tableau Pro.
 *  Bénéfice brut = chiffre d'affaires HT − coût d'achat figé à la vente ; sans coût connu sur toutes les lignes il est « partiel » et la couverture est indiquée (aucun coût n'est inventé). */
export function ProfitTab({ f }: { f: ProfitFilters }) {
  const { session } = useSession(); const s = session!; const custom = f.preset === "custom"; const ready = !custom || (!!f.from && !!f.to && f.from <= f.to);
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  const q = useQuery({ queryKey: ["gross-profit", s.shopId, f.preset, custom ? f.from : "", custom ? f.to : "", f.shop], enabled: ready, placeholderData: keepPreviousData, retry: 1,
    queryFn: () => api<GrossProfit>(s, "dashboard.profit", { preset: f.preset, ...(custom ? { from: f.from, to: f.to } : {}), shopId: f.shop }) });
  const d = q.data; const t = d?.totals; const g = d ? (d.series.length > 62 ? "month" : "day") : "day";
  const profitValue = t ? (t.complete ? t.profit : t.partialProfit) : null; const partial = !!t && !t.complete && t.count > 0;
  const wide = typeof matchMedia === "function" && matchMedia("(min-width: 768px)").matches;
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Période du bénéfice brut" className="scroll-x">{PRESETS.map((p) => <button key={p.id} className="chip" aria-current={f.preset === p.id} onClick={() => f.setPreset(p.id)}>{p.label}</button>)}</nav>
      {custom && <div className="grid grid-cols-2 gap-2"><label className="text-xs text-muted">Du<input className="input mt-1" type="date" value={f.from} max={f.to || undefined} onChange={(e) => f.setFrom(e.target.value)} /></label><label className="text-xs text-muted">Au<input className="input mt-1" type="date" value={f.to} min={f.from || undefined} onChange={(e) => f.setTo(e.target.value)} /></label>{!ready && <p className="col-span-2 text-xs text-warn">Choisissez deux dates (début avant fin).</p>}</div>}
      {d && d.scope.shops.length > 1 && <label className="text-xs text-muted flex flex-col gap-1">Boutique<select className="input" value={f.shop} onChange={(e) => f.setShop(e.target.value)}>{d.scope.shops.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}<option value="all">Toutes mes boutiques</option></select></label>}
      {(offline || q.error) && <div className="card border border-warn/40 text-sm flex gap-2 items-start" role="alert"><WifiOff size={16} className="text-warn shrink-0 mt-0.5" /><span>{offline ? "Vous êtes hors ligne : cet onglet a besoin d'une connexion." : `Impossible de charger le bénéfice brut : ${(q.error as Error).message}`}</span><button className="btn-ghost !px-2 !py-1 ml-auto flex items-center gap-1" onClick={() => void q.refetch()}><RefreshCw size={14} />Réessayer</button></div>}
      {q.isLoading && ready && <LoadingState label="Calcul du bénéfice brut" />}
      {q.error && !d && !offline && <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />}
      {d && t && <>
        {d.truncated && <div className="card text-sm text-warn flex gap-2"><AlertTriangle size={16} />Volume de ventes très élevé : certaines ventes n'ont pas été lues, les totaux peuvent être partiels.</div>}
        {partial && <div className="card border border-warn/40 text-sm flex gap-2 items-start" role="status"><AlertTriangle size={16} className="text-warn shrink-0 mt-0.5" /><span><b>Bénéfice partiel.</b> Le coût d'achat est inconnu sur {t.linesWithoutCost} ligne(s) vendue(s) : le bénéfice ci-dessous porte sur les {t.coveragePct} % du chiffre d'affaires dont le coût est connu. Renseignez les coûts (liste en bas de page) pour le rendre complet.</span></div>}
        <KpiRow>
          <KpiTile icon={ShoppingCart} tint="blue" label="Chiffre d'affaires HT" value={formatFcfa(t.revenueHt)} sub={`${d.period.label} · ${t.count} vente(s)`} delta={delta(d.deltas?.revenueHt)} />
          <KpiTile icon={Receipt} tint="amber" label="Coût des marchandises vendues" value={formatFcfa(t.cogs ?? t.costedCogs)} sub={t.cogs === null ? `Partiel : coût connu sur ${t.coveragePct} % du CA` : "Coût d'achat figé à la vente"} />
          <KpiTile icon={TrendingUp} tint="green" label={partial ? "Bénéfice brut (partiel)" : "Bénéfice brut"} value={profitValue === null ? "—" : formatFcfa(profitValue)} sub={d.deltas ? `vs ${dd(d.prevPeriod!.from)} → ${dd(d.prevPeriod!.to)}${d.deltas.profitIsPartial ? " · comparaison partielle" : ""}` : "Aucune période de comparaison"} delta={delta(d.deltas?.profit)} />
          <KpiTile icon={Percent} tint="violet" label={partial ? "Taux de marge (partiel)" : "Taux de marge"} value={pct(partial ? t.partialMarginRate : t.marginRate)} sub={partial ? "Sur les lignes dont le coût est connu" : "Bénéfice ÷ chiffre d'affaires HT"} delta={d.deltas?.marginRatePts == null ? undefined : { text: `${d.deltas.marginRatePts > 0 ? "+" : ""}${d.deltas.marginRatePts.toLocaleString("fr-FR")} pt`, dir: d.deltas.marginRatePts >= 0 ? "up" : "down", good: d.deltas.marginRatePts >= 0 }} />
          <KpiTile icon={Coins} tint="blue" label={partial ? "Taux de marque (partiel)" : "Taux de marque"} value={pct(partial ? t.partialMarkup : t.markup)} sub={partial ? "Sur les lignes dont le coût est connu" : "Bénéfice ÷ coût d'achat"} />
        </KpiRow>
        <Panel title="Évolution du bénéfice brut" icon={TrendingUp}>
          <p className="text-xs text-muted -mt-2">Par {g === "day" ? "jour" : "mois"} · {dd(d.period.from)} → {dd(d.period.to)}{d.prevPeriod ? ` · période précédente en pointillé (${dd(d.prevPeriod.from)} → ${dd(d.prevPeriod.to)})` : ""}</p>
          {t.count > 0 ? <MultiLine w={wide ? 760 : 320} label="Bénéfice brut de la période, comparé à la période précédente" labels={d.series.map((x) => label(x.key, g))}
            series={[{ name: "Période", values: d.series.map((x) => (x.complete ? x.profit : x.partialProfit)) }, ...(d.prevSeries.some((x) => x.revenueHt > 0) ? [{ name: "Période précédente", values: d.series.map((_, i) => { const x = d.prevSeries[i]; return x ? (x.complete ? x.profit : x.partialProfit) : null; }), dashed: true }] : [])]} /> : <p className="text-sm text-muted py-6 text-center">Aucune vente sur cette période.</p>}
        </Panel>
        <div className="grid lg:grid-cols-2 gap-4 items-start">
          <Panel title="Articles qui rapportent le plus" icon={TrendingUp}>
            {d.best.length ? <HBars data={d.best.map((a) => ({ key: a.key, label: a.name, value: a.margin ?? a.indicativeMargin, sub: a.marginRate === null ? "coût partiel" : pct(a.marginRate) }))} /> : <p className="text-sm text-muted">Aucune vente avec coût connu sur la période.</p>}
          </Panel>
          <Panel title="Articles à faible marge" icon={Percent}>
            <p className="text-xs text-muted -mt-2">Taux de marge le plus bas, parmi les articles dont le coût est connu · seuil d'alerte {pct(d.lowMargin.thresholdPct, 0)} (Réglages)</p>
            {d.weak.length ? <ul className="flex flex-col divide-y divide-[var(--line)]">{d.weak.map((a) => <li key={a.key}><Link to="/articles" className="flex items-center justify-between gap-2 py-2 text-sm"><span className="truncate">{a.name}</span><span className={`shrink-0 font-semibold ${a.marginRate !== null && a.marginRate < d.lowMargin.thresholdPct ? "text-bad" : ""}`}>{pct(a.marginRate)} · {formatFcfa(a.margin ?? 0)}</span></Link></li>)}</ul> : <p className="text-sm text-muted">Aucun article à analyser sur la période.</p>}
            {d.lowMargin.count > 0 && <p className="text-xs text-warn">{d.lowMargin.count} ligne(s) de vente sous le seuil de marge{d.lowMargin.topArticles.length ? ` · surtout : ${d.lowMargin.topArticles.slice(0, 3).map((x) => x.name).join(", ")}` : ""}.</p>}
          </Panel>
        </div>
        <div className="grid lg:grid-cols-2 gap-4 items-start">
          <Panel title="Par catégorie" icon={Coins}>
            {d.byCategory.length ? <div className="overflow-x-auto"><table className="w-full text-sm min-w-[22rem]"><thead><tr className="text-left text-xs text-muted border-b border-line"><th scope="col" className="py-1.5 pr-2 font-medium">Catégorie</th><th scope="col" className="py-1.5 px-2 font-medium text-right">CA HT</th><th scope="col" className="py-1.5 px-2 font-medium text-right">Bénéfice</th><th scope="col" className="py-1.5 pl-2 font-medium text-right">Marge</th></tr></thead>
              <tbody>{d.byCategory.map((c) => <tr key={c.key} className="border-b border-line/60"><th scope="row" className="py-1.5 pr-2 text-left font-normal">{c.name || "Sans catégorie"}</th><td className="py-1.5 px-2 text-right">{formatFcfa(c.revenueHt)}</td><td className="py-1.5 px-2 text-right">{formatFcfa(c.margin ?? c.indicativeMargin)}{c.margin === null ? " *" : ""}</td><td className="py-1.5 pl-2 text-right">{pct(c.marginRate)}</td></tr>)}</tbody></table>
              {d.byCategory.some((c) => c.margin === null) && <p className="text-xs text-muted mt-1">* coût inconnu sur une partie des lignes : bénéfice partiel.</p>}</div> : <p className="text-sm text-muted">Aucune vente sur la période.</p>}
          </Panel>
          {d.byShop.length > 1 && <Panel title="Par boutique" icon={ShoppingCart}>
            <ul className="flex flex-col divide-y divide-[var(--line)]">{d.byShop.map((b) => <li key={b.key} className="flex items-center justify-between gap-2 py-2 text-sm"><span className="truncate">{b.name}</span><span className="shrink-0 font-semibold">{formatFcfa(b.margin ?? b.indicativeMargin)}{b.margin === null ? " *" : ""} <span className="text-muted font-normal">· {pct(b.marginRate)}</span></span></li>)}</ul></Panel>}
        </div>
        <Panel title="Fiabilité du calcul" icon={AlertTriangle}>
          <p className="text-sm">{t.linesTotal === 0 ? "Aucune ligne vendue sur la période." : t.linesWithoutCost === 0 ? `Les ${t.linesTotal} ligne(s) vendue(s) ont toutes un coût d'achat connu : le bénéfice brut est complet.` : `${t.linesTotal - t.linesWithoutCost} ligne(s) sur ${t.linesTotal} ont un coût connu (${t.coveragePct} % du chiffre d'affaires).`}</p>
          {d.missingCost.length > 0 && <><p className="text-xs text-muted">Articles vendus sans coût d'achat connu (ouvrez la fiche pour renseigner le coût) :</p>
            <ul className="flex flex-col divide-y divide-[var(--line)]">{d.missingCost.map((m) => <li key={m.productId}><Link to="/articles" className="flex justify-between gap-2 py-2 text-sm"><span className="truncate">{m.name}</span><span className="shrink-0 text-muted">{m.lines} ligne(s) · {formatFcfa(m.revenueHt)} HT</span></Link></li>)}</ul></>}
          <ul className="text-xs text-muted list-disc pl-4">{d.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </Panel>
      </>}
    </div>
  );
}
