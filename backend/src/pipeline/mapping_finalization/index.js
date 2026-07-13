/**
 * Mapping Finalization Component (MAPFIN)
 * LLD §2.5 — Mapping Finalization
 *
 * Responsibilities (LLD §2.5):
 *   route()    — partitions MappingProposal[] into auto_staged / requires_review
 *                using a pure confidence-threshold comparison (no content inspection).
 *   finalize() — merges AI proposals with optional HumanCorrection[] into FinalizedMapping.
 *                Human corrections take precedence over AI proposals for their columns.
 *
 * Design constraints:
 *   - MAPFIN never calls CONFIG, LLM, or any other component.
 *   - Routing is strictly confidence >= threshold. No special-casing by target_field value.
 *   - FinalizedMapping shape is the existing contract (contracts/types.js). No new fields added.
 *   - Duplicate target-field assignments are detected and written to AUDIT, not treated as errors.
 *   - VALID is solely responsible for required-field validation.
 */

import { AUDIT } from '../../audit/index.js';
import { ErrorTypes } from '../../contracts/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// route()
// LLD §6: route(MappingProposal[], threshold) → { auto_staged, requires_review }
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Partition mapping proposals by confidence threshold.
 * Routing is a pure numeric comparison: confidence >= threshold → auto_staged.
 * No inspection of target_field value (LLD §2.5 — "it only routes and merges").
 *
 * @param {Array<import('../../contracts/types.js').MappingProposal>} proposals
 * @param {number} threshold - Confidence threshold from CONFIG (passed by ORCH)
 * @returns {{ success: boolean, auto_staged?: Array, requires_review_columns?: string[],
 *             requires_review?: boolean, error?: Object }}
 */
export function route(proposals, threshold) {
  if (!proposals || !Array.isArray(proposals)) {
    return {
      success: false,
      error: {
        type: ErrorTypes.UNCLASSIFIED_ERROR,
        message: 'route() received invalid proposals: expected an array',
      },
    };
  }

  if (typeof threshold !== 'number' || isNaN(threshold)) {
    return {
      success: false,
      error: {
        type: ErrorTypes.UNCLASSIFIED_ERROR,
        message: 'route() received invalid threshold: expected a number',
      },
    };
  }

  // Pure threshold comparison — no content inspection (LLD §2.5, AES §7)
  const autoStaged = proposals.filter((p) => p.confidence >= threshold);
  const requiresReview = proposals.filter((p) => p.confidence < threshold);

  return {
    success: true,
    auto_staged: autoStaged,
    requires_review_columns: requiresReview.map((p) => p.column_header),
    requires_review: requiresReview.length > 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// finalize()
// LLD §6: finalize(MappingProposal[], HumanCorrection[]) → FinalizedMapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merge AI proposals with optional human corrections into a FinalizedMapping.
 * Human corrections take precedence for their respective columns (LLD §2.5).
 *
 * Column order in column_to_field follows the original column_index order from
 * proposals, making the output deterministic regardless of input ordering.
 *
 * Duplicate target-field assignments (two columns mapped to the same field)
 * are recorded in AUDIT as observations, not treated as errors. VALID is
 * responsible for required-field validation (LLD §2.7).
 *
 * @param {Array<import('../../contracts/types.js').MappingProposal>} proposals
 * @param {Array<import('../../contracts/types.js').HumanCorrection>} corrections
 * @param {{ import_run_id: string }} context - Passed by ORCH for AUDIT keying
 * @returns {Promise<{ success: boolean, data?: import('../../contracts/types.js').FinalizedMapping,
 *                     error?: Object, metadata?: Object }>}
 */
export async function finalize(proposals, corrections = [], context = {}) {
  const import_run_id = context?.import_run_id || 'unknown';

  if (!proposals || !Array.isArray(proposals)) {
    return {
      success: false,
      error: {
        type: ErrorTypes.UNCLASSIFIED_ERROR,
        message: 'finalize() received invalid proposals: expected an array',
      },
    };
  }

  const safeCorrections = Array.isArray(corrections) ? corrections : [];

  // Build a lookup of corrections keyed by column_header for O(1) access
  const correctionMap = new Map();
  for (const c of safeCorrections) {
    if (c && c.column_header && c.corrected_field !== undefined) {
      correctionMap.set(c.column_header, c.corrected_field);
    }
  }

  // Sort proposals by column_index for deterministic output order
  const sorted = [...proposals].sort((a, b) => (a.column_index ?? 0) - (b.column_index ?? 0));

  // Build column_to_field: AI proposal as base, human correction as override
  const columnToField = {};
  let correctionCount = 0;

  for (const proposal of sorted) {
    const header = proposal.column_header;
    if (correctionMap.has(header)) {
      columnToField[header] = correctionMap.get(header);
      correctionCount++;
    } else {
      columnToField[header] = proposal.target_field;
    }
  }

  // ── AUDIT: one record per column ──────────────────────────────────────────
  for (const proposal of sorted) {
    const header = proposal.column_header;
    const finalField = columnToField[header];
    const wasCorrected = correctionMap.has(header);

    AUDIT.record({
      import_run_id,
      stage: 'MAPPING_FINALIZED',
      subject: header,
      decision: finalField,
      confidence: proposal.confidence,
      rationale: wasCorrected
        ? `human_correction (AI had proposed: ${proposal.target_field})`
        : proposal.rationale,
      timestamp: new Date(),
    });
  }

  // ── Detect duplicate target-field assignments and record in AUDIT ─────────
  // This is an observation only. MAPFIN does not fail or warn the caller.
  // VALID is responsible for required-field validation (LLD §2.7).
  const fieldUsage = new Map(); // target_field → [column_headers]
  for (const [header, field] of Object.entries(columnToField)) {
    if (field !== 'UNMAPPED') {
      if (!fieldUsage.has(field)) fieldUsage.set(field, []);
      fieldUsage.get(field).push(header);
    }
  }
  const duplicateFields = [...fieldUsage.entries()].filter(([, headers]) => headers.length > 1);
  if (duplicateFields.length > 0) {
    const detail = duplicateFields
      .map(([field, headers]) => `${field}: [${headers.join(', ')}]`)
      .join('; ');
    AUDIT.record({
      import_run_id,
      stage: 'MAPPING_FINALIZED',
      subject: 'duplicate_target_fields',
      decision: 'multiple_columns_share_target',
      confidence: null,
      rationale: detail,
      timestamp: new Date(),
    });
  }

  // ── AUDIT: summary record ─────────────────────────────────────────────────
  const totalColumns = sorted.length;
  AUDIT.record({
    import_run_id,
    stage: 'MAPPING_FINALIZED',
    subject: 'finalization_complete',
    decision: `${totalColumns} columns finalized, ${correctionCount} corrections applied`,
    confidence: null,
    rationale: `had_corrections=${correctionCount > 0}, duplicate_target_fields=${duplicateFields.length}`,
    timestamp: new Date(),
  });

  /** @type {import('../../contracts/types.js').FinalizedMapping} */
  const finalizedMapping = {
    column_to_field: columnToField,
    finalized_at: new Date(),
    had_corrections: correctionCount > 0,
  };

  return {
    success: true,
    data: finalizedMapping,
    metadata: {
      processing_stats: {
        columns_mapped: totalColumns,
        corrections_applied: correctionCount,
      },
    },
  };
}

export default { route, finalize };
