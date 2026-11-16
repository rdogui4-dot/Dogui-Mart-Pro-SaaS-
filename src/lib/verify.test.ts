import { describe, expect, it } from "vitest";
import { hasRealEmail, shouldAskVerification } from "./verify";

describe("vérification d'e-mail non bloquante", () => {
  it("un identifiant d'employé n'a pas d'e-mail réel", () => { expect(hasRealEmail("caissier@staff.invalid")).toBe(false); expect(hasRealEmail("")).toBe(false); expect(hasRealEmail(undefined)).toBe(false); });
  it("on ne demande que pour une vraie adresse non confirmée", () => {
    expect(shouldAskVerification("a@b.sn", false)).toBe(true);
    expect(shouldAskVerification("a@b.sn", true)).toBe(false);
    expect(shouldAskVerification("a@b.sn", undefined)).toBe(false); // état inconnu (session en cache) : on n'affirme rien
    expect(shouldAskVerification("x@staff.invalid", false)).toBe(false);
  });
});
