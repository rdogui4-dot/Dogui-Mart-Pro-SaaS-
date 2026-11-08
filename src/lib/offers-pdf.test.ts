import { describe, expect, it } from "vitest";
import { buildOffersPdf } from "./offers-pdf";

describe("PDF des produits Selar", () => {
  it("document valide : couverture, consignes, tarifs, une fiche par produit, procédures", async () => {
    const doc = await buildOffersPdf(new Date("2026-11-08T10:00:00Z"));
    // couverture + consignes (1-2 p.) + tarifs + 3 fiches (1-2 p. chacune) + procédures : borné pour détecter un débordement anormal
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(8);
    expect(doc.getNumberOfPages()).toBeLessThanOrEqual(14);
    const bytes = new Uint8Array(doc.output("arraybuffer"));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(15_000);
  });
  it("un domaine plus long ne change pas le nombre de pages", async () => {
    const a = await buildOffersPdf(new Date("2026-11-08T10:00:00Z")); const b = await buildOffersPdf(new Date("2026-11-08T10:00:00Z"), undefined, "https://rdogui4-dot.github.io/Dogui-Mart-Pro-SaaS-");
    expect(b.getNumberOfPages()).toBe(a.getNumberOfPages());
  });
});
