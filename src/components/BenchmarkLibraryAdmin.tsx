import React, { useMemo, useState } from "react";
import { BenchmarkSet } from "../domain/vmx-domain";
import {
  BenchmarkLibrary,
  TierId,
  TIERS,
  addRegion,
  tierLabel,
  updateRegionName,
  copyTierWithinRegion,
} from "../data/benchmark-library-storage";

type Props = {
  library: BenchmarkLibrary;
  setLibrary: (next: BenchmarkLibrary) => void;

  regionId: string;
  setRegionId: (id: string) => void;

  tier: TierId;
  setTier: (t: TierId) => void;

  currentBenchmark: BenchmarkSet;

  onResetSelectedTier: () => void;

  children?: React.ReactNode;
};

export function BenchmarkLibraryAdmin(props: Props) {
  const {
    library,
    setLibrary,
    regionId,
    setRegionId,
    tier,
    setTier,
    currentBenchmark,
    onResetSelectedTier,
    children,
  } = props;

  const region =
    library.regions.find((r) => r.id === regionId) ?? library.regions[0];

  const [copyFromTier, setCopyFromTier] = useState<TierId>("reserve");

  const copyFromOptions = useMemo(() => TIERS.filter((t) => t !== tier), [tier]);

  function onAddRegion() {
    const name = window.prompt("New region name (e.g., Malibu — Flat):");
    if (!name || !name.trim()) return;
    const next = addRegion(library, name.trim());
    setLibrary(next);
    setRegionId(next.regions[0].id);
  }

  function onRenameRegion() {
    const name = window.prompt("Rename region:", region.name);
    if (!name || !name.trim()) return;
    const next = updateRegionName(library, region.id, name.trim());
    setLibrary(next);
  }

  function onCopyTier() {
    if (copyFromTier === tier) return;
    const ok = window.confirm(
      `Copy ${tierLabel(copyFromTier)} into ${tierLabel(tier)} for region "${region.name}"? This overwrites the destination tier.`
    );
    if (!ok) return;

    const next = copyTierWithinRegion(library, region.id, copyFromTier, tier);
    setLibrary(next);
  }

  if (!region) return null;

  return (
    <div className="card">
      <div className="adminHeader">
        <div>
          <h2>Benchmark Library</h2>
          <div className="muted">
            Organized by <strong>Region</strong> first, then{" "}
            <strong>Tier</strong>. Units: <strong>$/sq ft</strong>.
          </div>
        </div>

        <div className="adminHeaderBtns">
          <button className="secondaryBtn" type="button" onClick={onAddRegion}>
            Add Region
          </button>
          <button
            className="secondaryBtn"
            type="button"
            onClick={onRenameRegion}
          >
            Rename Region
          </button>
        </div>
      </div>

      <div className="adminTopGrid">
        <div>
          <label className="label">Region</label>
          <select
            className="input"
            value={region.id}
            onChange={(e) => setRegionId(e.target.value)}
          >
            {library.regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Tier</label>
          <select
            className="input"
            value={tier}
            onChange={(e) => setTier(e.target.value as TierId)}
          >
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {tierLabel(t)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="libraryToolbar">
        <div className="muted">
          Editing: <strong>{region.name}</strong> /{" "}
          <strong>{tierLabel(tier)}</strong> —{" "}
          <strong>{currentBenchmark.currency}</strong>
        </div>

        <div className="libraryActions">
          <button
            className="secondaryBtn"
            type="button"
            onClick={onResetSelectedTier}
          >
            Reset selected tier to Demo
          </button>

          <div className="copyBox">
            <label className="label" style={{ marginBottom: 4 }}>
              Copy from
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <select
                className="input"
                value={copyFromTier}
                onChange={(e) => setCopyFromTier(e.target.value as TierId)}
              >
                {copyFromOptions.map((t) => (
                  <option key={t} value={t}>
                    {tierLabel(t)}
                  </option>
                ))}
              </select>
              <button className="secondaryBtn" type="button" onClick={onCopyTier}>
                Copy into {tierLabel(tier)}
              </button>
            </div>
          </div>
        </div>
      </div>

      {children}
    </div>
  );
}
