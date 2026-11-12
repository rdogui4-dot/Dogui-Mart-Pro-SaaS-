/** Adaptateur Gemini (étape 5B). Désactivé tant que MASTER_AI_ENABLED n'est pas « true » ET que GEMINI_API_KEY et GEMINI_MODEL ne sont pas définis dans les variables de la fonction :
 *  la clé n'apparaît jamais dans le code, les journaux, les erreurs ni la base. Aucun nom de modèle n'est présumé. */
export type AiConfig = { key: string; model: string; maxOut: number; dailyTokens: number; timeoutMs: number };
type Env = Record<string, string | undefined>;
const posInt = (v: string | undefined, d: number, min: number, max: number) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : d; };
export function aiConfig(env: Env = process.env): AiConfig | null {
  if (env.MASTER_AI_ENABLED !== "true") return null; const key = (env.GEMINI_API_KEY ?? "").trim(); const model = (env.GEMINI_MODEL ?? "").trim().replace(/^models\//, ""); if (!key || !/^[A-Za-z0-9._-]{3,60}$/.test(model)) return null;
  return { key, model, maxOut: posInt(env.MASTER_AI_MAX_OUTPUT_TOKENS, 700, 100, 2000), dailyTokens: posInt(env.MASTER_AI_DAILY_TOKENS, 200_000, 5_000, 5_000_000), timeoutMs: posInt(env.MASTER_AI_TIMEOUT_MS, 20_000, 3_000, 55_000) };
}
export const aiStatus = (env: Env = process.env) => ({ enabledFlag: env.MASTER_AI_ENABLED === "true", keyPresent: !!(env.GEMINI_API_KEY ?? "").trim(), modelSet: !!(env.GEMINI_MODEL ?? "").trim(), active: !!aiConfig(env) });
export class AiError extends Error { constructor(msg: string, readonly status?: number) { super(msg); } }
export type AiResult = { text: string; tokensIn: number; tokensOut: number };
/** Appel REST generateContent : clé en en-tête, sortie JSON demandée, délai borné. Les messages d'erreur ne contiennent ni la clé ni le contenu envoyé. */
export async function geminiJson(cfg: AiConfig, system: string, user: string, doFetch: typeof fetch = fetch): Promise<AiResult> {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    const res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`, { method: "POST", signal: ctrl.signal, headers: { "content-type": "application/json", "x-goog-api-key": cfg.key }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { temperature: 0.2, maxOutputTokens: cfg.maxOut, responseMimeType: "application/json" } }) });
    if (!res.ok) { // le message d'erreur du fournisseur aide à diagnostiquer (modèle inconnu, quota…) ; il ne contient ni la clé ni notre contenu ; on le borne et on masque tout ce qui ressemble à une clé
      let why = ""; try { const b = (await res.json()) as { error?: { message?: string } }; why = String(b.error?.message ?? "").replace(/AIza[0-9A-Za-z_-]{10,}/g, "[clé masquée]").replace(/\s+/g, " ").trim().slice(0, 160); } catch { /* corps illisible */ }
      throw new AiError(`fournisseur IA : réponse HTTP ${res.status}${why ? ` (${why})` : ""}`, res.status);
    }
    const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
    const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? ""; if (!text) throw new AiError("fournisseur IA : réponse vide");
    return { text, tokensIn: Math.max(0, Math.trunc(Number(j.usageMetadata?.promptTokenCount ?? 0))), tokensOut: Math.max(0, Math.trunc(Number(j.usageMetadata?.candidatesTokenCount ?? 0))) };
  } catch (e) { if (e instanceof AiError) throw e; throw new AiError((e as Error).name === "AbortError" ? "fournisseur IA : délai dépassé" : "fournisseur IA : erreur réseau"); }
  finally { clearTimeout(timer); }
}
