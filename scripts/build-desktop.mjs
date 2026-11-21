// Prépare l'application Windows : application web (servie à la racine par le serveur local), code du poste (processus principal + pont), ressources.
// Compilation de l'installateur : `cd desktop && npm install && npm run dist` (sous Windows ou en CI sur windows-latest).
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";

// Valeurs publiques (les mêmes que l'application web publiée) ; surchargeables par l'environnement.
const env = { ...process.env, VITE_BASE_PATH: "/", VITE_APPWRITE_ENDPOINT: process.env.VITE_APPWRITE_ENDPOINT || "https://fra.cloud.appwrite.io/v1", VITE_APPWRITE_PROJECT_ID: process.env.VITE_APPWRITE_PROJECT_ID || "6ae9d6010001952ea399" };
rmSync("desktop/resources", { recursive: true, force: true }); rmSync("desktop/dist", { recursive: true, force: true }); mkdirSync("desktop/resources", { recursive: true });
execSync("npx vite build --outDir desktop/resources/web --emptyOutDir", { stdio: "inherit", env });
const common = { bundle: true, platform: "node", target: "node24", format: "cjs", logLevel: "info", define: { "import.meta.env": "{}" }, external: ["electron", "electron-updater"] };
await build({ ...common, entryPoints: ["desktop/src/main.ts"], outfile: "desktop/dist/main.cjs" });
await build({ ...common, entryPoints: ["desktop/src/preload.ts"], outfile: "desktop/dist/preload.cjs" });
cpSync("desktop/build/icon.png", "desktop/resources/icon.png");
console.log("Application Windows prête dans desktop/ : « cd desktop && npm install && npm run dist » produit l'installateur.");
