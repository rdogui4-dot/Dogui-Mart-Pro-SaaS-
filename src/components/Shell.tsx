import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, CircleHelp, Search } from "lucide-react";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { SPACES, itemsOf, matchesItem, type NavItem, type Space } from "@/lib/nav";
import { MasterModalCtx } from "@/lib/master-modal";
import { Sheet } from "./ui";

declare const __BUILD_DATE__: string;
type Who = Parameters<typeof itemsOf>[1];

/** Fil d'Ariane (≥ 768 px) : Accueil › Espace › Page. Les liens mènent à des pages réelles ; la page courante n'est pas un lien. */
export function Breadcrumb({ path, session, plan }: { path: string; session: Who; plan?: string }) {
  if (path.startsWith("/accueil")) return null;
  const sp = SPACES.find((s) => path === `/espace/${s.id}`) ?? SPACES.find((s) => s.items.some((i) => matchesItem(i, path)));
  const item = sp?.items.find((i) => matchesItem(i, path));
  if (!sp) return null;
  const spaceVisible = itemsOf(sp, session, plan).length > 0;
  return (
    <nav aria-label="Fil d'Ariane" className="text-xs text-muted">
      <ol className="flex items-center gap-1 min-w-0">
        <li><Link to="/accueil" className="hover:underline">Accueil</Link></li>
        <li aria-hidden="true"><ChevronRight size={12} /></li>
        <li className="truncate">{item && spaceVisible ? <Link to="/espace/$id" params={{ id: sp.id }} className="hover:underline">{sp.label}</Link> : <span aria-current={item ? undefined : "page"}>{sp.label}</span>}</li>
        {item && <><li aria-hidden="true"><ChevronRight size={12} /></li><li className="truncate text-soft" aria-current="page">{item.label}</li></>}
      </ol>
    </nav>
  );
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
type Hit = { item: NavItem; space: Space };

/** Recherche des pages autorisées (Ctrl + K) : uniquement les modules réellement accessibles avec ce profil et cette formule. */
export function SearchButton({ session, plan }: { session: Who; plan?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { const f = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(true); } }; window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f); }, []);
  return <>
    <button type="button" className="btn-ghost icon-btn md:!px-3 md:gap-2 md:w-auto text-sm" aria-label="Rechercher une page (Ctrl + K)" aria-haspopup="dialog" onClick={() => setOpen(true)}><Search size={17} /><span className="hidden lg:inline text-muted">Rechercher</span><kbd className="hidden lg:inline text-xs text-muted border border-line rounded px-1">Ctrl K</kbd></button>
    {open && <SearchDialog session={session} plan={plan} onClose={() => setOpen(false)} />}
  </>;
}

function SearchDialog({ session, plan, onClose }: { session: Who; plan?: string; onClose: () => void }) {
  const [q, setQ] = useState(""); const [sel, setSel] = useState(0); const nav = useNavigate(); const master = useContext(MasterModalCtx); const input = useRef<HTMLInputElement>(null);
  const all = useMemo<Hit[]>(() => SPACES.flatMap((space) => itemsOf(space, session, plan).map((item) => ({ item, space }))), [session, plan]);
  const hits = useMemo(() => { const t = fold(q.trim()); return t ? all.filter((h) => fold(`${h.item.label} ${h.item.hint} ${h.space.label}`).includes(t)) : all; }, [q, all]);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => setSel(0), [q]);
  const go = (h?: Hit) => { if (!h) return; onClose(); if (h.item.modal) master.open(); else void nav({ to: h.item.to }); };
  return (
    <Sheet title="Aller à une page" onClose={onClose}>
      <div className="flex flex-col gap-2">
        <input ref={input} className="input" aria-label="Rechercher une page" placeholder="Ex. caisse, factures, inventaire" value={q} onChange={(e) => setQ(e.target.value)}
          role="combobox" aria-expanded="true" aria-controls="dmp-search-list" aria-activedescendant={hits[sel] ? `dmp-hit-${sel}` : undefined}
          onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)); } else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); } else if (e.key === "Enter") { e.preventDefault(); go(hits[sel]); } }} />
        <ul id="dmp-search-list" role="listbox" aria-label="Pages" className="flex flex-col gap-1">
          {hits.map((h, i) => <li key={h.item.to} id={`dmp-hit-${i}`} role="option" aria-selected={i === sel}>
            <button type="button" tabIndex={-1} className={`w-full text-left rounded-lg px-3 py-2 ${i === sel ? "bg-accent-soft" : "hover:bg-subtle"}`} onMouseEnter={() => setSel(i)} onClick={() => go(h)}>
              <span className="font-medium">{h.item.label}</span> <span className="text-xs text-muted">· {h.space.label}</span><span className="block text-xs text-muted">{h.item.hint}</span>
            </button></li>)}
        </ul>
        {!hits.length && <p className="text-sm text-muted">Aucune page accessible ne correspond à « {q} ».</p>}
        <p className="text-xs text-muted">Seules les pages autorisées pour votre profil et votre formule sont proposées. Flèches pour choisir, Entrée pour ouvrir.</p>
      </div>
    </Sheet>
  );
}

/** Aide : raccourcis réels, guide de démarrage, présentation, contact et version. Aucune promesse de service non fourni. */
export function HelpButton() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="btn-ghost icon-btn" aria-label="Aide" aria-haspopup="dialog" onClick={() => setOpen(true)}><CircleHelp size={18} /></button>
    {open && <Sheet title="Aide" onClose={() => setOpen(false)}>
      <div className="flex flex-col gap-4 text-sm">
        <section className="flex flex-col gap-1"><h3 className="font-semibold">Bien démarrer</h3><p className="text-muted">La liste « Bien démarrer » de l'accueil suit vos étapes réelles : boutique, premier article, caisse, première vente, collaborateur.</p><Link to="/accueil" className="text-accent-text underline self-start" onClick={() => setOpen(false)}>Ouvrir l'accueil</Link></section>
        <section className="flex flex-col gap-1"><h3 className="font-semibold">Raccourcis clavier</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt><kbd className="border border-line rounded px-1.5 text-xs">Ctrl K</kbd></dt><dd>Rechercher une page</dd>
            <dt><kbd className="border border-line rounded px-1.5 text-xs">F2</kbd></dt><dd>Caisse : aller à la recherche d'articles</dd>
            <dt><kbd className="border border-line rounded px-1.5 text-xs">F4</kbd></dt><dd>Caisse : encaisser (avec confirmation)</dd>
            <dt><kbd className="border border-line rounded px-1.5 text-xs">F8</kbd></dt><dd>Caisse : vider le panier (avec confirmation)</dd>
            <dt><kbd className="border border-line rounded px-1.5 text-xs">Échap</kbd></dt><dd>Fermer la fenêtre ouverte</dd>
          </dl></section>
        <section className="flex flex-col gap-1"><h3 className="font-semibold">Découvrir le produit</h3><a className="text-accent-text underline self-start" href={`${import.meta.env.BASE_URL}presentation/`}>Page de présentation de Dogui Mart Pro</a></section>
        <section className="flex flex-col gap-1"><h3 className="font-semibold">Nous contacter</h3><a className="text-accent-text underline self-start" href="https://wa.me/2250544165418" rel="noopener" target="_blank">WhatsApp : +225 05 44 16 54 18</a></section>
        <p className="text-xs text-muted">Version du {__BUILD_DATE__.split("-").reverse().join("/")}</p>
      </div>
    </Sheet>}
  </>;
}
