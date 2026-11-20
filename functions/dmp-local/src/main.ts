import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { SqliteStore } from "../../dmp-api/src/sqlite-store";
import { createLocalServer } from "./server";
import { ensureCertificate } from "./tls";

export type StartOptions = { dataDir: string; webRoot?: string; port?: number; host?: string; admins?: string[]; tls?: { key: string | Buffer; cert: string | Buffer }; /** Génère (ou relit) le certificat HTTPS du poste dans `dataDir/tls` et l'utilise. */ https?: boolean };
/** Démarre le serveur local : base SQLite dans `dataDir` (créée au besoin), application web servie depuis `webRoot`. */
export async function startLocalServer(o: StartOptions) {
  mkdirSync(o.dataDir, { recursive: true });
  const store = new SqliteStore({ path: join(o.dataDir, "dogui-mart-pro.sqlite") });
  const cert = o.https && !o.tls ? ensureCertificate(join(o.dataDir, "tls")) : undefined;
  const srv = createLocalServer({ store, webRoot: o.webRoot, admins: o.admins, tls: o.tls ?? (cert ? { key: cert.key, cert: cert.cert } : undefined) });
  const { port } = await srv.listen(o.port ?? 0, o.host ?? "0.0.0.0");
  return { store, port, https: !!(o.tls || cert), certificate: cert, close: async () => { await srv.close(); store.close(); } };
}
export { SqliteStore, createLocalServer };
