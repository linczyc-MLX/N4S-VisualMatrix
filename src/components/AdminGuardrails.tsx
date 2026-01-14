import React from "react";

export type DriverMode = "topN" | "pct";

export type GuardrailsState = {
  // Provenance
  datasetName: string;
  datasetLastUpdated: string;
  datasetAssumptions: string;
  autoStampOnBenchmarkChange: boolean;

  // Delta Heat thresholds
  deltaMediumThr: number; // decimal (e.g. 0.015 = 1.5%)
  deltaHighThr: number; // decimal
  deltaSort: "impact" | "category";
  deltaDriversOnly: boolean;

  // Driver definition
  driverMode: DriverMode;
  driverTopN: number;
  driverPctThreshold: number; // decimal
  driverPctMaxDrivers: number;
};

type Props = {
  value: GuardrailsState;
  onChange: (next: GuardrailsState) => void;

  onStampNow: () => void;
  onResetDefaults: () => void;
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

export function AdminGuardrails(props: Props) {
  const v = props.value;

  return (
    <div style={{ marginTop: 12 }}>
      <div className="guardrailsGrid">
        <div className="guardrailsCard">
          <div style={{ fontWeight: 950, letterSpacing: "-0.01em" }}>Provenance</div>
          <div className="muted">Shown in the VMX footer and exports (PDF print + client pack).</div>

          <div style={{ marginTop: 12 }}>
            <label className="label">Dataset name</label>
            <input
              className="input"
              value={v.datasetName}
              onChange={(e) => props.onChange({ ...v, datasetName: e.target.value })}
              placeholder="e.g., US — Reserve (15k sf)"
            />
          </div>

          <div style={{ marginTop: 12 }}>
            <label className="label">Last updated</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" }}>
              <input
                className="input"
                value={v.datasetLastUpdated}
                onChange={(e) => props.onChange({ ...v, datasetLastUpdated: e.target.value })}
                placeholder="e.g., Jan 12, 2026"
              />
              <button type="button" className="secondaryBtn" onClick={props.onStampNow}>
                Stamp now
              </button>
            </div>
            <div className="muted" style={{ marginTop: 6 }}>
              Tip: turn on Auto-stamp to update this whenever you edit benchmarks / target bands.
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 900 }}>
              <input
                type="checkbox"
                checked={v.autoStampOnBenchmarkChange}
                onChange={(e) => props.onChange({ ...v, autoStampOnBenchmarkChange: e.target.checked })}
              />
              Auto-stamp last updated when benchmarks change
            </label>
          </div>

          <div style={{ marginTop: 12 }}>
            <label className="label">Assumptions (short)</label>
            <textarea
              className="textarea"
              value={v.datasetAssumptions}
              onChange={(e) => props.onChange({ ...v, datasetAssumptions: e.target.value })}
              placeholder="e.g., Guardrails calibrated for 15,000 sf luxury residence; costs are $/sf benchmarks; early concept stage."
              rows={4}
            />
          </div>

          <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
            <button type="button" className="dangerBtn" onClick={props.onResetDefaults}>
              Reset defaults
            </button>
          </div>
        </div>

        <div className="guardrailsCard">
          <div style={{ fontWeight: 950, letterSpacing: "-0.01em" }}>Delta Heat + Drivers</div>
          <div className="muted">
            Controls how VMX flags “material” deltas and which categories become primary “drivers” in Compare Mode.
          </div>

          <div className="adminTopGrid" style={{ marginTop: 12, gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <label className="label">Medium heat threshold (%)</label>
              <input
                className="input"
                type="number"
                step="0.1"
                value={pctToInput(v.deltaMediumThr)}
                onChange={(e) => {
                  const next = Math.max(0, inputToPct(e.target.value));
                  props.onChange({ ...v, deltaMediumThr: next, deltaHighThr: Math.max(v.deltaHighThr, next) });
                }}
              />
            </div>

            <div>
              <label className="label">High heat threshold (%)</label>
              <input
                className="input"
                type="number"
                step="0.1"
                value={pctToInput(v.deltaHighThr)}
                onChange={(e) => {
                  const next = Math.max(v.deltaMediumThr, inputToPct(e.target.value));
                  props.onChange({ ...v, deltaHighThr: next });
                }}
              />
            </div>
          </div>

          <div className="adminTopGrid" style={{ marginTop: 12, gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <label className="label">Sort default</label>
              <select
                className="input"
                value={v.deltaSort}
                onChange={(e) => props.onChange({ ...v, deltaSort: e.target.value as any })}
              >
                <option value="impact">Impact (|Δ Cost|)</option>
                <option value="category">Category order</option>
              </select>
            </div>

            <div>
              <label className="label">Default filter</label>
              <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 900, marginTop: 6 }}>
                <input
                  type="checkbox"
                  checked={v.deltaDriversOnly}
                  onChange={(e) => props.onChange({ ...v, deltaDriversOnly: e.target.checked })}
                />
                Drivers only
              </label>
            </div>
          </div>

          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #e6edf7" }}>
            <div className="label" style={{ marginBottom: 6 }}>Driver definition</div>

            <label style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 900, marginBottom: 8 }}>
              <input
                type="radio"
                name="driverMode"
                checked={v.driverMode === "topN"}
                onChange={() => props.onChange({ ...v, driverMode: "topN" })}
              />
              Top N categories by |Δ Cost|
            </label>

            {v.driverMode === "topN" ? (
              <div className="adminTopGrid" style={{ gridTemplateColumns: "1fr", gap: 8 }}>
                <div>
                  <label className="label">Top N</label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={20}
                    value={v.driverTopN}
                    onChange={(e) => props.onChange({ ...v, driverTopN: Math.max(1, Number(e.target.value || 1)) })}
                  />
                </div>
              </div>
            ) : null}

            <label style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 900, margin: "12px 0 8px" }}>
              <input
                type="radio"
                name="driverMode"
                checked={v.driverMode === "pct"}
                onChange={() => props.onChange({ ...v, driverMode: "pct" })}
              />
              Impact threshold (vs Scenario A total)
            </label>

            {v.driverMode === "pct" ? (
              <div className="adminTopGrid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label className="label">Impact ≥ (%)</label>
                  <input
                    className="input"
                    type="number"
                    step="0.1"
                    min={0}
                    value={pctToInput(v.driverPctThreshold)}
                    onChange={(e) => props.onChange({ ...v, driverPctThreshold: Math.max(0, inputToPct(e.target.value)) })}
                  />
                </div>
                <div>
                  <label className="label">Max drivers (cap)</label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={50}
                    value={v.driverPctMaxDrivers}
                    onChange={(e) => props.onChange({ ...v, driverPctMaxDrivers: Math.max(1, Number(e.target.value || 1)) })}
                  />
                </div>
              </div>
            ) : null}

            <div className="muted" style={{ marginTop: 10 }}>
              Drivers are highlighted in the Delta Heat table and feed the “Drivers only” filter.
            </div>
          </div>
        </div>
      </div>

      <div className="muted" style={{ marginTop: 10 }}>
        Category target bands (min/max %) are controlled in <strong>Benchmark Library → Benchmark Admin</strong>.
      </div>
    </div>
  );
}
