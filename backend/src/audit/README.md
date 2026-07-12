# Audit / Decision Logging (AUDIT)

**Component ID:** `AUDIT`  
**Responsibility:** Cross-cutting decision record logging and querying.

## Contract
- `record(DecisionRecord) → ack` — write interface
- `query(import_run_id, filters?) → DecisionRecord[]` — read interface with optional filtering
- Every pipeline component calls this after producing output

## Design Rules
- Cross-cutting: called by all components, calls nothing
- Separate from operational logs — these are business-meaningful decision records
- User-facing via AuditLogDTO
- Supports filtering by stage and subject from the start

## Implementation (Phase 2)
✅ **Status:** Complete

### Files
- `index.js` — AUDIT logger with record() and query()

### Usage
```javascript
import { AUDIT } from '../audit/index.js';

// Record a decision
AUDIT.record({
  import_run_id: 'abc123',
  stage: 'MAPPING_IN_PROGRESS',
  subject: 'email_column',
  decision: 'mapped to email field',
  confidence: 0.95,
  rationale: 'High confidence match'
});

// Query all records for an import
const records = AUDIT.query('abc123');

// Query with filtering
const mappingRecords = AUDIT.query('abc123', { stage: 'MAPPING_IN_PROGRESS' });
```

### Storage
- In-memory Map for Phase 2
- Isolated by import_run_id
- Records returned in chronological order

### Testing
- Full unit test coverage in `__tests__/audit.test.js`
- Validates write→query round-trips
- Confirms isolation between imports
- Tests filtering functionality
