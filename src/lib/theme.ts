/** Thème clair (par défaut) ou sombre, mémorisé sur l'appareil. Le stockage peut être indisponible : on retombe alors sur le clair. */
export type Theme = "light" | "dark";
const KEY = "dmp-theme";
export function getTheme(): Theme {
  try { return localStorage.getItem(KEY) === "dark" ? "dark" : "light"; } catch { return "light"; }
}
export function setTheme(t: Theme) {
  try { localStorage.setItem(KEY, t); } catch { /* préférence non mémorisée */ }
  document.documentElement.setAttribute("data-theme", t);
  document.querySelector("meta[name=theme-color]")?.setAttribute("content", t === "dark" ? "#0e1621" : "#f4f6f9");
}
