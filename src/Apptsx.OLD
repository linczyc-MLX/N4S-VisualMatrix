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

function buildDefaultSelections(): Record<VmxCategoryId, ScenarioSelection> {
  const rec = {} as Record<VmxCategoryId, ScenarioSelection>;
  for (const c of VMX_CATEGORIES) rec[c.id] = { categoryId: c.id, band: "MEDIUM" };
  return rec;
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

  const [showDocs, setShowDocs] = useState(false);
  const [showGuardrails, setShowGuardrails] = useState(false);

  // Soft costs / escalation / cashflow (visible to all; JSON editable)
  const [softCostsConfig, setSoftCostsConfig] = useState<SoftCostsConfig>(() => loadSoftCostsConfig());

  useEffect(() => {
    const cleanup = () => document.body.classList.remove("print-vmx-report");
    window.addEventListener("afterprint", cleanup);
    return () => window.removeEventListener("afterprint", cleanup);
  }, []);

  const exportPdfReport = () => {
    // Close any overlays first so the report prints cleanly
    setShowDocs(false);

    document.body.classList.add("print-vmx-report");
    // Allow styles/layout to apply before printing
    window.setTimeout(() => window.print(), 50);
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
        "Guardrails calibrated for early-stage concept budgeting; benchmarks are $/sf by category; targets are directional ranges (not contract pricing)."
      );
    } catch {
      return "Guardrails calibrated for early-stage concept budgeting; benchmarks are $/sf by category; targets are directional ranges (not contract pricing).";
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


  const regionA = library.regions.find((r) => r.id === regionAId) ?? library.regions[0];
  const regionB = library.regions.find((r) => r.id === regionBId) ?? library.regions[0];

  const benchmarkA: BenchmarkSet = regionA.byTier[tier];
  const benchmarkB: BenchmarkSet = regionB.byTier[tier];

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

  const [errorA, setErrorA] = useState<string | null>(null);
  const [errorB, setErrorB] = useState<string | null>(null);

  const resultA = useMemo(() => {
    try {
      setErrorA(null);
      return computeScenarioResult({
        areaSqft,
        benchmark: benchmarkA,
        selections: Object.values(selA),
      });
    } catch (e) {
      setErrorA(e instanceof Error ? e.message : "Unknown error");
      return null;
    }
  }, [areaSqft, benchmarkA, selA]);

  const resultB = useMemo(() => {
    if (!compareMode) return null;
    try {
      setErrorB(null);
      return computeScenarioResult({
        areaSqft,
        benchmark: benchmarkB,
        selections: Object.values(selB),
      });
    } catch (e) {
      setErrorB(e instanceof Error ? e.message : "Unknown error");
      return null;
    }
  }, [areaSqft, benchmarkB, selB, compareMode]);

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
      compareMode,
      scenarioBName: compareMode ? regionB.name : undefined,
      scenarioBBenchmarkName: compareMode ? `${regionB.name} — ${tierLabel(tier)}` : undefined,
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
        selectionsB: compareMode ? selB : null,
        resultB: compareMode ? resultB : null,
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


  return (
    <div className="container">
      <div className="topBar">
        <div>
          <h1>VMX — Visual Matrix</h1>
          
        </div>

        <div className="topBarActions noPrint">
          <button type="button" className="docsBtn" onClick={() => setShowDocs(true)}>
            Documentation
          </button>
        </div>
      </div>

      {showDocs && (
        <DocumentationOverlay onClose={() => setShowDocs(false)} onExportPdf={exportPdfReport} />
      )}

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

        {compareMode ? (
          <div className="adminTopGrid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <label className="label">Scenario A — Region</label>
              <select className="input" value={regionAId} onChange={(e) => setRegionAId(e.target.value)}>
                {library.regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Scenario B — Region</label>
              <select className="input" value={regionBId} onChange={(e) => setRegionBId(e.target.value)}>
                {library.regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div className="muted">Enable Compare Mode to select Scenario B and view deltas.</div>
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
                "Guardrails calibrated for early-stage concept budgeting; benchmarks are $/sf by category; targets are directional ranges (not contract pricing)."
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
    </div>
  );
}
