/** Relances d'expiration d'abonnement : paliers selon la période, et texte de message prêt à envoyer. Logique pure, sans envoi. */
import { PERIOD_LABEL, type Entitlement, type Period } from "./subscriptions";

export type ReminderLevel = "none" | "info" | "warning" | "urgent" | "grace" | "locked";

/** Paliers (en jours avant l'échéance) à partir desquels on relance. Un abonnement « jour » n'a pas de sens à J-7. */
export const REMIND_BEFORE_DAYS: Record<Period, { info: number; warning: number; urgent: number }> = {
  day: { info: 0.5, warning: 0.25, urgent: 0.1 },
  week: { info: 3, warning: 2, urgent: 1 },
  month: { info: 7, warning: 3, urgent: 1 },
  quarter: { info: 7, warning: 3, urgent: 1 },
  year: { info: 7, warning: 3, urgent: 1 },
};

export function msLeft(e: Pick<Entitlement, "endsAt">, now: Date): number { return new Date(e.endsAt).getTime() - now.getTime(); }

export function reminderLevel(e: Pick<Entitlement, "state" | "endsAt" | "period" | "trial"> & { lifetime?: boolean }, now: Date = new Date()): ReminderLevel {
  if (e.lifetime) return "none"; // accès à vie : jamais de relance
  if (e.state === "locked") return "locked";
  if (e.state === "grace") return "grace";
  const days = msLeft(e, now) / 86_400_000;
  // Un essai est relancé comme un abonnement mensuel : c'est l'occasion de convertir.
  const t = REMIND_BEFORE_DAYS[e.trial ? "month" : e.period];
  return days <= t.urgent ? "urgent" : days <= t.warning ? "warning" : days <= t.info ? "info" : "none";
}

const dateFr = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
export function timeLeftLabel(ms: number): string {
  if (ms <= 0) return "expiré";
  const h = Math.ceil(ms / 3_600_000);
  return h < 24 ? `${h} h` : `${Math.ceil(h / 24)} jour(s)`;
}

/** Message affiché dans l'application au propriétaire et aux employés. */
export function bannerMessage(e: Pick<Entitlement, "state" | "endsAt" | "period" | "trial">, isOwner: boolean, now: Date = new Date()): { level: ReminderLevel; text: string } | null {
  const level = reminderLevel(e, now);
  if (level === "none") return null;
  const what = e.trial ? "Votre essai gratuit" : "Votre abonnement";
  const todo = isOwner ? " Renouvelez dans Réglages → Abonnement." : " Prévenez le propriétaire du commerce.";
  const text = level === "locked" ? `${what} est terminé : l'accès à l'application est suspendu, vos données sont conservées.${todo}`
    : level === "grace" ? `${what} est terminé depuis le ${dateFr(e.endsAt)}. Il reste un court délai de grâce avant la suspension de l'accès.${todo}`
      : `${what} se termine dans ${timeLeftLabel(msLeft(e, now))} (le ${dateFr(e.endsAt)}).${todo}`;
  return { level, text };
}

export type RenewalInfo = { shopName: string; ownerName?: string; planName: string; period: Period; trial: boolean; state: Entitlement["state"]; endsAt: string };

/** Message de relance rédigé pour l'administrateur de la plateforme (à coller dans WhatsApp / e-mail). */
export function renewalMessage(i: RenewalInfo, now: Date = new Date()): string {
  const hello = `Bonjour${i.ownerName ? ` ${i.ownerName}` : ""},`;
  const sub = i.trial ? "votre essai gratuit de Dogui Mart Pro" : `votre abonnement Dogui Mart Pro (${i.planName}, ${PERIOD_LABEL[i.period].toLowerCase()})`;
  const when = i.state === "locked" ? `est terminé depuis le ${dateFr(i.endsAt)} et l'accès de ${i.shopName} est suspendu (ses données sont conservées)`
    : i.state === "grace" ? `est terminé depuis le ${dateFr(i.endsAt)} (délai de grâce en cours pour ${i.shopName})`
      : `se termine dans ${timeLeftLabel(msLeft(i, now))}, le ${dateFr(i.endsAt)}`;
  return `${hello}\n${sub[0]!.toUpperCase()}${sub.slice(1)} ${when}.\nPour continuer sans interruption, renouvelez-le dans l'application : Réglages → Abonnement (paiement sécurisé par Selar).\nMerci de votre confiance !`;
}

export const stateLabel: Record<Entitlement["state"], string> = { active: "Actif", expiring: "Bientôt expiré", grace: "Délai de grâce", locked: "Accès suspendu" };

/** Numéro utilisable pour un lien WhatsApp (chiffres, indicatif inclus) ; null si on ne peut pas être sûr de l'indicatif. */
export function whatsappNumber(phone: string | undefined, defaultDialCode?: string): string | null {
  const raw = (phone ?? "").trim(); if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? digits : null;
  if (digits.startsWith("00")) return digits.length - 2 >= 8 && digits.length - 2 <= 15 ? digits.slice(2) : null;
  const dial = (defaultDialCode ?? "").replace(/\D/g, ""); if (!dial) return null;
  const local = digits.replace(/^0+/, ""); const full = `${dial}${local}`;
  return local.length >= 6 && full.length <= 15 ? full : null;
}
