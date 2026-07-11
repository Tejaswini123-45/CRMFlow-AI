# Shared Contracts

**Purpose:** The ONLY cross-component import allowed.

This directory contains all shared DTOs and internal contract shapes:
- `pipeline_state` — ORCH's state machine types
- `column_profile` — HDRX output to AIMAP
- `mapping_proposal` — AIMAP output
- `finalized_mapping` — MAPFIN output
- `normalized_row` — XFORM output
- `row_verdict` — VALID output
- `duplicate_verdict` — DEDUPE output
- `decision_record` — AUDIT's logging shape
- `import_summary` — EXPORT output

## Design Rule
Any file outside /contracts importing from another component's folder (except via /contracts) is an architecture violation.

/orchestrator is the only folder permitted to import from multiple /pipeline components.

## Placeholder
All contract types will be implemented in Phase 2.
