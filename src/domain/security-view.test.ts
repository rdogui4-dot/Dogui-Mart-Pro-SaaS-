import { describe, expect, it } from "vitest";
import { CHECK_LINK, STATE_LABEL, STATE_TONE, filterEvents, journalReport, levelOf, type EventRow } from "./security-view";
import { toCsv } from "./exports";
import { parseDeepLink } from "./redirects";
import { evaluateStatus } from "./security-status";

const ev = (o: Partial<EventRow> = {}): EventRow => ({ seq: 1, at: "2026-11-21T10:00:00.000Z", kind: "staff.create", label: "Employé créé", severity: "info", outcome: "accepted", actorId: "u123456789", actorRole: "owner", target: "action:staff.create", requestId: "abc", source: "cloud", count: 1, lastAt: "2026-11-21T10:00:00.000Z", ...o });

describe("niveau de sécurité affiché", () => {
  it("sans score (aucun contrôle mesuré) : aucun niveau, jamais « Excellent » par défaut", () => { expect(levelOf(null)).toBeNull(); });
  it("seuils : 90+ Excellent, 75+ Bon, 50+ À renforcer, en dessous Critique", () => {
    expect(levelOf(100)?.label).toBe("Excellent"); expect(levelOf(90)?.label).toBe("Excellent"); expect(levelOf(89)?.label).toBe("Bon"); expect(levelOf(75)?.label).toBe("Bon"); expect(levelOf(74)?.label).toBe("À renforcer"); expect(levelOf(50)?.label).toBe("À renforcer"); expect(levelOf(49)).toMatchObject({ label: "Critique", tone: "bad" }); expect(levelOf(0)?.tone).toBe("bad");
  });
});

describe("états : étiquettes et tons", () => {
  it("« Inconnu » et « Sans objet » ne prennent jamais le ton « ok » ; seul « Conforme » est vert", () => {
    expect(STATE_TONE.unknown).toBe("muted"); expect(STATE_TONE.na).toBe("muted"); expect(STATE_TONE.ok).toBe("ok"); expect(STATE_TONE.watch).toBe("warn"); expect(STATE_TONE.critical).toBe("bad");
    expect(STATE_LABEL.unknown).toBe("Inconnu"); expect(STATE_LABEL.ok).toBe("Conforme");
  });
});

describe("liens de traitement des constats", () => {
  it("chaque lien pointe un onglet des paramètres qui existe", () => {
    for (const [id, l] of Object.entries(CHECK_LINK)) { expect(l.to, id).toBe("/reglages"); const t = parseDeepLink(`?onglet=${l.onglet}`, []).tab; expect(t, `${id} → ${l.onglet}`).toBeTruthy(); }
  });
  it("tout contrôle à traiter (sauf ceux du journal) a une page où le traiter", () => {
    const checks = evaluateStatus({ now: "2026-11-21T12:00:00Z", owners: [{ userId: "a", mfa: false }], subscription: null, host: null, journal: null, chain: null });
    for (const c of checks.filter((x) => ["mfa_owner", "subscription", "sync", "backups", "conflicts"].includes(x.id))) expect(CHECK_LINK[c.id], c.id).toBeTruthy();
  });
});

describe("journal : filtres et export", () => {
  const rows = [ev(), ev({ seq: 2, kind: "access.denied.forbidden", label: "Action refusée : droits insuffisants", severity: "warning", outcome: "denied", actorRole: "cashier", actorId: "caissier99", target: "action:staff.create" }), ev({ seq: 3, kind: "host.claim", label: "Un poste devient la référence du commerce", severity: "warning", source: "poste", count: 12 })];
  it("filtre par type, gravité et recherche (événement, compte, cible, requête)", () => {
    expect(filterEvents(rows, { kind: "", severity: "", q: "" })).toHaveLength(3); expect(filterEvents(rows, { kind: "staff.create", severity: "", q: "" })).toHaveLength(1);
    expect(filterEvents(rows, { kind: "", severity: "warning", q: "" })).toHaveLength(2); expect(filterEvents(rows, { kind: "", severity: "", q: "CAISSIER" })).toHaveLength(1); expect(filterEvents(rows, { kind: "", severity: "", q: "abc" })).toHaveLength(3); expect(filterEvents(rows, { kind: "x", severity: "", q: "" })).toHaveLength(0);
  });
  it("l'export reprend exactement les lignes affichées, les filtres, l'état de la chaîne et les limites", () => {
    const shown = filterEvents(rows, { kind: "", severity: "warning", q: "" }); const r = journalReport(shown, { ok: true, checked: 3, fromStart: true, problems: [] }, { kind: "", severity: "warning", q: "" }, new Date("2026-11-22T08:00:00Z"), "Commerce Test");
    expect(r.sections[0]!.rows).toHaveLength(2); expect(r.filters.gravite).toEqual(["Avertissement"]); expect(r.notes.join(" ")).toMatch(/Chaîne d'empreintes vérifiée : 3 événement/); expect(r.notes.join(" ")).toMatch(/Aucun texte libre/);
    const csv = toCsv(r); expect(csv).toContain("Journal de sécurité"); expect(csv).toContain("Action refusée"); expect(csv).not.toContain("Employé créé"); expect(csv).toContain("×".length ? "Répétitions" : ""); expect(csv).toContain("Poste"); expect(r.period.from).toBe("2026-11-21");
  });
  it("chaîne rompue : l'export le dit en toutes lettres (jamais un journal « propre » exporté sans avertissement)", () => {
    const r = journalReport(rows, { ok: false, checked: 2, fromStart: false, problems: ["rupture : n°2 absent"] }, { kind: "", severity: "", q: "" }, new Date(), "C"); expect(r.notes[0]).toMatch(/ATTENTION — chaîne rompue : rupture : n°2 absent/);
    expect(journalReport(rows, null, { kind: "", severity: "", q: "" }, new Date(), "C").notes[0]).toBe("Chaîne non vérifiée.");
  });
  it("journal vide : export sans plantage (dates du jour)", () => { const r = journalReport([], null, { kind: "", severity: "", q: "" }, new Date("2026-11-22T08:00:00Z"), "C"); expect(r.sections[0]!.rows).toHaveLength(0); expect(r.period).toEqual({ from: "2026-11-22", to: "2026-11-22" }); });
});
