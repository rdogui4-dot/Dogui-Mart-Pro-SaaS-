/** Fiches des 3 produits d'abonnement Selar (Starter, Business, Pro), chacun avec ses 5 options de période.
 *  Générées depuis le catalogue réel : prix, durées, limites et délais de grâce ne peuvent donc pas diverger de ce que l'application applique.
 *  Ne décrit que des fonctions existantes. */
import { DEFAULT_PLANS, GRACE_DAYS, PERIODS, PERIOD_DAYS, PERIOD_LABEL, TRIAL, type Period, type Plan, type PlanId } from "./subscriptions";
import { selarOptionLabel } from "./selar";
import { redirectUrl } from "./redirects";

const nbsp = (s: string) => s.replace(/[  ]/g, " ");
export const fcfa = (n: number): string => nbsp(`${n.toLocaleString("fr-FR")} FCFA`);
const lim = (n: number, one: string, many: string) => (n < 0 ? `${many} illimités` : `${n} ${n === 1 ? one : many}`);

/** Fonctions réellement disponibles, communes à TOUTES les formules (seules les limites changent d'une formule à l'autre). */
export const COMMON_FEATURES: string[] = [
  "Caisse : vente par recherche ou scan de code-barres avec la caméra du téléphone, paiement en espèces, par carte, à crédit client ou par QR code Wave / Orange Money, ticket de caisse en PDF.",
  "Fonctionne sans connexion : les ventes sont enregistrées sur le téléphone puis envoyées dès que le réseau revient.",
  "Stock : mouvements, inventaire, alertes de rupture, coût d'achat moyen, transferts de stock entre boutiques.",
  "Achats : bons de commande, réception (totale ou partielle), factures fournisseurs et suivi des règlements.",
  "Clients : fiches, crédit client avec plafond, points de fidélité et paliers.",
  "Factures clients (depuis une vente ou libres) en PDF, à partager par WhatsApp ou e-mail.",
  "Comptabilité : écritures SYSCOHADA générées automatiquement à chaque vente, achat et règlement, balance des comptes.",
  "Rapports de ventes consolidés (toutes boutiques) : chiffre d'affaires, marge, encaissements, stock valorisé, produits les plus vendus, export PDF.",
  "Équipe : comptes employés (caissier ou gérant) affectés à une ou plusieurs boutiques, avec des droits distincts.",
  "Application installable sur Android depuis le navigateur (sans passer par un magasin d'applications).",
];

/** À NE PAS promettre dans un produit : fonctions annoncées dans la feuille de route mais pas disponibles aujourd'hui. */
export const NOT_AVAILABLE: string[] = [
  "Impression directe sur imprimante Bluetooth (le ticket se partage en PDF).",
  "Confirmation automatique des paiements Wave / Orange / Selar : chaque paiement d'abonnement est vérifié à la main.",
  "Export comptable au format OHADA, grand livre, bilan.",
  "Relances automatiques (SMS, WhatsApp, e-mail) : les messages sont préparés mais envoyés par vous.",
  "Application sur Google Play (c'est une application web installable).",
  "Devis et avoirs.",
];

const PITCH: Record<PlanId, { audience: string; tagline: string }> = {
  starter: { audience: "un commerce de proximité avec un seul point de vente", tagline: "Tout pour tenir sa caisse, son stock et ses comptes, avec un point de vente." },
  business: { audience: "un commerce qui grandit : plusieurs points de vente et une équipe", tagline: "Plusieurs boutiques, une vraie équipe et tout le pilotage au même endroit." },
  pro: { audience: "un réseau de points de vente et de grandes équipes", tagline: "Pour un réseau de boutiques : jusqu'à 20 points de vente, 100 utilisateurs, produits illimités." },
};

/** Une option de période d'un produit Selar (ce que le client choisit dans la liste « Choisir un abonnement »). */
export type PeriodOption = {
  period: Period; periodLabel: string; selarLabel: string; priceFcfa: number; durationDays: number; perDayFcfa: number;
  graceDays: number; savingsPct: number | null; savingsVs: string | null;
};
export type Product = {
  plan: PlanId; planName: string; name: string; shortDescription: string; longDescription: string;
  limits: string[]; options: PeriodOption[]; postPurchase: string;
  /** URL à saisir comme redirection après paiement du produit (domaine de l'application, ou marqueur VOTRE-DOMAINE tant qu'il est inconnu). */
  redirectUrl: string;
};

/** Économie par rapport à la période immédiatement plus courte payée en répétition (jour→semaine→mois→trimestre→année). */
function savings(plan: Plan, period: Period): { pct: number; vs: string } | null {
  const ref: Partial<Record<Period, { base: Period; times: number; label: string }>> = {
    week: { base: "day", times: 7, label: "7 jours payés au jour" }, month: { base: "week", times: 30 / 7, label: "30 jours payés à la semaine" },
    quarter: { base: "month", times: 3, label: "3 mois payés au mois" }, year: { base: "month", times: 12, label: "12 mois payés au mois" },
  };
  const r = ref[period]; if (!r) return null;
  const pct = Math.round((1 - plan.prices[period] / (plan.prices[r.base] * r.times)) * 100);
  return pct > 0 ? { pct, vs: r.label } : null;
}

