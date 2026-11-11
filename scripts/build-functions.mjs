// Empaquette la fonction (domaine partagé + node-appwrite) en un seul fichier : aucune installation côté Appwrite.
import { build } from "esbuild";
await build({
  entryPoints: ["functions/dmp-api/src/main.ts"], bundle: true, platform: "node", format: "esm", target: "node22",
  outfile: "functions/dmp-api/dist/main.js", banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  define: { "import.meta.env": "{}" }, logLevel: "info",
});
await build({
  entryPoints: ["functions/dmp-hooks/src/main.ts"], bundle: true, platform: "node", format: "esm", target: "node22",
  outfile: "functions/dmp-hooks/dist/main.js", banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  define: { "import.meta.env": "{}" }, logLevel: "info",
});
