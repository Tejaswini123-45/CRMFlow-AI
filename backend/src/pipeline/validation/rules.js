/**
 * VALID Validation Rules
 * Phase 9 — LLD §2.7, PRD §9
 *
 * Each rule is a pure function: (value: string | null) → { is_valid, reason? }
 *   - value is already normalized (output of XFORM) — VALID never repairs.
 *   - reason is present only when is_valid === false.
 *   - null input always passes unless the caller's required-field check fails first.
 *     Rules are called with non-null values only (index.js guards this).
 *
 * Rules follow exactly what PRD §9 specifies. No behaviour invented beyond the spec.
 */

// ─── email ────────────────────────────────────────────────────────────────────

/**
 * PRD §9: "RFC-5322 pattern match"
 * Practical check: local@domain.tld, max 254 chars, no whitespace, single @.
 *
 * @param {string} value - Already lowercased + trimmed by XFORM
 * @returns {{ is_valid: boolean, reason?: string }}
 */
export function validateEmail(value) {
  if (value.length > 254) {
    return { is_valid: false, reason: `email exceeds 254-character limit (length: ${value.length})` };
  }

  const atIdx = value.indexOf('@');
  if (atIdx === -1) {
    return { is_valid: false, reason: 'invalid email format: missing @ character' };
  }
  if (value.indexOf('@', atIdx + 1) !== -1) {
    return { is_valid: false, reason: 'invalid email format: multiple @ characters' };
  }

  const local = value.slice(0, atIdx);
  const domain = value.slice(atIdx + 1);

  if (local.length === 0) {
    return { is_valid: false, reason: 'invalid email format: empty local part (before @)' };
  }
  if (/\s/.test(local)) {
    return { is_valid: false, reason: 'invalid email format: whitespace in local part' };
  }

  if (domain.length === 0) {
    return { is_valid: false, reason: 'invalid email format: empty domain part (after @)' };
  }
  if (!domain.includes('.')) {
    return { is_valid: false, reason: 'invalid email format: domain has no dot' };
  }
  if (/\s/.test(domain)) {
    return { is_valid: false, reason: 'invalid email format: whitespace in domain part' };
  }

  const lastDot = domain.lastIndexOf('.');
  const tld = domain.slice(lastDot + 1);
  if (tld.length === 0) {
    return { is_valid: false, reason: 'invalid email format: empty TLD' };
  }

  return { is_valid: true };
}

// ─── phone_number ─────────────────────────────────────────────────────────────

/**
 * PRD §9: "E.164-normalizable, min digit count"
 * XFORM has already stripped to digits + optional leading '+'.
 * VALID checks digit count ≥ CONFIG-supplied min (default: 7).
 *
 * @param {string} value - Already stripped to digits (+ optional '+') by XFORM
 * @param {number} minDigits - From CONFIG.getValidationRules().min_phone_digits
 * @returns {{ is_valid: boolean, reason?: string }}
 */
export function validatePhone(value, minDigits = 7) {
  const digits = value.replace(/\D/g, '');
  if (digits.length < minDigits) {
    return {
      is_valid: false,
      reason: `phone number has ${digits.length} digit(s); minimum required is ${minDigits}`,
    };
  }
  return { is_valid: true };
}

// ─── first_name ───────────────────────────────────────────────────────────────

/**
 * PRD §9: "Non-empty, no digits"
 *
 * @param {string} value
 * @returns {{ is_valid: boolean, reason?: string }}
 */
export function validateFirstName(value) {
  if (value.trim().length === 0) {
    return { is_valid: false, reason: 'first_name must not be empty' };
  }
  if (/\d/.test(value)) {
    return { is_valid: false, reason: 'first_name must not contain digit characters' };
  }
  return { is_valid: true };
}

// ─── last_name ────────────────────────────────────────────────────────────────

/**
 * PRD §9: "Optional (some cultures single-name)" — same no-digit rule when non-null
 *
 * @param {string} value
 * @returns {{ is_valid: boolean, reason?: string }}
 */
export function validateLastName(value) {
  if (value.trim().length === 0) {
    return { is_valid: false, reason: 'last_name must not be empty when present' };
  }
  if (/\d/.test(value)) {
    return { is_valid: false, reason: 'last_name must not contain digit characters' };
  }
  return { is_valid: true };
}

// ─── created_date ─────────────────────────────────────────────────────────────

/**
 * PRD §9: "Must resolve to valid date"
 * Two-step check (Refinement #3):
 *   1. ISO 8601 format check via regex (YYYY-MM-DD)
 *   2. Calendar-validity check via Date.UTC() round-trip
 *
 * XFORM produces ISO 8601 strings for dates it could parse, or null for unresolvable.
 * VALID confirms the string is still well-formed (guards against edge cases) AND valid calendar.
 *
 * @param {string} value - Expected to be 'YYYY-MM-DD'
 * @returns {{ is_valid: boolean, reason?: string }}
 */
export function validateDate(value) {
  // Step 1: ISO 8601 format
  const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const match = value.match(ISO_DATE_RE);
  if (!match) {
    return {
      is_valid: false,
      reason: `invalid date format: expected YYYY-MM-DD, got "${value}"`,
    };
  }

  // Step 2: Calendar validity via round-trip
  const y = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const d = parseInt(match[3], 10);

  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return {
      is_valid: false,
      reason: `invalid date: "${value}" is not a valid calendar date`,
    };
  }

  return { is_valid: true };
}

// ─── string fields (company, source, status, notes) ──────────────────────────

/**
 * Generic string: PRD §9 specifies no format rules for these fields.
 * Any non-null, non-empty string passes. Null is handled by the required-field check.
 *
 * @param {string} value
 * @returns {{ is_valid: boolean, reason?: string }}
 */
export function validateString(value) {
  if (value.trim().length === 0) {
    return { is_valid: false, reason: 'field must not be empty when present' };
  }
  return { is_valid: true };
}

// ─── Rule registry ────────────────────────────────────────────────────────────

/**
 * Maps data_type → validation function (for non-null values).
 * CONFIG's target_schema.fields[n].data_type → rule.
 */
export const VALIDATION_RULES_BY_TYPE = {
  email: (value, _config) => validateEmail(value),
  phone: (value, config) => validatePhone(value, config?.min_phone_digits ?? 7),
  date: (value, _config) => validateDate(value),
  string: (value, _config) => validateString(value),
  text: (value, _config) => validateString(value),
};

/**
 * Get the validation rule for a given data_type.
 * Falls back to validateString for unknown types (safe default).
 *
 * @param {string} dataType
 * @returns {Function}
 */
export function getRuleForType(dataType) {
  return VALIDATION_RULES_BY_TYPE[dataType] ?? validateString;
}
