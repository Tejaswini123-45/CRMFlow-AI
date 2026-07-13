/**
 * Validation (VALID) Tests
 * Phase 9 — LLD §2.7, PRD §9
 *
 * Two sections:
 *   1. Per-rule unit tests (rules.js) — pure functions, no CONFIG/ORCH needed.
 *   2. Full execute() tests (index.js) — schema coverage, AUDIT, metadata.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

// eslint-disable-next-line no-restricted-imports
import {
  validateEmail,
  validatePhone,
  validateFirstName,
  validateLastName,
  validateDate,
  validateString,
} from '../pipeline/validation/rules.js';
// eslint-disable-next-line no-restricted-imports
import { execute } from '../pipeline/validation/index.js';
import { AUDIT } from '../audit/index.js';
import { CONFIG } from '../config/index.js';

const CTX = { import_run_id: 'valid-test-001' };

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a minimal NormalizedRow with the given fields.
 */
function makeRow(rowIndex, fields, normalization_notes = {}) {
  return {
    row_index: rowIndex,
    fields,
    ...(Object.keys(normalization_notes).length > 0 ? { normalization_notes } : {}),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Rule unit tests
// ════════════════════════════════════════════════════════════════════════════

describe('validateEmail', () => {
  test('simple valid email', () => assert.strictEqual(validateEmail('a@b.com').is_valid, true));
  test('uppercase was already lowercased by XFORM — passes', () =>
    assert.strictEqual(validateEmail('john@example.com').is_valid, true));
  test('subdomain', () => assert.strictEqual(validateEmail('u@sub.domain.org').is_valid, true));

  test('missing @', () => {
    const r = validateEmail('notanemail');
    assert.strictEqual(r.is_valid, false);
    assert.ok(r.reason?.includes('@'));
  });

  test('multiple @', () => {
    const r = validateEmail('a@b@c.com');
    assert.strictEqual(r.is_valid, false);
    assert.ok(r.reason?.includes('multiple'));
  });

  test('empty local part', () => {
    const r = validateEmail('@b.com');
    assert.strictEqual(r.is_valid, false);
    assert.ok(r.reason?.includes('local'));
  });

  test('empty domain part', () => {
    const r = validateEmail('a@');
    assert.strictEqual(r.is_valid, false);
    assert.ok(r.reason?.includes('domain'));
  });

  test('domain without dot', () => {
    const r = validateEmail('a@nodot');
    assert.strictEqual(r.is_valid, false);
    assert.ok(r.reason?.includes('dot'));
  });

  test('whitespace in local part', () => {
    const r = validateEmail('a b@c.com');
    assert.strictEqual(r.is_valid, false);
    assert.ok(r.reason?.includes('whitespace'));
  });

  test('exceeds 254 chars', () => {
    const r = validateEmail('a'.repeat(250) + '@b.co');
    assert.strictEqual(r.is_valid, false);
    assert.ok(r.reason?.includes('254'));
  });
});

describe('validatePhone', () => {
  test('7 digits — meets minimum', () =>
    assert.strictEqual(validatePhone('1234567', 7).is_valid, true));
  test('10 digits', () =>
    assert.strictEqual(validatePhone('9876543210', 7).is_valid, true));
  test('plus prefix preserved', () =>
    assert.strictEqual(validatePhone('+919876543210', 7).is_valid, true));

  test('fewer than min digits', () => {
    const r = validatePhone('12345', 7);
    assert.strictEqual(r.is_valid, false);
    assert.ok(r.reason?.includes('5'));
    assert.ok(r.reason?.includes('7'));
  });

  test('respects configurable minimum', () => {
    assert.strictEqual(validatePhone('123456789', 10).is_valid, false);
    assert.strictEqual(validatePhone('1234567890', 10).is_valid, true);
  });
});

describe('validateFirstName', () => {
  test('simple name', () => assert.strictEqual(validateFirstName('Priya').is_valid, true));
  test('non-Latin preserved and valid (PRD §10)', () =>
    assert.strictEqual(validateFirstName('서울').is_valid, true));
  test('hyphenated name', () => assert.strictEqual(validateFirstName('Anne-Marie').is_valid, true));

  test('contains digit', () => {
    const r = validateFirstName('John3');
    assert.strictEqual(r.is_valid, false);
    assert.ok(r.reason?.includes('digit'));
  });

  test('empty after trim', () => {
    const r = validateFirstName('   ');
    assert.strictEqual(r.is_valid, false);
    assert.ok(r.reason?.includes('empty'));
  });
});

describe('validateLastName', () => {
  test('simple surname', () => assert.strictEqual(validateLastName('Sharma').is_valid, true));

  test('digit in name → invalid', () => {
    const r = validateLastName('O2Connor');
    assert.strictEqual(r.is_valid, false);
    assert.ok(r.reason?.includes('digit'));
  });

  test('empty string → invalid when present', () => {
    const r = validateLastName('');
    assert.strictEqual(r.is_valid, false);
  });
});

describe('validateDate', () => {
  // Step 1: format
  test('ISO 8601 YYYY-MM-DD valid', () =>
    assert.strictEqual(validateDate('2024-04-03').is_valid, true));
  test('wrong format — no hyphens', () => {
    const r = validateDate('20240403');
    assert.strictEqual(r.is_valid, false);
    assert.ok(r.reason?.includes('YYYY-MM-DD'));
  });
  test('wrong format — slashes', () => {
    const r = validateDate('2024/04/03');
    assert.strictEqual(r.is_valid, false);
  });

  // Step 2: calendar validity
  test('Feb 28 in non-leap year — valid', () =>
    assert.strictEqual(validateDate('2023-02-28').is_valid, true));
  test('Feb 29 in leap year — valid', () =>
    assert.strictEqual(validateDate('2024-02-29').is_valid, true));
  test('Feb 29 in non-leap year — invalid', () => {
    const r = validateDate('2023-02-29');
    assert.strictEqual(r.is_valid, false);
    assert.ok(r.reason?.includes('valid calendar date'));
  });
  test('Month 13 — invalid', () => {
    const r = validateDate('2024-13-01');
    assert.strictEqual(r.is_valid, false);
  });
  test('Day 32 — invalid', () => {
    const r = validateDate('2024-01-32');
    assert.strictEqual(r.is_valid, false);
  });
  test('April 31 — invalid (30 days in April)', () => {
    const r = validateDate('2024-04-31');
    assert.strictEqual(r.is_valid, false);
  });

  test('edge: 2000-01-01 valid', () =>
    assert.strictEqual(validateDate('2000-01-01').is_valid, true));
  test('edge: 9999-12-31 valid', () =>
    assert.strictEqual(validateDate('9999-12-31').is_valid, true));
});

describe('validateString', () => {
  test('any non-empty string passes', () =>
    assert.strictEqual(validateString('Acme Corp').is_valid, true));
  test('single char passes', () =>
    assert.strictEqual(validateString('x').is_valid, true));
  test('empty string fails', () => {
    const r = validateString('');
    assert.strictEqual(r.is_valid, false);
  });
  test('whitespace-only fails', () => {
    const r = validateString('   ');
    assert.strictEqual(r.is_valid, false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. execute() tests
// ════════════════════════════════════════════════════════════════════════════

describe('VALID execute() — RowVerdict deterministic shape (Refinement #1)', () => {
  beforeEach(() => { AUDIT.clear(); CONFIG.reset(); });
  afterEach(() => { AUDIT.clear(); });

  test('every row has exactly one FieldVerdict per schema field', async () => {
    const schemaFields = CONFIG.getTargetSchema().fields;
    const row = makeRow(0, {
      email: 'john@example.com',
      phone_number: '9876543210',
      first_name: 'John',
    });

    const result = await execute([row], CTX);
    assert.strictEqual(result.success, true);

    const verdict = result.data[0];
    assert.strictEqual(verdict.field_verdicts.length, schemaFields.length);

    // Every schema field must be represented
    const returnedFieldNames = verdict.field_verdicts.map((v) => v.field_name);
    for (const f of schemaFields) {
      assert.ok(
        returnedFieldNames.includes(f.id),
        `expected field_verdict for "${f.id}"`
      );
    }
  });

  test('absent optional field produces is_valid:true with "not present" reason', async () => {
    const row = makeRow(0, { email: 'a@b.com' }); // only email, all others absent

    const result = await execute([row], CTX);
    const companyVerdict = result.data[0].field_verdicts.find((v) => v.field_name === 'company');
    assert.ok(companyVerdict);
    assert.strictEqual(companyVerdict.is_valid, true);
    assert.ok(companyVerdict.reason?.includes('not present'));
  });

  test('two rows with different field combinations still have same verdict shape', async () => {
    const schemaFields = CONFIG.getTargetSchema().fields;
    const row1 = makeRow(0, { email: 'a@b.com', first_name: 'Alice' });
    const row2 = makeRow(1, { email: 'c@d.com', company: 'Acme' });

    const result = await execute([row1, row2], CTX);
    assert.strictEqual(result.data[0].field_verdicts.length, schemaFields.length);
    assert.strictEqual(result.data[1].field_verdicts.length, schemaFields.length);
  });
});

describe('VALID execute() — overall_verdict logic', () => {
  beforeEach(() => { AUDIT.clear(); CONFIG.reset(); });
  afterEach(() => { AUDIT.clear(); });

  test('all required fields valid, all optional absent → VALID', async () => {
    const row = makeRow(0, { email: 'john@example.com' });
    const result = await execute([row], CTX);
    assert.strictEqual(result.data[0].overall_verdict, 'VALID');
  });

  test('required email missing → INVALID', async () => {
    const row = makeRow(0, {}); // no email
    const result = await execute([row], CTX);
    assert.strictEqual(result.data[0].overall_verdict, 'INVALID');
  });

  test('required email invalid format → INVALID', async () => {
    const row = makeRow(0, { email: 'not-valid' });
    const result = await execute([row], CTX);
    assert.strictEqual(result.data[0].overall_verdict, 'INVALID');
  });

  test('required email valid, optional phone too short → PARTIAL', async () => {
    const row = makeRow(0, { email: 'a@b.com', phone_number: '12345' }); // < 7 digits
    const result = await execute([row], CTX);
    assert.strictEqual(result.data[0].overall_verdict, 'PARTIAL');
  });

  test('required and optional both fail → INVALID (required failure takes precedence)', async () => {
    const row = makeRow(0, { email: 'bad', phone_number: '12345' });
    const result = await execute([row], CTX);
    assert.strictEqual(result.data[0].overall_verdict, 'INVALID');
  });

  test('execute() returns success:true even when rows are INVALID', async () => {
    const row = makeRow(0, {}); // missing required email
    const result = await execute([row], CTX);
    assert.strictEqual(result.success, true);
  });
});

describe('VALID execute() — required-field authority from schema (Refinement #2)', () => {
  beforeEach(() => { AUDIT.clear(); CONFIG.reset(); });
  afterEach(() => { AUDIT.clear(); });

  test('email is required per target_schema — missing → INVALID', async () => {
    const row = makeRow(0, { first_name: 'Alice' }); // email absent
    const result = await execute([row], CTX);
    const emailVerdict = result.data[0].field_verdicts.find((v) => v.field_name === 'email');
    assert.strictEqual(emailVerdict.is_valid, false);
    assert.ok(emailVerdict.reason?.includes('required'));
    assert.strictEqual(result.data[0].overall_verdict, 'INVALID');
  });

  test('phone is optional per target_schema — missing → VALID row', async () => {
    const row = makeRow(0, { email: 'a@b.com' }); // phone absent
    const result = await execute([row], CTX);
    const phoneVerdict = result.data[0].field_verdicts.find((v) => v.field_name === 'phone_number');
    assert.strictEqual(phoneVerdict.is_valid, true);
    assert.strictEqual(result.data[0].overall_verdict, 'VALID');
  });
});

describe('VALID execute() — XFORM UNRESOLVABLE traceability', () => {
  beforeEach(() => { AUDIT.clear(); CONFIG.reset(); });
  afterEach(() => { AUDIT.clear(); });

  test('UNRESOLVABLE optional field → PARTIAL with tracing reason', async () => {
    const row = makeRow(
      0,
      { email: 'a@b.com', created_date: null },
      { created_date: 'UNRESOLVABLE: ambiguous date format "04/03/2024"' }
    );

    const result = await execute([row], CTX);
    const dateVerdict = result.data[0].field_verdicts.find((v) => v.field_name === 'created_date');
    assert.strictEqual(dateVerdict.is_valid, false);
    assert.ok(dateVerdict.reason?.includes('UNRESOLVABLE'));
    assert.strictEqual(result.data[0].overall_verdict, 'PARTIAL');
  });

  test('UNRESOLVABLE required field → INVALID with tracing reason', async () => {
    // Hypothetical: if email were unresolvable (multi-email → null)
    const row = makeRow(
      0,
      { email: null },
      { email: 'UNRESOLVABLE: multiple email addresses detected' }
    );

    const result = await execute([row], CTX);
    const emailVerdict = result.data[0].field_verdicts.find((v) => v.field_name === 'email');
    assert.strictEqual(emailVerdict.is_valid, false);
    assert.ok(emailVerdict.reason?.includes('UNRESOLVABLE'));
    assert.strictEqual(result.data[0].overall_verdict, 'INVALID');
  });
});

describe('VALID execute() — edge cases', () => {
  beforeEach(() => { AUDIT.clear(); CONFIG.reset(); });
  afterEach(() => { AUDIT.clear(); });

  test('empty NormalizedRow[] → empty RowVerdict[], success:true', async () => {
    const result = await execute([], CTX);
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.data, []);
  });

  test('null input → success:false', async () => {
    const result = await execute(null, CTX);
    assert.strictEqual(result.success, false);
    assert.ok(result.error?.message);
  });

  test('non-array input → success:false', async () => {
    const result = await execute('not an array', CTX);
    assert.strictEqual(result.success, false);
  });

  test('row_index preserved in output', async () => {
    const rows = [
      makeRow(0, { email: 'a@b.com' }),
      makeRow(1, { email: 'c@d.com' }),
      makeRow(2, { email: 'e@f.com' }),
    ];
    const result = await execute(rows, CTX);
    assert.deepStrictEqual(result.data.map((v) => v.row_index), [0, 1, 2]);
  });

  test('identical input → identical output (determinism)', async () => {
    const rows = [makeRow(0, { email: 'a@b.com', first_name: 'Alice' })];
    const r1 = await execute(rows, CTX);
    const r2 = await execute(rows, CTX);
    assert.deepStrictEqual(r1.data, r2.data);
  });
});

describe('VALID execute() — metadata', () => {
  beforeEach(() => { AUDIT.clear(); CONFIG.reset(); });
  afterEach(() => { AUDIT.clear(); });

  test('metadata counts match actual verdicts', async () => {
    const rows = [
      makeRow(0, { email: 'good@b.com' }),            // VALID
      makeRow(1, { email: 'good2@b.com', phone_number: '12' }), // PARTIAL (phone too short)
      makeRow(2, {}),                                  // INVALID (email missing)
    ];

    const result = await execute(rows, CTX);
    assert.strictEqual(result.metadata.processing_stats.rows_processed, 3);
    assert.strictEqual(result.metadata.processing_stats.valid_rows, 1);
    assert.strictEqual(result.metadata.processing_stats.partial_rows, 1);
    assert.strictEqual(result.metadata.processing_stats.invalid_rows, 1);
  });

  test('field_failures count is > 0 when any field fails', async () => {
    const rows = [makeRow(0, {})]; // missing required email
    const result = await execute(rows, CTX);
    assert.ok(result.metadata.processing_stats.field_failures > 0);
  });
});

describe('VALID execute() — AUDIT', () => {
  beforeEach(() => { AUDIT.clear(); CONFIG.reset(); });
  afterEach(() => { AUDIT.clear(); });

  test('writes one summary AUDIT record per execute() call', async () => {
    const rows = [makeRow(0, { email: 'a@b.com' })];
    await execute(rows, CTX);

    const records = AUDIT.query(CTX.import_run_id);
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].subject, 'validation_complete');
    assert.strictEqual(records[0].stage, 'VALIDATING');
  });

  test('AUDIT record keyed to import_run_id from context', async () => {
    const ctx2 = { import_run_id: 'valid-other-002' };
    const rows = [makeRow(0, { email: 'a@b.com' })];

    await execute(rows, CTX);
    await execute(rows, ctx2);

    assert.strictEqual(AUDIT.query(CTX.import_run_id).length, 1);
    assert.strictEqual(AUDIT.query(ctx2.import_run_id).length, 1);
  });
});
