# AI-Powered CRM Data Ingestion Engine

**Status:** Phase 1 Complete — Project Setup & Scaffolding  
**Next Phase:** Phase 2 — Shared Contracts, Config Provider, and Audit Logging Foundation

---

## Project Overview

This system ingests lead data from arbitrary CSV sources, uses AI to semantically map columns to a standardized CRM schema, validates and normalizes data with deterministic rules, and produces CRM-ready output with full auditability.

**Core Value Proposition:** Removes manual CSV mapping work by using AI for semantic understanding while keeping all validation, transformation, and final decisions deterministic and testable.

**Key Architectural Decision:** AI proposes, deterministic code validates, human approves. See `ARCHITECTURE.md` for the AI/deterministic boundary specification.

---

## Repository Structure

```
/docs                   # Immutable design documents (PRD, HLD, LLD, UX, AES, Master Plan)
/backend                # Node.js/Express/JavaScript backend (modular monolith)
  /src
    /orchestrator       # Pipeline state machine (ORCH)
    /pipeline/*         # Pipeline components (INGEST, HDRX, AIMAP, MAPFIN, XFORM, VALID, DEDUPE, EXPORT)
    /contracts          # Shared DTOs (ONLY allowed cross-component import)
    /config             # Runtime configuration provider
    /audit              # Decision record logging
    /api                # Frontend-facing interface
/frontend               # React/Vite/JavaScript/Tailwind CSS frontend (static deployment)
/.github/workflows      # CI pipeline
```

See `ARCHITECTURE.md` for detailed folder structure and component boundaries.

---

## Phase 1 Accomplishments

✅ **Folder structure** — Matches LLD §3 exactly, with placeholder READMEs in every component  
✅ **Linting/formatting** — ESLint + Prettier configured for both backend and frontend  
✅ **Cross-import restriction** — ESLint rule enforces "no direct component-to-component imports" (LLD §3 design rule)  
✅ **CI pipeline** — GitHub Actions workflow runs lint + test on every commit  
✅ **Config scaffolding** — Default configuration with all keys from LLD §9, populated with PRD §9 target schema  
✅ **Environment separation** — `.env.example` separates deployment-time values from runtime CONFIG  

---

## Design Documents

All design documents are in `/docs` and treated as immutable:

- **PRD** (`docs/PRD.md`) — Product requirements, business problem, success metrics
- **HLD** (`docs/HLD.md`) — High-level architecture, component responsibilities, design decisions
- **LLD** (`docs/LLD.md`) — Low-level design, interfaces, error taxonomy, state machine
- **UX** (`docs/UX.md`) — User experience specification, screen flows, component design
- **AES** (`docs/AES.md`) — AI engineering specification for the AI Mapping Engine (AIMAP)
- **Master Implementation Plan** (`docs/MASTER_IMPLEMENTATION_PLAN.md`) — 20-phase execution plan

---

## Key Architectural Principles

1. **AI proposes, deterministic code decides** — AI only performs semantic mapping; all validation/transformation is rule-based
2. **No silent failure** — Every low-confidence decision, validation rejection, parse error surfaces explicitly
3. **State lives in backend** — Pipeline progress is durable and resumable, not held in browser
4. **Bounded blast radius** — Row failure never escalates to file failure; file failure never corrupts prior stages
5. **Cross-import restriction** — Components communicate through `/contracts` only, enforced by lint rule

See `ARCHITECTURE.md` for full explanation.

---

## Development Setup

**Prerequisites:**
- Node.js 20+
- npm

**Quick Start (Recommended):**
```bash
# From root directory - Install all dependencies
npm run install:all

# Copy environment files
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
# Edit .env files with your configuration

# Run both backend and frontend in development
npm run dev

# Or run separately:
npm run dev:backend    # Backend only
npm run dev:frontend   # Frontend only

# Run linting across all workspaces
npm run lint

# Run tests across all workspaces
npm test
```

**Backend setup (individual):**
```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your configuration

npm run lint        # Run linter
npm test           # Run tests
npm run dev        # Start dev server (Phase 7+)
```

**Frontend setup (individual):**
```bash
cd frontend
npm install

npm run lint        # Run linter
npm test           # Run tests
npm run dev        # Start dev server (Phase 6+)
```

**Tech Stack:**
- Backend: Node.js + Express + JavaScript (ES Modules)
- Frontend: React 18 + Vite + Tailwind CSS + JavaScript
- Testing: Jest (backend), Vitest (frontend)

---

## Testing Strategy

Phase 1 includes:
- Lint rules that enforce architectural boundaries
- CI pipeline that runs on every commit
- Test infrastructure ready (Jest for backend, Vitest for frontend)

Phase-specific testing will be added as each component is implemented per the Master Implementation Plan.

---

## Configuration

**Runtime-tunable** (in `backend/src/config/default.config.ts`):
- Mapping confidence threshold: 0.75
- File size ceiling: 10,000 rows
- AI timeout: 30 seconds
- Sample size: 10 values per column
- Target CRM schema (from PRD §9)

**Deployment-time** (in `.env`):
- LLM provider endpoint and credentials
- Database connection
- Server ports
- Storage paths

See LLD §9 for why these are separated.

---

## Next Steps (Phase 2)

The next phase will implement:
- All `/contracts` type definitions (DTOs and internal interfaces)
- `CONFIG` module with get() interface and default values
- `AUDIT` module with record() and query() interfaces
- Full unit tests for all three

See `docs/MASTER_IMPLEMENTATION_PLAN.md` Phase 2 for detailed acceptance criteria.

---

## Implementation Progress

| Phase | Status | Focus |
|---|---|---|
| 1 | ✅ **Complete** | Project Setup & Scaffolding |
| 2 | 🔜 Next | Shared Contracts, Config, Audit |
| 3-20 | ⏳ Planned | See Master Implementation Plan |

---

## Design Decisions

For the full architectural decision record (including alternatives considered and trade-offs accepted), see HLD §11 and the AI engineering rationale in AES.

**Most important decision:** The AI/deterministic boundary (HLD §6, AES §1) is the system's core architectural constraint and is enforced structurally, not just documented.

---

## License

MIT

---

## Documentation

- Architecture and design rules: `ARCHITECTURE.md`
- Component contracts: Each `/backend/src/**/README.md`
- Full design documents: `/docs/*`

This README will be updated at the end of each phase to reflect new capabilities.
