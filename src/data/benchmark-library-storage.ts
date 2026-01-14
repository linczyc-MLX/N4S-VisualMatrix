import {
  BenchmarkSet,
  HeatBand,
  VMX_CATEGORIES,
  ensureCompleteTargetRanges,
} from "../domain/vmx-domain";
import { demoBenchmark, demoBenchmarkME } from "./demo-benchmark";

export type TierId = "select" | "reserve" | "signature" | "legacy";
export const TIERS: TierId[] = ["select", "reserve", "signature", "legacy"];

export function tierLabel(t: TierId) {
  return t === "select"
    ? "Select"
    : t === "reserve"
      ? "Reserve"
      : t === "signature"
        ? "Signature"
        : "Legacy";
}

export type RegionEntry = {
  id: string;
  name: string;
  byTier: Record<TierId, BenchmarkSet>;
};

export type BenchmarkLibrary = {
  version: 2;
  regions: RegionEntry[];
};

const LIB_KEY = "vmx_benchmark_library_v2";
const SEL_KEY = "vmx_benchmark_library_selection_v1";

const HEAT_BANDS: HeatBand[] = ["LOW", "MEDIUM", "HIGH"] as unknown as HeatBand[];

/** VMX_CATEGORIES may be an array of strings or objects; normalize into string ids. */
function getCategoryIds(): string[] {
  const raw = VMX_CATEGORIES as any[];
  const ids = (Array.isArray(raw) ? raw : [])
    .map((c) => {
      if (typeof c === "string") return c;
      if (c && typeof c === "object") return c.id ?? c.categoryId ?? c.key ?? c.code;
      return undefined;
    })
    .filter((v): v is string => typeof v === "string" && v.length > 0);

  return ids.length > 0
    ? ids
    : [
        "FACILITATING",
        "SUBSTRUCTURE",
        "SUPERSTRUCTURE",
        "INTERNAL_FINISHES",
        "FF_E",
        "SERVICES",
        "EXTERNAL_WORKS",
      ];
}

function isObject(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null;
}

