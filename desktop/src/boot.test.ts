import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig, startMainServer } from "./boot";

const dirs: string[] = []; const tmp = () => { const d = mkdtempSync(join(tmpdir(), "dmp-desk-")); dirs.push(d); return d; }; afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
describe("configuration enregistrée", () => {
  it("relue après enregistrement ; fichier absent ou abîmé : défauts", () => {
    const d = tmp(); expect(loadConfig(d)).toEqual({ port: 8443, autostart: true }); saveConfig(d, { mode: "main", port: 9000, autostart: false }); expect(loadConfig(d)).toEqual({ mode: "main", port: 9000, autostart: false }); expect(readdirSync(d)).toEqual(["poste.json"]);
    writeFileSync(join(d, "poste.json"), "{pas du json"); expect(loadConfig(d)).toEqual({ port: 8443, autostart: true });
  });
});
describe("poste principal", () => {
  it("démarre en HTTPS sur le port demandé, sert l'application et fait la sauvegarde du jour au démarrage", async () => {
    const d = tmp(); const web = tmp(); writeFileSync(join(web, "index.html"), "<html><head></head><body>ok</body></html>");
    const h = await startMainServer({ dataDir: d, webRoot: web, port: 0, host: "127.0.0.1", mdns: false, cloud: null, autoSyncMs: 0 });
    try {
      expect(h.https).toBe(true); expect(h.origin).toMatch(/^https:\/\/127\.0\.0\.1:\d+$/); expect(existsSync(join(d, "tls"))).toBe(true); expect(readdirSync(join(d, "sauvegardes")).some((n) => /^auto-\d{4}-\d{2}-\d{2}\.sqlite$/.test(n))).toBe(true);
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; const page = await (await fetch(`${h.origin}/`)).text(); expect(page).toContain('name="dmp-local"'); expect((await (await fetch(`${h.origin}/v1/setup`)).json()).needsSetup).toBe(true);
      expect((await (await fetch(`${h.origin}/v1/connect`)).json()).certificate.fingerprint).toBe(h.certificate!.fingerprint);
    } finally { await h.close(); delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; }
  });
});
