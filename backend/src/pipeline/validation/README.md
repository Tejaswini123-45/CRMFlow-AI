# Validation Engine (VALID)

**Component ID:** `VALID`  
**Responsibility:** Deterministic schema and business validation.

## Contract
- `validate(NormalizedRow[], rules) → RowVerdict[]`
- Schema validation → business validation ordering
- Field-level verdicts with specific reasons
- Pure function per row — no cross-row dependencies

## Design Rules
- Validation checks correctness; transformation changes values (separate concerns)
- Rules are independently testable, sourced from /rules

## Placeholder
This component will be implemented in Phase 12.
