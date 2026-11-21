import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync, truncateSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStore } from "../../dmp-api/src/sqlite-store";
import { BACKUP_KEEP, backupAlert, backupName, backupsToDelete, kindOf, needsDaily, validPassphrase } from "./backup-logic";
import { BackupFormatError, decodeBackup, encodeBackup, peekBackup } from "./backup-format";
import { BackupError, createBackupManager, verifyDbFile } from "./backup";

const dirs: string[] = []; const tmp = () => { const d = mkdtempSync(join(tmpdir(), "dmp-bk-")); dirs.push(d); return d; }; afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const mk = (team = "t1", name = "Boutique") => { const d = tmp(); const store = new SqliteStore({ path: join(d, "base.sqlite") }); store.createTeam(team, name); return { d, store }; };
const D = (day: number) => new Date(`2026-06-${String(day).padStart(2, "0")}T10:00:00Z`);

describe("logique des sauvegardes", () => {
  it("noms par famille, une copie automatique par jour", () => {
    expect(backupName(D(10))).toBe("auto-2026-06-10.sqlite"); expect(backupName(D(10), "manuel")).toBe("manuel-2026-06-10T10-00-00.sqlite"); expect(backupName(D(10), "avant-restauration")).toBe("avant-restauration-2026-06-10T10-00-00.sqlite");
    expect(kindOf("auto-2026-06-10.sqlite")).toBe("auto"); expect(kindOf("manuel-2026-06-10T10-00-00.sqlite")).toBe("manuel"); expect(kindOf("notes.txt")).toBeNull(); expect(kindOf("auto-2026-06-10.sqlite.part")).toBeNull();
    expect(needsDaily(["auto-2026-06-10.sqlite"], D(10))).toBe(false); expect(needsDaily(["auto-2026-06-09.sqlite"], D(10))).toBe(true);
  });
  it("rotation par famille : réglage borné, fichiers inconnus jamais touchés", () => {
    const autos = Array.from({ length: 12 }, (_, i) => backupName(D(i + 1))); const manuals = Array.from({ length: 22 }, (_, i) => backupName(new Date(Date.UTC(2026, 5, 1, 10, i)), "manuel"));
    expect(backupsToDelete([...autos, "autre.txt"], BACKUP_KEEP)).toHaveLength(5); expect(backupsToDelete(autos, 100)).toEqual([]); expect(backupsToDelete(autos, 1)).toHaveLength(9); expect(backupsToDelete(manuals)).toHaveLength(2); expect(backupsToDelete(["autre.txt"])).toEqual([]);
  });
  it("phrase secrète : 8 caractères au moins", () => { expect(validPassphrase("1234567")).toBe(false); expect(validPassphrase("12345678")).toBe(true); expect(validPassphrase(undefined)).toBe(false); expect(validPassphrase("x".repeat(201))).toBe(false); });
  it("alerte : aucune sauvegarde valide, trop ancienne, copie externe en échec, tout va bien", () => {
    const now = Date.parse("2026-06-10T12:00:00Z"); const h = (n: number) => new Date(now - n * 36e5).toISOString();
    expect(backupAlert({ hasBackups: false, now }).level).toBe("bad"); expect(backupAlert({ hasBackups: true, now }).detail).toContain("vérifiées"); expect(backupAlert({ lastOkAt: h(60), hasBackups: true, now }).level).toBe("bad");
    expect(backupAlert({ lastOkAt: h(3), hasBackups: true, externalError: "Dossier externe indisponible", now })).toMatchObject({ level: "warn" }); expect(backupAlert({ lastOkAt: h(3), hasBackups: true, now }).level).toBe("none");
  });
});

