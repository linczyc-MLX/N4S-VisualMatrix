import React from "react";
import {
  BenchmarkSet,
  HeatBand,
  ScenarioSelection,
  ScenarioResult,
  VmxCategoryId,
  VMX_CATEGORIES,
} from "../domain/vmx-domain";
import { formatMoney, formatPct } from "../utils/format";

type Props = {
  title: string;
  areaSqft: number;
  setAreaSqft: (n: number) => void;
  showAreaInput?: boolean;
  benchmark: BenchmarkSet;
  selections: Record<VmxCategoryId, ScenarioSelection>;
  setBand: (categoryId: VmxCategoryId, band: HeatBand) => void;
  result: ScenarioResult | null;
  error: string | null;
};

function bandLabel(b: HeatBand) {
  return b === "LOW" ? "Low" : b === "MEDIUM" ? "Medium" : "High";
}

function getPsqft(benchmark: BenchmarkSet, categoryId: VmxCategoryId, band: HeatBand): number {
  const hit = benchmark.bands.find((b) => b.categoryId === categoryId && b.band === band);
  const v = hit?.psqft ?? 0;
  return Number.isFinite(v) ? Math.max(0, v) : 0;
}

export function Matrix({
  title,
  areaSqft,
  setAreaSqft,
  showAreaInput = true,
  benchmark,
  selections,
  setBand,
  result,
  error,
}: Props) {
  return (
    <div className="card">
      <div className="matrixHeader">
        <div>
          <h2>{title}</h2>
          <div className="muted">
            {benchmark.name} — {benchmark.currency} · Area: {areaSqft.toLocaleString()} sq ft
          </div>
        </div>

        {showAreaInput ? (
          <div style={{ minWidth: 220 }}>
            <label className="label">Area (sq ft)</label>
            <input
              className="input"
              type="number"
              min={1}
              value={areaSqft}
              onChange={(e) => setAreaSqft(Number(e.target.value))}
            />
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="muted" style={{ color: "#b91c1c", marginBottom: 10 }}>
          {error}
        </div>
      ) : null}

      <table className="matrixTable">
        <thead>
          <tr>
            <th style={{ width: "28%" }}>Category</th>
            <th style={{ width: "24%" }}>Low</th>
            <th style={{ width: "24%" }}>Medium</th>
            <th style={{ width: "24%" }}>High</th>
          </tr>
        </thead>
        <tbody>
          {VMX_CATEGORIES.map((c) => {
            const sel = selections[c.id]?.band ?? "MEDIUM";
            const low = getPsqft(benchmark, c.id, "LOW");
            const med = getPsqft(benchmark, c.id, "MEDIUM");
            const high = getPsqft(benchmark, c.id, "HIGH");

            return (
              <tr key={c.id}>
                <td className="catCell">{c.label}</td>

                {(["LOW", "MEDIUM", "HIGH"] as HeatBand[]).map((band) => {
                  const perSqft = band === "LOW" ? low : band === "MEDIUM" ? med : high;
                  const isActive = sel === band;
                  return (
                    <td key={band}>
                      <button
                        type="button"
                        className={`bandBtn ${band.toLowerCase()} ${isActive ? "active" : ""}`}
                        onClick={() => setBand(c.id, band)}
                      >
                        <div className="bandTop">{band.toUpperCase()}</div>
                        <div className="bandBottom">${perSqft.toLocaleString()} / sq ft</div>
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="totalsRow">
        <div>
          <div className="label">Total</div>
          <div className="big">{result ? formatMoney(result.totalCost, result.currency) : "—"}</div>
        </div>
        <div>
          <div className="label">Total / sq ft</div>
          <div className="big">
            {result ? formatMoney(result.totalCost / Math.max(1, areaSqft), result.currency) : "—"}
          </div>
        </div>
      </div>

      <h3 style={{ marginTop: 12, marginBottom: 8 }}>Allocation &amp; Flags</h3>

      {!result ? (
        <div className="muted">No result yet.</div>
      ) : (
        <table className="table small allocTable">
          <thead>
            <tr>
              <th>Category</th>
              <th>Selected</th>
              <th>Cost</th>
              <th>% of Total</th>
              <th>Target Range</th>
              <th style={{ textAlign: "right" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {result.categories.map((row) => {
              const rangeStatus = row.rangeStatus;
              const pillClass = rangeStatus === "OK" ? "ok" : rangeStatus === "LOW" ? "low" : "high";

              return (
                <tr key={row.categoryId}>
                  <td>{row.label}</td>
                  <td>{bandLabel(selections[row.categoryId]?.band ?? "MEDIUM")}</td>
                  <td>{formatMoney(row.cost, result.currency)}</td>
                  <td>{formatPct(row.pctOfTotal)}</td>
                  <td>
                    <div style={{ lineHeight: 1.1 }}>
                      {formatPct(row.targetMinPct)}–<br />
                      {formatPct(row.targetMaxPct)}
                    </div>
                  </td>

                  <td className="statusCell">
                    <div className={`rangePill ${pillClass}`}>
                      {rangeStatus === "HIGH" ? <div className="rangeArrow up">▲</div> : null}

                      <div className="rangeText">
                        {rangeStatus === "OK" ? (
                          "OK"
                        ) : rangeStatus === "LOW" ? (
                          <>
                            Below<br />range
                          </>
                        ) : (
                          <>
                            Above<br />range
                          </>
                        )}
                      </div>

                      {rangeStatus === "LOW" ? <div className="rangeArrow down">▼</div> : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="muted" style={{ marginTop: 10 }}>
        Note: “Out of range” compares allocation percentage to target weighting bands (guardrails).
      </div>
    </div>
  );
}
