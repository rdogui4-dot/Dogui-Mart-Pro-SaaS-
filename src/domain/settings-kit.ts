/** Paramètres généraux (kit écran « Paramètres ») : modules de la plateforme selon la formule, liste de vérification du paramétrage. Calculs purs, sans valeur présumée. */
import { planAllows, type FeatureKey } from "./features";

export const PLATFORM_MODULES: { key: string; label: string; feature: FeatureKey | null; to: string }[] = [
  { key: "pos", label: "Ventes (Caisse)", feature: null, to: "/pos" },
  { key: "stock", label: "Stocks & Inventaires", feature: null, to: "/stock" },
  { key: "purchases", label: "Achats & Fournisseurs", feature: "purchasing", to: "/fournisseurs" },
  { key: "expenses", label: "Dépenses", feature: "expenses", to: "/depenses" },
  { key: "crm", label: "CRM (Clients)", feature: "crm", to: "/crm" },
  { key: "fin", label: "FinI (Finance)", feature: "finBusiness", to: "/finance" },
  { key: "icompta", label: "ICompta (Comptabilité)", feature: "icompta", to: "/icompta" },
  { key: "invest", label: "IProj-Invest", feature: "investBusiness", to: "/investissements" },
  { key: "promotions", label: "Promotions & Offres", feature: "promotions", to: "/promotions" },
  { key: "reports", label: "Rapports & Analyses", feature: "proDashboard", to: "/pilotage" },
];
export function modulesFor(plan: string | undefined) {
  const list = PLATFORM_MODULES.map((m) => ({ ...m, active: m.feature === null || planAllows(plan, m.feature) }));
  return { list, active: list.filter((m) => m.active).length, total: list.length };
}

export type CheckItem = { id: string; label: string; done: boolean; hint: string; tab: string };
export type CheckIn = { name?: string; phone?: string; legal?: string; companyName?: string; taxRegime?: string; address?: string; promoTz?: string; logoFileId?: string; vatSet: boolean; finAccounts: number | null; qrLinks: number; staff: number };
/** Points de paramétrage vérifiés sur les données réelles ; « null » = module non ouvert par la formule (point ignoré). */
export function checklist(c: CheckIn): { items: CheckItem[]; done: number; total: number } {
  const has = (v?: string) => !!v && v.trim().length > 0;
  const items: CheckItem[] = [
    { id: "name", label: "Nom commercial", done: has(c.name) && c.name !== "Mon commerce", hint: "Apparaît en tête des tickets et factures.", tab: "general" },
    { id: "phone", label: "Téléphone de la boutique", done: has(c.phone), hint: "Imprimé sur les documents ; sert aussi à l'essai MASTER DOGUI.", tab: "general" },
    { id: "address", label: "Adresse", done: has(c.address), hint: "Mention des tickets et factures.", tab: "general" },
    { id: "legal", label: "NINEA / RCCM", done: has(c.legal), hint: "Mention légale des factures.", tab: "general" },
    { id: "company", label: "Raison sociale", done: has(c.companyName), hint: "Nom juridique de l'entreprise, imprimé sur les factures.", tab: "general" },
    { id: "tax", label: "Régime fiscal", done: has(c.taxRegime), hint: "À confirmer avec votre comptable.", tab: "general" },
    { id: "logo", label: "Logo", done: has(c.logoFileId), hint: "Imprimé en tête des tickets et factures.", tab: "general" },
    { id: "tz", label: "Fuseau horaire", done: has(c.promoTz), hint: "Définit les journées, les rapports et les promotions.", tab: "general" },
    { id: "vat", label: "Taux de TVA", done: c.vatSet, hint: "Taux appliqué aux ventes et aux factures.", tab: "general" },
    ...(c.finAccounts === null ? [] : [{ id: "fin", label: "Comptes financiers (caisse, banque, mobile money)", done: c.finAccounts > 0, hint: "Nécessaires au suivi de la trésorerie (FinI).", tab: "fin" }]),
    { id: "qr", label: "Lien de paiement par QR (Wave / Orange)", done: c.qrLinks > 0, hint: "Facultatif : permet au client de payer en scannant un QR.", tab: "payments" },
    { id: "staff", label: "Équipe invitée", done: c.staff > 0, hint: "Facultatif : chaque membre a son accès et ses droits.", tab: "team" },
  ];
  const done = items.filter((i) => i.done).length; return { items, done, total: items.length };
}
