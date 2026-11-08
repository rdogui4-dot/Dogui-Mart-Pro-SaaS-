import { describe, expect, it } from "vitest";
import { routerBasepath } from "./basepath";
describe("préfixe de routage", () => {
  it("aucun préfixe à la racine, préfixe sans barre finale sous un sous-chemin", () => {
    expect(routerBasepath("/")).toBeUndefined();
    expect(routerBasepath("/Dogui-Mart-Pro-SaaS-/")).toBe("/Dogui-Mart-Pro-SaaS-");
    expect(routerBasepath("/a/b/")).toBe("/a/b");
  });
});
