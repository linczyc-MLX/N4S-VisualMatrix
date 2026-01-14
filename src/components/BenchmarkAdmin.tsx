import React, { useMemo, useState } from "react";
import {
  BenchmarkSet,
  HeatBand,
  VMX_CATEGORIES,
  VmxCategoryId,
  computeImpliedMediumAllocationShares,
  deriveTargetRangesFromMedium,
  ensureCompleteTargetRanges,
} from "../domain/vmx-domain";

type Props = {
  benchmark: BenchmarkSet;
  setBenchmark: (next: BenchmarkSet) => void;
};

const BANDS: HeatBand[] = ["LOW", "MEDIUM", "HIGH"];

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function getBandPsqft(benchmark: BenchmarkSet, categoryId: VmxCategoryId, band: HeatBand) {
  return benchmark.bands.find((x) => x.categoryId === categoryId && x.band === band)?.psqft ?? 0;
}

function setBandPsqft(benchmark: BenchmarkSet, categoryId: VmxCategoryId, band: HeatBand, psqft: number): BenchmarkSet {
  const next = deepClone(benchmark);
  const existing = next.bands.find((x) => x.categoryId === categoryId && x.band === band);
  if (existing) existing.psqft = psqft;
  else next.bands.push({ categoryId, band, psqft });
  return next;
}

function getRangePct(benchmark: BenchmarkSet, categoryId: VmxCategoryId) {
  const r = benchmark.targetRanges.find((x) => x.categoryId === categoryId);
  return { minPct: r?.minPct ?? 0, maxPct: r?.maxPct ?? 0 };
}

function setRangePct(benchmark: BenchmarkSet, categoryId: VmxCategoryId, minPct: number, maxPct: number): BenchmarkSet {
  const next = deepClone(benchmark);
  const existing = next.targetRanges.find((x) => x.categoryId === categoryId);
  if (existing) {
    existing.minPct = minPct;
    existing.maxPct = maxPct;
  } else {
    next.targetRanges.push({ categoryId, minPct, maxPct });
  }
  return next;
}

// UI inputs use percent numbers (e.g., 5 for 5%). Stored values are decimals (0.05).
function pctToInput(p: number) {
  return Number.isFinite(p) ? (p * 100).toFixed(1) : "0.0";
}
function inputToPct(v: string) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n / 100;
}

function Btn(props: { label: string; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={props.title}
      style={{
        padding: "10px 12px",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.16)",
        background: "rgba(255,255,255,0.06)",
        color: "inherit",
        fontWeight: 900,
        cursor: "pointer",
      }}
    >
      {props.label}
    </button>
  );
}

