import { describe, expect, it } from "vitest";
import { MAX_HELD, holdCart, loadHeld, removeHeld } from "./held-carts";

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
const cart = (n = 1) => ({ label: "Panier", lines: Array.from({ length: n }, (_, i) => ({ productId: "p" + i, qty: 1 })), customerId: "", coupon: "" });

describe("paniers en attente (caisse)", () => {
  it("met en attente puis reprend (retire) un panier, par boutique", () => {
    const st = mem(); const r = holdCart("s1", cart(2), new Date("2026-11-17T10:00:00Z"), st, "a"); expect(r.ok).toBe(true);
    expect(loadHeld("s1", st)).toHaveLength(1); expect(loadHeld("s2", st)).toHaveLength(0);
    expect(removeHeld("s1", "a", st)).toHaveLength(0);
  });
  it("refuse un panier vide et la limite atteinte sans rien perdre", () => {
    const st = mem(); expect(holdCart("s1", cart(0), new Date(), st)).toEqual({ ok: false, reason: "Le panier est vide." });
    for (let i = 0; i < MAX_HELD; i++) expect(holdCart("s1", cart(), new Date(), st, "x" + i).ok).toBe(true);
    const r = holdCart("s1", cart(), new Date(), st, "trop"); expect(r.ok).toBe(false); expect(loadHeld("s1", st)).toHaveLength(MAX_HELD);
  });
  it("stockage indisponible ou corrompu : refus explicite, lecture vide", () => {
    expect(holdCart("s1", cart(), new Date(), null).ok).toBe(false);
    const st = mem(); st.setItem("dmp.pos.held.s1", "{pas du json"); expect(loadHeld("s1", st)).toEqual([]);
  });
});
