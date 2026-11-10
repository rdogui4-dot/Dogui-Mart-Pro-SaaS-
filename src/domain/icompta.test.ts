import { describe, expect, it } from "vitest";
import { DEFAULT_ACCOUNTS, balanceOf, canValidate, checkLines, entryNumber, isCode, periodOf, periodsOfYear, swap, validDay } from "./icompta";

const act = new Set(DEFAULT_ACCOUNTS.map((a) => a.code));
describe("ICompta — domaine", () => {
  it("écriture équilibrée acceptée, déséquilibre/zéro/compte inconnu/ligne mixte refusés", () => {
    expect(checkLines([{ account: "571", debit: 1000, credit: 0 }, { account: "701", debit: 0, credit: 1000 }], act)).toMatchObject({ ok: true, total: 1000 });
    expect(checkLines([{ account: "571", debit: 1000, credit: 0 }, { account: "701", debit: 0, credit: 900 }], act).errors[0]).toContain("déséquilibrée");
    expect(checkLines([{ account: "571", debit: 0, credit: 0 }, { account: "701", debit: 0, credit: 0 }], act).ok).toBe(false);
    expect(checkLines([{ account: "999", debit: 5, credit: 0 }, { account: "701", debit: 0, credit: 5 }], act).errors[0]).toContain("n'existe pas");
    expect(checkLines([{ account: "571", debit: 5, credit: 5 }, { account: "701", debit: 0, credit: 0 }], act).ok).toBe(false);
    expect(checkLines([{ account: "571", debit: 1.5, credit: 0 }, { account: "701", debit: 0, credit: 1.5 }], act).ok).toBe(false); expect(checkLines([{ account: "571", debit: 5, credit: 0 }], act).ok).toBe(false); expect(checkLines("x", act).ok).toBe(false);
  });
  it("contrepassation = lignes inversées, toujours équilibrée", () => { const l = [{ account: "571", debit: 700, credit: 0 }, { account: "701", debit: 0, credit: 700 }]; const r = swap(l); expect(r[0]).toMatchObject({ debit: 0, credit: 700 }); expect(checkLines(r, act).ok).toBe(true); });
  it("séparation des rôles : le créateur ne valide pas, sauf propriétaire (signalé)", () => {
    expect(canValidate("manager", "u1", "u2")).toMatchObject({ ok: true, self: false }); expect(canValidate("manager", "u1", "u1").ok).toBe(false); expect(canValidate("owner", "u1", "u1")).toMatchObject({ ok: true, self: true }); expect(canValidate("other", "u1", "u2").ok).toBe(false);
  });
  it("périodes, comptes, numéros, balance", () => {
    expect(validDay("2026-02-30")).toBeNull(); expect(periodOf("2026-03-14")).toBe("2026-03"); expect(periodsOfYear(2026)).toHaveLength(12); expect(isCode("571")).toBe(true); expect(isCode("0571")).toBe(false); expect(isCode("5")).toBe(false); expect(entryNumber(12)).toBe("ICE-000012");
    const b = balanceOf([{ account: "701", debit: 0, credit: 100 }, { account: "571", debit: 100, credit: 0 }, { account: "571", debit: 0, credit: 30 }, { account: "701", debit: 30, credit: 0 }]); expect(b.map((x) => x.account)).toEqual(["571", "701"]); expect(b[0]).toMatchObject({ solde: 70 }); expect(b.reduce((s, x) => s + x.solde, 0)).toBe(0);
  });
});
