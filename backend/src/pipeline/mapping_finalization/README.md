# Mapping Finalization (MAPFIN)

**Component ID:** `MAPFIN`  
**Responsibility:** Confidence-based routing and AI/human merge logic.

## Contract
- `route(MappingProposal[], threshold) → { auto_staged, requires_review }`
- `finalize(MappingProposal[], HumanCorrection[]) → FinalizedMapping`
- Signals ORCH to transition to AWAITING_REVIEW when requires_review is non-empty
- Never itself decides a mapping — only routes and merges

## Placeholder
This component will be implemented in Phase 9.
