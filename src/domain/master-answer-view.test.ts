import { describe, expect, it } from "vitest";
import { answerCards } from "./master-answer-view";
import { periodWindow } from "./master-chat";

const base = { title: "", conclusion: "", period: null, scope: "", sources: [], method: "", observations: [], limits: [], confidence: "high" as const, recommendations: [] };
describe("cartes de réponse", () => {
  it("ventes : écart seulement sur le total, calculé avec la période précédente fournie", () => {
    const c = answerCards({ ...base, qid: "sales", facts: [{ label: "Nombre de ventes", value: 12 }, { label: "Total des ventes (FCFA)", value: 112_400 }, { label: "Remboursements (FCFA)", value: 0 }, { label: "Wave (FCFA)", value: 40_000 }, { label: "Période précédente (FCFA)", value: 100_000 }] });
    expect(c).toHaveLength(4); expect(c[0]).toMatchObject({ label: "Nombre de ventes", unit: "count", deltaPct: null });
    expect(c[1]).toMatchObject({ label: "Total des ventes", unit: "fcfa", deltaPct: 12.4, prev: 100_000 });
    expect(c.some((x) => x.label === "Période précédente")).toBe(false);
  });
  it("aucun écart sans période précédente, ni si elle vaut 0 ; faits texte ignorés", () => {
    expect(answerCards({ ...base, qid: "stock", facts: [{ label: "Ruptures", value: 2 }, { label: "Dernier", value: "aucun" }] })).toEqual([{ label: "Ruptures", value: 2, unit: "count", deltaPct: null, prev: null }]);
    expect(answerCards({ ...base, qid: "sales", facts: [{ label: "Total des ventes (FCFA)", value: 5000 }, { label: "Période précédente (FCFA)", value: 0 }] })[0]!.deltaPct).toBeNull();
  });
});
describe("périodes de l'assistant", () => {
  it("mois en cours : du 1er à aujourd'hui, comparé aux mêmes jours du mois précédent (borné)", () => {
    expect(periodWindow("2026-11-18", -1)).toEqual({ from: "2026-11-01", to: "2026-11-18", pfrom: "2026-10-01", pto: "2026-10-18", label: "mois en cours (novembre 2026)" });
    expect(periodWindow("2026-03-31", -1)).toMatchObject({ pfrom: "2026-02-01", pto: "2026-02-28" });
  });
  it("mois précédent : mois complet comparé au mois d'avant ; jours glissants inchangés", () => {
    expect(periodWindow("2026-01-10", -2)).toEqual({ from: "2025-12-01", to: "2025-12-31", pfrom: "2025-11-01", pto: "2025-11-30", label: "décembre 2025" });
    expect(periodWindow("2026-11-18", 7)).toEqual({ from: "2026-11-12", to: "2026-11-18", pfrom: "2026-11-05", pto: "2026-11-11", label: "7 derniers jours" });
    expect(periodWindow("2026-11-18", 1).label).toBe("aujourd'hui");
  });
});
