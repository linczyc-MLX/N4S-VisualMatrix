import { ScenarioResult } from "../domain/vmx-domain";

export type SoftCostBasis = "hard" | "ffe" | "hard_plus_ffe" | "total_before_escalation" | "fixed";

export type SoftCostLineItem = {
  id: string;
  label: string;
  basis: SoftCostBasis;
  /** rate expressed as decimal (e.g., 0.06 for 6%). Ignored for basis=fixed */
  rate: number;
  /** fixed dollar amount (basis=fixed). */
  fixedAmount: number;
  /** show/hide in UI */
  enabled: boolean;
};

export type CashflowPreset = {
  label: string;
  /** must sum to 1.0 (or close) */
  yearWeights: number[];
};

export type SoftCostsConfig = {
  version: 1;
  projectDurationYears: number; // default 4
  annualEscalationRate: number; // default 0.06
  /** What base is escalated */
  escalationScope: "hard_only" | "hard_plus_soft";
  /** Soft cost line items */
  lineItems: SoftCostLineItem[];
  /** Cashflow presets keyed by duration */
  cashflowPresets: Record<string, CashflowPreset>;
  /** Which preset to use (defaults to duration as string) */
  selectedPresetKey: string;
};

export type SoftCostsComputed = {
  hardBase: number;
  ffeBase: number;
  hardPlusFfe: number;
  softBase: number;
  totalBeforeEscalation: number;
  escalationBase: number;
  escalationAmount: number;
  totalWithEscalation: number;
  breakdown: Array<{ label: string; amount: number; basis: SoftCostBasis; rate: number }>;
};

export type CashflowYearRow = {
  year: number;
  weight: number;
  baseDraw: number;
  escalationDraw: number;
  totalDraw: number;
  cumulativeTotal: number;
  cumulativePct: number;
};

const DEFAULT_CONFIG_KEY = "vmx_soft_costs_config_v1";

export function getDefaultSoftCostsConfig(): SoftCostsConfig {
  const defaults: SoftCostsConfig = {
    version: 1,
    projectDurationYears: 4,
    annualEscalationRate: 0.06,
    escalationScope: "hard_only",
    lineItems: [
      {
        id: "architect_fee",
        label: "Architect Fee (fee-only)",
        basis: "hard",
        rate: 0.06,
        fixedAmount: 0,
        enabled: true,
      },
      {
        id: "interior_design_fee",
        label: "Interior Design Fee (fee-only)",
        basis: "hard",
        rate: 0.06,
        fixedAmount: 0,
        enabled: true,
      },
      {
        id: "id_procurement_fee",
        label: "ID Procurement Fee (on FF&E)",
        basis: "ffe",
        rate: 0.06,
        fixedAmount: 0,
        enabled: true,
      },
      {
        id: "freight_warehousing_install",
        label: "Freight / Warehousing / Installation (on FF&E)",
        basis: "ffe",
        rate: 0.20,
        fixedAmount: 0,
        enabled: true,
      },
      {
        id: "engineering",
        label: "Engineering (structural/MEP)",
        basis: "hard",
        rate: 0.04,
        fixedAmount: 0,
        enabled: true,
      },
      {
        id: "permits_fees",
        label: "Permits & Fees",
        basis: "hard",
        rate: 0.02,
        fixedAmount: 0,
        enabled: true,
      },
      {
        id: "owners_rep",
        label: "Owner-side / PM / Admin",
        basis: "hard",
        rate: 0.015,
        fixedAmount: 0,
        enabled: true,
      },
      {
        id: "insurance",
        label: "Insurance (builder's risk / liability)",
        basis: "hard",
        rate: 0.01,
        fixedAmount: 0,
        enabled: true,
      },
      {
        id: "soft_contingency",
        label: "Soft Contingency",
        basis: "hard",
        rate: 0.03,
        fixedAmount: 0,
        enabled: true,
      },
      {
        id: "legal_tax",
        label: "Legal / Accounting",
        basis: "hard",
        rate: 0.005,
        fixedAmount: 0,
        enabled: true,
      },
    ],
    cashflowPresets: {
      "3": { label: "3-year default", yearWeights: [0.35, 0.45, 0.20] },
      "4": { label: "4-year default", yearWeights: [0.20, 0.35, 0.30, 0.15] },
      "5": { label: "5-year (more gradual)", yearWeights: [0.15, 0.25, 0.25, 0.20, 0.15] },
    },
    selectedPresetKey: "4",
  };

  return defaults;
}

