export type PricingRegion = "cn" | "global";
export type SubscriptionPlanPriceId = "basic" | "pro" | "ultra";
export type SubscriptionBillingPeriod = "monthly" | "yearly";
export type CreditRechargePackage = {
  credits: number;
  labelKey: string;
  discountKey: string;
  amounts: Record<PricingRegion, number>;
};

const SUBSCRIPTION_PRICES: Record<
  PricingRegion,
  Record<SubscriptionPlanPriceId, Record<SubscriptionBillingPeriod, number>>
> = {
  cn: {
    basic: { monthly: 0, yearly: 0 },
    pro: { monthly: 99, yearly: 999 },
    ultra: { monthly: 499, yearly: 4999 },
  },
  global: {
    basic: { monthly: 0, yearly: 0 },
    pro: { monthly: 15, yearly: 150 },
    ultra: { monthly: 60, yearly: 600 },
  },
};

export const CREDIT_RECHARGE_PACKAGES: CreditRechargePackage[] = [
  { credits: 2000, labelKey: "rmb10", discountKey: "none", amounts: { cn: 10, global: 1 } },
  { credits: 15000, labelKey: "rmb50", discountKey: "sixSeven", amounts: { cn: 50, global: 5 } },
  { credits: 100000, labelKey: "rmb250", discountKey: "five", amounts: { cn: 250, global: 25 } },
  { credits: 500000, labelKey: "rmb1000", discountKey: "four", amounts: { cn: 1000, global: 100 } },
];

export function getPricingRegion(region?: string | null): PricingRegion {
  return region === "global" ? "global" : "cn";
}

export function getSubscriptionPlanAmount(
  region: PricingRegion,
  plan: SubscriptionPlanPriceId,
  billingPeriod: SubscriptionBillingPeriod,
) {
  return SUBSCRIPTION_PRICES[region][plan][billingPeriod];
}

export function getCreditRechargeAmount(region: PricingRegion, rechargePackage: CreditRechargePackage) {
  return rechargePackage.amounts[region];
}

export function formatRegionCurrency(amount: number, region: PricingRegion) {
  return `${region === "global" ? "$" : "¥"}${amount}`;
}
