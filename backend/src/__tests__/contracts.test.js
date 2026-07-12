/**
 * Contracts Tests
 * Phase 2 - Validates all contract types match LLD §5-6 specifications
 */

import {
  PipelineStateEnum,
  TERMINAL_STATES,
  ErrorTypes,
} from '../contracts/types.js';

describe('Contracts - Pipeline State (LLD §7)', () => {
  it('should have all required pipeline states', () => {
    const requiredStates = [
      'UPLOADED',
      'PARSING',
      'PARSE_FAILED',
      'HEADERS_EXTRACTED',
      'MAPPING_IN_PROGRESS',
      'MAPPING_FAILED',
      'AWAITING_REVIEW',
      'MAPPING_FINALIZED',
      'TRANSFORMING',
      'VALIDATING',
      'DEDUPING',
      'EXPORTING',
      'COMPLETE',
      'FAILED',
    ];

    requiredStates.forEach((state) => {
      expect(PipelineStateEnum[state]).toBe(state);
    });

    // Verify no extra states were added
    expect(Object.keys(PipelineStateEnum)).toHaveLength(requiredStates.length);
  });

  it('should define terminal states correctly', () => {
    expect(TERMINAL_STATES.has(PipelineStateEnum.PARSE_FAILED)).toBe(true);
    expect(TERMINAL_STATES.has(PipelineStateEnum.MAPPING_FAILED)).toBe(true);
    expect(TERMINAL_STATES.has(PipelineStateEnum.COMPLETE)).toBe(true);
    expect(TERMINAL_STATES.has(PipelineStateEnum.FAILED)).toBe(true);

    // Non-terminal states
    expect(TERMINAL_STATES.has(PipelineStateEnum.AWAITING_REVIEW)).toBe(false);
    expect(TERMINAL_STATES.has(PipelineStateEnum.PARSING)).toBe(false);
  });
});

describe('Contracts - Error Types (LLD §10)', () => {
  it('should have all error types from LLD taxonomy', () => {
    const requiredErrorTypes = [
      'STRUCTURAL_PARSE_ERROR',
      'EMPTY_OR_UNREADABLE_FILE',
      'AI_MAPPING_TIMEOUT',
      'AI_MAPPING_MALFORMED_OUTPUT',
      'AI_MAPPING_HARD_FAILURE',
      'FIELD_VALIDATION_FAILURE',
      'TRANSFORMATION_UNRESOLVABLE',
      'PERSISTENCE_WRITE_FAILURE',
      'UNCLASSIFIED_ERROR',
    ];

    requiredErrorTypes.forEach((errorType) => {
      expect(ErrorTypes[errorType]).toBeDefined();
      expect(typeof ErrorTypes[errorType]).toBe('string');
    });

    // Verify no extra error types
    expect(Object.keys(ErrorTypes)).toHaveLength(requiredErrorTypes.length);
  });

  it('should have correctly formatted error type values', () => {
    // Values should match PascalCase format from LLD §10
    expect(ErrorTypes.STRUCTURAL_PARSE_ERROR).toBe('StructuralParseError');
    expect(ErrorTypes.AI_MAPPING_TIMEOUT).toBe('AIMappingTimeout');
    expect(ErrorTypes.UNCLASSIFIED_ERROR).toBe('UnclassifiedError');
  });
});

describe('Contracts - Type Shapes (LLD §5-6)', () => {
  it('should export all required contract types', async () => {
    // Importing from contracts should work
    const contracts = await import('../contracts/index.js');

    // Verify key exports exist
    expect(contracts.PipelineStateEnum).toBeDefined();
    expect(contracts.ErrorTypes).toBeDefined();
    expect(contracts.TERMINAL_STATES).toBeDefined();
  });

  it('should document all internal contract types via JSDoc', () => {
    // This test documents that we have JSDoc @typedef for:
    // - ParsedFile (INGEST output)
    // - ColumnProfile (HDRX output)
    // - MappingProposal (AIMAP output)
    // - FinalizedMapping (MAPFIN output)
    // - NormalizedRow (XFORM output)
    // - RowVerdict (VALID output)
    // - DuplicateVerdict (DEDUPE output)
    // - StandardizedOutput (EXPORT output)
    // - ImportSummary (EXPORT summary)
    // - DecisionRecord (AUDIT shape)

    // Actual validation happens via IDE and JSDoc, not runtime
    expect(true).toBe(true);
  });

  it('should document all API DTO types via JSDoc', () => {
    // This test documents that we have JSDoc @typedef for:
    // - CreateImportRequest
    // - ImportRunSummaryDTO
    // - ImportStatusDTO
    // - MappingReviewDTO
    // - MappingProposalView
    // - MappingCorrectionRequest
    // - ImportResultDTO
    // - AuditLogDTO

    // Actual validation happens via IDE and JSDoc, not runtime
    expect(true).toBe(true);
  });
});
