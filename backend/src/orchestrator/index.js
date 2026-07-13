/**
 * Pipeline Orchestrator (ORCH)
 * LLD §2.1 - Main orchestration component
 *
 * Owns the canonical PipelineState, sequences pipeline stages,
 * and provides the API interface for import operations.
 *
 * Architecture: Event loop execution (non-recursive)
 * - DataStore: Stage output storage
 * - StateMachine: State transitions
 * - Persistence: PipelineState storage
 * - Executor: Stage execution dispatch
 */

import { v4 as uuidv4 } from 'uuid';
import { PipelineStateEnum } from '../contracts/types.js';
import { InMemoryDataStore } from './data-store.js';
import {
  createInitialState,
  transitionState,
  isTerminalState,
} from './state-machine.js';
import { saveState, loadState, stateExists } from './persistence.js';
import { executeStage, requiresExecution, executeMappingFinalization } from './executor.js';
import { AUDIT } from '../audit/index.js';
import { CONFIG } from '../config/index.js';

/**
 * Orchestrator class
 * LLD §4: "All endpoints are owned by /api, which delegates immediately to ORCH"
 */
export class Orchestrator {
  /**
   * Create orchestrator instance
   *
   * @param {Object} components - Pipeline components { INGEST, HDRX, AIMAP, MAPFIN, XFORM, VALID, DEDUPE, EXPORT }
   * @param {Object} [dataStore] - DataStore instance (defaults to InMemoryDataStore)
   */
  constructor(components, dataStore = null) {
    this.components = components;
    this.dataStore = dataStore || new InMemoryDataStore();

    // Validate all required components are present
    const requiredComponents = [
      'INGEST',
      'HDRX',
      'AIMAP',
      'MAPFIN',
      'XFORM',
      'VALID',
      'DEDUPE',
      'EXPORT',
    ];
    for (const comp of requiredComponents) {
      if (!components[comp]) {
        throw new Error(`Required component ${comp} not provided`);
      }
    }
  }

  /**
   * Create a new import run
   * LLD §4: "Create Import" endpoint
   *
   * @param {Buffer|File} file - CSV file
   * @param {Object} [options] - Import options
   * @param {string} [options.filename] - Original filename
   * @param {string} [options.target_schema_id] - Target schema ID
   * @returns {Promise<{import_run_id: string, state: string, created_at: Date}>} Import summary
   */
  async createImport(file, options = {}) {
    // Generate unique import ID
    const import_run_id = uuidv4();

    // Extract file metadata
    const fileInfo = {
      filename: options.filename || 'unknown.csv',
      size_bytes: file.length || file.size || 0,
    };

    // Create initial state
    const initialState = createInitialState(import_run_id, fileInfo);

    // Persist initial state
    await saveState(initialState);

    // Record import creation
    AUDIT.record({
      import_run_id,
      stage: PipelineStateEnum.UPLOADED,
      subject: 'import_created',
      decision: 'Import run started',
      rationale: `File: ${fileInfo.filename}, Size: ${fileInfo.size_bytes} bytes`,
      timestamp: new Date(),
    });

    // Store raw file in DataStore
    await this.dataStore.store(import_run_id, 'RAW_FILE', file);

    // Start pipeline execution
    await this.startPipeline(import_run_id);

    return {
      import_run_id,
      state: initialState.state,
      created_at: initialState.created_at,
    };
  }

