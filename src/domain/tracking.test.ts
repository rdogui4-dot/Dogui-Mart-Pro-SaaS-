import { describe, expect, it } from "vitest";
import { SERIAL_TRANSITIONS, allocateFefo, expiryState, normalizeDate, normalizeLotNo, normalizeSerial, parseSerials, stockEffect, warrantyEnd } from "./tracking";

const today = "2026-11-10";
describe("péremption", () => {
  it("valable jusqu'à la fin du jour de péremption, périmé le lendemain, alerte à 30 jours", () => {
    expect(expiryState(undefined, today)).toBe("none"); expect(expiryState("2026-11-10T00:00:00.000Z", today)).toBe("soon"); expect(expiryState("2026-11-09", today)).toBe("expired");
    expect(expiryState("2026-12-10", today)).toBe("soon"); expect(expiryState("2026-12-11", today)).toBe("ok"); expect(expiryState("2026-12-11", today, 40)).toBe("soon");
  });
});
describe("FEFO", () => {
  const lot = (id: string, qty: number, expiresAt?: string, receivedAt = "2026-01-01", status?: string) => ({ id, qty, expiresAt, receivedAt, status });
  it("le lot qui expire le premier sort le premier ; les lots sans date en dernier", () => {
    const r = allocateFefo([lot("sans", 10), lot("tard", 10, "2027-03-01"), lot("tot", 10, "2026-12-01")], 15, today);
    expect(r.allocations).toEqual([{ lotId: "tot", qty: 10 }, { lotId: "tard", qty: 5 }]); expect(r.shortage).toBe(0);
    expect(allocateFefo([lot("sans", 10), lot("tard", 10, "2027-03-01")], 12, today).allocations).toEqual([{ lotId: "tard", qty: 10 }, { lotId: "sans", qty: 2 }]);
  });
  it("à date égale : réception la plus ancienne, puis identifiant", () => {
    expect(allocateFefo([lot("b", 5, "2026-12-01", "2026-02-01"), lot("a", 5, "2026-12-01", "2026-03-01")], 3, today).allocations[0]!.lotId).toBe("b");
    expect(allocateFefo([lot("b", 5, "2026-12-01"), lot("a", 5, "2026-12-01")], 3, today).allocations[0]!.lotId).toBe("a");
  });
  it("lots périmés exclus si la politique l'interdit (et comptés), autorisés sinon ; lots bloqués jamais", () => {
    const lots = [lot("perime", 10, "2026-11-01"), lot("bon", 4, "2027-01-01"), lot("bloque", 50, "2027-02-01", "2026-01-01", "blocked")];
    const r = allocateFefo(lots, 8, today); expect(r).toMatchObject({ allocations: [{ lotId: "bon", qty: 4 }], shortage: 4, expiredQty: 10, blockedQty: 50 });
    const a = allocateFefo(lots, 8, today, "allow"); expect(a.allocations).toEqual([{ lotId: "perime", qty: 8 }]); expect(a.shortage).toBe(0); expect(a.blockedQty).toBe(50);
  });
  it("quantité exacte, lots vides ignorés, rupture signalée", () => {
    expect(allocateFefo([lot("a", 0, "2026-12-01"), lot("b", 3, "2026-12-02")], 3, today)).toMatchObject({ allocations: [{ lotId: "b", qty: 3 }], shortage: 0 });
    expect(allocateFefo([lot("a", 2, "2026-12-01")], 5, today)).toMatchObject({ allocations: [{ lotId: "a", qty: 2 }], shortage: 3 }); expect(allocateFefo([], 1, today).shortage).toBe(1);
  });
});
describe("saisies", () => {
  it("numéro de lot normalisé et contrôlé", () => { expect(normalizeLotNo(" l-2026 / 07 ")).toBe("L-2026 / 07"); for (const bad of ["", "   ", "x".repeat(41), "L<1>"]) expect(() => normalizeLotNo(bad)).toThrow(); });
  it("dates réelles seulement", () => { expect(normalizeDate("2026-12-31", "D")).toBe("2026-12-31T00:00:00.000Z"); for (const bad of ["2026-02-30", "12/31/2026", "", "abc", "2026-13-01"]) expect(() => normalizeDate(bad, "Date")).toThrow("invalide"); });
  it("numéros de série : normalisés, en vrac, sans doublon", () => {
    expect(normalizeSerial(" sn 123-ab ")).toBe("SN123-AB"); expect(parseSerials("sn1001\nsn1002, sn1003 ; sn1004")).toEqual(["SN1001", "SN1002", "SN1003", "SN1004"]);
    expect(() => parseSerials("SN1001 sn1001")).toThrow("double"); expect(() => normalizeSerial("ab")).toThrow("court"); expect(() => normalizeSerial("A".repeat(65))).toThrow("64"); expect(() => normalizeSerial("SN<1>")).toThrow("lettres"); expect(parseSerials("")).toEqual([]);
  });
  it("fin de garantie en mois calendaires, borné en fin de mois", () => {
    expect(warrantyEnd("2026-11-10T08:00:00.000Z", 12)).toBe("2027-11-10T08:00:00.000Z"); expect(warrantyEnd("2026-01-31T00:00:00.000Z", 1)).toBe("2026-02-28T00:00:00.000Z"); expect(warrantyEnd("2027-12-15T00:00:00.000Z", 3)).toBe("2028-03-15T00:00:00.000Z");
  });
  it("transitions de statut et effet sur le stock", () => {
    expect(SERIAL_TRANSITIONS.available).toEqual(["defective"]); expect(SERIAL_TRANSITIONS.defective).toEqual([]); expect(SERIAL_TRANSITIONS.sold).toContain("returned");
    expect(stockEffect("returned", "available")).toBe(1); expect(stockEffect("available", "defective")).toBe(-1); expect(stockEffect("sold", "returned")).toBe(0); expect(stockEffect("returned", "defective")).toBe(0);
  });
});
