import { describe, expect, it } from "vitest";
import { buildOffersPdf } from "./offers-pdf";

describe("PDF des offres Selar", () => {
  it("document valide : couverture, consignes, tarifs, une page par offre (15), procédures", async () => {
    const doc = await buildOffersPdf(new Date("2026-11-08T10:00:00Z"));
    // 1 couverture + 1 consignes + 1 tarifs/récapitulatif + 15 fiches + 1 procédures. Si une fiche débordait, le total changerait.
    expect(doc.getNumberOfPages()).toBe(19);
    const bytes = new Uint8Array(doc.output("arraybuffer"));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(20_000);
  });
});
