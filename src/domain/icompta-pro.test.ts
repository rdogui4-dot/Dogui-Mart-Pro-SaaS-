import { describe, expect, it } from "vitest";
import { applyMap, approvalStep, axisTotals, checkAsset, checkMap, classTotals, disposalLines, dueAmortizations, nextLetter, requiredApprovals, schedule, letterError, type Approval } from "./icompta-pro";
import { canonLines, checkLines } from "./icompta";

const at = "2026-01-01T00:00:00Z"; const rule = { twoFrom: 100_000, requireOwner: false };
const step = (role: "owner" | "manager", user: string, approvals: Approval[] = [], total = 150_000, r = rule, creator = "c") => approvalStep({ role, creator, user, approvals, total, rule: r, at });

describe("double approbation", () => {
  it("une seule approbation sous le seuil ou sans seuil", () => { expect(requiredApprovals(99_999, rule)).toBe(1); expect(requiredApprovals(100_000, rule)).toBe(2); expect(requiredApprovals(1e9, { twoFrom: 0, requireOwner: false })).toBe(1); expect(requiredApprovals(1e9)).toBe(1); });
  it("deux approbateurs distincts requis", () => { const a = step("manager", "m1"); expect(a.final).toBe(false); expect(a.next).toHaveLength(1); const b = step("manager", "m2", a.next); expect(b.final).toBe(true); });
  it("le même approbateur ne compte qu'une fois", () => { const a = step("manager", "m1"); const again = step("manager", "m1", a.next); expect(again.duplicate).toBe(true); expect(again.final).toBe(false); });
  it("l'auteur non propriétaire ne peut pas approuver ; l'auteur propriétaire oui mais signalé", () => { expect(step("manager", "c").ok).toBe(false); const o = step("owner", "c"); expect(o.ok).toBe(true); expect(o.self).toBe(true); expect(step("manager", "m1", o.next).final).toBe(true); });
  it("exige un propriétaire si demandé", () => { const r = { twoFrom: 100_000, requireOwner: true }; const a = step("manager", "m1", [], 150_000, r); const b = step("manager", "m2", a.next, 150_000, r); expect(b.final).toBe(false); expect(step("owner", "o", b.next, 150_000, r).final).toBe(true); });
  it("employé refusé", () => expect(approvalStep({ role: "other", creator: "c", user: "u", approvals: [], total: 1, at }).ok).toBe(false));
});

describe("amortissement linéaire", () => {
  const a = { cost: 1_000_000, residual: 100_000, months: 7, startOn: "2026-03-15", convention: "same" as const };
  it("somme exacte, reliquat sur la dernière mensualité", () => { const p = schedule(a); expect(p).toHaveLength(7); expect(p.reduce((s, x) => s + x.amount, 0)).toBe(900_000); expect(p[0]).toEqual({ period: "2026-03", amount: 128_571 }); expect(p[6]).toEqual({ period: "2026-09", amount: 900_000 - 128_571 * 6 }); });
  it("convention « mois suivant » décale d'un mois et passe l'année", () => { expect(schedule({ ...a, startOn: "2026-12-31", convention: "next", months: 2 }).map((x) => x.period)).toEqual(["2027-01", "2027-02"]); });
  it("contrôle des paramètres : aucune durée ni convention présumée", () => { expect(checkAsset({ cost: 100, residual: 100, months: 0, startOn: "x" })).toHaveLength(4); expect(checkAsset(a)).toEqual([]); });
  it("échéances dues non comptabilisées", () => { const p = schedule(a); expect(dueAmortizations(p, new Set(["2026-03"]), "2026-05").map((x) => x.period)).toEqual(["2026-04", "2026-05"]); });
});

