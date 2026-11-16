import { useEffect, useState } from "react";

/** État mémorisé sur l'appareil (par commerce) : utile pour les filtres. Valeurs invalides ou stockage indisponible : on repart de la valeur initiale. */
export function usePersistedState<T extends Record<string, unknown>>(key: string, initial: T, keep?: (keyof T)[]): [T, (v: T) => void, () => void] {
  const read = (): T => { try { const v = JSON.parse(localStorage.getItem(key) ?? "null") as Partial<T> | null; if (!v || typeof v !== "object") return initial; const out = { ...initial }; for (const k of Object.keys(initial) as (keyof T)[]) if (typeof v[k] === typeof initial[k] && (keep ? keep.includes(k) : true)) out[k] = v[k] as T[keyof T]; return out; } catch { return initial; } };
  const [s, setS] = useState<T>(read);
  useEffect(() => { try { const o: Partial<T> = {}; for (const k of (keep ?? (Object.keys(s) as (keyof T)[]))) o[k] = s[k]; localStorage.setItem(key, JSON.stringify(o)); } catch { /* préférence non mémorisée */ } }, [s]); // eslint-disable-line react-hooks/exhaustive-deps
  return [s, setS, () => setS(initial)];
}
