/**
 * Shared Contract Types
 * LLD §5 (API DTOs), §6 (Internal Interfaces), §7 (Pipeline State), §10 (Errors), §11 (Audit)
 * 
 * All type definitions for cross-component communication.
 * Components import from this module, never from each other directly.
 */

// ============================================================================
// PIPELINE STATE (LLD §7)
// ============================================================================

/**
 * Pipeline state enum - Top-level states
 */
export const PipelineStateEnum = {
  UPLOADED: 'UPLOADED',
  PARSING: 'PARSING',
  PARSE_FAILED: 'PARSE_FAILED',
  HEADERS_EXTRACTED: 'HEADERS_EXTRACTED',
  MAPPING_IN_PROGRESS: 'MAPPING_IN_PROGRESS',
  MAPPING_FAILED: 'MAPPING_FAILED',
  AWAITING_REVIEW: 'AWAITING_REVIEW',
  MAPPING_FINALIZED: 'MAPPING_FINALIZED',
  TRANSFORMING: 'TRANSFORMING',
  VALIDATING: 'VALIDATING',
  DEDUPING: 'DEDUPING',
  EXPORTING: 'EXPORTING',
  COMPLETE: 'COMPLETE',
  FAILED: 'FAILED',
};

/**
 * Terminal states - no further transitions allowed
 */
export const TERMINAL_STATES = new Set([
  PipelineStateEnum.PARSE_FAILED,
  PipelineStateEnum.MAPPING_FAILED,
  PipelineStateEnum.COMPLETE,
  PipelineStateEnum.FAILED,
]);

/**
 * @typedef {Object} PipelineState
 * @property {string} import_run_id - Unique identifier for this import run
 * @property {string} state - Current state from PipelineStateEnum
 * @property {string} current_stage - Human-readable stage label
 * @property {Date} created_at - When the import was created
 * @property {Date} updated_at - Last state transition time
 * @property {Object|null} error - Error details if in failed state
 */

// ============================================================================
// ERROR TYPES (LLD §10)
// ============================================================================

export const ErrorTypes = {
  STRUCTURAL_PARSE_ERROR: 'StructuralParseError',
  EMPTY_OR_UNREADABLE_FILE: 'EmptyOrUnreadableFile',
  AI_MAPPING_TIMEOUT: 'AIMappingTimeout',
  AI_MAPPING_MALFORMED_OUTPUT: 'AIMappingMalformedOutput',
  AI_MAPPING_HARD_FAILURE: 'AIMappingHardFailure',
  FIELD_VALIDATION_FAILURE: 'FieldValidationFailure',
  TRANSFORMATION_UNRESOLVABLE: 'TransformationUnresolvable',
  PERSISTENCE_WRITE_FAILURE: 'PersistenceWriteFailure',
  UNCLASSIFIED_ERROR: 'UnclassifiedError',
};

/**
 * @typedef {Object} ErrorResponse
 * @property {string} type - Error type from ErrorTypes
 * @property {string} message - Human-readable error message
 * @property {Object} [details] - Additional error context
 */

// ============================================================================
// INTERNAL CONTRACTS (LLD §6) - Component Interfaces
// ============================================================================

/**
 * @typedef {Object} ParsedFile
 * @property {Array<Array<string>>} rows - Raw row data
 * @property {string[]} headers - Column headers
 * @property {string} encoding - Detected encoding
 * @property {string} delimiter - Detected delimiter
 * @property {number} row_count - Total rows parsed
 */

/**
 * @typedef {Object} ColumnProfile
 * @property {string} header - Column header text
 * @property {string[]} sample_values - Representative sample values (bounded)
 * @property {number} column_index - Position in source file
 */

/**
 * @typedef {Object} MappingProposal
 * @property {string} column_header - Source column header
 * @property {string} target_field - Target schema field ID or 'UNMAPPED'
 * @property {number} confidence - Confidence score [0, 1]
 * @property {string} rationale - Human-readable reasoning
 */

/**
 * @typedef {Object} HumanCorrection
 * @property {string} column_header - Which column to correct
 * @property {string} corrected_field - Corrected target field ID
 */

/**
 * @typedef {Object} FinalizedMapping
 * @property {Object<string, string>} column_to_field - Map of column_header → target_field_id
 * @property {Date} finalized_at - When mapping was finalized
 * @property {boolean} had_corrections - Whether human corrections were applied
 */

