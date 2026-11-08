export type MomoProvider = "mtn" | "orange" | "wave" | "moov";
export type MomoStatus = "PENDING" | "SUCCESSFUL" | "FAILED";
export interface MomoGateway {
  requestToPay(a: { provider: MomoProvider; phone: string; amount: number; saleId: string; idempotencyKey: string }): Promise<{ reference: string; status: MomoStatus }>;
}
export const isValidPhone = (p: string): boolean => /^\+?\d{8,15}$/.test(p.replace(/\s/g, ""));

/** Aucune simulation en production : sans clés, on échoue. Le mode "mock" est explicite et réservé au dev. */
export class UnconfiguredGateway implements MomoGateway {
  async requestToPay(): Promise<never> {
    throw new Error("Mobile Money non configuré : paiement refusé");
  }
}
export class MockGateway implements MomoGateway {
  async requestToPay(a: { saleId: string; idempotencyKey: string }) {
    return { reference: `mock-${a.idempotencyKey}`, status: "PENDING" as MomoStatus };
  }
}
export function gatewayFor(mode: string | undefined): MomoGateway {
  if (mode === "mock" && !import.meta.env?.PROD) return new MockGateway();
  return new UnconfiguredGateway();
}
