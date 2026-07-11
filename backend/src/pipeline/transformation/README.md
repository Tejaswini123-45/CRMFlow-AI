# Transformation Engine (XFORM)

**Component ID:** `XFORM`  
**Responsibility:** Deterministic field normalization.

## Contract
- `normalize(raw_rows, FinalizedMapping) → NormalizedRow[]`
- Pure function per row — no dependency on other rows
- Per-field-type normalization rules (phone, date, email, casing/whitespace)
- Un-normalizable values are marked with reason, not dropped

## Design Rules
- Transformation changes values; validation checks them (separate concerns)
- Rules are independently testable, sourced from /rules

## Placeholder
This component will be implemented in Phase 11.
