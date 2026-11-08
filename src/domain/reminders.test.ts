import { describe, expect, it } from "vitest";
import { bannerMessage, reminderLevel, renewalMessage, timeLeftLabel, whatsappNumber } from "./reminders";
import { entitlement, DEFAULT_PLANS, type Period, type Sub } from "./subscriptions";

const NOW = new Date("2026-06-01T12:00:00Z");
const at = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString();
const ent = (period: Period, days: number, status: Sub["status"] = "paid") => entitlement({ plan: "business", period, status, renewsAt: at(days) }, DEFAULT_PLANS, NOW);

describe("paliers de relance selon la période", () => {
  it("mensuel et plus : J-7, J-3, J-1", () => {
    for (const p of ["month", "quarter", "year"] as const) {
      expect(reminderLevel(ent(p, 20), NOW), p).toBe("none");
      expect(reminderLevel(ent(p, 6.5), NOW)).toBe("info"); expect(reminderLevel(ent(p, 2.5), NOW)).toBe("warning"); expect(reminderLevel(ent(p, 0.9), NOW)).toBe("urgent");
    }
  });
  it("semaine : J-3, J-2, J-1 ; jour : seulement dans les dernières heures", () => {
    expect(reminderLevel(ent("week", 4), NOW)).toBe("none"); expect(reminderLevel(ent("week", 2.9), NOW)).toBe("info"); expect(reminderLevel(ent("week", 1.9), NOW)).toBe("warning"); expect(reminderLevel(ent("week", 0.9), NOW)).toBe("urgent");
    expect(reminderLevel(ent("day", 0.9), NOW)).toBe("none"); expect(reminderLevel(ent("day", 0.4), NOW)).toBe("info"); expect(reminderLevel(ent("day", 0.2), NOW)).toBe("warning"); expect(reminderLevel(ent("day", 0.05), NOW)).toBe("urgent");
  });
  it("un essai est relancé comme un mensuel (conversion)", () => {
    expect(reminderLevel(ent("day", 6, "trial"), NOW)).toBe("info"); expect(reminderLevel(ent("day", 20, "trial"), NOW)).toBe("none");
  });
  it("échu : délai de grâce puis lecture seule", () => {
    expect(reminderLevel(ent("month", -1), NOW)).toBe("grace"); expect(reminderLevel(ent("month", -10), NOW)).toBe("locked"); expect(reminderLevel(ent("day", -0.1), NOW)).toBe("locked");
  });
});

describe("message dans l'application", () => {
  it("rien à afficher loin de l'échéance", () => { expect(bannerMessage(ent("month", 30), true, NOW)).toBeNull(); });
  it("propriétaire : renvoie vers Réglages ; employé : prévenir le propriétaire", () => {
    expect(bannerMessage(ent("month", 2), true, NOW)!.text).toMatch(/dans 2 jour\(s\).*Réglages → Abonnement/);
    expect(bannerMessage(ent("month", 2), false, NOW)!.text).toMatch(/Prévenez le propriétaire/);
    expect(bannerMessage(ent("month", 2), false, NOW)!.text).not.toMatch(/Réglages/);
  });
  it("heures restantes pour un abonnement jour, essai nommé comme tel, lecture seule", () => {
    expect(bannerMessage(ent("day", 0.2), true, NOW)!.text).toMatch(/dans 5 h/);
    expect(bannerMessage(ent("day", 5, "trial"), true, NOW)!.text).toMatch(/^Votre essai gratuit/);
    const l = bannerMessage(ent("month", -10), true, NOW)!; expect(l.level).toBe("locked"); expect(l.text).toMatch(/lecture seule/);
    expect(timeLeftLabel(-5)).toBe("expiré"); expect(timeLeftLabel(36 * 3_600_000)).toBe("2 jour(s)");
  });
});

describe("message de relance pour la plateforme", () => {
  const base = { shopName: "Chez Awa", ownerName: "Awa", planName: "Business", period: "month" as Period, trial: false };
  it("rédige selon l'état", () => {
    const soon = renewalMessage({ ...base, state: "expiring", endsAt: at(2) }, NOW);
    expect(soon).toMatch(/^Bonjour Awa,/); expect(soon).toMatch(/Dogui Mart Pro \(Business, mensuel\) se termine dans 2 jour\(s\)/); expect(soon).toMatch(/Selar/);
    expect(renewalMessage({ ...base, state: "locked", endsAt: at(-10) }, NOW)).toMatch(/Chez Awa est en lecture seule/);
    expect(renewalMessage({ ...base, trial: true, state: "grace", endsAt: at(-1) }, NOW)).toMatch(/Votre essai gratuit de Dogui Mart Pro est terminé.*délai de grâce/);
    expect(renewalMessage({ ...base, ownerName: undefined, state: "expiring", endsAt: at(1) }, NOW)).toMatch(/^Bonjour,/);
  });
});

describe("numéro WhatsApp", () => {
  it("gère +, 00, indicatif par défaut, et refuse de deviner", () => {
    expect(whatsappNumber("+221 77 123 45 67")).toBe("221771234567");
    expect(whatsappNumber("00221771234567")).toBe("221771234567");
    expect(whatsappNumber("77 123 45 67", "221")).toBe("221771234567");
    expect(whatsappNumber("077 123 45 67", "+221")).toBe("221771234567");
    expect(whatsappNumber("77 123 45 67")).toBeNull(); // pas d'indicatif : on ne devine pas
    expect(whatsappNumber("")).toBeNull(); expect(whatsappNumber(undefined, "221")).toBeNull(); expect(whatsappNumber("12", "221")).toBeNull();
    expect(whatsappNumber("+1234567890123456")).toBeNull();
  });
});
