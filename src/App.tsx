import React, { useEffect, useMemo, useState } from "react";
import {
  computeScenarioResult,
  HeatBand,
  ScenarioSelection,
  VmxCategoryId,
  VMX_CATEGORIES,
  BenchmarkSet,
  CategoryResult,
} from "./domain/vmx-domain";
import "./vmx-ui-overrides.css"; // IMPORTANT: load overrides once, globally
import { Matrix } from "./components/Matrix";
import { SnapshotPanel } from "./components/SnapshotPanel";
import { BenchmarkAdmin } from "./components/BenchmarkAdmin";
import { BenchmarkLibraryAdmin } from "./components/BenchmarkLibraryAdmin";
import { AdvisoryReadout } from "./components/AdvisoryReadout";
import { DocumentationOverlay } from "./components/DocumentationOverlay";
import { SoftCostsCashflowPanel } from "./components/SoftCostsCashflowPanel";
import { AdminGuardrails, GuardrailsState } from "./components/AdminGuardrails";
import { ConstructionIndirectsPanel } from "./components/ConstructionIndirectsPanel";
import {
  BenchmarkLibrary,
  TierId,
  TIERS,
  getInitialLibrary,
  getInitialSelection,
  saveLibrary,
  saveSelection,
  updateBenchmarkForRegionTier,
  resetRegionTierToDemo,
  tierLabel,
} from "./data/benchmark-library-storage";
import { formatMoney, formatPct } from "./utils/format";
import { VMX_APP_VERSION, formatProvenanceDate } from "./config/vmx-meta";
import { exportClientPackZip, DeltaRowExport } from "./utils/exportClientPack";
import { SoftCostsConfig, loadSoftCostsConfig, computeCashflowSchedule } from "./utils/softCosts";
import {
  ConstructionIndirectsConfigV1,
  loadConstructionIndirectsConfig,
  saveConstructionIndirectsConfig,
  computeConstructionIndirects,
  getRatesForTier,
} from "./utils/constructionIndirects";

/**
 * Benchmark transforms
 *
 * NOTE: Kept inside App.tsx so Michael can replace a single file.
 */
function mixBenchmarkSetsByCategory(args: {
  base: BenchmarkSet;
  override: BenchmarkSet;
  categories: VmxCategoryId[];
  nameSuffix?: string;
}): BenchmarkSet {
  const { base, override, categories, nameSuffix } = args;

  const catSet = new Set(categories);

  // Replace ONLY the requested categories, preserving everything else.
  const nextBands = base.bands.map((b) => {
    if (!catSet.has(b.categoryId)) return b;
    const hit = override.bands.find((x) => x.categoryId === b.categoryId && x.band === b.band);
    return hit ? hit : b;
  });

  const nextRanges = base.targetRanges.map((r) => {
    if (!catSet.has(r.categoryId)) return r;
    const hit = override.targetRanges.find((x) => x.categoryId === r.categoryId);
    return hit ? hit : r;
  });

  return {
    ...base,
    name: nameSuffix ? `${base.name}${nameSuffix}` : base.name,
    bands: nextBands,
    targetRanges: nextRanges,
  };
}

function buildDefaultSelections(): Record<VmxCategoryId, ScenarioSelection> {
  const rec = {} as Record<VmxCategoryId, ScenarioSelection>;
  for (const c of VMX_CATEGORIES) rec[c.id] = { categoryId: c.id, band: "MEDIUM" };
  return rec;
}


type LocationPreset = { id: string; label: string; factor: number };

const LOCATION_PRESETS: LocationPreset[] = [
  { id: "national", label: "National Avg", factor: 1.0 },
  { id: "florida", label: "Florida (Miami / Palm Beach)", factor: 1.18 },
  { id: "co_denver", label: "Colorado (Denver)", factor: 1.10 },
  { id: "co_aspen", label: "Colorado (Aspen / Vail)", factor: 1.50 },
  { id: "ca_la", label: "California (LA / OC)", factor: 1.30 },
  { id: "ny_hamptons", label: "New York (NYC / Hamptons)", factor: 1.42 },
  { id: "custom", label: "Custom…", factor: 1.0 },
];

function presetFactor(id: string): number {
  const hit = LOCATION_PRESETS.find((p) => p.id === id);
  return hit ? hit.factor : 1.0;
}

function presetLabel(id: string): string {
  const hit = LOCATION_PRESETS.find((p) => p.id === id);
  return hit ? hit.label : id;
}


type TypologyId = "suburban" | "hillside" | "waterfront" | "urban" | "rural" | "desert";

type VmxProgramProfile = {
  totalSF?: number;
  byZoneSF?: Record<string, number>;
};


const TYPOLOGY_PRESETS: { id: TypologyId; label: string }[] = [
  { id: "suburban", label: "Suburban (Base)" },
  { id: "hillside", label: "Hillside" },
  { id: "waterfront", label: "Waterfront" },
  { id: "urban", label: "Urban" },
  { id: "rural", label: "Rural" },
  { id: "desert", label: "Desert" },
];

const TYPOLOGIES = TYPOLOGY_PRESETS;

function typologyLabel(id: TypologyId): string {
  const hit = TYPOLOGY_PRESETS.find((t) => t.id === id);
  return hit ? hit.label : id;
}

function locationLabel(id: string): string {
  const hit = LOCATION_PRESETS.find((p) => p.id === id);
  return hit ? hit.label : id;
}

function dampedLocationFactor(globalFactor: number): number {
  // 1 + ((G - 1) * 0.5)
  return 1 + (globalFactor - 1) * 0.5;
}

function scaleBenchmarkSetByCategory(
  benchmark: BenchmarkSet,
  categoryFactors: Partial<Record<VmxCategoryId, number>>,
  nameSuffix?: string
): BenchmarkSet {
  const nextBands: HeatBand[] = benchmark.bands.map((b) => {
    const f = categoryFactors[b.categoryId] ?? 1;
    return {
      ...b,
      lowPsf: b.lowPsf * f,
      mediumPsf: b.mediumPsf * f,
      highPsf: b.highPsf * f,
    };
  });

  return {
    ...benchmark,
    name: nameSuffix ? `${benchmark.name}${nameSuffix}` : benchmark.name,
    bands: nextBands,
  };
}

function applyLocationFactorWithDamping(benchmark: BenchmarkSet, globalFactor: number): BenchmarkSet {
  if (!Number.isFinite(globalFactor) || globalFactor <= 0) return benchmark;
  if (Math.abs(globalFactor - 1) < 1e-9) return benchmark;

  const factors: Partial<Record<VmxCategoryId, number>> = {};

  // Apply global multiplier to everything...
  for (const c of VMX_CATEGORIES) factors[c.id] = globalFactor;

  // ...except if this is a high-cost location ( > 1.10 ), damp Categories 4 (Interiors) & 5 (FF&E)
  if (globalFactor > 1.10) {
    const damped = dampedLocationFactor(globalFactor);
    factors["INTERNAL_FINISHES"] = damped;
    factors["FF_E"] = damped;
  }

  return scaleBenchmarkSetByCategory(benchmark, factors, ` (Loc×${globalFactor.toFixed(2)})`);
}

const TYPOLOGY_CATEGORY_FACTORS: Record<TypologyId, Partial<Record<VmxCategoryId, number>>> = {
  suburban: {},
  hillside: {
    FACILITATING: 1.30,
    SUBSTRUCTURE: 1.75,
    SUPERSTRUCTURE: 1.15,
    EXTERNAL_WORKS: 1.50,
  },
  waterfront: {
    FACILITATING: 1.20,
    SUBSTRUCTURE: 1.40,
    SUPERSTRUCTURE: 1.10,
    EXTERNAL_WORKS: 1.25,
  },
  urban: {
    FACILITATING: 1.25,
    EXTERNAL_WORKS: 0.50,
  },
  rural: {
    FACILITATING: 1.75,
    EXTERNAL_WORKS: 1.10,
  },
  desert: {
    FACILITATING: 1.10,
    SUPERSTRUCTURE: 1.10,
    SERVICES: 1.15,
    EXTERNAL_WORKS: 1.20,
  },
};

function applyTypologyCategoryFactors(benchmark: BenchmarkSet, typology: TypologyId): BenchmarkSet {
  if (typology === "suburban") return benchmark;
  const factors = TYPOLOGY_CATEGORY_FACTORS[typology] || {};
  return scaleBenchmarkSetByCategory(benchmark, factors, ` (Site:${typologyLabel(typology)})`);
}

const TYPOLOGY_INDIRECT_FACTORS: Record<TypologyId, { generalConditions: number; glInsurance: number }> = {
  suburban: { generalConditions: 1.0, glInsurance: 1.0 },
  hillside: { generalConditions: 1.20, glInsurance: 1.0 },
  waterfront: { generalConditions: 1.10, glInsurance: 2.0 },
  urban: { generalConditions: 1.40, glInsurance: 1.0 },
  rural: { generalConditions: 1.15, glInsurance: 1.0 },
  desert: { generalConditions: 1.05, glInsurance: 1.0 },
};

type IndirectRates = ReturnType<typeof getRatesForTier>;

function applyTypologyToIndirectRates(rates: IndirectRates, typology: TypologyId): IndirectRates {
  const mult = TYPOLOGY_INDIRECT_FACTORS[typology] ?? TYPOLOGY_INDIRECT_FACTORS.suburban;
  return {
    ...rates,
    generalConditionsRate: rates.generalConditionsRate * mult.generalConditions,
    glInsuranceRate: rates.glInsuranceRate * mult.glInsurance,
  };
}

function buildAdjustedBenchmark(base: BenchmarkSet, locationFactor: number, typology: TypologyId): BenchmarkSet {
  const withLoc = applyLocationFactorWithDamping(base, locationFactor);
  return applyTypologyCategoryFactors(withLoc, typology);
}


type ProgramBiasResult = {
  factors: Partial<Record<VmxCategoryId, number>>;
  label: string; // appended to benchmark name
};

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function computeProgramBiasFromProfile(profile: VmxProgramProfile | null | undefined): ProgramBiasResult {
  const byZone = profile?.byZoneSF || {};
  const total =
    typeof profile?.totalSF === "number" && profile.totalSF > 0
      ? profile.totalSF
      : Object.values(byZone).reduce((a, b) => a + (Number(b) || 0), 0);

  if (!total || total <= 0) {
    return { factors: {}, label: "Prog" };
  }

  const z = (code: string) => Number((byZone as any)[code] || 0);

  // --- Interiors bias (FOH-heavy programs tend to drive higher finish/detailing intensity) ---
  // FOH = Arrival/Public + Entertainment (front-of-house / guest-facing zones)
  const fohSF = z("Z1_APB") + z("Z3_ENT");
  const fohShare = fohSF / total;

  // Start boosting once FOH exceeds ~26% of the program, cap at +12%
  const interiorsBoost = clamp(((fohShare - 0.26) / 0.14) * 0.12, 0, 0.12);

  // --- Services bias (wellness + entertainment + outdoor tends to increase MEP/AV loads) ---
  const mepDriverSF = z("Z3_ENT") + z("Z4_WEL") + z("Z8_OUT");
  const mepShare = mepDriverSF / total;

  // Start boosting once MEP-driver zones exceed ~18% of the program, cap at +12%
  const servicesBoost = clamp(((mepShare - 0.18) / 0.20) * 0.12, 0, 0.12);

  const factors: Partial<Record<VmxCategoryId, number>> = {};
  if (interiorsBoost > 0) {
    factors["INTERNAL_FINISHES"] = 1 + interiorsBoost;
    factors["FF_E"] = 1 + interiorsBoost;
  }
  if (servicesBoost > 0) {
    factors["SERVICES"] = 1 + servicesBoost;
  }

  const labelParts: string[] = ["Prog"];
  if (interiorsBoost > 0) labelParts.push(`Int×${(1 + interiorsBoost).toFixed(2)}`);
  if (servicesBoost > 0) labelParts.push(`Svcs×${(1 + servicesBoost).toFixed(2)}`);

  return { factors, label: labelParts.join(" ") };
}

function applyProgramBias(benchmark: BenchmarkSet, bias: ProgramBiasResult | null | undefined): BenchmarkSet {
  if (!bias || !bias.factors || Object.keys(bias.factors).length === 0) return benchmark;
  return scaleBenchmarkSetByCategory(benchmark, bias.factors, ` (${bias.label})`);
}

function pickSecondRegionId(lib: BenchmarkLibrary, primaryId: string) {
  const other = lib.regions.find((r) => r.id !== primaryId);
  return other ? other.id : primaryId;
}

type DeltaHeat = "low" | "medium" | "high";
type DeltaDirection = "increase" | "decrease" | "flat";
type DeltaSortMode = "impact" | "category";