function cloneBenchmarkSet(b: BenchmarkSet): BenchmarkSet {
  // Plain-data clone; safer than sharing references across regions/tiers
  return JSON.parse(JSON.stringify(b)) as BenchmarkSet;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function looksLikeME(region: { id: string; name: string }): boolean {
  const id = region.id.toLowerCase();
  const name = region.name.toLowerCase();
  return id === "me" || id.startsWith("me-") || name === "me" || name.includes("middle east");
}

function demoForRegion(region: { id: string; name: string }): BenchmarkSet {
  return looksLikeME(region) ? demoBenchmarkME : demoBenchmark;
}

function makeDemoBenchmark(base: BenchmarkSet, regionLabel: string, tier: TierId): BenchmarkSet {
  const next = cloneBenchmarkSet(base);
  next.id = `demo-${regionLabel.toLowerCase()}-${tier}`;
  next.name = `${regionLabel} — Demo — ${tierLabel(tier)}`;
  return next;
}

function buildDemoLibrary(): BenchmarkLibrary {
  const usByTier = Object.fromEntries(
    TIERS.map((t) => [t, makeDemoBenchmark(demoBenchmark, "US", t)])
  ) as Record<TierId, BenchmarkSet>;

  const meByTier = Object.fromEntries(
    TIERS.map((t) => [t, makeDemoBenchmark(demoBenchmarkME, "ME", t)])
  ) as Record<TierId, BenchmarkSet>;

  return {
    version: 2,
    regions: [
      { id: "us", name: "US", byTier: usByTier },
      { id: "me", name: "ME", byTier: meByTier },
    ],
  };
}

function normalizeBenchmarkSet(
  input: unknown,
  fallback: BenchmarkSet,
  nameHint?: string
): { next: BenchmarkSet; changed: boolean } {
  let changed = false;

  if (!isObject(input)) {
    return { next: cloneBenchmarkSet(fallback), changed: true };
  }

  const base: any = input;

  const next: any = {
    id: typeof base.id === "string" ? base.id : fallback.id,
    name: typeof base.name === "string" ? base.name : nameHint ?? (fallback as any).name,
    currency: typeof base.currency === "string" ? base.currency : (fallback as any).currency,
    bands: [],
    targetRanges: base.targetRanges ?? (fallback as any).targetRanges ?? [],
  };

  // --- bands ---
  const catIds = getCategoryIds();
  const rawBands: any[] = Array.isArray(base.bands) ? base.bands : [];
  if (!Array.isArray(base.bands)) changed = true;

  const cleaned: { categoryId: string; band: HeatBand; psqft: number }[] = [];
  for (const b of rawBands) {
    if (!isObject(b)) {
      changed = true;
      continue;
    }
    const categoryId = typeof b.categoryId === "string" ? b.categoryId : undefined;
    const band = typeof b.band === "string" ? (b.band as HeatBand) : undefined;
    const psqft =
      typeof b.psqft === "number"
        ? b.psqft
        : typeof b.psqft === "string"
          ? Number(b.psqft)
          : NaN;

    if (!categoryId || !band || !Number.isFinite(psqft)) {
      changed = true;
      continue;
    }
    cleaned.push({ categoryId, band, psqft });
  }

  const map = new Map<string, { categoryId: string; band: HeatBand; psqft: number }>();
  for (const b of cleaned) map.set(`${b.categoryId}::${b.band}`, b);

  // Ensure every category has LOW/MEDIUM/HIGH entries (avoid downstream undefined reads)
  for (const catId of catIds) {
    for (const band of HEAT_BANDS) {
      const key = `${catId}::${band}`;
      if (!map.has(key)) {
        map.set(key, { categoryId: catId, band, psqft: 0 });
        changed = true;
      }
    }
  }

  next.bands = Array.from(map.values());

  // --- targetRanges ---
  try {
    next.targetRanges = ensureCompleteTargetRanges(next.targetRanges as any);
  } catch {
    // If ensureCompleteTargetRanges signature changes, do not hard-fail app boot.
    // The UI will still render, and the user can re-save to normalize later.
  }

  return { next: next as BenchmarkSet, changed };
}

function normalizeByTier(
  inputByTier: unknown,
  region: { id: string; name: string },
  demoBase: BenchmarkSet
): { next: Record<TierId, BenchmarkSet>; changed: boolean } {
  let changed = false;
  const byTier: Record<TierId, BenchmarkSet> = {} as any;

  const src = isObject(inputByTier) ? (inputByTier as any) : {};
  if (!isObject(inputByTier)) changed = true;

  for (const t of TIERS) {
    const fallback = makeDemoBenchmark(demoBase, region.name, t);
    const { next, changed: c } = normalizeBenchmarkSet(src[t], fallback, `${region.name} — ${tierLabel(t)}`);
    if (c) changed = true;
    byTier[t] = next;
  }

  return { next: byTier, changed };
}

function migrateLibrary(input: unknown): { next: BenchmarkLibrary; changed: boolean } {
  const demoLib = buildDemoLibrary();

  if (!isObject(input) || !Array.isArray((input as any).regions)) {
    return { next: demoLib, changed: true };
  }

  const inLib: any = input;
  let changed = inLib.version !== 2;

  const regions: RegionEntry[] = [];
  for (const r of inLib.regions as any[]) {
    if (!isObject(r) || typeof r.id !== "string" || typeof r.name !== "string") {
      changed = true;
      continue;
    }

    const region = { id: r.id, name: r.name };
    const demoBase = demoForRegion(region);
    const { next: byTier, changed: c } = normalizeByTier(r.byTier, region, demoBase);
    if (c) changed = true;

    regions.push({ id: region.id, name: region.name, byTier });
  }

  if (regions.length === 0) return { next: demoLib, changed: true };

  return { next: { version: 2, regions }, changed };
}

// --- Public API ---

export function getInitialLibrary(): BenchmarkLibrary {
  const demoLib = buildDemoLibrary();

  try {
    const raw = localStorage.getItem(LIB_KEY);
    if (!raw) return demoLib;

    const parsed = JSON.parse(raw);
    const { next, changed } = migrateLibrary(parsed);

    if (changed) {
      // Persist the repaired structure so future boots are clean
      saveLibrary(next);
    }

    return next;
  } catch {
    return demoLib;
  }
}

export function saveLibrary(lib: BenchmarkLibrary) {
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify(lib));
  } catch {
    // ignore
  }
}

