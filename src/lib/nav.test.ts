import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/appwrite", () => ({ client: {}, account: {}, teams: {}, tables: {}, storage: {}, functions: {}, ID: { unique: () => "x" }, Query: {}, DATABASE_ID: "dmp", realtime: {} })); // la navigation ne parle pas au serveur
import { KIT_MODULES, activeModuleId, kitModulesFor } from "./nav";
import { modulesFor } from "@/domain/access";

const owner = { role: "owner" as const, modules: [] };
const cashier = { role: "cashier" as const, modules: modulesFor("cashier") };

describe("navigation plate du kit (K1)", () => {
  it("17 modules, noms et ordre des maquettes", () => {
    expect(KIT_MODULES.map((m) => m.label)).toEqual(["Tableau de bord", "Caisse (Ventes)", "Articles & Catalogue", "Stocks & Inventaires", "Inventaires (Silent Count)", "Achats & Fournisseurs", "Dépenses", "Clients (CRM)", "Finance (FinI)", "ICompta", "IProj-Invest", "Rapports & Analyses", "MASTER DOGUI", "Promotions & Offres", "Équipe & Permissions", "Paramètres", "Abonnement & Facturation"]);
  });
  it("propriétaire Pro : tous les modules", () => { expect(kitModulesFor(owner, "pro")).toHaveLength(17); });
  it("formule Starter : les modules hors formule ne sont pas proposés", () => {
    const ids = kitModulesFor(owner, "starter").map((m) => m.id);
    expect(ids).not.toContain("reports"); expect(ids).not.toContain("articles"); expect(ids).not.toContain("expenses");
  });
  it("caissier : ni paramètres, ni équipe, ni abonnement, ni MASTER ; tableau de bord → accueil sans droit aux rapports", () => {
    const ms = kitModulesFor(cashier, "pro"); const ids = ms.map((m) => m.id);
    for (const x of ["settings", "team", "billing", "master"]) expect(ids).not.toContain(x);
    expect(ids).toContain("pos");
    const dash = ms.find((m) => m.id === "dashboard"); if (dash) expect(dash.to).toBe(cashier.modules.includes("reports") ? "/activite" : "/accueil");
  });
  it("module actif : Équipe et Abonnement distingués de Paramètres par l'onglet ; sous-pages rattachées", () => {
    expect(activeModuleId("/reglages", "?onglet=equipe")).toBe("team");
    expect(activeModuleId("/reglages", "?onglet=abonnement")).toBe("billing");
    expect(activeModuleId("/reglages", "")).toBe("settings");
    expect(activeModuleId("/caisse-pro", "")).toBe("pos");
    expect(activeModuleId("/bundles", "")).toBe("articles");
    expect(activeModuleId("/accueil", "")).toBe("dashboard");
  });
});
