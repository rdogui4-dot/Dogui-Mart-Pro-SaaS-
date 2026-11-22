/** Moniteur indépendant : observation (entrées-sorties injectables, donc testables sans réseau) et synchronisation des tickets d'alerte.
 *  Aucun identifiant Appwrite : le moniteur se présente comme un visiteur (session anonyme, la seule que l'application accepte déjà), jamais comme un compte. */
import { ISSUE_LABEL, issueIdOf, issueTitle, type Alert, type DeployInfo, type Observation, type Probe, type SiteProbe, type TlsProbe } from "../src/domain/monitor";

export type Cfg = { endpoint: string; project: string; functionId: string; hooksUrl: string; siteUrl: string; tlsHosts: string[]; repo: string; token: string; branch: string; workflow: string; timeoutMs?: number };
export type Deps = { fetch: typeof fetch; tls: (host: string) => Promise<number | null>; now: () => Date };
export type State = { anchor: number | null; session: string | null };

const to = (cfg: Cfg) => AbortSignal.timeout(cfg.timeoutMs ?? 15_000);
const errText = (e: unknown) => { const x = e as { name?: string; message?: string; cause?: { code?: string } }; return `${x.cause?.code ?? x.name ?? "erreur"} : ${String(x.message ?? "").slice(0, 100)}`; };
const json = async (r: Response) => { try { return JSON.parse(await r.text()) as Record<string, any>; } catch { return {} as Record<string, any>; } };
type Ping = { ok?: boolean; version?: string; journal?: { seq?: number } | null };
const asProbe = (d: Ping | undefined, ms: number): Probe => (d && d.ok ? { reachable: true, latencyMs: ms, version: String(d.version ?? ""), journalSeq: d.journal === null ? null : typeof d.journal?.seq === "number" ? d.journal.seq : undefined } : { reachable: false, error: "réponse inattendue" });

export async function probeHooks(cfg: Cfg, deps: Deps): Promise<Probe> {
  const t0 = deps.now().getTime();
  try { const r = await deps.fetch(cfg.hooksUrl, { signal: to(cfg) }); if (r.status !== 200) return { reachable: false, error: `statut HTTP ${r.status}` }; return asProbe((await json(r)) as Ping, deps.now().getTime() - t0); }
  catch (e) { return { reachable: false, error: errText(e) }; }
}

/** dmp-api : session anonyme réutilisée d'une exécution à l'autre (mémorisée dans l'état) ; recréée si elle a expiré. */
export async function probeApi(cfg: Cfg, deps: Deps, state: State): Promise<Probe> {
  const base = cfg.endpoint.replace(/\/+$/, ""); const h = (cookie?: string) => ({ "content-type": "application/json", "x-appwrite-project": cfg.project, ...(cookie ? { "x-fallback-cookies": cookie } : {}) });
  const newSession = async () => { const r = await deps.fetch(`${base}/account/sessions/anonymous`, { method: "POST", headers: h(), body: "{}", signal: to(cfg) }); if (r.status >= 300) throw new Error(`session anonyme refusée (HTTP ${r.status})`); const c = r.headers.get("x-fallback-cookies"); if (!c) throw new Error("session anonyme sans cookie"); return c; };
  const run = async (cookie: string) => { const r = await deps.fetch(`${base}/functions/${cfg.functionId}/executions`, { method: "POST", headers: h(cookie), body: JSON.stringify({ body: JSON.stringify({ action: "health.ping" }), async: false, path: "/", method: "POST", headers: { "content-type": "application/json" } }), signal: to(cfg) }); return { status: r.status, body: await json(r) }; };
  const t0 = deps.now().getTime();
  try {
    let res = state.session ? await run(state.session) : null;
    if (!res || res.status === 401 || res.status === 403) { state.session = await newSession(); res = await run(state.session); }
    if (res.status >= 300) return { reachable: false, error: `exécution refusée (HTTP ${res.status})` };
    const code = Number(res.body.responseStatusCode); if (code !== 200) return { reachable: false, error: `la fonction a répondu ${code || "?"}` };
    let out: { ok?: boolean; data?: Ping } = {}; try { out = JSON.parse(String(res.body.responseBody ?? "")); } catch { /* réponse illisible */ }
    return asProbe(out.data, deps.now().getTime() - t0);
  } catch (e) { return { reachable: false, error: errText(e) }; }
}

export async function probeSite(cfg: Cfg, deps: Deps): Promise<SiteProbe> {
  try {
    const r = await deps.fetch(cfg.siteUrl, { signal: to(cfg), redirect: "follow" }); const html = r.status === 200 ? await r.text() : ""; const out: SiteProbe = { reachable: true, status: r.status, csp: /http-equiv="Content-Security-Policy"/i.test(html) };
    try { const v = await deps.fetch(new URL("version.json", cfg.siteUrl).toString() + `?t=${deps.now().getTime()}`, { signal: to(cfg), cache: "no-store" }); if (v.status === 200) { const j = await json(v); if (typeof j.version === "string") out.version = j.version; } } catch { /* version illisible : pas de comparaison */ }
    return out;
  } catch (e) { return { reachable: false, error: errText(e) }; }
}

export async function probeTls(cfg: Cfg, deps: Deps): Promise<TlsProbe[]> { return Promise.all(cfg.tlsHosts.map(async (host) => { try { const d = await deps.tls(host); return { host, daysLeft: d }; } catch (e) { return { host, daysLeft: null, error: errText(e) }; } })); }