export function BenchmarkAdmin({ benchmark, setBenchmark }: Props) {
  // Implied Medium allocation shares (helps the advisor understand calibration)
  const impliedShares = useMemo(() => {
    try {
      return computeImpliedMediumAllocationShares(benchmark);
    } catch {
      // If something is malformed, fall back to equal weights
      const eq = 1 / VMX_CATEGORIES.length;
      const out: Record<VmxCategoryId, number> = {} as any;
      for (const c of VMX_CATEGORIES) out[c.id] = eq;
      return out;
    }
  }, [benchmark]);

  /**
   * Calibration controls (advisor-facing)
   *
   * relativeTolerancePct:
   *  - 20 means ±20% relative around the implied Medium share.
   *  Example: if a category "should" be ~30%, then ±20% relative => ±6pp, so 24–36.
   *
   * minHalfWidthPp / maxHalfWidthPp:
   *  - half-width caps (percentage points) to prevent ranges becoming too tight or too loose.
   *  Example: minHalfWidthPp = 1.0 means at least ±1pp.
   *           maxHalfWidthPp = 6.0 means at most ±6pp.
   */
  const [relativeTolerancePct, setRelativeTolerancePct] = useState<number>(20);
  const [minHalfWidthPp, setMinHalfWidthPp] = useState<number>(1.0);
  const [maxHalfWidthPp, setMaxHalfWidthPp] = useState<number>(6.0);

  function normalizeAndFillRanges() {
    const filled = ensureCompleteTargetRanges(benchmark);
    setBenchmark({ ...benchmark, targetRanges: filled });
  }

  function calibrateFromMedium() {
    // Convert UI inputs (percent / percentage points) into decimals expected by domain helpers
    const rel = clamp(relativeTolerancePct / 100, 0, 2);
    const minHalf = clamp(minHalfWidthPp / 100, 0, 0.5);
    const maxHalf = clamp(maxHalfWidthPp / 100, 0, 0.5);

    const nextRanges = deriveTargetRangesFromMedium(benchmark, {
      relativeTolerance: rel,
      minHalfWidthAbs: minHalf,
      maxHalfWidthAbs: maxHalf,
    });

    setBenchmark({ ...benchmark, targetRanges: nextRanges });
  }

  return (
    <div style={{ marginTop: 14 }}>
      <h3>Benchmark (Bands $/sq ft) + Target Ranges (%)</h3>

      <div className="adminTopGrid" style={{ marginTop: 10 }}>
        <div>
          <label className="label">Benchmark Name</label>
          <input className="input" value={benchmark.name} onChange={(e) => setBenchmark({ ...benchmark, name: e.target.value })} />
        </div>

        <div>
          <label className="label">Currency (ISO)</label>
          <input
            className="input"
            value={benchmark.currency}
            onChange={(e) => setBenchmark({ ...benchmark, currency: e.target.value.toUpperCase() })}
            placeholder="USD"
          />
        </div>
      </div>

      {/* Calibration tools */}
      <div className="card" style={{ marginTop: 12, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 950, letterSpacing: "-0.01em" }}>Target Range Calibration</div>
            <div className="muted">
              Calibrate guardrails so “Medium” selections land inside target ranges for this benchmark profile.
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Btn
              label="Normalize / Fill ranges"
              onClick={normalizeAndFillRanges}
              title="Ensures each category has a valid min/max range (no missing categories; max >= min)."
            />
            <Btn
              label="Calibrate from Medium"
              onClick={calibrateFromMedium}
              title="Derives target ranges from the benchmark’s implied Medium allocation shares."
            />
          </div>
        </div>

        <div className="adminTopGrid" style={{ marginTop: 12, gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div>
            <label className="label">Relative tolerance (± % of implied share)</label>
            <input
              className="input"
              type="number"
              step="1"
              min="0"
              max="200"
              value={relativeTolerancePct}
              onChange={(e) => setRelativeTolerancePct(Number(e.target.value))}
            />
            <div className="muted" style={{ marginTop: 4 }}>
              Example: 20 means ±20% around the implied Medium share.
            </div>
          </div>

          <div>
            <label className="label">Min band half-width (± pp)</label>
            <input
              className="input"
              type="number"
              step="0.5"
              min="0"
              max="50"
              value={minHalfWidthPp}
              onChange={(e) => setMinHalfWidthPp(Number(e.target.value))}
            />
            <div className="muted" style={{ marginTop: 4 }}>
              Floor to prevent bands becoming too tight.
            </div>
          </div>

          <div>
            <label className="label">Max band half-width (± pp)</label>
            <input
              className="input"
              type="number"
              step="0.5"
              min="0"
              max="50"
              value={maxHalfWidthPp}
              onChange={(e) => setMaxHalfWidthPp(Number(e.target.value))}
            />
            <div className="muted" style={{ marginTop: 4 }}>
              Cap to prevent bands becoming too loose.
            </div>
          </div>
        </div>

        <div className="muted" style={{ marginTop: 10 }}>
          Tip: For early-stage client conversations, slightly wider ranges can feel more realistic. As design matures, tighten ranges to create stronger discipline.
        </div>
      </div>

      <table className="table small" style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th style={{ width: "22%" }}>Category</th>
            <th style={{ width: "13%" }}>Low</th>
            <th style={{ width: "13%" }}>Medium</th>
            <th style={{ width: "13%" }}>High</th>
            <th style={{ width: "12%" }}>Min %</th>
            <th style={{ width: "12%" }}>Max %</th>
            <th style={{ width: "15%" }}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {VMX_CATEGORIES.map((cat) => {
            const range = getRangePct(benchmark, cat.id);
            const implied = impliedShares[cat.id] ?? 0;
            const impliedPct = (implied * 100).toFixed(1);

            const isInvalid = range.maxPct < range.minPct;

            return (
              <tr key={cat.id}>
                <td>
                  <div className="catLabel">{cat.label}</div>
                </td>

                {BANDS.map((band) => {
                  const value = getBandPsqft(benchmark, cat.id, band);
                  return (
                    <td key={band}>
                      <input
                        className="input adminInput"
                        type="number"
                        step="1"
                        value={value}
                        onChange={(e) => {
                          const psqft = Number(e.target.value);
                          const safe = Number.isFinite(psqft) ? psqft : 0;
                          setBenchmark(setBandPsqft(benchmark, cat.id, band, safe));
                        }}
                        aria-label={`${cat.label} ${band} $/sq ft`}
                      />
                    </td>
                  );
                })}

                <td>
                  <input
                    className="input adminInput"
                    type="number"
                    step="0.1"
                    value={pctToInput(range.minPct)}
                    onChange={(e) => {
                      const nextMin = inputToPct(e.target.value);
                      // Keep sane: if Min rises above Max, push Max up to Min
                      const nextMax = Math.max(range.maxPct, nextMin);
                      setBenchmark(setRangePct(benchmark, cat.id, nextMin, nextMax));
                    }}
                  />
                </td>

                <td>
                  <input
                    className="input adminInput"
                    type="number"
                    step="0.1"
                    value={pctToInput(range.maxPct)}
                    onChange={(e) => {
                      const nextMax = inputToPct(e.target.value);
                      // Keep sane: if Max drops below Min, pull Min down to Max
                      const nextMin = Math.min(range.minPct, nextMax);
                      setBenchmark(setRangePct(benchmark, cat.id, nextMin, nextMax));
                    }}
                  />
                </td>

                <td className="muted">
                  <div>Implied “Medium” share: {impliedPct}%</div>
                  {isInvalid ? <div style={{ fontWeight: 900 }}>Range invalid (max &lt; min)</div> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="muted" style={{ marginTop: 10 }}>
        Guidance: target ranges are stored as decimals under the hood (e.g., 0.25 = 25%). UI shows percentages for clarity.
      </div>
    </div>
  );
}
