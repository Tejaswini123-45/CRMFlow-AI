# AI Mapping (AIMAP)

**Component ID:** `AIMAP`  
**Responsibility:** Semantic column-to-field mapping using AI, with confidence and rationale.

## Contract
- `propose_mapping(ColumnProfile[], schema_enum) → MappingProposal[] | AIMappingError`
- Constructs mapping prompt and calls LLM Provider
- Performs mandatory structural validation of LLM response
- Only component with LLM Provider access
- Never retries indefinitely — retry policy is CONFIG-bounded

## Design Rules
- AI proposes, never commits
- All output structurally validated before return
- Confidence scores are pass-through, not used by AIMAP itself

## Placeholder
This component will be implemented in Phase 8.
