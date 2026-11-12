/** Adaptateur Gemini (étape 5B). Désactivé tant que MASTER_AI_ENABLED n'est pas « true » ET que GEMINI_API_KEY et GEMINI_MODEL ne sont pas définis dans les variables de la fonction :
 *  la clé n'apparaît jamais dans le code, les journaux, les erreurs ni la base. Aucun nom de modèle n'est présumé. */
export type AiStyle = "generate" | "interactions";
export type AiConfig = { key: string; model: string; apiVersion: string; style: AiStyle; maxOut: number; dailyTokens: number; timeoutMs: number };
type Env = Record<string, string | undefined>;
const posInt = (v: string | undefined, d: number, min: number, max: number) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : d; };
export function aiConfig(env: Env = process.env): AiConfig | null {
  if (env.MASTER_AI_ENABLED !== "true") return null; const key = (env.GEMINI_API_KEY ?? "").trim(); const model = (env.GEMINI_MODEL ?? "").trim().replace(/^models\//, ""); if (!key || !/^[A-Za-z0-9._-]{3,60}$/.test(model)) return null;
  const apiVersion = /^(v1|v1beta|v1alpha)$/.test((env.GEMINI_API_VERSION ?? "").trim()) ? (env.GEMINI_API_VERSION ?? "").trim() : "v1beta";
  const style: AiStyle = (env.GEMINI_API_STYLE ?? "").trim() === "interactions" ? "interactions" : "generate";
  return { key, model, apiVersion, style, maxOut: posInt(env.MASTER_AI_MAX_OUTPUT_TOKENS, 700, 100, 2000), dailyTokens: posInt(env.MASTER_AI_DAILY_TOKENS, 200_000, 5_000, 5_000_000), timeoutMs: posInt(env.MASTER_AI_TIMEOUT_MS, 20_000, 3_000, 55_000) };
}
export const aiStatus = (env: Env = process.env) => ({ enabledFlag: env.MASTER_AI_ENABLED === "true", keyPresent: !!(env.GEMINI_API_KEY ?? "").trim(), modelSet: !!(env.GEMINI_MODEL ?? "").trim(), apiVersion: aiConfig(env)?.apiVersion ?? null, style: aiConfig(env)?.style ?? null, active: !!aiConfig(env) });
export class AiError extends Error { constructor(msg: string, readonly status?: number) { super(msg); } }
export type AiResult = { text: string; tokensIn: number; tokensOut: number };
/** Appel REST generateContent : clé en en-tête, sortie JSON demandée, délai borné. Les messages d'erreur ne contiennent ni la clé ni le contenu envoyé. */
export async function geminiJson(cfg: AiConfig, system: string, user: string, doFetch: typeof fetch = fetch): Promise<AiResult> {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    if (cfg.style === "interactions") return await interactions(cfg, system, user, doFetch, ctrl.signal);
    const res = await doFetch(`https://generativelanguage.googleapis.com/${cfg.apiVersion}/models/${encodeURIComponent(cfg.model)}:generateContent`, { method: "POST", signal: ctrl.signal, headers: { "content-type": "application/json", "x-goog-api-key": cfg.key }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { temperature: 0.2, maxOutputTokens: cfg.maxOut, responseMimeType: "application/json" } }) });
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

// ------------------------------------------------------------------ API « interactions » (POST /<version>/interactions, corps {model, input}, d'après l'exemple REST d'AI Studio)
const errWhy = async (res: Response) => { let why = ""; try { const b = (await res.json()) as { error?: { message?: string } }; why = String(b.error?.message ?? "").replace(/AIza[0-9A-Za-z_-]{10,}/g, "[clé masquée]").replace(/\s+/g, " ").trim().slice(0, 160); } catch { /* corps illisible */ } return why; };
/** Le format de la réponse n'est pas documenté ici : on lit « output_text » s'il existe, sinon on rassemble les champs « text » ; sinon erreur explicite listant les NOMS des champs reçus (jamais leur contenu). */
export function textOf(j: unknown): string {
  if (j && typeof j === "object" && typeof (j as { output_text?: unknown }).output_text === "string") return (j as { output_text: string }).output_text;
  const parts: string[] = []; const walk = (v: unknown, depth: number) => { if (depth > 6 || v === null || typeof v !== "object") return; if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; } for (const [k, x] of Object.entries(v as Record<string, unknown>)) { if (k === "text" && typeof x === "string") parts.push(x); else walk(x, depth + 1); } };
  walk(j, 0); return parts.join("");
}
function tokensOf(j: unknown): { in: number; out: number } | null {
  let tin: number | null = null; let tout: number | null = null; const walk = (v: unknown, depth: number) => { if (depth > 3 || v === null || typeof v !== "object") return; for (const [k, x] of Object.entries(v as Record<string, unknown>)) { if (typeof x === "number") { if (/(input|prompt).*token/i.test(k) && tin === null) tin = x; else if (/(output|candidates|completion).*token/i.test(k) && tout === null) tout = x; } else walk(x, depth + 1); } };
  walk(j, 0); return tin !== null || tout !== null ? { in: Math.max(0, Math.trunc(tin ?? 0)), out: Math.max(0, Math.trunc(tout ?? 0)) } : null;
}
async function interactions(cfg: AiConfig, system: string, user: string, doFetch: typeof fetch, signal: AbortSignal): Promise<AiResult> {
  const input = `[CONSIGNES]\n${system}\n\n[DONNÉES]\n${user}`;
  const res = await doFetch(`https://generativelanguage.googleapis.com/${cfg.apiVersion}/interactions`, { method: "POST", signal, headers: { "content-type": "application/json", "x-goog-api-key": cfg.key }, body: JSON.stringify({ model: cfg.model, input }) });
  if (!res.ok) { const why = await errWhy(res); throw new AiError(`fournisseur IA : réponse HTTP ${res.status}${why ? ` (${why})` : ""}`, res.status); }
  const j = (await res.json()) as unknown; const text = textOf(j);
  if (!text) throw new AiError(`fournisseur IA : réponse sans texte exploitable (champs reçus : ${Object.keys((j && typeof j === "object" ? j : {}) as object).slice(0, 8).join(", ") || "aucun"})`);
  const tk = tokensOf(j); return { text, tokensIn: tk?.in ?? Math.ceil(input.length / 4), tokensOut: tk?.out ?? Math.ceil(text.length / 4) };
}