export const postPurchaseMessage = (planName: string): string =>
  `Merci pour votre abonnement Dogui Mart Pro ${planName}.\n` +
  `Pour l'activer :\n` +
  `1. Ouvrez Dogui Mart Pro, puis Réglages > Abonnement.\n` +
  `2. Choisissez la formule ${planName} et la même période que celle que vous venez de payer, puis touchez « Payer sur Selar ». Inutile de repayer.\n` +
  `3. Saisissez la référence de commande reçue par e-mail de Selar et l'adresse e-mail utilisée pour l'achat, puis touchez « J'ai payé ».\n` +
  `Notre équipe vérifie votre paiement puis active votre abonnement [délai à préciser, par exemple : sous 24 h ouvrées].\n` +
  `Besoin d'aide ? [contact à compléter : numéro WhatsApp ou e-mail].`;

export function buildProducts(plans: Plan[] = DEFAULT_PLANS, appBase?: string): Product[] {
  return plans.map((plan) => {
    const limits = [lim(plan.limits.maxShops, "boutique", "boutiques"), lim(plan.limits.maxUsers, "utilisateur (vous compris)", "utilisateurs (vous compris)"), lim(plan.limits.maxProducts, "produit", "produits")];
    const options: PeriodOption[] = PERIODS.map((period) => {
      const sv = savings(plan, period); const days = PERIOD_DAYS[period];
      return { period, periodLabel: PERIOD_LABEL[period], selarLabel: selarOptionLabel(period), priceFcfa: plan.prices[period], durationDays: days, perDayFcfa: Math.round(plan.prices[period] / days), graceDays: GRACE_DAYS[period], savingsPct: sv?.pct ?? null, savingsVs: sv?.vs ?? null };
    });
    const dur = (d: number) => (d === 1 ? "1 jour" : `${d} jours`);
    const optionLines = options.map((o) => `- ${o.selarLabel} (${o.periodLabel}) : ${fcfa(o.priceFcfa)} pour ${dur(o.durationDays)} d'accès${o.savingsPct ? ` - ${o.savingsPct} % moins cher que ${o.savingsVs}` : ""}`);
    const graceLines = options.map((o) => `- ${o.periodLabel} : ${o.graceDays === 0 ? "aucun délai de grâce, l'accès est suspendu aussitôt à l'échéance" : `${o.graceDays} jour${o.graceDays > 1 ? "s" : ""} de délai de grâce après l'échéance`}`);
    const long = [
      PITCH[plan.id].tagline,
      `Formule ${plan.name}, pour ${PITCH[plan.id].audience}. Dogui Mart Pro est la gestion de commerce pensée pour Android.`,
      `INCLUS DANS CETTE FORMULE :\n${limits.map((l) => `- ${l}`).join("\n")}`,
      `FONCTIONS (communes à toutes les formules) :\n${COMMON_FEATURES.map((f) => `- ${f}`).join("\n")}`,
      `CHOISISSEZ VOTRE PÉRIODE (liste « Choisir un abonnement ») :\n${optionLines.join("\n")}`,
      `DURÉE, RENOUVELLEMENT ET ÉCHÉANCE :\n- L'accès commence à l'activation par notre équipe, après vérification de votre paiement.\n- Si vous gardez la même formule, la nouvelle période s'ajoute à la fin de la période en cours.\n- Si vous changez de formule, la nouvelle période démarre à l'activation ; le temps restant de l'ancienne formule n'est pas reporté.\n- Renouvellement : [à compléter : indiquer si l'abonnement Selar se renouvelle automatiquement à chaque période ou s'il faut le reprendre].\n${graceLines.join("\n")}\n- Après le délai de grâce, l'accès est suspendu jusqu'au renouvellement. Vos données sont conservées.`,
      `Essai gratuit de ${TRIAL.days} jours à l'inscription dans l'application, sans paiement.`,
    ].join("\n\n");
    return {
      plan: plan.id, planName: plan.name, name: `Dogui Mart Pro - ${plan.name}`,
      shortDescription: `Gestion de commerce sur Android : caisse, stock, achats, factures. ${plan.name} : ${limits[0]}, ${limits[1]!.replace(" (vous compris)", "")}.`,
      longDescription: long, limits, options, postPurchase: postPurchaseMessage(plan.name), redirectUrl: redirectUrl(plan.id, appBase),
    };
  });
}

/** Version texte (Markdown) pour copier-coller champ par champ dans Selar. */
export function productsMarkdown(products: Product[], now: Date = new Date()): string {
  const head = `# Abonnements Dogui Mart Pro - fiches des produits Selar\n\nGénéré le ${now.toLocaleDateString("fr-FR")} depuis le catalogue de l'application. ${products.length} produits (un par formule), chacun avec ${PERIODS.length} options de période.\n`;
  return head + products.map((p, i) => `\n---\n\n## ${i + 1}. ${p.name}\n\n- **Formule (clé de l'application)** : \`${p.plan}\`\n- **URL de redirection après paiement** : ${p.redirectUrl}\n\n**Options de période à créer dans Selar**\n\n| Option Selar | Période | Prix | Durée | Par jour |\n|---|---|---|---|---|\n${p.options.map((o) => `| ${o.selarLabel} | ${o.periodLabel} | ${o.priceFcfa} FCFA (${fcfa(o.priceFcfa)}) | ${o.durationDays} j | ${fcfa(o.perDayFcfa)} |`).join("\n")}\n\n**Description courte**\n\n${p.shortDescription}\n\n**Description détaillée**\n\n${p.longDescription}\n\n**Message après achat**\n\n${p.postPurchase}\n`).join("");
}
