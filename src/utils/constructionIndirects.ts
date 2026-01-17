import type { TierId } from "../data/benchmark-library-storage";

/**
 * US-style Construction Indirects
 *
 * VMX "Direct Hard Costs" are the 7 elemental buckets (sticks/bricks + interior scope + MEP).
 * In US luxury residential contracting, the final construction contract is typically:
 *
 *   Direct Hard Costs
 *   + General Conditions (site staff + temporary works)
 *   + GC General Liability (pass-through)
 *   + Construction Contingency (hard contingency)
 *   + GC Fee (O&P) (applied on Cost of the Work)
 */

export type IndirectFeeBase = "cost_of_work" | "direct_only";

export type ConstructionIndirectsRates = {
  generalConditionsRate: number; // e.g. 0.10 = 10%
  glInsuranceRate: number; // e.g. 0.015 = 1.5%
  contingencyRate: number; // e.g. 0.05 = 5%
  feeRate: number; // e.g. 0.12 = 12%
  feeBase: IndirectFeeBase; // "cost_of_work" recommended
};

export type ConstructionIndirectLine = {
  id: "general_conditions" | "gl_insurance" | "contingency" | "gc_fee";
  label: string;
  rate: number;
  base: number;
  amount: number;
};

export type ConstructionIndirectsComputed = {
  directHardCost: number;
  costOfWorkSubtotal: number;
  totalIndirects: number;
  contractTotal: number;
  contractPsqft: number;
  lines: ConstructionIndirectLine[];
  ratesUsed: ConstructionIndirectsRates;
};

function clampRate(n: any, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(1, v));
}

export function getDefaultConstructionIndirectsRates(tier: TierId): ConstructionIndirectsRates {
  // Midpoints of typical US luxury ranges (2025) by tier.
  // You can tune these later; we keep them conservative but realistic.
  if (tier === "select") {
    return {
      generalConditionsRate: 0.06,
      glInsuranceRate: 0.01,
      contingencyRate: 0.05,
      feeRate: 0.10,
      feeBase: "cost_of_work",
    };
  }
  if (tier === "reserve") {
    return {
      generalConditionsRate: 0.08,
      glInsuranceRate: 0.01,
      contingencyRate: 0.05,
      feeRate: 0.12,
      feeBase: "cost_of_work",
    };
  }
  if (tier === "signature") {
    return {
      generalConditionsRate: 0.10,
      glInsuranceRate: 0.0125,
      contingencyRate: 0.08,
      feeRate: 0.14,
      feeBase: "cost_of_work",
    };
  }
  // legacy
  return {
    generalConditionsRate: 0.13,
    glInsuranceRate: 0.015,
    contingencyRate: 0.12,
    feeRate: 0.16,
    feeBase: "cost_of_work",
  };
}

export type ConstructionIndirectsConfigV1 = {
  version: 1;
  byTier: Record<TierId, Omit<ConstructionIndirectsRates, "feeBase">>;
  feeBase: IndirectFeeBase;
};

const STORAGE_KEY = "vmx_construction_indirects_v1";

export function getDefaultConstructionIndirectsConfig(): ConstructionIndirectsConfigV1 {
  const select = getDefaultConstructionIndirectsRates("select");
  const reserve = getDefaultConstructionIndirectsRates("reserve");
  const signature = getDefaultConstructionIndirectsRates("signature");
  const legacy = getDefaultConstructionIndirectsRates("legacy");

  return {
    version: 1,
    feeBase: "cost_of_work",
    byTier: {
      select: {
        generalConditionsRate: select.generalConditionsRate,
        glInsuranceRate: select.glInsuranceRate,
        contingencyRate: select.contingencyRate,
        feeRate: select.feeRate,
      },
      reserve: {
        generalConditionsRate: reserve.generalConditionsRate,
        glInsuranceRate: reserve.glInsuranceRate,
        contingencyRate: reserve.contingencyRate,
        feeRate: reserve.feeRate,
      },
      signature: {
        generalConditionsRate: signature.generalConditionsRate,
        glInsuranceRate: signature.glInsuranceRate,
        contingencyRate: signature.contingencyRate,
        feeRate: signature.feeRate,
      },
      legacy: {
        generalConditionsRate: legacy.generalConditionsRate,
        glInsuranceRate: legacy.glInsuranceRate,
        contingencyRate: legacy.contingencyRate,
        feeRate: legacy.feeRate,
      },
    },
  };
}

