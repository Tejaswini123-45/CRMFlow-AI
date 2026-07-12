/**
 * Pipeline Stage Executor
 * LLD §2.1 (ORCH)
 *
 * Executes pipeline stages in an iterative (non-recursive) dispatch pattern.
 * Integrates with DataStore for stage data and components for processing.
 */

import { PipelineStateEnum, TERMINAL_STATES } from '../contracts/types.js';
import { AUDIT } from '../audit/index.js';

/**
 * Execute a single pipeline stage
 * LLD §2: "ORCH sequences calls to INGEST → HDRX → AIMAP → MAPFIN → XFORM → VALID → DEDUPE → EXPORT"
 *
 * @param {import('../contracts/types.js').PipelineState} state - Current pipeline state
 * @param {Object} dataStore - DataStore instance for stage data
 * @param {Object} components - Pipeline components
 * @returns {Promise<Object>} Stage execution result { success, data, error, metadata, requires_review }
 */
export async function executeStage(state, dataStore, components) {
  const stageName = getStageComponentName(state.state);

  if (!stageName) {
    return {
      success: false,
      error: {
        type: 'UnclassifiedError',
        message: `No component mapped for state: ${state.state}`,
      },
    };
  }

  const component = components[stageName];
  if (!component) {
    return {
      success: false,
      error: {
        type: 'UnclassifiedError',
        message: `Component ${stageName} not found`,
      },
    };
  }

  try {
    // Get input data from previous stage (if not first stage)
    let input = null;
    if (stageName !== 'INGEST') {
      const previousStage = getPreviousStageName(state.state);
      if (previousStage) {
        try {
          input = await dataStore.retrieve(state.import_run_id, previousStage);
        } catch (error) {
          return {
            success: false,
            error: {
              type: 'UnclassifiedError',
              message: `Failed to retrieve data from previous stage: ${error.message}`,
            },
          };
        }
      }
    }

    // Execute component
    // Each component receives: (input, config, stateContext)
    const result = await component.execute(input, state.context);

    // Record component execution in audit log
    AUDIT.record({
      import_run_id: state.import_run_id,
      stage: state.state,
      subject: 'stage_execution',
      decision: result.success ? 'Stage completed' : 'Stage failed',
      rationale: result.success
        ? `${stageName} executed successfully`
        : `${stageName} failed: ${result.error?.message || 'Unknown error'}`,
      timestamp: new Date(),
    });

    if (result.success) {
      // Store output in DataStore
      if (result.data !== undefined && result.data !== null) {
        await dataStore.store(state.import_run_id, stageName, result.data);
      }

      // Return success with metadata
      return {
        success: true,
        data: result.data,
        metadata: result.metadata || {},
        requires_review: result.requires_review || false,
      };
    } else {
      // Return failure
      return {
        success: false,
        error: result.error || {
          type: 'UnclassifiedError',
          message: 'Component failed without error details',
        },
      };
    }
  } catch (error) {
    // Unhandled exception during component execution
    AUDIT.record({
      import_run_id: state.import_run_id,
      stage: state.state,
      subject: 'stage_execution',
      decision: 'Stage failed with exception',
      rationale: `${stageName} threw exception: ${error.message}`,
      timestamp: new Date(),
    });

    return {
      success: false,
      error: {
        type: 'UnclassifiedError',
        message: `Unhandled exception in ${stageName}: ${error.message}`,
        details: { stack: error.stack },
      },
    };
  }
}

/**
 * Map pipeline state to component name
 *
 * @param {string} state - Pipeline state
 * @returns {string|null} Component name or null if no component for this state
 */
function getStageComponentName(state) {
  const stateToComponent = {
    [PipelineStateEnum.PARSING]: 'INGEST',
    [PipelineStateEnum.HEADERS_EXTRACTED]: 'HDRX',
    [PipelineStateEnum.MAPPING_IN_PROGRESS]: 'AIMAP',
    [PipelineStateEnum.MAPPING_FINALIZED]: 'XFORM', // MAPFIN already ran, start XFORM
    [PipelineStateEnum.TRANSFORMING]: 'XFORM',
    [PipelineStateEnum.VALIDATING]: 'VALID',
    [PipelineStateEnum.DEDUPING]: 'DEDUPE',
    [PipelineStateEnum.EXPORTING]: 'EXPORT',
  };

  return stateToComponent[state] || null;
}

/**
 * Get the previous stage's storage key
 * Used to retrieve data from DataStore
 *
 * @param {string} currentState - Current pipeline state
 * @returns {string|null} Previous stage name or null
 */
function getPreviousStageName(currentState) {
  const stateToPrevious = {
    [PipelineStateEnum.HEADERS_EXTRACTED]: 'INGEST',
    [PipelineStateEnum.MAPPING_IN_PROGRESS]: 'HDRX',
    [PipelineStateEnum.MAPPING_FINALIZED]: 'MAPFIN', // After review, use finalized mapping
    [PipelineStateEnum.TRANSFORMING]: 'MAPFIN',
    [PipelineStateEnum.VALIDATING]: 'XFORM',
    [PipelineStateEnum.DEDUPING]: 'VALID',
    [PipelineStateEnum.EXPORTING]: 'DEDUPE',
  };

  return stateToPrevious[currentState] || null;
}

/**
 * Check if a state requires component execution
 * Some states (like AWAITING_REVIEW) are pauses, not execution stages
 *
 * @param {string} state - Pipeline state
 * @returns {boolean} True if state requires execution
 */
export function requiresExecution(state) {
  // Terminal states don't execute
  if (TERMINAL_STATES.has(state)) {
    return false;
  }

  // Pause states don't execute
  if (state === PipelineStateEnum.AWAITING_REVIEW) {
    return false;
  }

  // UPLOADED state transitions directly to PARSING
  if (state === PipelineStateEnum.UPLOADED) {
    return false;
  }

  return true;
}

/**
 * Execute MAPFIN routing logic
 * Special case: MAPFIN has two operations - route and finalize
 * This is called after AIMAP completes
 *
 * @param {string} import_run_id - Import identifier
 * @param {Object} dataStore - DataStore instance
 * @param {Object} components - Pipeline components
 * @param {Array} [corrections] - Human corrections (if any)
 * @returns {Promise<Object>} Execution result
 */
export async function executeMappingFinalization(
  import_run_id,
  dataStore,
  components,
  corrections = []
) {
  const component = components.MAPFIN;
  if (!component) {
    return {
      success: false,
      error: {
        type: 'UnclassifiedError',
        message: 'MAPFIN component not found',
      },
    };
  }

  try {
    // Get AI mapping proposals
    const proposals = await dataStore.retrieve(import_run_id, 'AIMAP');

    // Execute finalization (with or without corrections)
    const result = await component.finalize(proposals, corrections);

    if (result.success) {
      // Store finalized mapping
      await dataStore.store(import_run_id, 'MAPFIN', result.data);

      // Record decision
      AUDIT.record({
        import_run_id,
        stage: 'MAPPING_FINALIZATION',
        subject: 'mapping_finalized',
        decision: corrections.length > 0 ? 'With human corrections' : 'Auto-approved',
        rationale: `Finalized ${result.data?.column_to_field ? Object.keys(result.data.column_to_field).length : 0} mappings`,
        timestamp: new Date(),
      });

      return {
        success: true,
        data: result.data,
        metadata: result.metadata || {},
      };
    } else {
      return result;
    }
  } catch (error) {
    return {
      success: false,
      error: {
        type: 'UnclassifiedError',
        message: `MAPFIN execution failed: ${error.message}`,
      },
    };
  }
}
