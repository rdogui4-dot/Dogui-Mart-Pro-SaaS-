import { describe, expect, it } from "vitest";
import { checklist, modulesFor } from "./settings-kit";
describe("Paramètres généraux — modules et paramétrage", () => {
  it("modules ouverts selon la formule", () => {
    expect(modulesFor("starter")).toMatchObject({ active: 2, total: 10 }); expect(modulesFor("business").active).toBe(9); expect(modulesFor("pro").active).toBe(10);
    expect(modulesFor("business").list.find((m) => m.key === "reports")!.active).toBe(false);
  });
  it("liste de vérification : points faits, point FinI ignoré hors formule", () => {
    const base = { name: "Mon commerce", vatSet: true, finAccounts: null, qrLinks: 0, staff: 0 };
    const a = checklist(base); expect(a.items.some((i) => i.id === "fin")).toBe(false); expect(a.items.find((i) => i.id === "name")!.done).toBe(false); expect(a.done).toBe(1);
    const b = checklist({ ...base, name: "Boutique Abidjan", phone: "0700", legal: "CI-ABJ", companyName: "Dogui SARL", taxRegime: "Réel simplifié", address: "Rue 12", promoTz: "Africa/Abidjan", logoFileId: "f1", finAccounts: 2, qrLinks: 1, staff: 3 });
    expect(b).toMatchObject({ done: 12, total: 12 });
  });
});