/**
 * @typedef {Object} NormalizedRow
 * @property {number} row_index - Original row number
 * @property {Object<string, any>} fields - Normalized field values
 * @property {Object<string, string>} [normalization_notes] - Per-field normalization applied
 */

/**
 * @typedef {Object} FieldVerdict
 * @property {string} field_name - Field identifier
 * @property {boolean} is_valid - Validation result
 * @property {string} [reason] - Failure reason if invalid
 */

/**
 * @typedef {Object} RowVerdict
 * @property {number} row_index - Row identifier
 * @property {string} overall_verdict - 'VALID' | 'INVALID' | 'PARTIAL'
 * @property {FieldVerdict[]} field_verdicts - Per-field validation results
 */

/**
 * @typedef {Object} DuplicateVerdict
 * @property {number} row_index - Row identifier
 * @property {boolean} is_duplicate - Whether row is a duplicate
 * @property {string} match_type - 'EXACT' | 'NONE'
 * @property {string[]} [matched_fields] - Which fields matched
 * @property {string} [matched_against] - Reference to existing record
 */

/**
 * @typedef {Object} StandardizedOutput
 * @property {Array<Object>} rows - Final standardized rows
 * @property {string} format - Output format (e.g., 'CSV', 'JSON')
 * @property {Date} generated_at - When output was generated
 */

/**
 * @typedef {Object} ImportSummary
 * @property {string} import_run_id - Import identifier
 * @property {number} accepted_count - Successfully imported rows
 * @property {number} skipped_count - Skipped rows
 * @property {number} flagged_count - Flagged for review
 * @property {number} duplicate_count - Duplicate rows
 * @property {Array<{reason: string, count: number}>} summary_reasons - Categorized outcomes
 */

// ============================================================================
// AUDIT LOG (LLD §11)
// ============================================================================

/**
 * @typedef {Object} DecisionRecord
 * @property {string} import_run_id - Import identifier
 * @property {string} stage - Pipeline stage (from PipelineStateEnum)
 * @property {string} subject - What the decision was about (e.g., column header, row ID)
 * @property {string} decision - The decision made (e.g., target field chosen, verdict)
 * @property {number} [confidence] - Confidence score if from AI (nullable)
 * @property {string} [rationale] - Reasoning if available (nullable)
 * @property {Date} timestamp - When decision was made
 */

// ============================================================================
// API DTOs (LLD §5) - Frontend ↔ Backend
// ============================================================================

/**
 * @typedef {Object} CreateImportRequest
 * @property {Buffer|File} file - CSV file (binary)
 * @property {string} [target_schema_id] - Optional schema identifier
 */

/**
 * @typedef {Object} ImportRunSummaryDTO
 * @property {string} import_run_id - Unique identifier
 * @property {string} state - Current state from PipelineStateEnum
 * @property {Date} created_at - Creation timestamp
 */

/**
 * @typedef {Object} ImportStatusDTO
 * @property {string} import_run_id - Import identifier
 * @property {string} state - Current state from PipelineStateEnum
 * @property {string} current_stage - Human-readable stage
 * @property {boolean} requires_action - Whether user action needed
 * @property {string} progress_summary - Stage-level progress description
 */

/**
 * @typedef {Object} MappingProposalView
 * @property {string} column_header - Source column header
 * @property {string[]} sample_values - Sample values for context
 * @property {string} proposed_field - Target field or 'UNMAPPED'
 * @property {number} confidence - Confidence score [0, 1]
 * @property {string} rationale - AI reasoning
 * @property {boolean} requires_review - Below threshold flag
 */

/**
 * @typedef {Object} MappingReviewDTO
 * @property {string} import_run_id - Import identifier
 * @property {MappingProposalView[]} proposals - All mapping proposals
 */

/**
 * @typedef {Object} MappingCorrectionRequest
 * @property {string} import_run_id - Import identifier
 * @property {Array<{column_header: string, corrected_field: string}>} corrections - User corrections
 */

/**
 * @typedef {Object} ImportResultDTO
 * @property {string} import_run_id - Import identifier
 * @property {number} accepted_count - Accepted rows
 * @property {number} skipped_count - Skipped rows
 * @property {number} flagged_count - Flagged rows
 * @property {number} duplicate_count - Duplicate rows
 * @property {string} output_download_ref - Reference to output file
 * @property {Array<{reason: string, count: number}>} summary_reasons - Outcome breakdown
 */

/**
 * @typedef {Object} AuditLogDTO
 * @property {string} import_run_id - Import identifier
 * @property {DecisionRecord[]} records - All decision records
 */
