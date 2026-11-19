import { describe, expect, it } from "vitest";
import { MATRIX_LABEL, RESERVED, moduleMatrix, teamInsights, type Member } from "./team-kit";

describe("matrice des droits", () => {
  it("tirée des préréglages : propriétaire partout, consultant en lecture seule sur ses modules", () => {
    const m = moduleMatrix(); const pos = m.find((r) => r.id === "pos")!; const acc = m.find((r) => r.id === "accounting")!;
    expect(pos.cells).toMatchObject({ owner: "full", manager: "full", cashier: "full", stockkeeper: "none", viewer: "none" });
    expect(acc.cells).toMatchObject({ accountant: "full", viewer: "read", cashier: "none" });
    expect(MATRIX_LABEL.viewer).toBe("Consultant");
    expect(RESERVED.find((r) => r.id === "team")!.cells).toMatchObject({ owner: "full", manager: "none" });
    expect(RESERVED.find((r) => r.id === "manage")!.cells).toMatchObject({ owner: "full", manager: "full", cashier: "none" });
  });
});
describe("constats Équipe", () => {
  const now = new Date("2026-11-18T10:00:00Z").getTime();
  const mem = (o: Partial<Member>): Member => ({ userId: "u", name: "A", login: "a", role: "cashier", active: true, modules: ["pos", "customers"], shopIds: ["s1"], lastLogin: new Date(now).toISOString(), sessions24h: 1, mfa: false, createdAt: "2026-01-01T00:00:00Z", ...o });
  it("rien à signaler", () => expect(teamInsights([mem({ mfa: true })], 1, { now, mfaKnown: true, pendingInvites: 0, expiredInvites: 0 })[0]!.id).toBe("ok"));
  it("compte dormant, accès élargis, 2FA seulement si connue, invitations expirées", () => {
    const i = teamInsights([mem({ name: "Dormant", lastLogin: "2026-10-01T00:00:00Z" }), mem({ name: "Large", modules: ["pos", "customers", "accounting"] }), mem({ name: "Jamais", lastLogin: null, createdAt: "2026-11-15T00:00:00Z" })], 1, { now, mfaKnown: false, pendingInvites: 0, expiredInvites: 2 });
    expect(i.map((x) => x.id)).toEqual(["dormant", "custom", "expired"]); expect(i[0]!.text).toContain("Dormant"); expect(i[0]!.text).not.toContain("Jamais");
  });
});
