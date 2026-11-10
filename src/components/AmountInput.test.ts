import { describe, expect, it } from "vitest";
import { groupDigits } from "./AmountInput";
describe("saisie de montant", () => {
  it("groupe les milliers, ne garde que des chiffres, retire les zéros de tête", () => {
    expect(groupDigits("100000")).toBe("100 000"); expect(groupDigits("1 234 567")).toBe("1 234 567"); expect(groupDigits("12,5 abc")).toBe("125"); expect(groupDigits("")).toBe(""); expect(groupDigits("007")).toBe("7"); expect(groupDigits("0")).toBe("0");
    expect(Number(groupDigits("250000").replace(/\s/g, ""))).toBe(250000);
  });
});
