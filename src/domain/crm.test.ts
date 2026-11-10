import { describe, expect, it } from "vitest";
import { DAY, canMove, contactKeys, dayOf, isOverdue, normConsents, normEmail, normPhone, normProb, normTags, segmentOf, weighted } from "./crm";

describe("pipeline", () => {
  it("déplacement libre entre étapes ouvertes ; clôturé = gérant seulement", () => {
    expect(canMove("new", "qualified", false).ok).toBe(true); expect(canMove("negotiation", "contacted", false).ok).toBe(true); expect(canMove("new", "new", false).ok).toBe(false);
    expect(canMove("lost", "new", false).ok).toBe(false); expect(canMove("lost", "new", true).ok).toBe(true); expect(canMove("won", "lost", true).ok).toBe(false);
  });
  it("valeur pondérée bornée", () => { expect(weighted(100000, 60)).toBe(60000); expect(weighted(-5, 50)).toBe(0); expect(weighted(1000, 250)).toBe(1000); });
  it("relance en retard seulement si ouverte et échue", () => { const now = Date.now(); expect(isOverdue(now - 1, "open", now)).toBe(true); expect(isOverdue(now - 1, "done", now)).toBe(false); expect(isOverdue(now + 1000, "open", now)).toBe(false); });
});
describe("segments déduits des ventes", () => {
  const now = Date.now(); const ago = (d: number) => now - d * DAY;
  it("sans achat, nouveau, actif, fidèle, inactif, dormant", () => {
    expect(segmentOf({ salesCount: 0, firstSaleAt: null, lastSaleAt: null, now })).toBe("never"); expect(segmentOf({ salesCount: 1, firstSaleAt: ago(5), lastSaleAt: ago(5), now })).toBe("new");
    expect(segmentOf({ salesCount: 2, firstSaleAt: ago(100), lastSaleAt: ago(10), now })).toBe("active"); expect(segmentOf({ salesCount: 6, firstSaleAt: ago(200), lastSaleAt: ago(10), now })).toBe("loyal");
    expect(segmentOf({ salesCount: 6, firstSaleAt: ago(300), lastSaleAt: ago(70), now })).toBe("inactive"); expect(segmentOf({ salesCount: 2, firstSaleAt: ago(400), lastSaleAt: ago(200), now })).toBe("dormant");
    expect(segmentOf({ salesCount: 2, firstSaleAt: ago(400), lastSaleAt: ago(40), now, inactiveDays: 30 })).toBe("inactive");
  });
});
describe("validation", () => {
  it("téléphone, e-mail, jour, probabilité, étiquettes, consentements", () => {
    expect(normPhone("+221 77 000 11 22")).toBe("+221770001122"); expect(normPhone("77 000 11 22")).toBe("770001122"); expect(normPhone("abc")).toBeNull(); expect(normPhone("123")).toBeNull(); expect(normPhone("")).toBe("");
    expect(normEmail(" A@B.sn ")).toBe("a@b.sn"); expect(normEmail("a@b")).toBeNull(); expect(normEmail("")).toBe("");
    expect(dayOf("2026-02-30")).toBeNull(); expect(dayOf("2026-02-27")).toBe("2026-02-27"); expect(normProb("150", 10)).toBeNull(); expect(normProb(undefined, 10)).toBe(10); expect(normProb("0", 10)).toBe(0);
    expect(normTags("VIP, vip , gros")).toEqual(["vip", "gros"]); expect(normConsents({ sms: true, email: "oui" })).toEqual({ sms: true, email: false, whatsapp: false, call: false });
    expect(contactKeys("+221770001122", "a@b.sn")).toEqual(["p:770001122", "e:a@b.sn"]);
  });
});
