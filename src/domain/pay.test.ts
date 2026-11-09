import { describe, expect, it } from "vitest";
import { evaluatePay, type PayLine } from "./pay";

const L = (method: PayLine["method"], amount: string, reference = "", id = Math.random().toString()): PayLine => ({ id, method, amount, reference });
describe("encaissement", () => {
  it("espèces : monnaie à rendre ; insuffisant refusé ; montants invalides refusés", () => {
    expect(evaluatePay(1500, [L("cash", "2000")], { hasCustomer: false })).toMatchObject({ ok: true, change: 500, remaining: 0, paid: 2000 });
    const short = evaluatePay(1500, [L("cash", "1 000")], { hasCustomer: false }); expect(short.ok).toBe(false); expect(short.remaining).toBe(500); expect(short.errors[0]).toContain("Reste à payer");
    for (const bad of ["", "0", "-5", "12,5", "abc"]) expect(evaluatePay(100, [L("cash", bad)], { hasCustomer: false }).ok, bad).toBe(false); expect(evaluatePay(100, [], { hasCustomer: false }).ok).toBe(false);
  });
  it("paiement mixte exact ; Mobile Money exige une référence ou un lien ; carte sans référence acceptée ; monnaie seulement sur espèces", () => {
    const mixed = evaluatePay(3000, [L("cash", "1000"), L("wave", "1500", "WV-1234"), L("card", "500")], { hasCustomer: false }); expect(mixed).toMatchObject({ ok: true, change: 0, paid: 3000 }); expect(mixed.payments[1]).toEqual({ method: "wave", amount: 1500, reference: "WV-1234" });
    expect(evaluatePay(1000, [L("orange", "1000")], { hasCustomer: false }).errors[0]).toContain("référence"); expect(evaluatePay(1000, [L("orange", "1000", "ab")], { hasCustomer: false }).ok).toBe(false); expect(evaluatePay(1000, [{ ...L("wave", "1000"), linkId: "lnk1" }], { hasCustomer: false }).ok).toBe(true);
    expect(evaluatePay(1000, [L("card", "1500")], { hasCustomer: false }).errors.join()).toContain("monnaie"); expect(evaluatePay(1000, [L("cash", "200"), L("wave", "1000", "WV-9999")], { hasCustomer: false })).toMatchObject({ ok: true, change: 200 }); expect(evaluatePay(1000, [L("cash", "100"), L("wave", "1100", "WV-9999")], { hasCustomer: false }).ok).toBe(false);
  });
  it("crédit : client obligatoire, plafond respecté, jamais au-delà du total", () => {
    expect(evaluatePay(1000, [L("credit", "1000")], { hasCustomer: false }).errors.join()).toContain("client"); const c = { balance: 9000, limit: 10000 }; expect(evaluatePay(1000, [L("credit", "1000")], { hasCustomer: true, credit: c }).ok).toBe(true); expect(evaluatePay(2000, [L("credit", "2000")], { hasCustomer: true, credit: c }).ok).toBe(false);
    expect(evaluatePay(500, [L("credit", "1000")], { hasCustomer: true, credit: { balance: 0, limit: 5000 } }).ok).toBe(false);
  });
});
