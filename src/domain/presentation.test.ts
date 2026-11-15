import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_PLANS } from "./subscriptions";

/** La page publique est statique : ce test garde ses tarifs et ses limites alignés sur la configuration par défaut (une seule source de vérité). */
const html = readFileSync(new URL("../../public/presentation/index.html", import.meta.url), "utf8");
const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;| | /g, " ").replace(/\s+/g, " ");
const fmt = (n: number) => n.toLocaleString("fr-FR").replace(/[  ]/g, " ");

describe("page publique /presentation/", () => {
  for (const p of DEFAULT_PLANS) {
    it(`${p.name} : prix mensuel et limites identiques à la configuration`, () => {
      expect(text).toContain(`${fmt(p.prices.month)} FCFA`);
      expect(text).toContain(p.name);
      if (p.limits.maxShops > 0) expect(text).toMatch(new RegExp(`${p.limits.maxShops} boutiques?`));
      expect(text).toMatch(new RegExp(`${p.limits.maxUsers} utilisateurs`));
      if (p.limits.maxProducts > 0) expect(text).toContain(`${fmt(p.limits.maxProducts)} articles`);
      else expect(text).toContain("Articles sans limite");
    });
  }
  it("MASTER DOGUI : essai 14 jours, 15 000 puis 2 500 FCFA", () => {
    expect(text).toContain("14 jours"); expect(text).toContain("15 000 FCFA"); expect(text).toContain("2 500 FCFA par mois");
  });
  it("aucun contenu non vérifiable : pas de témoignage ni de chiffre de clientèle", () => {
    expect(text).not.toMatch(/témoignage|clients satisfaits|\d+\s*(commerçants|clients actifs)/i);
  });
  it("contact WhatsApp fourni par le propriétaire", () => { expect(html).toContain("https://wa.me/2250544165418"); });
  it("le contenu reste visible sans JavaScript et en mouvement réduit", () => {
    expect(html).toContain("<noscript>"); expect(html).toContain("prefers-reduced-motion");
  });
});
