# Audit / Decision Logging (AUDIT)

**Component ID:** `AUDIT`  
**Responsibility:** Cross-cutting decision record logging and querying.

## Contract
- `record(DecisionRecord) → ack` — write interface
- `query(import_run_id) → DecisionRecord[]` — read interface
- Every pipeline component calls this after producing output

## Design Rules
- Cross-cutting: called by all components, calls nothing
- Separate from operational logs — these are business-meaningful decision records
- User-facing via AuditLogDTO

## Placeholder
This component will be implemented in Phase 2.
