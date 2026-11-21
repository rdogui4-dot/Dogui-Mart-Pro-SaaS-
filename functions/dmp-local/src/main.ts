import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { SqliteStore } from "../../dmp-api/src/sqlite-store";
import { createLocalServer } from "./server";
import { ensureCertificate, lanAddresses } from "./tls";
import { accessUrls, type NetworkInfo } from "./network";
import { startMdns } from "./mdns";
import type { CloudConfig } from "./cloud";
import { cloudFor, resumeSync, runSync } from "./hosting";

export type StartOptions = { dataDir: string; /** Liaison au cloud (rattachement, synchronisation). */ cloud?: { config: CloudConfig; fetch?: typeof fetch }; /** Synchronisation automatique toutes les N millisecondes (0 ou absent : manuelle). */ autoSyncMs?: number; webRoot?: string; port?: number; host?: string; admins?: string[]; /** Annonce `dogui.local` sur le réseau (mDNS). */ mdns?: boolean; tls?: { key: string | Buffer; cert: string | Buffer }; /** Génère (ou relit) le certificat HTTPS du poste dans `dataDir/tls` et l'utilise. */ https?: boolean };
/** Démarre le serveur local : base SQLite dans `dataDir` (créée au besoin), application web servie depuis `webRoot`. */
export async function startLocalServer(o: StartOptions) {
  mkdirSync(o.dataDir, { recursive: true });
  const store = new SqliteStore({ path: join(o.dataDir, "dogui-mart-pro.sqlite") });
  const cert = o.https && !o.tls ? ensureCertificate(join(o.dataDir, "tls")) : undefined;
  const https = !!(o.tls || cert); let boundPort = 0; let mdnsOn = false;
  const network = (): NetworkInfo => ({ app: "Dogui Mart Pro", hostName: "dogui.local", port: boundPort, https, urls: accessUrls(lanAddresses(), boundPort, https), certificate: cert ? { fingerprint: cert.fingerprint, notAfter: cert.notAfter, hosts: cert.hosts } : null, mdns: mdnsOn });
  const srv = createLocalServer({ store, webRoot: o.webRoot, admins: o.admins, tls: o.tls ?? (cert ? { key: cert.key, cert: cert.cert } : undefined), network, cloud: o.cloud, backupDir: join(o.dataDir, "sauvegardes") });
  resumeSync(store);
  const { port } = await srv.listen(o.port ?? 0, o.host ?? "0.0.0.0"); boundPort = port;
  const md = o.mdns ? startMdns({ hostName: "dogui.local", port, ips: lanAddresses(), https }) : null; mdnsOn = !!md?.running;
  let busy = false; const timer = o.cloud && o.autoSyncMs ? setInterval(() => { if (busy || store.syncGet("hosted") !== "1") return; busy = true; runSync(store, cloudFor(store, o.cloud!.config, o.cloud!.fetch)).catch(() => undefined).finally(() => { busy = false; }); }, o.autoSyncMs) : null; timer?.unref();
  return { store, port, https, certificate: cert, close: async () => { if (timer) clearInterval(timer); md?.stop(); await srv.close(); store.close(); } };
}
export { SqliteStore, createLocalServer };
