/**
 * AIMAP Output Validator
 * AES §9 — Mandatory output validation gate (all-or-nothing)
 *
 * Five sequential checks. Any failure rejects the entire response.
 * No partial salvage — a response that fails any check is a full failure.
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether the response passed all checks
 * @property {string} [reason] - Failure reason code if not valid
 * @property {string} [detail] - Human-readable failure detail
 * @property {Array} [proposals] - Parsed proposals array if valid
 */

/**
 * Validate LLM response against all five AES §9 checks
 *
 * [1] Is the response well-formed JSON?
 * [2] Is it an array with the correct entry count?
 * [3] Does every column_header echo its expected input value?
 * [4] Is every target_field within the valid schema enum (+ UNMAPPED)?
 * [5] Is every confidence value a number in [0.0, 1.0]?
 *
 * @param {string} rawContent - Raw string content from LLM
 * @param {string[]} expectedColumnHeaders - Column headers in input order (from ColumnProfile[])
 * @param {string[]} schemaFieldIds - Valid field IDs from CONFIG target schema
 * @returns {ValidationResult}
 */
export function validateMappingResponse(rawContent, expectedColumnHeaders, schemaFieldIds) {
  // [1] Well-formed JSON
  let parsed;
  try {
    parsed = JSON.parse(rawContent);
  } catch (e) {
    return {
      valid: false,
      reason: 'not_valid_json',
      detail: `Response is not valid JSON: ${e.message}`,
    };
  }

  // The provider returns { mappings: [...] } due to json_object mode
  // Unwrap if necessary, or accept direct array
  if (!Array.isArray(parsed) && parsed && Array.isArray(parsed.mappings)) {
    parsed = parsed.mappings;
  }

  // [2] Array with correct entry count
  if (!Array.isArray(parsed)) {
    return {
      valid: false,
      reason: 'not_an_array',
      detail: `Expected JSON array, got ${typeof parsed}`,
    };
  }

  if (parsed.length !== expectedColumnHeaders.length) {
    return {
      valid: false,
      reason: 'count_mismatch',
      detail: `Expected ${expectedColumnHeaders.length} entries, got ${parsed.length}`,
    };
  }

  // [3] column_header echo check
  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i];
    if (!entry || typeof entry !== 'object') {
      return {
        valid: false,
        reason: 'invalid_entry_structure',
        detail: `Entry at index ${i} is not an object`,
      };
    }
    if (entry.column_header !== expectedColumnHeaders[i]) {
      return {
        valid: false,
        reason: 'header_echo_mismatch',
        detail: `Entry ${i}: expected column_header "${expectedColumnHeaders[i]}", got "${entry.column_header}"`,
      };
    }
  }

  // [4] target_field in enum
  const validFields = new Set([...schemaFieldIds, 'UNMAPPED']);
  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i];
    if (!validFields.has(entry.target_field)) {
      return {
        valid: false,
        reason: 'invalid_target_field',
        detail: `Entry ${i}: target_field "${entry.target_field}" is not in the schema enum`,
      };
    }
  }

  // [5] confidence in [0.0, 1.0]
  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i];
    const conf = entry.confidence;
    if (typeof conf !== 'number' || isNaN(conf) || conf < 0 || conf > 1) {
      return {
        valid: false,
        reason: 'confidence_out_of_range',
        detail: `Entry ${i}: confidence "${conf}" is not a number in [0.0, 1.0]`,
      };
    }
  }

  // All checks passed
  return { valid: true, proposals: parsed };
}
