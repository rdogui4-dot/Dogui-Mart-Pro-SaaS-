import { describe, expect, it } from "vitest";
import { amountOf, convertQty, fromScaled, parseDecimal, qtyFor, scaledInt, validFactor } from "./quantity";
import { lineTotal } from "./money";

describe("quantités décimales", () => {
  it("lit les décimales jusqu'à 3 chiffres, refuse le reste", () => {
    expect(parseDecimal("1,5")).toBe(1.5); expect(parseDecimal(2)).toBe(2); expect(parseDecimal("0.001")).toBe(0.001);
    for (const bad of ["0", "-1", "1.2345", "abc", "", "1e3", "1.", null, undefined, NaN, 0.1 + 0.2, 1e12]) expect(parseDecimal(bad as never), String(bad)).toBeNull();
  });
  it("respecte l'échelle de l'article", () => {
    expect(qtyFor("12", 0)).toBe(12); expect(() => qtyFor("1.5", 0)).toThrow("entière"); expect(qtyFor("1.5", 1)).toBe(1.5); expect(() => qtyFor("1.55", 1)).toThrow("1 décimale"); expect(qtyFor("1.555", 3)).toBe(1.555);
  });
  it("stocke en entiers exacts et relit sans dérive", () => {
    expect(scaledInt(1.5, 3)).toBe(1500); expect(scaledInt(0.001, 3)).toBe(1); expect(scaledInt(2.675, 3)).toBe(2675); expect(fromScaled(2675, 3)).toBe(2.675); expect(fromScaled(7, 0)).toBe(7);
    // 0,1 + 0,2 avec des flottants donne 0,30000000000000004 ; avec des entiers : exact
    expect(fromScaled(scaledInt(0.1, 3) + scaledInt(0.2, 3), 3)).toBe(0.3);
    let sum = 0; for (let i = 0; i < 1000; i++) sum += scaledInt(0.001, 3); expect(fromScaled(sum, 3)).toBe(1);
  });
  it("convertit les conditionnements sans reste ni arrondi caché", () => {
    expect(convertQty(2, 12, 0)).toBe(24);
    expect(() => convertQty(0.5, 25, 0)).toThrow("nombre entier"); expect(convertQty(0.5, 25, 1)).toBe(12.5); expect(convertQty(3, 0.333, 3)).toBe(0.999);
    expect(() => convertQty(1, 0.3333, 3)).toThrow("nombre entier");
  });
  it("valide les coefficients à l'échelle de l'article", () => {
    expect(validFactor(12, 0)).toBe(true); expect(validFactor(0.5, 0)).toBe(false); expect(validFactor(0.5, 1)).toBe(true); expect(validFactor(0, 3)).toBe(false); expect(validFactor(2_000_000, 0)).toBe(false);
  });
  it("calcule le montant d'une ligne au franc près, sans dérive", () => {
    expect(amountOf(1500, 1.5)).toBe(2250); expect(amountOf(333, 0.5)).toBe(167); expect(amountOf(500, 0.333)).toBe(167); // 166,5 arrondi au franc supérieur
    expect(lineTotal({ productId: "p", name: "x", unitPrice: 500, qty: 0.333 })).toBe(167);
    expect(lineTotal({ productId: "p", name: "x", unitPrice: 1000, qty: 2.5, discountPct: 10 })).toBe(2250);
    // cas où le flottant brut donne 14,499999… au lieu de 14,5 : le montant doit arrondir au franc supérieur
    expect(lineTotal({ productId: "p", name: "x", unitPrice: 25, qty: 0.58 })).toBe(15); expect(lineTotal({ productId: "p", name: "x", unitPrice: 30, qty: 2.05 })).toBe(62); expect(amountOf(45, 0.7)).toBe(32);
    for (let i = 1; i < 2000; i++) expect(amountOf(1000, i / 1000)).toBe(i);
  });
});