type DeltaRow = {
  categoryId: VmxCategoryId;
  categoryLabel: string;
  deltaCost: number; // B - A
  deltaPct: number; // B% - A%
  absFracOfATotal: number; // |deltaCost| / A total
  direction: DeltaDirection;
  heat: DeltaHeat;
  isTopDriver: boolean;
};

// Key Drivers (interactive comparisons)
type DriverLine = {
  categoryId: VmxCategoryId;
  label: string;
  deltaCost: number; // scenario - baseline
  deltaPct: number; // (scenario/baseline)-1
};

const KEY_DRIVER_PCT_THRESHOLD = 0.05; // 5%

function buildCategoryCostMap(result: { categories: CategoryResult[] }) {
  const out = new Map<VmxCategoryId, { label: string; cost: number }>();
  for (const c of result.categories) out.set(c.categoryId, { label: c.label, cost: c.cost });
  return out;
}

function computeDriverLines(args: {
  scenario: { totalCost: number; categories: CategoryResult[] };
  baseline: { totalCost: number; categories: CategoryResult[] };
}): { totalDeltaCost: number; totalDeltaPct: number; lines: DriverLine[] } {
  const { scenario, baseline } = args;

  const scenarioMap = buildCategoryCostMap(scenario);
  const baselineMap = buildCategoryCostMap(baseline);

  const lines: DriverLine[] = [];

  for (const cat of VMX_CATEGORIES) {
    const s = scenarioMap.get(cat.id);
    const b = baselineMap.get(cat.id);
    const sCost = s?.cost ?? 0;
    const bCost = b?.cost ?? 0;
    const deltaCost = sCost - bCost;
    const deltaPct = bCost > 0 ? sCost / bCost - 1 : 0;
    lines.push({ categoryId: cat.id, label: s?.label ?? cat.label, deltaCost, deltaPct });
  }

  // Only show categories with meaningful movement
  const filtered = lines
    .filter((l) => Math.abs(l.deltaPct) >= KEY_DRIVER_PCT_THRESHOLD)
    .sort((a, b) => Math.abs(b.deltaCost) - Math.abs(a.deltaCost))
    .slice(0, 6);

  const totalDeltaCost = scenario.totalCost - baseline.totalCost;
  const totalDeltaPct = baseline.totalCost > 0 ? scenario.totalCost / baseline.totalCost - 1 : 0;

  return { totalDeltaCost, totalDeltaPct, lines: filtered };
}



type WatchoutLine = {
  categoryId: VmxCategoryId;
  label: string;
  kind: "under" | "over";
  deltaPct: number; // fraction of Direct Hard Cost total
  deltaCost: number;
  currentPct: number;
  targetMin: number;
  targetMax: number;
};

function computeWatchouts(args: { result: { totalCost: number; categories: CategoryResult[] }; maxItems?: number }): WatchoutLine[] {
  const { result, maxItems = 3 } = args;
  const total = Number.isFinite(result.totalCost) && result.totalCost > 0 ? result.totalCost : 1;

  const items: WatchoutLine[] = [];
  for (const c of result.categories) {
    const pct = Number.isFinite(c.pctOfTotal) ? c.pctOfTotal : 0;
    const min = Number.isFinite(c.targetMinPct) ? c.targetMinPct : 0;
    const max = Number.isFinite(c.targetMaxPct) ? c.targetMaxPct : 1;

    if (pct < min) {
      const d = min - pct;
      items.push({
        categoryId: c.categoryId,
        label: c.label,
        kind: "under",
        deltaPct: d,
        deltaCost: d * total,
        currentPct: pct,
        targetMin: min,
        targetMax: max,
      });
    } else if (pct > max) {
      const d = pct - max;
      items.push({
        categoryId: c.categoryId,
        label: c.label,
        kind: "over",
        deltaPct: d,
        deltaCost: d * total,
        currentPct: pct,
        targetMin: min,
        targetMax: max,
      });
    }
  }

  return items.sort((a, b) => b.deltaPct - a.deltaPct).slice(0, maxItems);
}

function pctToInput(p: number) {
  if (!Number.isFinite(p)) return "0.0";
  return (p * 100).toFixed(1);
}

function inputToPct(v: string) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n / 100;
}

