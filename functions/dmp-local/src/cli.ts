import { startLocalServer } from "./main";

/** Lancement en ligne de commande : DMP_DATA_DIR, DMP_WEB_ROOT, DMP_PORT (défaut 8787), DMP_HOST (défaut 0.0.0.0), DMP_HTTPS=1 (certificat généré localement), DMP_ADMINS (identifiants plateforme, séparés par des virgules). */
const dataDir = process.env.DMP_DATA_DIR || "./dmp-data";
startLocalServer({ dataDir, webRoot: process.env.DMP_WEB_ROOT, port: Number(process.env.DMP_PORT || 8787), host: process.env.DMP_HOST || "0.0.0.0", https: process.env.DMP_HTTPS === "1", mdns: process.env.DMP_MDNS !== "0", admins: (process.env.DMP_ADMINS || "").split(",").map((x) => x.trim()).filter(Boolean) })
  .then(({ port, https }) => console.log(`Dogui Mart Pro (serveur local) : ${https ? "https" : "http"}://localhost:${port}  ·  données : ${dataDir}`))
  .catch((e) => { console.error(e); process.exit(1); });
