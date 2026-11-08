// Déploie la fonction `dmp-api` sur Appwrite : empaquette functions/dmp-api/dist/main.js, envoie le déploiement, attend le résultat.
// Usage : npm run functions:build && APPWRITE_API_KEY=... node scripts/deploy-function.mjs [--dry-run]
// Variables : VITE_APPWRITE_ENDPOINT, VITE_APPWRITE_PROJECT_ID, APPWRITE_API_KEY (scopes functions.read + functions.write).
// --dry-run : crée et liste l'archive sans rien envoyer (aucune clé requise).
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, Functions } from "node-appwrite";
import { InputFile } from "node-appwrite/file";

const FUNCTION_ID = "dmp-api", ENTRY = "dist/main.js", DIR = "functions/dmp-api";
const dry = process.argv.includes("--dry-run");
if (!existsSync(join(DIR, ENTRY))) { console.error(`${join(DIR, ENTRY)} introuvable : lancez d'abord « npm run functions:build ».`); process.exit(1); }

// L'archive contient dist/main.js à sa racine : c'est le chemin déclaré comme point d'entrée de la fonction.
const archive = join(mkdtempSync(join(tmpdir(), "dmp-fn-")), "code.tar.gz");
execFileSync("tar", ["-czf", archive, "-C", DIR, ENTRY]);
const listing = execFileSync("tar", ["-tzf", archive]).toString().trim();
console.log(`Archive : ${(statSync(archive).size / 1024).toFixed(0)} Ko — contenu : ${listing.split("\n").join(", ")}`);
if (dry) { console.log("Mode --dry-run : rien n'est envoyé."); process.exit(0); }

const { VITE_APPWRITE_ENDPOINT: endpoint, VITE_APPWRITE_PROJECT_ID: project, APPWRITE_API_KEY: key } = process.env;
if (!endpoint || !project || !key) { console.error("Variables manquantes : VITE_APPWRITE_ENDPOINT, VITE_APPWRITE_PROJECT_ID, APPWRITE_API_KEY"); process.exit(1); }
const fn = new Functions(new Client().setEndpoint(endpoint).setProject(project).setKey(key));

const dep = await fn.createDeployment({ functionId: FUNCTION_ID, code: InputFile.fromPath(archive, "code.tar.gz"), activate: true, entrypoint: ENTRY });
console.log(`Déploiement ${dep.$id} créé, construction en cours…`);
for (let i = 0; i < 60; i++) { // 5 minutes au plus
  await new Promise((r) => setTimeout(r, 5000));
  const d = await fn.getDeployment({ functionId: FUNCTION_ID, deploymentId: dep.$id });
  if (d.status === "ready") { console.log("Fonction déployée et active."); process.exit(0); }
  if (d.status === "failed" || d.status === "canceled") { console.error(`Échec du déploiement (${d.status}).`); process.exit(1); }
}
console.error("Délai dépassé : le déploiement n'est pas terminé après 5 minutes. Vérifiez dans la console Appwrite."); process.exit(1);
