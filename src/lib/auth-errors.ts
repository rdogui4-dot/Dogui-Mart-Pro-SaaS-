/** Messages d'erreur d'authentification lisibles (Appwrite répond en anglais). Aucune distinction « compte inexistant / mauvais mot de passe » : on ne révèle pas quels comptes existent. */
export function authMessage(e: unknown): string {
  const x = e as { code?: number; type?: string; message?: string };
  const t = String(x?.type ?? ""), m = String(x?.message ?? "");
  if (x?.code === 401 || /invalid credentials|user_invalid_credentials/i.test(t + m)) return "Identifiant ou mot de passe incorrect.";
  if (x?.code === 409 || /user_already_exists|already exists/i.test(t + m)) return "Un compte existe déjà avec cet e-mail. Connectez-vous ou réinitialisez votre mot de passe.";
  if (x?.code === 429 || /rate.?limit|too many/i.test(t + m)) return "Trop de tentatives. Patientez quelques minutes puis réessayez.";
  if (/password/i.test(t + m) && /(short|least|common|weak|personal)/i.test(m)) return "Mot de passe refusé : 8 caractères minimum, ni trop courant ni lié à votre nom ou e-mail.";
  if (/email/i.test(t + m) && /(invalid|valid)/i.test(m)) return "Adresse e-mail invalide.";
  if (/network|failed to fetch|load failed|timeout/i.test(m) || x?.code === 0) return "Connexion impossible : vérifiez votre réseau et réessayez.";
  if (x?.code && x.code >= 500) return "Le service est momentanément indisponible. Réessayez dans un instant.";
  return m && !/^[a-z_ ]+$/i.test(m.slice(0, 3)) ? m : "Une erreur est survenue. Réessayez.";
}
