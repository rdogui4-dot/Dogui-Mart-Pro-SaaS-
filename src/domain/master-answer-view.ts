/** Présentation d'une réponse MASTER (kit écran Assistant) : cartes d'indicateurs tirées des faits chiffrés de la réponse.
 *  Un écart n'est affiché que si la réponse contient la valeur de la période précédente pour CE fait (décision K19 2a). Calcul pur, aucune valeur ajoutée. */
import type { Answer } from "./master-chat";

export type AnswerCard = { label: string; value: number; unit: "fcfa" | "pct" | "count"; deltaPct: number | null; prev: number | null };
const PREV = "Période précédente (FCFA)";
/** Fait comparé à la « Période précédente » dans chaque sujet qui la fournit. */
export const COMPARED: Record<string, string> = { sales: "Total des ventes (FCFA)", expenses: "Dépenses approuvées (FCFA)" };
const unitOf = (label: string): AnswerCard["unit"] => (/\(FCFA\)$/.test(label) ? "fcfa" : /\(%\)$/.test(label) ? "pct" : "count");
const clean = (label: string) => label.replace(/\s*\((FCFA|%)\)$/, "");

export function answerCards(a: Answer, max = 4): AnswerCard[] {
  const prevFact = a.facts.find((f) => f.label === PREV); const prev = typeof prevFact?.value === "number" ? prevFact.value : null;
  return a.facts.filter((f) => typeof f.value === "number" && f.label !== PREV).slice(0, max).map((f) => {
    const v = f.value as number; const compared = COMPARED[a.qid] === f.label && prev !== null;
    return { label: clean(f.label), value: v, unit: unitOf(f.label), prev: compared ? prev : null, deltaPct: compared && prev! > 0 ? Math.round(((v - prev!) / prev!) * 1000) / 10 : null };
  });
}
