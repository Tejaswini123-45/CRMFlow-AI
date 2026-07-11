# CSV Ingestion (INGEST)

**Component ID:** `INGEST`  
**Responsibility:** Detects encoding and delimiter; produces structural parse of CSV files.

## Contract
- `ingest(raw_file) → ParsedFile | IngestionError`
- Does not interpret column meaning — output is purely structural

## Placeholder
This component will be implemented in Phase 4.
