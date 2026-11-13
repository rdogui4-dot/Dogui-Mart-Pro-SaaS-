import { describe, expect, it } from "vitest";
import { toCsv, toXlsx, safeFileName } from "./exports";
import { answerToData, recosToData, reportToData, type RecoRow } from "./master-export";
import type { Report } from "./master-report";
import type { Answer } from "./master-chat";

const REP: Report = { type: "closing", title: "Rapport de clôture — Dakar", businessDate: "2026-03-10", period: { from: "2026-03-10T08:00:00Z", to: "2026-03-10T18:00:00Z" }, scope: "Dakar · caisse de Awa", sections: [
  { id: "ventes", title: "Ventes", source: "Caisse", available: true, items: [{ label: "Nombre de ventes", value: 4 }, { label: "Total (FCFA)", value: 6000, note: "hors remboursements" }] }, { id: "marge", title: "Marge", source: "Articles", available: false, reason: "coût manquant", items: [] }],
  alerts: [{ prio: "critical", text: "Écart de caisse de -500 FCFA", source: "Caisse" }], recommendations: [{ prio: "high", text: "Vérifier le comptage", reason: "écart hors tolérance", source: "Caisse", status: "nouvelle", kind: "fact" }], missing: [{ section: "Marge", reason: "coût manquant" }], method: "Somme des ventes encaissées", limits: ["Marge non calculée"], confidence: "Confiance moyenne" };
const ANS: Answer = { qid: "sales", title: "Ventes", conclusion: "3 ventes pour 9 000 FCFA.", period: { from: "2026-03-04", to: "2026-03-10", label: "7 derniers jours" }, scope: "Dakar", facts: [{ label: "Nombre de ventes", value: 3 }, { label: "Total (FCFA)", value: 9000 }], sources: [{ module: "Caisse", detail: "ventes" }], method: "Somme", observations: ["• Variation : +100 %."], limits: ["Marge non calculée"], confidence: "high", recommendations: ["Relancer les clients"], ai: { used: true, model: "m-1", prompt: "w1" } };

describe("exports MASTER DOGUI (CSV / Excel / PDF : modèle commun)", () => {
  it("rapport : sections, alertes, recommandations, données manquantes ; section indisponible exportée avec sa raison", () => {
    const d = reportToData(REP, { statusLabel: "Partiel", version: 2, generatedAt: "2026-03-10T18:05:00Z", tz: "Africa/Abidjan" }); expect(d.sections.map((s) => s.name)).toEqual(["Ventes", "Marge", "Alertes", "Recommandations", "Données manquantes"]); expect(d.sections[0]!.rows[1]).toEqual(["Total (FCFA)", 6000, "hors remboursements", "Caisse"]); expect(d.sections[1]!.rows[0]).toEqual(["Section indisponible", "coût manquant"]); expect(d.sections[2]!.rows[0]![0]).toBe("Critique");
    expect(d.period).toEqual({ from: "2026-03-10", to: "2026-03-10" }); expect(d.notes[0]).toContain("Partiel (version 2)"); expect(d.generatedAt).toBe("2026-03-10 18:05"); expect(d.tz).toBe("Africa/Abidjan");
  });
  it("CSV : séparateur « ; », BOM, nombres à virgule, injection de formule neutralisée", () => {
    const d = reportToData({ ...REP, sections: [{ id: "x", title: "S", source: "src", available: true, items: [{ label: "=CMD()", value: 12.5 }, { label: "Avec ; point-virgule", value: "ok" }] }] }); const csv = toCsv(d); expect(csv.charCodeAt(0)).toBe(0xfeff); expect(csv).toContain("'=CMD();12,5;;src"); expect(csv).toContain('"Avec ; point-virgule";ok'); expect(csv).toContain("Méthodes et limites");
  });
  it("Excel : classeur valide (ZIP « PK »), une feuille par section ; nom de fichier sûr", () => {
    const d = answerToData(ANS, "Quelles sont mes ventes ?"); const x = toXlsx(d); expect(String.fromCharCode(x[0]!, x[1]!)).toBe("PK"); expect(x.length).toBeGreaterThan(500); expect(safeFileName(d, "xlsx")).toBe("assistant-ventes_2026-03-04_2026-03-10.xlsx");
  });
  it("assistant : chiffres, observations sans puce, recommandations, sources ; mode IA ou « sans IA » indiqué ; question conservée", () => {
    const d = answerToData(ANS, "Quelles sont mes ventes ?"); expect(d.sections.map((s) => s.name)).toEqual(["Chiffres", "Observations", "Recommandations", "Sources"]); expect(d.sections[1]!.rows[0]).toEqual(["Variation : +100 %."]); expect(d.filters.question).toEqual(["Quelles sont mes ventes ?"]); expect(d.notes.join(" ")).toContain("Rédaction par IA (m-1, prompt w1)");
    expect(answerToData({ ...ANS, ai: { used: false } }, "q").notes.join(" ")).toContain("sans IA"); expect(answerToData({ ...ANS, period: null, observations: [], recommendations: [] }, "q").sections.map((s) => s.name)).toEqual(["Chiffres", "Sources"]);
  });
  it("recommandations : une ligne par recommandation avec statut, motif, suivi ; filtre indiqué", () => {
    const rows: RecoRow[] = [{ title: "Rupture", rule: "Rupture", module: "Stock", shopName: "", prio: "critical", reason: "3 articles", statusLabel: "Nouvelle", confidenceLabel: "Confiance élevée", kind: "fact", createdAt: "2026-03-01T10:00:00Z", statusAt: "2026-03-02T10:00:00Z", note: "", limits: "", followUp: { text: "4 -> 1" } }];
    const d = recosToData(rows, { scope: "Entreprise", filter: "Nouvelle" }); expect(d.sections[0]!.rows[0]).toEqual(["Critique", "Rupture", "Rupture", "Stock", "Entreprise", "3 articles", "Nouvelle", "Confiance élevée", "Fait constaté", "2026-03-01", "2026-03-02", "", "", "4 -> 1"]); expect(d.filters).toEqual({ statut: ["Nouvelle"] }); expect(recosToData([], { scope: "x", filter: "" }).filters).toEqual({});
  });
});
