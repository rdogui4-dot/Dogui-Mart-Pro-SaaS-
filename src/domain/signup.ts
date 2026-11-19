/** Création de compte et assistant d'accueil (kit écrans 02-07) : listes de choix, solidité du mot de passe, validation des étapes. Calculs purs.
 *  Devise unique XOF : les pays proposés sont ceux de la zone UEMOA, dont le fuseau horaire fixe celui de la boutique. */
export const COUNTRIES = [
  { code: "CI", name: "Côte d'Ivoire", tz: "Africa/Abidjan", dial: "+225", cities: ["Abidjan", "Bouaké", "Yamoussoukro", "San-Pédro", "Daloa", "Korhogo"] },
  { code: "SN", name: "Sénégal", tz: "Africa/Dakar", dial: "+221", cities: ["Dakar", "Thiès", "Saint-Louis", "Touba", "Kaolack", "Ziguinchor"] },
  { code: "ML", name: "Mali", tz: "Africa/Bamako", dial: "+223", cities: ["Bamako", "Sikasso", "Ségou", "Mopti", "Kayes"] },
  { code: "BF", name: "Burkina Faso", tz: "Africa/Ouagadougou", dial: "+226", cities: ["Ouagadougou", "Bobo-Dioulasso", "Koudougou"] },
  { code: "BJ", name: "Bénin", tz: "Africa/Porto-Novo", dial: "+229", cities: ["Cotonou", "Porto-Novo", "Parakou", "Abomey-Calavi"] },
  { code: "TG", name: "Togo", tz: "Africa/Lome", dial: "+228", cities: ["Lomé", "Sokodé", "Kara", "Kpalimé"] },
  { code: "NE", name: "Niger", tz: "Africa/Niamey", dial: "+227", cities: ["Niamey", "Zinder", "Maradi", "Agadez"] },
  { code: "GW", name: "Guinée-Bissau", tz: "Africa/Bissau", dial: "+245", cities: ["Bissau", "Bafatá", "Gabú"] },
] as const;
export type CountryCode = (typeof COUNTRIES)[number]["code"];
export const countryOf = (code: unknown) => COUNTRIES.find((c) => c.code === code);

/** Type de compte choisi à l'inscription : un particulier ou commerçant n'a ni forme juridique ni RCCM à renseigner ; une entreprise doit indiquer les deux. */
export const PROFILE_TYPES = [{ id: "individual", label: "Particulier / Commerçant", help: "Vous exercez en votre nom : aucune forme juridique ni RCCM à renseigner." }, { id: "company", label: "Entreprise", help: "Société ou entreprise immatriculée : forme juridique et RCCM obligatoires." }] as const;
export type ProfileType = (typeof PROFILE_TYPES)[number]["id"];
export const isProfileType = (v: unknown): v is ProfileType => v === "individual" || v === "company";
/** Forme juridique : proposée aux seules entreprises. */
export const LEGAL_FORMS = ["Entreprise individuelle", "SARL", "SARLU", "SA", "SAS", "Société en nom collectif", "Groupement / coopérative", "Association", "Autre"] as const;
export const SECTORS = ["Commerce / Distribution", "Alimentation & boissons", "Pharmacie & santé", "Mode & beauté", "Électronique & téléphonie", "Quincaillerie & construction", "Restauration", "Services", "Agriculture & élevage", "Autre"] as const;
export const SHOP_TYPES = ["Commerce de détail", "Commerce de gros", "Supermarché / supérette", "Restaurant / snack", "Pharmacie", "Boutique spécialisée", "Dépôt / entrepôt", "Autre"] as const;
export const DESCRIPTION_MAX = 200;

export type Strength = { level: 0 | 1 | 2 | 3; label: "Trop court" | "Faible" | "Moyenne" | "Forte"; ok: boolean };
/** Solidité indicative : longueur et variété de caractères. Appwrite reste l'autorité (8 caractères minimum, refus des mots de passe courants). */
export function passwordStrength(pw: string): Strength {
  if (pw.length < 8) return { level: 0, label: "Trop court", ok: false };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  const score = kinds + (pw.length >= 12 ? 1 : 0) + (pw.length >= 16 ? 1 : 0);
  return score >= 4 ? { level: 3, label: "Forte", ok: true } : score >= 3 ? { level: 2, label: "Moyenne", ok: true } : { level: 1, label: "Faible", ok: true };
}

export const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"] as const;
/** Jours d'ouverture codés « 1111110 » (lundi → dimanche). */
export const encodeDays = (on: boolean[]) => DAYS.map((_, i) => (on[i] ? "1" : "0")).join("");
export const decodeDays = (s: unknown): boolean[] => (typeof s === "string" && /^[01]{7}$/.test(s) ? [...s].map((c) => c === "1") : [true, true, true, true, true, true, false]);
export const isHHMM = (s: unknown): s is string => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
/** Ouverture avant fermeture (même jour) ; au moins un jour ouvré. Retourne le message d'erreur ou null. */
export function hoursError(days: boolean[], from: string, to: string): string | null {
  if (!days.some(Boolean)) return "Choisissez au moins un jour d'ouverture";
  if (!isHHMM(from) || !isHHMM(to)) return "Horaires invalides";
  return from < to ? null : "L'heure de fermeture doit suivre l'heure d'ouverture";
}

