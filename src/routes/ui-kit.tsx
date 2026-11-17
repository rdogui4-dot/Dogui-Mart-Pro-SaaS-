/** Page de référence interne du système de design (lot K0) : tous les composants du kit et leurs états.
 *  Réservée aux administrateurs de la plateforme (jamais visible d'un commerçant). Les valeurs affichées sont des exemples de mise en page, signalés comme tels. */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Banknote, Boxes, ClipboardList, Eye, LayoutGrid, Package, Pencil, Plus, ShoppingCart, Trash2, Truck, Users, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { BulkBar, DeniedState, DetailLayout, ErrorState, FilterBar, FilterSelect, InsightCard, KitTable, KpiRow, KpiTile, LoadingState, LockedState, ModuleHeader, Pagination, Panel, PartialNotice, PillTabs, RowAction, StatusBadge, Stepper, SuccessNotice, TabPanel, type StatusTone } from "@/components/kit";
import { ForbiddenPage } from "@/routes/shell-pages";

type Row = { id: string; ref: string; party: string; date: string; amount: number; status: [StatusTone, string] };
const SAMPLE: Row[] = [
  { id: "a", ref: "EX-0001", party: "Fournisseur exemple A", date: "—", amount: 125000, status: ["ok", "Réceptionnée"] },
  { id: "b", ref: "EX-0002", party: "Fournisseur exemple B", date: "—", amount: 48000, status: ["info", "En réception"] },
  { id: "c", ref: "EX-0003", party: "Fournisseur exemple C", date: "—", amount: 9500, status: ["progress", "En cours"] },
  { id: "d", ref: "EX-0004", party: "Fournisseur exemple D", date: "—", amount: 0, status: ["muted", "Brouillon"] },
  { id: "e", ref: "EX-0005", party: "Fournisseur exemple E", date: "—", amount: 30000, status: ["bad", "Annulée"] },
];
const fcfa = (n: number) => `${new Intl.NumberFormat("fr-FR").format(n)} F`;
type T = "composants" | "etats" | "tableau";

