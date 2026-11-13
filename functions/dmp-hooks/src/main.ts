/** Fonction publique `dmp-hooks` : reçoit UNIQUEMENT la notification de paiement MASTER DOGUI. Aucune autre action n'y est exposée (le routeur de dmp-api reste réservé aux utilisateurs connectés). */
import { appwriteStore } from "../../dmp-api/src/appwrite-store";
import { TOKEN_RE, processWebhook } from "../../dmp-api/src/master-pay";

/** Frein de rafale (par instance) : au-delà de 30 jetons invalides par minute, réponse 429 immédiate sans aucun travail. */
const bad = { at: 0, n: 0 };
const tooMany = () => { const now = Date.now(); if (now - bad.at > 60_000) { bad.at = now; bad.n = 0; } return bad.n > 30; };

type Req = { method: string; headers: Record<string, string>; query?: Record<string, string>; path?: string; bodyRaw?: string; bodyText?: string; bodyJson?: unknown };
type Res = { json(body: unknown, status?: number): unknown };
export default async ({ req, res }: { req: Req; res: Res }) => {
  if (req.method !== "POST") return res.json({ ok: false }, 404);
  if (tooMany()) return res.json({ ok: false }, 429);
  const token = String(req.query?.k ?? /[?&]k=([A-Za-z0-9]+)/.exec(String(req.path ?? ""))?.[1] ?? ""); if (!TOKEN_RE.test(token)) { bad.n++; return res.json({ ok: false }, 404); }
  const raw = typeof req.bodyRaw === "string" ? req.bodyRaw : typeof req.bodyText === "string" ? req.bodyText : req.bodyJson !== undefined ? JSON.stringify(req.bodyJson) : "";
  const store = appwriteStore(process.env.APPWRITE_FUNCTION_API_ENDPOINT!, process.env.APPWRITE_FUNCTION_PROJECT_ID!, req.headers["x-appwrite-key"]!, process.env.DATABASE_ID || "dmp");
  try { const r = await processWebhook(store, { token, raw, contentType: req.headers["content-type"] }, { cacheMs: 30_000 }); if (r.status === 404) bad.n++; return res.json(r.body, r.status); }
  catch { return res.json({ ok: false, error: "erreur interne" }, 500); }
};
