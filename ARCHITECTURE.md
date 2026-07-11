# Architecture & Design Rules

## Cross-Import Restriction (LLD §3)

**Rule:** No component outside `/contracts` may import directly from another component's folder.

**Enforcement:**
- ESLint rule configured in `backend/.eslintrc.json` with `no-restricted-imports`
- Violation message: "Direct imports from pipeline components are forbidden. Use /contracts instead."

**Why this rule exists:**
This enforces the architectural boundary that keeps components independently testable and prevents hidden dependencies. It makes LLD §14's module dependency diagram (where ORCH is the only orchestrator) a verified constraint rather than just documentation.

**Allowed cross-cutting imports:**
- `/contracts` — shared DTOs and interfaces (the only exception to the rule)
- `/config` — configuration provider (cross-cutting read-only access)
- `/audit` — audit logging (cross-cutting write-only)

**The only orchestrator:**
- `/orchestrator` is the only folder permitted to import from multiple `/pipeline` components
- All other components call exactly zero other pipeline components

## Component Boundaries

Each component in `/pipeline` has:
1. A clear, single responsibility (LLD §2)
2. An explicit interface contract (LLD §6)
3. Independent testability
4. README.md documenting its responsibility and placeholder status

## Folder Structure Compliance

The folder structure matches LLD §3 exactly:

```
/backend/src
  /orchestrator         # ORCH — state machine & sequencing
  /pipeline             # Pipeline components
    /ingestion          # INGEST
    /header_analysis    # HDRX
    /ai_mapping         # AIMAP
      /prompt           # Prompt templates
    /mapping_finalization  # MAPFIN
    /transformation     # XFORM
      /rules            # Normalization rules
    /validation         # VALID
      /rules            # Validation rules
    /duplicate_detection  # DEDUPE
      /matchers         # Pluggable matchers
    /export             # EXPORT
  /audit                # AUDIT — cross-cutting logging
  /config               # CONFIG — cross-cutting configuration
  /contracts            # Shared DTOs (ONLY allowed cross-component import)
  /api                  # Frontend-facing interface
    /dto                # API request/response DTOs
  /llm_provider_client  # AIMAP's sole external integration
  /index.js             # Entry point

All code uses ES Modules (type: "module") and modern JavaScript (ES2021+).
```

## Technology Stack

**Backend:**
- Node.js with ES Modules
- Express.js for API routing (Phase 7+)
- JavaScript (no transpilation needed)
- Jest for testing

**Frontend:**
- React 18 with JSX
- Vite for build tooling
- Tailwind CSS for styling
- JavaScript with ES Modules
- Vitest for testing

**Why JavaScript:**
This project uses modern JavaScript (ES Modules) instead of TypeScript to reduce build complexity while maintaining the same architectural principles. All design decisions in the LLD remain unchanged.

## Configuration Strategy (LLD §9)

**Runtime-tunable values** (in `/config`):
- Pipeline thresholds (confidence threshold, size ceilings)
- Retry/timeout policies
- Sampling parameters
- Target schema definition
- Validation rules

**Deployment-time values** (in `.env`):
- Provider endpoints
- Environment name
- Credentials/secrets

**Why separated:** Runtime-tunable values can change without redeploy; deployment values define how the system is hosted. Conflating them creates a mixed-concern component.

## State Machine as Recovery Mechanism

The pipeline state machine (LLD §7) is the recovery mechanism itself. Because progress is persisted stage-by-stage, crash recovery means re-entering at the last known-good stage, not restarting from scratch.

## AI/Deterministic Boundary

**AI Responsibilities (AIMAP only):**
- Semantic column-to-field mapping
- Confidence scoring
- Rationale generation

**Never AI:**
- Field validation
- Value transformation
- Duplicate detection
- Final mapping decisions
- CRM writes

This boundary is the load-bearing architectural decision that makes the system trustable. See HLD §6 and AES §1.

## Testing Against This Architecture

Phase 1 includes a test that deliberately validates the cross-import rule enforcement via ESLint configuration.

The rule will be automatically checked on every CI run via the linting step.

## Version Control

All design documents (PRD, HLD, LLD, UX, AES, Master Implementation Plan) are version-controlled in `/docs` and treated as immutable inputs to implementation, not living documents that change during coding.

This file (ARCHITECTURE.md) is the bridge between those design documents and the actual repository structure, making the documented architectural decisions discoverable without re-reading the full specs.
