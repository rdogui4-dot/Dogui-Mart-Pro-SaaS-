import { describe, expect, it } from "vitest";
import { GUIDED, LIMITS, cleanQuestion, groundedCheck, matchQuestion, normalize, numbersOf, periodDays, retentionCutoff } from "./master-chat";

describe("assistant (domaine)", () => {
  it("catalogue : identifiants uniques, mots-clés normalisés", () => { expect(new Set(GUIDED.map((g) => g.id)).size).toBe(GUIDED.length); for (const g of GUIDED) for (const k of g.keywords) expect(normalize(k)).toBe(k); });
  it("nettoyage : balises et contrôles retirés, borne de longueur", () => { expect(cleanQuestion(" a\u0000<b> c ")).toEqual({ ok: true, text: "a b c" }); expect(cleanQuestion("").ok).toBe(false); expect(cleanQuestion("x".repeat(LIMITS.question + 1)).ok).toBe(false); expect(cleanQuestion("x".repeat(LIMITS.question)).ok).toBe(true); });
  it("appariement : sujet et période déterministes, ambigu et inconnu gérés", () => {
    expect(matchQuestion("Mes ventes de la semaine ?")).toEqual({ kind: "match", id: "sales", days: 7 }); expect(matchQuestion("chiffre d'affaires aujourd'hui")).toEqual({ kind: "match", id: "sales", days: 1 }); expect(matchQuestion("articles en rupture ce mois")).toMatchObject({ kind: "match", id: "stock", days: 30 });
    expect(matchQuestion("Raconte-moi une blague")).toEqual({ kind: "none" }); expect(matchQuestion("")).toEqual({ kind: "none" }); expect(matchQuestion("vente stock")).toMatchObject({ kind: "ambiguous" }); expect(periodDays("hier")).toBe(7);
  });
  it("fondement : un nombre inventé est détecté, les dates et séparateurs ne gênent pas", () => {
    expect(numbersOf("Total 6 000 FCFA, soit 12,5 %")).toEqual([6000, 12.5]); expect(groundedCheck("Ventes : 6 000 FCFA le 2026-03-10", [6000]).ok).toBe(true); const g = groundedCheck("Ventes : 6 000 FCFA, +37 %", [6000]); expect(g.ok).toBe(false); expect(g.unknown).toEqual([37]);
  });
  it("conservation : seuil à 12 mois", () => { const c = Date.parse(retentionCutoff(Date.parse("2027-01-01T00:00:00Z"))); expect(Date.parse("2027-01-01T00:00:00Z") - c).toBeGreaterThan(360 * 864e5); });
});
