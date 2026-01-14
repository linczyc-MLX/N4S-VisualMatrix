import JSZip from "jszip";
import { ScenarioSelection, ScenarioResult } from "../domain/vmx-domain";
import { formatMoney, formatPct } from "./format";
import { CashflowYearRow, SoftCostsComputed, SoftCostsConfig, configToPrettyJson } from "./softCosts";

export type ClientPackMeta = {
  appVersion: string;
  datasetName: string;
  datasetLastUpdated: string;
  assumptions: string;
  areaSqft: number;
  tierLabel: string;
  scenarioAName: string;
  scenarioABenchmarkName: string;
  compareMode: boolean;
  scenarioBName?: string;
  scenarioBBenchmarkName?: string;
  generatedAtIso: string;
};

export type DeltaRowExport = {
  categoryId: string;
  categoryLabel: string;
  direction: string;
  deltaCost: number;
  deltaPct: number;
  impactVsATotal: number;
  heat: string;
  isDriver: boolean;
};

type Args = {
  meta: ClientPackMeta;
  selectionsA: Record<string, ScenarioSelection>;
  resultA: ScenarioResult;
  selectionsB: Record<string, ScenarioSelection> | null;
  resultB: ScenarioResult | null;
  deltaRows: DeltaRowExport[] | null;
  // Optional: soft costs + cashflow
  softCostsConfig?: SoftCostsConfig;
  softCostsA?: SoftCostsComputed;
  softCostsB?: SoftCostsComputed;
  cashflowA?: CashflowYearRow[];
  cashflowB?: CashflowYearRow[];
};

