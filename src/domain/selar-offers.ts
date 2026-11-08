/** Fiches de création des offres d'abonnement sur Selar (3 formules × 5 périodes), générées depuis le catalogue réel :
 *  prix, durées et limites ne peuvent donc pas diverger de ce que l'application applique. Ne décrit que des fonctions existantes. */
import { DEFAULT_PLANS, GRACE_DAYS, PERIODS, PERIOD_DAYS, PERIOD_LABEL, TRIAL, type Period, type Plan, type PlanId } from "./subscriptions";
import { linkKey } from "./selar";

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

/** À NE PAS promettre dans une offre : fonctions annoncées dans la feuille de route mais pas disponibles aujourd'hui. */
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

export type Offer = {
  key: string; plan: PlanId; period: Period; planName: string; periodLabel: string;
  name: string; shortDescription: string; longDescription: string;
  priceFcfa: number; durationDays: number; perDayFcfa: number; savingsPct: number | null; savingsVs: string | null;
  postPurchase: string; limits: string[];
};

/** Économie par rapport à la période immédiatement plus courte payée en répétition (jour→semaine→mois→trimestre→année). */
function savings(plan: Plan, period: Period): { pct: number; vs: string } | null {
  const ref: Partial<Record<Period, { base: Period; times: number; label: string }>> = {
    week: { base: "day", times: 7, label: "7 jours payés au jour" }, month: { base: "week", times: 30 / 7, label: "30 jours payés à la semaine" },
    quarter: { base: "month", times: 3, label: "3 mois payés au mois" }, year: { base: "month", times: 12, label: "12 mois payés au mois" },
  };
  const r = ref[period]; if (!r) return null;
  const full = plan.prices[r.base] * r.times; const pct = Math.round((1 - plan.prices[period] / full) * 100);
  return pct > 0 ? { pct, vs: r.label } : null;
}

export const postPurchaseMessage = (planName: string, periodLabel: string): string =>
  `Merci pour votre achat de l'abonnement Dogui Mart Pro ${planName} (${periodLabel.toLowerCase()}).\n` +
  `Pour l'activer :\n` +
  `1. Ouvrez Dogui Mart Pro, puis Réglages > Abonnement.\n` +
  `2. Choisissez la même formule (${planName}) et la même période (${periodLabel}), puis touchez « Payer sur Selar ». Inutile de repayer.\n` +
  `3. Saisissez la référence de commande reçue par e-mail de Selar et l'adresse e-mail utilisée pour l'achat, puis touchez « J'ai payé ».\n` +
  `Notre équipe vérifie votre paiement puis active votre abonnement [délai à préciser, par exemple : sous 24 h ouvrées].\n` +
  `Besoin d'aide ? [contact à compléter : numéro WhatsApp ou e-mail].`;

export function buildOffers(plans: Plan[] = DEFAULT_PLANS): Offer[] {
  const out: Offer[] = [];
  for (const plan of plans) for (const period of PERIODS) {
    const days = PERIOD_DAYS[period], price = plan.prices[period], sv = savings(plan, period);
    const limits = [lim(plan.limits.maxShops, "boutique", "boutiques"), lim(plan.limits.maxUsers, "utilisateur (vous compris)", "utilisateurs (vous compris)"), lim(plan.limits.maxProducts, "produit", "produits")];
    const periodLabel = PERIOD_LABEL[period]; const duration = days === 1 ? "1 jour" : `${days} jours`;
    const name = `Dogui Mart Pro - ${plan.name} - ${periodLabel} (${duration})`;
    const shortDescription = `Gestion de commerce sur Android : caisse, stock, achats, factures. ${plan.name} : ${limits[0]}, ${limits[1]!.replace(" (vous compris)", "")}. ${duration} d'accès.`;
    const grace = GRACE_DAYS[period];
    const long = [
      `${PITCH[plan.id].tagline}`,
      `Formule ${plan.name}, pour ${PITCH[plan.id].audience}. Accès de ${duration} à Dogui Mart Pro, la gestion de commerce pensée pour Android.`,
      `INCLUS DANS CETTE FORMULE :\n${limits.map((l) => `- ${l}`).join("\n")}`,
      `FONCTIONS (communes à toutes les formules) :\n${COMMON_FEATURES.map((f) => `- ${f}`).join("\n")}`,
      `DURÉE ET RENOUVELLEMENT :\n- Accès de ${duration} à partir de l'activation par notre équipe.\n- Si vous gardez la même formule, la nouvelle période s'ajoute à la fin de la période en cours.\n- Si vous changez de formule, la nouvelle période démarre à l'activation ; le temps restant de l'ancienne formule n'est pas reporté.\n- ${grace === 0 ? "À l'échéance, l'accès est suspendu aussitôt" : `Après l'échéance, ${grace} jour${grace > 1 ? "s" : ""} de délai de grâce, puis l'accès est suspendu`} jusqu'au renouvellement. Vos données sont conservées.\n- Un achat = une période. Pour plusieurs périodes, répétez l'achat.`,
      `Essai gratuit de ${TRIAL.days} jours à l'inscription dans l'application, sans paiement.`,
      sv ? `ÉCONOMIE : ${sv.pct} % moins cher que ${sv.vs}.` : "",
    ].filter(Boolean).join("\n\n");
    out.push({ key: linkKey(plan.id, period), plan: plan.id, period, planName: plan.name, periodLabel, name, shortDescription, longDescription: long, priceFcfa: price, durationDays: days, perDayFcfa: Math.round(price / days), savingsPct: sv?.pct ?? null, savingsVs: sv?.vs ?? null, postPurchase: postPurchaseMessage(plan.name, periodLabel), limits });
  }
  return out;
}

/** Version texte (Markdown) pour copier-coller champ par champ dans Selar. */
export function offersMarkdown(offers: Offer[], now: Date = new Date()): string {
  const head = `# Offres d'abonnement Dogui Mart Pro - fiches Selar\n\nGénéré le ${now.toLocaleDateString("fr-FR")} depuis le catalogue de l'application. ${offers.length} offres à créer.\n`;
  return head + offers.map((o, i) => `\n---\n\n## ${i + 1}. ${o.name}\n\n- **Clé de l'application** : \`${o.key}\`\n- **Prix** : ${o.priceFcfa} FCFA (${fcfa(o.priceFcfa)})\n- **Durée** : ${o.durationDays} jour(s)\n\n**Description courte**\n\n${o.shortDescription}\n\n**Description détaillée**\n\n${o.longDescription}\n\n**Message après achat**\n\n${o.postPurchase}\n`).join("");
}
