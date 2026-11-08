import { describe, expect, it } from "vitest";
import { MODULES, ROLE_PRESETS, STAFF_ROLES, isCustomAccess, modulesFor, parseModules, sameModules } from "./access";

describe("accès par module", () => {
  it("7 modules, 4 rôles, et chaque préréglage n'utilise que des modules connus", () => {
    expect(MODULES).toHaveLength(7); expect(STAFF_ROLES).toEqual(["manager", "cashier", "stockkeeper", "accountant"]);
    for (const r of STAFF_ROLES) for (const m of ROLE_PRESETS[r].modules) expect(MODULES).toContain(m);
  });
  it("le gérant a tout ; caissier, magasinier et comptable ont chacun leur périmètre", () => {
    expect(modulesFor("manager")).toEqual([...MODULES]);
    expect(modulesFor("cashier")).toEqual(["pos", "customers"]);
    expect(modulesFor("stockkeeper")).toEqual(["stock", "purchases"]);
    expect(modulesFor("accountant")).toEqual(["invoices", "accounting", "reports"]);
  });
  it("le caissier n'a aucun accès sensible : ni stock, ni achats, ni factures, ni compta, ni rapports", () => {
    for (const m of ["stock", "purchases", "invoices", "accounting", "reports"] as const) expect(modulesFor("cashier")).not.toContain(m);
  });
  it("une liste explicite valide l'emporte (ordre canonique, doublons retirés) ; invalide ou vide : retour au préréglage", () => {
    expect(modulesFor("cashier", ["stock", "pos", "stock"])).toEqual(["pos", "stock"]);
    expect(modulesFor("cashier", JSON.stringify(["reports"]))).toEqual(["reports"]);
    expect(modulesFor("accountant", [])).toEqual(modulesFor("accountant"));
    expect(modulesFor("accountant", ["admin", "root"])).toEqual(modulesFor("accountant"));
    expect(modulesFor("accountant", "{pas du json")).toEqual(modulesFor("accountant"));
  });
  it("un rôle inconnu est traité comme le plus restreint (caissier), jamais comme un gérant", () => {
    expect(modulesFor("owner")).toEqual(["pos", "customers"]); expect(modulesFor(undefined)).toEqual(["pos", "customers"]); expect(modulesFor("superadmin")).toEqual(["pos", "customers"]);
  });
  it("validation de la saisie du propriétaire", () => {
    expect(parseModules(["stock", "pos"])).toEqual({ ok: true, modules: ["pos", "stock"] });
    expect(parseModules([]).ok).toBe(false); expect(parseModules("stock").ok).toBe(false); expect(parseModules(["stock", "root"])).toMatchObject({ ok: false, error: "Accès inconnu : root" });
  });
  it("accès personnalisés détectés par rapport au préréglage", () => {
    expect(isCustomAccess("cashier", ["pos", "customers"])).toBe(false); expect(isCustomAccess("cashier", ["customers", "pos"].sort() as never)).toBe(false);
    expect(isCustomAccess("cashier", ["pos", "customers", "stock"])).toBe(true);
    expect(sameModules(["pos"], ["pos"])).toBe(true); expect(sameModules(["pos"], ["stock"])).toBe(false);
  });
});
