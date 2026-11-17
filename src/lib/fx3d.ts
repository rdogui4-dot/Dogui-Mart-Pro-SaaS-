/** Effets 3D (plan 3D motion) : niveau « complet » (ordinateur, appareil récent), « allégé » (téléphone, tactile), « plat » (mouvement réduit, économie de données, appareil modeste, préférence désactivée). */
import { useEffect, useState } from "react";

export type FxPref = "auto" | "on" | "off";
export type FxLevel = "full" | "lite" | "flat";
const KEY = "dmp.pref.fx3d";

export function readFxPref(): FxPref { try { const v = localStorage.getItem(KEY); return v === "on" || v === "off" ? v : "auto"; } catch { return "auto"; } }
export function writeFxPref(v: FxPref) { try { if (v === "auto") localStorage.removeItem(KEY); else localStorage.setItem(KEY, v); } catch { /* préférence non mémorisée */ } apply(); window.dispatchEvent(new Event("dmp-fx3d")); }

/** Appareil modeste ou économie de données : la 3D reste plate. */
export function isModest(): boolean {
  const n = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return !!n.connection?.saveData || (!!n.hardwareConcurrency && n.hardwareConcurrency < 4) || (!!n.deviceMemory && n.deviceMemory < 4);
}
export function fxLevel(pref: FxPref = readFxPref()): FxLevel {
  if (typeof matchMedia !== "function") return "flat";
  if (pref === "off" || matchMedia("(prefers-reduced-motion: reduce)").matches) return "flat";
  const coarse = matchMedia("(pointer: coarse)").matches || innerWidth < 768;
  if (pref === "on") return coarse ? "lite" : "full";
  if (isModest()) return "flat";
  return coarse ? "lite" : "full";
}
/** Écrit le niveau sur <html data-fx3d> : les styles 3D en dépendent. */
export function apply() { try { document.documentElement.dataset.fx3d = fxLevel(); } catch { /* hors navigateur */ } }

export function useFxLevel(): FxLevel {
  const [l, setL] = useState<FxLevel>(() => fxLevel());
  useEffect(() => {
    const up = () => { apply(); setL(fxLevel()); }; const mq = matchMedia("(prefers-reduced-motion: reduce)");
    window.addEventListener("dmp-fx3d", up); window.addEventListener("resize", up); mq.addEventListener("change", up); up();
    return () => { window.removeEventListener("dmp-fx3d", up); window.removeEventListener("resize", up); mq.removeEventListener("change", up); };
  }, []);
  return l;
}

/** WebGL disponible (pour les graphiques 3D) ; sinon repli sur les graphiques plats. */
let webgl: boolean | null = null;
export function hasWebGL(): boolean {
  if (webgl !== null) return webgl;
  try { const c = document.createElement("canvas"); webgl = !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { webgl = false; }
  return webgl;
}

/** Inclinaison suivant le pointeur (niveau complet seulement), bornée à ±maxDeg. Renvoie les gestionnaires à poser sur l'élément. */
export function tiltHandlers(maxDeg = 4) {
  return {
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => { if (e.pointerType !== "mouse" || document.documentElement.dataset.fx3d !== "full") return; const r = e.currentTarget.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5; e.currentTarget.style.setProperty("--rx", `${(-y * maxDeg * 2).toFixed(2)}deg`); e.currentTarget.style.setProperty("--ry", `${(x * maxDeg * 2).toFixed(2)}deg`); },
    onPointerLeave: (e: React.PointerEvent<HTMLElement>) => { e.currentTarget.style.setProperty("--rx", "0deg"); e.currentTarget.style.setProperty("--ry", "0deg"); },
  };
}
