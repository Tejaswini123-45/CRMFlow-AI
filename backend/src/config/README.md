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

## Implementation (Phase 2)
✅ **Status:** Complete

### Files
- `index.js` — CONFIG provider with get() interface
- `default.config.js` — Default values (from Phase 1)

### Usage
```javascript
import { CONFIG } from '../config/index.js';

const threshold = CONFIG.get('mapping_confidence_threshold'); // 0.75
const schema = CONFIG.getTargetSchema(); // Full schema object
```

### Testing
- Full unit test coverage in `__tests__/config.test.js`
- Validates all LLD §9 categories
- Confirms no deployment-time values in CONFIG
