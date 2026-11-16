import { useEffect, useState } from "react";

/** Vrai quand la largeur de la fenêtre est d'au moins `px` pixels (se met à jour au redimensionnement). */
export function useMinWidth(px: number): boolean {
  const q = `(min-width: ${px}px)`;
  const [ok, setOk] = useState(() => typeof matchMedia === "function" && matchMedia(q).matches);
  useEffect(() => { const m = matchMedia(q); const f = () => setOk(m.matches); m.addEventListener("change", f); f(); return () => m.removeEventListener("change", f); }, [q]);
  return ok;
}