describe("fichier .dmpbackup (chiffré)", () => {
  const db = Buffer.from("SQLite format 3\0".repeat(2000));
  it("aller-retour ; en-tête lisible sans phrase ; le contenu n'apparaît pas en clair", () => {
    const f = encodeBackup(db, "phrase-secrete", { tenantId: "t1", teamName: "Boutique Awa", rows: 42 }, D(10)); expect(f.includes(Buffer.from("SQLite format"))).toBe(false);
    expect(peekBackup(f)).toMatchObject({ v: 1, teamName: "Boutique Awa", rows: 42, createdAt: D(10).toISOString() }); const d = decodeBackup(f, "phrase-secrete"); expect(d.db.equals(db)).toBe(true); expect(d.header.tenantId).toBe("t1");
  });
  it("mauvaise phrase, fichier modifié (contenu ou en-tête), tronqué, autre fichier : refusés avec un message clair", () => {
    const f = encodeBackup(db, "phrase-secrete"); const err = (fn: () => unknown) => { try { fn(); return null; } catch (e) { return e as BackupFormatError; } };
    expect(err(() => decodeBackup(f, "autre-phrase"))).toMatchObject({ code: "passphrase" });
    const a = Buffer.from(f); a[a.length - 40] = a[a.length - 40]! ^ 1; expect(err(() => decodeBackup(a, "phrase-secrete"))).toMatchObject({ code: "passphrase" });
    const b = Buffer.from(f); const i = b.indexOf(Buffer.from("createdAt")) + 12; b[i] = b[i] === 0x31 ? 0x32 : 0x31; expect(err(() => decodeBackup(b, "phrase-secrete"))).toMatchObject({ code: "passphrase" }); // l'en-tête est authentifié
    expect(err(() => decodeBackup(f.subarray(0, 30), "phrase-secrete"))).toMatchObject({ code: "format" }); expect(err(() => peekBackup(Buffer.from("pas une sauvegarde du tout, juste du texte")))).toMatchObject({ code: "format" });
    const big = Buffer.from(f); big.writeUInt32BE(70000, 8); expect(err(() => peekBackup(big))).toMatchObject({ code: "format" });
  });
});

