/**
 * Export/Output Formatting Component (EXPORT)
 * LLD §2.9 — Export/Output Formatting
 *
 * Consumes the final row set assembled by ORCH from three DataStore keys:
 *   { normalizedRows: NormalizedRow[], rowVerdicts: RowVerdict[], duplicateVerdicts: DuplicateVerdict[] }
 *
 * Assembles:
 *   - StandardizedOutput  — rows that passed validation and are not duplicates
 *   - ImportSummary       — accepted / skipped / flagged / duplicate counts + reasons
 *
 * Constraints (LLD §2.9):
 *   - Pure aggregation only. No transformation, no validation, no AI calls.
 *   - DUPLICATE precedence: a row that is both duplicate and invalid counts as DUPLICATE only.
 *   - Arithmetic invariant: accepted + skipped + flagged + duplicate === total_rows (always).
 *   - Inconsistent input collections (mismatched row_index sets) are a hard failure,
 *     not a silent fallback — preserves pipeline invariant and correct ImportSummary counts.
 *   - Exactly one AUDIT record written per execute() call.
 */

import { AUDIT } from '../../audit/index.js';
import { CONFIG } from '../../config/index.js';
import { ErrorTypes } from '../../contracts/types.js';

// Row outcome labels — not exported; internal to this component.
const OUTCOME = {
  ACCEPTED: 'ACCEPTED',
  FLAGGED: 'FLAGGED',
  SKIPPED: 'SKIPPED',
  DUPLICATE: 'DUPLICATE',
};

/**
 * Assemble final output and summary from all upstream stage results.
 *
 * Input is assembled by ORCH:
 *   {
 *     normalizedRows:    NormalizedRow[],
 *     rowVerdicts:       RowVerdict[],
 *     duplicateVerdicts: DuplicateVerdict[],
 *   }
 *
 * @param {{ normalizedRows: Array, rowVerdicts: Array, duplicateVerdicts: Array }} input
 * @param {{ import_run_id: string }} context
 * @returns {Promise<{ success: boolean, data?: Object, error?: Object, metadata?: Object }>}
 */
