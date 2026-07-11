# Contributing Guide

## Phase-Based Development

This project follows a strictly phased implementation approach per the Master Implementation Plan (`docs/MASTER_IMPLEMENTATION_PLAN.md`).

**Current Phase:** Phase 1 — Project Setup & Scaffolding ✅ COMPLETE

**Next Phase:** Phase 2 — Shared Contracts, Config Provider, and Audit Logging Foundation

## Development Workflow

1. **One Phase Per Session** — Each phase is scoped to be completed in a single focused development session
2. **Phase Dependencies Must Be Merged** — Never start a phase before its dependencies are complete
3. **No Feature Additions** — Do not add features beyond what the approved design documents specify
4. **Test Before Merge** — Every phase has explicit acceptance criteria that must pass

## Architectural Rules (ENFORCED)

### Cross-Import Restriction

**Rule:** No component outside `/contracts` may import directly from another component's folder.

This is enforced by ESLint and will fail CI if violated.

```javascript
// ❌ FORBIDDEN
import { something } from '../pipeline/ingestion/parser.js';

// ✅ ALLOWED
import { ParsedFile } from '../contracts/parsed-file.js';
```

**Why:** This keeps components independently testable and prevents hidden dependencies.

**Exceptions:**
- `/contracts` — shared DTOs (the only cross-component import allowed)
- `/config` — configuration provider (cross-cutting read-only)
- `/audit` — audit logging (cross-cutting write-only)

### Orchestrator-Only Sequencing

Only `/orchestrator` may call multiple pipeline components. All other components call exactly zero other pipeline components.

## Code Style

- **Linting:** `npm run lint` (enforced in CI)
- **Formatting:** `npm run format` (Prettier)
- **ES Modules:** All code uses `import`/`export`, not `require`
- **Modern JavaScript:** ES2021+ features are allowed

## Testing Requirements

Each phase has specific testing requirements in its acceptance criteria:

- **Unit tests** for pure functions (transformation rules, validation rules)
- **Contract tests** for component interfaces
- **Integration tests** for state machine transitions
- **End-to-end tests** for full pipeline flows (later phases)

## Commit Messages

Use clear, descriptive commit messages referencing the phase:

```
Phase 1: Initial project setup and scaffolding

- Folder structure matching LLD §3
- ESLint cross-import restriction configured
- CI pipeline for lint and test
- Config scaffolding with PRD §9 schema
```

## Design Documents Are Immutable

The following documents in `/docs` are treated as **immutable inputs**, not living documents:

- PRD.md
- HLD.md
- LLD.md
- UX.md
- AES.md
- MASTER_IMPLEMENTATION_PLAN.md

Do not modify these during implementation. If a genuine design issue is discovered, document it separately and discuss before changing approved specs.

## Pull Request Checklist

- [ ] All acceptance criteria for the phase are met
- [ ] Tests pass: `npm test`
- [ ] Linting passes: `npm run lint`
- [ ] No cross-import violations
- [ ] Phase README or documentation updated
- [ ] Changes match the phase scope exactly (no scope creep)

## Repository Structure

See `ARCHITECTURE.md` for the complete folder structure and design rules.

## Questions?

Refer to:
- **Architecture decisions:** `ARCHITECTURE.md`
- **Phase requirements:** `docs/MASTER_IMPLEMENTATION_PLAN.md`
- **Component contracts:** Each `/backend/src/**/README.md`
- **Full specifications:** `/docs/PRD.md`, `/docs/HLD.md`, `/docs/LLD.md`
