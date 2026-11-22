/** Bilan hebdomadaire de la surveillance (GitHub Actions) : résumé dans un ticket + détection d'un moniteur muet. Usage : npx vite-node scripts/bilan.ts */
import { silentMonitor } from "../src/domain/monitor";
import { createBilan, monitorRuns, openAlertTitles, syncIssues, type Cfg, type Deps } from "./monitor-lib";

const env = process.env; const HOURS = 168;
const cfg: Cfg = { endpoint: "", project: "", functionId: "dmp-api", hooksUrl: "", siteUrl: "", tlsHosts: [], repo: env.GITHUB_REPOSITORY || "rdogui4-dot/Dogui-Mart-Pro-SaaS-", token: env.GITHUB_TOKEN || "", branch: "", workflow: "publish.yml" };
if (!cfg.token) { console.error("GITHUB_TOKEN manquant"); process.exit(2); }
const deps: Deps = { fetch, now: () => new Date(), tls: async () => null };
const { runs, failures } = await monitorRuns(cfg, deps, HOURS); const open = (await openAlertTitles(cfg, deps)).filter((t) => !t.startsWith("[SIMULATION]"));
const silent = silentMonitor(runs, HOURS); const sync = await syncIssues(cfg, deps, silent ? [silent] : [], false);
const day = deps.now().toISOString().slice(0, 10);
await createBilan(cfg, deps, `Bilan hebdomadaire de la surveillance — ${day}`, [
  `Période : ${HOURS} dernières heures.`, "", `- Exécutions du moniteur : **${runs}** (environ ${HOURS * 4} attendues, une toutes les 15 minutes)`, `- Exécutions en échec (alerte levée) : **${failures}**`,
  `- Alertes ouvertes : **${open.length}**${open.length ? "\n" + open.map((t) => `  - ${t}`).join("\n") : ""}`, silent ? `- ⚠ **Moniteur muet** : ${silent.detail}` : "- Moniteur actif : le rythme d'exécution est normal.", "",
  "Ce bilan est lui-même un signal de vie : **s'il n'arrive pas un lundi, la surveillance est peut-être arrêtée** — voir `docs/securite/S3-PROCEDURES.md`.",
].join("\n"));
console.log(`bilan créé : ${runs} exécutions, ${failures} échecs, ${open.length} alerte(s) ouverte(s) ; tickets ${JSON.stringify(sync)}`);
if (silent) { console.error(`::error::${silent.title}`); process.exit(1); }
