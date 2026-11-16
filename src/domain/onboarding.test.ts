import { describe, expect, it } from "vitest";
import { startProgress, startSteps } from "./onboarding";

const none = { shopDetails: false, articles: 0, cashSessions: 0, sales: 0, collaborators: 0, cashSessionAvailable: true };
describe("guide de démarrage", () => {
  it("commerce vide : cinq étapes, aucune faite", () => {
    const s = startSteps(none); expect(s.map((x) => x.id)).toEqual(["shop", "article", "cash", "sale", "team"]);
    expect(startProgress(s)).toEqual({ done: 0, total: 5, complete: false });
  });
  it("l'état vient uniquement des données", () => {
    const s = startSteps({ ...none, articles: 3, sales: 1 }); expect(s.filter((x) => x.done).map((x) => x.id)).toEqual(["article", "sale"]);
  });
  it("formule sans sessions de caisse : l'étape caisse n'est pas proposée", () => {
    expect(startSteps({ ...none, cashSessionAvailable: false }).some((x) => x.id === "cash")).toBe(false);
  });
  it("tout fait = complet", () => {
    expect(startProgress(startSteps({ shopDetails: true, articles: 1, cashSessions: 1, sales: 1, collaborators: 1, cashSessionAvailable: true })).complete).toBe(true);
  });
});
