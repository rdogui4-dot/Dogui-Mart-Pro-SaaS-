import { describe, expect, it } from "vitest";
import { crc32, safeFileName, safeText, toCsv, toXlsx, type ReportData } from "./exports";

const R: ReportData = { title: "Rapport commercial", generatedAt: "2026-11-10T08:00:00Z", tz: "Africa/Dakar", period: { from: "2026-11-01", to: "2026-11-10" }, scope: ["Dakar", "Thiès"], filters: { categories: ["Boissons"] }, notes: ["CA = ventes terminées."],
  sections: [{ name: "Par article", columns: ["Article", "CA TTC", "Marge %"], rows: [["Eau; \"grande\"", 1500, 40.5], ["=CMD()", 200, null]] }, { name: "Par article", columns: ["X"], rows: [] }] };
/** Lecture minimale d'un ZIP « stored » : vérifie noms, tailles et CRC. */
function unzip(b: Uint8Array): Map<string, string> { const dv = new DataView(b.buffer, b.byteOffset); const out = new Map<string, string>(); let p = 0; while (dv.getUint32(p, true) === 0x04034b50) { const crc = dv.getUint32(p + 14, true), size = dv.getUint32(p + 18, true), nl = dv.getUint16(p + 26, true), el = dv.getUint16(p + 28, true); const name = new TextDecoder().decode(b.slice(p + 30, p + 30 + nl)); const data = b.slice(p + 30 + nl + el, p + 30 + nl + el + size); expect(crc32(data), name).toBe(crc); out.set(name, new TextDecoder().decode(data)); p += 30 + nl + el + size; } expect(dv.getUint32(p, true)).toBe(0x02014b50); return out; }

describe("exports", () => {
  it("CSV : BOM, séparateur ;, décimale française, guillemets, en-tête de filtres, protection des formules", () => {
    const c = toCsv(R); expect(c.charCodeAt(0)).toBe(0xfeff); expect(c).toContain("Période;2026-11-01 → 2026-11-10 (fuseau Africa/Dakar)"); expect(c).toContain("Magasins;Dakar, Thiès"); expect(c).toContain("Filtres;Catégories : Boissons");
    expect(c).toContain('"Eau; ""grande""";1500;40,5'); expect(c).toContain("'=CMD();200;"); expect(c).toContain("Méthodes et limites\r\nCA = ventes terminées."); expect(c.split("\r\n").filter((l) => l.startsWith("Article;CA TTC"))).toHaveLength(1);
  });
  it("XLSX : archive valide (CRC), classeur, styles, feuille Informations puis une feuille par section (noms uniques), nombres numériques, texte échappé", () => {
    const files = unzip(toXlsx(R)); expect([...files.keys()]).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "xl/worksheets/sheet3.xml"]);
    expect(files.get("xl/workbook.xml")).toContain('name="Informations"'); expect(files.get("xl/workbook.xml")).toContain('name="Par article"'); expect(files.get("xl/workbook.xml")).toContain('name="Par article 2"');
    const s2 = files.get("xl/worksheets/sheet2.xml")!; expect(s2).toContain('<c r="B2"><v>1500</v></c>'); expect(s2).toContain('<c r="C2"><v>40.5</v></c>'); expect(s2).toContain("Eau; &quot;grande&quot;"); expect(s2).toContain("&apos;=CMD()"); expect(s2).not.toContain('r="C3"'); expect(s2).toContain('s="1"'); expect(files.get("xl/worksheets/sheet1.xml")).toContain("CA = ventes terminées.");
  });
  it("noms de fichiers sûrs ; protection des formules ; CRC32 connu", () => { expect(safeFileName(R, "pdf")).toBe("rapport-commercial_2026-11-01_2026-11-10.pdf"); expect(safeText("+1")).toBe("'+1"); expect(safeText("Eau")).toBe("Eau"); expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926); });
});
