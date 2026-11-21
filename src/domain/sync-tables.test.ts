import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PULLED_TABLES, PUSHED_TABLES, SYNC_CLASS_OF, syncClass } from "./sync-tables";

const schemaTables = [...readFileSync(new URL("../../scripts/schema.mjs", import.meta.url), "utf8").matchAll(/^  ([a-z_0-9]+): \{ cols/gm)].map((m) => m[1]!);
describe("classement des tables pour la synchronisation", () => {
  it("toutes les tables du schéma sont classées, et seulement celles-là", () => {
    expect(Object.keys(SYNC_CLASS_OF).sort()).toEqual([...new Set(schemaTables)].sort());
  });
  it("l'exploitation reste sur le poste ; l'abonnement et la licence viennent du cloud ; catalogue et réglages sont partagés", () => {
    for (const t of ["sales", "stock_moves", "cash_sessions", "journal_entries", "customers", "article_serials", "audit_log", "sale_returns"]) expect(syncClass(t)).toBe("local");
    for (const t of ["subscriptions", "subscription_payments", "platform_settings", "md_licenses", "md_payments"]) expect(syncClass(t)).toBe("cloud");
    for (const t of ["products", "shops", "suppliers", "article_variants", "payment_settings"]) expect(syncClass(t)).toBe("shared"); expect(syncClass("inconnue")).toBeNull();
  });
  it("le poste n'envoie jamais une table du cloud ; il ne reçoit jamais une table locale", () => {
    expect(PUSHED_TABLES.some((t) => SYNC_CLASS_OF[t] === "cloud")).toBe(false); expect(PULLED_TABLES.some((t) => SYNC_CLASS_OF[t] === "local")).toBe(false);
    expect(PUSHED_TABLES).toContain("products"); expect(PULLED_TABLES).toContain("products"); expect(PULLED_TABLES).toContain("subscriptions");
  });
});
