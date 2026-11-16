/** Guide de démarrage : étapes déduites des données réelles du commerce (rien n'est coché à la main). */
export type StartFacts = { shopDetails: boolean; articles: number; cashSessions: number; sales: number; collaborators: number; cashSessionAvailable: boolean };
export type StartStep = { id: "shop" | "article" | "cash" | "sale" | "team"; label: string; hint: string; to: string; done: boolean };

export function startSteps(f: StartFacts): StartStep[] {
  const steps: StartStep[] = [
    { id: "shop", label: "Renseigner votre boutique", hint: "Adresse et téléphone pour l'en-tête des tickets et factures", to: "/reglages", done: f.shopDetails },
    { id: "article", label: "Ajouter votre premier article", hint: "Nom, prix et stock de départ", to: "/stock", done: f.articles > 0 },
  ];
  if (f.cashSessionAvailable) steps.push({ id: "cash", label: "Ouvrir la caisse", hint: "Indiquez le fond de caisse du jour", to: "/caisse", done: f.cashSessions > 0 });
  steps.push({ id: "sale", label: "Faire une première vente", hint: "Encaissez un article depuis la caisse", to: "/pos", done: f.sales > 0 });
  steps.push({ id: "team", label: "Ajouter un collaborateur", hint: "Optionnel : donnez un accès limité à votre vendeur", to: "/reglages", done: f.collaborators > 0 });
  return steps;
}
export const startProgress = (steps: StartStep[]) => ({ done: steps.filter((s) => s.done).length, total: steps.length, complete: steps.every((s) => s.done) });
