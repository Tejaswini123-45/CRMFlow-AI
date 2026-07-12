/**
 * Pipeline State Machine
 * LLD §7 (Pipeline State Definitions)
 *
 * Defines all valid state transitions and transition logic.
 * Orchestrator is the sole caller of these functions.
 */

import { PipelineStateEnum, TERMINAL_STATES, ErrorTypes } from '../contracts/types.js';
import { AUDIT } from '../audit/index.js';

/**
 * State transition graph - defines all valid transitions
 * LLD §7: "Every transition is written by ORCH only, and only after the responsible
 * component returns a success payload for the current stage"
 */
const STATE_TRANSITIONS = {
  [PipelineStateEnum.UPLOADED]: [PipelineStateEnum.PARSING],
  [PipelineStateEnum.PARSING]: [
    PipelineStateEnum.HEADERS_EXTRACTED,
    PipelineStateEnum.PARSE_FAILED,
    PipelineStateEnum.FAILED,
  ],
  [PipelineStateEnum.HEADERS_EXTRACTED]: [
    PipelineStateEnum.MAPPING_IN_PROGRESS,
    PipelineStateEnum.FAILED,
  ],
  [PipelineStateEnum.MAPPING_IN_PROGRESS]: [
    PipelineStateEnum.AWAITING_REVIEW,
    PipelineStateEnum.MAPPING_FINALIZED,
    PipelineStateEnum.MAPPING_FAILED,
    PipelineStateEnum.FAILED,
  ],
  [PipelineStateEnum.AWAITING_REVIEW]: [
    PipelineStateEnum.MAPPING_FINALIZED,
    PipelineStateEnum.FAILED,
  ],
  [PipelineStateEnum.MAPPING_FINALIZED]: [
    PipelineStateEnum.TRANSFORMING,
    PipelineStateEnum.FAILED,
  ],
  [PipelineStateEnum.TRANSFORMING]: [
    PipelineStateEnum.VALIDATING,
    PipelineStateEnum.FAILED,
  ],
  [PipelineStateEnum.VALIDATING]: [PipelineStateEnum.DEDUPING, PipelineStateEnum.FAILED],
  [PipelineStateEnum.DEDUPING]: [PipelineStateEnum.EXPORTING, PipelineStateEnum.FAILED],
  [PipelineStateEnum.EXPORTING]: [PipelineStateEnum.COMPLETE, PipelineStateEnum.FAILED],
  // Terminal states have no outbound transitions
  [PipelineStateEnum.PARSE_FAILED]: [],
  [PipelineStateEnum.MAPPING_FAILED]: [],
  [PipelineStateEnum.COMPLETE]: [],
  [PipelineStateEnum.FAILED]: [],
};

/**
 * Stage-to-state mapping - defines which states correspond to which stages
 * Reserved for future use in reverse lookups
 */
// const STAGE_TO_STATE = {
//   INGEST: PipelineStateEnum.PARSING,
//   HDRX: PipelineStateEnum.HEADERS_EXTRACTED,
//   AIMAP: PipelineStateEnum.MAPPING_IN_PROGRESS,
//   MAPFIN_ROUTE: PipelineStateEnum.AWAITING_REVIEW, // When review required
//   MAPFIN_FINALIZE: PipelineStateEnum.MAPPING_FINALIZED,
//   XFORM: PipelineStateEnum.TRANSFORMING,
//   VALID: PipelineStateEnum.VALIDATING,
//   DEDUPE: PipelineStateEnum.DEDUPING,
//   EXPORT: PipelineStateEnum.EXPORTING,
// };

/**
 * Human-readable stage labels for API responses
 * LLD §7: "current_stage is a coarser, user-facing label"
 */
const STATE_TO_STAGE_LABEL = {
  [PipelineStateEnum.UPLOADED]: 'File Uploaded',
  [PipelineStateEnum.PARSING]: 'Parsing File',
  [PipelineStateEnum.PARSE_FAILED]: 'Parse Failed',
  [PipelineStateEnum.HEADERS_EXTRACTED]: 'Analyzing Headers',
  [PipelineStateEnum.MAPPING_IN_PROGRESS]: 'Mapping Columns',
  [PipelineStateEnum.MAPPING_FAILED]: 'Mapping Failed',
  [PipelineStateEnum.AWAITING_REVIEW]: 'Awaiting Review',
  [PipelineStateEnum.MAPPING_FINALIZED]: 'Mapping Finalized',
  [PipelineStateEnum.TRANSFORMING]: 'Cleaning Data',
  [PipelineStateEnum.VALIDATING]: 'Validating Data',
  [PipelineStateEnum.DEDUPING]: 'Detecting Duplicates',
  [PipelineStateEnum.EXPORTING]: 'Generating Output',
  [PipelineStateEnum.COMPLETE]: 'Complete',
  [PipelineStateEnum.FAILED]: 'Failed',
};