describe("cession", () => {
  const acc = { asset: "241", depr: "2841", proceeds: "521", result: "771" };
  it("perte : débit résultat, équilibré", () => { const r = disposalLines({ cost: 1000, cumulated: 400, proceeds: 300, accounts: acc }); expect(r.result).toBe(-300); expect(r.lines.reduce((s, l) => s + l.debit - l.credit, 0)).toBe(0); expect(r.lines.find((l) => l.account === "771")).toMatchObject({ debit: 300 }); });
  it("gain : crédit résultat", () => { const r = disposalLines({ cost: 1000, cumulated: 400, proceeds: 900, accounts: acc }); expect(r.result).toBe(300); expect(r.lines.reduce((s, l) => s + l.debit - l.credit, 0)).toBe(0); });
  it("compte manquant : aucune écriture inventée", () => { const r = disposalLines({ cost: 1000, cumulated: 0, proceeds: 0, accounts: { ...acc, result: "" } }); expect(r.lines).toEqual([]); expect(r.errors.length).toBeGreaterThan(0); });
});

describe("lettrage", () => {
  it("lettres successives", () => { expect(nextLetter([])).toBe("A"); expect(nextLetter(["A", "B"])).toBe("C"); expect(nextLetter(["Z"])).toBe("AA"); expect(nextLetter(["AZ"])).toBe("BA"); });
  it("facture lettrable seulement si soldée et non lettrée", () => { expect(letterError({ id: "i", total: 10, paid: 10, status: "paid" }, false)).toBe(""); expect(letterError({ id: "i", total: 10, paid: 4, status: "unpaid" }, false)).toMatch(/non soldée/); expect(letterError({ id: "i", total: 10, paid: 10, status: "paid" }, true)).toMatch(/déjà/); expect(letterError(undefined, false)).toMatch(/introuvable/); });
});

describe("résultat et correspondance", () => {
  const rows = [{ account: "601", debit: 500, credit: 0 }, { account: "701", debit: 0, credit: 900 }, { account: "521", debit: 400, credit: 0 }, { account: "9999", debit: 1, credit: 0 }];
  it("résultat provisoire = produits − charges", () => { const t = classTotals(rows); expect(t.charges).toBe(500); expect(t.produits).toBe(900); expect(t.result).toBe(400); });
  it("préfixe le plus long, comptes non rattachés listés", () => { const m = checkMap([{ section: "income", label: "Achats", prefixes: ["6"], sign: "debit" }, { section: "income", label: "Marchandises", prefixes: ["601"], sign: "debit" }, { section: "assets", label: "Banque", prefixes: ["52"], sign: "debit" }]); expect(m.ok).toBe(true); const r = applyMap(rows, m.map); expect(r.lines[1]!.amount).toBe(500); expect(r.lines[0]!.amount).toBe(0); expect(r.lines[2]!.amount).toBe(400); expect(r.unmapped).toEqual(["701", "9999"]); });
  it("correspondance invalide refusée", () => { expect(checkMap([{ section: "x", label: "", prefixes: ["a"], sign: "?" }]).ok).toBe(false); });
});

describe("analytique et compatibilité des empreintes", () => {
  it("totaux par axe", () => { const t = axisTotals([{ account: "601", debit: 100, credit: 0, act: "A" }, { account: "701", debit: 0, credit: 250, act: "A" }, { account: "601", debit: 40, credit: 0 }, { account: "521", debit: 5, credit: 0 }], "act"); expect(t).toEqual([{ code: "(sans axe)", charges: 40, produits: 0, result: -40 }, { code: "A", charges: 100, produits: 250, result: 150 }]); });
  it("la forme canonique n'inclut les axes que s'ils existent (empreintes existantes intactes)", () => { expect(canonLines([{ account: "601", debit: 1, credit: 0 }])).toBe('[["601",1,0,""]]'); expect(canonLines([{ account: "601", debit: 1, credit: 0, act: "A" }])).toBe('[["601",1,0,"","A",""]]'); });
  it("étiquettes analytiques validées", () => { const act = new Set(["601", "521"]); expect(checkLines([{ account: "601", debit: 5, credit: 0, act: "A-1" }, { account: "521", debit: 0, credit: 5 }], act).lines[0]!.act).toBe("A-1"); expect(checkLines([{ account: "601", debit: 5, credit: 0, act: "a b" }, { account: "521", debit: 0, credit: 5 }], act).ok).toBe(false); });
});
