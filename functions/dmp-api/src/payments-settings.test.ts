import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { handle } from "./main";
import { normalizeTemplate } from "../../../src/domain/payment-links";

const T = "tenantpay001"; let st: MemoryStore; let A = "";
const call = (user: string, action: string, payload: unknown) => handle(st, user, { action, tenantId: T, shopId: A, payload }, { admins: [] });
const ok = async (r: Promise<any>) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(200); return x.body.data; };
const err = async (r: Promise<any>, status: number, msg?: string) => { const x = await r; expect(x.status, JSON.stringify(x.body)).toBe(status); if (msg) expect(x.body.error).toContain(msg); return x.body.error as string; };
const saved = () => st.rows("payment_settings")[0]!;

beforeEach(async () => {
  st = new MemoryStore(); await st.grant(T, "own", ["owner"], []); await st.grant(T, "cais", ["cashier"], []);
  A = (await ok(handle(st, "own", { action: "shop.create", tenantId: T, shopId: "", payload: { name: "Dakar" } }))).shopId;
  await st.create("staff", "cais", T, { tenantId: T, userId: "cais", name: "c", role: "cashier", shopIds: JSON.stringify([A]), active: true });
});

describe("normalizeTemplate (domaine)", () => {
  it("garde un modèle avec {amount}", () => { expect(normalizeTemplate("https://pay.x.com/m/1?amount={amount}&ref={ref}", "orange")).toEqual({ template: "https://pay.x.com/m/1?amount={amount}&ref={ref}", converted: false }); });
  it("remplace le montant d'un lien déjà généré", () => {
    expect(normalizeTemplate("https://pay.wave.com/m/M_sn_abc/c/sn/?amount=1000", "wave")).toEqual({ template: "https://pay.wave.com/m/M_sn_abc/c/sn/?amount={amount}", converted: true });
    expect(normalizeTemplate("https://pay.orange.sn/x?a=1&amount=250&b=2", "orange").template).toBe("https://pay.orange.sn/x?a=1&amount={amount}&b=2");
    expect(normalizeTemplate("https://pay.orange.sn/x?Amount=7#f", "orange").template).toBe("https://pay.orange.sn/x?Amount={amount}#f");
  });
  it("ajoute le montant à un lien Wave sans montant, jamais pour un autre domaine", () => {
    expect(normalizeTemplate("https://pay.wave.com/m/M_sn_abc/c/sn/", "wave").template).toBe("https://pay.wave.com/m/M_sn_abc/c/sn/?amount={amount}");
    expect(normalizeTemplate("https://wave.com/pay?x=1", "wave").template).toBe("https://wave.com/pay?x=1&amount={amount}");
    expect(() => normalizeTemplate("https://pay.orange.sn/merchant/12", "orange")).toThrow("ne contient pas le montant");
    expect(() => normalizeTemplate("https://evilwave.com/x", "wave")).toThrow("ne contient pas le montant");
  });
  it("refuse texte, http, espaces et vide avec un message lisible", () => {
    expect(() => normalizeTemplate("bonjour", "wave")).toThrow("pas un lien valide"); expect(() => normalizeTemplate("http://x.com/?amount={amount}", "wave")).toThrow("https"); expect(() => normalizeTemplate("https://x.com/a b?amount={amount}", "wave")).toThrow("espace"); expect(() => normalizeTemplate("   ", "wave")).toThrow("vide");
  });
});

describe("enregistrement des liens QR", () => {
  it("le cas signalé : un lien sans montant donne une erreur 400 explicite, plus jamais « Erreur interne »", async () => {
    const e = await err(call("own", "payments.settings.save", { waveTemplate: "https://pay.orange.sn/merchant/12" }), 400, "Lien Wave Business"); expect(e).toContain("{amount}"); expect(e).not.toContain("interne");
    await err(call("own", "payments.settings.save", { orangeTemplate: "n'importe quoi" }), 400, "Orange Business"); await err(call("own", "payments.settings.save", { waveTemplate: "http://x.com/?a={amount}" }), 400, "https");
    expect(st.rows("payment_settings")).toHaveLength(0);
  });
  it("un lien Wave généré avec un montant est converti, enregistré, et le QR porte le vrai montant", async () => {
    const r = await ok(call("own", "payments.settings.save", { waveTemplate: "https://pay.wave.com/m/M_sn_abc/c/sn/?amount=1000", expiryMinutes: 20 }));
    expect(r).toEqual({ ok: true, converted: ["wave"] }); expect(saved()).toMatchObject({ waveTemplate: "https://pay.wave.com/m/M_sn_abc/c/sn/?amount={amount}", orangeTemplate: "", expiryMinutes: 20 });
    const link = await ok(call("own", "payment_link.create", { provider: "wave", amount: 4500 })); expect(link.url).toBe("https://pay.wave.com/m/M_sn_abc/c/sn/?amount=4500");
  });
  it("modèle avec {amount} et {ref} : enregistré tel quel, aucune conversion annoncée", async () => {
    expect((await ok(call("own", "payments.settings.save", { orangeTemplate: "https://pay.orange.sn/p?amount={amount}&ref={ref}" }))).converted).toEqual([]);
    const link = await ok(call("own", "payment_link.create", { provider: "orange", amount: 1200 })); expect(link.url).toBe(`https://pay.orange.sn/p?amount=1200&ref=${link.reference}`);
  });
  it("champ absent = inchangé ; chaîne vide = opérateur retiré ; un opérateur retiré n'ouvre plus de lien", async () => {
    await ok(call("own", "payments.settings.save", { waveTemplate: "https://pay.wave.com/m/a/c/sn/?amount=1", orangeTemplate: "https://o.sn/p?amount={amount}" }));
    await ok(call("own", "payments.settings.save", { expiryMinutes: 30 })); expect(saved()).toMatchObject({ waveTemplate: "https://pay.wave.com/m/a/c/sn/?amount={amount}", orangeTemplate: "https://o.sn/p?amount={amount}", expiryMinutes: 30 });
    await ok(call("own", "payments.settings.save", { waveTemplate: "" })); expect(saved().waveTemplate).toBe(""); expect(saved().orangeTemplate).toBe("https://o.sn/p?amount={amount}");
    expect(await ok(call("own", "payments.settings.get", {}))).toMatchObject({ wave: false, orange: true });
    await err(call("own", "payment_link.create", { provider: "wave", amount: 100 }), 409, "non configuré");
  });
  it("un lien déjà enregistré mais devenu invalide donne une erreur 409 claire à l'encaissement, pas une erreur interne", async () => {
    await st.create("payment_settings", A, T, { tenantId: T, shopId: A, waveTemplate: "https://pay.wave.com/sans-montant", orangeTemplate: "", expiryMinutes: 15 });
    await err(call("own", "payment_link.create", { provider: "wave", amount: 100 }), 409, "invalide");
  });
  it("seul le propriétaire modifie les liens", async () => {
    await err(call("cais", "payments.settings.save", { waveTemplate: "https://pay.wave.com/m/a/c/sn/?amount=1" }), 403);
  });
});
