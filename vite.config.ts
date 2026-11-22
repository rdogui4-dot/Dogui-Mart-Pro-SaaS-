import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import path from "node:path";
import { createHash } from "node:crypto";

/** Politique de sécurité du contenu (CSP) injectée à la construction : GitHub Pages n'envoie pas d'en-têtes, la balise <meta> est donc le seul moyen.
 *  Les scripts en ligne de la page sont autorisés par leur empreinte SHA-256 (calculée ici : jamais de 'unsafe-inline' pour les scripts). frame-ancestors n'est pas pris en charge dans une balise <meta>. */
const csp = () => ({
  name: "dmp-csp",
  apply: "build" as const,
  transformIndexHtml: { order: "post" as const, handler(html: string) {
    const hashes = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${createHash("sha256").update(m[1]!).digest("base64")}'`);
    const policy = [
      "default-src 'self'", `script-src 'self' ${hashes.join(" ")}`.trim(), "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:", "font-src 'self' data:", "media-src 'self' blob: data:",
      "connect-src 'self' https://*.appwrite.io https://cloud.appwrite.io http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
      "worker-src 'self' blob:", "manifest-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'",
    ].join("; ");
    return html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
  } },
});

// Publication sous un sous-chemin (GitHub Pages : /<dépôt>/) via VITE_BASE_PATH ; à la racine par défaut.
const base = process.env.VITE_BASE_PATH || "/";
if (!/^\/([A-Za-z0-9._~-]+\/)*$/.test(base)) throw new Error(`VITE_BASE_PATH invalide : « ${base} » (attendu : / ou /nom/)`);

export default defineConfig({
  base,
  define: { __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)) },
  plugins: [react(), tailwind(), csp()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: { environment: "node", setupFiles: ["functions/dmp-api/src/test-setup.ts"], include: ["src/**/*.test.ts", "functions/**/*.test.ts", "desktop/src/**/*.test.ts", "scripts/**/*.test.ts"] },
});
