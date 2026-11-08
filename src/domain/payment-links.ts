/** Liens de paiement Wave Business / Orange Business -> QR code.
 *  Le commerçant colle dans ses réglages le modèle de lien fourni par son compte Business,
 *  avec les variables {amount} et {ref}. Les formats exacts dépendent de l'opérateur : ils ne sont pas codés en dur. */
export type QrProvider = "wave" | "orange";
export type LinkStatus = "pending" | "paid" | "expired" | "cancelled";

export function buildPaymentUrl(template: string, vars: { amount: number; ref: string }): string {
  if (!template.includes("{amount}")) throw new Error("Le modèle de lien doit contenir {amount}");
  const url = template.replaceAll("{amount}", String(Math.round(vars.amount))).replaceAll("{ref}", encodeURIComponent(vars.ref));
  const u = new URL(url); // lève si invalide
  if (u.protocol !== "https:") throw new Error("Le lien de paiement doit être en https");
  return u.toString();
}

export const isExpired = (expiresAt: string, now = new Date()): boolean => new Date(expiresAt).getTime() <= now.getTime();

/** Références courtes, uniques par lien, lisibles sur le relevé du client. */
export const linkRef = (id: string): string => `DMP-${id.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase()}`;