export function loadConstructionIndirectsConfig(): ConstructionIndirectsConfigV1 {
  const def = getDefaultConstructionIndirectsConfig();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return def;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1) return def;

    const feeBase: IndirectFeeBase = parsed.feeBase === "direct_only" ? "direct_only" : "cost_of_work";

    const byTier = parsed.byTier || {};
    const next: ConstructionIndirectsConfigV1 = {
      version: 1,
      feeBase,
      byTier: {
        select: {
          generalConditionsRate: clampRate(byTier?.select?.generalConditionsRate, def.byTier.select.generalConditionsRate),
          glInsuranceRate: clampRate(byTier?.select?.glInsuranceRate, def.byTier.select.glInsuranceRate),
          contingencyRate: clampRate(byTier?.select?.contingencyRate, def.byTier.select.contingencyRate),
          feeRate: clampRate(byTier?.select?.feeRate, def.byTier.select.feeRate),
        },
        reserve: {
          generalConditionsRate: clampRate(byTier?.reserve?.generalConditionsRate, def.byTier.reserve.generalConditionsRate),
          glInsuranceRate: clampRate(byTier?.reserve?.glInsuranceRate, def.byTier.reserve.glInsuranceRate),
          contingencyRate: clampRate(byTier?.reserve?.contingencyRate, def.byTier.reserve.contingencyRate),
          feeRate: clampRate(byTier?.reserve?.feeRate, def.byTier.reserve.feeRate),
        },
        signature: {
          generalConditionsRate: clampRate(byTier?.signature?.generalConditionsRate, def.byTier.signature.generalConditionsRate),
          glInsuranceRate: clampRate(byTier?.signature?.glInsuranceRate, def.byTier.signature.glInsuranceRate),
          contingencyRate: clampRate(byTier?.signature?.contingencyRate, def.byTier.signature.contingencyRate),
          feeRate: clampRate(byTier?.signature?.feeRate, def.byTier.signature.feeRate),
        },
        legacy: {
          generalConditionsRate: clampRate(byTier?.legacy?.generalConditionsRate, def.byTier.legacy.generalConditionsRate),
          glInsuranceRate: clampRate(byTier?.legacy?.glInsuranceRate, def.byTier.legacy.glInsuranceRate),
          contingencyRate: clampRate(byTier?.legacy?.contingencyRate, def.byTier.legacy.contingencyRate),
          feeRate: clampRate(byTier?.legacy?.feeRate, def.byTier.legacy.feeRate),
        },
      },
    };

    // Persist normalized
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next, null, 2));
    } catch {
      // ignore
    }

    return next;
  } catch {
    return def;
  }
}

export function saveConstructionIndirectsConfig(cfg: ConstructionIndirectsConfigV1) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg, null, 2));
  } catch {
    // ignore
  }
}

export function getRatesForTier(cfg: ConstructionIndirectsConfigV1, tier: TierId): ConstructionIndirectsRates {
  const t = cfg.byTier[tier];
  const def = getDefaultConstructionIndirectsRates(tier);
  return {
    generalConditionsRate: clampRate(t?.generalConditionsRate, def.generalConditionsRate),
    glInsuranceRate: clampRate(t?.glInsuranceRate, def.glInsuranceRate),
    contingencyRate: clampRate(t?.contingencyRate, def.contingencyRate),
    feeRate: clampRate(t?.feeRate, def.feeRate),
    feeBase: cfg.feeBase === "direct_only" ? "direct_only" : "cost_of_work",
  };
}

export function computeConstructionIndirects(args: {
  directHardCost: number;
  areaSqft: number;
  rates: ConstructionIndirectsRates;
}): ConstructionIndirectsComputed {
  const direct = Number.isFinite(args.directHardCost) ? Math.max(0, args.directHardCost) : 0;
  const area = Number.isFinite(args.areaSqft) ? Math.max(1, args.areaSqft) : 1;
  const rates = args.rates;

  const gc = direct * clampRate(rates.generalConditionsRate, 0);
  const gl = direct * clampRate(rates.glInsuranceRate, 0);
  const cont = direct * clampRate(rates.contingencyRate, 0);

  const costOfWorkSubtotal = direct + gc + gl + cont;

  const feeBase = rates.feeBase === "direct_only" ? direct : costOfWorkSubtotal;
  const fee = feeBase * clampRate(rates.feeRate, 0);

  const contractTotal = costOfWorkSubtotal + fee;
  const totalIndirects = gc + gl + cont + fee;

  const lines: ConstructionIndirectLine[] = [
    {
      id: "general_conditions",
      label: "General Conditions",
      rate: rates.generalConditionsRate,
      base: direct,
      amount: gc,
    },
    {
      id: "gl_insurance",
      label: "GC GL Insurance",
      rate: rates.glInsuranceRate,
      base: direct,
      amount: gl,
    },
    {
      id: "contingency",
      label: "Construction Contingency",
      rate: rates.contingencyRate,
      base: direct,
      amount: cont,
    },
    {
      id: "gc_fee",
      label: "GC Fee (O&P)",
      rate: rates.feeRate,
      base: feeBase,
      amount: fee,
    },
  ];

  return {
    directHardCost: direct,
    costOfWorkSubtotal,
    totalIndirects,
    contractTotal,
    contractPsqft: contractTotal / area,
    lines,
    ratesUsed: rates,
  };
}
