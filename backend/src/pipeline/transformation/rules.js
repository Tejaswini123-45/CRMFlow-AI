/**
 * XFORM Normalization Rules
 * Phase 8 — LLD §2.6, PRD §9
 *
 * Each rule is a pure function: (rawValue: string) → { value, note? }
 *   - value: normalized string, or null when absent / unresolvable
 *   - note:  present only when a transformation was applied or failed
 *            Format on failure: 'UNRESOLVABLE: <reason>'
 *
 * Rules follow exactly what PRD §9 specifies.  No behaviour is invented
 * beyond what the spec requires.  Validation (is the result correct?) is
 * VALID's job (Phase 9).
 */

// ─── Sentinel / null detection ───────────────────────────────────────────────

const NULL_SENTINELS = new Set(['n/a', 'na', 'null', 'nil', 'none', '-', '–', '—', '']);

/**
 * Treat common "no value" strings as null before any normalization rule runs.
 * PRD §10: "Unexpected values like 'N/A' treated as null/missing."
 *
 * @param {string|null|undefined} raw
 * @returns {string|null} trimmed string or null
 */
export function normalizeNullSentinel(raw) {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (NULL_SENTINELS.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

// ─── Individual field rules ───────────────────────────────────────────────────

/**
 * email — RFC-5322 pattern match is VALID's job.
 * XFORM: lowercase + trim.
 * Multi-value (comma/semicolon-separated): PRD §9 notes this as an ambiguity
 * ("which of multiple emails is primary?").  Per refinement #4, we must not
 * silently discard.  If multiple emails are detected, mark UNRESOLVABLE so
 * the user is informed rather than having one silently discarded.
 *
 * @param {string} raw
 * @returns {{ value: string|null, note?: string }}
 */
export function normalizeEmail(raw) {
  const trimmed = normalizeNullSentinel(raw);
  if (trimmed === null) return { value: null };

  // Detect multi-email (comma or semicolon separated)
  if (/[,;]/.test(trimmed)) {
    return {
      value: null,
      note: `UNRESOLVABLE: multiple email addresses detected ("${trimmed}"); cannot determine primary without user input`,
    };
  }

  return { value: trimmed.toLowerCase(), note: trimmed !== trimmed.toLowerCase() ? 'lowercased' : undefined };
}

/**
 * phone_number — PRD §9 validation rule: "E.164-normalizable, min digit count".
 * XFORM normalizes to the extent deterministically possible without a locale:
 *   1. Strip all characters except digits and a leading '+'.
 *   2. Preserve the result for VALID to check digit count / E.164 format.
 * No library, no country-code inference.  Country-code inference would require
 * assumptions not available in the data (PRD §9 notes "country code missing"
 * as a "common mistake", not a case XFORM should silently resolve).
 *
 * @param {string} raw
 * @returns {{ value: string|null, note?: string }}
 */
export function normalizePhone(raw) {
  const trimmed = normalizeNullSentinel(raw);
  if (trimmed === null) return { value: null };

  // Strip everything except digits and a leading '+'
  const hasLeadingPlus = trimmed.startsWith('+');
  const digitsOnly = trimmed.replace(/\D/g, '');

  if (digitsOnly.length === 0) {
    return {
      value: null,
      note: `UNRESOLVABLE: no digits found in "${trimmed}"`,
    };
  }

  const normalized = hasLeadingPlus ? `+${digitsOnly}` : digitsOnly;
  const changed = normalized !== trimmed;
  return {
    value: normalized,
    note: changed ? `stripped non-digit characters from "${trimmed}"` : undefined,
  };
}

/**
 * first_name — trim + title-case.
 * Non-Latin characters are preserved as-is (PRD §10).
 *
 * @param {string} raw
 * @returns {{ value: string|null, note?: string }}
 */
export function normalizeFirstName(raw) {
  return normalizeName(raw);
}

/**
 * last_name — same rules as first_name.
 *
 * @param {string} raw
 * @returns {{ value: string|null, note?: string }}
 */
export function normalizeLastName(raw) {
  return normalizeName(raw);
}

/**
 * Shared helper for first_name / last_name.
 * Title-case: uppercases the first character of each whitespace-separated word.
 * Does not split on hyphens / apostrophes to avoid breaking "O'Brien" or
 * "van der Berg" patterns (the spec does not specify sub-word splitting rules).
 */
function normalizeName(raw) {
  const trimmed = normalizeNullSentinel(raw);
  if (trimmed === null) return { value: null };

  const titleCased = trimmed
    .split(' ')
    .map((word) => (word.length > 0 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');

  const changed = titleCased !== trimmed;
  return {
    value: titleCased,
    note: changed ? `title-cased from "${trimmed}"` : undefined,
  };
}

/**
 * company — trim + title-case (same rationale as names).
 *
 * @param {string} raw
 * @returns {{ value: string|null, note?: string }}
 */
export function normalizeCompany(raw) {
  const trimmed = normalizeNullSentinel(raw);
  if (trimmed === null) return { value: null };

  const titleCased = trimmed
    .split(' ')
    .map((word) => (word.length > 0 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');

  const changed = titleCased !== trimmed;
  return {
    value: titleCased,
    note: changed ? `title-cased from "${trimmed}"` : undefined,
  };
}

/**
 * source — trim only.  PRD §9: non-empty preferred, else defaults to filename.
 * XFORM preserves the value as-is; defaulting to filename is an orchestration
 * concern (out of scope for XFORM).
 *
 * @param {string} raw
 * @returns {{ value: string|null, note?: string }}
 */
export function normalizeSource(raw) {
  const trimmed = normalizeNullSentinel(raw);
  if (trimmed === null) return { value: null };
  return { value: trimmed };
}

/**
 * created_date — normalize to ISO 8601 date string ("YYYY-MM-DD").
 *
 * Attempts (in order, all deterministic):
 *   1. ISO 8601: YYYY-MM-DD or YYYY/MM/DD
 *   2. Unambiguous long-form: "3 April 2024", "April 3, 2024", etc.
 *   3. DD/MM/YYYY or MM/DD/YYYY — attempted only if non-ambiguous
 *      (i.e., one of the two positional numbers is > 12, uniquely
 *       identifying which is day and which is month).
 *
 * PRD §9 ambiguity: "Ambiguous DD/MM vs MM/DD" → if ambiguous, mark
 * UNRESOLVABLE.  Better to surface the problem than to guess wrong.
 *
 * @param {string} raw
 * @returns {{ value: string|null, note?: string }}
 */
export function normalizeDate(raw) {
  const trimmed = normalizeNullSentinel(raw);
  if (trimmed === null) return { value: null };

  // 1. ISO 8601: YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    const iso = toISODateString(parseInt(y, 10), parseInt(m, 10), parseInt(d, 10));
    if (iso) return { value: iso, note: iso !== trimmed ? `normalized from "${trimmed}"` : undefined };
    return { value: null, note: `UNRESOLVABLE: invalid date values in "${trimmed}"` };
  }

  // 2. Named month formats: "3 April 2024", "April 3, 2024", "Apr 3 2024", etc.
  const namedMatch = tryNamedMonth(trimmed);
  if (namedMatch !== null) {
    return {
      value: namedMatch,
      note: namedMatch !== trimmed ? `normalized from "${trimmed}"` : undefined,
    };
  }

  // 3. Numeric DD/MM/YYYY or MM/DD/YYYY (also D/M/YY etc.)
  const numericMatch = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (numericMatch) {
    const [, a, b, yearRaw] = numericMatch;
    const av = parseInt(a, 10);
    const bv = parseInt(b, 10);
    const y = yearRaw.length === 2 ? 2000 + parseInt(yearRaw, 10) : parseInt(yearRaw, 10);

    // Disambiguation: if one of the two is > 12 it must be the day
    if (av > 12 && bv <= 12) {
      // av is day, bv is month
      const iso = toISODateString(y, bv, av);
      if (iso) return { value: iso, note: `normalized from "${trimmed}" (day=${av}, month=${bv})` };
      return { value: null, note: `UNRESOLVABLE: invalid date values in "${trimmed}"` };
    }
    if (bv > 12 && av <= 12) {
      // bv is day, av is month
      const iso = toISODateString(y, av, bv);
      if (iso) return { value: iso, note: `normalized from "${trimmed}" (month=${av}, day=${bv})` };
      return { value: null, note: `UNRESOLVABLE: invalid date values in "${trimmed}"` };
    }
    // Both ≤ 12: ambiguous — cannot determine DD/MM vs MM/DD without locale
    return {
      value: null,
      note: `UNRESOLVABLE: ambiguous date format "${trimmed}" — cannot distinguish DD/MM/YYYY from MM/DD/YYYY`,
    };
  }

  return {
    value: null,
    note: `UNRESOLVABLE: unrecognized date format "${trimmed}"`,
  };
}

/**
 * notes / raw_message — trim only.  PRD §9: "None (free text)".
 * No further transformation.  Structure extraction is explicitly Category D.
 *
 * @param {string} raw
 * @returns {{ value: string|null, note?: string }}
 */
export function normalizeNotes(raw) {
  const trimmed = normalizeNullSentinel(raw);
  if (trimmed === null) return { value: null };
  return { value: trimmed };
}

/**
 * status — trim only.  PRD §9: enum-constrained by target CRM.
 * VALID handles enum checking; XFORM only trims whitespace.
 *
 * @param {string} raw
 * @returns {{ value: string|null, note?: string }}
 */
export function normalizeStatus(raw) {
  const trimmed = normalizeNullSentinel(raw);
  if (trimmed === null) return { value: null };
  return { value: trimmed };
}

// ─── Rule registry ────────────────────────────────────────────────────────────

/**
 * Maps target_field id → normalization function.
 * Any field not present here receives trim-only treatment (the safe fallback).
 */
export const NORMALIZATION_RULES = {
  email: normalizeEmail,
  phone_number: normalizePhone,
  first_name: normalizeFirstName,
  last_name: normalizeLastName,
  company: normalizeCompany,
  source: normalizeSource,
  created_date: normalizeDate,
  notes: normalizeNotes,
  status: normalizeStatus,
};

/**
 * Get the normalization rule for a given target_field id.
 * Falls back to trim-only for unknown fields (safe; VALID will handle unknown fields).
 *
 * @param {string} targetField
 * @returns {Function}
 */
export function getRuleFor(targetField) {
  return NORMALIZATION_RULES[targetField] ?? normalizeSource; // trim-only fallback
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const MONTH_NAMES = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/**
 * Try to parse a named-month date string.
 * Accepts: "3 April 2024", "April 3, 2024", "Apr 3 2024", "3-Apr-2024", etc.
 *
 * @param {string} s
 * @returns {string|null} ISO date string or null if not recognized
 */
function tryNamedMonth(s) {
  // Normalize separators to spaces
  const normalized = s.replace(/[-,./]/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = normalized.split(' ');

  if (parts.length < 3) return null;

  let day, month, year;

  // Pattern: "3 April 2024" or "3 Apr 2024"
  const p0AsNum = parseInt(parts[0], 10);
  const p2AsNum = parseInt(parts[2], 10);
  const p1AsMonth = MONTH_NAMES[parts[1].toLowerCase()];

  // Pattern: "April 3 2024" or "Apr 3, 2024"
  const p0AsMonth = MONTH_NAMES[parts[0].toLowerCase()];
  const p1AsNum = parseInt(parts[1], 10);

  if (!isNaN(p0AsNum) && p1AsMonth && !isNaN(p2AsNum)) {
    day = p0AsNum; month = p1AsMonth; year = p2AsNum;
  } else if (p0AsMonth && !isNaN(p1AsNum) && !isNaN(p2AsNum)) {
    month = p0AsMonth; day = p1AsNum; year = p2AsNum;
  } else {
    return null;
  }

  if (year < 100) year += 2000;
  return toISODateString(year, month, day);
}

/**
 * Build an ISO date string from year/month/day after basic range validation.
 *
 * @param {number} y
 * @param {number} m
 * @param {number} d
 * @returns {string|null}
 */
function toISODateString(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1000 || y > 9999) return null;
  // Use Date to catch invalid combos like Feb 30
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
