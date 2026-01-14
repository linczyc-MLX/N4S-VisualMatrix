# N4S-VMX — Visual Matrix (VMX)

US-first VMX prototype for N4S / KYC workflows:
- Area unit: **square feet**
- Budgeting model: heat bands (Low / Medium / High) by category with benchmark guardrails
- Benchmark library: **Region → Tier** (1 Select, 2 Reserve, 3 Signature, 4 Legacy)
- Local persistence: browser localStorage (MVP)
- Snapshots: phase-stamped saves (Strategic Definition / Asset Brief / Design)

## Run locally
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
npm run preview
```

## Notes
- Future backlog: unit selector (sq ft ↔ sq m), multi-scenario comparisons (Flat vs Hillside), export (PDF/CSV), server-backed storage.
