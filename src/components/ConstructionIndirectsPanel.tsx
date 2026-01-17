import React, { useMemo } from "react";
import type { TierId } from "../data/benchmark-library-storage";
import type { ScenarioResult } from "../domain/vmx-domain";
import { formatMoney } from "../utils/format";
import {
  ConstructionIndirectsConfigV1,
  computeConstructionIndirects,
  getRatesForTier,
} from "../utils/constructionIndirects";

type Props = {
  title?: string;
  areaSqft: number;
  currency: string;
  tier: TierId;
  cfg: ConstructionIndirectsConfigV1;
  setCfg: (next: ConstructionIndirectsConfigV1) => void;
  resultA: ScenarioResult | null;
  resultB?: ScenarioResult | null;
  compareMode?: boolean;
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

export function ConstructionIndirectsPanel({
  title = "Construction Indirects (US)",
  areaSqft,
  currency,
  tier,
  cfg,
  setCfg,
  resultA,
  resultB,
  compareMode = false,
}: Props) {
  const rates = cfg.byTier[tier];

  const indirectsA = useMemo(() => {
    if (!resultA) return null;
    return computeConstructionIndirects({
      directHardCost: resultA.totalCost,
      areaSqft,
      rates: getRatesForTier(cfg, tier),
    });
  }, [resultA, areaSqft, cfg, tier]);

  const indirectsB = useMemo(() => {
    if (!compareMode || !resultB) return null;
    return computeConstructionIndirects({
      directHardCost: resultB.totalCost,
      areaSqft,
      rates: getRatesForTier(cfg, tier),
    });
  }, [resultB, areaSqft, cfg, tier, compareMode]);

  const feeBaseLabel = cfg.feeBase === "direct_only" ? "Direct Hard Costs" : "Cost of the Work";

  const onRateChange = (
    key: "generalConditionsRate" | "glInsuranceRate" | "contingencyRate" | "feeRate",
    v: string
  ) => {
    const nextPct = Math.max(0, Math.min(1, inputToPct(v)));
    setCfg({
      ...cfg,
      byTier: {
        ...cfg.byTier,
        [tier]: {
          ...cfg.byTier[tier],
          [key]: nextPct,
        },
      },
    });
  };

  const onFeeBaseChange = (next: "cost_of_work" | "direct_only") => {
    setCfg({ ...cfg, feeBase: next });
  };

  const renderScenario = (label: string, indirects: ReturnType<typeof computeConstructionIndirects> | null) => {
    if (!indirects) {
      return <div className="muted">No scenario result available.</div>;
    }

    return (
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontWeight: 900 }}>{label}</div>
          <div className="muted">Area: {areaSqft.toLocaleString()} sq ft</div>
        </div>

        <table className="table small" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th style={{ width: "44%" }}>Line Item</th>
              <th style={{ width: "14%" }}>Rate</th>
              <th style={{ width: "22%" }}>Base</th>
              <th style={{ width: "20%", textAlign: "right" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {indirects.lines.map((ln) => (
              <tr key={ln.id}>
                <td>{ln.label}</td>
                <td>{pctToInput(ln.rate)}%</td>
                <td>{formatMoney(ln.base, currency)}</td>
                <td style={{ textAlign: "right" }}>{formatMoney(ln.amount, currency)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={3} style={{ fontWeight: 900 }}>
                Total Indirects
              </td>
              <td style={{ textAlign: "right", fontWeight: 900 }}>{formatMoney(indirects.totalIndirects, currency)}</td>
            </tr>
            <tr>
              <td colSpan={3} style={{ fontWeight: 900 }}>
                Total Construction Contract
              </td>
              <td style={{ textAlign: "right", fontWeight: 900 }}>{formatMoney(indirects.contractTotal, currency)}</td>
            </tr>
          </tbody>
        </table>

        <div style={{ display: "flex", gap: 14, alignItems: "baseline", justifyContent: "space-between" }}>
          <div>
            <div className="label">Contract / sq ft</div>
            <div className="big">{formatMoney(indirects.contractPsqft, currency)}</div>
          </div>
          <div className="muted" style={{ textAlign: "right", maxWidth: 460 }}>
            GC Fee base: <strong>{feeBaseLabel}</strong>. (Industry standard is <strong>Cost of the Work</strong>.)
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="card">
      <div className="adminHeader">
        <div>
          <h2>{title}</h2>
          <div className="muted">
            Adds the builder&apos;s management + markup layer on top of VMX direct hard costs. This does <strong>not</strong> affect guardrail percentages.
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 12 }}>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ fontWeight: 900 }}>Defaults (Tier: {tier.toUpperCase()})</div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 10, alignItems: "center" }}>
            <div className="muted">General Conditions</div>
            <input
              className="input"
              value={pctToInput(rates.generalConditionsRate)}
              onChange={(e) => onRateChange("generalConditionsRate", e.target.value)}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 10, alignItems: "center" }}>
            <div className="muted">GC GL Insurance</div>
            <input
              className="input"
              value={pctToInput(rates.glInsuranceRate)}
              onChange={(e) => onRateChange("glInsuranceRate", e.target.value)}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 10, alignItems: "center" }}>
            <div className="muted">Construction Contingency</div>
            <input
              className="input"
              value={pctToInput(rates.contingencyRate)}
              onChange={(e) => onRateChange("contingencyRate", e.target.value)}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 10, alignItems: "center" }}>
            <div className="muted">GC Fee (O&amp;P)</div>
            <input
              className="input"
              value={pctToInput(rates.feeRate)}
              onChange={(e) => onRateChange("feeRate", e.target.value)}
            />
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6 }}>
            <div className="muted">Fee base:</div>
            <select className="input" style={{ width: 220 }} value={cfg.feeBase} onChange={(e) => onFeeBaseChange(e.target.value as any)}>
              <option value="cost_of_work">Cost of the Work (recommended)</option>
              <option value="direct_only">Direct Hard Costs only</option>
            </select>
          </div>

          <div className="muted" style={{ fontSize: 12, lineHeight: 1.35 }}>
            Inputs are percentages (e.g., enter <code>10</code> for 10%). Values are saved per tier.
          </div>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          {renderScenario("Scenario A", indirectsA)}
          {compareMode ? renderScenario("Scenario B", indirectsB) : null}
        </div>
      </div>
    </div>
  );
}