export function UiKitPage() {
  const { session } = useSession();
  const me = useQuery({ queryKey: ["platform-me"], queryFn: () => api<{ admin: boolean }>(session!, "platform.me", {}), staleTime: 300_000, enabled: !!session });
  const [tab, setTab] = useState<T>("composants"); const [q, setQ] = useState(""); const [st, setSt] = useState("all");
  const [sel, setSel] = useState<Set<string>>(new Set()); const [page, setPage] = useState(1); const [open, setOpen] = useState<Row | null>(null);
  if (me.isLoading) return <LoadingState label="Vérification de l'accès" />;
  if (!me.data?.admin && !import.meta.env.DEV) return <ForbiddenPage />;
  const rows = SAMPLE.filter((r) => (st === "all" || r.status[0] === st) && r.party.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="flex flex-col gap-5">
      <ModuleHeader icon={LayoutGrid} title="Système de design" subtitle="Page interne : composants du kit et états obligatoires. Les valeurs sont des exemples de mise en page."
        actions={<><button type="button" className="btn-ghost inline-flex items-center gap-2"><Truck size={18} aria-hidden="true" />Action secondaire</button><button type="button" className="btn-gold"><Plus size={18} aria-hidden="true" />Action principale</button></>} />
      <KpiRow>
        <KpiTile icon={ShoppingCart} tint="blue" label="Indicateur (exemple)" value="125 000 F" sub="Ce mois · source serveur" delta={{ text: "+4,2 %", dir: "up", good: true }} />
        <KpiTile icon={Users} tint="amber" label="Compteur (exemple)" value="37" sub="Actifs" />
        <KpiTile icon={ClipboardList} tint="violet" label="En cours (exemple)" value="6" />
        <KpiTile icon={Wallet} tint="rose" label="Variation défavorable" value="48 000 F" delta={{ text: "+6,1 %", dir: "up", good: false }} />
        <KpiTile icon={Banknote} tint="green" label="Chargement" value="" loading />
      </KpiRow>
      <PillTabs idBase="kit" label="Sections de la page de référence" value={tab} onChange={setTab} items={[{ key: "composants", label: "Composants", icon: Boxes }, { key: "tableau", label: "Tableau", icon: ClipboardList, count: SAMPLE.length }, { key: "etats", label: "États", icon: Package }]} />
      <TabPanel idBase="kit" active={tab}>
        {tab === "composants" && (
          <div className="grid lg:grid-cols-3 gap-4">
            <Panel title="Badges de statut" icon={ClipboardList}>
              <div className="flex flex-wrap gap-2">{(["ok", "info", "progress", "warn", "bad", "muted"] as StatusTone[]).map((t) => <StatusBadge key={t} tone={t}>{{ ok: "Payée", info: "En réception", progress: "En cours", warn: "Écart", bad: "Annulée", muted: "Brouillon" }[t]}</StatusBadge>)}</div>
            </Panel>
            <Panel title="Boutons" icon={Plus}>
              <div className="flex flex-wrap gap-2"><button type="button" className="btn-gold">Principale</button><button type="button" className="btn">Bleu</button><button type="button" className="btn-ghost">Secondaire</button><button type="button" className="btn" disabled>Désactivé</button></div>
            </Panel>
            <Panel title="Étapes" icon={ClipboardList}><Stepper label="Exemple d'étapes" steps={["Compte", "Entreprise", "Boutique"]} current={1} /></Panel>
            <div className="lg:col-span-2"><InsightCard module="Exemple" source="calcul du serveur sur les ventes de la boutique active" items={[{ id: "1", text: "Constat favorable (exemple).", tone: "ok" }, { id: "2", text: "Point d'attention (exemple).", tone: "warn", to: "#", toLabel: "Ouvrir l'écran concerné" }]} /></div>
            <InsightCard module="Sans constat" source="calcul du serveur" items={[]} />
          </div>
        )}
        {tab === "tableau" && (
          <DetailLayout placeholder="Sélectionnez une ligne pour ouvrir le panneau de détail." panel={open ? { title: `Détail ${open.ref}`, onClose: () => setOpen(null), footer: <><button type="button" className="btn flex-1">Enregistrer</button><button type="button" className="btn-ghost flex-1" onClick={() => setOpen(null)}>Annuler</button></>, children: <><p className="text-sm">{open.party}</p><StatusBadge tone={open.status[0]}>{open.status[1]}</StatusBadge></> } : null}>
              <FilterBar query={q} onQuery={setQ} placeholder="Rechercher (exemple)"><FilterSelect label="Statut" value={st} onChange={setSt} options={[{ value: "all", label: "Tous" }, { value: "ok", label: "Réceptionnée" }, { value: "progress", label: "En cours" }, { value: "bad", label: "Annulée" }]} /></FilterBar>
              <BulkBar count={sel.size} onClear={() => setSel(new Set())}><button type="button" className="btn-ghost !min-h-9 !py-1 text-sm">Exporter (exemple)</button></BulkBar>
              <KitTable label="Tableau d'exemple" rows={rows} rowKey={(r) => r.id} selected={sel} onSelect={setSel} onRow={setOpen}
                columns={[{ key: "ref", label: "N°", nowrap: true, cell: (r) => <b className="text-accent-text">{r.ref}</b> }, { key: "party", label: "Tiers", cell: (r) => r.party }, { key: "date", label: "Date", cell: (r) => r.date, hideBelow: "lg", nowrap: true }, { key: "amount", label: "Montant (F CFA)", align: "right", cell: (r) => fcfa(r.amount) }, { key: "st", label: "Statut", align: "center", cell: (r) => <StatusBadge tone={r.status[0]}>{r.status[1]}</StatusBadge> }]}
                actions={(r) => <><RowAction icon={Eye} label={`Voir ${r.ref}`} onClick={() => setOpen(r)} /><RowAction icon={Pencil} label={`Modifier ${r.ref}`} onClick={() => setOpen(r)} /><RowAction icon={Trash2} danger label={`Supprimer ${r.ref}`} onClick={() => setOpen(r)} /></>}
                renderCard={(r) => <button type="button" className="w-full text-left flex items-center gap-3" onClick={() => setOpen(r)}><div className="flex-1 min-w-0"><b className="block">{r.ref}</b><span className="text-sm text-soft truncate block">{r.party}</span></div><div className="text-right"><b className="block tabular-nums">{fcfa(r.amount)}</b><StatusBadge tone={r.status[0]}>{r.status[1]}</StatusBadge></div></button>} />
              <Pagination page={page} pageSize={5} total={23} onPage={setPage} />
          </DetailLayout>
        )}
        {tab === "etats" && (
          <div className="grid md:grid-cols-2 gap-4">
            <LoadingState label="Chargement (exemple)" />
            <ErrorState message="Le serveur n'a pas répondu. Vos données ne sont pas modifiées." onRetry={() => undefined} />
            <div className="flex flex-col gap-3"><PartialNotice missing={["ventes hors ligne non synchronisées"]} /><SuccessNotice>Enregistré (affiché seulement après la réponse du serveur).</SuccessNotice></div>
            <DeniedState />
            <LockedState feature="Fonction avancée (exemple)" plan="Pro" />
            <div className="card flex flex-col items-center gap-2 text-center py-8"><b>Aucun élément</b><p className="text-sm text-muted">État vide : rien n'est encore enregistré.</p><button type="button" className="btn-gold"><Plus size={18} aria-hidden="true" />Créer le premier</button></div>
          </div>
        )}
      </TabPanel>
    </div>
  );
}
