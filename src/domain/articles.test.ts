import { describe, expect, it } from "vitest";
import { marginOf, normalizeArticle, normalizePatch, sellsAtLoss } from "./articles";
import { FEATURES, PRO_LOCKED, planAllows } from "./features";

describe("articles : validation", () => {
  it("exige une désignation", () => { expect(() => normalizeArticle({ price: 100 })).toThrow("désignation"); expect(() => normalizeArticle({ name: "   " })).toThrow("désignation"); });
  it("normalise les champs et applique les valeurs par défaut", () => {
    const a = normalizeArticle({ name: "  Riz   parfumé ", price: "4 500", cost: "3800" });
    expect(a).toMatchObject({ name: "Riz parfumé", price: 4500, cost: 3800, unit: "piece", minStock: 0, archived: false });
  });
  it("refuse décimales, négatifs, aberrations et non-nombres", () => {
    expect(() => normalizeArticle({ name: "A", price: 10.5 })).toThrow("entier");
    expect(() => normalizeArticle({ name: "A", price: -1 })).toThrow("négatif");
    expect(() => normalizeArticle({ name: "A", cost: 1e12 })).toThrow("trop élevé");
    expect(() => normalizeArticle({ name: "A", price: "abc" })).toThrow("invalide");
  });
  it("refuse unité inconnue, code-barres douteux et seuil invalide", () => {
    expect(() => normalizeArticle({ name: "A", unit: "tonne" })).toThrow("Unité");
    expect(() => normalizeArticle({ name: "A", barcode: "12 3<script>" })).toThrow("Code-barres");
    expect(() => normalizeArticle({ name: "A", minStock: -2 })).toThrow("Seuil");
    expect(() => normalizeArticle({ name: "A", minStock: 1.5 })).toThrow("Seuil");
  });
  it("modification partielle : ne renvoie que les champs fournis", () => {
    expect(normalizePatch({ price: "2000" })).toEqual({ price: 2000 });
    expect(normalizePatch({ name: " Sucre ", unit: "kg" })).toEqual({ name: "Sucre", unit: "kg" });
    expect(() => normalizePatch({ name: "" })).toThrow("désignation");
    expect(() => normalizePatch({ cost: -5 })).toThrow("négatif");
  });
});
describe("articles : marge", () => {
  it("calcule marge et pourcentage", () => { expect(marginOf(1000, 700)).toEqual({ amount: 300, pct: 30 }); expect(marginOf(0, 0).pct).toBeNull(); });
  it("signale la vente à perte", () => { expect(sellsAtLoss(500, 700)).toBe(true); expect(sellsAtLoss(700, 700)).toBe(false); expect(sellsAtLoss(0, 0)).toBe(false); });
});
describe("droits d'abonnement", () => {
  it("Articles : Business et Pro, pas Starter", () => { expect(planAllows("starter", "articles")).toBe(false); expect(planAllows("business", "articles")).toBe(true); expect(planAllows("pro", "articles")).toBe(true); });
  it("fonctions avancées : Pro uniquement", () => { for (const k of PRO_LOCKED) { expect(planAllows("business", k)).toBe(false); expect(planAllows("pro", k)).toBe(true); } expect(PRO_LOCKED.length).toBe(Object.keys(FEATURES).length - 5); });
  it("formule inconnue = aucun droit payant", () => { expect(planAllows(undefined, "articles")).toBe(false); expect(planAllows("zzz", "articles")).toBe(false); });
});
