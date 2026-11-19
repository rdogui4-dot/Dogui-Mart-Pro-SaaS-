import { describe, expect, it } from "vitest";
import { COUNTRIES, companyErrors, countryOf, decodeDays, encodeDays, hoursError, passwordStrength, phoneOk, shopErrors } from "./signup";

describe("mot de passe", () => {
  it("solidité indicative", () => {
    expect(passwordStrength("abc").label).toBe("Trop court");
    expect(passwordStrength("abcdefgh")).toMatchObject({ level: 1, label: "Faible", ok: true });
    expect(passwordStrength("Abcdefg1")).toMatchObject({ level: 2, label: "Moyenne" });
    expect(passwordStrength("Abcdefg1!xyz")).toMatchObject({ level: 3, label: "Forte" });
  });
});
describe("pays et fuseaux", () => {
  it("chaque pays de la zone XOF a un fuseau horaire valide", () => {
    for (const c of COUNTRIES) expect(() => new Intl.DateTimeFormat("fr-FR", { timeZone: c.tz })).not.toThrow();
    expect(countryOf("CI")!.tz).toBe("Africa/Abidjan"); expect(countryOf("XX")).toBeUndefined();
  });
});
describe("étape Entreprise : type de compte, forme juridique et RCCM", () => {
  const ok = { companyName: "Dogui Distribution", sector: "Commerce / Distribution", country: "CI", city: "Abidjan", address: "Cocody", phone: "+225 07 00 00 00 00" };
  it("particulier / commerçant : valide sans forme juridique ni RCCM", () => { expect(companyErrors(ok)).toEqual({}); expect(companyErrors({ ...ok, profileType: "individual" })).toEqual({}); });
  it("entreprise : forme juridique et RCCM obligatoires", () => {
    expect(Object.keys(companyErrors({ ...ok, profileType: "company" })).sort()).toEqual(["legal", "legalForm"]);
    expect(companyErrors({ ...ok, profileType: "company", legalForm: "SARL", legal: "CI-ABJ-2024-B-1" })).toEqual({});
    expect(companyErrors({ ...ok, profileType: "company", legalForm: "Truc", legal: "CI-ABJ" }).legalForm).toBeDefined();
  });
  it("exige nom, secteur, pays, ville, adresse, téléphone", () => {
    expect(Object.keys(companyErrors({ ...ok, companyName: "", sector: "", country: "", city: "", address: "", phone: "12" })).sort()).toEqual(["address", "city", "companyName", "country", "phone", "sector"]);
  });
  it("refuse une forme inconnue et une description trop longue seulement si elles sont saisies", () => {
    expect(companyErrors({ ...ok, profileType: "company", legalForm: "Truc", legal: "CI-ABJ-1" }).legalForm).toBeDefined(); expect(companyErrors({ ...ok, description: "x".repeat(201) }).description).toBeDefined();
    expect(companyErrors({ ...ok, legalForm: "SARL", legal: "CI-ABJ-2024-B-1" })).toEqual({});
  });
});
describe("étape Boutique", () => {
  const ok = { name: "Dogui Mart Abidjan", type: "Commerce de détail", address: "Cocody", city: "Abidjan", phone: "0700000000", days: decodeDays("1111110"), from: "08:00", to: "20:00" };
  it("valide, puis signale chaque champ", () => {
    expect(shopErrors(ok)).toEqual({});
    expect(Object.keys(shopErrors({ ...ok, name: "", type: "", address: "", city: "", phone: "", days: decodeDays("0000000") })).sort()).toEqual(["address", "city", "hours", "name", "phone", "type"]);
  });
  it("horaires : fermeture après ouverture ; jours codés", () => {
    expect(hoursError(ok.days, "20:00", "08:00")).toMatch(/fermeture/); expect(hoursError(ok.days, "8h", "20:00")).toMatch(/invalides/);
    expect(encodeDays(decodeDays("1111110"))).toBe("1111110"); expect(decodeDays("abc")).toEqual([true, true, true, true, true, true, false]);
    expect(phoneOk("+225 07 00 00 00 00")).toBe(true); expect(phoneOk("123")).toBe(false);
  });
});

import { shopProfilePatch } from "./signup";
describe("profil de boutique accepté par le serveur", () => {
  it("valide champ par champ ; un pays fixe le fuseau ; forme juridique et description effaçables", () => {
    expect(shopProfilePatch({ country: "CI", sector: "Services", shopType: "Commerce de détail", legalForm: "", description: " Vente de riz ", openDays: "1111110", openFrom: "08:00", openTo: "20:00" }).patch)
      .toEqual({ country: "CI", promoTz: "Africa/Abidjan", sector: "Services", shopType: "Commerce de détail", legalForm: "", description: "Vente de riz", openDays: "1111110", openFrom: "08:00", openTo: "20:00" });
    expect(shopProfilePatch({ country: "SN", promoTz: "Africa/Abidjan" }).patch.promoTz).toBeUndefined(); // le fuseau fourni par l'appelant est conservé
    expect(shopProfilePatch({}).patch).toEqual({});
  });
  it("type de compte : entreprise exige forme juridique et RCCM ; particulier efface la forme juridique", () => {
    expect(shopProfilePatch({ profileType: "company", legalForm: "SARL", legal: "CI-ABJ-2024-B-1" }).patch).toEqual({ profileType: "company", legalForm: "SARL" });
    for (const b of [{ profileType: "company" }, { profileType: "company", legalForm: "SARL" }, { profileType: "company", legalForm: "SARL", legal: " " }, { profileType: "autre" }]) expect(shopProfilePatch(b).error, JSON.stringify(b)).toBeDefined();
    expect(shopProfilePatch({ profileType: "individual", legalForm: "SARL" }).patch).toEqual({ profileType: "individual", legalForm: "" });
  });
  it("refuse les valeurs inconnues ou incohérentes", () => {
    for (const b of [{ country: "FR" }, { sector: "x" }, { shopType: "x" }, { legalForm: "Truc" }, { openDays: "11" }, { openFrom: "20:00", openTo: "08:00" }, { openFrom: "08:00" }, { description: "x".repeat(201) }]) expect(shopProfilePatch(b).error, JSON.stringify(b)).toBeDefined();
  });
});