function clampNumber(n: any, fallback: number, min?: number, max?: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  if (min != null && v < min) return min;
  if (max != null && v > max) return max;
  return v;
}

function safeArrayNumbers(arr: any, len: number, fallback: number[]): number[] {
  if (!Array.isArray(arr) || arr.length !== len) return [...fallback];
  const out = arr.map((x, i) => clampNumber(x, fallback[i] ?? 0, 0, 1));
  return out;
}

function normalizeWeights(weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  if (!Number.isFinite(sum) || sum <= 0) {
    const eq = 1 / Math.max(1, weights.length);
    return weights.map(() => eq);
  }
  return weights.map((w) => w / sum);
}

export function loadSoftCostsConfigWithAutoMigration(): SoftCostsConfig {
  const def = getDefaultSoftCostsConfig();
  try {
    const raw = localStorage.getItem(DEFAULT_CONFIG_KEY);
    if (!raw) return def;

    const parsed = JSON.parse(raw);
    // If anything is malformed, fall back.
    const duration = clampNumber(parsed?.projectDurationYears, def.projectDurationYears, 1, 10);
    const rate = clampNumber(parsed?.annualEscalationRate, def.annualEscalationRate, 0, 0.5);
    const scope = parsed?.escalationScope === "hard_plus_soft" ? "hard_plus_soft" : "hard_only";

    const lineItems: SoftCostLineItem[] = Array.isArray(parsed?.lineItems)
      ? parsed.lineItems
          .map((li: any) => {
            const basis: SoftCostBasis =
              li?.basis === "ffe" ||
              li?.basis === "hard" ||
              li?.basis === "hard_plus_ffe" ||
              li?.basis === "total_before_escalation" ||
              li?.basis === "fixed"
                ? li.basis
                : "hard";
            return {
              id: String(li?.id ?? ""),
              label: String(li?.label ?? ""),
              basis,
              rate: clampNumber(li?.rate, 0, 0, 1),
              fixedAmount: clampNumber(li?.fixedAmount, 0, 0),
              enabled: li?.enabled === false ? false : true,
            } as SoftCostLineItem;
          })
          .filter((x: SoftCostLineItem) => x.id && x.label)
      : def.lineItems;

    const presets = typeof parsed?.cashflowPresets === "object" && parsed.cashflowPresets ? parsed.cashflowPresets : def.cashflowPresets;
    const selectedKey = String(parsed?.selectedPresetKey ?? String(duration));

    const next: SoftCostsConfig = {
      version: 1,
      projectDurationYears: duration,
      annualEscalationRate: rate,
      escalationScope: scope,
      lineItems: lineItems.length ? lineItems : def.lineItems,
      cashflowPresets: presets,
      selectedPresetKey: selectedKey,
    };

    // Ensure there is at least a preset for the chosen duration
    const durKey = String(duration);
    if (!next.cashflowPresets[durKey]) {
      next.cashflowPresets = { ...next.cashflowPresets, [durKey]: { label: `${duration}-year (auto)`, yearWeights: normalizeWeights(new Array(duration).fill(1)) } };
      next.selectedPresetKey = durKey;
    }

    // Persist the normalized/migrated config to keep future loads stable
    try {
      localStorage.setItem(DEFAULT_CONFIG_KEY, JSON.stringify(next, null, 2));
    } catch {
      // ignore
    }

    return next;
  } catch {
    return def;
  }
}

export function saveSoftCostsConfig(cfg: SoftCostsConfig) {
  localStorage.setItem(DEFAULT_CONFIG_KEY, JSON.stringify(cfg, null, 2));
}

