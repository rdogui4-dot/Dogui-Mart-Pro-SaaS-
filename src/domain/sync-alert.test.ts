import { describe, expect, it } from "vitest";
import { sinceText, syncAlert, type HostStatus } from "./sync-alert";

const NOW = Date.parse("2026-06-10T12:00:00Z"); const h = (n: number) => new Date(NOW - n * 36e5).toISOString();
const base: HostStatus = { hosted: true, stationName: "Caisse", attachedAt: h(100), lastSyncOkAt: h(1), pending: 0, conflicts: 0, sessionOk: true, alertHours: 24, failures: 0 };
describe("alerte de synchronisation", () => {
  it("aucune alerte : poste non rattaché, ou tout va bien", () => { expect(syncAlert(null, NOW).level).toBe("none"); expect(syncAlert({ ...base, hosted: false }, NOW).level).toBe("none"); expect(syncAlert(base, NOW).level).toBe("none"); });
  it("session cloud perdue : alerte rouge, quelle que soit la dernière synchronisation", () => expect(syncAlert({ ...base, sessionOk: false }, NOW)).toMatchObject({ level: "bad", title: expect.stringContaining("plus connecté") }));
  it("seuil réglable : 24 h par défaut, 6 h si le propriétaire le demande ; compte les éléments en attente et la dernière erreur", () => {
    expect(syncAlert({ ...base, lastSyncOkAt: h(30) }, NOW).level).toBe("bad"); expect(syncAlert({ ...base, lastSyncOkAt: h(23) }, NOW).level).toBe("none");
    expect(syncAlert({ ...base, lastSyncOkAt: h(7), alertHours: 6 }, NOW).level).toBe("bad"); const a = syncAlert({ ...base, lastSyncOkAt: h(30), pending: 4, lastError: "Cloud injoignable" }, NOW); expect(a.detail).toContain("4 éléments"); expect(a.detail).toContain("Cloud injoignable");
  });
  it("jamais synchronisé : on part de la date de rattachement ; échecs répétés : avertissement orange", () => {
    expect(syncAlert({ ...base, lastSyncOkAt: undefined, attachedAt: h(30) }, NOW).level).toBe("bad"); expect(syncAlert({ ...base, lastSyncOkAt: undefined, attachedAt: h(2) }, NOW).level).toBe("none");
    expect(syncAlert({ ...base, failures: 3, lastError: "Cloud injoignable" }, NOW)).toMatchObject({ level: "warn" });
  });
  it("durées lisibles", () => { expect(sinceText(undefined, NOW)).toBe("jamais"); expect(sinceText(h(0), NOW)).toBe("à l'instant"); expect(sinceText(h(0.5), NOW)).toBe("il y a 30 min"); expect(sinceText(h(5), NOW)).toBe("il y a 5 h"); expect(sinceText(h(72), NOW)).toBe("il y a 3 jours"); });
});
