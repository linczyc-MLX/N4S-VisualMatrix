import React, { useMemo, useState } from "react";
import { ScenarioResult } from "../domain/vmx-domain";
import { formatMoney, formatPct } from "../utils/format";
import {
  CashflowYearRow,
  SoftCostsConfig,
  computeCashflowSchedule,
  configToPrettyJson,
  parseConfigFromJson,
  saveSoftCostsConfig,
  getDefaultSoftCostsConfig,
} from "../utils/softCosts";

type Props = {
  visibleToAll: boolean;
  currency: string;
  compareMode: boolean;
  scenarioAName: string;
  scenarioBName: string;
  resultA: ScenarioResult | null;
  resultB: ScenarioResult | null;
  config: SoftCostsConfig;
  setConfig: (next: SoftCostsConfig) => void;
};

function money(n: number, ccy: string) {
  return formatMoney(n, ccy);
}

function Table({ title, rows, currency }: { title: string; rows: CashflowYearRow[]; currency: string }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div className="label" style={{ marginBottom: 6 }}>
        {title}
      </div>
      <table className="table small">
        <thead>
          <tr>
            <th>Year</th>
            <th style={{ textAlign: "right" }}>Weight</th>
            <th style={{ textAlign: "right" }}>Base Draw</th>
            <th style={{ textAlign: "right" }}>Escalation</th>
            <th style={{ textAlign: "right" }}>Total Draw</th>
            <th style={{ textAlign: "right" }}>Cumulative</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.year}>
              <td>{r.year}</td>
              <td style={{ textAlign: "right" }}>{(r.weight * 100).toFixed(1)}%</td>
              <td style={{ textAlign: "right" }}>{money(r.baseDraw, currency)}</td>
              <td style={{ textAlign: "right" }}>{money(r.escalationDraw, currency)}</td>
              <td style={{ textAlign: "right" }}>{money(r.totalDraw, currency)}</td>
              <td style={{ textAlign: "right" }}>
                {money(r.cumulativeTotal, currency)} ({(r.cumulativePct * 100).toFixed(1)}%)
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SoftCostsCashflowPanel({
  visibleToAll,
  currency,
  compareMode,
  scenarioAName,
  scenarioBName,
  resultA,
  resultB,
  config,
  setConfig,
}: Props) {
  const [tab, setTab] = useState<"summary" | "cashflow" | "json">("summary");
  const [jsonDraft, setJsonDraft] = useState<string>(() => configToPrettyJson(config));
  const [jsonError, setJsonError] = useState<string | null>(null);

  const calcA = useMemo(() => (resultA ? computeCashflowSchedule(resultA, config) : null), [resultA, config]);
  const calcB = useMemo(() => (compareMode && resultB ? computeCashflowSchedule(resultB, config) : null), [compareMode, resultB, config]);

  const activePresetKey = config.selectedPresetKey || String(config.projectDurationYears);
  const activePreset = config.cashflowPresets[activePresetKey] || config.cashflowPresets[String(config.projectDurationYears)];

  const showAdmin = visibleToAll;

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="adminHeader">
        <div>
          <h2>Soft Costs + Escalation + Cash Flow</h2>
          <div className="muted">
            Adds soft costs on top of VMX Hard Costs, then applies escalation over duration and shows an annual draw schedule.
          </div>
        </div>

        <div className="adminHeaderBtns noPrint" style={{ gap: 10 }}>
          <button type="button" className={tab === "summary" ? "docsBtn" : "secondaryBtn"} onClick={() => setTab("summary")}>
            Summary
          </button>
          <button type="button" className={tab === "cashflow" ? "docsBtn" : "secondaryBtn"} onClick={() => setTab("cashflow")}>
            Cash Flow
          </button>
          <button type="button" className={tab === "json" ? "docsBtn" : "secondaryBtn"} onClick={() => setTab("json")}>
            Config JSON
          </button>
        </div>
      </div>

      {!resultA ? <div className="muted">No Scenario A result yet.</div> : null}

      {tab === "summary" && resultA && calcA ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: compareMode ? "1fr 1fr" : "1fr", gap: 12 }}>
            <div>
              <div className="label">Scenario A — {scenarioAName}</div>
              <div className="big" style={{ marginTop: 4 }}>
                {money(calcA.totals.totalWithEscalation, currency)}
              </div>
              <div className="muted">
                Hard: {money(calcA.totals.hardBase, currency)} | Soft: {money(calcA.totals.softBase, currency)} | Escalation: {money(calcA.totals.escalationAmount, currency)}
              </div>

              <div style={{ marginTop: 10 }}>
                <div className="label">Soft cost breakdown</div>
                <table className="table small">
                  <thead>
                    <tr>
                      <th>Line Item</th>
                      <th style={{ textAlign: "right" }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calcA.totals.breakdown.map((b) => (
                      <tr key={b.label}>
                        <td>{b.label}</td>
                        <td style={{ textAlign: "right" }}>{money(b.amount, currency)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td><strong>Soft Total</strong></td>
                      <td style={{ textAlign: "right" }}><strong>{money(calcA.totals.softBase, currency)}</strong></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {compareMode && resultB && calcB ? (
              <div>
                <div className="label">Scenario B — {scenarioBName}</div>
                <div className="big" style={{ marginTop: 4 }}>
                  {money(calcB.totals.totalWithEscalation, currency)}
                </div>
                <div className="muted">
                  Hard: {money(calcB.totals.hardBase, currency)} | Soft: {money(calcB.totals.softBase, currency)} | Escalation: {money(calcB.totals.escalationAmount, currency)}
                </div>

                <div style={{ marginTop: 10 }}>
                  <div className="label">Soft cost breakdown</div>
                  <table className="table small">
                    <thead>
                      <tr>
                        <th>Line Item</th>
                        <th style={{ textAlign: "right" }}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {calcB.totals.breakdown.map((b) => (
                        <tr key={b.label}>
                          <td>{b.label}</td>
                          <td style={{ textAlign: "right" }}>{money(b.amount, currency)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td><strong>Soft Total</strong></td>
                        <td style={{ textAlign: "right" }}><strong>{money(calcB.totals.softBase, currency)}</strong></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>

          <div className="muted" style={{ marginTop: 10 }}>
            Duration: <strong>{config.projectDurationYears} years</strong> | Escalation rate: <strong>{(config.annualEscalationRate * 100).toFixed(1)}%</strong> | Scope: <strong>{config.escalationScope === "hard_only" ? "Hard costs" : "Hard + Soft"}</strong> | Cashflow preset: <strong>{activePreset?.label ?? activePresetKey}</strong>
          </div>
        </>
      ) : null}

      {tab === "cashflow" && resultA && calcA ? (
        <>
          <div className="muted">
            This schedule allocates base costs by year weight, and computes escalation per-year using a mid-year assumption (t=0.5, 1.5, …).
          </div>

          <div style={{ display: "grid", gridTemplateColumns: compareMode ? "1fr 1fr" : "1fr", gap: 12 }}>
            <div>
              <Table title={`Scenario A — ${scenarioAName}`} rows={calcA.rows} currency={currency} />
            </div>
            {compareMode && resultB && calcB ? (
              <div>
                <Table title={`Scenario B — ${scenarioBName}`} rows={calcB.rows} currency={currency} />
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {tab === "json" ? (
        <>
          <div className="muted">
            Edit defaults here (visible to all). Use decimals (0.06 = 6%). Recommended: keep weights summing to ~1.0.
          </div>

          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
            <textarea
              className="input"
              style={{ minHeight: 260, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace", fontSize: 12 }}
              value={jsonDraft}
              onChange={(e) => {
                setJsonDraft(e.target.value);
                setJsonError(null);
              }}
            />

            {jsonError ? <div className="muted" style={{ color: "#b91c1c" }}>{jsonError}</div> : null}

            <div className="adminHeaderBtns" style={{ gap: 10 }}>
              <button
                type="button"
                className="docsBtn"
                onClick={() => {
                  const parsed = parseConfigFromJson(jsonDraft);
                  if (!parsed.ok) {
                    setJsonError(parsed.error);
                    return;
                  }
                  setConfig(parsed.value);
                  saveSoftCostsConfig(parsed.value);
                  setJsonDraft(configToPrettyJson(parsed.value));
                  setJsonError(null);
                }}
              >
                Save Config
              </button>
              <button
                type="button"
                className="secondaryBtn"
                onClick={() => {
                  const def = getDefaultSoftCostsConfig();
                  setConfig(def);
                  saveSoftCostsConfig(def);
                  setJsonDraft(configToPrettyJson(def));
                  setJsonError(null);
                }}
              >
                Reset Defaults
              </button>
            </div>
          </div>
        </>
      ) : null}

      {!showAdmin ? <div className="muted" style={{ marginTop: 10 }}>Config editing disabled.</div> : null}
    </div>
  );
}
