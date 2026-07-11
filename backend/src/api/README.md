# API Layer

**Purpose:** Frontend-facing interface — talks only to /orchestrator.

## Endpoints (LLD §4)
- `POST /imports` — Create Import (upload file, start pipeline)
- `GET /imports/:id` — Get Import Status (poll current state)
- `GET /imports/:id/mapping` — Get Mapping Proposals (for review UI)
- `POST /imports/:id/mapping` — Submit Mapping Corrections (resume pipeline)
- `GET /imports/:id/result` — Get Import Result (final summary)
- `GET /imports/:id/audit` — Get Audit Log (decision trail)
- `GET /imports/:id/download` — Download Standardized Output

## Design Rules
- All endpoints delegate immediately to ORCH
- No endpoint bypasses ORCH to call pipeline components directly
- Request/response DTOs are distinct from internal /contracts types

## Placeholder
API routes will be implemented starting in Phase 7.
