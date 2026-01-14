import React, { useMemo } from "react";
import { RangeStatus, ScenarioResult, VMX_CATEGORIES, VmxCategoryId } from "../domain/vmx-domain";
import { formatMoney, formatPct } from "../utils/format";

type Props = {
  compareMode: boolean;
  scenarioAName: string;
  scenarioBName: string;
  resultA: ScenarioResult | null;
  resultB: ScenarioResult | null;
};

type GuardrailRow = {
  categoryId: VmxCategoryId;
  categoryLabel: string;
  status: RangeStatus;
  actual: number;
  minPct: number;
  maxPct: number;
  gapPctPoints: number;
  approxDollarsToBoundary: number;
};

function mid(minPct: number, maxPct: number) {
  return (minPct + maxPct) / 2;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function AdvisoryReadout({ compareMode, scenarioAName, scenarioBName, resultA, resultB }: Props) {
  const computed = useMemo(() => {
    if (!compareMode || !resultA || !resultB) return null;

    const byIdA = new Map<
      VmxCategoryId,
      { pct: number; cost: number; minPct: number; maxPct: number; status: RangeStatus }
    >();
    resultA.categories.forEach((c) => {
      byIdA.set(c.categoryId, {
        pct: c.pctOfTotal,
        cost: c.cost,
        minPct: c.targetMinPct,
        maxPct: c.targetMaxPct,
        status: c.rangeStatus,
      });
    });

    const byIdB = new Map<
      VmxCategoryId,
      { pct: number; cost: number; minPct: number; maxPct: number; status: RangeStatus }
    >();
    resultB.categories.forEach((c) => {
      byIdB.set(c.categoryId, {
        pct: c.pctOfTotal,
        cost: c.cost,
        minPct: c.targetMinPct,
        maxPct: c.targetMaxPct,
        status: c.rangeStatus,
      });
    });

    const totalDelta = resultB.totalCost - resultA.totalCost;
    const deltaPctVsA = resultA.totalCost > 0 ? totalDelta / resultA.totalCost : 0;

    const countsFor = (map: Map<VmxCategoryId, { status: RangeStatus }>) => {
      const counts = { ok: 0, low: 0, high: 0 };
      for (const cat of VMX_CATEGORIES) {
        const r = map.get(cat.id);
        const s: RangeStatus = r?.status ?? "OK";
        if (s === "OK") counts.ok += 1;
        else if (s === "LOW") counts.low += 1;
        else counts.high += 1;
      }
      return counts;
    };

    const guardrailRows = (scenario: "A" | "B"): GuardrailRow[] => {
      const res = scenario === "A" ? resultA : resultB;
      const map = scenario === "A" ? byIdA : byIdB;

      return VMX_CATEGORIES.map((cat) => {
        const row = map.get(cat.id);
        const actual = row?.pct ?? 0;
        const minPct = row?.minPct ?? 0;
        const maxPct = row?.maxPct ?? 1;

        const status: RangeStatus = row?.status ?? "OK";
        if (status === "OK") return null;

        const boundary = status === "LOW" ? minPct : status === "HIGH" ? maxPct : clamp(actual, minPct, maxPct);
        const gap = actual - boundary;
        const gapPctPoints = Math.abs(gap) * 100;
        const approxDollarsToBoundary = Math.abs(gap) * res.totalCost;

        return {
          categoryId: cat.id,
          categoryLabel: cat.label,
          status,
          actual,
          minPct,
          maxPct,
          gapPctPoints,
          approxDollarsToBoundary,
        } as GuardrailRow;
      })
        .filter((r): r is GuardrailRow => Boolean(r))
        .sort((a, b) => b.approxDollarsToBoundary - a.approxDollarsToBoundary);
    };

    const aGuardrails = guardrailRows("A");
    const bGuardrails = guardrailRows("B");

    const drivers = VMX_CATEGORIES.map((cat) => {
      const a = byIdA.get(cat.id);
      const b = byIdB.get(cat.id);
      const deltaCost = (b?.cost ?? 0) - (a?.cost ?? 0);
      return { id: cat.id, label: cat.label, deltaCost };
    })
      .filter((d) => Math.abs(d.deltaCost) > 0)
      .sort((x, y) => Math.abs(y.deltaCost) - Math.abs(x.deltaCost))
      .slice(0, 3);

    const reallocation = (scenario: "A" | "B") => {
      const res = scenario === "A" ? resultA : resultB;
      const map = scenario === "A" ? byIdA : byIdB;

      const adjustments = VMX_CATEGORIES.map((cat) => {
        const r = map.get(cat.id);
        const actual = r?.pct ?? 0;
        const target = mid(r?.minPct ?? 0, r?.maxPct ?? 1);
        const deltaPct = target - actual;
        const dollars = deltaPct * res.totalCost;
        return { id: cat.id, label: cat.label, dollars };
      }).sort((a, b) => Math.abs(b.dollars) - Math.abs(a.dollars));

      const increase = adjustments.filter((a) => a.dollars > 0).slice(0, 3);
      const decrease = adjustments.filter((a) => a.dollars < 0).slice(0, 3);

      return { increase, decrease };
    };

    return {
      totalDelta,
      deltaPctVsA,
      aTotal: resultA.totalCost,
      bTotal: resultB.totalCost,
      currency: resultA.currency,
      aGuardrails,
      bGuardrails,
      aCounts: countsFor(byIdA),
      bCounts: countsFor(byIdB),
      drivers,
      reallocA: reallocation("A"),
      reallocB: reallocation("B"),
    };
  }, [compareMode, resultA, resultB]);

  if (!compareMode) {
    return (
      <div className="card">
        <h2>VMX Advisory Readout</h2>
        <div className="muted">Enable Compare Mode to generate the advisory readout.</div>
      </div>
    );
  }

  if (!computed || !resultA || !resultB) {
    return (
      <div className="card">
        <h2>VMX Advisory Readout</h2>
        <div className="muted">Waiting for Scenario A + B results…</div>
      </div>
    );
  }

  const scenarioANameUpper = scenarioAName.toUpperCase();
  const scenarioBNameUpper = scenarioBName.toUpperCase();

  const pillStyle = (type: "ok" | "low" | "high") => {
    const base: React.CSSProperties = {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "6px 10px",
      borderRadius: 999,
      fontWeight: 900,
      fontSize: 12,
      lineHeight: 1,
      border: "1px solid rgba(148,163,184,.35)",
      whiteSpace: "nowrap",
    };
    if (type === "ok") return { ...base, background: "rgba(34,197,94,.12)", color: "#166534" };
    if (type === "low") return { ...base, background: "rgba(244,63,94,.10)", color: "#9f1239" };
    return { ...base, background: "rgba(244,63,94,.10)", color: "#9f1239" };
  };

  const GuardrailSnapshot = ({
    title,
    rows,
    currency,
    okCount,
    lowCount,
    highCount,
  }: {
    title: string;
    rows: GuardrailRow[];
    currency: string;
    okCount: number;
    lowCount: number;
    highCount: number;
  }) => {
    return (
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, rowGap: 8, minWidth: 0, flexWrap: "wrap" }}>
          <div className="label" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
            {title} guardrails
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <span style={pillStyle("ok")}>OK {okCount}</span>
            <span style={pillStyle("low")}>Below {lowCount}</span>
            <span style={pillStyle("high")}>Above {highCount}</span>
          </div>
        </div>

        <div className="panel" style={{ marginTop: 10, padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "24%" }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "20%" }} />
            </colgroup>
            <thead>
              <tr>
                <th className="smallTh">Priority exception</th>
                <th className="smallTh">Status</th>
                <th className="smallTh">Actual</th>
                <th className="smallTh">Target</th>
                <th className="smallTh">Gap</th>
                <th className="smallTh">Approx $ to boundary</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 6).map((r) => {
                const statusLabel = r.status === "LOW" ? "Below range" : "Above range";
                const statusIcon = r.status === "LOW" ? "▼" : "▲";

                const statusStyle: React.CSSProperties =
                  r.status === "LOW"
                    ? { background: "rgba(244,63,94,.10)", color: "#9f1239", border: "1px solid rgba(244,63,94,.22)" }
                    : { background: "rgba(244,63,94,.10)", color: "#9f1239", border: "1px solid rgba(244,63,94,.22)" };

                return (
                  <tr key={r.categoryId}>
                    <td className="smallTd" style={{ overflowWrap: "anywhere" }}>
                      <strong>{r.categoryLabel}</strong>
                    </td>
                    <td className="smallTd" style={{ overflow: "hidden" }}>
                      <span
                        style={{
                          ...statusStyle,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 6,
                          padding: "4px 8px",
                          borderRadius: 999,
                          fontWeight: 900,
                          fontSize: 11,
                          whiteSpace: "nowrap",
                          width: "100%",
                          maxWidth: "100%",
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        <span aria-hidden="true">{statusIcon}</span>
                        {statusLabel}
                      </span>
                    </td>
                    <td className="smallTd">{formatPct(r.actual)}</td>
                    <td className="smallTd">
                      {formatPct(r.minPct)}–{formatPct(r.maxPct)}
                    </td>
                    <td className="smallTd">{r.gapPctPoints.toFixed(1)}pp</td>
                    <td className="smallTd" style={{ whiteSpace: "nowrap" }}>
                      {formatMoney(r.approxDollarsToBoundary, currency)}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 ? (
                <tr>
                  <td className="smallTd muted" colSpan={6}>
                    All categories are within target bands.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="card" style={{ overflowX: "hidden" }}>
      <h2 style={{ marginBottom: 4 }}>VMX Advisory Readout</h2>
      <div className="muted" style={{ marginBottom: 12 }}>
        A structured interpretation of guardrails, allocation pressure points, and the most material drivers.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 18, alignItems: "start" }}>
        <div style={{ minWidth: 0 }}>
          <div className="label">Scenario A — {scenarioANameUpper} Total</div>
          <div className="big">{formatMoney(computed.aTotal, computed.currency)}</div>
          <div className="muted">Avg: {formatMoney(computed.aTotal / Math.max(1, resultA.areaSqft), computed.currency)} / sq ft</div>
        </div>

        <div style={{ minWidth: 0 }}>
          <div className="label">Scenario B — {scenarioBNameUpper} Total</div>
          <div className="big">{formatMoney(computed.bTotal, computed.currency)}</div>
          <div className="muted">Avg: {formatMoney(computed.bTotal / Math.max(1, resultB.areaSqft), computed.currency)} / sq ft</div>
        </div>

        <div style={{ minWidth: 0 }}>
          <div className="label">Total Delta (B − A)</div>
          <div className="big">{formatMoney(computed.totalDelta, computed.currency)}</div>
          <div className="muted">{(computed.deltaPctVsA * 100).toFixed(1)}% vs A</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 18, marginTop: 16, alignItems: "start" }}>
        <GuardrailSnapshot
          title={`Scenario A — ${scenarioAName}`}
          rows={computed.aGuardrails}
          currency={computed.currency}
          okCount={computed.aCounts.ok}
          lowCount={computed.aCounts.low}
          highCount={computed.aCounts.high}
        />
        <GuardrailSnapshot
          title={`Scenario B — ${scenarioBName}`}
          rows={computed.bGuardrails}
          currency={computed.currency}
          okCount={computed.bCounts.ok}
          lowCount={computed.bCounts.low}
          highCount={computed.bCounts.high}
        />
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="label" style={{ marginBottom: 8 }}>
          Most material delta drivers (B − A)
        </div>
        {computed.drivers.length === 0 ? (
          <div className="muted">No drivers (all deltas are zero).</div>
        ) : (
          <ul style={{ margin: "0 0 0 18px" }}>
            {computed.drivers.map((d) => (
              <li key={d.id}>
                <strong>{d.label}</strong> — {formatMoney(d.deltaCost, computed.currency)}{" "}
                <span className="muted">({d.deltaCost > 0 ? "increase" : "decrease"})</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel" style={{ marginTop: 12 }}>
        <div className="label" style={{ marginBottom: 6 }}>
          Reallocation guidance (heuristic)
        </div>
        <div className="muted" style={{ marginBottom: 10 }}>
          This suggests approximate dollar shifts to move each category toward the midpoint of its target range, holding total constant. Use as directional guidance, not a pricing engine.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 18 }}>
          <div style={{ minWidth: 0 }}>
            <div className="label" style={{ marginBottom: 6 }}>
              Scenario A — {scenarioAName}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>Increase allocation</div>
                {computed.reallocA.increase.map((x) => (
                  <div key={x.id} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ overflowWrap: "anywhere" }}>{x.label}</span>
                    <strong style={{ whiteSpace: "nowrap" }}>{formatMoney(x.dollars, computed.currency)}</strong>
                  </div>
                ))}
              </div>

              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>Decrease allocation</div>
                {computed.reallocA.decrease.map((x) => (
                  <div key={x.id} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ overflowWrap: "anywhere" }}>{x.label}</span>
                    <strong style={{ whiteSpace: "nowrap" }}>{formatMoney(Math.abs(x.dollars), computed.currency)}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ minWidth: 0 }}>
            <div className="label" style={{ marginBottom: 6 }}>
              Scenario B — {scenarioBName}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>Increase allocation</div>
                {computed.reallocB.increase.map((x) => (
                  <div key={x.id} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ overflowWrap: "anywhere" }}>{x.label}</span>
                    <strong style={{ whiteSpace: "nowrap" }}>{formatMoney(x.dollars, computed.currency)}</strong>
                  </div>
                ))}
              </div>

              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>Decrease allocation</div>
                {computed.reallocB.decrease.map((x) => (
                  <div key={x.id} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ overflowWrap: "anywhere" }}>{x.label}</span>
                    <strong style={{ whiteSpace: "nowrap" }}>{formatMoney(Math.abs(x.dollars), computed.currency)}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
