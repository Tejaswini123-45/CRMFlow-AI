# Pipeline Orchestrator (ORCH)

**Component ID:** `ORCH`  
**Responsibility:** Owns the state machine for a given import run; sequences all pipeline component calls.

## Contract
- Owns and advances the canonical `PipelineState` record
- Sequences calls: `INGEST → HDRX → AIMAP → MAPFIN → XFORM → VALID → DEDUPE → EXPORT`
- Persists state transitions on every stage completion
- Only component permitted to write `PipelineState`
- Exposes the sole interface the Frontend talks to

## Design Rules
- No pipeline component calls another directly; all go through ORCH
- State transitions are written before invoking the next stage
- Only ORCH, AUDIT, and CONFIG are cross-cutting components

## Placeholder
This directory will contain the pipeline state machine and controller logic in Phase 3.
