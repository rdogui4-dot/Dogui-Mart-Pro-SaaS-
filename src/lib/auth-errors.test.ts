import { describe, expect, it } from "vitest";
import { authMessage } from "./auth-errors";
describe("messages d'authentification", () => {
  it("traduit les erreurs Appwrite sans révéler quel compte existe", () => {
    expect(authMessage({ code: 401, type: "user_invalid_credentials", message: "Invalid credentials." })).toBe("Identifiant ou mot de passe incorrect.");
    expect(authMessage({ code: 409, type: "user_already_exists", message: "A user with the same id, email, or phone already exists" })).toMatch(/existe déjà/);
    expect(authMessage({ code: 429, message: "Rate limit for the current endpoint has been exceeded" })).toMatch(/Trop de tentatives/);
    expect(authMessage({ code: 400, type: "password_personal_data", message: "Password must not be too short" })).toMatch(/8 caractères/);
    expect(authMessage(new TypeError("Failed to fetch"))).toMatch(/réseau/); expect(authMessage({ code: 503, message: "x" })).toMatch(/indisponible/); expect(authMessage({})).toMatch(/erreur/i);
  });
});
