import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { X509Certificate } from "node:crypto";
import selfsigned from "selfsigned";

/** Certificat HTTPS généré localement (autosigné) : nécessaire pour que les téléphones et tablettes du réseau puissent scanner les codes-barres avec la caméra (le navigateur exige HTTPS).
 *  Il couvre localhost, dogui.local et les adresses du poste ; il est régénéré quand les adresses changent ou à l'approche de l'expiration. Les appareils doivent l'approuver une fois. */
const DAYS = 800; // au-delà de ~825 jours, certains navigateurs mobiles refusent un certificat autosigné
export const lanAddresses = (): string[] => Object.values(networkInterfaces()).flatMap((l) => l ?? []).filter((i) => i.family === "IPv4" && !i.internal).map((i) => i.address).sort();

export type Tls = { key: string; cert: string; fingerprint: string; hosts: string[]; notAfter: string };
export function ensureCertificate(dir: string, extraHosts: string[] = []): Tls {
  mkdirSync(dir, { recursive: true }); const keyFile = join(dir, "server-key.pem"), certFile = join(dir, "server-cert.pem"), metaFile = join(dir, "hosts.json");
  const ips = [...new Set(["127.0.0.1", ...lanAddresses(), ...extraHosts.filter((h) => /^\d+\.\d+\.\d+\.\d+$/.test(h))])]; const names = [...new Set(["localhost", "dogui.local", ...extraHosts.filter((h) => !/^\d+\.\d+\.\d+\.\d+$/.test(h))])];
  const hosts = [...names, ...ips].sort();
  if (existsSync(keyFile) && existsSync(certFile) && existsSync(metaFile)) {
    try { const have = JSON.parse(readFileSync(metaFile, "utf8")) as string[]; const cert = readFileSync(certFile, "utf8"); const x = new X509Certificate(cert);
      if (JSON.stringify(have) === JSON.stringify(hosts) && new Date(x.validTo).getTime() - Date.now() > 30 * 864e5) return { key: readFileSync(keyFile, "utf8"), cert, fingerprint: x.fingerprint256, hosts, notAfter: new Date(x.validTo).toISOString() }; } catch { /* illisible : on régénère */ }
  }
  const p = selfsigned.generate([{ name: "commonName", value: "Dogui Mart Pro (poste principal)" }, { name: "organizationName", value: "Dogui Mart Pro" }], { days: DAYS, keySize: 2048, algorithm: "sha256",
    extensions: [{ name: "basicConstraints", cA: false }, { name: "keyUsage", digitalSignature: true, keyEncipherment: true }, { name: "extKeyUsage", serverAuth: true }, { name: "subjectAltName", altNames: [...names.map((n) => ({ type: 2, value: n })), ...ips.map((ip) => ({ type: 7, ip }))] }] });
  writeFileSync(keyFile, p.private, { mode: 0o600 }); writeFileSync(certFile, p.cert); writeFileSync(metaFile, JSON.stringify(hosts));
  const x = new X509Certificate(p.cert); return { key: p.private, cert: p.cert, fingerprint: x.fingerprint256, hosts, notAfter: new Date(x.validTo).toISOString() };
}
