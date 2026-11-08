import type { jsPDF } from "jspdf";
import { COMMON_FEATURES, NOT_AVAILABLE, buildOffers, fcfa, type Offer } from "@/domain/selar-offers";
import { DEFAULT_PLANS, GRACE_DAYS, PERIOD_LABEL, PERIODS, type Plan } from "@/domain/subscriptions";

const GOLD: [number, number, number] = [201, 162, 39]; const INK = 25; const MUTED = 110;
const W = 210, M = 16, R = W - M, TOP = 18, BOTTOM = 276;

/** Rédacteur de document A4 : titres, paragraphes, listes à puces, tableaux, sauts de page automatiques. */
class Writer {
  y = TOP;
  constructor(readonly doc: jsPDF) {}
  ensure(h: number) { if (this.y + h > BOTTOM) { this.doc.addPage(); this.y = TOP; } }
  private font(size: number, bold = false, color = INK) { this.doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(size).setTextColor(color); }
  h1(t: string) { this.ensure(16); this.font(17, true); this.doc.text(t, M, this.y); this.doc.setFillColor(...GOLD).rect(M, this.y + 2, 24, 1.2, "F"); this.y += 11; }
  h2(t: string) { this.ensure(12); this.font(12, true); this.doc.text(t, M, this.y); this.y += 6.5; }
  h3(t: string) { this.ensure(9); this.font(10, true, MUTED); this.doc.text(t.toUpperCase(), M, this.y); this.y += 5; }
  gap(h = 3) { this.y += h; }
  p(t: string, o: { size?: number; bold?: boolean; color?: number; indent?: number } = {}) {
    const size = o.size ?? 9.5, lh = size * 0.46 + 0.9, x = M + (o.indent ?? 0);
    this.font(size, o.bold, o.color ?? INK);
    for (const para of t.split("\n")) {
      if (!para.trim()) { this.y += 1.4; continue; } // ligne vide : simple respiration, pas une ligne de texte entière
      const lines = this.doc.splitTextToSize(para, R - x) as string[];
      for (const l of lines) { this.ensure(lh); this.doc.text(l, x, this.y); this.y += lh; }
    }
    this.y += 1;
  }
  bullets(items: string[], size = 9.5) {
    const lh = size * 0.46 + 0.9; this.font(size);
    for (const it of items) {
      const lines = this.doc.splitTextToSize(it, R - M - 5) as string[];
      this.ensure(lh * lines.length);
      this.doc.setFillColor(...GOLD).circle(M + 1.2, this.y - 1.1, 0.7, "F");
      lines.forEach((l, i) => { this.doc.text(l, M + 5, this.y + i * lh); }); this.y += lines.length * lh + 0.6;
    }
    this.y += 1;
  }
  box(title: string, lines: string[], tone: "info" | "warn" = "info") {
    const size = 9, lh = size * 0.46 + 0.9; this.font(size);
    const wrapped = lines.flatMap((l) => this.doc.splitTextToSize(l, R - M - 8) as string[]); const h = 9 + wrapped.length * lh;
    this.ensure(h + 2);
    this.doc.setFillColor(...(tone === "warn" ? [253, 244, 220] as [number, number, number] : [245, 245, 240] as [number, number, number])).roundedRect(M, this.y - 4, R - M, h, 2, 2, "F");
    this.font(9.5, true); this.doc.text(title, M + 4, this.y + 1); this.font(size);
    wrapped.forEach((l, i) => this.doc.text(l, M + 4, this.y + 6 + i * lh)); this.y += h + 2;
  }
  table(cols: { label: string; w: number; align?: "left" | "right" }[], rows: string[][], size = 9) {
    const lh = size * 0.46 + 1.4; let x: number[] = []; let acc = M; for (const c of cols) { x.push(acc); acc += c.w; }
    const head = () => { this.ensure(lh + 3); this.doc.setFillColor(...GOLD).rect(M, this.y - 4.2, R - M, lh + 1.6, "F"); this.font(size, true);
      cols.forEach((c, i) => this.doc.text(c.label, c.align === "right" ? x[i]! + c.w - 2 : x[i]! + 2, this.y, { align: c.align === "right" ? "right" : "left" })); this.y += lh + 1; };
    head();
    rows.forEach((r, ri) => {
      this.ensure(lh + 1); if (this.y === TOP) head();
      if (ri % 2) this.doc.setFillColor(247, 244, 232).rect(M, this.y - 4, R - M, lh, "F");
      this.font(size); cols.forEach((c, i) => this.doc.text(r[i] ?? "", c.align === "right" ? x[i]! + c.w - 2 : x[i]! + 2, this.y, { align: c.align === "right" ? "right" : "left" })); this.y += lh;
    });
    this.y += 3;
  }
}

