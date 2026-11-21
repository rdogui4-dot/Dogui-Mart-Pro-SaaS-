import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalServer } from "./main";

const dirs: string[] = []; const tmp = () => { const d = mkdtempSync(join(tmpdir(), "dmp-bkr-")); dirs.push(d); return d; }; afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const J = { "content-type": "application/json" };
async function boot() {
  const dir = tmp(); const s = await startLocalServer({ dataDir: dir, port: 0, host: "127.0.0.1", mdns: false, backupEveryMs: 3_600_000 }); const url = (p: string) => `http://127.0.0.1:${s.port}${p}`;
  const reg = await (await fetch(url("/v1/auth/register"), { method: "POST", headers: J, body: JSON.stringify({ email: "o@x.sn", password: "Abcdefg1!xyz", name: "Awa" }) })).json(); const uid = String(s.store.db.prepare("SELECT id FROM users WHERE email = 'o@x.sn'").get()!.id);
  s.store.createTeam("tenantbk000001", "Boutique Awa"); await s.store.addMember("tenantbk000001", uid, ["owner"], "Awa"); await s.store.create("products", "p1", "tenantbk000001", { tenantId: "tenantbk000001", shopId: "s1", name: "Riz" });
  const H = { ...J, authorization: `Bearer ${reg.token}` }; const post = (p: string, b: unknown, h = H) => fetch(url(p), { method: "POST", headers: h, body: JSON.stringify(b) }); const get = (p: string, h = H) => fetch(url(p), { headers: h });
  return { s, url, H, post, get, uid, token: reg.token as string, dir };
}
describe("routes /v1/backup", () => {
  it("état (copie du jour déjà faite et vérifiée), sauvegarde manuelle, vérification, réglages", async () => {
    const { s, post, get } = await boot();
    try {
      const st = await (await get("/v1/backup/status")).json(); expect(st).toMatchObject({ ok: true, hosted: false, canRestoreFile: true }); expect(st.backups.some((b: any) => b.kind === "auto" && b.verification.ok)).toBe(true); expect(st.alert.level).toBe("none");
      const now = await (await post("/v1/backup/now", {})).json(); expect(now.item).toMatchObject({ kind: "manuel", verification: { ok: true, teamName: "Boutique Awa" } }); expect((await (await post("/v1/backup/verify", { name: now.item.name })).json()).verification.ok).toBe(true);
      expect((await post("/v1/backup/verify", { name: "../x" })).status).toBe(404); expect((await post("/v1/backup/settings", { keep: 1 })).status).toBe(400); expect((await (await post("/v1/backup/settings", { keep: 10 })).json()).settings.keep).toBe(10);
    } finally { await s.close(); }
  });
  it("réservé au propriétaire : un caissier n'accède à rien", async () => {
    const { s, url, post, uid } = await boot();
    try {
      await s.store.createUser({ userId: "cashier0000000001", email: "c@x.sn", password: "motdepasse1", name: "Moussa" }); await s.store.addMember("tenantbk000001", "cashier0000000001", ["cashier"], "Moussa"); const lg = await (await fetch(url("/v1/auth/login"), { method: "POST", headers: J, body: JSON.stringify({ email: "c@x.sn", password: "motdepasse1" }) })).json(); const H2 = { ...J, authorization: `Bearer ${lg.token}` };
      for (const p of ["/v1/backup/now", "/v1/backup/export", "/v1/backup/restore", "/v1/backup/settings"]) expect((await post(p, {}, H2)).status, p).toBe(403);
      expect((await fetch(url("/v1/backup/status"), { headers: H2 })).status).toBe(403); expect((await fetch(url("/v1/backup/import"), { method: "POST", headers: H2, body: Buffer.from("x") })).status).toBe(403); void uid;
    } finally { await s.close(); }
  });
  it("export chiffré (phrase obligatoire) puis restauration depuis la liste (confirmation obligatoire, copie de sécurité) et depuis le fichier", async () => {
    const { s, url, post, H } = await boot();
    try {
      expect((await post("/v1/backup/export", { passphrase: "court" })).status).toBe(400); const ex = await post("/v1/backup/export", { passphrase: "phrase-secrete" }); expect(ex.status).toBe(200); expect(ex.headers.get("content-disposition")).toMatch(/\.dmpbackup/); const file = Buffer.from(await ex.arrayBuffer()); expect(file.subarray(0, 8).toString()).toBe("DMPBAK01");
      const now = await (await post("/v1/backup/now", {})).json(); await s.store.create("products", "p2", "tenantbk000001", { tenantId: "tenantbk000001", shopId: "s1", name: "Récent" });
      expect((await post("/v1/backup/restore", { name: now.item.name })).status).toBe(400); const r = await post("/v1/backup/restore", { name: now.item.name, confirm: "RESTAURER" }); expect(await r.json()).toMatchObject({ ok: true, needsLogin: true, rows: 1 }); expect(await s.store.get("products", "p2")).toBeFalsy();
      const imp = (pass: string, confirm = "RESTAURER") => fetch(url("/v1/backup/import"), { method: "POST", headers: { authorization: H.authorization, "x-dmp-passphrase": encodeURIComponent(pass), "x-dmp-confirm": confirm }, body: file });
      // la session de l'ancienne base est celle de la sauvegarde : on se reconnecte
      const lg = await (await fetch(url("/v1/auth/login"), { method: "POST", headers: J, body: JSON.stringify({ email: "o@x.sn", password: "Abcdefg1!xyz" }) })).json(); const H2 = { authorization: `Bearer ${lg.token}`, "x-dmp-confirm": "RESTAURER" };
      const peek = await (await fetch(url("/v1/backup/peek"), { method: "POST", headers: H2, body: file })).json(); expect(peek).toMatchObject({ ok: true, teamName: "Boutique Awa", rows: 1 });
      expect((await fetch(url("/v1/backup/import"), { method: "POST", headers: { ...H2, "x-dmp-passphrase": "mauvaise" }, body: file })).status).toBe(403); expect((await fetch(url("/v1/backup/import"), { method: "POST", headers: { authorization: H2.authorization, "x-dmp-passphrase": "phrase-secrete" }, body: file })).status).toBe(400);
      expect((await fetch(url("/v1/backup/import"), { method: "POST", headers: { ...H2, "x-dmp-passphrase": "phrase-secrete" }, body: file })).status).toBe(200); void imp;
    } finally { await s.close(); }
  });
  it("poste rattaché au cloud : restauration refusée ; poste VIERGE : import possible sans compte, depuis le poste seulement", async () => {
    const a = await boot();
    try {
      const ex = await a.post("/v1/backup/export", { passphrase: "phrase-secrete" }); const file = Buffer.from(await ex.arrayBuffer());
      a.s.store.syncSet("hosted", "1"); const now = await (await a.post("/v1/backup/now", {})).json(); const st = await (await a.get("/v1/backup/status")).json(); expect(st).toMatchObject({ hosted: true, canRestoreFile: false });
      const r = await a.post("/v1/backup/restore", { name: now.item.name, confirm: "RESTAURER" }); expect(r.status).toBe(409); expect((await r.json()).error).toContain("Rétablir depuis le cloud");
      // poste vierge (nouveau PC)
      const b = await startLocalServer({ dataDir: tmp(), port: 0, host: "127.0.0.1", mdns: false, backupEveryMs: 3_600_000 });
      try {
        const u = (p: string) => `http://127.0.0.1:${b.port}${p}`; const bad = await fetch(u("/v1/backup/import"), { method: "POST", headers: { "x-dmp-passphrase": "mauvaise", "x-dmp-confirm": "RESTAURER" }, body: file }); expect(bad.status).toBe(403);
        const ok = await fetch(u("/v1/backup/import"), { method: "POST", headers: { "x-dmp-passphrase": "phrase-secrete", "x-dmp-confirm": "RESTAURER" }, body: file }); expect(await ok.json()).toMatchObject({ ok: true, teamName: "Boutique Awa", needsLogin: true });
        expect(await b.store.get("products", "p1")).toMatchObject({ name: "Riz" }); expect(await (await fetch(u("/v1/setup"))).json()).toEqual({ needsSetup: false });
        const again = await fetch(u("/v1/backup/import"), { method: "POST", headers: { "x-dmp-passphrase": "phrase-secrete", "x-dmp-confirm": "RESTAURER" }, body: file }); expect(again.status).toBe(403); // plus vierge : il faut être propriétaire
        const lg = await fetch(u("/v1/auth/login"), { method: "POST", headers: J, body: JSON.stringify({ email: "o@x.sn", password: "Abcdefg1!xyz" }) }); expect(lg.status).toBe(200); // le propriétaire retrouve son compte
      } finally { await b.close(); }
    } finally { await a.s.close(); }
  });
});