export function computeSoftCosts(result: ScenarioResult, cfg: SoftCostsConfig): SoftCostsComputed {
  const hardBase = Number.isFinite(result.totalCost) ? Math.max(0, result.totalCost) : 0;
  const ffeRow = result.categories.find((c) => c.categoryId === "FF_E");
  const ffeBase = Number.isFinite(ffeRow?.cost) ? Math.max(0, ffeRow!.cost) : 0;
  const hardPlusFfe = hardBase + ffeBase;

  const breakdown: SoftCostsComputed["breakdown"] = [];
  let softBase = 0;

  for (const li of cfg.lineItems) {
    if (!li.enabled) continue;

    let base = 0;
    if (li.basis === "hard") base = hardBase;
    else if (li.basis === "ffe") base = ffeBase;
    else if (li.basis === "hard_plus_ffe") base = hardPlusFfe;
    else if (li.basis === "total_before_escalation") base = hardBase; // filled after

    let amount = 0;
    if (li.basis === "fixed") amount = li.fixedAmount;
    else amount = base * li.rate;

    amount = Number.isFinite(amount) ? Math.max(0, amount) : 0;

    breakdown.push({ label: li.label, amount, basis: li.basis, rate: li.rate });
    softBase += amount;
  }

  const totalBeforeEscalation = hardBase + softBase;

  // Handle items that depend on total_before_escalation
  // (Second pass so those bases can be computed accurately)
  const adjustedBreakdown: SoftCostsComputed["breakdown"] = [];
  let softBaseAdjusted = 0;
  for (const item of breakdown) {
    if (item.basis !== "total_before_escalation") {
      adjustedBreakdown.push(item);
      softBaseAdjusted += item.amount;
      continue;
    }
    const amount = totalBeforeEscalation * item.rate;
    const fixedAmount = Number.isFinite(amount) ? Math.max(0, amount) : 0;
    adjustedBreakdown.push({ ...item, amount: fixedAmount });
    softBaseAdjusted += fixedAmount;
  }

  const softBaseFinal = softBaseAdjusted;
  const totalBeforeEscalationFinal = hardBase + softBaseFinal;

  const escalationBase = cfg.escalationScope === "hard_plus_soft" ? totalBeforeEscalationFinal : hardBase;
  const duration = Math.max(1, Math.floor(cfg.projectDurationYears));
  const rate = Math.max(0, cfg.annualEscalationRate);

  const preset = cfg.cashflowPresets[cfg.selectedPresetKey] || cfg.cashflowPresets[String(duration)];
  const rawWeights = preset?.yearWeights || new Array(duration).fill(1 / duration);
  const weights = normalizeWeights(rawWeights.slice(0, duration));

  // Mid-year assumption: year 1 uses t=0.5, year 2 uses t=1.5, etc.
  const escalationPerYear = weights.map((w, idx) => {
    const t = idx + 0.5;
    const factor = Math.pow(1 + rate, t) - 1;
    return escalationBase * w * factor;
  });
  const escalationAmount = escalationPerYear.reduce((a, b) => a + b, 0);

  const totalWithEscalation = totalBeforeEscalationFinal + escalationAmount;

  return {
    hardBase,
    ffeBase,
    hardPlusFfe,
    softBase: softBaseFinal,
    totalBeforeEscalation: totalBeforeEscalationFinal,
    escalationBase,
    escalationAmount,
    totalWithEscalation,
    breakdown: adjustedBreakdown,
  };
}

export function computeCashflowSchedule(result: ScenarioResult, cfg: SoftCostsConfig): { rows: CashflowYearRow[]; totals: SoftCostsComputed } {
  const totals = computeSoftCosts(result, cfg);

  const duration = Math.max(1, Math.floor(cfg.projectDurationYears));
  const rate = Math.max(0, cfg.annualEscalationRate);

  const preset = cfg.cashflowPresets[cfg.selectedPresetKey] || cfg.cashflowPresets[String(duration)];
  const rawWeights = preset?.yearWeights || new Array(duration).fill(1 / duration);
  const weights = normalizeWeights(rawWeights.slice(0, duration));

  const baseTotal = totals.totalBeforeEscalation;
  const escalationBase = totals.escalationBase;

  const rows: CashflowYearRow[] = [];
  let cumulative = 0;

  for (let i = 0; i < duration; i++) {
    const year = i + 1;
    const w = weights[i] ?? 0;

    const baseDraw = baseTotal * w;

    const t = i + 0.5;
    const factor = Math.pow(1 + rate, t) - 1;
    const escalationDraw = escalationBase * w * factor;

    const totalDraw = baseDraw + escalationDraw;
    cumulative += totalDraw;

    rows.push({
      year,
      weight: w,
      baseDraw,
      escalationDraw,
      totalDraw,
      cumulativeTotal: cumulative,
      cumulativePct: cumulative / Math.max(1, totals.totalWithEscalation),
    });
  }

  return { rows, totals };
}

