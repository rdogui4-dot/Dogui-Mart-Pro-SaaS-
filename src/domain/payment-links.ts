/** Liens de paiement Wave Business / Orange Business -> QR code.
 *  Le commerçant colle dans ses réglages le modèle de lien fourni par son compte Business,
 *  avec les variables {amount} et {ref}. Les formats exacts dépendent de l'opérateur : ils ne sont pas codés en dur. */
export type QrProvider = "wave" | "orange";
export type LinkStatus = "pending" | "paid" | "expired" | "cancelled";

/** `allowStatic` : lien de commerçant fixe sans montant (QR statique Orange Money) — le client saisit lui-même le montant affiché. */
export const isStaticTemplate = (template: string): boolean => !template.includes("{amount}");
export function buildPaymentUrl(template: string, vars: { amount: number; ref: string }, allowStatic = false): string {
  if (!template.includes("{amount}") && !allowStatic) throw new Error("Le modèle de lien doit contenir {amount}");
  const url = template.replaceAll("{amount}", String(Math.round(vars.amount))).replaceAll("{ref}", encodeURIComponent(vars.ref));
  const u = new URL(url); // lève si invalide
  if (u.protocol !== "https:") throw new Error("Le lien de paiement doit être en https");
  return u.toString();
}

/** Prépare le modèle collé par le commerçant. Accepte tel quel un modèle avec {amount} ; sinon, si le lien contient déjà un montant (`amount=1000`), ce montant devient {amount} ;
 *  un lien Wave Business sans montant reçoit `amount={amount}`. Sinon : erreur lisible (jamais d'erreur interne pour une simple faute de saisie). */
export function normalizeTemplate(raw: string, provider: QrProvider): { template: string; converted: boolean } {
  const t = String(raw ?? "").trim();
  if (!t) throw new Error("Lien vide");
  if (/\s/.test(t)) throw new Error("Le lien ne doit contenir aucun espace");
  let probe: URL;
  try { probe = new URL(t.replaceAll("{amount}", "1").replaceAll("{ref}", "REF")); } catch { throw new Error("Ce texte n'est pas un lien valide : collez l'adresse complète, qui commence par https://"); }
  if (probe.protocol !== "https:") throw new Error("Le lien de paiement doit commencer par https://");
  if (t.includes("{amount}")) return { template: t, converted: false };
  const m = /([?&]amount=)[^&#{}]*/i.exec(t);
  if (m) return { template: t.replace(m[0], `${m[1]}{amount}`), converted: true };
  if (provider === "orange") return { template: t, converted: false }; // QR marchand Orange Money : lien fixe sans montant, le client saisit le montant affiché
  if (provider === "wave" && /(^|\.)wave\.com$/i.test(probe.hostname)) return { template: `${t}${t.includes("?") ? "&" : "?"}amount={amount}`, converted: true };
  throw new Error(`Ce lien ne contient pas le montant. Dans l'application ${provider === "wave" ? "Wave" : "Orange"} Business, générez un lien de paiement avec un montant (par exemple 1000), collez-le ici, puis remplacez ce montant par {amount} — l'application mettra le vrai montant à chaque vente.`);
}

export const isExpired = (expiresAt: string, now = new Date()): boolean => new Date(expiresAt).getTime() <= now.getTime();

/** Références courtes, uniques par lien, lisibles sur le relevé du client. */
export const linkRef = (id: string): string => `DMP-${id.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase()}`;
