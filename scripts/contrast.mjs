/** Vérifie les contrastes (WCAG AA) des jetons de src/index.css, thèmes clair et sombre. Échoue si une paire est sous le seuil. */
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const block = (sel) => { const i = css.indexOf(sel); const j = css.indexOf("}", i); return css.slice(i, j); };
const vars = (b) => Object.fromEntries([...b.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// [premier plan, arrière-plan, seuil, description]
const PAIRS = [
  ["main", "bg", 4.5], ["main", "surface", 4.5], ["soft", "surface", 4.5], ["soft", "bg", 4.5], ["muted", "surface", 4.5], ["muted", "bg", 4.5], ["muted", "subtle", 4.5],
  ["accent-ink", "accent", 4.5], ["accent-text", "surface", 4.5], ["accent-text", "bg", 4.5], ["accent", "surface", 3], ["accent-text", "accent-soft", 4.5],
  ["ok", "surface", 4.5], ["warn", "surface", 4.5], ["bad", "surface", 4.5], ["info", "surface", 4.5],
  ["ok", "ok-bg", 4.5], ["warn", "warn-bg", 4.5], ["bad", "bad-bg", 4.5], ["info", "info-bg", 4.5],
  ["line-strong", "surface", 3], ["line-strong", "bg", 3],
  ["chart-1", "surface", 3], ["chart-2", "surface", 3], ["chart-3", "surface", 3], ["chart-4", "surface", 3], ["chart-5", "surface", 3],
];
let bad = 0;
for (const [name, sel] of [["clair", ":root, [data-theme=\"light\"] {"], ["sombre", "[data-theme=\"dark\"] {"]]) {
  const v = vars(block(sel)); let min = 99;
  for (const [f, b, t] of PAIRS) { const r = ratio(v[f], v[b]); min = Math.min(min, r); if (r < t) { bad++; console.log(`ÉCHEC ${name} : ${f} sur ${b} = ${r.toFixed(2)} (< ${t})`); } }
  console.log(`${name} : ${PAIRS.length} paires, contraste minimal ${min.toFixed(2)}`);
}
process.exit(bad ? 1 : 0);
