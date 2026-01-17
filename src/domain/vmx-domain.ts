export type VmxCategoryId =
  | "FACILITATING"
  | "SUBSTRUCTURE"
  | "SUPERSTRUCTURE"
  | "INTERNAL_FINISHES"
  | "FF_E"
  | "SERVICES"
  | "EXTERNAL_WORKS";

export type HeatBand = "LOW" | "MEDIUM" | "HIGH";

/**
 * Directional guardrail result for allocation vs target range.
 * - LOW  => below target minimum
 * - HIGH => above target maximum
 * - OK   => within target range
 */
export type RangeStatus = "OK" | "LOW" | "HIGH";

export interface CategoryDef {
  id: VmxCategoryId;
  label: string;
  sortOrder: number;
}

export const VMX_CATEGORIES: CategoryDef[] = [
  // US-first: ASTM UniFormat-inspired elemental buckets (7-category model)
  // NOTE: We preserve the internal IDs for backwards compatibility (storage/export).
  { id: "FACILITATING", label: "Site Prep & Infrastructure", sortOrder: 1 },
  { id: "SUBSTRUCTURE", label: "Substructure", sortOrder: 2 },
  { id: "SUPERSTRUCTURE", label: "Shell", sortOrder: 3 },
  { id: "INTERNAL_FINISHES", label: "Interiors", sortOrder: 4 },
  { id: "FF_E", label: "Equipment & Furnishings", sortOrder: 5 },
  { id: "SERVICES", label: "Services (MEP)", sortOrder: 6 },
  { id: "EXTERNAL_WORKS", label: "Exterior Improvements", sortOrder: 7 },
];

export interface BenchmarkBand {
  categoryId: VmxCategoryId;
  band: HeatBand;
  psqft: number; // US-first: price per square foot
}

export interface TargetRange {
  categoryId: VmxCategoryId;
  minPct: number; // decimal, e.g. 0.25
  maxPct: number; // decimal, e.g. 0.30
}

export interface BenchmarkSet {
  id: string;
  name: string;
  currency: string;
  bands: BenchmarkBand[];

  /**
   * IMPORTANT: keep this name as targetRanges (this is what the app expects)
   */
  targetRanges: TargetRange[];
}

export interface ScenarioSelection {
  categoryId: VmxCategoryId;
  band: HeatBand;
  overridePsqft?: number;
}

export interface CategoryResult {
  categoryId: VmxCategoryId;
  label: string;
  band: HeatBand;
  psqftUsed: number;
  cost: number;
  pctOfTotal: number;

  targetMinPct: number;
  targetMaxPct: number;

  rangeStatus: RangeStatus;

  /**
   * Kept for existing UI compatibility.
   */
  isOutOfRange: boolean;
}

