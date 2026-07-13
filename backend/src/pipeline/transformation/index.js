/**
 * Transformation Component (XFORM)
 * LLD §2.6 — Transformation
 *
 * Receives { parsedFile, finalizedMapping } assembled by ORCH.
 * Applies deterministic per-field-type normalization rules (PRD §9).
 * Produces NormalizedRow[] — one per input row, in original row order.
 *
 * Constraints (LLD §2.6):
 *   - Pure function per row: no cross-row dependencies.
 *   - Every input row produces exactly one output row — nothing is dropped.
 *   - Values that cannot be normalized are set to null with a UNRESOLVABLE note.
 *   - UNMAPPED columns are preserved in unmapped_fields, separate from CRM fields.
 *   - No validation logic (VALID's job). No AI calls. No DataStore access.
 */

import { AUDIT } from '../../audit/index.js';
import { ErrorTypes } from '../../contracts/types.js';
import { normalizeNullSentinel, getRuleFor } from './rules.js';

/**
 * Normalize raw rows using the finalized mapping.
 *
 * Input is assembled by ORCH and contains:
 *   { parsedFile: ParsedFile, finalizedMapping: FinalizedMapping }
 *
 * @param {{ parsedFile: Object, finalizedMapping: Object }} input
 * @param {{ import_run_id: string }} context
 * @returns {Promise<{ success: boolean, data?: NormalizedRow[], error?: Object, metadata?: Object }>}
 */
export async function execute(input, context) {
  const import_run_id = context?.import_run_id ?? 'unknown';

  // ── Input validation ────────────────────────────────────────────────────
  if (!input || typeof input !== 'object') {
    return {
      success: false,
      error: {
        type: ErrorTypes.UNCLASSIFIED_ERROR,
        message: 'XFORM received invalid input: expected { parsedFile, finalizedMapping }',
      },
    };
  }

  const { parsedFile, finalizedMapping } = input;

  if (!parsedFile || !Array.isArray(parsedFile.headers) || !Array.isArray(parsedFile.rows)) {
    return {
      success: false,
      error: {
        type: ErrorTypes.UNCLASSIFIED_ERROR,
        message: 'XFORM received invalid parsedFile: missing headers or rows',
      },
    };
  }

  if (!finalizedMapping || typeof finalizedMapping.column_to_field !== 'object') {
    return {
      success: false,
      error: {
        type: ErrorTypes.UNCLASSIFIED_ERROR,
        message: 'XFORM received invalid finalizedMapping: missing column_to_field',
      },
    };
  }

  // ── Build header → column_index lookup (O(n) once, reused per row) ────
  const headerToIndex = new Map();
  for (let i = 0; i < parsedFile.headers.length; i++) {
    headerToIndex.set(parsedFile.headers[i], i);
  }

  // ── Ordered list of (columnHeader, targetField) pairs for determinism ─
  // Sort by column_index so field order in output rows is deterministic
  // regardless of the insertion order of column_to_field's keys.
  const mappingEntries = Object.entries(finalizedMapping.column_to_field).sort(([hA], [hB]) => {
    const iA = headerToIndex.get(hA) ?? Infinity;
    const iB = headerToIndex.get(hB) ?? Infinity;
    return iA - iB;
  });

  // ── Separate mapped from UNMAPPED entries ─────────────────────────────
  const mappedEntries = mappingEntries.filter(([, tf]) => tf !== 'UNMAPPED');
  const unmappedEntries = mappingEntries.filter(([, tf]) => tf === 'UNMAPPED');

  // ── Per-row normalization ──────────────────────────────────────────────
  let totalUnresolvable = 0;

  const normalizedRows = parsedFile.rows.map((row, rowIndex) => {
    /** @type {Object<string, any>} */
    const fields = {};
    /** @type {Object<string, string>} */
    const normalization_notes = {};
    /** @type {Object<string, string>} */
    const unmapped_fields = {};

    // Normalize each mapped field
    for (const [columnHeader, targetField] of mappedEntries) {
      const colIdx = headerToIndex.get(columnHeader);
      const rawCell = colIdx !== undefined ? (row[colIdx] ?? null) : null;

      // Null-sentinel check before applying a rule
      const preNormalized = normalizeNullSentinel(rawCell);
      if (preNormalized === null) {
        fields[targetField] = null;
        continue; // No normalization note for absent values
      }

      const rule = getRuleFor(targetField);
      const { value, note } = rule(rawCell); // Pass original (rule normalizes sentinel internally)

      fields[targetField] = value;
      if (note) {
        normalization_notes[targetField] = note;
        if (note.startsWith('UNRESOLVABLE')) totalUnresolvable++;
      }
    }

    // Carry through UNMAPPED column values unchanged
    for (const [columnHeader] of unmappedEntries) {
      const colIdx = headerToIndex.get(columnHeader);
      const rawCell = colIdx !== undefined ? (row[colIdx] ?? null) : null;
      unmapped_fields[columnHeader] = rawCell !== null && rawCell !== undefined ? String(rawCell) : null;
    }

    /** @type {import('../../contracts/types.js').NormalizedRow & { unmapped_fields: Object }} */
    const normalizedRow = {
      row_index: rowIndex,
      fields,
      ...(Object.keys(normalization_notes).length > 0 ? { normalization_notes } : {}),
      ...(Object.keys(unmapped_fields).length > 0 ? { unmapped_fields } : {}),
    };

    return normalizedRow;
  });

  // ── AUDIT summary ──────────────────────────────────────────────────────
  AUDIT.record({
    import_run_id,
    stage: 'TRANSFORMING',
    subject: 'transformation_complete',
    decision: `${normalizedRows.length} rows normalized`,
    confidence: null,
    rationale: `unresolvable_fields=${totalUnresolvable}`,
    timestamp: new Date(),
  });

  return {
    success: true,
    data: normalizedRows,
    metadata: {
      processing_stats: {
        rows_processed: normalizedRows.length,
        unresolvable_fields: totalUnresolvable,
      },
    },
  };
}

export default { execute };