/**
 * Error type to terminal state mapping
 * LLD §10: Error Taxonomy
 */
const ERROR_TO_TERMINAL_STATE = {
  [ErrorTypes.STRUCTURAL_PARSE_ERROR]: PipelineStateEnum.PARSE_FAILED,
  [ErrorTypes.EMPTY_OR_UNREADABLE_FILE]: PipelineStateEnum.PARSE_FAILED,
  [ErrorTypes.AI_MAPPING_HARD_FAILURE]: PipelineStateEnum.MAPPING_FAILED,
  [ErrorTypes.UNCLASSIFIED_ERROR]: PipelineStateEnum.FAILED,
  [ErrorTypes.PERSISTENCE_WRITE_FAILURE]: PipelineStateEnum.FAILED,
};

/**
 * Recoverable error types
 * LLD §10: "Recoverable? Yes" errors
 */
const RECOVERABLE_ERRORS = new Set([
  ErrorTypes.AI_MAPPING_TIMEOUT,
  ErrorTypes.AI_MAPPING_MALFORMED_OUTPUT,
  ErrorTypes.FIELD_VALIDATION_FAILURE,
  ErrorTypes.TRANSFORMATION_UNRESOLVABLE,
]);

/**
 * Check if a state transition is valid
 *
 * @param {string} fromState - Current state
 * @param {string} toState - Target state
 * @returns {boolean} True if transition is valid
 */
export function isValidTransition(fromState, toState) {
  const validNextStates = STATE_TRANSITIONS[fromState];
  if (!validNextStates) {
    return false;
  }
  return validNextStates.includes(toState);
}

/**
 * Check if a state is terminal
 *
 * @param {string} state - State to check
 * @returns {boolean} True if state is terminal
 */
export function isTerminalState(state) {
  return TERMINAL_STATES.has(state);
}

/**
 * Get human-readable stage label for a state
 *
 * @param {string} state - Pipeline state
 * @returns {string} Human-readable label
 */
export function getStageLabel(state) {
  return STATE_TO_STAGE_LABEL[state] || state;
}

/**
 * Determine next state based on stage completion
 *
 * @param {string} currentState - Current pipeline state
 * @param {Object} stageResult - Result from component execution
 * @param {boolean} stageResult.success - Whether stage succeeded
 * @param {Object} [stageResult.error] - Error details if failed
 * @param {boolean} [stageResult.requires_review] - Whether review is required (MAPFIN only)
 * @returns {string} Next state
 */
export function determineNextState(currentState, stageResult) {
  // If stage failed, determine failure state
  if (!stageResult.success) {
    const errorType = stageResult.error?.type;

    // Check if it's a recoverable error
    if (errorType && RECOVERABLE_ERRORS.has(errorType)) {
      // Recoverable errors continue pipeline but may flag data
      // For mapping errors, they route to review
      if (
        currentState === PipelineStateEnum.MAPPING_IN_PROGRESS &&
        (errorType === ErrorTypes.AI_MAPPING_TIMEOUT ||
          errorType === ErrorTypes.AI_MAPPING_MALFORMED_OUTPUT)
      ) {
        return PipelineStateEnum.AWAITING_REVIEW;
      }
      // Other recoverable errors don't change the normal flow
      // (they're handled within the stage - row-level failures)
    }

    // Map error type to terminal state
    const terminalState = ERROR_TO_TERMINAL_STATE[errorType];
    if (terminalState) {
      return terminalState;
    }

    // Default to FAILED for unclassified errors
    return PipelineStateEnum.FAILED;
  }

  // Success path - determine next state based on current state
  switch (currentState) {
    case PipelineStateEnum.UPLOADED:
      return PipelineStateEnum.PARSING;

    case PipelineStateEnum.PARSING:
      return PipelineStateEnum.HEADERS_EXTRACTED;

    case PipelineStateEnum.HEADERS_EXTRACTED:
      return PipelineStateEnum.MAPPING_IN_PROGRESS;

    case PipelineStateEnum.MAPPING_IN_PROGRESS:
      // MAPFIN routes to either AWAITING_REVIEW or MAPPING_FINALIZED
      return stageResult.requires_review
        ? PipelineStateEnum.AWAITING_REVIEW
        : PipelineStateEnum.MAPPING_FINALIZED;

    case PipelineStateEnum.AWAITING_REVIEW:
      // After human corrections, move to finalized
      return PipelineStateEnum.MAPPING_FINALIZED;

    case PipelineStateEnum.MAPPING_FINALIZED:
      return PipelineStateEnum.TRANSFORMING;

    case PipelineStateEnum.TRANSFORMING:
      return PipelineStateEnum.VALIDATING;

    case PipelineStateEnum.VALIDATING:
      return PipelineStateEnum.DEDUPING;

    case PipelineStateEnum.DEDUPING:
      return PipelineStateEnum.EXPORTING;

    case PipelineStateEnum.EXPORTING:
      return PipelineStateEnum.COMPLETE;

    default:
      throw new Error(`Cannot determine next state from ${currentState}`);
  }
}

