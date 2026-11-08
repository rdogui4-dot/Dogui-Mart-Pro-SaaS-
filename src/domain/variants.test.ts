import { describe, expect, it } from "vitest";
import { lineKey, normalizeAttributes, variantLabel } from "./variants";

describe("variantes : attributs", () => {
  it("normalise, construit l'étiquette et une clé insensible à la casse et à l'ordre", () => {
    const a = normalizeAttributes([{ name: " Taille ", value: "M" }, { name: "Couleur", value: "Rouge  vif" }]);
    expect(a.label).toBe("M / Rouge vif"); expect(a.attrs[1]).toEqual({ name: "Couleur", value: "Rouge vif" });
    expect(normalizeAttributes([{ name: "couleur", value: "ROUGE VIF" }, { name: "TAILLE", value: "m" }]).key).toBe(a.key);
    expect(normalizeAttributes([{ name: "Taille", value: "L" }, { name: "Couleur", value: "Rouge vif" }]).key).not.toBe(a.key);
  });
  it("refuse vide, doublons, trop long, trop nombreux et types invalides", () => {
    for (const bad of [undefined, [], [{ name: "", value: "M" }], [{ name: "Taille", value: " " }], [{ name: "T", value: "a" }, { name: "t", value: "b" }], [{ name: "x".repeat(31), value: "a" }], [{ name: "T", value: "y".repeat(41) }], [{ name: 1, value: "a" }], Array.from({ length: 6 }, (_, i) => ({ name: `a${i}`, value: "v" }))]) expect(() => normalizeAttributes(bad), JSON.stringify(bad)).toThrow();
  });
  it("clé de ligne : article simple ou variante", () => { expect(lineKey({ productId: "p" })).toBe("p"); expect(lineKey({ productId: "p", variantId: "v" })).toBe("p:v"); });
  it("étiquette d'une variante stockée", () => { expect(variantLabel({ attributes: JSON.stringify([{ name: "Taille", value: "S" }]) })).toBe("S"); expect(variantLabel({ label: "XL" })).toBe("XL"); expect(variantLabel({ attributes: "pas du json" })).toBe(""); });
});
