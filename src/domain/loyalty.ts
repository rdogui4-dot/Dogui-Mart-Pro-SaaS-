export type Tier = "bronze" | "silver" | "gold";
export type LoyaltyRules = {
  cfaPerPoint: number; redeemCfaPerPoint: number; maxRedeemPct: number;
  silverThreshold: number; goldThreshold: number; silverBonusPct: number; goldBonusPct: number;
};
export const DEFAULT_RULES: LoyaltyRules = {
  cfaPerPoint: 100, redeemCfaPerPoint: 10, maxRedeemPct: 50,
  silverThreshold: 100_000, goldThreshold: 500_000, silverBonusPct: 10, goldBonusPct: 20,
};
export const tierFor = (annual: number, r: LoyaltyRules = DEFAULT_RULES): Tier =>
  annual >= r.goldThreshold ? "gold" : annual >= r.silverThreshold ? "silver" : "bronze";
export const earnedPoints = (amount: number, tier: Tier, r: LoyaltyRules = DEFAULT_RULES): number => {
  const bonus = tier === "gold" ? r.goldBonusPct : tier === "silver" ? r.silverBonusPct : 0;
  return Math.floor((amount / r.cfaPerPoint) * (1 + bonus / 100));
};
/** Points utilisables sur une vente, plafonnés par maxRedeemPct du total et par le solde. */
export const redeemablePoints = (balance: number, total: number, r: LoyaltyRules = DEFAULT_RULES): number =>
  Math.max(0, Math.min(balance, Math.floor((total * r.maxRedeemPct) / 100 / r.redeemCfaPerPoint)));