/**
 * Create initial pipeline state
 *
 * @param {string} import_run_id - Import identifier
 * @param {Object} fileInfo - File metadata
 * @returns {import('../contracts/types.js').PipelineState} Initial state
 */
export function createInitialState(import_run_id, fileInfo = {}) {
  const now = new Date();
  return {
    import_run_id,
    state: PipelineStateEnum.UPLOADED,
    current_stage: getStageLabel(PipelineStateEnum.UPLOADED),
    created_at: now,
    updated_at: now,
    error: null,
    context: {
      file_info: {
        filename: fileInfo.filename || 'unknown',
        size_bytes: fileInfo.size_bytes || 0,
        row_count: 0,
        encoding: null,
        delimiter: null,
      },
      processing_stats: {
        columns_detected: 0,
        columns_mapped: 0,
        rows_processed: 0,
        validation_failures: 0,
        duplicate_count: 0,
      },
      requires_review: false,
      low_confidence_columns: [],
      completed_stages: [],
      last_completed_stage: null,
      can_resume: false,
    },
  };
}

/**
 * Transition pipeline state
 * LLD §7: "Persists a state transition on every stage completion"
 *
 * @param {import('../contracts/types.js').PipelineState} currentState - Current state
 * @param {Object} stageResult - Stage execution result
 * @param {Object} [metadata] - Additional metadata to merge into context
 * @returns {import('../contracts/types.js').PipelineState} New state
 */
export function transitionState(currentState, stageResult, metadata = {}) {
  const nextStateEnum = determineNextState(currentState.state, stageResult);

  // Validate transition is legal
  if (!isValidTransition(currentState.state, nextStateEnum)) {
    throw new Error(
      `Invalid state transition: ${currentState.state} -> ${nextStateEnum}`
    );
  }

  const now = new Date();

  // Build updated context
  const updatedContext = {
    ...currentState.context,
    completed_stages: stageResult.success
      ? [...currentState.context.completed_stages, currentState.state]
      : currentState.context.completed_stages,
    last_completed_stage: stageResult.success
      ? currentState.state
      : currentState.context.last_completed_stage,
    can_resume: !isTerminalState(nextStateEnum),
  };

  // Merge stage-specific metadata
  if (metadata.file_info) {
    updatedContext.file_info = { ...updatedContext.file_info, ...metadata.file_info };
  }
  if (metadata.processing_stats) {
    updatedContext.processing_stats = {
      ...updatedContext.processing_stats,
      ...metadata.processing_stats,
    };
  }
  if (metadata.requires_review !== undefined) {
    updatedContext.requires_review = metadata.requires_review;
  }
  if (metadata.low_confidence_columns) {
    updatedContext.low_confidence_columns = metadata.low_confidence_columns;
  }

  // Create new state
  const newState = {
    ...currentState,
    state: nextStateEnum,
    current_stage: getStageLabel(nextStateEnum),
    updated_at: now,
    error: stageResult.error || null,
    context: updatedContext,
  };

  // Record state transition in audit log
  AUDIT.record({
    import_run_id: currentState.import_run_id,
    stage: currentState.state,
    subject: 'state_transition',
    decision: `Transitioned from ${currentState.state} to ${nextStateEnum}`,
    rationale: stageResult.success
      ? 'Stage completed successfully'
      : `Stage failed: ${stageResult.error?.message || 'Unknown error'}`,
    timestamp: now,
  });

  return newState;
}