  /**
   * Start or resume pipeline execution
   * LLD §2.1: "Sequences calls to INGEST → HDRX → AIMAP → MAPFIN → XFORM → VALID → DEDUPE → EXPORT"
   *
   * Uses iterative dispatch pattern (non-recursive event loop)
   *
   * @param {string} import_run_id - Import identifier
   * @returns {Promise<void>}
   */
  async startPipeline(import_run_id) {
    let currentState = await loadState(import_run_id);

    if (!currentState) {
      throw new Error(`Import ${import_run_id} not found`);
    }

    // Event loop: Execute stages iteratively until terminal state or pause
    while (!isTerminalState(currentState.state)) {
      // Check if current state requires execution
      if (!requiresExecution(currentState.state)) {
        // States like UPLOADED transition automatically
        if (currentState.state === PipelineStateEnum.UPLOADED) {
          currentState = transitionState(currentState, { success: true });
          await saveState(currentState);
          continue;
        }

        // AWAITING_REVIEW is a pause - wait for human input
        if (currentState.state === PipelineStateEnum.AWAITING_REVIEW) {
          break;
        }

        // Other non-execution states
        break;
      }

      // Execute current stage
      const stageResult = await executeStage(currentState, this.dataStore, this.components);

      // Handle AIMAP -> MAPFIN routing
      if (currentState.state === PipelineStateEnum.MAPPING_IN_PROGRESS && stageResult.success) {
        // Route proposals through MAPFIN
        const routingResult = await this.components.MAPFIN.route(
          stageResult.data,
          CONFIG.getConfidenceThreshold()
        );

        // Update stage result with routing outcome
        stageResult.requires_review = routingResult.requires_review;
        stageResult.metadata = {
          ...stageResult.metadata,
          columns_mapped: routingResult.auto_staged?.length || 0,
          low_confidence_columns: routingResult.requires_review_columns || [],
        };

        // If review not required, finalize immediately
        if (!routingResult.requires_review) {
          const finalizeResult = await executeMappingFinalization(
            import_run_id,
            this.dataStore,
            this.components,
            []
          );

          if (!finalizeResult.success) {
            stageResult.success = false;
            stageResult.error = finalizeResult.error;
          }
        }
      }

      // Transition to next state
      currentState = transitionState(currentState, stageResult, stageResult.metadata);

      // Persist new state
      await saveState(currentState);

      // If stage failed, stop execution
      if (!stageResult.success) {
        break;
      }

      // If we're awaiting review, pause
      if (currentState.state === PipelineStateEnum.AWAITING_REVIEW) {
        break;
      }
    }

    // Cleanup DataStore for terminal states (optional)
    if (isTerminalState(currentState.state)) {
      // Note: We keep data for now to allow result retrieval
      // In production, cleanup might happen after a retention period
    }
  }

  /**
   * Get current import status
   * LLD §4: "Get Import Status" endpoint
   *
   * @param {string} import_run_id - Import identifier
   * @returns {Promise<Object>} Status DTO
   */
  async getStatus(import_run_id) {
    const state = await loadState(import_run_id);

    if (!state) {
      throw new Error(`Import ${import_run_id} not found`);
    }

    return {
      import_run_id: state.import_run_id,
      state: state.state,
      current_stage: state.current_stage,
      requires_action: state.state === PipelineStateEnum.AWAITING_REVIEW,
      progress_summary: this.getProgressSummary(state),
      created_at: state.created_at,
      updated_at: state.updated_at,
      error: state.error,
    };
  }

  /**
   * Get mapping proposals for review
   * LLD §4: "Get Mapping Proposals" endpoint
   *
   * @param {string} import_run_id - Import identifier
   * @returns {Promise<Object>} Mapping review DTO
   */
  async getMappingProposals(import_run_id) {
    const state = await loadState(import_run_id);

    if (!state) {
      throw new Error(`Import ${import_run_id} not found`);
    }

    if (state.state !== PipelineStateEnum.AWAITING_REVIEW) {
      throw new Error(`Import is not in review state: ${state.state}`);
    }

    // Get proposals from DataStore
    const proposals = await this.dataStore.retrieve(import_run_id, 'AIMAP');

    // Get column profiles for sample values
    const profiles = await this.dataStore.retrieve(import_run_id, 'HDRX');

    // Build proposal views
    const proposalViews = proposals.map((proposal) => {
      const profile = profiles.find((p) => p.header === proposal.column_header);
      return {
        column_header: proposal.column_header,
        sample_values: profile?.sample_values || [],
        proposed_field: proposal.target_field,
        confidence: proposal.confidence,
        rationale: proposal.rationale,
        requires_review: proposal.confidence < CONFIG.getConfidenceThreshold(),
      };
    });

    return {
      import_run_id,
      proposals: proposalViews,
    };
  }

  /**
   * Submit mapping corrections and resume pipeline
   * LLD §4: "Submit Mapping Corrections" endpoint
   *
   * @param {string} import_run_id - Import identifier
   * @param {Array<{column_header: string, corrected_field: string}>} corrections - User corrections
   * @returns {Promise<Object>} Updated status
   */
  async submitMappingCorrections(import_run_id, corrections) {
    const state = await loadState(import_run_id);

    if (!state) {
      throw new Error(`Import ${import_run_id} not found`);
    }

    if (state.state !== PipelineStateEnum.AWAITING_REVIEW) {
      throw new Error(`Import is not in review state: ${state.state}`);
    }

    // Execute mapping finalization with corrections
    const finalizeResult = await executeMappingFinalization(
      import_run_id,
      this.dataStore,
      this.components,
      corrections
    );

    if (!finalizeResult.success) {
      throw new Error(`Mapping finalization failed: ${finalizeResult.error?.message}`);
    }

    // Transition to MAPPING_FINALIZED
    const newState = transitionState(state, { success: true }, {
      requires_review: false,
      low_confidence_columns: [],
    });

    await saveState(newState);

    // Resume pipeline execution
    await this.startPipeline(import_run_id);

    // Return updated status
    return this.getStatus(import_run_id);
  }