const gh = (cfg: Cfg, deps: Deps, path: string, init: RequestInit = {}) => deps.fetch(`https://api.github.com/repos/${cfg.repo}${path}`, { ...init, headers: { accept: "application/vnd.github+json", authorization: `Bearer ${cfg.token}`, "x-github-api-version": "2022-11-28", "content-type": "application/json" }, signal: to(cfg) });

/** Dernier déploiement RÉUSSI du pipeline de publication (la version qui doit tourner) et déploiement en cours éventuel. */
export async function fetchDeploy(cfg: Cfg, deps: Deps): Promise<DeployInfo | null> {
  try {
    const r = await gh(cfg, deps, `/actions/workflows/${cfg.workflow}/runs?branch=${encodeURIComponent(cfg.branch)}&event=push&per_page=15`); if (r.status !== 200) return null;
    const runs = ((await json(r)).workflow_runs ?? []) as { status: string; conclusion: string | null; head_sha: string; updated_at: string; run_started_at?: string; created_at: string }[];
    const ok = runs.find((x) => x.status === "completed" && x.conclusion === "success"); const going = runs.find((x) => x.status !== "completed");
    return { latestSuccessSha: ok?.head_sha ?? null, latestSuccessAt: ok?.updated_at ?? null, inProgressSince: going ? (going.run_started_at ?? going.created_at) : null };
  } catch { return null; }
}

export async function observe(cfg: Cfg, deps: Deps, state: State): Promise<Observation> {
  const [api, hooks, site, tls, deploy] = await Promise.all([probeApi(cfg, deps, state), probeHooks(cfg, deps), probeSite(cfg, deps), probeTls(cfg, deps), fetchDeploy(cfg, deps)]);
  return { at: deps.now().toISOString(), api, hooks, site, tls, deploy, previousSeq: state.anchor };
}

type Issue = { number: number; title: string; state: string };
/** Un seul ticket ouvert par alerte ; clos (avec un commentaire) quand l'alerte disparaît. Les tickets de simulation sont à part. */
export async function syncIssues(cfg: Cfg, deps: Deps, alerts: Alert[], simulation: boolean): Promise<{ opened: string[]; closed: string[] }> {
  const opened: string[] = [], closed: string[] = [];
  const r = await gh(cfg, deps, `/issues?labels=${ISSUE_LABEL}&state=open&per_page=100`); if (r.status !== 200) throw new Error(`liste des tickets : HTTP ${r.status}`);
  const open = ((await r.json()) as Issue[]).filter((i) => !("pull_request" in i)); const byKey = new Map(open.map((i) => [i.title, i]));
  for (const a of alerts) {
    const title = issueTitle(a.id, simulation); if (byKey.has(title)) continue;
    const body = `**${a.severity === "critical" ? "CRITIQUE" : "Avertissement"}** — ${a.title}\n\n${a.detail}\n\nDétecté par le moniteur indépendant. Ce ticket se ferme tout seul quand la situation est rétablie.${simulation ? "\n\n_Simulation commandée à la main : aucun incident réel._" : ""}`;
    const c = await gh(cfg, deps, "/issues", { method: "POST", body: JSON.stringify({ title, body, labels: [ISSUE_LABEL] }) }); if (c.status >= 300) throw new Error(`création du ticket : HTTP ${c.status}`); opened.push(a.id);
  }
  const live = new Set(alerts.map((a) => issueTitle(a.id, simulation)));
  for (const i of open) {
    const k = issueIdOf(i.title); if (!k || live.has(i.title)) continue; if (simulation && !k.simulation) continue; // une simulation ne ferme JAMAIS un ticket réel ; une exécution réelle ferme aussi les tickets de simulation (jamais un incident)
    await gh(cfg, deps, `/issues/${i.number}/comments`, { method: "POST", body: JSON.stringify({ body: "Situation rétablie : le moniteur ne détecte plus cette alerte. Ticket clos automatiquement." }) });
    await gh(cfg, deps, `/issues/${i.number}`, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "completed" }) }); closed.push(k.id);
  }
  return { opened, closed };
}

/** Nombre d'exécutions du moniteur et échecs sur la période (via le total renvoyé par GitHub : une seule requête par compteur). */
export async function monitorRuns(cfg: Cfg, deps: Deps, hours: number): Promise<{ runs: number; failures: number }> {
  const since = new Date(deps.now().getTime() - hours * 3_600_000).toISOString().slice(0, 19) + "Z"; const q = (extra = "") => `/actions/workflows/surveillance.yml/runs?created=%3E%3D${since}&per_page=1${extra}`;
  const total = async (extra?: string) => { const r = await gh(cfg, deps, q(extra)); if (r.status !== 200) throw new Error(`exécutions du moniteur : HTTP ${r.status}`); return Number((await json(r)).total_count ?? 0); };
  return { runs: await total(), failures: await total("&status=failure") };
}
export async function openAlertTitles(cfg: Cfg, deps: Deps): Promise<string[]> { const r = await gh(cfg, deps, `/issues?labels=${ISSUE_LABEL}&state=open&per_page=100`); if (r.status !== 200) throw new Error(`liste des tickets : HTTP ${r.status}`); return ((await r.json()) as Issue[]).map((i) => i.title); }
export async function createBilan(cfg: Cfg, deps: Deps, title: string, body: string): Promise<void> { const c = await gh(cfg, deps, "/issues", { method: "POST", body: JSON.stringify({ title, body, labels: ["bilan-securite"] }) }); if (c.status >= 300) throw new Error(`création du bilan : HTTP ${c.status}`); }
