/** Garde de l'assistant IA (SEC-C2A-01, 03, 04). Fonctions PURES : aucune ne renvoie ni ne journalise la valeur d'un secret, seulement son TYPE.
 *  Le texte d'un utilisateur et la sortie d'un modèle sont des données non fiables : on les contrôle, on ne les exécute jamais. */

/** Types de secrets reconnus (jamais la valeur). Les motifs visent des formats précis pour éviter les faux positifs sur du texte de gestion. */
const SECRET_PATTERNS: [string, RegExp][] = [
  ["clé Google", /\bAIza[0-9A-Za-z_-]{20,}/],
  ["clé de type sk-", /\bsk-[A-Za-z0-9_-]{16,}/],
  ["jeton GitHub", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/],
  ["jeton Slack", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["clé Appwrite", /\bstandard_[0-9a-f]{40,}/i],
  ["clé AWS", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["jeton JWT", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ["clé privée", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["mot de passe ou jeton saisi", /\b(?:mot de passe|mdp|password|passwd|pwd|secret|token|jeton|api[ _-]?key|cl[ée] api)\s*(?:est|is|:|=)\s*\S{6,}/i],
  ["longue chaîne opaque", /(?<![A-Za-z0-9+/_-])(?=[A-Za-z0-9+/_-]*\d)(?=[A-Za-z0-9+/_-]*[A-Za-z])[A-Za-z0-9+/_-]{40,}(?![A-Za-z0-9+/_-])/],
];
/** Types de secrets présents dans le texte (liste vide = aucun). */
export function detectSecrets(text: unknown): string[] {
  const t = String(text ?? ""); const out: string[] = []; for (const [name, re] of SECRET_PATTERNS) if (re.test(t)) out.push(name); return out;
}

/** Caractères invisibles ou de contrôle du sens de lecture (texte caché, inversion d'affichage). */
export const INVISIBLE = /[\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u{e0000}-\u{e007f}]/u;
const TLD = "com|net|org|io|fr|ci|sn|app|dev|xyz|ru|cn|tk|ml|info|biz|co|me|ly|gg|cc|top|site|online|link|click";

/** Raisons pour lesquelles une sortie de modèle n'est PAS affichée (codes stables, sans extrait du texte). */
export function unsafeOutput(text: string): string[] {
  const r: string[] = [];
  if (/https?:|ftp:|www\.|javascript:|data:|vbscript:|\]\(/i.test(text) || new RegExp(`\\b[a-z0-9-]{2,}\\.(?:${TLD})\\b`, "i").test(text)) r.push("lien");
  if (/[<>`]|\$\{|\{\{/.test(text)) r.push("balise ou code");
  if (INVISIBLE.test(text)) r.push("caractère invisible");
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text)) r.push("adresse e-mail");
  if (detectSecrets(text).length) r.push("secret");
  return r;
}

/** Les marqueurs de structure du prompt ne doivent pas pouvoir être imités par une saisie (style « interactions » : [CONSIGNES] / [DONNÉES]). */
export const neutralizeMarkers = (s: string): string => s.replace(/\[\s*(?:consignes?|donn[ée]es?|syst(?:e|è)me|system|instructions?|assistant|user|question)\s*\]/gi, "(…)").replace(/\u0000/g, "").replace(new RegExp(INVISIBLE.source, "gu"), "");
