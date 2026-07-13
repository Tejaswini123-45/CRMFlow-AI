/**
 * AI Mapping Component (AIMAP)
 * LLD §2.4 — AI Mapping
 * AES full specification
 *
 * Responsibilities:
 * - Receive ColumnProfile[] from HDRX
 * - Build prompt (AES §2 five-segment architecture)
 * - Call LLM provider via LLMProviderClient abstraction
 * - Validate response through AES §9 gate (all-or-nothing)
 * - Apply AES §10 retry strategy
 * - Return MappingProposal[] (clean contract) + execution metadata
 * - Record per-column decisions in AUDIT (LLD §11)
 *
 * Produces: MappingProposal[] stored in DataStore under key 'AIMAP'
 * Execution metadata (prompt_version etc) lives only in AUDIT and result.metadata
 */

import { ErrorTypes } from '../../contracts/types.js';
import { AUDIT } from '../../audit/index.js';
import { CONFIG } from '../../config/index.js';
import { LLMProviderClient } from '../../llm_provider_client/index.js';
import { PROMPT_VERSION } from './prompt/version.js';
import {
  buildSegmentA,
  buildSegmentB,
  buildSegmentC,
  buildSegmentD,
  buildSegmentE,
} from './prompt/segments.js';
import { validateMappingResponse } from './output-validator.js';
import { executeWithRetry } from './retry-handler.js';

/**
 * Execute AI mapping for a parsed file's column profiles
 * LLD §6: propose_mapping(ColumnProfile[], schema_enum) → MappingProposal[] | AIMappingError
 *
 * @param {Array<{header: string, sample_values: string[], column_index: number}>} columnProfiles
 * @param {Object} context - State context (contains import_run_id)
 * @returns {Promise<{success: boolean, data?: Array, error?: Object, metadata?: Object}>}
 */
export async function execute(columnProfiles, context) {
  const import_run_id = context?.import_run_id || 'unknown';

  try {
    // Validate input
    if (!columnProfiles || !Array.isArray(columnProfiles) || columnProfiles.length === 0) {
      return {
        success: false,
        error: {
          type: ErrorTypes.AI_MAPPING_MALFORMED_OUTPUT,
          message: 'Invalid or empty column profiles',
        },
      };
    }

    // Read configuration
    const schema = CONFIG.getTargetSchema();
    const schemaFields = schema.fields;
    const schemaFieldIds = schemaFields.map(f => f.id);
    const timeoutMs = CONFIG.getAIMappingTimeout();
    const maxRetries = CONFIG.getMaxRetries();
    const maxColumnsPerBatch = CONFIG.get('aimap_max_columns_per_batch');

    // Handle batch-size cap (AES §11)
    // For MVP-scale CSV files (5–20 columns), this is always a single batch
    const batches = splitIntoBatches(columnProfiles, maxColumnsPerBatch);
    const allProposals = [];
    let totalRetries = 0;

    for (const batchProfiles of batches) {
      const batchResult = await processBatch(
        batchProfiles,
        schemaFields,
        schemaFieldIds,
        timeoutMs,
        maxRetries,
        import_run_id
      );

      if (!batchResult.success) {
        return {
          success: false,
          error: batchResult.error,
          metadata: { prompt_version: PROMPT_VERSION },
        };
      }

      allProposals.push(...batchResult.proposals);
      totalRetries += batchResult.retryCount;
    }

    // Record per-column decisions in AUDIT (LLD §11: one per column)
    for (const proposal of allProposals) {
      AUDIT.record({
        import_run_id,
        stage: 'MAPPING_IN_PROGRESS',
        subject: proposal.column_header,
        decision: proposal.target_field,
        confidence: proposal.confidence,
        rationale: proposal.rationale,
        timestamp: new Date(),
      });
    }

    // Summary AUDIT record (includes prompt_version — AES §14)
    const mappedCount = allProposals.filter(p => p.target_field !== 'UNMAPPED').length;
    AUDIT.record({
      import_run_id,
      stage: 'MAPPING_IN_PROGRESS',
      subject: 'mapping_complete',
      decision: `${mappedCount}/${allProposals.length} columns mapped`,
      rationale: `prompt_version=${PROMPT_VERSION}, retries=${totalRetries}`,
      timestamp: new Date(),
    });

    // Return MappingProposal[] as data (clean contract, no execution metadata)
    // Execution metadata (prompt_version) lives in metadata only
    return {
      success: true,
      data: allProposals, // MappingProposal[] — stored in DataStore
      metadata: {
        prompt_version: PROMPT_VERSION,
        retry_count: totalRetries,
        processing_stats: {
          columns_mapped: mappedCount,
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      error: {
        type: ErrorTypes.UNCLASSIFIED_ERROR,
        message: `AIMAP unexpected failure: ${error.message}`,
      },
    };
  }
}

/**
 * Process a single batch of columns through the LLM + validation gate
 * @private
 */
async function processBatch(
  batchProfiles,
  schemaFields,
  schemaFieldIds,
  timeoutMs,
  maxRetries,
  import_run_id
) {
  // Build prompt segments
  const segmentA = buildSegmentA();
  const segmentC = buildSegmentC();
  const segmentE = buildSegmentE(schemaFieldIds);
  const systemPrompt = [segmentA, segmentC, segmentE].join('\n\n---\n\n');

  const segmentB = buildSegmentB(schemaFields);
  const segmentD = buildSegmentD(batchProfiles);
  const userPrompt = [segmentB, segmentD].join('\n\n---\n\n');

  const expectedHeaders = batchProfiles.map(p => p.header);
  const client = new LLMProviderClient();

  // AES §10: retry wrapper around the full validate→call cycle
  const retryResult = await executeWithRetry(
    async () => {
      // Call provider
      const llmResult = await client.complete({ systemPrompt, userPrompt, timeoutMs });

      if (!llmResult.success) {
        return llmResult; // Pass error to retry handler
      }

      // AES §9: mandatory output validation gate
      const validation = validateMappingResponse(
        llmResult.content,
        expectedHeaders,
        schemaFieldIds
      );

      if (!validation.valid) {
        return {
          success: false,
          error: {
            type: 'AIMappingMalformedOutput',
            message: `Output validation failed: ${validation.reason} — ${validation.detail}`,
          },
        };
      }

      // Gate passed — map to MappingProposal[]
      const proposals = validation.proposals.map(entry => ({
        column_header: entry.column_header,
        target_field: entry.target_field,
        confidence: entry.confidence,
        rationale: entry.rationale,
      }));

      return { success: true, data: proposals };
    },
    { maxRetries, baseDelayMs: 1000 }
  );

  if (retryResult.success) {
    return {
      success: true,
      proposals: retryResult.data,
      retryCount: retryResult.retryCount,
    };
  }

  return {
    success: false,
    error: retryResult.error,
    retryCount: retryResult.retryCount,
  };
}

/**
 * Split profiles into batches of maxSize
 * For typical CSV files (5–20 columns) this always returns a single batch
 * @private
 */
function splitIntoBatches(profiles, maxSize) {
  if (!maxSize || maxSize <= 0 || profiles.length <= maxSize) {
    return [profiles];
  }
  const batches = [];
  for (let i = 0; i < profiles.length; i += maxSize) {
    batches.push(profiles.slice(i, i + maxSize));
  }
  return batches;
}

export default { execute };
