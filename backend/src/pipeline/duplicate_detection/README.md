# Duplicate Detection (DEDUPE)

**Component ID:** `DEDUPE`  
**Responsibility:** Exact-match duplicate detection with pluggable matcher interface.

## Contract
- `detect(rows_with_verdicts, existing_data_lookup, matcher) → DuplicateVerdict[]`
- Exact-match comparison on configured key fields (email, phone) for MVP
- Interface designed for pluggable matcher (fuzzy matching is Category B)

## Design Rules
- Matcher interface is genuinely swappable
- Isolated per HLD Decision #4 to enable future extraction

## Placeholder
This component will be implemented in Phase 13.