export function configToPrettyJson(cfg: SoftCostsConfig): string {
  return JSON.stringify(cfg, null, 2);
}

export function parseConfigFromJson(raw: string): { ok: true; value: SoftCostsConfig } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(raw);
    // Load + migrate by temporarily writing and reloading, to reuse the migration path.
    // But do it safely: validate basic shape first.
    if (!parsed || typeof parsed !== "object") return { ok: false, error: "JSON must be an object" };

    const def = getDefaultSoftCostsConfig();

    const duration = clampNumber(parsed?.projectDurationYears, def.projectDurationYears, 1, 10);
    const rate = clampNumber(parsed?.annualEscalationRate, def.annualEscalationRate, 0, 0.5);
    const scope = parsed?.escalationScope === "hard_plus_soft" ? "hard_plus_soft" : "hard_only";

    const lineItems: SoftCostLineItem[] = Array.isArray(parsed?.lineItems)
      ? parsed.lineItems
          .map((li: any) => {
            const basis: SoftCostBasis =
              li?.basis === "ffe" ||
              li?.basis === "hard" ||
              li?.basis === "hard_plus_ffe" ||
              li?.basis === "total_before_escalation" ||
              li?.basis === "fixed"
                ? li.basis
                : "hard";
            return {
              id: String(li?.id ?? ""),
              label: String(li?.label ?? ""),
              basis,
              rate: clampNumber(li?.rate, 0, 0, 1),
              fixedAmount: clampNumber(li?.fixedAmount, 0, 0),
              enabled: li?.enabled === false ? false : true,
            } as SoftCostLineItem;
          })
          .filter((x: SoftCostLineItem) => x.id && x.label)
      : def.lineItems;

    const cashflowPresets: Record<string, CashflowPreset> =
      parsed?.cashflowPresets && typeof parsed.cashflowPresets === "object" ? parsed.cashflowPresets : def.cashflowPresets;

    const selectedPresetKey = String(parsed?.selectedPresetKey ?? String(duration));

    const next: SoftCostsConfig = {
      version: 1,
      projectDurationYears: duration,
      annualEscalationRate: rate,
      escalationScope: scope,
      lineItems: lineItems.length ? lineItems : def.lineItems,
      cashflowPresets,
      selectedPresetKey,
    };

    // Ensure there is a preset for the selected duration
    const durKey = String(duration);
    if (!next.cashflowPresets[durKey]) {
      next.cashflowPresets = {
        ...next.cashflowPresets,
        [durKey]: { label: `${duration}-year (auto)`, yearWeights: normalizeWeights(new Array(duration).fill(1)) },
      };
      next.selectedPresetKey = durKey;
    }

    return { ok: true, value: next };
  } catch (e: any) {
    return { ok: false, error: e?.message ? String(e.message) : "Invalid JSON" };
  }
}

const SOFT_COSTS_KEY = "vmx_soft_costs_config_v1";

export function loadSoftCostsConfig(): SoftCostsConfig {
  const def = getDefaultSoftCostsConfig();
  try {
    const raw = localStorage.getItem(SOFT_COSTS_KEY);
    if (!raw) return def;
    const parsed = parseConfigFromJson(raw);
    if (!parsed.ok) return def;
    return parsed.value;
  } catch {
    return def;
  }
}

export function persistSoftCostsConfig(cfg: SoftCostsConfig) {
  try {
    localStorage.setItem(SOFT_COSTS_KEY, configToPrettyJson(cfg));
  } catch {
    // ignore
  }
}
