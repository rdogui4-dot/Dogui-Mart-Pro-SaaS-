
/** Vérification d'adresse e-mail : non bloquante (le compte fonctionne avant). Les identifiants d'employés (@staff.invalid) n'ont pas d'e-mail réel. */
export const hasRealEmail = (email?: string): boolean => !!email && email.includes("@") && !email.toLowerCase().endsWith(".invalid");
export const shouldAskVerification = (email: string | undefined, verified: boolean | undefined): boolean => hasRealEmail(email) && verified === false;

const returnUrl = () => `${window.location.origin}${import.meta.env.BASE_URL}?verify=1`;
export async function sendVerification(): Promise<void> { const { account } = await import("./appwrite"); await account.createVerification({ url: returnUrl() }); }

const KEY = "dmp-verify-result";
/** Retour du lien reçu par e-mail (…?verify=1&userId=…&secret=…) : confirme l'adresse, nettoie l'adresse et garde le résultat à afficher. */
export async function consumeVerifyReturn(): Promise<void> {
  const q = new URLSearchParams(window.location.search);
  if (q.get("verify") !== "1" || !q.get("userId") || !q.get("secret")) return;
  let result = "ok";
  try { const { account } = await import("./appwrite"); await Promise.race([account.updateVerification({ userId: q.get("userId")!, secret: q.get("secret")! }), new Promise((_, no) => setTimeout(() => no(new Error("délai")), 8000))]); } catch { result = "error"; }
  try { sessionStorage.setItem(KEY, result); } catch { /* stockage indisponible : message non conservé */ }
  window.history.replaceState(null, "", window.location.pathname);
}
export function takeVerifyResult(): "ok" | "error" | null {
  try { const v = sessionStorage.getItem(KEY); return v === "ok" || v === "error" ? v : null; } catch { return null; }
}
export function clearVerifyResult() { try { sessionStorage.removeItem(KEY); } catch { /* rien */ } }
