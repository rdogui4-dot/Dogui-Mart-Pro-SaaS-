import type { Store } from "./store";
import { journalAnchor } from "./security-log";

declare const __BUILD_SHA__: string | undefined; declare const __BUILT_AT__: string | undefined;
/** Version du code déployé : l'empreinte du commit est injectée à la construction (« dev » en local et dans les tests). Sert à détecter une dérive entre ce qui tourne et ce que le pipeline a publié. */
export const BUILD = { sha: typeof __BUILD_SHA__ === "string" && __BUILD_SHA__ ? __BUILD_SHA__ : "dev", builtAt: typeof __BUILT_AT__ === "string" && __BUILT_AT__ ? __BUILT_AT__ : "" };

export type Health = { ok: true; version: string; builtAt: string; at: string; /** ancre externe du journal de la plateforme : le numéro ne doit jamais reculer */ journal: { seq: number } | null };
/** Sonde de santé publique (SEC-C3-01) : AUCUNE donnée de commerce, aucun identifiant, aucun nom. Une seule lecture (pointeur du journal de la plateforme) : prouve aussi que la base répond.
 *  `journal` vaut null si la lecture échoue (la fonction répond mais la base non : la sonde ne ment pas en disant « seq 0 »). */
export async function healthPing(store: Store): Promise<Health> {
  const journal = await journalAnchor(store).then((seq) => ({ seq }), () => null);
  return { ok: true, version: BUILD.sha, builtAt: BUILD.builtAt, at: new Date().toISOString(), journal };
}