function safeFileName(name: string) {
  return name.replace(/[^a-z0-9\-_]+/gi, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
}

function toCsvRow(cols: (string | number)[]) {
  const out = cols.map((c) => {
    const s = String(c ?? "");
    if (s.includes(",") || s.includes("\n") || s.includes('"')) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  });
  return out.join(",") + "\n";
}

function buildAllocationCsv(result: ScenarioResult) {
  let csv = "Category,Cost,% of Total,Target Min %,Target Max %,Status\n";
  for (const r of result.categories) {
    csv += toCsvRow([
      r.label,
      r.cost,
      (r.pctOfTotal * 100).toFixed(2),
      (r.targetMinPct * 100).toFixed(2),
      (r.targetMaxPct * 100).toFixed(2),
      r.rangeStatus,
    ]);
  }
  return csv;
}

function buildSelectionsJson(selections: Record<string, ScenarioSelection>) {
  return JSON.stringify(selections, null, 2);
}

function buildDeltaCsv(rows: DeltaRowExport[]) {
  let csv = "Category,Direction,Delta Cost,Delta % of Total,Impact vs A,Heat,Is Driver\n";
  for (const r of rows) {
    csv += toCsvRow([
      r.categoryLabel,
      r.direction,
      r.deltaCost,
      (r.deltaPct * 100).toFixed(2),
      (r.impactVsATotal * 100).toFixed(2),
      r.heat,
      r.isDriver ? "yes" : "no",
    ]);
  }
  return csv;
}

function buildSoftCostsCsv(soft: SoftCostsComputed) {
  let csv = "Line Item,Amount\n";
  for (const b of soft.breakdown) {
    csv += toCsvRow([b.label, b.amount]);
  }
  csv += toCsvRow(["Soft Total", soft.softBase]);
  csv += toCsvRow(["Escalation", soft.escalationAmount]);
  csv += toCsvRow(["Total (Hard+Soft+Escalation)", soft.totalWithEscalation]);
  return csv;
}

function buildCashflowCsv(rows: CashflowYearRow[]) {
  let csv = "Year,Weight,Base Draw,Escalation,Total Draw,Cumulative,Cumulative %\n";
  for (const r of rows) {
    csv += toCsvRow([
      r.year,
      (r.weight * 100).toFixed(2),
      r.baseDraw,
      r.escalationDraw,
      r.totalDraw,
      r.cumulativeTotal,
      (r.cumulativePct * 100).toFixed(2),
    ]);
  }
  return csv;
}

function buildReportText(meta: ClientPackMeta, resultA: ScenarioResult, resultB: ScenarioResult | null, deltaRows: DeltaRowExport[] | null) {
  const lines: string[] = [];
  lines.push(`VMX Client Pack`);
  lines.push(`Generated: ${meta.generatedAtIso}`);
  lines.push(`VMX Version: ${meta.appVersion}`);
  lines.push(`Dataset: ${meta.datasetName}`);
  lines.push(`Dataset Updated: ${meta.datasetLastUpdated}`);
  lines.push(`Assumptions: ${meta.assumptions}`);
  lines.push(`Area: ${meta.areaSqft.toLocaleString()} sq ft`);
  lines.push("");

  lines.push(`Scenario A: ${meta.scenarioABenchmarkName}`);
  lines.push(`Total: ${formatMoney(resultA.totalCost, resultA.currency)} (${formatMoney(resultA.totalCost / Math.max(1, meta.areaSqft), resultA.currency)} / sq ft)`);

  if (meta.compareMode && resultB) {
    lines.push("");
    lines.push(`Scenario B: ${meta.scenarioBBenchmarkName}`);
    lines.push(`Total: ${formatMoney(resultB.totalCost, resultB.currency)} (${formatMoney(resultB.totalCost / Math.max(1, meta.areaSqft), resultB.currency)} / sq ft)`);

    if (deltaRows && deltaRows.length) {
      lines.push("");
      lines.push("Delta Summary (B − A)");
      for (const r of deltaRows.slice(0, 10)) {
        lines.push(`- ${r.categoryLabel}: ${formatMoney(r.deltaCost, resultA.currency)} (${formatPct(r.deltaPct)}) [${r.heat}]${r.isDriver ? " (driver)" : ""}`);
      }
    }
  }

  return lines.join("\n");
}

export async function exportClientPackZip(args: Args) {
  const {
    meta,
    selectionsA,
    resultA,
    selectionsB,
    resultB,
    deltaRows,
    softCostsConfig,
    softCostsA,
    softCostsB,
    cashflowA,
    cashflowB,
  } = args;

  const zip = new JSZip();

  const rootName = safeFileName(`VMX_ClientPack_${meta.datasetName}_${meta.generatedAtIso.slice(0, 10)}`);
  const folder = zip.folder(rootName) ?? zip;

  // Summary report
  folder.file("README.txt", buildReportText(meta, resultA, resultB, deltaRows));

  // JSON snapshots
  folder.file("scenarioA_selections.json", buildSelectionsJson(selectionsA));
  folder.file("scenarioA_result.json", JSON.stringify(resultA, null, 2));

  // CSV tables
  folder.file("scenarioA_allocation.csv", buildAllocationCsv(resultA));

  if (meta.compareMode && selectionsB && resultB) {
    folder.file("scenarioB_selections.json", buildSelectionsJson(selectionsB));
    folder.file("scenarioB_result.json", JSON.stringify(resultB, null, 2));
    folder.file("scenarioB_allocation.csv", buildAllocationCsv(resultB));
  }

  if (meta.compareMode && deltaRows && deltaRows.length) {
    folder.file("delta_heat.csv", buildDeltaCsv(deltaRows));
    folder.file("delta_heat.json", JSON.stringify(deltaRows, null, 2));
  }

  // Soft costs + cashflow
  if (softCostsConfig) {
    folder.file("soft_costs_config.json", configToPrettyJson(softCostsConfig));
  }
  if (softCostsA) {
    folder.file("scenarioA_soft_costs.csv", buildSoftCostsCsv(softCostsA));
    folder.file("scenarioA_soft_costs.json", JSON.stringify(softCostsA, null, 2));
  }
  if (cashflowA) {
    folder.file("scenarioA_cashflow.csv", buildCashflowCsv(cashflowA));
    folder.file("scenarioA_cashflow.json", JSON.stringify(cashflowA, null, 2));
  }
  if (softCostsB) {
    folder.file("scenarioB_soft_costs.csv", buildSoftCostsCsv(softCostsB));
    folder.file("scenarioB_soft_costs.json", JSON.stringify(softCostsB, null, 2));
  }
  if (cashflowB) {
    folder.file("scenarioB_cashflow.csv", buildCashflowCsv(cashflowB));
    folder.file("scenarioB_cashflow.json", JSON.stringify(cashflowB, null, 2));
  }

  const blob = await zip.generateAsync({ type: "blob" });

  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = `${rootName}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  // Release URL object
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}
