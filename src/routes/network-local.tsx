import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Copy, Laptop, ShieldCheck, Smartphone, Wifi } from "lucide-react";
import { Panel, StatusBadge, ErrorState, LoadingState } from "@/components/kit";
import { localNetwork, type Device } from "@/lib/local-backend";

const ago = (iso: string): string => { const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000)); return s < 60 ? "à l'instant" : s < 3600 ? `il y a ${Math.round(s / 60)} min` : s < 86400 ? `il y a ${Math.round(s / 3600)} h` : `il y a ${Math.round(s / 86400)} j`; };
const ROLE: Record<string, string> = { owner: "Propriétaire", manager: "Gérant", cashier: "Caissier", stockkeeper: "Magasinier", accountant: "Comptable", viewer: "Consultant" };
const mobile = (d: string) => /Android|iPhone|iPad/.test(d);

function Qr({ text }: { text: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) void QRCode.toCanvas(ref.current, text, { width: 200, margin: 2 }); }, [text]);
  return <canvas ref={ref} className="rounded-xl bg-white" aria-label={`QR code de ${text}`} />;
}

/** Réseau local (version Windows, poste principal) : adresses à ouvrir sur les autres appareils, approbation du certificat, appareils connectés. Tout vient du serveur local. */
export function NetworkSection() {
  const api = localNetwork(); const qc = useQueryClient(); const [copied, setCopied] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState("");
  const q = useQuery({ queryKey: ["local-network"], enabled: !!api, refetchInterval: 10_000, queryFn: () => api!.get() });
  if (!api) return <div className="card text-sm">Le réseau local n'est disponible que dans la version Windows de Dogui Mart Pro.</div>;
  if (q.isLoading) return <LoadingState label="Lecture de l'état du réseau" />;
  if (q.error || !q.data) return <ErrorState message={(q.error as Error)?.message} onRetry={() => void q.refetch()} />;
  const { info, devices } = q.data; const main = info?.urls[0] ?? "";
  const copy = async (u: string) => { try { await navigator.clipboard.writeText(u); setCopied(u); setTimeout(() => setCopied(""), 2000); } catch { setErr("Copie impossible : sélectionnez l'adresse à la main."); } };
  const revoke = async (d: Device) => { if (!confirm(`Déconnecter « ${d.name} » (${d.device}) ? L'appareil devra se reconnecter.`)) return; setBusy(d.id); setErr(""); try { await api.revoke(d.id); await qc.invalidateQueries({ queryKey: ["local-network"] }); } catch (e) { setErr((e as Error).message); } finally { setBusy(""); } };
  const active = devices.filter((d) => d.active);
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Poste principal" icon={Wifi} action={<StatusBadge tone="ok">En marche</StatusBadge>}>
        <p className="text-sm text-soft">Ce poste garde les données du commerce et les sert aux autres appareils connectés au même réseau Wi-Fi ou câble. {info?.https ? "Les échanges sont chiffrés (HTTPS)." : "Les échanges ne sont pas chiffrés (HTTP) : le scan par caméra n'est pas disponible sur les autres appareils."}</p>
        {info ? <div className="grid gap-4 md:grid-cols-[auto_minmax(0,1fr)] items-start">
          <div className="flex flex-col items-center gap-1">{main && <Qr text={main} />}<span className="text-xs text-muted">Scannez avec la caméra du téléphone</span></div>
          <div className="flex flex-col gap-2 min-w-0">
            <p className="text-sm font-semibold">Adresses à ouvrir sur les autres appareils</p>
            <ul className="flex flex-col gap-1">{info.urls.map((u) => <li key={u} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm"><code className="truncate" title={u}>{u}</code><button type="button" className="btn-ghost !min-h-8 !px-2 !py-1 flex items-center gap-1 text-xs" onClick={() => void copy(u)} aria-label={`Copier ${u}`}><Copy size={14} />{copied === u ? "Copié" : "Copier"}</button></li>)}</ul>
            <p className="text-xs text-muted">L'adresse avec des chiffres fonctionne toujours. Le nom <b>{info.hostName}</b> dépend du réseau : {info.mdns ? "annoncé sur ce réseau." : "non annoncé sur ce poste (utilisez l'adresse avec des chiffres)."}</p>
            <a className="text-sm text-accent-text underline self-start" href="/connect" target="_blank" rel="noreferrer noopener">Page « Connecter un appareil » à ouvrir sur le téléphone</a>
          </div>
        </div> : <p className="text-sm text-muted">Adresses indisponibles.</p>}
        <p className="text-xs text-muted">Si les autres appareils n'arrivent pas à se connecter : vérifiez qu'ils sont sur le même réseau et autorisez Dogui Mart Pro dans le pare-feu Windows (réseau privé).</p>
      </Panel>
      {info?.certificate && <Panel title="Certificat de sécurité" icon={ShieldCheck}>
        <p className="text-sm text-soft">Chaque téléphone ou tablette doit approuver ce certificat une fois, sinon le navigateur affiche un avertissement et refuse la caméra. La page « Connecter un appareil » explique les étapes pour Android, iPhone, Windows et Mac.</p>
        <dl className="text-sm grid gap-1"><div className="flex flex-wrap gap-x-2"><dt className="text-muted">Empreinte SHA-256</dt><dd className="font-mono text-xs break-all">{info.certificate.fingerprint}</dd></div><div className="flex gap-x-2"><dt className="text-muted">Valable jusqu'au</dt><dd>{new Date(info.certificate.notAfter).toLocaleDateString("fr-FR")}</dd></div></dl>
        <a className="btn-ghost self-start" href="/v1/certificate.crt">Télécharger le certificat</a>
      </Panel>}
      <Panel title={`Appareils connectés (${active.length})`} icon={Smartphone}>
        {err && <p role="alert" className="text-sm text-bad">{err}</p>}
        {devices.length === 0 ? <p className="text-sm text-muted">Aucun appareil connecté.</p> : <ul className="flex flex-col divide-y divide-[var(--line)]">{devices.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span className="flex items-center gap-2 min-w-0">{mobile(d.device) ? <Smartphone size={18} aria-hidden="true" className="shrink-0 text-muted" /> : <Laptop size={18} aria-hidden="true" className="shrink-0 text-muted" />}<span className="min-w-0"><b className="block truncate">{d.name}{d.current ? " (cet appareil)" : ""}</b><span className="text-xs text-muted">{ROLE[d.roles[0] ?? ""] ?? d.roles[0]} · {d.device}{d.ip ? ` · ${d.ip}` : ""} · {d.active ? "actif" : "inactif"}, vu {ago(d.lastSeen)}</span></span></span>
            {!d.current && <button type="button" className="btn-ghost !min-h-8 !px-3 !py-1 text-xs shrink-0" disabled={busy === d.id} onClick={() => void revoke(d)} aria-label={`Déconnecter ${d.name} (${d.device})`}>Déconnecter</button>}
          </li>))}</ul>}
        <p className="text-xs text-muted">Actif = vu dans les 15 dernières minutes. Un appareil déconnecté doit saisir à nouveau son identifiant et son mot de passe.</p>
      </Panel>
    </div>
  );
}
