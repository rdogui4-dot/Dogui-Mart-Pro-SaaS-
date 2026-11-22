/** Point d'entrée du moniteur indépendant (GitHub Actions, tâche planifiée). Usage : npx vite-node scripts/monitor.ts
 *  Variables : GITHUB_TOKEN, GITHUB_REPOSITORY ; MON_SIMULATE = panne | derive | ancre (simulation commandée) ; MON_RESET_ANCHOR = 1 (nouvelle ancre du journal, action humaine). */
import tls from "node:tls";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { decide, nextAnchor } from "../src/domain/monitor";
import { observe, syncIssues, type Cfg, type Deps, type State } from "./monitor-lib";

const env = process.env; const sim = (env.MON_SIMULATE ?? "").trim();
if (sim && !["panne", "derive", "ancre"].includes(sim)) { console.error(`MON_SIMULATE inconnu : ${sim}`); process.exit(2); }
const SITE = env.MON_SITE_URL || "https://rdogui4-dot.github.io/Dogui-Mart-Pro-SaaS-/";
const cfg: Cfg = {
  endpoint: env.MON_APPWRITE_ENDPOINT || "https://fra.cloud.appwrite.io/v1", project: env.MON_APPWRITE_PROJECT || "6ae9d6010001952ea399", functionId: "dmp-api",
  hooksUrl: sim === "panne" ? "https://panne-simulee.invalid/health" : env.MON_HOOKS_URL || "https://dmp-hooks-dogui.fra.appwrite.run/health", siteUrl: SITE,
  tlsHosts: [new URL(SITE).host, new URL(env.MON_APPWRITE_ENDPOINT || "https://fra.cloud.appwrite.io/v1").host, "dmp-hooks-dogui.fra.appwrite.run"], repo: env.GITHUB_REPOSITORY || "rdogui4-dot/Dogui-Mart-Pro-SaaS-", token: env.GITHUB_TOKEN || "", branch: env.MON_BRANCH || "ccr-360cd683-uvf925", workflow: "publish.yml",
};
if (sim === "panne") cfg.endpoint = "https://panne-simulee.invalid/v1";
if (!cfg.token) { console.error("GITHUB_TOKEN manquant"); process.exit(2); }

const STATE_FILE = env.MON_STATE_FILE || ".monitor/state.json";
const state: State = (() => { try { return existsSync(STATE_FILE) ? { anchor: null, session: null, ...JSON.parse(readFileSync(STATE_FILE, "utf8")) } : { anchor: null, session: null }; } catch { return { anchor: null, session: null }; } })();
const deps: Deps = {
  fetch, now: () => new Date(),
  tls: (host) => new Promise((resolve, reject) => { const s = tls.connect({ host, port: 443, servername: host, timeout: 10_000 }, () => { const c = s.getPeerCertificate(); s.end(); resolve(c?.valid_to ? (Date.parse(c.valid_to) - Date.now()) / 86_400_000 : null); }); s.on("error", reject); s.on("timeout", () => { s.destroy(); reject(new Error("délai dépassé")); }); }),
};

const obs = await observe(cfg, deps, state);
if (sim === "ancre" && obs.previousSeq !== null) obs.previousSeq += 1000; // simulation : le journal semble avoir reculé
if (sim === "ancre" && obs.previousSeq === null) obs.previousSeq = 1000;
if (sim === "derive" && obs.deploy) obs.deploy = { ...obs.deploy, latestSuccessSha: "simulation-derive-0000000000000000", latestSuccessAt: "2000-01-01T00:00:00Z", inProgressSince: null };
const alerts = decide(obs);
console.log(JSON.stringify({ at: obs.at, simulation: sim || null, api: obs.api, hooks: obs.hooks, site: obs.site, tls: obs.tls, deploy: obs.deploy && { sha: obs.deploy.latestSuccessSha?.slice(0, 12), at: obs.deploy.latestSuccessAt }, anchor: obs.previousSeq, alerts: alerts.map((a) => a.id) }, null, 1));

if (!sim) { // l'ancre ne bouge qu'en exécution réelle (une simulation ne doit pas la fausser)
  state.anchor = env.MON_RESET_ANCHOR === "1" ? (typeof obs.api.journalSeq === "number" ? obs.api.journalSeq : obs.hooks.journalSeq ?? null) : nextAnchor(obs);
  mkdirSync(STATE_FILE.replace(/[^/\\]+$/, "") || ".", { recursive: true }); writeFileSync(STATE_FILE, JSON.stringify(state));
}
const sync = await syncIssues(cfg, deps, env.MON_RESET_ANCHOR === "1" ? alerts.filter((a) => a.id !== "journal_rewind") : alerts, !!sim);
console.log(`tickets : ${sync.opened.length} ouvert(s) [${sync.opened.join(", ")}], ${sync.closed.length} clos [${sync.closed.join(", ")}]`);
if (alerts.length) { console.error(`::error::${alerts.length} alerte(s) : ${alerts.map((a) => a.id).join(", ")}`); process.exit(1); }
console.log("Tout va bien.");