describe("gestionnaire de sauvegardes", () => {
  it("copie automatique une fois par jour, vérifiée ; rotation ; liste lisible", () => {
    const { d, store } = mk(); const m = createBackupManager(store, d); for (let day = 1; day <= 9; day++) expect(m.runDaily(D(day))).not.toBeNull(); expect(m.runDaily(D(9))).toBeNull();
    const l = m.list(); expect(l).toHaveLength(7); expect(l.every((x) => x.kind === "auto" && x.verification?.ok && x.verification.teamName === "Boutique")).toBe(true); expect(readdirSync(m.dir).filter((n) => n.endsWith(".part"))).toEqual([]);
    expect(m.status(false)).toMatchObject({ canRestoreFile: true }); expect(m.status(true).canRestoreFile).toBe(false); store.close();
  });
  it("vérification : une copie abîmée ou étrangère est détectée", () => {
    const { d, store } = mk(); const m = createBackupManager(store, d); const it1 = m.create("manuel", D(10)); expect(m.verify(it1.name).ok).toBe(true);
    truncateSync(join(m.dir, it1.name), 4000); expect(m.verify(it1.name)).toMatchObject({ ok: false }); const junk = join(d, "x.sqlite"); writeFileSync(junk, "du texte, pas une base"); expect(verifyDbFile(junk).ok).toBe(false); expect(verifyDbFile(join(d, "absent.sqlite")).ok).toBe(false);
    expect(() => m.verify("../../etc/passwd")).toThrow(BackupError); store.close();
  });
  it("copie externe : réglage validé, copie à chaque sauvegarde, rotation, rattrapage quand le dossier revient", () => {
    const { d, store } = mk(); const ext = join(tmp(), "usb"); const m = createBackupManager(store, d);
    expect(() => m.setSettings({ externalDir: "relatif/chemin" })).toThrow(/chemin complet/); expect(() => m.setSettings({ externalDir: join(d, "sauvegardes") })).toThrow(/dossier des données/); expect(() => m.setSettings({ keep: 1 })).toThrow(/3 à 60/);
    expect(m.setSettings({ externalDir: ext, keep: 3 })).toMatchObject({ externalDir: ext, keep: 3, externalOk: true });
    for (let day = 1; day <= 5; day++) m.runDaily(D(day)); expect(readdirSync(ext).sort()).toEqual(["auto-2026-06-03.sqlite", "auto-2026-06-04.sqlite", "auto-2026-06-05.sqlite"]); expect(verifyDbFile(join(ext, "auto-2026-06-05.sqlite")).ok).toBe(true);
    // dossier externe indisponible (fichier à la place du dossier) : la sauvegarde locale réussit, l'erreur est signalée, puis rattrapée
    rmSync(ext, { recursive: true, force: true }); writeFileSync(ext, "je suis un fichier"); m.runDaily(D(6)); expect(m.settings().externalError).toContain("indisponible"); expect(m.status(false).alert.level).toBe("warn"); expect(m.list().some((x) => x.name === "auto-2026-06-06.sqlite")).toBe(true);
    rmSync(ext); m.runDaily(D(6)); expect(m.settings().externalError).toBeNull(); expect(existsSync(join(ext, "auto-2026-06-06.sqlite"))).toBe(true); store.close();
  });
  it("export chiffré puis restauration sur un poste NEUF : mêmes données, copie de sécurité inutile (poste vide), liens cloud retirés", async () => {
    const a = mk("tenantA", "Boutique Awa"); await a.store.create("products", "p1", "tenantA", { tenantId: "tenantA", shopId: "s1", name: "Riz" }); a.store.syncSet("hosted", "1"); a.store.syncSet("tenantId", "tenantA");
    const m = createBackupManager(a.store, a.d); const ex = m.exportEncrypted(null, "phrase-secrete"); expect(ex.filename).toMatch(/^dogui-mart-pro-\d{4}-\d{2}-\d{2}\.dmpbackup$/); expect(m.peek(ex.file)).toMatchObject({ teamName: "Boutique Awa" });
    const dst = tmp(); const store = new SqliteStore({ path: join(dst, "base.sqlite") }); const m2 = createBackupManager(store, dst);
    expect(() => m2.restoreFromFile(ex.file, "mauvaise", { hosted: false })).toThrow(/Phrase secrète incorrecte/); const r = m2.restoreFromFile(ex.file, "phrase-secrete", { hosted: false });
    expect(r).toMatchObject({ rows: 1, teamName: "Boutique Awa" }); expect(await store.get("products", "p1")).toMatchObject({ name: "Riz" }); expect(store.syncGet("hosted")).toBeNull(); expect(store.syncGet("tenantId")).toBeNull(); expect(store.db.prepare("SELECT id FROM teams").get()).toMatchObject({ id: "tenantA" });
    expect(() => m.exportEncrypted(null, "court")).toThrow(/8 caractères/); a.store.close(); store.close();
  });
  it("restauration refusée : poste rattaché au cloud, autre commerce, fichier invalide ; sinon copie de sécurité AVANT puis remplacement", async () => {
    const { d, store } = mk("tenantA", "Boutique A"); await store.create("products", "p1", "tenantA", { tenantId: "tenantA", shopId: "s1", name: "Ancien" }); const m = createBackupManager(store, d); const keep = m.create("manuel", D(10));
    await store.create("products", "p2", "tenantA", { tenantId: "tenantA", shopId: "s1", name: "Récent" });
    expect(() => m.restoreFromList(keep.name, { hosted: true })).toThrow(/rattaché au cloud/); expect(() => m.restoreFromList("auto-2020-01-01.sqlite", { hosted: false })).toThrow(/introuvable/);
    const other = mk("tenantB", "Autre"); const mo = createBackupManager(other.store, other.d); const foreign = mo.create("manuel", D(10)); const f = mo.exportEncrypted(foreign.name, "phrase-secrete"); expect(() => m.restoreFromFile(f.file, "phrase-secrete", { hosted: false })).toThrow(/autre commerce/);
    const bad = Buffer.concat([Buffer.from("DMPBAK01"), Buffer.alloc(200, 7)]); expect(() => m.restoreFromFile(bad, "phrase-secrete", { hosted: false })).toThrow(BackupError);
    const r = m.restoreFromList(keep.name, { hosted: false }); expect(r.before).toMatch(/^avant-restauration-/); expect(await store.get("products", "p1")).toBeTruthy(); expect(await store.get("products", "p2")).toBeFalsy();
    expect(verifyDbFile(join(m.dir, r.before!)).rows).toBe(2); // l'état d'avant (2 articles) est gardé
    other.store.close(); store.close();
  });
});
