/** MASTER DOGUI — étape 3 : profil d'entreprise. Consultable par le propriétaire et les gérants ; modifiable par le propriétaire (licence valide). */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { KIND_LABEL, type FactDef, type FactKind } from "@/domain/master-profile";

type Fact = { id: string; key: string; label: string; shopId: string; shopName: string; value: string; text: string; kind: FactKind; source: string; updatedAt: string; confirmedAt: string | null };
type Ver = { label: string; value: string; source: string; readAt: string };
type P = { canEdit: boolean; readOnlyReason: string | null; catalog: FactDef[]; shops: { id: string; name: string }[]; facts: Fact[]; verified: Ver[] };
const fmt = (d: string) => (d ? new Date(d).toLocaleDateString("fr-FR") : "—");
const TONE: Record<FactKind | "verified", string> = { verified: "text-ok", declared: "text-info", hypothesis: "text-warn", estimate: "text-warn" };

function Editor({ p, def, fact, onDone }: { p: P; def: FactDef; fact?: Fact; onDone: () => void }) {
  const { session } = useSession(); const s = session!; const qc = useQueryClient();
  const init = (): string | string[] => { if (!fact) return def.type === "multi" || def.type === "months" ? [] : ""; if (def.type === "multi" || def.type === "months") { try { return (JSON.parse(fact.value) as (string | number)[]).map(String); } catch { return []; } } return fact.value; };
  const [val, setVal] = useState<string | string[]>(init()); const [kind, setKind] = useState<FactKind>(fact?.kind ?? "declared"); const [shop, setShop] = useState(fact?.shopId ?? ""); const [err, setErr] = useState("");
  const save = useMutation({ mutationFn: () => api(s, "md.profile.set", { key: def.key, value: def.type === "months" ? (val as string[]).map(Number) : val, kind, shopId: shop || undefined }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["md", "profile"] }); onDone(); }, onError: (e) => setErr((e as Error).message) });
  const toggle = (k: string) => setVal((cur) => { const a = cur as string[]; return a.includes(k) ? a.filter((x) => x !== k) : [...a, k]; });
  const opts: [string, string][] = def.type === "months" ? ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"].map((m, i) => [String(i + 1), m]) : def.options ?? [];
  return (
    <div className="card flex flex-col gap-2 text-sm"><b>{def.label}</b>{def.help && <p className="text-xs text-muted">{def.help}</p>}
      {def.type === "text" && <input className="input" aria-label={def.label} maxLength={def.maxLen} value={val as string} onChange={(e) => setVal(e.target.value)} />}
      {def.type === "enum" && <select className="input" aria-label={def.label} value={val as string} onChange={(e) => setVal(e.target.value)}><option value="">Choisir…</option>{opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
      {(def.type === "multi" || def.type === "months") && <div className="flex flex-wrap gap-2" role="group" aria-label={def.label}>{opts.map(([k, l]) => <button key={k} type="button" className="chip" aria-pressed={(val as string[]).includes(k)} aria-current={(val as string[]).includes(k)} onClick={() => toggle(k)}>{l}</button>)}</div>}
      {def.shop && <label className="text-xs text-muted flex flex-col gap-1">Portée<select className="input" aria-label="Portée" value={shop} onChange={(e) => setShop(e.target.value)} disabled={!!fact}><option value="">Toute l'entreprise</option>{p.shops.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
      <label className="text-xs text-muted flex flex-col gap-1">Qualification<select className="input" aria-label="Qualification" value={kind} onChange={(e) => setKind(e.target.value as FactKind)}>{(["declared", "hypothesis", "estimate"] as FactKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></label>
      {err && <p className="text-bad" role="alert">{err}</p>}<div className="flex gap-2"><button className="btn" disabled={save.isPending} onClick={() => save.mutate()}>Enregistrer</button><button className="btn-ghost" onClick={onDone}>Annuler</button></div></div>
  );
}

export function Profil() {
  const { session } = useSession(); const s = session!; const qc = useQueryClient(); const [edit, setEdit] = useState<{ def: FactDef; fact?: Fact } | null>(null); const [err, setErr] = useState("");
  const q = useQuery({ queryKey: ["md", "profile", s.tenantId], retry: 1, queryFn: () => api<P>(s, "md.profile", {}) });
  const act = useMutation({ mutationFn: (a: { action: "md.profile.confirm" | "md.profile.delete"; id: string }) => api(s, a.action, { id: a.id }), onSuccess: () => { setErr(""); void qc.invalidateQueries({ queryKey: ["md", "profile"] }); }, onError: (e) => setErr((e as Error).message) });
  if (q.error) return <p className="text-bad text-sm" role="alert">{(q.error as Error).message}</p>; if (!q.data) return <div className="card h-32 animate-pulse bg-subtle" aria-busy="true" />; const p = q.data;
  const missing = p.catalog.filter((d) => !p.facts.some((f) => f.key === d.key && !f.shopId));
  return (
    <div className="flex flex-col gap-3"><div><h1 className="text-lg font-semibold">Profil de l'entreprise</h1><p className="text-xs text-muted">Ce que MASTER DOGUI retient de votre entreprise, qualifié et modifiable. Aucune information n'est partagée avec une autre entreprise.</p></div>
      {p.readOnlyReason && <p className="card text-xs text-warn" role="status">{p.readOnlyReason}</p>}{err && <p className="text-bad text-sm" role="alert">{err}</p>}
      {edit && <Editor p={p} def={edit.def} fact={edit.fact} onDone={() => setEdit(null)} />}
      <div className="card text-sm flex flex-col gap-1"><b className={TONE.verified}>{KIND_LABEL.verified}</b><p className="text-xs text-muted">Lu dans vos modules à l'instant, jamais recopié ni modifiable ici.</p>{p.verified.map((v) => <p key={v.label} className="text-xs border-t border-line pt-1"><span className="text-muted">{v.label} : </span><b>{v.value}</b> <span className="text-muted">· {v.source}</span></p>)}</div>
      <div className="card text-sm flex flex-col gap-1"><b>Informations mémorisées</b>{p.facts.length === 0 && <p className="text-xs text-muted">Rien de mémorisé pour l'instant.</p>}
        {p.facts.map((f) => { const def = p.catalog.find((d) => d.key === f.key)!; return (
          <div key={f.id} className="border-t border-line pt-2 flex flex-col gap-1"><div className="flex justify-between gap-2"><span className="text-muted text-xs">{f.label}{f.shopName ? ` · ${f.shopName}` : ""}</span><b className={`text-xs ${TONE[f.kind]}`}>{KIND_LABEL[f.kind]}</b></div><p>{f.text}</p><p className="text-xs text-muted">Source : {f.source === "owner" ? "propriétaire" : f.source} · {fmt(f.updatedAt)}{f.confirmedAt ? ` · confirmé le ${fmt(f.confirmedAt)}` : ""}</p>
            {p.canEdit && <div className="flex gap-2 flex-wrap"><button className="btn-ghost" onClick={() => setEdit({ def, fact: f })}>Modifier</button>{f.kind !== "declared" && <button className="btn-ghost" disabled={act.isPending} onClick={() => act.mutate({ action: "md.profile.confirm", id: f.id })}>Confirmer</button>}<button className="btn-ghost" disabled={act.isPending} onClick={() => { if (confirm("Supprimer définitivement cette information ? Les rapports déjà produits ne changent pas.")) act.mutate({ action: "md.profile.delete", id: f.id }); }}>Supprimer</button></div>}</div>); })}</div>
      {p.canEdit && missing.length > 0 && <div className="card text-sm flex flex-col gap-2"><b>À renseigner (facultatif)</b><div className="flex flex-wrap gap-2">{missing.map((d) => <button key={d.key} className="chip" onClick={() => setEdit({ def: d })}>{d.label}</button>)}</div></div>}
    </div>
  );
}
