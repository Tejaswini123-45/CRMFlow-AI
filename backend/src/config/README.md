# Configuration Provider (CONFIG)

**Component ID:** `CONFIG`  
**Responsibility:** Supplies all tunable runtime values.

## Contract
- `get(key) → value` — typed accessors per config category
- Read-only from every component's perspective

## Configuration Categories (LLD §9)
- Pipeline thresholds (confidence threshold, file size ceiling)
- Retry/timeout policy (AI mapping timeout, max retries)
- Sampling (header analysis sample size)
- Target schema definition (field enum, business meaning, alt-name patterns)
- Validation rules (per-field format rules, required fields)

## Design Rules
- Runtime-tunable values live here as data
- Deployment-time values (endpoints, environment) are separate
- No mixed concerns — CONFIG is pure runtime configuration

## Placeholder
This component will be implemented in Phase 2.