export default function App() {
  const [areaSqft, setAreaSqft] = useState<number>(15000);
  // Keep a string input for Lite view so users can type commas etc (syncs to numeric areaSqft)
  const [areaSqftInput, setAreaSqftInput] = useState<string>(() => String(areaSqft));

  useEffect(() => {
    // Keep input in sync when areaSqft is set from N4S context or other UI
    setAreaSqftInput(String(areaSqft));
  }, [areaSqft]);


  const [showDocs, setShowDocs] = useState(false);
  const [showGuardrails, setShowGuardrails] = useState(false);

  // UI Mode: Lite (client-facing) vs Pro (full matrix + admin)
  type UiMode = "lite" | "pro";

  const [uiMode, setUiMode] = useState<UiMode>(() => {
    if (typeof window === "undefined") return "lite";
    try {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get("view");
      if (fromUrl === "lite" || fromUrl === "pro") return fromUrl;
    } catch {
      // ignore
    }
    try {
      const stored = localStorage.getItem("vmx_ui_mode_v1");
      if (stored === "lite" || stored === "pro") return stored;
    } catch {
      // ignore
    }
    return "lite";
  });

  const allowProMode = typeof window !== "undefined" ? (window as any).__N4S_VMX_ALLOW_PRO__ !== false : true;

  useEffect(() => {
    try {
      localStorage.setItem("vmx_ui_mode_v1", uiMode);
    } catch {
      // ignore
    }
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("view", uiMode);
      window.history.replaceState({}, "", url.toString());
    } catch {
      // ignore
    }
  }, [uiMode]);


  // Soft costs / escalation / cashflow (visible to all; JSON editable)
  const [softCostsConfig, setSoftCostsConfig] = useState<SoftCostsConfig>(() => loadSoftCostsConfig());

  // US-style Construction Indirects (GC fee + general conditions, etc.)
  const [constructionIndirectsConfig, setConstructionIndirectsConfig] = useState<ConstructionIndirectsConfigV1>(() =>
    loadConstructionIndirectsConfig()
  );

  useEffect(() => {
    saveConstructionIndirectsConfig(constructionIndirectsConfig);
  }, [constructionIndirectsConfig]);

  useEffect(() => {
    const cleanup = () => document.body.classList.remove("print-vmx-report");
    window.addEventListener("afterprint", cleanup);
    return () => window.removeEventListener("afterprint", cleanup);
  }, []);

  const exportPdfReport = () => {
    // Close any overlays first so the report prints cleanly
    setShowDocs(false);
    setShowGuardrails(false);

    // Print mode class enables report-friendly CSS
    document.body.classList.add("print-vmx-report");

    // Ensure we start at the top of the report
    try {
      window.scrollTo(0, 0);
    } catch {
      // ignore
    }

    // Wait for React to commit state updates + CSS to apply before printing.
    // requestAnimationFrame (twice) is more reliable than a fixed timeout.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.print();
      });
    });
  };

  const [selA, setSelA] = useState<Record<VmxCategoryId, ScenarioSelection>>(buildDefaultSelections());
  const [selB, setSelB] = useState<Record<VmxCategoryId, ScenarioSelection>>(buildDefaultSelections());

  const [library, setLibrary] = useState<BenchmarkLibrary>(() => getInitialLibrary());
  const initialSel = useMemo(() => getInitialSelection(library), [library]);

  const [regionAId, setRegionAId] = useState<string>(initialSel.regionId);
  const [tier, setTier] = useState<TierId>(initialSel.tier);

  const [compareMode, setCompareMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem("vmx_compare_mode_v1") === "true";
    } catch {
      return false;
    }
  });

  const [regionBId, setRegionBId] = useState<string>(() => {
    try {
      return localStorage.getItem("vmx_compare_region_b_v1") || pickSecondRegionId(library, initialSel.regionId);
    } catch {
      return pickSecondRegionId(library, initialSel.regionId);
    }
  });

  // Phase 2: Location multipliers (Baseline × Location)
  const [locationAPreset, setLocationAPreset] = useState<string>(() => {
    try {
      return localStorage.getItem("vmx_location_a_preset_v1") || "national";
    } catch {
      return "national";
    }
  });
  const [locationACustom, setLocationACustom] = useState<number>(() => {
    try {
      const raw = localStorage.getItem("vmx_location_a_custom_v1");
      const parsed = raw ? Number(raw) : 1.0;
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 1.0;
    } catch {
      return 1.0;
    }
  });

  const [locationBPreset, setLocationBPreset] = useState<string>(() => {
    try {
      return localStorage.getItem("vmx_location_b_preset_v1") || "national";
    } catch {
      return "national";
    }
  });
  const [locationBCustom, setLocationBCustom] = useState<number>(() => {
    try {
      const raw = localStorage.getItem("vmx_location_b_custom_v1");
      const parsed = raw ? Number(raw) : 1.0;
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 1.0;
    } catch {
      return 1.0;
    }
  });

  const locationFactorA = locationAPreset === "custom" ? locationACustom : presetFactor(locationAPreset);
  const locationFactorB = locationBPreset === "custom" ? locationBCustom : presetFactor(locationBPreset);

  // Phase 3: Typology modifiers (site conditions)
  const [typologyA, setTypologyA] = useState<TypologyId>(() => {
    try {
      return (localStorage.getItem("vmx_typology_a_v1") as TypologyId) || "suburban";
    } catch {
      return "suburban";
    }
  });

  const [typologyB, setTypologyB] = useState<TypologyId>(() => {
    try {
      return (localStorage.getItem("vmx_typology_b_v1") as TypologyId) || "suburban";
    } catch {
      return "suburban";
    }
  });

  // Baselines used in Key Drivers comparisons
  const [baselineLocationPreset, setBaselineLocationPreset] = useState<string>(() => {
    try {
      return localStorage.getItem("vmx_baseline_location_preset_v1") || "national";
    } catch {
      return "national";
    }
  });

  const [baselineLocationCustom, setBaselineLocationCustom] = useState<number>(() => {
    try {
      const raw = localStorage.getItem("vmx_baseline_location_custom_v1");
      const parsed = raw ? Number(raw) : 1.0;
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 1.0;
    } catch {
      return 1.0;
    }
  });

  const baselineLocationFactor =
    baselineLocationPreset === "custom" ? baselineLocationCustom : presetFactor(baselineLocationPreset);

  const [baselineTypology, setBaselineTypology] = useState<TypologyId>(() => {
    try {
      return (localStorage.getItem("vmx_baseline_typology_v1") as TypologyId) || "suburban";
    } catch {
      return "suburban";
    }
  });


  // ---------------------------------------------------------------------------
  // N4S Integration (Phase A)
  // Minimal project context: client name, project name, area, location, typology, land cost
  // ---------------------------------------------------------------------------

  type VmxIncomingScenario = {
    areaSqft?: number;
    tier?: TierId;
    regionId?: string;
    locationPreset?: string;
    locationCustom?: number;
    typology?: TypologyId;
    landCost?: number;
  };

  type VmxIncomingContextV1 = {
    version: 1;
    projectId?: string;
    clientName?: string;
    projectName?: string;
    compareMode?: boolean;
    scenarioA?: VmxIncomingScenario;
    scenarioB?: VmxIncomingScenario;
  };

  type N4SProjectEntry = {
    id: string;
    label: string;
    context?: VmxIncomingContextV1;
  };

  const [n4sClientName, setN4sClientName] = useState<string>(() => {
    try {
      return localStorage.getItem("vmx_n4s_client_name_v1") || "";
    } catch {
      return "";
    }
  });

  const [n4sProjectName, setN4sProjectName] = useState<string>(() => {
    try {
      return localStorage.getItem("vmx_n4s_project_name_v1") || "";
    } catch {
      return "";
    }
  });

  const [n4sProjectId, setN4sProjectId] = useState<string>(() => {
    try {
      return localStorage.getItem("vmx_n4s_project_id_v1") || "";
    } catch {
      return "";
    }
  });

  const [landCostA, setLandCostA] = useState<number>(() => {
    try {
      const raw = localStorage.getItem("vmx_land_cost_a_v1");
      const parsed = raw ? Number(raw) : 0;
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    } catch {
      return 0;
    }
  });

  const [landCostB, setLandCostB] = useState<number>(() => {
    try {
      const raw = localStorage.getItem("vmx_land_cost_b_v1");
      const parsed = raw ? Number(raw) : 0;
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    } catch {
      return 0;
    }
  });

  const [programProfile, setProgramProfile] = useState<VmxProgramProfile | null>(() => {
    try {
      const raw = localStorage.getItem("vmx_program_profile_v1");
      return raw ? (JSON.parse(raw) as VmxProgramProfile) : null;
    } catch {
      return null;
    }
  });

  const [n4sProjects, setN4sProjects] = useState<N4SProjectEntry[]>(() => {
    try {
      const win = window as any;
      const arr = (win.__N4S_VMX_PROJECTS__ as N4SProjectEntry[] | undefined) || [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  });

  function safePresetId(id: string | undefined): string | null {
    if (!id) return null;
    return LOCATION_PRESETS.some((p) => p.id === id) ? id : null;
  }

  function safeRegionId(id: string | undefined): string | null {
    if (!id) return null;
    return library.regions.some((r) => r.id === id) ? id : null;
  }

  function safeTypologyId(id: string | undefined): TypologyId | null {
    if (!id) return null;
    return TYPOLOGY_PRESETS.some((tp) => tp.id === id) ? (id as TypologyId) : null;
  }

  function applyIncomingContext(ctx: VmxIncomingContextV1) {
    if (!ctx || ctx.version !== 1) return;

    if (typeof ctx.clientName === "string") setN4sClientName(ctx.clientName);
    if (typeof ctx.projectName === "string") setN4sProjectName(ctx.projectName);
    if (typeof ctx.projectId === "string") setN4sProjectId(ctx.projectId);

    if (typeof ctx.compareMode === "boolean") setCompareMode(ctx.compareMode);

    const a = ctx.scenarioA;
    if (a) {
      if (typeof a.areaSqft === "number" && Number.isFinite(a.areaSqft) && a.areaSqft > 0) setAreaSqft(Math.round(a.areaSqft));
      if (a.tier && TIERS.includes(a.tier)) setTier(a.tier);
      const ridA = safeRegionId(a.regionId);
      if (ridA) setRegionAId(ridA);
      const lpA = safePresetId(a.locationPreset);
      if (lpA) setLocationAPreset(lpA);
      if (typeof a.locationCustom === "number" && Number.isFinite(a.locationCustom)) setLocationACustom(a.locationCustom);
      const tpA = safeTypologyId(a.typology);
      if (tpA) setTypologyA(tpA);
      if (typeof a.landCost === "number" && Number.isFinite(a.landCost) && a.landCost >= 0) setLandCostA(a.landCost);
    }

    const b = ctx.scenarioB;
    if (b) {
      const ridB = safeRegionId(b.regionId);
      if (ridB) setRegionBId(ridB);
      const lpB = safePresetId(b.locationPreset);
      if (lpB) setLocationBPreset(lpB);
      if (typeof b.locationCustom === "number" && Number.isFinite(b.locationCustom)) setLocationBCustom(b.locationCustom);
      const tpB = safeTypologyId(b.typology);
      if (tpB) setTypologyB(tpB);
      if (typeof b.landCost === "number" && Number.isFinite(b.landCost) && b.landCost >= 0) setLandCostB(b.landCost);
    }
  }

  // Persist key integration fields locally (so VMX works standalone too)
  useEffect(() => {
    try {
      localStorage.setItem("vmx_n4s_client_name_v1", n4sClientName || "");
      localStorage.setItem("vmx_n4s_project_name_v1", n4sProjectName || "");
      localStorage.setItem("vmx_n4s_project_id_v1", n4sProjectId || "");
      localStorage.setItem("vmx_land_cost_a_v1", String(landCostA || 0));
      localStorage.setItem("vmx_land_cost_b_v1", String(landCostB || 0));
    } catch {
      // ignore
    }
  }, [n4sClientName, n4sProjectName, n4sProjectId, landCostA, landCostB]);

  // Bootstrap from N4S host if provided
  useEffect(() => {
    try {
      const win = window as any;
      const ctx = win.__N4S_VMX_CONTEXT__ as VmxIncomingContextV1 | undefined;
      if (ctx) applyIncomingContext(ctx);

      const arr = (win.__N4S_VMX_PROJECTS__ as N4SProjectEntry[] | undefined) || [];
      if (Array.isArray(arr) && arr.length > 0) setN4sProjects(arr);

      // If we have a saved projectId and a matching project with context, apply it
      const savedId = (localStorage.getItem("vmx_n4s_project_id_v1") || "").trim();
      if (!ctx && savedId && Array.isArray(arr)) {
        const found = arr.find((p) => p.id === savedId);
        if (found?.context) applyIncomingContext(found.context);
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("vmx_location_a_preset_v1", locationAPreset);
      localStorage.setItem("vmx_location_a_custom_v1", String(locationACustom));
      localStorage.setItem("vmx_location_b_preset_v1", locationBPreset);
      localStorage.setItem("vmx_location_b_custom_v1", String(locationBCustom));
    } catch {
      // ignore
    }
  }, [locationAPreset, locationACustom, locationBPreset, locationBCustom]);


  useEffect(() => {
    try {
      localStorage.setItem("vmx_typology_a_v1", typologyA);
      localStorage.setItem("vmx_typology_b_v1", typologyB);
      localStorage.setItem("vmx_baseline_location_preset_v1", baselineLocationPreset);
      localStorage.setItem("vmx_baseline_location_custom_v1", String(baselineLocationCustom));
      localStorage.setItem("vmx_baseline_typology_v1", baselineTypology);
    } catch {
      // ignore
    }
  }, [typologyA, typologyB, baselineLocationPreset, baselineLocationCustom, baselineTypology]);

  // Phase 2: 4-tier override for Interiors + Equipment & Furnishings (finishes + FF&E)
  const [interiorTierOverride, setInteriorTierOverride] = useState<string>(() => {
    try {
      return localStorage.getItem("vmx_interior_tier_override_v1") || "match";
    } catch {
      return "match";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("vmx_interior_tier_override_v1", interiorTierOverride);
    } catch {
      // ignore
    }
  }, [interiorTierOverride]);



  const [deltaMediumThr, setDeltaMediumThr] = useState<number>(() => {
    try {
      const raw = localStorage.getItem("vmx_delta_medium_thr_v1");
      const parsed = raw ? Number(raw) : 0.015;
      return Number.isFinite(parsed) ? parsed : 0.015;
    } catch {
      return 0.015;
    }
  });

  const [deltaHighThr, setDeltaHighThr] = useState<number>(() => {
    try {
      const raw = localStorage.getItem("vmx_delta_high_thr_v1");
      const parsed = raw ? Number(raw) : 0.03;
      return Number.isFinite(parsed) ? parsed : 0.03;
    } catch {
      return 0.03;
    }
  });

  const [deltaSort, setDeltaSort] = useState<DeltaSortMode>(() => {
    try {
      const raw = localStorage.getItem("vmx_delta_sort_v1");
      return raw === "category" ? "category" : "impact";
    } catch {
      return "impact";
    }
  });

  const [deltaDriversOnly, setDeltaDriversOnly] = useState<boolean>(() => {
    try {
      return localStorage.getItem("vmx_delta_drivers_only_v1") === "true";
    } catch {
      return false;
    }
  });

  // Provenance (shown in UI footer and exports)
  const [datasetName, setDatasetName] = useState<string>(() => {
    try {
      return localStorage.getItem("vmx_dataset_name_v1") || "US — Reserve (VMX Demo)";
    } catch {
      return "US — Reserve (VMX Demo)";
    }
  });

  const [datasetLastUpdated, setDatasetLastUpdated] = useState<string>(() => {
    try {
      return localStorage.getItem("vmx_dataset_last_updated_v1") || formatProvenanceDate(new Date());
    } catch {
      return formatProvenanceDate(new Date());
    }
  });

  const [datasetAssumptions, setDatasetAssumptions] = useState<string>(() => {
    try {
      return (
        localStorage.getItem("vmx_dataset_assumptions_v1") ||
        "Guardrails calibrated for early-stage DIRECT hard costs; benchmarks are $/sf by category; targets are directional ranges (not contract pricing). Construction Indirects (GC fee/conditions/contingency) are calculated separately."
      );
    } catch {
      return "Guardrails calibrated for early-stage DIRECT hard costs; benchmarks are $/sf by category; targets are directional ranges (not contract pricing). Construction Indirects (GC fee/conditions/contingency) are calculated separately.";
    }
  });

  const [autoStampOnBenchmarkChange, setAutoStampOnBenchmarkChange] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem("vmx_dataset_auto_stamp_v1");
      return raw ? raw === "true" : true;
    } catch {
      return true;
    }
  });

  // Driver definition (for Delta Heat)
  const [driverMode, setDriverMode] = useState<"topN" | "pct">(() => {
    try {
      const raw = localStorage.getItem("vmx_driver_mode_v1");
      return raw === "pct" ? "pct" : "topN";
    } catch {
      return "topN";
    }
  });

  const [driverTopN, setDriverTopN] = useState<number>(() => {
    try {
      const raw = localStorage.getItem("vmx_driver_top_n_v1");
      const parsed = raw ? Number(raw) : 3;
      return Number.isFinite(parsed) ? Math.max(1, parsed) : 3;
    } catch {
      return 3;
    }
  });

  const [driverPctThreshold, setDriverPctThreshold] = useState<number>(() => {
    try {
      const raw = localStorage.getItem("vmx_driver_pct_thr_v1");
      const parsed = raw ? Number(raw) : 0.02;
      return Number.isFinite(parsed) ? Math.max(0, parsed) : 0.02;
    } catch {
      return 0.02;
    }
  });

  const [driverPctMaxDrivers, setDriverPctMaxDrivers] = useState<number>(() => {
    try {
      const raw = localStorage.getItem("vmx_driver_pct_cap_v1");
      const parsed = raw ? Number(raw) : 7;
      return Number.isFinite(parsed) ? Math.max(1, parsed) : 7;
    } catch {
      return 7;
    }
  });


  useEffect(() => {
    if (!library.regions.some((r) => r.id === regionAId)) {
      setRegionAId(library.regions[0].id);
    }
    if (!library.regions.some((r) => r.id === regionBId)) {
      setRegionBId(pickSecondRegionId(library, regionAId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library]);

  useEffect(() => {
    saveSelection(regionAId, tier);
  }, [regionAId, tier]);

  useEffect(() => {
    try {
      localStorage.setItem("vmx_compare_mode_v1", String(compareMode));
      localStorage.setItem("vmx_compare_region_b_v1", regionBId);
    } catch {
      // ignore
    }
  }, [compareMode, regionBId]);

  useEffect(() => {
    try {
      localStorage.setItem("vmx_delta_medium_thr_v1", String(deltaMediumThr));
      localStorage.setItem("vmx_delta_high_thr_v1", String(deltaHighThr));
      localStorage.setItem("vmx_delta_sort_v1", deltaSort);
      localStorage.setItem("vmx_delta_drivers_only_v1", String(deltaDriversOnly));
    } catch {
      // ignore
    }
  }, [deltaMediumThr, deltaHighThr, deltaSort, deltaDriversOnly]);

  useEffect(() => {
    try {
      saveLibrary(library);
    } catch {
      // ignore
    }
  }, [library]);

  const autoStampRef = React.useRef(false);
  useEffect(() => {
    // Only stamp after initial mount, and only if enabled
    if (!autoStampRef.current) {
      autoStampRef.current = true;
      return;
    }
    if (!autoStampOnBenchmarkChange) return;

    // When benchmark library changes (admin edits), bump "Last updated"
    const next = formatProvenanceDate(new Date());
    setDatasetLastUpdated(next);
  }, [library, autoStampOnBenchmarkChange]);

  const programBias = useMemo(() => computeProgramBiasFromProfile(programProfile), [programProfile]);

  const regionA = library.regions.find((r) => r.id === regionAId) ?? library.regions[0];
  const regionB = library.regions.find((r) => r.id === regionBId) ?? library.regions[0];

  const baseBenchmarkA: BenchmarkSet = regionA.byTier[tier];
  const baseBenchmarkB: BenchmarkSet = regionB.byTier[tier];

  // Phase 2: category-specific tier override (Interiors + Equipment & Furnishings)
  const interiorOverrideTier: TierId | null =
    interiorTierOverride === "match" ? null : (interiorTierOverride as TierId);

  const mixedBenchmarkA = useMemo(() => {
    if (!interiorOverrideTier) return baseBenchmarkA;
    const override = regionA.byTier[interiorOverrideTier] ?? baseBenchmarkA;
    return mixBenchmarkSetsByCategory({
      base: baseBenchmarkA,
      override,
      categories: ["INTERNAL_FINISHES", "FF_E"],
      nameSuffix: ` — Interior:${tierLabel(interiorOverrideTier)}`,
    });
  }, [baseBenchmarkA, regionA, interiorOverrideTier]);

  const mixedBenchmarkB = useMemo(() => {
    if (!interiorOverrideTier) return baseBenchmarkB;
    const override = regionB.byTier[interiorOverrideTier] ?? baseBenchmarkB;
    return mixBenchmarkSetsByCategory({
      base: baseBenchmarkB,
      override,
      categories: ["INTERNAL_FINISHES", "FF_E"],
      nameSuffix: ` — Interior:${tierLabel(interiorOverrideTier)}`,
    });
  }, [baseBenchmarkB, regionB, interiorOverrideTier]);

  // Phase 3: Apply Location (global multiplier with damping on Interiors & FF&E) + Typology modifiers
  const benchmarkA: BenchmarkSet = useMemo(() => {
    return applyProgramBias(buildAdjustedBenchmark(mixedBenchmarkA, locationFactorA, typologyA), programBias);
  }, [mixedBenchmarkA, locationFactorA, typologyA, programBias]);

  const benchmarkB: BenchmarkSet = useMemo(() => {
    return applyProgramBias(buildAdjustedBenchmark(mixedBenchmarkB, locationFactorB, typologyB), programBias);
  }, [mixedBenchmarkB, locationFactorB, typologyB, programBias]);

  const [adminRegionId, setAdminRegionId] = useState<string>(regionA.id);
  useEffect(() => setAdminRegionId(regionA.id), [regionA.id]);

  const adminRegion = library.regions.find((r) => r.id === adminRegionId) ?? regionA;
  const currentBenchmarkForAdmin: BenchmarkSet = adminRegion.byTier[tier];

  function setCurrentBenchmark(nextBenchmark: BenchmarkSet) {
    const nextLib = updateBenchmarkForRegionTier(library, adminRegion.id, tier, nextBenchmark);
    setLibrary(nextLib);
  }

  function resetCurrentTierToDemo() {
    const nextLib = resetRegionTierToDemo(library, adminRegion.id, tier);
    setLibrary(nextLib);
  }

  // IMPORTANT: never set React state inside useMemo.
  const memoA = useMemo(() => {
    try {
      const result = computeScenarioResult({
        areaSqft,
        benchmark: benchmarkA,
        selections: Object.values(selA),
      });
      return { result, error: null as string | null };
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : "Unknown error" };
    }
  }, [areaSqft, benchmarkA, selA]);

  const memoB = useMemo(() => {
    if (!compareMode) return { result: null, error: null as string | null };
    try {
      const result = computeScenarioResult({
        areaSqft,
        benchmark: benchmarkB,
        selections: Object.values(selB),
      });
      return { result, error: null as string | null };
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : "Unknown error" };
    }
  }, [areaSqft, benchmarkB, selB, compareMode]);

  const resultA = memoA.result;
  const resultB = memoB.result;
  const errorA = memoA.error;
  const errorB = memoB.error;

  const watchoutsA = useMemo(() => (resultA ? computeWatchouts({ result: resultA }) : []), [resultA]);
  const watchoutsB = useMemo(() => (resultB ? computeWatchouts({ result: resultB }) : []), [resultB]);

  function setBandA(categoryId: VmxCategoryId, band: HeatBand) {
    setSelA((prev) => ({ ...prev, [categoryId]: { ...prev[categoryId], band } }));
  }
  function setBandB(categoryId: VmxCategoryId, band: HeatBand) {
    setSelB((prev) => ({ ...prev, [categoryId]: { ...prev[categoryId], band } }));
  }

  const delta = useMemo(() => {
    if (!compareMode || !resultA || !resultB) return null;

    const aTotal = resultA.totalCost > 0 ? resultA.totalCost : 1;
    const totalDelta = resultB.totalCost - resultA.totalCost;

    const baseRows: DeltaRow[] = resultA.categories.map((a: CategoryResult) => {
      const b = resultB.categories.find((x: CategoryResult) => x.categoryId === a.categoryId);
      if (!b) throw new Error(`Missing category in Scenario B: ${a.categoryId}`);

      const deltaCost = b.cost - a.cost;
      const deltaPct = b.pctOfTotal - a.pctOfTotal;
      const absFrac = Math.abs(deltaCost) / aTotal;

      let direction: DeltaDirection = "flat";
      if (deltaCost > 0) direction = "increase";
      else if (deltaCost < 0) direction = "decrease";

      let heat: DeltaHeat = "low";
      if (absFrac >= deltaHighThr) heat = "high";
      else if (absFrac >= deltaMediumThr) heat = "medium";

      return {
        categoryId: a.categoryId,
        categoryLabel: a.label,
        deltaCost,
        deltaPct,
        absFracOfATotal: absFrac,
        direction,
        heat,
        isTopDriver: false,
      };
    });

    const eligible = [...baseRows].filter((r) => Math.abs(r.deltaCost) > 0);
    const byAbs = eligible.sort((x, y) => Math.abs(y.deltaCost) - Math.abs(x.deltaCost));
    let driverIds = new Set<VmxCategoryId>();
    if (driverMode === "topN") {
      const n = Math.max(1, Math.floor(driverTopN));
      driverIds = new Set(byAbs.slice(0, n).map((r) => r.categoryId));
    } else {
      const thr = Math.max(0, driverPctThreshold);
      const cap = Math.max(1, Math.floor(driverPctMaxDrivers));
      const candidates = byAbs.filter((r) => r.absFracOfATotal >= thr);
      driverIds = new Set(candidates.slice(0, cap).map((r) => r.categoryId));
    }

    let rows = baseRows.map((r) => {
      const isTopDriver = driverIds.has(r.categoryId);
      const heat: DeltaHeat = isTopDriver && r.heat === "low" && r.absFracOfATotal > 0 ? "medium" : r.heat;
      return { ...r, isTopDriver, heat };
    });

    if (deltaSort === "impact") {
      rows = [...rows].sort((a, b) => Math.abs(b.deltaCost) - Math.abs(a.deltaCost));
    } else {
      const order = new Map<VmxCategoryId, number>(VMX_CATEGORIES.map((c, idx) => [c.id, idx]));
      rows = [...rows].sort((a, b) => (order.get(a.categoryId) ?? 999) - (order.get(b.categoryId) ?? 999));
    }

    if (deltaDriversOnly) rows = rows.filter((r) => r.isTopDriver);

    const increases = [...rows].filter((r) => r.deltaCost > 0).sort((a, b) => b.deltaCost - a.deltaCost).slice(0, 3);
    const decreases = [...rows].filter((r) => r.deltaCost < 0).sort((a, b) => a.deltaCost - b.deltaCost).slice(0, 3);

    return {
      totalDelta,
      rows,
      increases,
      decreases,
      currency: resultA.currency,
      aTotal: resultA.totalCost,
      bTotal: resultB.totalCost,
    };
  }, [compareMode, resultA, resultB, deltaMediumThr, deltaHighThr, deltaSort, deltaDriversOnly, driverMode, driverTopN, driverPctThreshold, driverPctMaxDrivers]);

  // Soft costs + escalation + cashflow (derived from Scenario results)
  const softA = useMemo(() => (resultA ? computeCashflowSchedule(resultA, softCostsConfig) : null), [resultA, softCostsConfig]);
  const softB = useMemo(() => (compareMode && resultB ? computeCashflowSchedule(resultB, softCostsConfig) : null), [compareMode, resultB, softCostsConfig]);

  // Construction Indirects (US) — derived from direct hard cost totals
  const indirectsA = useMemo(() => {
    if (!resultA) return null;

    const baseRates = getRatesForTier(constructionIndirectsConfig, tier);
    const rates = applyTypologyToIndirectRates(baseRates, typologyA);

    return computeConstructionIndirects({
      directHardCost: resultA.totalCost,
      areaSqft,
      rates,
    });
  }, [resultA, areaSqft, constructionIndirectsConfig, tier, typologyA]);

  const indirectsB = useMemo(() => {
    if (!compareMode || !resultB) return null;

    const baseRates = getRatesForTier(constructionIndirectsConfig, tier);
    const rates = applyTypologyToIndirectRates(baseRates, typologyB);

    return computeConstructionIndirects({
      directHardCost: resultB.totalCost,
      areaSqft,
      rates,
    });
  }, [compareMode, resultB, areaSqft, constructionIndirectsConfig, tier, typologyB]);


  // Phase 2: Grand Total (Direct Hard + Construction Indirects + Soft Costs + Escalation)
  const grandTotalA = useMemo(() => {
    if (!resultA || !indirectsA || !softA) return null;

    const constructionContract = indirectsA.contractTotal;
    const ownerSoft = softA.totals.softBase;
    const escalation = softA.totals.escalationAmount;
    const landAcquisition = landCostA || 0;

    return {
      constructionContract,
      landAcquisition,
      ownerSoft,
      escalation,
      grandTotal: constructionContract + landAcquisition + ownerSoft + escalation,
    };
  }, [resultA, indirectsA, softA, landCostA]);

  const grandTotalB = useMemo(() => {
    if (!compareMode || !resultB || !indirectsB || !softB) return null;

    const constructionContract = indirectsB.contractTotal;
    const ownerSoft = softB.totals.softBase;
    const escalation = softB.totals.escalationAmount;
    const landAcquisition = landCostB || 0;

    return {
      constructionContract,
      landAcquisition,
      ownerSoft,
      escalation,
      grandTotal: constructionContract + landAcquisition + ownerSoft + escalation,
    };
  }, [compareMode, resultB, indirectsB, softB, landCostB]);

  // ---------------------------------------------------------------------------
  // Key Drivers — comparisons vs a baseline location + baseline typology
  // These are DIRECT Hard Costs comparisons (before Construction Indirects).
  // ---------------------------------------------------------------------------

  const baselineBenchmarkA_Typology = useMemo(() => {
    return buildAdjustedBenchmark(mixedBenchmarkA, locationFactorA, baselineTypology);
  }, [mixedBenchmarkA, locationFactorA, baselineTypology]);

  const baselineBenchmarkA_Location = useMemo(() => {
    return buildAdjustedBenchmark(mixedBenchmarkA, baselineLocationFactor, typologyA);
  }, [mixedBenchmarkA, baselineLocationFactor, typologyA]);

  const baselineResultA_Typology = useMemo(() => {
    try {
      return computeScenarioResult({ areaSqft, benchmark: baselineBenchmarkA_Typology, selections: Object.values(selA) });
    } catch {
      return null;
    }
  }, [areaSqft, baselineBenchmarkA_Typology, selA]);

  const baselineResultA_Location = useMemo(() => {
    try {
      return computeScenarioResult({ areaSqft, benchmark: baselineBenchmarkA_Location, selections: Object.values(selA) });
    } catch {
      return null;
    }
  }, [areaSqft, baselineBenchmarkA_Location, selA]);

  const driversA_Typology = useMemo(() => {
    if (!resultA || !baselineResultA_Typology) return null;
    return computeDriverLines({ scenario: resultA, baseline: baselineResultA_Typology });
  }, [resultA, baselineResultA_Typology]);

  const driversA_Location = useMemo(() => {
    if (!resultA || !baselineResultA_Location) return null;
    return computeDriverLines({ scenario: resultA, baseline: baselineResultA_Location });
  }, [resultA, baselineResultA_Location]);

  const baselineBenchmarkB_Typology = useMemo(() => {
    if (!compareMode) return null;
    return buildAdjustedBenchmark(mixedBenchmarkB, locationFactorB, baselineTypology);
  }, [compareMode, mixedBenchmarkB, locationFactorB, baselineTypology]);

  const baselineBenchmarkB_Location = useMemo(() => {
    if (!compareMode) return null;
    return buildAdjustedBenchmark(mixedBenchmarkB, baselineLocationFactor, typologyB);
  }, [compareMode, mixedBenchmarkB, baselineLocationFactor, typologyB]);

  const baselineResultB_Typology = useMemo(() => {
    if (!compareMode || !baselineBenchmarkB_Typology) return null;
    try {
      return computeScenarioResult({ areaSqft, benchmark: baselineBenchmarkB_Typology, selections: Object.values(selB) });
    } catch {
      return null;
    }
  }, [compareMode, areaSqft, baselineBenchmarkB_Typology, selB]);

  const baselineResultB_Location = useMemo(() => {
    if (!compareMode || !baselineBenchmarkB_Location) return null;
    try {
      return computeScenarioResult({ areaSqft, benchmark: baselineBenchmarkB_Location, selections: Object.values(selB) });
    } catch {
      return null;
    }
  }, [compareMode, areaSqft, baselineBenchmarkB_Location, selB]);

  const driversB_Typology = useMemo(() => {
    if (!compareMode || !resultB || !baselineResultB_Typology) return null;
    return computeDriverLines({ scenario: resultB, baseline: baselineResultB_Typology });
  }, [compareMode, resultB, baselineResultB_Typology]);

  const driversB_Location = useMemo(() => {
    if (!compareMode || !resultB || !baselineResultB_Location) return null;
    return computeDriverLines({ scenario: resultB, baseline: baselineResultB_Location });
  }, [compareMode, resultB, baselineResultB_Location]);



  const exportClientPack = async () => {
    if (!resultA) {
      alert("Nothing to export yet. Please ensure Scenario A has calculated results.");
      return;
    }

    const generatedAtIso = new Date().toISOString();

    const meta = {
      appVersion: VMX_APP_VERSION,
      datasetName,
      datasetLastUpdated,
      assumptions: datasetAssumptions,
      areaSqft,
      tierLabel: tierLabel(tier),
      scenarioAName: compareMode ? regionA.name : "Scenario",
      scenarioABenchmarkName: `${regionA.name} — ${tierLabel(tier)}`,
      locationFactorA,
      locationFactorB: compareMode ? locationFactorB : undefined,
      interiorTierOverride: interiorTierOverride === "match" ? undefined : interiorTierOverride,
      compareMode,
      scenarioBName: compareMode ? regionB.name : undefined,
      scenarioBBenchmarkName: compareMode ? `${regionB.name} — ${tierLabel(tier)}` : undefined,
      
      // N4S integration (optional)
      n4sProjectId: n4sProjectId || undefined,
      n4sProjectName: n4sProjectName || undefined,
      n4sClientName: n4sClientName || undefined,

      // Scenario modifiers & land
      scenarioALocationId: regionA.id,
      scenarioALocationName: regionA.name,
      scenarioALocationPreset: locationAPreset,
      scenarioATypology: typologyA,
      scenarioALandCost: landCostA || 0,

      scenarioBLocationId: compareMode ? regionB.id : undefined,
      scenarioBLocationName: compareMode ? regionB.name : undefined,
      scenarioBLocationPreset: compareMode ? locationBPreset : undefined,
      scenarioBTypology: compareMode ? typologyB : undefined,
      scenarioBLandCost: compareMode ? (landCostB || 0) : undefined,

      baselineLocationId,
      baselineTypology,

      // Rollups (for client pack summary)
      grandTotalA,
      grandTotalB: compareMode ? grandTotalB : undefined,
      generatedAtIso,
    };

    const deltaRows: DeltaRowExport[] | null =
      compareMode && delta && resultB
        ? delta.rows.map((r) => ({
            categoryId: r.categoryId,
            categoryLabel: r.categoryLabel,
            direction: r.direction,
            deltaCost: r.deltaCost,
            deltaPct: r.deltaPct,
            impactVsATotal: r.absFracOfATotal,
            heat: r.heat,
            isDriver: r.isTopDriver,
          }))
        : null;

    try {
      await exportClientPackZip({
        meta,
        selectionsA: selA,
        resultA,
        indirectsA,
        selectionsB: compareMode ? selB : null,
        resultB: compareMode ? resultB : null,
        indirectsB: compareMode ? indirectsB : null,
        deltaRows,
        softCostsConfig,
        softCostsA: softA ? softA.totals : undefined,
        softCostsB: softB ? softB.totals : undefined,
        cashflowA: softA ? softA.rows : undefined,
        cashflowB: softB ? softB.rows : undefined,
      });
    } catch (e) {
      console.error(e);
      alert("Client pack export failed. Please open the browser console for details.");
    }
  };


  type DriverSummary = ReturnType<typeof computeDriverLines>;

  type LiteScenarioCardProps = {
    title: string;
    subtitle?: string;
    regionName: string;
    locationName: string;
    locationFactor: number;
    typology: TypologyId;
    landCost: number;
    areaSqft: number;
    result: ScenarioResult | null;
    error: string | null;
    indirects: ConstructionIndirects | null;
    softTotals: SoftCostsComputed | undefined;
    grand: { grandTotal: number } | null;
    driversTypology: DriverSummary | null;
    driversLocation: DriverSummary | null;
    watchouts: WatchoutLine[];
  };

  const LiteScenarioCard = (p: LiteScenarioCardProps) => {
    const currency = p.result?.currency ?? "USD";
    const directHard = p.result?.totalCost ?? 0;
    const contractTotal = p.indirects?.contractTotal ?? 0;
    const softTotal = p.softTotals?.totalWithEscalation ?? 0;
    const grandTotal = p.grand?.grandTotal ?? 0;

    const kpis = [
      { k: "Direct Hard Costs", v: directHard ? formatMoney(directHard, currency) : "—" },
      { k: "Construction Contract", v: contractTotal ? formatMoney(contractTotal, currency) : "—" },
      { k: "Owner Soft + Escalation", v: softTotal ? formatMoney(softTotal, currency) : "—" },
      { k: "Land Acquisition", v: p.landCost ? formatMoney(p.landCost, currency) : "—" },
      { k: "All-in Grand Total", v: grandTotal ? formatMoney(grandTotal, currency) : "—" },
      { k: "All-in $/SF", v: grandTotal && p.areaSqft ? formatMoney(grandTotal / p.areaSqft, currency) : "—" },
    ];

    const renderDriver = (title: string, d: DriverSummary | null) => {
      if (!d || !p.result) return <div className="muted">—</div>;
      const top = d.lines.slice(0, 5);
      return (
        <div style={{ marginTop: 10 }}>
          <div className="liteSectionTitle">
            <h3 style={{ fontSize: 14 }}>{title}</h3>
            <div className="muted">Δ Total: {formatMoney(d.totalDeltaCost, currency)} ({formatPct(d.totalDeltaPct)})</div>
          </div>
          <ul className="liteList">
            {top.map((l) => (
              <li key={l.categoryId}>
                <span style={{ fontWeight: 800 }}>{l.label}</span> — {formatMoney(l.deltaCost, currency)} ({formatPct(l.deltaPct)})
              </li>
            ))}
          </ul>
        </div>
      );
    };

    const renderWatchouts = () => {
      if (!p.result || p.watchouts.length === 0) return <div className="muted">No material allocation issues vs tier norms.</div>;
      return (
        <ul className="liteList">
          {p.watchouts.map((w) => (
            <li key={w.categoryId}>
              <span style={{ fontWeight: 900 }}>{w.label}</span> — {w.kind === "under" ? "Under" : "Over"} by {formatPct(w.deltaPct)} (≈ {formatMoney(w.deltaCost, currency)})
            </li>
          ))}
        </ul>
      );
    };

    return (
      <div className="card" style={{ position: "relative" }}>
        <div className="liteScenarioTitle">
          <div>
            <h2 style={{ margin: 0 }}>{p.title}</h2>
            <div className="muted" style={{ marginTop: 4 }}>
              {p.subtitle ? p.subtitle + " • " : ""}
              Dataset: <strong>{p.regionName}</strong> • Location: <strong>{p.locationName}</strong> ({p.locationFactor.toFixed(2)}×) • Typology: <strong>{p.typology}</strong>
            </div>
          </div>
        </div>

        {p.error && (
          <div className="error" style={{ marginTop: 10 }}>
            {p.error}
          </div>
        )}

        <div className="liteKpiGrid">
          {kpis.map((x) => (
            <div key={x.k} className="liteKpi">
              <div className="k">{x.k}</div>
              <div className="v">{x.v}</div>
            </div>
          ))}
        </div>

        {p.result && (
          <>
            <div style={{ marginTop: 14 }}>
              <div className="liteSectionTitle">
                <h3 style={{ fontSize: 14 }}>Allocation Snapshot (Direct Hard Costs)</h3>
                <div className="muted">{formatMoney(directHard, currency)} total</div>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table className="table" style={{ width: "100%", marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th style={{ textAlign: "right" }}>Cost</th>
                      <th style={{ textAlign: "right" }}>% of Direct Hard</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.result.categories.map((c) => (
                      <tr key={c.categoryId}>
                        <td>{c.label}</td>
                        <td style={{ textAlign: "right" }}>{formatMoney(c.cost, currency)}</td>
                        <td style={{ textAlign: "right" }}>{formatPct(c.pctOfTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <div className="liteSectionTitle">
                <h3 style={{ fontSize: 14 }}>Key Cost Drivers</h3>
                <div className="muted">What raised / lowered costs vs baselines</div>
              </div>

              {renderDriver("Typology Impact (vs Suburban)", p.driversTypology)}
              {renderDriver("Location Impact (vs National Avg)", p.driversLocation)}
            </div>

            <div style={{ marginTop: 14 }}>
              <div className="liteSectionTitle">
                <h3 style={{ fontSize: 14 }}>Budget Watchouts</h3>
                <div className="muted">Top allocation risks vs tier norms</div>
              </div>
              {renderWatchouts()}
            </div>
          </>
        )}
      </div>
    );
  };


  return (
    <div className="container">
      <div className="topBar">
        <div>
          <h1>VMX — Visual Matrix</h1>
          {(n4sClientName || n4sProjectName) && (
            <div className="muted" style={{ marginTop: 6, fontWeight: 600 }}>
              {n4sClientName ? `Client: ${n4sClientName}` : ""}{n4sClientName && n4sProjectName ? " • " : ""}{n4sProjectName ? `Project: ${n4sProjectName}` : ""}
            </div>
          )}

        </div>

        <div className="topBarActions noPrint">
          {n4sProjects.length > 0 && (
            <select
              className="input"
              value={n4sProjectId}
              onChange={(e) => {
                const nextId = e.target.value;
                setN4sProjectId(nextId);
                const entry = n4sProjects.find((p) => p.id === nextId);
                if (entry?.context) {
                  applyIncomingContext({ ...entry.context, projectId: entry.id });
                } else if (nextId) {
                  // If N4S hosts VMX in an iframe, it can listen for this request and respond
                  try {
                    window.parent?.postMessage({ type: "N4S_VMX_REQUEST_PROJECT", projectId: nextId }, "*");
                  } catch {
                    // ignore
                  }
                }
              }}
              style={{ maxWidth: 320 }}
              title="Load a saved N4S project"
            >
              <option value="">Load Project…</option>
              {n4sProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          )}

          <div className="modePills" title="Switch dashboard mode">
            <button
              type="button"
              className={`modePillBtn ${uiMode === "lite" ? "active" : ""}`}
              onClick={() => setUiMode("lite")}
            >
              Lite
            </button>
            {allowProMode && (
              <button
                type="button"
                className={`modePillBtn ${uiMode === "pro" ? "active" : ""}`}
                onClick={() => setUiMode("pro")}
              >
                Pro
              </button>
            )}
          </div>

          <button type="button" className="docsBtn" onClick={() => setShowDocs(true)}>
            Documentation
          </button>
        </div>
      </div>

      {/* Print-only header (PDF export) */}
      <div className="printOnly printHeader">
        <div className="printHeaderTitle">VMX — Visual Matrix Report</div>
        <div className="printHeaderMeta">
          <div><strong>Dataset:</strong> {datasetName}</div>
          <div><strong>Updated:</strong> {datasetLastUpdated}</div>
          <div><strong>Area:</strong> {areaSqft.toLocaleString()} sq ft</div>
          <div><strong>Tier:</strong> {tierLabel(tier)}</div>
          {n4sClientName && <div><strong>Client:</strong> {n4sClientName}</div>}
          {n4sProjectName && <div><strong>Project:</strong> {n4sProjectName}</div>}
          <div><strong>Scenario A:</strong> {regionA.name} (×{locationFactorA.toFixed(2)}) • {typologyLabel(typologyA)} • Land {formatMoney(landCostA || 0, "USD")}</div>
          {compareMode && (
            <div>
              <strong>Scenario B:</strong> {regionB.name} (×{locationFactorB.toFixed(2)}) • {typologyLabel(typologyB)} • Land {formatMoney(landCostB || 0, "USD")}
            </div>
          )}
        </div>
      </div>


      {showDocs && (
        <DocumentationOverlay onClose={() => setShowDocs(false)} onExportPdf={exportPdfReport} />
      )}

      {uiMode === "lite" ? (
        <>
          <div className="card">
            <div className="adminHeader">
              <div>
                <h2>VMX Lite — Client Dashboard</h2>
                <div className="muted">
                  High-level budget trajectory (VMX Pro remains available for the professional team).
                </div>
              </div>
              {allowProMode && (
                <button type="button" className="secondaryBtn" onClick={() => setUiMode("pro")}
                  title="Open the full VMX professional interface">
                  Open VMX Pro
                </button>
              )}
            </div>

            <div className="adminTopGrid">
              <div>
                <label className="label">Client Name</label>
                <input
                  type="text"
                  value={n4sClientName}
                  placeholder="e.g., Anderson Family"
                  onChange={(e) => setN4sClientName(e.target.value)}
                />
              </div>

              <div>
                <label className="label">Project Name</label>
                <input
                  type="text"
                  value={n4sProjectName}
                  placeholder="e.g., Thornwood Estate"
                  onChange={(e) => setN4sProjectName(e.target.value)}
                />
              </div>

              <div>
                <label className="label">Target Area (sq ft)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={areaSqftInput}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setAreaSqftInput(raw);
                    const cleaned = raw.replace(/[^0-9]/g, "");
                    const n = Number(cleaned);
                    if (Number.isFinite(n) && n > 0) setAreaSqft(Math.round(n));
                  }}
                />
              </div>

              <div>
                <label className="label">Quality Tier</label>
                <select value={tier} onChange={(e) => setTier(e.target.value as any)}>
                  {TIERS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="switchRow" style={{ marginTop: 10 }}>
              <label className="label" style={{ margin: 0 }}>
                Compare Mode
              </label>
              <label className="switch">
                <input type="checkbox" checked={compareMode} onChange={(e) => setCompareMode(e.target.checked)} />
                <span className="slider" />
              </label>
            </div>

            <div className={compareMode ? "compareGrid" : ""} style={{ marginTop: 14 }}>
              <div>
                <h3 className="sectionTitle">Scenario A</h3>

                <div className="formRow">
                  <label className="label">Benchmark Set</label>
                  <select value={regionAId} onChange={(e) => setRegionAId(e.target.value)}>
                    {library.regions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="formRow">
                  <label className="label">Location</label>
                  <select value={locationAPreset} onChange={(e) => setLocationAPreset(e.target.value as any)}>
                    {LOCATION_PRESETS.map((lp) => (
                      <option key={lp.id} value={lp.id}>
                        {lp.label}
                      </option>
                    ))}
                  </select>
                </div>

                {locationAPreset === "custom" && (
                  <div className="formRow">
                    <label className="label">Custom Location Multiplier</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={locationFactorAInput}
                      onChange={(e) => setLocationFactorAInput(e.target.value)}
                    />
                  </div>
                )}

                <div className="formRow">
                  <label className="label">Site Typology</label>
                  <select value={typologyA} onChange={(e) => setTypologyA(e.target.value as any)}>
                    {TYPOLOGIES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="formRow">
                  <label className="label">Land Acquisition Cost</label>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={landCostA}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setLandCostA(Number.isFinite(next) ? next : 0);
                    }}
                  />
                </div>
              </div>

              {compareMode && (
                <div>
                  <h3 className="sectionTitle">Scenario B</h3>

                  <div className="formRow">
                    <label className="label">Benchmark Set</label>
                    <select value={regionBId} onChange={(e) => setRegionBId(e.target.value)}>
                      {library.regions.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="formRow">
                    <label className="label">Location</label>
                    <select value={locationBPreset} onChange={(e) => setLocationBPreset(e.target.value as any)}>
                      {LOCATION_PRESETS.map((lp) => (
                        <option key={lp.id} value={lp.id}>
                          {lp.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {locationBPreset === "custom" && (
                    <div className="formRow">
                      <label className="label">Custom Location Multiplier</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={locationFactorBInput}
                        onChange={(e) => setLocationFactorBInput(e.target.value)}
                      />
                    </div>
                  )}

                  <div className="formRow">
                    <label className="label">Site Typology</label>
                    <select value={typologyB} onChange={(e) => setTypologyB(e.target.value as any)}>
                      {TYPOLOGIES.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="formRow">
                    <label className="label">Land Acquisition Cost</label>
                    <input
                      type="number"
                      min={0}
                      step={1000}
                      value={landCostB}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        setLandCostB(Number.isFinite(next) ? next : 0);
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {(errorA || (compareMode && errorB)) && (
            <div className="card" style={{ borderColor: "rgba(220, 38, 38, 0.35)" }}>
              <h3 style={{ marginTop: 0 }}>Scenario Error</h3>
              {errorA && <div style={{ marginBottom: 6 }}>Scenario A: {errorA}</div>}
              {compareMode && errorB && <div>Scenario B: {errorB}</div>}
            </div>
          )}

          <div className={compareMode ? "compareGrid" : ""}>
            <LiteScenarioCard
              title="Scenario A"
              subtitle={`${regionA?.label ?? ""}`}
              regionName={regionA?.label ?? ""}
              locationName={locationLabel(locationAPreset)}
              locationFactor={locationFactorA}
              typology={typologyA}
              landAcquisitionCost={landCostA}
              result={resultA}
              indirects={indirectsA}
              soft={softA}
              grandTotal={grandTotalA}
              driversTypology={driversA_Typology}
              driversLocation={driversA_Location}
              watchouts={watchoutsA}
            />

            {compareMode && (
              <LiteScenarioCard
                title="Scenario B"
                subtitle={`${regionB?.label ?? ""}`}
                regionName={regionB?.label ?? ""}
                locationName={locationLabel(locationBPreset)}
                locationFactor={locationFactorB}
                typology={typologyB}
                landAcquisitionCost={landCostB}
                result={resultB}
                indirects={indirectsB}
                soft={softB}
                grandTotal={grandTotalB}
                driversTypology={driversB_Typology}
                driversLocation={driversB_Location}
                watchouts={watchoutsB}
              />
            )}
          </div>

          {compareMode && delta && (
            <div className="card">
              <h3 className="sectionTitle">Scenario A vs B — Key Differences</h3>
              <div className="muted" style={{ marginBottom: 10 }}>
                Delta is shown as <strong>B − A</strong> across each category.
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th style={{ textAlign: "right" }}>Delta ($)</th>
                    <th style={{ textAlign: "right" }}>Delta (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {delta.rows.slice(0, 8).map((r) => (
                    <tr key={r.categoryId}>
                      <td>{r.label}</td>
                      <td style={{ textAlign: "right" }}>{formatMoney(r.deltaCost)}</td>
                      <td style={{ textAlign: "right" }}>{formatPct(r.deltaPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="provenanceBar">
            <div>
              <strong>VMX Engine:</strong> Uniformat II category allocation + guardrails + location damping + typology modifiers.
            </div>
            <div className="muted">N4S | VMX Lite</div>
          </div>

          <div className="footerActions noPrint">
            <button type="button" className="docsBtn" onClick={exportPdfReport}>
              Export PDF Report
            </button>
            <button type="button" className="secondaryBtn" onClick={exportClientPack}>
              Export Client Pack (.zip)
            </button>
          </div>
        </>
      ) : (
        <>
      <div className="card">
        <div className="adminHeader">
          <div>
            <h2>Compare Setup</h2>
            <div className="muted">Compare two regions at the same tier. Units: sq ft.</div>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 900 }}>
            <input type="checkbox" checked={compareMode} onChange={(e) => setCompareMode(e.target.checked)} />
            Compare Mode
          </label>
        </div>

        <div className="adminTopGrid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label className="label">Client Name (for PDF / exports)</label>
            <input
              className="input"
              value={n4sClientName}
              onChange={(e) => setN4sClientName(e.target.value)}
              placeholder="Client name"
            />
          </div>

          <div>
            <label className="label">Project Name (for PDF / exports)</label>
            <input
              className="input"
              value={n4sProjectName}
              onChange={(e) => setN4sProjectName(e.target.value)}
              placeholder="Project name"
            />
          </div>
        </div>

        <div className="adminTopGrid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div>
            <label className="label">Area (sq ft)</label>
            <input className="input" type="number" min={1} value={areaSqft} onChange={(e) => setAreaSqft(Number(e.target.value))} />
          </div>

          <div>
            <label className="label">Tier</label>
            <select className="input" value={tier} onChange={(e) => setTier(e.target.value as TierId)}>
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {tierLabel(t)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Benchmark Editor Target</label>
            <select
              className="input"
              value={adminRegionId}
              onChange={(e) => setAdminRegionId(e.target.value)}
              disabled={!compareMode}
              title={!compareMode ? "Enable Compare Mode to switch editor target" : undefined}
            >
              <option value={regionA.id}>Scenario A — {regionA.name}</option>
              <option value={regionB.id}>Scenario B — {regionB.name}</option>
            </select>
          </div>
        </div>


        <div className="adminTopGrid" style={{ gridTemplateColumns: "1fr" }}>
          <div>
            <label className="label">Interiors + FF&amp;E Package (4-tier override)</label>
            <select
              className="input"
              value={interiorTierOverride}
              onChange={(e) => setInteriorTierOverride(e.target.value)}
            >
              <option value="match">Match overall Tier ({tierLabel(tier)})</option>
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {tierLabel(t)}
                </option>
              ))}
            </select>
            <div className="muted" style={{ marginTop: 6 }}>
              Overrides the benchmark for <span className="mono">Interiors</span> + <span className="mono">Equipment &amp; Furnishings</span> only.
            </div>
          </div>
        </div>

        <div className="adminTopGrid" style={{ gridTemplateColumns: compareMode ? "1fr 1fr" : "1fr" }}>
          <div>
            <label className="label">Scenario A — Region</label>
            <select className="input" value={regionAId} onChange={(e) => setRegionAId(e.target.value)}>
              {library.regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>

            <label className="label" style={{ marginTop: 10 }}>Scenario A — Location</label>
            <select className="input" value={locationAPreset} onChange={(e) => setLocationAPreset(e.target.value)}>
              {LOCATION_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}{p.id !== "custom" ? ` (×${p.factor.toFixed(2)})` : ""}
                </option>
              ))}
            </select>
            {locationAPreset === "custom" && (
              <input
                className="input"
                type="number"
                min={0.5}
                step={0.01}
                value={locationACustom}
                onChange={(e) => setLocationACustom(Number(e.target.value))}
                placeholder="1.00"
              />
            )}
            <div className="muted" style={{ marginTop: 6 }}>
              Effective multiplier: <span className="mono">×{locationFactorA.toFixed(2)}</span>
            </div>

            <label className="label" style={{ marginTop: 10 }}>Scenario A — Typology</label>
            <select className="input" value={typologyA} onChange={(e) => setTypologyA(e.target.value as TypologyId)}>
              {TYPOLOGY_PRESETS.map((tp) => (
                <option key={tp.id} value={tp.id}>
                  {tp.label}
                </option>
              ))}
            </select>
            <div className="muted" style={{ marginTop: 6 }}>
              Applies category-specific site impacts (e.g., Hillside increases Substructure + Exterior Works).
            </div>


            <label className="label" style={{ marginTop: 10 }}>Scenario A — Land Acquisition Cost (USD)</label>
            <input
              className="input"
              type="number"
              min={0}
              step={1000}
              value={landCostA}
              onChange={(e) => setLandCostA(Number(e.target.value) || 0)}
              placeholder="0"
            />
            <div className="muted" style={{ marginTop: 6 }}>
              Included in <strong>Grand Total (All-in)</strong> and PDF / Client Pack exports.
            </div>
          </div>

          {compareMode && (
            <div>
              <label className="label">Scenario B — Region</label>
              <select className="input" value={regionBId} onChange={(e) => setRegionBId(e.target.value)}>
                {library.regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>

              <label className="label" style={{ marginTop: 10 }}>Scenario B — Location</label>
              <select className="input" value={locationBPreset} onChange={(e) => setLocationBPreset(e.target.value)}>
                {LOCATION_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}{p.id !== "custom" ? ` (×${p.factor.toFixed(2)})` : ""}
                  </option>
                ))}
              </select>
              {locationBPreset === "custom" && (
                <input
                  className="input"
                  type="number"
                  min={0.5}
                  step={0.01}
                  value={locationBCustom}
                  onChange={(e) => setLocationBCustom(Number(e.target.value))}
                  placeholder="1.00"
                />
              )}
              <div className="muted" style={{ marginTop: 6 }}>
                Effective multiplier: <span className="mono">×{locationFactorB.toFixed(2)}</span>
              </div>

              <label className="label" style={{ marginTop: 10 }}>Scenario B — Typology</label>
              <select className="input" value={typologyB} onChange={(e) => setTypologyB(e.target.value as TypologyId)}>
                {TYPOLOGY_PRESETS.map((tp) => (
                  <option key={tp.id} value={tp.id}>
                    {tp.label}
                  </option>
                ))}
              </select>
              <div className="muted" style={{ marginTop: 6 }}>
                Applies category-specific site impacts.
              </div>


              <label className="label" style={{ marginTop: 10 }}>Scenario B — Land Acquisition Cost (USD)</label>
              <input
                className="input"
                type="number"
                min={0}
                step={1000}
                value={landCostB}
                onChange={(e) => setLandCostB(Number(e.target.value) || 0)}
                placeholder="0"
              />
              <div className="muted" style={{ marginTop: 6 }}>
                Included in <strong>Grand Total (All-in)</strong> and PDF / Client Pack exports.
              </div>
            </div>
          )}
        </div>

        {!compareMode && (
          <div className="muted" style={{ marginTop: 8 }}>
            Enable Compare Mode to select Scenario B and view deltas.
          </div>
        )}
      </div>

      {!compareMode ? (
        <Matrix
          title="Scenario"
          areaSqft={areaSqft}
          setAreaSqft={setAreaSqft}
          benchmark={benchmarkA}
          selections={selA}
          setBand={setBandA}
          result={resultA}
          error={errorA}
        />
      ) : (
        <>
          <div className="compareGrid">
            <Matrix
              title={`Scenario A — ${regionA.name}`}
              areaSqft={areaSqft}
              setAreaSqft={setAreaSqft}
              showAreaInput={false}
              benchmark={benchmarkA}
              selections={selA}
              setBand={setBandA}
              result={resultA}
              error={errorA}
            />
            <Matrix
              title={`Scenario B — ${regionB.name}`}
              areaSqft={areaSqft}
              setAreaSqft={setAreaSqft}
              showAreaInput={false}
              benchmark={benchmarkB}
              selections={selB}
              setBand={setBandB}
              result={resultB}
              error={errorB}
            />
          </div>

          <div className="card">
            <h2>Delta Heat (B − A)</h2>

            {!delta || !resultA || !resultB ? (
              <div className="muted">Select two regions and adjust bands to see deltas.</div>
            ) : (
              <>
                <div className="adminTopGrid" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr", marginBottom: 10 }}>
                  <div>
                    <label className="label">Medium heat threshold (%)</label>
                    <input
                      className="input"
                      type="number"
                      step="0.1"
                      value={pctToInput(deltaMediumThr)}
                      onChange={(e) => {
                        const next = Math.max(0, inputToPct(e.target.value));
                        setDeltaMediumThr(next);
                        if (deltaHighThr < next) setDeltaHighThr(next);
                      }}
                    />
                  </div>

                  <div>
                    <label className="label">High heat threshold (%)</label>
                    <input
                      className="input"
                      type="number"
                      step="0.1"
                      value={pctToInput(deltaHighThr)}
                      onChange={(e) => {
                        const next = Math.max(deltaMediumThr, inputToPct(e.target.value));
                        setDeltaHighThr(next);
                      }}
                    />
                  </div>

                  <div>
                    <label className="label">Sort</label>
                    <select className="input" value={deltaSort} onChange={(e) => setDeltaSort(e.target.value as DeltaSortMode)}>
                      <option value="impact">Impact (|Δ Cost|)</option>
                      <option value="category">Category order</option>
                    </select>
                  </div>

                  <div>
                    <label className="label">Filter</label>
                    <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 900, marginTop: 6 }}>
                      <input type="checkbox" checked={deltaDriversOnly} onChange={(e) => setDeltaDriversOnly(e.target.checked)} />
                      Drivers only
                    </label>
                  </div>
                </div>

                <div className="summaryTop">
                  <div>
                    <div className="label">Total Delta</div>
                    <div className="big">{formatMoney(delta.totalDelta, delta.currency)}</div>
                  </div>
                  <div>
                    <div className="label">A Total</div>
                    <div className="big">{formatMoney(delta.aTotal, delta.currency)}</div>
                  </div>
                  <div>
                    <div className="label">B Total</div>
                    <div className="big">{formatMoney(delta.bTotal, delta.currency)}</div>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                  <div>
                    <div className="label">Largest increases (B higher than A)</div>
                    {delta.increases.length === 0 ? (
                      <div className="muted">None</div>
                    ) : (
                      <ul style={{ margin: "6px 0 0 18px" }}>
                        {delta.increases.map((r) => (
                          <li key={r.categoryId}>
                            <strong>{r.categoryLabel}</strong> — {formatMoney(r.deltaCost, delta.currency)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <div className="label">Largest decreases (B lower than A)</div>
                    {delta.decreases.length === 0 ? (
                      <div className="muted">None</div>
                    ) : (
                      <ul style={{ margin: "6px 0 0 18px" }}>
                        {delta.decreases.map((r) => (
                          <li key={r.categoryId}>
                            <strong>{r.categoryLabel}</strong> — {formatMoney(r.deltaCost, delta.currency)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <table className="table small">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Direction</th>
                      <th>Δ Cost</th>
                      <th>Δ % of Total</th>
                      <th>Impact vs A</th>
                      <th>Heat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {delta.rows.map((r) => {
                      const dirLabel = r.direction === "increase" ? "Increase" : r.direction === "decrease" ? "Decrease" : "Flat";
                      const heatLabel = r.heat === "high" ? "High" : r.heat === "medium" ? "Medium" : "Low";

                      const impactPctLabel = `${(r.absFracOfATotal * 100).toFixed(1)}%`;
                      const denom = deltaHighThr > 0 ? deltaHighThr : 0.0001;
                      const barWidth = Math.min(1, r.absFracOfATotal / denom) * 100;

                      return (
                        <tr key={r.categoryId} className={`deltaRow ${r.heat} ${r.isTopDriver ? "top" : ""}`}>
                          <td>{r.categoryLabel}</td>
                          <td>
                            <span className={`deltaPill ${r.direction}`}>{dirLabel}</span>
                          </td>
                          <td>{formatMoney(r.deltaCost, delta.currency)}</td>
                          <td>{formatPct(r.deltaPct)}</td>
                          <td>
                            <div className="deltaImpact">
                              <div className="deltaImpactPct">{impactPctLabel}</div>
                              <div className="deltaBarWrap" aria-hidden="true">
                                <div className={`deltaBar ${r.direction}`} style={{ width: `${barWidth}%` }} />
                              </div>
                            </div>
                          </td>
                          <td>
                            <strong>{heatLabel}</strong>
                            {r.isTopDriver ? <span className="muted"> (driver)</span> : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <div className="muted" style={{ marginTop: 10 }}>
                  Heat is based on |Δ Cost| versus Scenario A total. Medium ≥ {pctToInput(deltaMediumThr)}% and High ≥ {pctToInput(deltaHighThr)}%. Drivers are {driverMode === "topN" ? `the top ${driverTopN} non-zero |Δ Cost| categories` : `categories with impact ≥ ${pctToInput(driverPctThreshold)}% (cap ${driverPctMaxDrivers})`}.
                </div>
              </>
            )}
          </div>

          {/* Advisory readout – compare mode only */}
          <AdvisoryReadout
            compareMode={compareMode}
            scenarioAName={regionA.name}
            scenarioBName={regionB.name}
            resultA={resultA}
            resultB={resultB}
          />
        </>
      )}

      <BenchmarkLibraryAdmin
        library={library}
        setLibrary={setLibrary}
        regionId={adminRegion.id}
        setRegionId={setAdminRegionId}
        tier={tier}
        setTier={setTier}
        currentBenchmark={currentBenchmarkForAdmin}
        onResetSelectedTier={resetCurrentTierToDemo}
      >
        <BenchmarkAdmin benchmark={currentBenchmarkForAdmin} setBenchmark={setCurrentBenchmark} />
      </BenchmarkLibraryAdmin>


      <div className="card" style={{ marginTop: 12 }}>
        <div className="adminHeader">
          <div>
            <h2>Admin — Guardrails & Provenance</h2>
            <div className="muted">
              Configure delta heat thresholds, driver rules, and export provenance metadata. (Category target bands live in Benchmark Admin above.)
            </div>
          </div>

          <div className="adminHeaderBtns noPrint">
            <button type="button" className="secondaryBtn" onClick={() => setShowGuardrails((p) => !p)}>
              {showGuardrails ? "Hide Guardrails" : "Show Guardrails"}
            </button>
          </div>
        </div>

        {showGuardrails ? (
          <AdminGuardrails
            value={{
              datasetName,
              datasetLastUpdated,
              datasetAssumptions,
              autoStampOnBenchmarkChange,
              deltaMediumThr,
              deltaHighThr,
              deltaSort,
              deltaDriversOnly,
              driverMode,
              driverTopN,
              driverPctThreshold,
              driverPctMaxDrivers,
            }}
            onChange={(next: GuardrailsState) => {
              setDatasetName(next.datasetName);
              setDatasetLastUpdated(next.datasetLastUpdated);
              setDatasetAssumptions(next.datasetAssumptions);
              setAutoStampOnBenchmarkChange(next.autoStampOnBenchmarkChange);

              setDeltaMediumThr(next.deltaMediumThr);
              setDeltaHighThr(next.deltaHighThr);
              setDeltaSort(next.deltaSort);
              setDeltaDriversOnly(next.deltaDriversOnly);

              setDriverMode(next.driverMode);
              setDriverTopN(next.driverTopN);
              setDriverPctThreshold(next.driverPctThreshold);
              setDriverPctMaxDrivers(next.driverPctMaxDrivers);
            }}
            onStampNow={() => setDatasetLastUpdated(formatProvenanceDate(new Date()))}
            onResetDefaults={() => {
              setDatasetName("US — Reserve (VMX Demo)");
              setDatasetLastUpdated(formatProvenanceDate(new Date()));
              setDatasetAssumptions(
                "Guardrails calibrated for early-stage DIRECT hard costs; benchmarks are $/sf by category; targets are directional ranges (not contract pricing). Construction Indirects (GC fee/conditions/contingency) are calculated separately."
              );
              setAutoStampOnBenchmarkChange(true);

              setDeltaMediumThr(0.015);
              setDeltaHighThr(0.03);
              setDeltaSort("impact");
              setDeltaDriversOnly(false);

              setDriverMode("topN");
              setDriverTopN(3);
              setDriverPctThreshold(0.02);
              setDriverPctMaxDrivers(7);
            }}
          />
        ) : (
          <div className="muted" style={{ marginTop: 10 }}>
            Guardrails hidden. Click “Show Guardrails” to edit thresholds, driver rules, and provenance.
          </div>
        )}
      </div>

      <SnapshotPanel current={resultA} />

      <ConstructionIndirectsPanel
        areaSqft={areaSqft}
        currency={resultA?.currency ?? "USD"}
        tier={tier}
        cfg={constructionIndirectsConfig}
        setCfg={setConstructionIndirectsConfig}
        resultA={resultA}
        resultB={resultB}
        compareMode={compareMode}
      />


      <SoftCostsCashflowPanel
        visibleToAll={true}
        currency={resultA?.currency ?? "USD"}
        compareMode={compareMode}
        scenarioAName={regionA.name}
        scenarioBName={regionB.name}
        resultA={resultA}
        resultB={resultB}
        config={softCostsConfig}
        setConfig={setSoftCostsConfig}
      />


      <div className="card" style={{ marginTop: 18 }}>
        <div className="cardHeader">
          <div>
            <div className="cardTitle">Key Drivers — Location & Typology</div>
            <div className="muted">
              Direct Hard Costs only. Shows category movements ≥ 5% when compared against a baseline typology and a baseline location.
            </div>
          </div>
        </div>

        <div className="grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <label className="muted" style={{ display: "block", marginBottom: 4 }}>
                  Baseline Location
                </label>
                <select
                  value={baselineLocationPreset}
                  onChange={(e) => setBaselineLocationPreset(e.target.value)}
                  style={{ padding: "8px 10px", borderRadius: 8 }}
                >
                  {LOCATION_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              {baselineLocationPreset === "custom" && (
                <div>
                  <label className="muted" style={{ display: "block", marginBottom: 4 }}>
                    Baseline Factor
                  </label>
                  <input
                    type="number"
                    step={0.01}
                    min={0.5}
                    max={3}
                    value={baselineLocationCustom}
                    onChange={(e) => setBaselineLocationCustom(Number(e.target.value))}
                    style={{ padding: "8px 10px", width: 130, borderRadius: 8 }}
                  />
                </div>
              )}

              <div>
                <label className="muted" style={{ display: "block", marginBottom: 4 }}>
                  Baseline Typology
                </label>
                <select
                  value={baselineTypology}
                  onChange={(e) => setBaselineTypology(e.target.value as TypologyId)}
                  style={{ padding: "8px 10px", borderRadius: 8 }}
                >
                  {TYPOLOGY_PRESETS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="muted" style={{ marginLeft: "auto" }}>
                Baseline = {presetLabel(baselineLocationPreset)} (×{baselineLocationFactor.toFixed(2)}) • {typologyLabel(baselineTypology)}
              </div>
            </div>
          </div>

          {/* Scenario A drivers */}
          <div className="card" style={{ padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
              <div style={{ fontWeight: 700 }}>Scenario A — {regionA.name}</div>
              <div className="muted">
                {typologyLabel(typologyA)} • {presetLabel(locationAPreset)} (×{locationFactorA.toFixed(2)})
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 600 }}>Typology impact</div>
              <div className="muted" style={{ marginTop: 2 }}>
                {typologyLabel(typologyA)} vs {typologyLabel(baselineTypology)} (same location)
              </div>
              {driversA_Typology ? (
                <>
                  <div style={{ marginTop: 6 }}>
                    Overall: {formatMoney(driversA_Typology.totalDeltaCost, resultA.currency)} ({formatPct(driversA_Typology.totalDeltaPct)})
                  </div>
                  {driversA_Typology.lines.length > 0 ? (
                    <ul style={{ margin: "8px 0 0 18px" }}>
                      {driversA_Typology.lines.map((l) => (
                        <li key={`a_t_${l.categoryId}`}>
                          {l.label}: {formatMoney(l.deltaCost, resultA.currency)} ({formatPct(l.deltaPct)})
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="muted" style={{ marginTop: 6 }}>
                      No category moved ≥ 5%.
                    </div>
                  )}
                </>
              ) : (
                <div className="muted" style={{ marginTop: 6 }}>
                  —
                </div>
              )}
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 600 }}>Location impact</div>
              <div className="muted" style={{ marginTop: 2 }}>
                {presetLabel(locationAPreset)} (×{locationFactorA.toFixed(2)}) vs {presetLabel(baselineLocationPreset)} (×{baselineLocationFactor.toFixed(2)}) (same typology)
              </div>
              {driversA_Location ? (
                <>
                  <div style={{ marginTop: 6 }}>
                    Overall: {formatMoney(driversA_Location.totalDeltaCost, resultA.currency)} ({formatPct(driversA_Location.totalDeltaPct)})
                  </div>
                  {driversA_Location.lines.length > 0 ? (
                    <ul style={{ margin: "8px 0 0 18px" }}>
                      {driversA_Location.lines.map((l) => (
                        <li key={`a_l_${l.categoryId}`}>
                          {l.label}: {formatMoney(l.deltaCost, resultA.currency)} ({formatPct(l.deltaPct)})
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="muted" style={{ marginTop: 6 }}>
                      No category moved ≥ 5%.
                    </div>
                  )}
                </>
              ) : (
                <div className="muted" style={{ marginTop: 6 }}>
                  —
                </div>
              )}
            </div>

            <div className="muted" style={{ marginTop: 10 }}>
              Tip: High-cost locations damp Interiors &amp; FF&amp;E (half the uplift) when the global multiplier is &gt; 1.10.
            </div>
          </div>

          {/* Scenario B drivers */}
          {compareMode && resultB ? (
            <div className="card" style={{ padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                <div style={{ fontWeight: 700 }}>Scenario B — {regionB.name}</div>
                <div className="muted">
                  {typologyLabel(typologyB)} • {presetLabel(locationBPreset)} (×{locationFactorB.toFixed(2)})
                </div>
              </div>

              <div style={{ marginTop: 10 }}>
                <div style={{ fontWeight: 600 }}>Typology impact</div>
                <div className="muted" style={{ marginTop: 2 }}>
                  {typologyLabel(typologyB)} vs {typologyLabel(baselineTypology)} (same location)
                </div>
                {driversB_Typology ? (
                  <>
                    <div style={{ marginTop: 6 }}>
                      Overall: {formatMoney(driversB_Typology.totalDeltaCost, resultB.currency)} ({formatPct(driversB_Typology.totalDeltaPct)})
                    </div>
                    {driversB_Typology.lines.length > 0 ? (
                      <ul style={{ margin: "8px 0 0 18px" }}>
                        {driversB_Typology.lines.map((l) => (
                          <li key={`b_t_${l.categoryId}`}>
                            {l.label}: {formatMoney(l.deltaCost, resultB.currency)} ({formatPct(l.deltaPct)})
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="muted" style={{ marginTop: 6 }}>
                        No category moved ≥ 5%.
                      </div>
                    )}
                  </>
                ) : (
                  <div className="muted" style={{ marginTop: 6 }}>
                    —
                  </div>
                )}
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={{ fontWeight: 600 }}>Location impact</div>
                <div className="muted" style={{ marginTop: 2 }}>
                  {presetLabel(locationBPreset)} (×{locationFactorB.toFixed(2)}) vs {presetLabel(baselineLocationPreset)} (×{baselineLocationFactor.toFixed(2)}) (same typology)
                </div>
                {driversB_Location ? (
                  <>
                    <div style={{ marginTop: 6 }}>
                      Overall: {formatMoney(driversB_Location.totalDeltaCost, resultB.currency)} ({formatPct(driversB_Location.totalDeltaPct)})
                    </div>
                    {driversB_Location.lines.length > 0 ? (
                      <ul style={{ margin: "8px 0 0 18px" }}>
                        {driversB_Location.lines.map((l) => (
                          <li key={`b_l_${l.categoryId}`}>
                            {l.label}: {formatMoney(l.deltaCost, resultB.currency)} ({formatPct(l.deltaPct)})
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="muted" style={{ marginTop: 6 }}>
                        No category moved ≥ 5%.
                      </div>
                    )}
                  </>
                ) : (
                  <div className="muted" style={{ marginTop: 6 }}>
                    —
                  </div>
                )}
              </div>

              <div className="muted" style={{ marginTop: 10 }}>
                Tip: Typology modifiers are category-targeted (e.g., Hillside raises Substructure + External Works far more than Interiors).
              </div>
            </div>
          ) : (
            <div className="card" style={{ padding: 12 }}>
              <div className="muted">Enable Compare Mode to generate Scenario B key drivers.</div>
            </div>
          )}
        </div>
      </div>


      <div className="card grandTotalCard" style={{ marginTop: 18 }}>
        <div className="cardHeader">
          <div>
            <div className="cardTitle">Grand Total Project Cost</div>
            <div className="muted">
              Direct Hard Costs + Construction Indirects + Soft Costs + Escalation (US roll-up)
            </div>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "10px 8px" }}>Line Item</th>
                <th style={{ textAlign: "right", padding: "10px 8px" }}>{regionA.name}</th>
                {compareMode && <th style={{ textAlign: "right", padding: "10px 8px" }}>{regionB.name}</th>}
                {compareMode && <th style={{ textAlign: "right", padding: "10px 8px" }}>Delta</th>}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: "8px" }}>Direct Hard Costs (7 categories)</td>
                <td style={{ textAlign: "right", padding: "8px" }}>{formatMoney(resultA.totalCost, resultA.currency)}</td>
                {compareMode && resultB && <td style={{ textAlign: "right", padding: "8px" }}>{formatMoney(resultB.totalCost, resultB.currency)}</td>}
                {compareMode && resultB && (
                  <td style={{ textAlign: "right", padding: "8px" }}>
                    {formatMoney(resultB.totalCost - resultA.totalCost, resultA.currency)}
                  </td>
                )}
              </tr>

              <tr>
                <td style={{ padding: "8px" }}>Construction Indirects (GCs + fee + contingency + GL)</td>
                <td style={{ textAlign: "right", padding: "8px" }}>
                  {indirectsA ? formatMoney(indirectsA.totalIndirects, resultA.currency) : "—"}
                </td>
                {compareMode && (
                  <td style={{ textAlign: "right", padding: "8px" }}>
                    {indirectsB && resultB ? formatMoney(indirectsB.totalIndirects, resultB.currency) : "—"}
                  </td>
                )}
                {compareMode && (
                  <td style={{ textAlign: "right", padding: "8px" }}>
                    {indirectsB && resultB ? formatMoney(indirectsB.totalIndirects - (indirectsA?.totalIndirects ?? 0), resultA.currency) : "—"}
                  </td>
                )}
              </tr>

              <tr>
                <td style={{ padding: "8px" }}>
                  <strong>Total Construction Contract</strong>
                </td>
                <td style={{ textAlign: "right", padding: "8px" }}>
                  <strong>{indirectsA ? formatMoney(indirectsA.contractTotal, resultA.currency) : "—"}</strong>
                </td>
                {compareMode && (
                  <td style={{ textAlign: "right", padding: "8px" }}>
                    <strong>{indirectsB && resultB ? formatMoney(indirectsB.contractTotal, resultB.currency) : "—"}</strong>
                  </td>
                )}
                {compareMode && (
                  <td style={{ textAlign: "right", padding: "8px" }}>
                    <strong>{indirectsB && resultB ? formatMoney(indirectsB.contractTotal - (indirectsA?.contractTotal ?? 0), resultA.currency) : "—"}</strong>
                  </td>
                )}
              </tr>

              <tr>
                <td style={{ padding: "8px" }}>
                  <strong>Land Acquisition Cost</strong>
                </td>
                <td style={{ textAlign: "right", padding: "8px" }}>
                  <strong>{formatMoney(landCostA || 0, resultA.currency)}</strong>
                </td>
                {compareMode && (
                  <td style={{ textAlign: "right", padding: "8px" }}>
                    <strong>{formatMoney(landCostB || 0, resultA.currency)}</strong>
                  </td>
                )}
                {compareMode && (
                  <td style={{ textAlign: "right", padding: "8px" }}>
                    <strong>{formatMoney((landCostB || 0) - (landCostA || 0), resultA.currency)}</strong>
                  </td>
                )}
              </tr>

              <tr>
                <td style={{ padding: "8px" }}>Soft Costs (Owner-side)</td>
                <td style={{ textAlign: "right", padding: "8px" }}>
                  {softA ? formatMoney(softA.totals.softBase, resultA.currency) : "—"}
                </td>
                {compareMode && (
                  <td style={{ textAlign: "right", padding: "8px" }}>
                    {softB && resultB ? formatMoney(softB.totals.softBase, resultB.currency) : "—"}
                  </td>
                )}
                {compareMode && (
                  <td style={{ textAlign: "right", padding: "8px" }}>
                    {softB && resultB ? formatMoney(softB.totals.softBase - (softA?.totals.softBase ?? 0), resultA.currency) : "—"}
                  </td>
                )}
              </tr>

              <tr>
                <td style={{ padding: "8px" }}>Escalation (per Soft Costs settings)</td>
                <td style={{ textAlign: "right", padding: "8px" }}>
                  {softA ? formatMoney(softA.totals.escalationAmount, resultA.currency) : "—"}
                </td>
                {compareMode && (
                  <td style={{ textAlign: "right", padding: "8px" }}>
                    {softB && resultB ? formatMoney(softB.totals.escalationAmount, resultB.currency) : "—"}
                  </td>
                )}
                {compareMode && (
                  <td style={{ textAlign: "right", padding: "8px" }}>
                    {softB && resultB ? formatMoney(softB.totals.escalationAmount - (softA?.totals.escalationAmount ?? 0), resultA.currency) : "—"}
                  </td>
                )}
              </tr>

              <tr>
                <td style={{ padding: "10px 8px" }}>
                  <strong>GRAND TOTAL (All-in Project Cost)</strong>
                </td>
                <td style={{ textAlign: "right", padding: "10px 8px" }}>
                  <strong>{grandTotalA ? formatMoney(grandTotalA.grandTotal, resultA.currency) : "—"}</strong>
                </td>
                {compareMode && (
                  <td style={{ textAlign: "right", padding: "10px 8px" }}>
                    <strong>{grandTotalB && resultB ? formatMoney(grandTotalB.grandTotal, resultB.currency) : "—"}</strong>
                  </td>
                )}
                {compareMode && (
                  <td style={{ textAlign: "right", padding: "10px 8px" }}>
                    <strong>{grandTotalB && resultB ? formatMoney(grandTotalB.grandTotal - (grandTotalA?.grandTotal ?? 0), resultA.currency) : "—"}</strong>
                  </td>
                )}
              </tr>
            </tbody>
          </table>
        </div>

        <div className="muted" style={{ marginTop: 10 }}>
          Notes: Location uses a global multiplier, with damping on Interiors (Cat 4) &amp; FF&amp;E (Cat 5) when the location factor is &gt; 1.10.
          Typology applies category-targeted modifiers (e.g., Hillside raises Substructure + External Works far more than Interiors). Construction Indirects are
          calculated separately and are typology-adjusted.
        </div>
      </div>



      <div className="provenanceBar">
        <div className="provLine">
          <span className="provStrong">VMX v{VMX_APP_VERSION}</span>
          <span> | Dataset: </span>
          <span className="provStrong">{datasetName}</span>
          <span> | Updated: </span>
          <span className="provStrong">{datasetLastUpdated}</span>
          <span> | Assumptions: </span>
          <span>{datasetAssumptions}</span>
        </div>
      </div>

      <div className="footerActions noPrint">
        <button type="button" className="docsBtn" onClick={exportPdfReport}>
          Export PDF Report
        </button>
        <button type="button" className="secondaryBtn" onClick={exportClientPack}>
          Export Client Pack (.zip)
        </button>
      </div>
    </>
      )}
    </div>
  );
}