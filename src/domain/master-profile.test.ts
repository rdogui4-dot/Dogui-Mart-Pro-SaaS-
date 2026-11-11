import { describe, expect, it } from "vitest";
import { FACTS, canConfirm, factDef, labelOf, normalizeValue } from "./master-profile";

describe("profil d'entreprise (domaine)", () => {
  it("catalogue fermé : clés uniques, listes non vides, textes bornés", () => {
    expect(new Set(FACTS.map((f) => f.key)).size).toBe(FACTS.length); for (const f of FACTS) { if (f.type === "enum" || f.type === "multi") expect(f.options!.length).toBeGreaterThan(1); if (f.type === "text") expect(f.maxLen).toBeGreaterThan(0); }
  });
  it("normalise : énumération, multi dédoublonné, mois triés, texte nettoyé", () => {
    expect(normalizeValue(factDef("form")!, "mixte")).toEqual({ ok: true, value: "mixte" }); expect(normalizeValue(factDef("form")!, "x").ok).toBe(false);
    expect(normalizeValue(factDef("priorities")!, ["stock", "stock", "marge"])).toEqual({ ok: true, value: JSON.stringify(["stock", "marge"]) }); expect(normalizeValue(factDef("peakMonths")!, [12, 3, 3])).toEqual({ ok: true, value: "[3,12]" });
    expect(normalizeValue(factDef("remarks")!, " a\u0000 <b> ")).toEqual({ ok: true, value: "a b" }); expect(normalizeValue(factDef("remarks")!, "   ").ok).toBe(false);
  });
  it("libellés et promotion : seules hypothèse et estimation se confirment", () => {
    expect(labelOf(factDef("peakMonths")!, "[1,12]")).toBe("janv., déc."); expect(labelOf(factDef("sector")!, "boissons")).toBe("Boissons"); expect(canConfirm("hypothesis")).toBe(true); expect(canConfirm("estimate")).toBe(true); expect(canConfirm("declared")).toBe(false); expect(canConfirm("verified")).toBe(false);
  });
});
