/**
 * Exact-Match Duplicate Matcher
 * Phase 10 — LLD §2.8, LLD §13 (Extension Point: Pluggable matcher)
 *
 * Implements the matcher interface:
 *   match(fields, keyFields, seenIndex, existingRecordIndex)
 *     → { isDuplicate, matchedFields, matchedAgainst }
 *
 * Matching rule (PRD §10): "Deduped in MVP by email/phone match"
 *   A row is a duplicate if ANY configured key field value matches
 *   a previously-seen row OR an existing record (OR semantics, per PRD §10).
 *
 * seenIndex   — Map<"field:value", row_index_string> built by DEDUPE as rows are processed.
 * existingRecordIndex — abstract interface: { lookup(field, value) → string|null }
 *                       Returns a reference string if the value is known, null otherwise.
 *                       ORCH supplies a no-op implementation for MVP.
 */

/**
 * Check whether a row's key fields duplicate a previously-seen or existing record.
 *
 * @param {Object<string, any>} fields - NormalizedRow.fields for this row
 * @param {string[]} keyFields - Field IDs to compare (from CONFIG)
 * @param {Map<string, string>} seenIndex - Accumulates "field:value" → "row_{N}" mappings
 * @param {{ lookup: (field: string, value: string) => string|null }} existingRecordIndex
 * @returns {{ isDuplicate: boolean, matchedFields: string[], matchedAgainst: string|null }}
 */
export function exactMatch(fields, keyFields, seenIndex, existingRecordIndex) {
  const matchedFields = [];
  let matchedAgainst = null;

  for (const field of keyFields) {
    const value = fields[field];
    if (value === null || value === undefined) continue; // null keys are not matchable

    const key = `${field}:${value}`;

    // Check within-file (already-seen rows)
    if (seenIndex.has(key)) {
      matchedFields.push(field);
      if (matchedAgainst === null) matchedAgainst = seenIndex.get(key);
    }

    // Check existing records via abstract index
    if (matchedAgainst === null) {
      const existingRef = existingRecordIndex.lookup(field, value);
      if (existingRef !== null) {
        matchedFields.push(field);
        matchedAgainst = existingRef;
      }
    }
  }

  return {
    isDuplicate: matchedFields.length > 0,
    matchedFields: matchedFields.length > 0 ? matchedFields : null,
    matchedAgainst,
  };
}

/**
 * The exact-match matcher object satisfying the matcher interface.
 * Exported as default so DEDUPE can receive any implementation that has the same shape.
 */
export const exactMatchMatcher = { match: exactMatch };
