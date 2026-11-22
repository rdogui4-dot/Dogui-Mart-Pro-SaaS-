// Empaquette la fonction (domaine partagé + node-appwrite) en un seul fichier : aucune installation côté Appwrite.
import { build } from "esbuild";
// Empreinte du commit et date de construction, inscrites dans le code déployé (sonde de santé : détection de dérive). « dev » hors pipeline.
const BUILD = { __BUILD_SHA__: JSON.stringify(process.env.GITHUB_SHA || "dev"), __BUILT_AT__: JSON.stringify(new Date().toISOString()) };
await build({
  entryPoints: ["functions/dmp-api/src/main.ts"], bundle: true, platform: "node", format: "esm", target: "node22",
  outfile: "functions/dmp-api/dist/main.js", banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  define: { "import.meta.env": "{}", ...BUILD }, logLevel: "info",
});
await build({
  entryPoints: ["functions/dmp-hooks/src/main.ts"], bundle: true, platform: "node", format: "esm", target: "node22",
  outfile: "functions/dmp-hooks/dist/main.js", banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  define: { "import.meta.env": "{}", ...BUILD }, logLevel: "info",
});
await build({
  entryPoints: ["functions/dmp-local/src/cli.ts"], bundle: true, platform: "node", format: "esm", target: "node22",
  outfile: "functions/dmp-local/dist/server.mjs", banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  define: { "import.meta.env": "{}", ...BUILD }, logLevel: "info",
});