function cover(w: Writer, now: Date) {
  const d = w.doc; d.setFillColor(...GOLD).rect(0, 0, W, 6, "F");
  d.setFont("helvetica", "bold").setFontSize(26).setTextColor(INK); d.text("Dogui Mart Pro", M, 70);
  d.setFontSize(20).text("Offres d'abonnement", M, 83);
  d.setFont("helvetica", "normal").setFontSize(12).setTextColor(MUTED); d.text("Fiches de création des offres sur Selar", M, 94);
  d.setFillColor(...GOLD).rect(M, 100, 30, 1.4, "F");
  d.setFontSize(11).setTextColor(INK); d.text("15 offres : 3 formules (Starter, Business, Pro)", M, 114); d.text("x 5 périodes (Jour, Semaine, Mensuel, Trimestre, Annuel)", M, 121);
  d.setFontSize(9.5).setTextColor(MUTED); d.text(`Document généré le ${now.toLocaleDateString("fr-FR")} à partir du catalogue de l'application.`, M, 140);
  d.text("Prix par défaut à valider avant publication.", M, 146);
  w.doc.addPage(); w.y = TOP;
}

function checklist(w: Writer) {
  w.h1("Avant de créer les offres");
  w.box("À vérifier en premier : la devise", ["Les prix de l'application sont en FCFA. Je n'ai pas pu vérifier que Selar accepte le FCFA pour votre compte. Si ce n'est pas le cas, les prix payés sur Selar ne correspondront plus à ceux de l'application et la validation des paiements deviendra ambiguë : ne créez pas les 15 offres avant d'avoir levé ce point."], "warn");
  w.bullets([
    "Créez 15 offres distinctes : une par ligne du tableau des tarifs. Chaque offre a son propre lien.",
    "Prix exact : chaque offre doit être au prix indiqué, au franc près. L'application affiche ce prix au client ; vous comparez ensuite avec la commande reçue dans Selar.",
    "Une offre = une période. Si Selar propose un choix de quantité, désactivez-le ou limitez-le à 1 : l'application n'accepte qu'une période par paiement.",
    "Copiez le nom, la description courte, la description détaillée et le message après achat de chaque fiche. Le nom exact des champs dans Selar peut différer : je n'ai pas pu consulter l'interface actuelle de Selar.",
    "Dans le message après achat, complétez les deux passages entre crochets : le délai d'activation que vous vous engagez à tenir et votre contact d'aide.",
    "Politique de remboursement : non couverte par ce document, à définir et à ajouter vous-même si besoin.",
    "Après création, copiez le lien public de chaque offre et envoyez-le avec sa clé (colonne « Clé » du tableau final).",
  ]);
  w.gap(2);
  w.h2("Ce qui est commun à toutes les formules");
  w.p("Toutes les formules donnent accès aux mêmes fonctions. Seules les limites (boutiques, utilisateurs, produits) changent.");
  w.bullets(COMMON_FEATURES, 9);
}

function plansTable(w: Writer, plans: Plan[]) {
  w.h1("Les trois formules");
  const aud: Record<string, string> = { starter: "Commerce de proximité, un point de vente", business: "Commerce qui grandit, plusieurs points de vente", pro: "Réseau de boutiques, grandes équipes" };
  w.table([{ label: "Formule", w: 28 }, { label: "Boutiques", w: 24, align: "right" }, { label: "Utilisateurs*", w: 28, align: "right" }, { label: "Produits", w: 26, align: "right" }, { label: "Pour qui", w: 76 }],
    plans.map((p) => [p.name, String(p.limits.maxShops), String(p.limits.maxUsers), p.limits.maxProducts < 0 ? "illimités" : p.limits.maxProducts.toLocaleString("fr-FR").replace(/[\u202f\u00a0]/g, " "), aud[p.id] ?? ""]));
  w.p("* Le propriétaire compte parmi les utilisateurs. Un compte employé désactivé libère une place.", { size: 8.5, color: MUTED });
  w.gap(2);
  w.h2("Tarifs (FCFA)");
  w.table([{ label: "Période", w: 30 }, { label: "Durée", w: 22, align: "right" }, ...plans.map((p) => ({ label: p.name, w: 30, align: "right" as const })), { label: "Délai de grâce", w: 30, align: "right" }],
    PERIODS.map((k) => [PERIOD_LABEL[k], k === "day" ? "1 jour" : `${{ week: 7, month: 30, quarter: 90, year: 365 }[k]} jours`, ...plans.map((p) => fcfa(p.prices[k]).replace(" FCFA", "")), GRACE_DAYS[k] === 0 ? "aucun" : `${GRACE_DAYS[k]} jour${GRACE_DAYS[k] > 1 ? "s" : ""}`]));
  w.p("Ces tarifs sont ceux par défaut de l'application. Ils sont à valider ; s'ils changent, régénérez ce document et modifiez le prix des offres Selar en conséquence.", { size: 8.5, color: MUTED });
}

