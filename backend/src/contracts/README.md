# Shared Contracts

**Purpose:** The ONLY cross-component import allowed.

This directory contains all shared DTOs and internal contract shapes.

## Implementation (Phase 2)
✅ **Status:** Complete

### Files
- `types.js` — All contract type definitions with JSDoc
- `index.js` — Barrel export for clean imports

### Contract Types

#### Pipeline State (LLD §7)
- `PipelineStateEnum` — All pipeline states
- `TERMINAL_STATES` — Terminal state set
- `PipelineState` — State structure

#### Error Types (LLD §10)
- `ErrorTypes` — Error taxonomy
- `ErrorResponse` — Error structure

#### Internal Contracts (LLD §6)
- `ParsedFile` — INGEST output
- `ColumnProfile` — HDRX output
- `MappingProposal` — AIMAP output
- `HumanCorrection` — User corrections
- `FinalizedMapping` — MAPFIN output
- `NormalizedRow` — XFORM output
- `RowVerdict` — VALID output
- `DuplicateVerdict` — DEDUPE output
- `StandardizedOutput` — EXPORT output
- `ImportSummary` — Export summary

#### Audit (LLD §11)
- `DecisionRecord` — Audit log entry

#### API DTOs (LLD §5)
- `CreateImportRequest`
- `ImportRunSummaryDTO`
- `ImportStatusDTO`
- `MappingReviewDTO`
- `MappingProposalView`
- `MappingCorrectionRequest`
- `ImportResultDTO`
- `AuditLogDTO`

### Usage
```javascript
// Import from contracts, never from other components
import { PipelineStateEnum, ErrorTypes } from '../contracts/index.js';
```

## Design Rule
Any file outside /contracts importing from another component's folder (except via /contracts) is an architecture violation.

/orchestrator is the only folder permitted to import from multiple /pipeline components.

### Testing
- Full schema validation in `__tests__/contracts.test.js`
- Validates all states and error types match LLD specifications
