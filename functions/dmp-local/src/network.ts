import QRCode from "qrcode";

/** Informations de connexion du poste principal, montrées aux autres appareils du réseau local. */
export type NetworkInfo = { app: string; hostName: string; port: number; https: boolean; urls: string[]; certificate: { fingerprint: string; notAfter: string; hosts: string[] } | null; mdns: boolean };

/** Adresses d'accès : les adresses IPv4 du poste (toujours valables) puis le nom `dogui.local` (si la résolution de noms du réseau le permet). */
export function accessUrls(ips: string[], port: number, https: boolean, hostName = "dogui.local"): string[] {
  const scheme = https ? "https" : "http"; const suffix = (https && port === 443) || (!https && port === 80) ? "" : `:${port}`;
  return [...ips.map((ip) => `${scheme}://${ip}${suffix}`), `${scheme}://${hostName}${suffix}`];
}

/** Libellé lisible d'un appareil d'après son agent utilisateur (« Chrome · Android »). Jamais plus que ce que le navigateur annonce. */
export function deviceLabel(ua: string): string {
  const u = String(ua || "");
  const os = /Android/i.test(u) ? "Android" : /iPhone/i.test(u) ? "iPhone" : /iPad/i.test(u) ? "iPad" : /Windows/i.test(u) ? "Windows" : /Mac OS X|Macintosh/i.test(u) ? "Mac" : /Linux|X11/i.test(u) ? "Linux" : "";
  const br = /Edg\//.test(u) ? "Edge" : /OPR\/|Opera/.test(u) ? "Opera" : /Firefox\//.test(u) ? "Firefox" : /Electron\//.test(u) ? "Application Windows" : /(Chrome|Chromium|CriOS)\//.test(u) ? "Chrome" : /Safari\//.test(u) ? "Safari" : "";
  return [br, os].filter(Boolean).join(" · ") || "Appareil inconnu";
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** Page publique « Connecter un appareil » : adresse, QR code et approbation du certificat pas à pas. Elle ne contient aucune donnée de l'entreprise. */
export async function connectPage(info: NetworkInfo): Promise<string> {
  const main = info.urls[0] ?? ""; const qr = main ? await QRCode.toString(main, { type: "svg", margin: 1, width: 220, color: { dark: "#0f2b46", light: "#ffffff" } }) : "";
  const cert = info.certificate;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connecter un appareil · Dogui Mart Pro</title>
<style>body{font-family:system-ui,Segoe UI,Roboto,sans-serif;margin:0;background:#f4f6f9;color:#172334}main{max-width:44rem;margin:0 auto;padding:1.2rem}h1{font-size:1.5rem;margin:.2rem 0 .6rem}h2{font-size:1.05rem;margin:1.2rem 0 .4rem}section{background:#fff;border:1px solid #d9e0ea;border-radius:12px;padding:1rem;margin-top:.8rem}a.btn{display:inline-block;background:#0f4c81;color:#fff;border-radius:8px;padding:.7rem 1.1rem;text-decoration:none;font-weight:600;margin:.3rem .4rem .3rem 0}code{background:#eef2f7;padding:.1rem .35rem;border-radius:4px;word-break:break-all}.qr{display:flex;gap:1rem;align-items:center;flex-wrap:wrap}.muted{color:#5f6e82;font-size:.9rem}ol{padding-left:1.2rem}li{margin:.3rem 0}</style></head><body><main>
<h1>Connecter cet appareil à Dogui Mart Pro</h1><p class="muted">Poste principal : ${esc(info.hostName)} · réseau local · ${info.https ? "connexion chiffrée (HTTPS)" : "connexion non chiffrée (HTTP)"}</p>
<section><h2>1. Ouvrir l'application</h2><div class="qr"><div aria-label="QR code de l'adresse du poste principal">${qr}</div><div>${info.urls.map((u) => `<p><a class="btn" href="${esc(u)}/">Ouvrir ${esc(u)}</a></p>`).join("")}<p class="muted">Scannez le QR code avec la caméra du téléphone, ou saisissez l'adresse dans le navigateur. L'appareil doit être sur le même réseau Wi-Fi ou câble que le poste principal.</p></div></div></section>
${cert ? `<section><h2>2. Approuver le certificat (une seule fois par appareil)</h2><p>La connexion est chiffrée avec un certificat créé sur le poste principal. Sans l'approuver, le navigateur affiche un avertissement et refuse la caméra (scan de codes-barres).</p>
<p><a class="btn" href="/v1/certificate.crt">Télécharger le certificat</a></p><p class="muted">Empreinte SHA-256 à comparer avec celle affichée dans Paramètres → Réseau local : <code>${esc(cert.fingerprint)}</code></p>
<ol><li><b>Android</b> : ouvrez le fichier téléchargé, ou Paramètres → Sécurité → Chiffrement et identifiants → Installer un certificat → Certificat d'autorité de certification.</li><li><b>iPhone / iPad</b> : ouvrez le fichier dans Safari, autorisez le profil, installez-le (Réglages → Profil téléchargé), puis Réglages → Général → Informations → Réglages des certificats : activez la confiance.</li><li><b>Windows</b> : double-clic sur le fichier → Installer le certificat → Ordinateur local → « Autorités de certification racines de confiance ».</li><li><b>Mac</b> : double-clic, ajoutez-le au trousseau « Système », puis réglez-le sur « Toujours approuver ».</li></ol>
<p class="muted">Valable jusqu'au ${esc(cert.notAfter.slice(0, 10))}. Il est renouvelé automatiquement ; il faudra alors l'approuver à nouveau.</p></section>` : `<section><h2>Connexion non chiffrée</h2><p class="muted">Ce poste fonctionne en HTTP : le scan de codes-barres par la caméra n'est disponible que sur le poste principal.</p></section>`}
</main></body></html>`;
}
