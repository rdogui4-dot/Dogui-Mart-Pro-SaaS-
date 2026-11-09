/** Exports de rapports : CSV (Excel FR : séparateur « ; », BOM UTF-8) et XLSX (classeur Office Open XML sans dépendance externe). Fonctions pures, testées. */
export type Cell = string | number | null;
export type Section = { name: string; columns: string[]; rows: Cell[][] };
export type ReportData = { title: string; generatedAt: string; tz: string; period: { from: string; to: string }; scope: string[]; filters: Record<string, string[]>; notes: string[]; sections: Section[] };

export const FILTER_LABEL: Record<string, string> = { categories: "Catégories", articles: "Articles", suppliers: "Fournisseurs", sellers: "Vendeurs", shops: "Magasins", methods: "Modes de paiement" };
/** Lignes d'en-tête communes (titre, période, magasins, filtres, date de génération) : les exports reflètent exactement les filtres appliqués. */
export function metaLines(r: ReportData): [string, string][] {
  const f = Object.entries(r.filters).map(([k, v]) => `${FILTER_LABEL[k] ?? k} : ${v.join(", ")}`).join(" · ") || "Aucun";
  return [["Rapport", r.title], ["Période", `${r.period.from} → ${r.period.to} (fuseau ${r.tz})`], ["Magasins", r.scope.join(", ")], ["Filtres", f], ["Généré le", r.generatedAt]];
}

/** Neutralise l'injection de formule (=, +, -, @ en début de texte) à l'ouverture dans un tableur. */
export const safeText = (s: string): string => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);
const csvCell = (c: Cell): string => { if (c === null || c === undefined) return ""; if (typeof c === "number") return String(c).replace(".", ","); const t = safeText(c); return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
export function toCsv(r: ReportData): string {
  const lines: string[] = []; for (const [k, v] of metaLines(r)) lines.push([csvCell(k), csvCell(v)].join(";")); lines.push("");
  for (const s of r.sections) { lines.push(csvCell(s.name)); lines.push(s.columns.map(csvCell).join(";")); for (const row of s.rows) lines.push(row.map(csvCell).join(";")); lines.push(""); }
  if (r.notes.length) { lines.push("Méthodes et limites"); for (const n of r.notes) lines.push(csvCell(n)); }
  return `﻿${lines.join("\r\n")}\r\n`;
}

// ---- ZIP (stockage sans compression) + XLSX
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export const crc32 = (b: Uint8Array): number => { let c = 0xffffffff; for (const x of b) c = CRC_T[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const enc = new TextEncoder();
export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [], central: Uint8Array[] = []; let off = 0;
  const u16 = (v: number) => [v & 255, (v >>> 8) & 255], u32 = (v: number) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  for (const f of files) { const name = enc.encode(f.name), crc = crc32(f.data), n = f.data.length;
    const local = new Uint8Array([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(n), ...u32(n), ...u16(name.length), ...u16(0), ...name]);
    parts.push(local, f.data); central.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(n), ...u32(n), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off), ...name])); off += local.length + n; }
  const cd = central.reduce((a, c) => a + c.length, 0); const end = new Uint8Array([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cd), ...u32(off), ...u16(0)]);
  const out = new Uint8Array(off + cd + end.length); let p = 0; for (const x of [...parts, ...central, end]) { out.set(x, p); p += x.length; } return out;
}
const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const colName = (i: number): string => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const sheetName = (raw: string, used: Set<string>): string => { let n = raw.replace(/[\[\]\*\?\/\\:]/g, " ").trim().slice(0, 31) || "Feuille"; let k = 2; const base = n; while (used.has(n.toLowerCase())) n = `${base.slice(0, 28)} ${k++}`; used.add(n.toLowerCase()); return n; };
const cell = (c: Cell, ref: string, bold = false): string => (c === null || c === undefined || c === "" ? "" : typeof c === "number" && Number.isFinite(c) ? `<c r="${ref}"${bold ? ' s="1"' : ""}><v>${c}</v></c>` : `<c r="${ref}" t="inlineStr"${bold ? ' s="1"' : ""}><is><t xml:space="preserve">${esc(safeText(String(c)))}</t></is></c>`);
function sheetXml(rows: Cell[][], headerRow: number | null): string {
  const widths: number[] = []; for (const r of rows) r.forEach((c, i) => { widths[i] = Math.min(60, Math.max(widths[i] ?? 8, String(c ?? "").length + 2)); });
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows.map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => cell(c, `${colName(ci)}${ri + 1}`, ri === headerRow)).join("")}</row>`).join("")}</sheetData></worksheet>`;
}
/** Classeur XLSX : une feuille « Informations » (en-tête, filtres, méthodes) puis une feuille par section. Nombres numériques (calculables dans Excel), textes protégés contre l'injection de formule. */
export function toXlsx(r: ReportData): Uint8Array {
  const used = new Set<string>(); const sheets: { name: string; xml: string }[] = [];
  sheets.push({ name: sheetName("Informations", used), xml: sheetXml([...metaLines(r).map(([k, v]) => [k, v] as Cell[]), [], ...(r.notes.length ? [["Méthodes et limites"] as Cell[], ...r.notes.map((n) => [n] as Cell[])] : [])], null) });
  for (const s of r.sections) sheets.push({ name: sheetName(s.name, used), xml: sheetXml([s.columns, ...s.rows], 0) });
  const files = [
    { name: "[Content_Types].xml", x: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", x: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", x: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", x: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", x: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, x: s.xml })),
  ];
  return zipStore(files.map((f) => ({ name: f.name, data: enc.encode(f.x) })));
}
export const safeFileName = (r: ReportData, ext: string): string => `${r.title.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase()}_${r.period.from}_${r.period.to}.${ext}`;