export interface ScenarioResult {
  areaSqft: number;
  currency: string;
  totalCost: number;
  totalPsqft: number;
  categories: CategoryResult[];
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function safePct(n: number): number {
  // clamp to [0, 1] with basic safety
  return clamp(n, 0, 1);
}

function ensureMinMax(minPct: number, maxPct: number): { minPct: number; maxPct: number } {
  const mn = safePct(minPct);
  const mx = safePct(maxPct);
  if (mx < mn) return { minPct: mn, maxPct: mn };
  return { minPct: mn, maxPct: mx };
}

function classifyRange(pct: number, minPct: number, maxPct: number): RangeStatus {
  if (pct < minPct) return "LOW";
  if (pct > maxPct) return "HIGH";
  return "OK";
}

function requireBand(benchmark: BenchmarkSet, categoryId: VmxCategoryId, band: HeatBand): BenchmarkBand {
  const found = benchmark.bands.find((b) => b.categoryId === categoryId && b.band === band);
  if (!found) throw new Error("Missing benchmark band for " + categoryId + ":" + band);
  return found;
}

/**
 * Returns a representative psqft for a category at the MEDIUM band.
 * If MEDIUM is missing, falls back to average of LOW/HIGH if present.
 * If nothing is present, returns 0.
 */
function getMediumPsqftOrFallback(benchmark: BenchmarkSet, categoryId: VmxCategoryId): number {
  const med = benchmark.bands.find((b) => b.categoryId === categoryId && b.band === "MEDIUM");
  if (med && Number.isFinite(med.psqft)) return Math.max(0, med.psqft);

  const low = benchmark.bands.find((b) => b.categoryId === categoryId && b.band === "LOW");
  const high = benchmark.bands.find((b) => b.categoryId === categoryId && b.band === "HIGH");

  const lowV = low && Number.isFinite(low.psqft) ? Math.max(0, low.psqft) : null;
  const highV = high && Number.isFinite(high.psqft) ? Math.max(0, high.psqft) : null;

  if (lowV != null && highV != null) return (lowV + highV) / 2;
  if (lowV != null) return lowV;
  if (highV != null) return highV;

  return 0;
}

/**
 * Compute the implied allocation shares (percent of total) if every category
 * were set to MEDIUM band. This is area-independent (area cancels out).
 *
 * If the benchmark is missing all usable psqft, falls back to equal weights.
 */
export function computeImpliedMediumAllocationShares(benchmark: BenchmarkSet): Record<VmxCategoryId, number> {
  const psqftByCat: Record<VmxCategoryId, number> = {} as any;

  let sum = 0;
  for (const cat of VMX_CATEGORIES) {
    const v = getMediumPsqftOrFallback(benchmark, cat.id);
    psqftByCat[cat.id] = v;
    sum += v;
  }

  const out: Record<VmxCategoryId, number> = {} as any;

  if (!Number.isFinite(sum) || sum <= 0) {
    // equal weights fallback
    const eq = 1 / VMX_CATEGORIES.length;
    for (const cat of VMX_CATEGORIES) out[cat.id] = eq;
    return out;
  }

  for (const cat of VMX_CATEGORIES) {
    out[cat.id] = psqftByCat[cat.id] / sum;
  }
  return out;
}

export type TargetRangeDerivationOptions = {
  /**
   * Relative tolerance around the implied Medium share.
   * Example: 0.20 means ±20% relative. (Default: 0.20)
   */
  relativeTolerance?: number;

  /**
   * Absolute minimum half-width of the band.
   * Example: 0.01 means at least ±1 percentage point. (Default: 0.01)
   */
  minHalfWidthAbs?: number;

  /**
   * Absolute maximum half-width of the band.
   * Example: 0.06 means cap at ±6 percentage points. (Default: 0.06)
   */
  maxHalfWidthAbs?: number;
};

/**
 * Derive target ranges from the implied MEDIUM allocation shares.
 *
 * This is the core engine behind a “Calibrate” button in Benchmark Admin.
 * It produces 1 TargetRange per VMX category with safe clamps.
 */
export function deriveTargetRangesFromMedium(
  benchmark: BenchmarkSet,
  opts?: TargetRangeDerivationOptions
): TargetRange[] {
  const relativeTolerance = clamp(opts?.relativeTolerance ?? 0.2, 0, 2); // up to ±200% if someone wants it
  const minHalfWidthAbs = clamp(opts?.minHalfWidthAbs ?? 0.01, 0, 0.5);
  const maxHalfWidthAbs = clamp(opts?.maxHalfWidthAbs ?? 0.06, 0, 0.5);

  const shares = computeImpliedMediumAllocationShares(benchmark);

  const ranges: TargetRange[] = VMX_CATEGORIES.map((cat) => {
    const center = safePct(shares[cat.id]);

    // half-width is max(absolute floor, relative tolerance), capped by maxHalfWidthAbs
    const halfRel = center * relativeTolerance;
    const half = clamp(Math.max(minHalfWidthAbs, halfRel), 0, maxHalfWidthAbs);

    const minPct = center - half;
    const maxPct = center + half;

    const fixed = ensureMinMax(minPct, maxPct);

    return { categoryId: cat.id, minPct: fixed.minPct, maxPct: fixed.maxPct };
  });

  return ranges;
}

/**
 * Ensure benchmark has a complete set of targetRanges.
 * - If missing or incomplete, fills in derived ranges (from Medium shares).
 * - If present but has invalid min/max, normalizes them.
 */
export function ensureCompleteTargetRanges(benchmark: BenchmarkSet): TargetRange[] {
  const existing = Array.isArray(benchmark.targetRanges) ? benchmark.targetRanges : [];
  const byCat = new Map<VmxCategoryId, TargetRange>();

  for (const r of existing) {
    if (!r || !r.categoryId) continue;
    const fixed = ensureMinMax(r.minPct, r.maxPct);
    byCat.set(r.categoryId, { categoryId: r.categoryId, minPct: fixed.minPct, maxPct: fixed.maxPct });
  }

  // If any category is missing, derive a full set and merge (preserve existing valid ones)
  const derived = deriveTargetRangesFromMedium(benchmark);

  const finalRanges: TargetRange[] = VMX_CATEGORIES.map((cat) => {
    const existingRange = byCat.get(cat.id);
    if (existingRange) return existingRange;

    const d = derived.find((x) => x.categoryId === cat.id);
    if (d) return d;

    // ultra-safe fallback (should never happen)
    return { categoryId: cat.id, minPct: 0, maxPct: 1 };
  });

  return finalRanges;
}

function getTargetRangeForCategory(benchmark: BenchmarkSet, categoryId: VmxCategoryId): TargetRange {
  const complete = ensureCompleteTargetRanges(benchmark);
  const found = complete.find((r) => r.categoryId === categoryId);
  if (found) return found;
  return { categoryId, minPct: 0, maxPct: 1 };
}

export function computeScenarioResult(params: {
  areaSqft: number;
  benchmark: BenchmarkSet;
  selections: ScenarioSelection[];
}): ScenarioResult {
  const { areaSqft, benchmark, selections } = params;

  if (!Number.isFinite(areaSqft) || areaSqft <= 0) {
    throw new Error("areaSqft must be a positive number");
  }

  const selectionByCat = new Map<VmxCategoryId, ScenarioSelection>();
  for (const sel of selections) selectionByCat.set(sel.categoryId, sel);

  // IMPORTANT: never hard-fail due to missing targetRanges.
  // If targetRanges are incomplete, we derive credible defaults from the benchmark.
  const safeTargetRanges = ensureCompleteTargetRanges(benchmark);

  const interim = VMX_CATEGORIES.map((cat) => {
    const sel = selectionByCat.get(cat.id);
    if (!sel) throw new Error("Missing selection for category " + cat.id);

    const base = requireBand(benchmark, cat.id, sel.band);
    const psqftUsed = sel.overridePsqft ?? base.psqft;
    const cost = areaSqft * psqftUsed;

    const range =
      safeTargetRanges.find((r) => r.categoryId === cat.id) ?? getTargetRangeForCategory(benchmark, cat.id);

    return { categoryId: cat.id, label: cat.label, band: sel.band, psqftUsed, cost, range };
  });

  const totalCost = interim.reduce((sum, r) => sum + r.cost, 0);
  if (totalCost <= 0) throw new Error("Total cost computed as non-positive");

  const categories: CategoryResult[] = interim.map((r) => {
    const pct = r.cost / totalCost;

    const fixed = ensureMinMax(r.range.minPct, r.range.maxPct);
    const rangeStatus = classifyRange(pct, fixed.minPct, fixed.maxPct);
    const isOutOfRange = rangeStatus !== "OK";

    return {
      categoryId: r.categoryId,
      label: r.label,
      band: r.band,
      psqftUsed: r.psqftUsed,
      cost: r.cost,
      pctOfTotal: pct,
      targetMinPct: fixed.minPct,
      targetMaxPct: fixed.maxPct,
      rangeStatus,
      isOutOfRange,
    };
  });

  const totalPsqft = totalCost / areaSqft;

  return { areaSqft, currency: benchmark.currency, totalCost, totalPsqft, categories };
}

// Backlog: Add unit selector (sq ft / sq m) and convert area + benchmarks accordingly.