function summary(w: Writer, offers: Offer[]) {
  w.h1("Récapitulatif des 15 offres");
  w.p("Économie : par rapport à la même formule payée avec la période immédiatement plus courte, en répétition.", { size: 8.5, color: MUTED });
  w.table([{ label: "#", w: 8 }, { label: "Formule", w: 24 }, { label: "Période", w: 26 }, { label: "Durée", w: 20, align: "right" }, { label: "Prix", w: 30, align: "right" }, { label: "Par jour", w: 26, align: "right" }, { label: "Économie", w: 38, align: "right" }],
    offers.map((o, i) => [String(i + 1), o.planName, o.periodLabel, `${o.durationDays} j`, fcfa(o.priceFcfa), fcfa(o.perDayFcfa), o.savingsPct ? `-${o.savingsPct} % vs ${({ week: "jour", month: "semaine", quarter: "mois", year: "mois" } as Record<string, string>)[o.period]}` : "tarif de base"]), 8.5);
}

function offerSheet(w: Writer, o: Offer, i: number) {
  w.doc.addPage(); w.y = TOP;
  w.doc.setFillColor(...GOLD).rect(M, w.y - 5, R - M, 9, "F");
  w.doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(INK); w.doc.text(`Offre ${i + 1} sur 15  -  ${o.planName} / ${o.periodLabel}`, M + 3, w.y + 1.2); w.y += 11;
  w.h3("Nom de l'offre"); w.p(o.name, { bold: true, size: 10.5 });
  w.table([{ label: "Prix", w: 50 }, { label: "Durée d'accès", w: 50 }, { label: "Clé de l'application", w: 78 }], [[fcfa(o.priceFcfa), `${o.durationDays} jour${o.durationDays > 1 ? "s" : ""}`, o.key]], 9);
  w.h3("Description courte"); w.p(o.shortDescription);
  w.h3("Description détaillée"); w.p(o.longDescription, { size: 8.5 });
  w.h3("Message après achat"); w.p(o.postPurchase, { size: 8.5 });
}

function internal(w: Writer, offers: Offer[]) {
  w.doc.addPage(); w.y = TOP;
  w.h1("À ne pas promettre dans les offres");
  w.p("Ces fonctions sont prévues mais ne sont pas disponibles aujourd'hui. Elles ne figurent dans aucune fiche ; ne les ajoutez pas aux descriptions.");
  w.bullets(NOT_AVAILABLE);
  w.gap(2);
  w.h1("Valider un paiement (procédure interne)");
  w.bullets([
    "Le client paie sur Selar, puis saisit dans l'application la référence de commande reçue par e-mail et l'e-mail utilisé. La demande apparaît dans Réglages > Plateforme > Paiements > À valider.",
    "Dans votre tableau de bord Selar, vérifiez trois choses : la commande existe, le montant est exactement celui de l'offre, l'e-mail correspond.",
    "Validez dans l'application : l'abonnement est activé. En cas de doute, refusez avec un motif (le client le voit).",
    "Une référence de commande ne peut servir qu'une fois sur toute la plateforme.",
    "Aucune vérification n'est automatique : Selar n'est pas relié à l'application par une API.",
  ]);
  w.gap(2);
  w.h1("Enregistrer les liens dans l'application");
  w.p("Quand les 15 offres existent, envoyez-moi la liste « clé : lien » ci-dessous (liens publics uniquement, jamais d'identifiants Selar). Vous pouvez aussi les saisir dans Réglages > Plateforme. Une combinaison sans lien reste grisée dans l'application.");
  w.table([{ label: "Clé", w: 36 }, { label: "Offre", w: 70 }, { label: "Lien Selar à renseigner", w: 72 }], offers.map((o) => [o.key, `${o.planName} / ${o.periodLabel}`, "https://"]), 8.5);
}

/** Construit le PDF complet des fiches d'offres Selar. */
export async function buildOffersPdf(now: Date = new Date(), plans: Plan[] = DEFAULT_PLANS): Promise<jsPDF> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" }); const w = new Writer(doc); const offers = buildOffers(plans);
  cover(w, now); checklist(w); w.doc.addPage(); w.y = TOP; plansTable(w, plans); w.gap(4); summary(w, offers);
  offers.forEach((o, i) => offerSheet(w, o, i)); internal(w, offers);
  const n = doc.getNumberOfPages();
  for (let p = 2; p <= n; p++) { doc.setPage(p); doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(150); doc.text(`Dogui Mart Pro - Offres Selar - page ${p - 1}/${n - 1}`, W / 2, 289, { align: "center" }); }
  return doc;
}
