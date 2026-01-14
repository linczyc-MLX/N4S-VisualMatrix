import { BenchmarkSet } from "../domain/vmx-domain";

/**
 * Minimal, valid demo benchmark set.
 * Units: $/sq ft (psqft).
 *
 * Note: Vite/esbuild requires the exports in this file to be syntactically correct;
 * missing or mis-ordered exports will cause a white screen.
 */
export const demoBenchmark: BenchmarkSet = {
  id: "demo-us-reserve",
  name: "US — Demo — Reserve",
  currency: "USD",
  bands: [
    { categoryId: "FACILITATING", band: "LOW", psqft: 3 },
    { categoryId: "FACILITATING", band: "MEDIUM", psqft: 51 },
    { categoryId: "FACILITATING", band: "HIGH", psqft: 106 },

    { categoryId: "SUBSTRUCTURE", band: "LOW", psqft: 63 },
    { categoryId: "SUBSTRUCTURE", band: "MEDIUM", psqft: 256 },
    { categoryId: "SUBSTRUCTURE", band: "HIGH", psqft: 390 },

    { categoryId: "SUPERSTRUCTURE", band: "LOW", psqft: 280 },
    { categoryId: "SUPERSTRUCTURE", band: "MEDIUM", psqft: 520 },
    { categoryId: "SUPERSTRUCTURE", band: "HIGH", psqft: 780 },

    { categoryId: "INTERNAL_FINISHES", band: "LOW", psqft: 220 },
    { categoryId: "INTERNAL_FINISHES", band: "MEDIUM", psqft: 460 },
    { categoryId: "INTERNAL_FINISHES", band: "HIGH", psqft: 720 },

    { categoryId: "FF_E", band: "LOW", psqft: 120 },
    { categoryId: "FF_E", band: "MEDIUM", psqft: 260 },
    { categoryId: "FF_E", band: "HIGH", psqft: 420 },

    { categoryId: "SERVICES", band: "LOW", psqft: 140 },
    { categoryId: "SERVICES", band: "MEDIUM", psqft: 280 },
    { categoryId: "SERVICES", band: "HIGH", psqft: 440 },

    { categoryId: "EXTERNAL_WORKS", band: "LOW", psqft: 90 },
    { categoryId: "EXTERNAL_WORKS", band: "MEDIUM", psqft: 180 },
    { categoryId: "EXTERNAL_WORKS", band: "HIGH", psqft: 300 },
  ],
  // Keep this as an array for broad compatibility; the storage layer normalizes on load.
  targetRanges: [
    { categoryId: "FACILITATING", minPct: 0.05, maxPct: 0.10 },
    { categoryId: "SUBSTRUCTURE", minPct: 0.15, maxPct: 0.20 },
    { categoryId: "SUPERSTRUCTURE", minPct: 0.25, maxPct: 0.30 },
    { categoryId: "INTERNAL_FINISHES", minPct: 0.20, maxPct: 0.25 },
    { categoryId: "FF_E", minPct: 0.10, maxPct: 0.15 },
    { categoryId: "SERVICES", minPct: 0.10, maxPct: 0.15 },
    { categoryId: "EXTERNAL_WORKS", minPct: 0.05, maxPct: 0.10 },
  ],
};

export const demoBenchmarkME: BenchmarkSet = {
  ...demoBenchmark,
  id: "demo-me-reserve",
  name: "ME — Demo — Reserve",
  // Keep USD unless/until you decide to model currency conversion (AED/SAR) in-app.
  currency: "USD",
  bands: demoBenchmark.bands.map((b) => ({ ...b })),
  targetRanges: Array.isArray((demoBenchmark as any).targetRanges)
    ? (demoBenchmark as any).targetRanges.map((r: any) => ({ ...r }))
    : (demoBenchmark as any).targetRanges,
};
