import { describe, expect, it } from "vitest";
import { PLACEHOLDER_ORIGIN, normalizeAppBase, parseDeepLink, redirectUrl } from "./redirects";
import { DEFAULT_PLANS, PERIODS } from "./subscriptions";

const IDS = DEFAULT_PLANS.map((p) => p.id);
describe("URL de redirection", () => {
  it("construit l'adresse de l'écran d'abonnement avec la formule et la période", () => {
    expect(redirectUrl("business", "month", "https://app.exemple.com")).toBe("https://app.exemple.com/reglages?onglet=abonnement&formule=business&periode=month");
    expect(redirectUrl("pro", "year", "https://app.exemple.com/")).toBe("https://app.exemple.com/reglages?onglet=abonnement&formule=pro&periode=year");
  });
  it("sans domaine : un marqueur explicite à remplacer, jamais une fausse adresse plausible", () => {
    expect(redirectUrl("starter", "day")).toBe(`${PLACEHOLDER_ORIGIN}/reglages?onglet=abonnement&formule=starter&periode=day`);
    expect(PLACEHOLDER_ORIGIN).toMatch(/VOTRE-DOMAINE/);
  });
  it("accepte un sous-chemin (GitHub Pages), sans barre finale, et conserve la casse du chemin", () => {
    expect(redirectUrl("pro", "month", "https://rdogui4-dot.github.io/Dogui-Mart-Pro-SaaS-")).toBe("https://rdogui4-dot.github.io/Dogui-Mart-Pro-SaaS-/reglages?onglet=abonnement&formule=pro&periode=month");
    expect(redirectUrl("pro", "month", "https://rdogui4-dot.github.io/Dogui-Mart-Pro-SaaS-/")).toBe(redirectUrl("pro", "month", "https://rdogui4-dot.github.io/Dogui-Mart-Pro-SaaS-"));
    expect(normalizeAppBase("https://a.exemple.com/x/y//")).toBe("https://a.exemple.com/x/y");
  });
  it("refuse http, identifiants, requête, fragment et adresses invalides", () => {
    for (const bad of ["http://app.exemple.com", "https://u:p@app.exemple.com", "https://app.exemple.com/?x=1", "https://app.exemple.com/app?x=1", "https://app.exemple.com/#a", "pas une url", ""]) expect(() => normalizeAppBase(bad), bad).toThrow();
    expect(normalizeAppBase("  https://App.Exemple.com  ")).toBe("https://app.exemple.com");
  });
  it("chaque adresse générée est relue à l'identique par l'application", () => {
    for (const p of IDS) for (const k of PERIODS) {
      const u = new URL(redirectUrl(p, k, "https://app.exemple.com"));
      expect(parseDeepLink(u.search, IDS)).toEqual({ tab: "subscription", plan: p, period: k });
    }
  });
  it("ignore toute valeur inconnue ou mal formée au lieu d'échouer", () => {
    expect(parseDeepLink("?onglet=abonnement&formule=gold&periode=decade", IDS)).toEqual({ tab: "subscription" });
    expect(parseDeepLink("?onglet=admin&formule=<script>", IDS)).toEqual({});
    expect(parseDeepLink("", IDS)).toEqual({});
    expect(parseDeepLink("?formule=pro", IDS)).toEqual({ plan: "pro" });
  });
});
