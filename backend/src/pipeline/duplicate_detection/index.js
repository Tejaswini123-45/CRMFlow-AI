/**
 * Duplicate Detection Component (DEDUPE)
 * LLD §2.8 — Duplicate Detection
 *
 * Receives { rowVerdicts, normalizedRows, existingRecordIndex, matcher } assembled by ORCH.
 * Applies exact-match comparison on configured key fields (PRD §10: email OR phone).
 * Produces DuplicateVerdict[] — one per input row, in row_index order.
 *
 * Matching rule (PRD §10): "Deduped in MVP by email/phone match"
 *   A row is a duplicate if ANY key field matches — OR semantics.
 *   First occurrence of a key is the anchor; later matches are the duplicates.
 *
 * INVALID rows (from VALID) are not checked for duplication; they receive
 * is_duplicate: false, match_type: 'NONE', matched_fields: null, matched_against: null.
 *
 * existingRecordIndex — abstract interface: { lookup(field, value) → string|null }
 *   ORCH supplies a no-op implementation for MVP. Future phases can supply a
 *   database-backed implementation without changing DEDUPE.
 *
 * matcher — pluggable matcher interface per LLD §13.
 *   Default is exactMatchMatcher. Tests may substitute a fake to prove swappability.
 */

import { AUDIT } from '../../audit/index.js';
import { CONFIG } from '../../config/index.js';
import { ErrorTypes } from '../../contracts/types.js';
import { exactMatchMatcher } from './matchers/exact-match.js';

/**
 * No-op existing-record index.
 * Used by ORCH for MVP: no existing records are checked.
 * Satisfies the { lookup(field, value) → string|null } interface.
 */
export const noopExistingRecordIndex = {
  lookup: (_field, _value) => null,
};

/**
 * Detect duplicate rows.
 *
 * Input assembled by ORCH:
 *   {
 *     rowVerdicts: RowVerdict[],
 *     normalizedRows: NormalizedRow[],
 *     existingRecordIndex: { lookup(field, value): string|null },
 *     matcher: { match(fields, keyFields, seenIndex, existingRecordIndex): Object },
 *   }
 *
 * @param {Object} input
 * @param {{ import_run_id: string }} context
 * @returns {Promise<{ success: boolean, data?: DuplicateVerdict[], error?: Object, metadata?: Object }>}
 */
export async function execute(input, context) {
  const import_run_id = context?.import_run_id ?? 'unknown';

  if (!input || typeof input !== 'object') {
    return {
      success: false,
      error: {
        type: ErrorTypes.UNCLASSIFIED_ERROR,
        message: 'DEDUPE received invalid input: expected { rowVerdicts, normalizedRows, ... }',
      },
    };
  }

  const {
    rowVerdicts,
    normalizedRows,
    existingRecordIndex = noopExistingRecordIndex,
    matcher = exactMatchMatcher,
  } = input;

  if (!rowVerdicts || !Array.isArray(rowVerdicts)) {
    return {
      success: false,
      error: {
        type: ErrorTypes.UNCLASSIFIED_ERROR,
        message: 'DEDUPE received invalid rowVerdicts: expected an array',
      },
    };
  }

  if (!normalizedRows || !Array.isArray(normalizedRows)) {
    return {
      success: false,
      error: {
        type: ErrorTypes.UNCLASSIFIED_ERROR,
        message: 'DEDUPE received invalid normalizedRows: expected an array',
      },
    };
  }

  // Read key fields from CONFIG once (not per-row)
  const keyFields = CONFIG.get('dedupe_key_fields');

  // Build a lookup: row_index → NormalizedRow.fields (O(n) once, reused per row)
  const fieldsByRowIndex = new Map();
  for (const nr of normalizedRows) {
    fieldsByRowIndex.set(nr.row_index, nr.fields ?? {});
  }

  // seenIndex accumulates "field:value" → "row_{N}" as rows are processed in order.
  // Only anchor rows (non-duplicate) add to seenIndex, so the first occurrence wins.
  const seenIndex = new Map();

  let duplicateCount = 0;
  let skippedCount = 0;
  let checkedCount = 0;

  const duplicateVerdicts = rowVerdicts.map((verdict) => {
    const { row_index, overall_verdict } = verdict;

    // INVALID rows are not checked for duplication
    if (overall_verdict === 'INVALID') {
      skippedCount++;
      return {
        row_index,
        is_duplicate: false,
        match_type: 'NONE',
        matched_fields: null,
        matched_against: null,
      };
    }

    checkedCount++;
    const fields = fieldsByRowIndex.get(row_index) ?? {};

    const { isDuplicate, matchedFields, matchedAgainst } = matcher.match(
      fields,
      keyFields,
      seenIndex,
      existingRecordIndex
    );

    if (isDuplicate) {
      duplicateCount++;
      return {
        row_index,
        is_duplicate: true,
        match_type: 'EXACT',
        matched_fields: matchedFields,
        matched_against: matchedAgainst,
      };
    }

    // Not a duplicate — add this row's non-null key values to seenIndex so later
    // rows can match against it. Only the first occurrence anchors a key.
    for (const field of keyFields) {
      const value = fields[field];
      if (value !== null && value !== undefined) {
        const key = `${field}:${value}`;
        if (!seenIndex.has(key)) {
          seenIndex.set(key, `row_${row_index}`);
        }
      }
    }

    return {
      row_index,
      is_duplicate: false,
      match_type: 'NONE',
      matched_fields: null,
      matched_against: null,
    };
  });

  // AUDIT: one summary record per execute() call
  AUDIT.record({
    import_run_id,
    stage: 'DEDUPING',
    subject: 'deduplication_complete',
    decision: `${checkedCount} rows checked, ${duplicateCount} duplicates found`,
    confidence: null,
    rationale: `key_fields=[${keyFields.join(',')}], skipped_invalid=${skippedCount}`,
    timestamp: new Date(),
  });

  return {
    success: true,
    data: duplicateVerdicts,
    metadata: {
      processing_stats: {
        rows_checked: checkedCount,
        duplicate_count: duplicateCount,
        skipped_invalid: skippedCount,
      },
    },
  };
}

export default { execute };
