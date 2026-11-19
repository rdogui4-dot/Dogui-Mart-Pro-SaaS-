/** Rapport de sécurité de l'équipe (A4) : état réel au moment de l'édition (membres, rôles, accès, connexions, 2FA, invitations, constats). */
import { MODULE_LABEL } from "@/domain/access";
import { MATRIX_LABEL } from "@/domain/team-kit";
import type { TeamData } from "@/routes/team-page";

const GOLD: [number, number, number] = [201, 162, 39];
const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "jamais");

export async function teamReportPdf(t: TeamData, shopName: string): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" }); const M = 14, R = 196; let y = 18;
  const font = (size: number, bold = false, gray = 25) => doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(size).setTextColor(gray);
  const ensure = (h: number) => { if (y + h > 282) { doc.addPage(); y = 18; } };
  const para = (txt: string, size = 9) => { font(size); for (const l of doc.splitTextToSize(txt, R - M) as string[]) { ensure(5); doc.text(l, M, y); y += 4.4; } };
  const h2 = (txt: string) => { y += 3; ensure(10); font(11.5, true); doc.text(txt, M, y); y += 6; };
  font(16, true); doc.text("Rapport de sécurité de l'équipe", M, y); font(9, false, 110); doc.text(`DOGUI MART PRO${shopName ? ` · ${shopName}` : ""} · édité le ${dt(new Date().toISOString())}`, M, y + 5);
  doc.setFillColor(...GOLD).rect(M, y + 8, R - M, 0.8, "F"); y += 16;
  const c = t.counts;
  para(`Membres : ${c.members} (actifs : ${c.active}) · rôles utilisés : ${c.roles} · invitations en attente : ${c.pendingInvites} · connexions sur 24 h : ${c.logins24h ?? "indisponible"} · comptes avec double authentification : ${c.mfa === null ? "indisponible" : `${c.mfa} sur ${c.active}`}.`);
  h2("Membres");
  const cols = [M, M + 46, M + 76, M + 96, M + 136, M + 160];
  font(8.5, true, 90); ["Membre", "Rôle", "Statut", "Dernière connexion", "2FA", "Boutiques"].forEach((h, i) => doc.text(h, cols[i]!, y)); y += 4.5; doc.setDrawColor(220);
  for (const m of t.members) {
    ensure(9); font(8.5);
    const shops = m.role === "owner" ? "toutes" : m.shopIds.map((id) => t.shops.find((x) => x.id === id)?.name ?? "?").join(", ");
    const row = [m.name, MATRIX_LABEL[m.role], m.active ? "actif" : "désactivé", t.securityAvailable ? dt(m.lastLogin) : "—", m.mfa === null ? "—" : m.mfa ? "activée" : "non", shops];
    row.forEach((v, i) => doc.text((doc.splitTextToSize(String(v), (cols[i + 1] ?? R) - cols[i]! - 2) as string[])[0] ?? "", cols[i]!, y));
    y += 4; font(7.5, false, 120); doc.text(`Accès : ${m.modules.map((x) => MODULE_LABEL[x]).join(", ")}`.slice(0, 140), M, y); y += 2.5; doc.line(M, y, R, y); y += 4;
  }
  h2("Invitations");
  if (!t.invites.length) para("Aucune invitation.");
  for (const i of t.invites) para(`${i.name} · ${i.roleLabel} · ${({ pending: "en attente", accepted: "acceptée", revoked: "annulée", expired: "expirée" } as const)[i.status]} · échéance ${dt(i.expiresAt)}`);
  h2("Constats MASTER DOGUI");
  for (const x of t.insights) para(`• ${x.text}`);
  h2("Règles appliquées par le serveur");
  for (const l of ["Chaque action vérifie le rôle, les modules accordés et les boutiques affectées.", "Un compte désactivé ne peut plus se connecter ni lire de données.", "Le rôle Consultant ne peut que consulter : toute écriture est refusée.", "Gestion de l'équipe, des boutiques et de l'abonnement : propriétaire uniquement."]) para(`• ${l}`);
  y += 2; para(t.note, 8);
  return doc.output("blob");
}
