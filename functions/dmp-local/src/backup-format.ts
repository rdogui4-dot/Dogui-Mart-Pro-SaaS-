import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

/** Fichier de sauvegarde exporté (.dmpbackup) : en-tête lisible et authentifié + base SQLite compressée puis chiffrée (AES-256-GCM, clé dérivée de la phrase secrète par scrypt).
 *  Aucune phrase secrète n'est conservée : perdue, le fichier est irrécupérable. Toute modification du fichier (en-tête compris) fait échouer le déchiffrement. */
const MAGIC = Buffer.from("DMPBAK01"); const KDF = { N: 32768, r: 8, p: 1 };
export type BackupMeta = { tenantId?: string; teamName?: string; rows?: number };
export type BackupHeader = BackupMeta & { v: 1; createdAt: string; app: string; size: number; kdf: { alg: "scrypt"; N: number; r: number; p: number; salt: string }; cipher: { alg: "aes-256-gcm"; iv: string } };
export class BackupFormatError extends Error { constructor(public code: "format" | "passphrase", message: string) { super(message); } }
const key = (pass: string, salt: Buffer, k = KDF) => scryptSync(pass, salt, 32, { N: k.N, r: k.r, p: k.p, maxmem: 256 * 1024 * 1024 });

export function encodeBackup(db: Buffer, passphrase: string, meta: BackupMeta = {}, now = new Date()): Buffer {
  const salt = randomBytes(16), iv = randomBytes(12);
  const header: BackupHeader = { v: 1, createdAt: now.toISOString(), app: "Dogui Mart Pro", size: db.length, ...meta, kdf: { alg: "scrypt", ...KDF, salt: salt.toString("base64") }, cipher: { alg: "aes-256-gcm", iv: iv.toString("base64") } };
  const hb = Buffer.from(JSON.stringify(header), "utf8"); const len = Buffer.alloc(4); len.writeUInt32BE(hb.length);
  const c = createCipheriv("aes-256-gcm", key(passphrase, salt), iv); c.setAAD(Buffer.concat([MAGIC, len, hb]));
  const enc = Buffer.concat([c.update(gzipSync(db)), c.final()]); return Buffer.concat([MAGIC, len, hb, enc, c.getAuthTag()]);
}
/** En-tête seul (sans phrase secrète) : permet d'afficher le commerce et la date avant de demander la phrase. */
export function peekBackup(buf: Buffer): BackupHeader {
  if (buf.length < 8 + 4 + 16 || !buf.subarray(0, 8).equals(MAGIC)) throw new BackupFormatError("format", "Ce fichier n'est pas une sauvegarde Dogui Mart Pro");
  const n = buf.readUInt32BE(8); if (n < 2 || n > 65536 || 12 + n + 16 > buf.length) throw new BackupFormatError("format", "Fichier de sauvegarde endommagé");
  let h: BackupHeader; try { h = JSON.parse(buf.subarray(12, 12 + n).toString("utf8")); } catch { throw new BackupFormatError("format", "En-tête de sauvegarde illisible"); }
  if (h.v !== 1 || h.kdf?.alg !== "scrypt" || h.cipher?.alg !== "aes-256-gcm") throw new BackupFormatError("format", "Version de sauvegarde non prise en charge : mettez Dogui Mart Pro à jour");
  if (![h.kdf.N, h.kdf.r, h.kdf.p].every((x) => Number.isInteger(x) && x > 0) || h.kdf.N > 1 << 20 || h.kdf.r > 16 || h.kdf.p > 4) throw new BackupFormatError("format", "Paramètres de sauvegarde invalides");
  return h;
}
export function decodeBackup(buf: Buffer, passphrase: string): { header: BackupHeader; db: Buffer } {
  const header = peekBackup(buf); const n = buf.readUInt32BE(8); const aad = buf.subarray(0, 12 + n); const enc = buf.subarray(12 + n, buf.length - 16); const tag = buf.subarray(buf.length - 16);
  let gz: Buffer; try { const d = createDecipheriv("aes-256-gcm", key(passphrase, Buffer.from(header.kdf.salt, "base64"), header.kdf), Buffer.from(header.cipher.iv, "base64")); d.setAAD(aad); d.setAuthTag(tag); gz = Buffer.concat([d.update(enc), d.final()]); }
  catch { throw new BackupFormatError("passphrase", "Phrase secrète incorrecte, ou fichier modifié"); }
  let db: Buffer; try { db = gunzipSync(gz, { maxOutputLength: 8 * 1024 ** 3 }); } catch { throw new BackupFormatError("format", "Contenu de la sauvegarde endommagé"); }
  if (db.length !== header.size) throw new BackupFormatError("format", "Taille de la sauvegarde incohérente"); return { header, db };
}
