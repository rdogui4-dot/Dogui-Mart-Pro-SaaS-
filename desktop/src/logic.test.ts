import { describe, expect, it } from "vitest";
import { backupName, backupsToDelete, DEFAULT_PORT, isAllowedNavigation, isSafeExternal, normalizeAddress, parseConfig, samePin } from "./logic";

const FP = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0").toUpperCase()).join(":");
describe("configuration du poste", () => {
  it("valeurs par défaut, fichier abîmé ignoré", () => { expect(parseConfig(undefined)).toEqual({ port: DEFAULT_PORT, autostart: true }); expect(parseConfig("x")).toEqual({ port: DEFAULT_PORT, autostart: true }); expect(parseConfig({ port: 80, mode: "autre", autostart: "oui" })).toEqual({ port: DEFAULT_PORT, autostart: true }); });
  it("poste principal valide ; port personnalisé", () => expect(parseConfig({ mode: "main", port: 9443, autostart: false })).toEqual({ mode: "main", port: 9443, autostart: false }));
  it("poste secondaire : adresse ET empreinte obligatoires, sinon on redemande le mode", () => {
    expect(parseConfig({ mode: "secondary", mainOrigin: "https://192.168.1.20:8443" }).mode).toBeUndefined(); expect(parseConfig({ mode: "secondary", pinnedFingerprint: FP }).mode).toBeUndefined();
    expect(parseConfig({ mode: "secondary", mainOrigin: "192.168.1.20", pinnedFingerprint: FP.toLowerCase() })).toMatchObject({ mode: "secondary", mainOrigin: "https://192.168.1.20:8443", pinnedFingerprint: FP });
    expect(parseConfig({ mode: "secondary", mainOrigin: "https://evil.com", pinnedFingerprint: FP }).mode).toBeUndefined();
  });
});
describe("adresse du poste principal", () => {
  it("accepte les adresses du réseau local sous toutes leurs formes", () => {
    for (const [i, o] of [["192.168.1.20", "https://192.168.1.20:8443"], ["192.168.1.20:9000", "https://192.168.1.20:9000"], ["https://dogui.local:8443", "https://dogui.local:8443"], ["DOGUI.LOCAL", "https://dogui.local:8443"], ["10.0.0.5", "https://10.0.0.5:8443"], ["172.20.1.9", "https://172.20.1.9:8443"], ["caisse1", "https://caisse1:8443"], ["https://192.168.0.2/", "https://192.168.0.2:8443"]] as const) expect(normalizeAddress(i)).toMatchObject({ ok: true, origin: o });
  });
  it("refuse Internet, HTTP, chemins, identifiants, ports invalides, vide", () => {
    for (const bad of ["", "   ", "http://192.168.1.20", "https://example.com", "8.8.8.8", "172.32.0.1", "192.168.1.20/admin", "https://user:pw@192.168.1.20", "192.168.1.20:99999", "192.168.300.1", "https://192.168.1.20?x=1", "https://[2001:db8::1]"]) expect(normalizeAddress(bad).ok, bad).toBe(false);
  });
});
describe("empreinte de certificat (épinglage)", () => {
  it("compare sans tenir compte de la casse ; une empreinte absente ou malformée n'est jamais acceptée", () => { expect(samePin(FP, FP.toLowerCase())).toBe(true); expect(samePin(FP, undefined)).toBe(false); expect(samePin(undefined, undefined)).toBe(false); expect(samePin("AA:BB", "AA:BB")).toBe(false); expect(samePin(FP, FP.replace("00", "01"))).toBe(false); });
});
describe("navigation de la fenêtre", () => {
  it("seule l'origine du poste est autorisée dans la fenêtre ; liens externes en https/mailto/tel seulement", () => {
    expect(isAllowedNavigation("https://127.0.0.1:8443/caisse", "https://127.0.0.1:8443")).toBe(true); expect(isAllowedNavigation("https://127.0.0.1:9999/", "https://127.0.0.1:8443")).toBe(false); expect(isAllowedNavigation("https://evil.com/", "https://127.0.0.1:8443")).toBe(false); expect(isAllowedNavigation("file:///etc/passwd", "https://127.0.0.1:8443")).toBe(false); expect(isAllowedNavigation("nimporte", "https://127.0.0.1:8443")).toBe(false);
    expect(isSafeExternal("https://wa.me/221770000000")).toBe(true); expect(isSafeExternal("mailto:a@b.sn")).toBe(true); expect(isSafeExternal("javascript:alert(1)")).toBe(false); expect(isSafeExternal("file:///c:/windows")).toBe(false); expect(isSafeExternal("http://x.com")).toBe(false);
  });
});
describe("sauvegardes (règles partagées avec le serveur local)", () => {
  it("noms par date ; 7 gardées ; les autres fichiers ne sont jamais supprimés", () => {
    expect(backupName(new Date("2026-06-10T08:00:00Z"))).toBe("auto-2026-06-10.sqlite");
    const names = Array.from({ length: 10 }, (_, i) => `auto-2026-06-${String(i + 1).padStart(2, "0")}.sqlite`).concat(["avant-restauration-2026-05-01T10-00-00.sqlite", "notes.txt"]);
    expect(backupsToDelete(names)).toEqual(["auto-2026-06-01.sqlite", "auto-2026-06-02.sqlite", "auto-2026-06-03.sqlite"]); expect(backupsToDelete(names.slice(0, 5))).toEqual([]); expect(backupsToDelete([])).toEqual([]);
  });
});