export type CompanyIn = { profileType?: ProfileType; companyName: string; country: string; city: string; address: string; phone: string; sector: string; legalForm?: string; legal?: string; description?: string };
/** Étape Entreprise : nom, secteur, pays, ville, adresse et téléphone sont obligatoires ; forme juridique et RCCM/ID fiscal le sont seulement pour une entreprise (jamais demandés à un particulier ou commerçant). */
export function companyErrors(c: CompanyIn): Record<string, string> {
  const e: Record<string, string> = {}; const t = (s?: string) => (s ?? "").trim();
  if (t(c.companyName).length < 2) e.companyName = "Nom de l'entreprise requis (2 caractères min.)";
  if (!SECTORS.includes(c.sector as never)) e.sector = "Choisissez un secteur d'activité";
  if (!countryOf(c.country)) e.country = "Choisissez un pays";
  if (!t(c.city)) e.city = "Ville requise";
  if (!t(c.address)) e.address = "Adresse requise";
  if (!phoneOk(c.phone)) e.phone = "Téléphone invalide (8 à 15 chiffres)";
  if (c.profileType === "company") {
    if (!c.legalForm) e.legalForm = "Forme juridique requise pour une entreprise"; else if (!LEGAL_FORMS.includes(c.legalForm as never)) e.legalForm = "Forme juridique inconnue";
    if (t(c.legal).length < 3) e.legal = "Numéro RCCM / ID fiscal requis pour une entreprise";
  }
  if ((c.description ?? "").length > DESCRIPTION_MAX) e.description = `${DESCRIPTION_MAX} caractères maximum`;
  return e;
}
export const phoneDigits = (s: string) => s.replace(/\D/g, "");
export const phoneOk = (s: string) => { const n = phoneDigits(s).length; return n >= 8 && n <= 15; };

export type ShopIn = { name: string; type: string; address: string; city: string; phone: string; days: boolean[]; from: string; to: string };
export function shopErrors(s: ShopIn): Record<string, string> {
  const e: Record<string, string> = {}; const t = (x: string) => x.trim();
  if (t(s.name).length < 2) e.name = "Nom de la boutique requis (2 caractères min.)";
  if (!SHOP_TYPES.includes(s.type as never)) e.type = "Choisissez un type de boutique";
  if (!t(s.address)) e.address = "Adresse requise";
  if (!t(s.city)) e.city = "Ville requise";
  if (!phoneOk(s.phone)) e.phone = "Téléphone invalide (8 à 15 chiffres)";
  const h = hoursError(s.days, s.from, s.to); if (h) e.hours = h;
  return e;
}

/** Champs de profil (entreprise et boutique) acceptés par `shop.save`. Seuls les champs fournis sont validés et enregistrés.
 *  La forme juridique et la description peuvent être vidées ; un pays valide fixe le fuseau horaire s'il n'est pas fourni. */
export function shopProfilePatch(b: Record<string, unknown>): { patch: Record<string, unknown>; error?: string } {
  const patch: Record<string, unknown> = {}; const has = (k: string) => b[k] !== undefined;
  const bad = (error: string) => ({ patch: {}, error });
  if (has("profileType")) {
    if (!isProfileType(b.profileType)) return bad("Type de compte inconnu"); patch.profileType = b.profileType;
    if (b.profileType === "company") { const lf = String(b.legalForm ?? ""); if (!LEGAL_FORMS.includes(lf as never)) return bad("Forme juridique requise pour une entreprise"); if (String(b.legal ?? "").trim().length < 3) return bad("Numéro RCCM / ID fiscal requis pour une entreprise"); }
    else patch.legalForm = ""; // un particulier ou commerçant n'a pas de forme juridique
  }
  if (has("legalForm") && patch.profileType !== "individual") { const v = String(b.legalForm); if (v && !LEGAL_FORMS.includes(v as never)) return bad("Forme juridique inconnue"); patch.legalForm = v; }
  if (has("sector")) { const v = String(b.sector); if (!SECTORS.includes(v as never)) return bad("Secteur d'activité inconnu"); patch.sector = v; }
  if (has("shopType")) { const v = String(b.shopType); if (!SHOP_TYPES.includes(v as never)) return bad("Type de boutique inconnu"); patch.shopType = v; }
  if (has("country")) { const c = countryOf(b.country); if (!c) return bad("Pays inconnu"); patch.country = c.code; if (!has("promoTz")) patch.promoTz = c.tz; }
  if (has("description")) { const v = String(b.description).trim(); if (v.length > DESCRIPTION_MAX) return bad(`Description : ${DESCRIPTION_MAX} caractères maximum`); patch.description = v; }
  if (has("openDays")) { if (typeof b.openDays !== "string" || !/^[01]{7}$/.test(b.openDays)) return bad("Jours d'ouverture invalides"); patch.openDays = b.openDays; }
  if (has("openFrom") || has("openTo")) {
    if (!isHHMM(b.openFrom) || !isHHMM(b.openTo)) return bad("Horaires invalides"); if (b.openFrom >= b.openTo) return bad("L'heure de fermeture doit suivre l'heure d'ouverture");
    patch.openFrom = b.openFrom; patch.openTo = b.openTo;
  }
  return { patch };
}
