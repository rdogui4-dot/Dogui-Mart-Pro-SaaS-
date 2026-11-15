import { Link, useParams } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useSession } from "@/lib/session";
import { SPACES, itemsOf } from "@/lib/nav";
import { useSubscription } from "./subscription";
import { EmptyState, PageHeader } from "@/components/ui";

/** Liste des modules d'un espace (même rendu sur téléphone et ordinateur). */
export function SpacePage() {
  const { id } = useParams({ strict: false }) as { id?: string };
  const { session } = useSession();
  const plan = useSubscription().data?.entitlement.plan.id;
  const space = SPACES.find((s) => s.id === id);
  if (!space) return <NotFoundPage />;
  const items = itemsOf(space, session, plan);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={space.label} subtitle={space.hint} />
      {items.length === 0
        ? <EmptyState title="Aucun module disponible" hint="Votre profil ou votre formule ne donne accès à aucun module de cet espace. Demandez au gérant principal d'ajuster vos droits." action={<Link to="/accueil" className="btn-ghost">Retour à l'accueil</Link>} />
        : <ul className="flex flex-col gap-2">{items.map((it) => (
            <li key={it.to}><Link to={it.to} className="card flex items-center justify-between gap-3 hover:bg-subtle"><span><b>{it.label}</b><br /><span className="text-sm text-muted">{it.hint}</span></span><ChevronRight size={18} className="text-muted shrink-0" /></Link></li>
          ))}</ul>}
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="max-w-md mx-auto py-12 flex flex-col gap-4 text-center items-center">
      <p className="text-5xl font-bold text-muted" aria-hidden="true">404</p>
      <h1 className="text-xl font-bold">Page introuvable</h1>
      <p className="text-sm text-muted">L'adresse demandée n'existe pas ou a changé. Vos données ne sont pas concernées.</p>
      <Link to="/accueil" className="btn">Revenir à l'accueil</Link>
    </div>
  );
}

export function ForbiddenPage() {
  return (
    <div className="max-w-md mx-auto py-12 flex flex-col gap-4 text-center items-center" role="alert">
      <h1 className="text-xl font-bold">Accès non autorisé</h1>
      <p className="text-sm text-muted">Votre profil n'a pas accès à cette page. Si vous en avez besoin, demandez au gérant principal d'ajouter ce module à vos droits.</p>
      <Link to="/accueil" className="btn">Revenir à l'accueil</Link>
    </div>
  );
}

/** Erreur d'affichage inattendue : message clair, aucune donnée perdue (les ventes hors ligne restent en file). */
export function ErrorPage({ error }: { error?: unknown }) {
  const msg = error instanceof Error ? error.message : "";
  return (
    <div className="max-w-md mx-auto py-12 flex flex-col gap-4 text-center items-center" role="alert">
      <h1 className="text-xl font-bold">Un problème est survenu</h1>
      <p className="text-sm text-muted">Cette page n'a pas pu s'afficher. Vos données et les ventes enregistrées hors ligne sont conservées.</p>
      {msg && <p className="text-xs text-muted break-words">Détail : {msg.slice(0, 160)}</p>}
      <div className="flex gap-2"><button className="btn" onClick={() => location.reload()}>Recharger</button><a className="btn-ghost inline-flex items-center" href=".">Accueil</a></div>
    </div>
  );
}