/**
 * Exported because BenchmarkLibraryAdmin imports it.
 */
export function addRegion(lib: BenchmarkLibrary, name: string): BenchmarkLibrary {
  const baseId = slugify(name) || "region";
  let id = baseId;
  let n = 2;
  while (lib.regions.some((r) => r.id === id)) {
    id = `${baseId}-${n++}`;
  }

  // Seed with US demo values; user can overwrite after creation.
  const demoBase = demoBenchmark;
  const byTier = Object.fromEntries(
    TIERS.map((t) => [t, makeDemoBenchmark(demoBase, name, t)])
  ) as Record<TierId, BenchmarkSet>;

  const nextRegion: RegionEntry = { id, name, byTier };

  return {
    ...lib,
    // Put new region at the top (BenchmarkLibraryAdmin assumes this)
    regions: [nextRegion, ...lib.regions],
  };
}

/**
 * Exported because BenchmarkLibraryAdmin imports it.
 */
export function updateRegionName(lib: BenchmarkLibrary, regionId: string, name: string): BenchmarkLibrary {
  return {
    ...lib,
    regions: lib.regions.map((r) => (r.id === regionId ? { ...r, name } : r)),
  };
}

/**
 * Exported because BenchmarkLibraryAdmin imports it.
 */
export function copyTierWithinRegion(
  lib: BenchmarkLibrary,
  regionId: string,
  fromTier: TierId,
  toTier: TierId
): BenchmarkLibrary {
  return {
    ...lib,
    regions: lib.regions.map((r) => {
      if (r.id !== regionId) return r;
      const src = r.byTier[fromTier] ?? makeDemoBenchmark(demoForRegion(r), r.name, fromTier);
      return {
        ...r,
        byTier: {
          ...r.byTier,
          [toTier]: cloneBenchmarkSet(src),
        },
      };
    }),
  };
}

export function updateBenchmarkForRegionTier(
  lib: BenchmarkLibrary,
  regionId: string,
  tier: TierId,
  nextBenchmark: BenchmarkSet
): BenchmarkLibrary {
  return {
    ...lib,
    regions: lib.regions.map((r) => {
      if (r.id !== regionId) return r;

      const demoBase = demoForRegion(r);
      const fallback = makeDemoBenchmark(demoBase, r.name, tier);
      const { next } = normalizeBenchmarkSet(nextBenchmark as any, fallback, `${r.name} — ${tierLabel(tier)}`);

      return {
        ...r,
        byTier: {
          ...r.byTier,
          [tier]: next,
        },
      };
    }),
  };
}

export function resetRegionTierToDemo(lib: BenchmarkLibrary, regionId: string, tier: TierId): BenchmarkLibrary {
  return {
    ...lib,
    regions: lib.regions.map((r) => {
      if (r.id !== regionId) return r;

      const base = demoForRegion(r);
      return {
        ...r,
        byTier: {
          ...r.byTier,
          [tier]: makeDemoBenchmark(base, r.name, tier),
        },
      };
    }),
  };
}

export function getInitialSelection(lib: BenchmarkLibrary): { regionId: string; tier: TierId } {
  const fallback = { regionId: lib.regions[0]?.id ?? "us", tier: "reserve" as TierId };

  try {
    const raw = localStorage.getItem(SEL_KEY);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw);
    const regionId = typeof parsed?.regionId === "string" ? parsed.regionId : fallback.regionId;
    const tier: TierId = TIERS.includes(parsed?.tier) ? parsed.tier : fallback.tier;

    const exists = lib.regions.some((r) => r.id === regionId);
    return exists ? { regionId, tier } : fallback;
  } catch {
    return fallback;
  }
}

export function saveSelection(regionId: string, tier: TierId) {
  try {
    localStorage.setItem(SEL_KEY, JSON.stringify({ regionId, tier }));
  } catch {
    // ignore
  }
}
