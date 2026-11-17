import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import path from "node:path";

// Publication sous un sous-chemin (GitHub Pages : /<dépôt>/) via VITE_BASE_PATH ; à la racine par défaut.
const base = process.env.VITE_BASE_PATH || "/";
if (!/^\/([A-Za-z0-9._~-]+\/)*$/.test(base)) throw new Error(`VITE_BASE_PATH invalide : « ${base} » (attendu : / ou /nom/)`);

export default defineConfig({
  base,
  define: { __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)) },
  plugins: [react(), tailwind()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: { environment: "node", setupFiles: ["functions/dmp-api/src/test-setup.ts"], include: ["src/**/*.test.ts", "functions/**/*.test.ts"] },
});