  /**
   * Get final import result
   * LLD §4: "Get Import Result" endpoint
   *
   * @param {string} import_run_id - Import identifier
   * @returns {Promise<Object>} Import result DTO
   */
  async getImportResult(import_run_id) {
    const state = await loadState(import_run_id);

    if (!state) {
      throw new Error(`Import ${import_run_id} not found`);
    }

    if (state.state !== PipelineStateEnum.COMPLETE) {
      throw new Error(`Import is not complete: ${state.state}`);
    }

    // Get export data
    const exportData = await this.dataStore.retrieve(import_run_id, 'EXPORT');

    return {
      import_run_id,
      accepted_count: exportData.summary.accepted_count,
      skipped_count: exportData.summary.skipped_count,
      flagged_count: exportData.summary.flagged_count,
      duplicate_count: exportData.summary.duplicate_count,
      output_download_ref: exportData.output_ref,
      summary_reasons: exportData.summary.summary_reasons,
    };
  }

  /**
   * Get the standardized output for download
   * LLD §4: "Download Standardized Output" endpoint
   *
   * Returns the assembled StandardizedOutput from the DataStore, along with a
   * suggested filename derived from the output_ref.  Controllers must not access
   * the DataStore directly — all data retrieval goes through this method.
   *
   * @param {string} import_run_id - Import identifier
   * @returns {Promise<{ filename: string, output: import('../contracts/types.js').StandardizedOutput }>}
   */
  async getDownloadOutput(import_run_id) {
    const state = await loadState(import_run_id);

    if (!state) {
      throw new Error(`Import ${import_run_id} not found`);
    }

    if (state.state !== PipelineStateEnum.COMPLETE) {
      throw new Error(`Import is not complete: ${state.state}`);
    }

    const exportData = await this.dataStore.retrieve(import_run_id, 'EXPORT');

    return {
      filename: exportData.output_ref,
      output: exportData.output,
    };
  }

  /**
   * Get audit log for an import
   * LLD §4: "Get Audit Log" endpoint
   *
   * @param {string} import_run_id - Import identifier
   * @returns {Promise<Object>} Audit log DTO
   */
  async getAuditLog(import_run_id) {
    const exists = await stateExists(import_run_id);
    if (!exists) {
      throw new Error(`Import ${import_run_id} not found`);
    }

    const records = AUDIT.query(import_run_id);

    return {
      import_run_id,
      records,
    };
  }

  /**
   * Get progress summary text
   *
   * @param {import('../contracts/types.js').PipelineState} state - Pipeline state
   * @returns {string} Human-readable progress summary
   */
  getProgressSummary(state) {
    const stats = state.context.processing_stats;

    switch (state.state) {
      case PipelineStateEnum.PARSING:
        return 'Parsing CSV file...';

      case PipelineStateEnum.HEADERS_EXTRACTED:
        return `Detected ${stats.columns_detected} columns`;

      case PipelineStateEnum.MAPPING_IN_PROGRESS:
        return 'AI is analyzing your columns...';

      case PipelineStateEnum.AWAITING_REVIEW:
        return `${state.context.low_confidence_columns.length} columns need your review`;

      case PipelineStateEnum.MAPPING_FINALIZED:
        return `Mapped ${stats.columns_mapped} columns`;

      case PipelineStateEnum.TRANSFORMING:
        return 'Normalizing data...';

      case PipelineStateEnum.VALIDATING:
        return `Validating ${stats.rows_processed} rows...`;

      case PipelineStateEnum.DEDUPING:
        return 'Checking for duplicates...';

      case PipelineStateEnum.EXPORTING:
        return 'Generating output file...';

      case PipelineStateEnum.COMPLETE:
        return `Processed ${stats.rows_processed} rows`;

      case PipelineStateEnum.PARSE_FAILED:
      case PipelineStateEnum.MAPPING_FAILED:
      case PipelineStateEnum.FAILED:
        return state.error?.message || 'An error occurred';

      default:
        return state.current_stage;
    }
  }

  /**
   * Check if import exists
   *
   * @param {string} import_run_id - Import identifier
   * @returns {Promise<boolean>} True if exists
   */
  async importExists(import_run_id) {
    return stateExists(import_run_id);
  }
}

export default Orchestrator;