export async function execute(input, context) {
  const import_run_id = context?.import_run_id ?? 'unknown';

  // ── Input validation ────────────────────────────────────────────────────
  if (!input || typeof input !== 'object') {
    return {
      success: false,
      error: {
        type: ErrorTypes.UNCLASSIFIED_ERROR,
        message: 'EXPORT received invalid input: expected { normalizedRows, rowVerdicts, duplicateVerdicts }',
      },
    };
  }

  const { normalizedRows, rowVerdicts, duplicateVerdicts } = input;

  if (!Array.isArray(normalizedRows)) {
    return {
      success: false,
      error: {
        type: ErrorTypes.UNCLASSIFIED_ERROR,
        message: 'EXPORT received invalid normalizedRows: expected an array',
      },
    };
  }

  if (!Array.isArray(rowVerdicts)) {
    return {
      success: false,
      error: {
        type: ErrorTypes.UNCLASSIFIED_ERROR,
        message: 'EXPORT received invalid rowVerdicts: expected an array',
      },
    };
  }

  if (!Array.isArray(duplicateVerdicts)) {
    return {
      success: false,
      error: {
        type: ErrorTypes.UNCLASSIFIED_ERROR,
        message: 'EXPORT received invalid duplicateVerdicts: expected an array',
      },
    };
  }

  // ── Collection consistency check ────────────────────────────────────────
  // All three arrays must cover the same set of row_index values.
  // A mismatch is a pipeline invariant violation — hard failure, not silent fallback.
  const normalizedIndexSet = new Set(normalizedRows.map((r) => r.row_index));
  const verdictIndexSet = new Set(rowVerdicts.map((r) => r.row_index));
  const dupeIndexSet = new Set(duplicateVerdicts.map((r) => r.row_index));

  if (
    normalizedIndexSet.size !== verdictIndexSet.size ||
    normalizedIndexSet.size !== dupeIndexSet.size
  ) {
    return {
      success: false,
      error: {
        type: ErrorTypes.UNCLASSIFIED_ERROR,
        message: `EXPORT received inconsistent input collections: normalizedRows(${normalizedIndexSet.size}), rowVerdicts(${verdictIndexSet.size}), duplicateVerdicts(${dupeIndexSet.size}) must all have the same row count`,
      },
    };
  }

  // Verify each row_index in normalizedRows is present in both other collections.
  for (const idx of normalizedIndexSet) {
    if (!verdictIndexSet.has(idx)) {
      return {
        success: false,
        error: {
          type: ErrorTypes.UNCLASSIFIED_ERROR,
          message: `EXPORT: row_index ${idx} present in normalizedRows but missing from rowVerdicts`,
        },
      };
    }
    if (!dupeIndexSet.has(idx)) {
      return {
        success: false,
        error: {
          type: ErrorTypes.UNCLASSIFIED_ERROR,
          message: `EXPORT: row_index ${idx} present in normalizedRows but missing from duplicateVerdicts`,
        },
      };
    }
  }

  // ── Build O(1) lookup maps ──────────────────────────────────────────────
  /** @type {Map<number, import('../../contracts/types.js').RowVerdict>} */
  const verdictByIndex = new Map(rowVerdicts.map((v) => [v.row_index, v]));

  /** @type {Map<number, import('../../contracts/types.js').DuplicateVerdict>} */
  const dupeByIndex = new Map(duplicateVerdicts.map((v) => [v.row_index, v]));

  // ── Field ordering from schema (deterministic output) ───────────────────
  const schema = CONFIG.getTargetSchema();
  const schemaFieldIds = schema.fields.map((f) => f.id);

  // ── Classification pass ─────────────────────────────────────────────────
  let acceptedCount = 0;
  let skippedCount = 0;
  let flaggedCount = 0;
  let duplicateCount = 0;

  const outputRows = [];

  for (const normalizedRow of normalizedRows) {
    const { row_index, fields = {} } = normalizedRow;
    const verdict = verdictByIndex.get(row_index);
    const dupeVerdict = dupeByIndex.get(row_index);

    // DUPLICATE is checked first regardless of validation verdict
    if (dupeVerdict.is_duplicate) {
      duplicateCount++;
      continue; // excluded from output
    }

    const overallVerdict = verdict.overall_verdict;

    if (overallVerdict === 'INVALID') {
      skippedCount++;
      continue; // excluded from output
    }

    // ACCEPTED (VALID) and FLAGGED (PARTIAL) are included in the output
    const outcome = overallVerdict === 'VALID' ? OUTCOME.ACCEPTED : OUTCOME.FLAGGED;
    if (outcome === OUTCOME.ACCEPTED) {
      acceptedCount++;
    } else {
      flaggedCount++;
    }

    // Shape the output row: only schema fields, in schema order
    const orderedFields = {};
    for (const fieldId of schemaFieldIds) {
      if (Object.prototype.hasOwnProperty.call(fields, fieldId)) {
        orderedFields[fieldId] = fields[fieldId];
      }
    }

    outputRows.push({
      row_index,
      fields: orderedFields,
      outcome,
    });
  }

  // ── Arithmetic invariant (defensive assertion) ──────────────────────────
  const totalRows = normalizedRows.length;
  const totalClassified = acceptedCount + skippedCount + flaggedCount + duplicateCount;
  if (totalClassified !== totalRows) {
    // Should be unreachable — means classification logic has a bug
    return {
      success: false,
      error: {
        type: ErrorTypes.UNCLASSIFIED_ERROR,
        message: `EXPORT: arithmetic invariant violated — classified ${totalClassified} rows but expected ${totalRows}`,
      },
    };
  }

  // ── Build summary_reasons (omit zero-count groups) ──────────────────────
  const summaryReasons = [];
  if (acceptedCount > 0) {
    summaryReasons.push({ reason: 'Valid and unique', count: acceptedCount });
  }
  if (flaggedCount > 0) {
    summaryReasons.push({
      reason: 'Partial — one or more optional fields invalid',
      count: flaggedCount,
    });
  }
  if (skippedCount > 0) {
    summaryReasons.push({
      reason: 'Invalid — required field(s) missing or malformed',
      count: skippedCount,
    });
  }
  if (duplicateCount > 0) {
    summaryReasons.push({ reason: 'Duplicate record', count: duplicateCount });
  }

  // ── Assemble output artifacts ────────────────────────────────────────────
  const output_ref = `output_${import_run_id}.json`;

  /** @type {import('../../contracts/types.js').StandardizedOutput} */
  const standardizedOutput = {
    rows: outputRows,
    format: 'JSON',
    generated_at: new Date(),
  };

  /** @type {import('../../contracts/types.js').ImportSummary} */
  const importSummary = {
    import_run_id,
    accepted_count: acceptedCount,
    skipped_count: skippedCount,
    flagged_count: flaggedCount,
    duplicate_count: duplicateCount,
    summary_reasons: summaryReasons,
  };

  // ── AUDIT ────────────────────────────────────────────────────────────────
  AUDIT.record({
    import_run_id,
    stage: 'EXPORTING',
    subject: 'export_complete',
    decision: `${acceptedCount} accepted, ${skippedCount} skipped, ${flaggedCount} flagged, ${duplicateCount} duplicates`,
    confidence: null,
    rationale: `total_rows=${totalRows}, output_ref=${output_ref}`,
    timestamp: new Date(),
  });

  return {
    success: true,
    data: {
      output: standardizedOutput,
      summary: importSummary,
      output_ref,
    },
    metadata: {
      processing_stats: {
        total_rows: totalRows,
        accepted_count: acceptedCount,
        skipped_count: skippedCount,
        flagged_count: flaggedCount,
        duplicate_count: duplicateCount,
      },
    },
  };
}

export default { execute };
