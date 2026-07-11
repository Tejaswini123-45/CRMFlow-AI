# API Request/Response DTOs

Frontend-facing data transfer objects (LLD §5):
- `CreateImportRequest`
- `ImportRunSummaryDTO`
- `ImportStatusDTO`
- `MappingReviewDTO`
- `MappingProposalView`
- `MappingCorrectionRequest`
- `ImportResultDTO`
- `AuditLogDTO`

These are distinct from internal /contracts types to keep API shape changes independent from pipeline component interfaces.
