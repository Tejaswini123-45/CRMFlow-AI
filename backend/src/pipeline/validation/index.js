/**
 * Validation Component (VALID)
 * LLD §2.7 — Validation
 *
 * Consumes NormalizedRow[] from XFORM.
 * Produces RowVerdict[] — one per input row.
 *
 * Constraints (LLD §2.7):
 *   - Schema validation first, then business validation (HLD §7 ordering).
 *   - Pure function per row — no cross-row logic.
 *   - Every row produces exactly one RowVerdict.
 *   - Every schema field produces exactly one FieldVerdict per row (Refinement #1).
 *   - overall_verdict: 'VALID' | 'PARTIAL' | 'INVALID'
 *       INVALID  — at least one required field is invalid
 *       PARTIAL  — required fields all pass, but ≥1 optional field fails
 *       VALID    — all field verdicts pass
 *   - execute() returns success:true even when rows fail validation.
 *     FieldValidationFailure is a data event (LLD §10: recoverable, pipeline continues).
 *   - execute() returns success:false only for component-level input errors.
 *   - Required-field authority: target_schema.fields[n].required only (Refinement #2).
 */

import { AUDIT } from '../../audit/index.js';
import { CONFIG } from '../../config/index.js';
import { ErrorTypes } from '../../contracts/types.js';
import { getRuleForType } from './rules.js';

// Sentinel prefix written by XFORM for values it could not normalize.
const UNRESOLVABLE_PREFIX = 'UNRESOLVABLE';

/**
 * Validate normalized rows against the target schema.
 *
 * @param {Array<import('../../contracts/types.js').NormalizedRow>} normalizedRows
 * @param {{ import_run_id: string }} context
 * @returns {Promise<{ success: boolean, data?: Array, error?: Object, metadata?: Object }>}
 */
export async function execute(normalizedRows, context) {
  const import_run_id = context?.import_run_id ?? 'unknown';

  if (!normalizedRows || !Array.isArray(normalizedRows)) {
    return {
      success: false,
      error: {
        type: ErrorTypes.UNCLASSIFIED_ERROR,
        message: 'VALID received invalid input: expected an array of NormalizedRow',
      },
    };
  }

  // ── Read schema + validation config once (not per-row) ───────────────
  const schema = CONFIG.getTargetSchema();
  const schemaFields = schema.fields; // Array of { id, data_type, required, ... }
  const validationConfig = CONFIG.getValidationRules(); // { min_phone_digits, ... }

  // ── Per-row validation ─────────────────────────────────────────────────
  let totalValid = 0;
  let totalPartial = 0;
  let totalInvalid = 0;
  let totalFieldFailures = 0;

  const rowVerdicts = normalizedRows.map((row) => {
    const fieldVerdicts = [];
    let hasRequiredFailure = false;
    let hasOptionalFailure = false;

    for (const schemaField of schemaFields) {
      const { id, data_type, required } = schemaField;
      const value = row.fields?.[id] ?? null;

      // Check if XFORM left an UNRESOLVABLE note for this field
      const xformNote = row.normalization_notes?.[id];
      const wasUnresolvable = xformNote?.startsWith(UNRESOLVABLE_PREFIX) ?? false;

      let verdict;

      if (value === null) {
        // ── Schema validation: absent / null value ─────────────────────
        if (required) {
          const reason = wasUnresolvable
            ? `required field could not be normalized: ${xformNote}`
            : 'required field missing';
          verdict = { field_name: id, is_valid: false, reason };
          hasRequiredFailure = true;
          totalFieldFailures++;
        } else {
          // Optional and absent — deterministic structure, always present
          verdict = wasUnresolvable
            ? {
                field_name: id,
                is_valid: false,
                reason: `optional field could not be normalized: ${xformNote}`,
              }
            : { field_name: id, is_valid: true, reason: 'field not present in source data' };

          if (wasUnresolvable) {
            hasOptionalFailure = true;
            totalFieldFailures++;
          }
        }
      } else {
        // ── Business validation: non-null value ────────────────────────
        const rule = getRuleForType(data_type);
        const result = rule(value, validationConfig);

        verdict = { field_name: id, is_valid: result.is_valid };
        if (!result.is_valid) {
          verdict.reason = result.reason;
          if (required) {
            hasRequiredFailure = true;
          } else {
            hasOptionalFailure = true;
          }
          totalFieldFailures++;
        }
      }

      fieldVerdicts.push(verdict);
    }

    // ── Determine overall_verdict ──────────────────────────────────────
    let overall_verdict;
    if (hasRequiredFailure) {
      overall_verdict = 'INVALID';
      totalInvalid++;
    } else if (hasOptionalFailure) {
      overall_verdict = 'PARTIAL';
      totalPartial++;
    } else {
      overall_verdict = 'VALID';
      totalValid++;
    }

    return {
      row_index: row.row_index,
      overall_verdict,
      field_verdicts: fieldVerdicts,
    };
  });

  // ── AUDIT summary record ───────────────────────────────────────────────
  AUDIT.record({
    import_run_id,
    stage: 'VALIDATING',
    subject: 'validation_complete',
    decision: `${rowVerdicts.length} rows validated: ${totalValid} VALID, ${totalPartial} PARTIAL, ${totalInvalid} INVALID`,
    confidence: null,
    rationale: `field_failures=${totalFieldFailures}`,
    timestamp: new Date(),
  });

  return {
    success: true,
    data: rowVerdicts,
    metadata: {
      processing_stats: {
        rows_processed: rowVerdicts.length,
        valid_rows: totalValid,
        partial_rows: totalPartial,
        invalid_rows: totalInvalid,
        field_failures: totalFieldFailures,
      },
    },
  };
}

export default { execute };
