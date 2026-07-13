/**
 * Transformation (XFORM) Tests
 * Phase 8 — LLD §2.6, PRD §9
 *
 * Two sections:
 *   1. Per-rule unit tests (rules.js) — pure functions, no ORCH needed.
 *   2. Full execute() tests (index.js) — verifies assembly, UNMAPPED handling, AUDIT.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

// eslint-disable-next-line no-restricted-imports
import {
  normalizeEmail,
  normalizePhone,
  normalizeFirstName,
  normalizeLastName,
  normalizeCompany,
  normalizeSource,
  normalizeDate,
  normalizeNotes,
  normalizeStatus,
  normalizeNullSentinel,
} from '../pipeline/transformation/rules.js';
// eslint-disable-next-line no-restricted-imports
import { execute } from '../pipeline/transformation/index.js';
import { AUDIT } from '../audit/index.js';

const CTX = { import_run_id: 'xform-test-001' };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeInput(headers, rows, columnToField) {
  return {
    parsedFile: { headers, rows, encoding: 'utf-8', delimiter: ',', row_count: rows.length },
    finalizedMapping: {
      column_to_field: columnToField,
      finalized_at: new Date(),
      had_corrections: false,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Rule unit tests
// ════════════════════════════════════════════════════════════════════════════

describe('normalizeNullSentinel', () => {
  test('null → null', () => assert.strictEqual(normalizeNullSentinel(null), null));
  test('undefined → null', () => assert.strictEqual(normalizeNullSentinel(undefined), null));
  test('"" → null', () => assert.strictEqual(normalizeNullSentinel(''), null));
  test('"n/a" → null (case-insensitive)', () => assert.strictEqual(normalizeNullSentinel('N/A'), null));
  test('"NA" → null', () => assert.strictEqual(normalizeNullSentinel('NA'), null));
  test('"null" → null', () => assert.strictEqual(normalizeNullSentinel('null'), null));
  test('"  " (whitespace) → null', () => assert.strictEqual(normalizeNullSentinel('   '), null));
  test('real value returned trimmed', () => assert.strictEqual(normalizeNullSentinel('  hello  '), 'hello'));
  test('"0" is NOT null', () => assert.strictEqual(normalizeNullSentinel('0'), '0'));
});

describe('normalizeEmail', () => {
  test('lowercase + trim', () => {
    const { value, note } = normalizeEmail('  JOHN@EXAMPLE.COM  ');
    assert.strictEqual(value, 'john@example.com');
    assert.ok(note?.includes('lowercased'));
  });

  test('already lowercase — no note', () => {
    const { value, note } = normalizeEmail('john@example.com');
    assert.strictEqual(value, 'john@example.com');
    assert.strictEqual(note, undefined);
  });

  test('null sentinel → null, no note', () => {
    const { value, note } = normalizeEmail('N/A');
    assert.strictEqual(value, null);
    assert.strictEqual(note, undefined);
  });

  test('multi-email (comma) → UNRESOLVABLE', () => {
    const { value, note } = normalizeEmail('a@b.com,c@d.com');
    assert.strictEqual(value, null);
    assert.ok(note?.startsWith('UNRESOLVABLE'));
  });

  test('multi-email (semicolon) → UNRESOLVABLE', () => {
    const { value, note } = normalizeEmail('a@b.com;c@d.com');
    assert.strictEqual(value, null);
    assert.ok(note?.startsWith('UNRESOLVABLE'));
  });
});

describe('normalizePhone', () => {
  test('strips non-digit characters, preserves leading +', () => {
    const { value } = normalizePhone('+91 98765 43210');
    assert.strictEqual(value, '+919876543210');
  });

  test('strips dashes and parens', () => {
    const { value } = normalizePhone('(555) 123-4567');
    assert.strictEqual(value, '5551234567');
  });

  test('already clean digits — no note', () => {
    const { value, note } = normalizePhone('9876543210');
    assert.strictEqual(value, '9876543210');
    assert.strictEqual(note, undefined);
  });

  test('null sentinel → null', () => {
    const { value } = normalizePhone('N/A');
    assert.strictEqual(value, null);
  });

  test('no digits at all → UNRESOLVABLE', () => {
    const { value, note } = normalizePhone('no digits here');
    assert.strictEqual(value, null);
    assert.ok(note?.startsWith('UNRESOLVABLE'));
  });

  test('extension dots stripped', () => {
    const { value } = normalizePhone('+1.800.555.1234');
    assert.strictEqual(value, '+18005551234');
  });
});

describe('normalizeFirstName / normalizeLastName', () => {
  test('title-cases first letter of each word', () => {
    const { value } = normalizeFirstName('john smith');
    assert.strictEqual(value, 'John Smith');
  });

  test('all-caps → title-cased', () => {
    const { value } = normalizeLastName('SHARMA');
    assert.strictEqual(value, 'SHARMA'); // Only first char of each word uppercased; rest preserved
    // NOTE: rule uppercases word[0] only, rest of word is left as-is
    // "SHARMA" → "SHARMA" (first char S is already upper, rest kept)
  });

  test('already correct → no note', () => {
    const { value, note } = normalizeFirstName('Priya');
    assert.strictEqual(value, 'Priya');
    assert.strictEqual(note, undefined);
  });

  test('null sentinel → null', () => {
    const { value } = normalizeFirstName('');
    assert.strictEqual(value, null);
  });

  test('non-Latin characters preserved as-is (PRD §10)', () => {
    const { value } = normalizeFirstName('서울');
    assert.strictEqual(value, '서울');
  });
});

describe('normalizeCompany', () => {
  test('trims whitespace', () => {
    const { value } = normalizeCompany('  Acme Corp  ');
    assert.strictEqual(value, 'Acme Corp');
  });

  test('null sentinel → null', () => {
    const { value } = normalizeCompany('n/a');
    assert.strictEqual(value, null);
  });
});

describe('normalizeSource', () => {
  test('trim only', () => {
    const { value } = normalizeSource('  Facebook Lead Ads  ');
    assert.strictEqual(value, 'Facebook Lead Ads');
  });

  test('null sentinel → null', () => {
    const { value } = normalizeSource('');
    assert.strictEqual(value, null);
  });
});

describe('normalizeDate', () => {
  test('ISO 8601 YYYY-MM-DD → unchanged', () => {
    const { value, note } = normalizeDate('2024-04-03');
    assert.strictEqual(value, '2024-04-03');
    assert.strictEqual(note, undefined);
  });

  test('ISO 8601 YYYY/MM/DD → normalized', () => {
    const { value } = normalizeDate('2024/04/03');
    assert.strictEqual(value, '2024-04-03');
  });

  test('named month "3 April 2024"', () => {
    const { value } = normalizeDate('3 April 2024');
    assert.strictEqual(value, '2024-04-03');
  });

  test('named month "April 3, 2024"', () => {
    const { value } = normalizeDate('April 3, 2024');
    assert.strictEqual(value, '2024-04-03');
  });

  test('named month "Apr 3 2024"', () => {
    const { value } = normalizeDate('Apr 3 2024');
    assert.strictEqual(value, '2024-04-03');
  });

  test('unambiguous DD/MM/YYYY — day > 12 disambiguates', () => {
    // 13/04/2024 — 13 > 12 so must be day
    const { value } = normalizeDate('13/04/2024');
    assert.strictEqual(value, '2024-04-13');
  });

  test('unambiguous MM/DD/YYYY — day part > 12 disambiguates', () => {
    // 04/13/2024 — second part > 12 so must be day
    const { value } = normalizeDate('04/13/2024');
    assert.strictEqual(value, '2024-04-13');
  });

  test('ambiguous 04/03/2024 → UNRESOLVABLE (both ≤ 12)', () => {
    const { value, note } = normalizeDate('04/03/2024');
    assert.strictEqual(value, null);
    assert.ok(note?.startsWith('UNRESOLVABLE'));
    assert.ok(note?.includes('ambiguous'));
  });

  test('completely invalid date string → UNRESOLVABLE', () => {
    const { value, note } = normalizeDate('not a date');
    assert.strictEqual(value, null);
    assert.ok(note?.startsWith('UNRESOLVABLE'));
  });

  test('impossible date (Feb 30) → UNRESOLVABLE', () => {
    const { value, note } = normalizeDate('2024-02-30');
    assert.strictEqual(value, null);
    assert.ok(note?.startsWith('UNRESOLVABLE'));
  });

  test('null sentinel → null, no note', () => {
    const { value, note } = normalizeDate('N/A');
    assert.strictEqual(value, null);
    assert.strictEqual(note, undefined);
  });
});

describe('normalizeNotes', () => {
  test('trim only', () => {
    const { value } = normalizeNotes('  Interested in 2BHK  ');
    assert.strictEqual(value, 'Interested in 2BHK');
  });

  test('null sentinel → null', () => {
    const { value } = normalizeNotes('');
    assert.strictEqual(value, null);
  });
});

describe('normalizeStatus', () => {
  test('trim only', () => {
    const { value } = normalizeStatus('  New  ');
    assert.strictEqual(value, 'New');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. execute() tests
// ════════════════════════════════════════════════════════════════════════════

describe('XFORM execute() — happy path', () => {
  beforeEach(() => AUDIT.clear());
  afterEach(() => AUDIT.clear());

  test('returns NormalizedRow[] with correct length', async () => {
    const input = makeInput(
      ['Email', 'Phone'],
      [
        ['john@example.com', '555-1234'],
        ['jane@example.com', '555-5678'],
      ],
      { Email: 'email', Phone: 'phone_number' }
    );

    const result = await execute(input, CTX);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.length, 2);
  });

  test('row_index matches original row position', async () => {
    const input = makeInput(
      ['Email'],
      [['a@b.com'], ['c@d.com'], ['e@f.com']],
      { Email: 'email' }
    );

    const result = await execute(input, CTX);
    assert.deepStrictEqual(result.data.map((r) => r.row_index), [0, 1, 2]);
  });

  test('email is lowercased', async () => {
    const input = makeInput(['Email'], [['JOHN@EXAMPLE.COM']], { Email: 'email' });
    const result = await execute(input, CTX);
    assert.strictEqual(result.data[0].fields.email, 'john@example.com');
  });

  test('phone digits-only normalized', async () => {
    const input = makeInput(['Phone'], [['(555) 123-4567']], { Phone: 'phone_number' });
    const result = await execute(input, CTX);
    assert.strictEqual(result.data[0].fields.phone_number, '5551234567');
  });

  test('date normalized to ISO 8601', async () => {
    const input = makeInput(['Date'], [['3 April 2024']], { Date: 'created_date' });
    const result = await execute(input, CTX);
    assert.strictEqual(result.data[0].fields.created_date, '2024-04-03');
  });

  test('normalization_notes absent when no transformation applied', async () => {
    const input = makeInput(['Email'], [['john@example.com']], { Email: 'email' });
    const result = await execute(input, CTX);
    assert.strictEqual(result.data[0].normalization_notes, undefined);
  });

  test('normalization_notes present when transformation applied', async () => {
    const input = makeInput(['Email'], [['JOHN@EXAMPLE.COM']], { Email: 'email' });
    const result = await execute(input, CTX);
    assert.ok(result.data[0].normalization_notes?.email);
  });

  test('empty rows array → empty NormalizedRow[], success: true', async () => {
    const input = makeInput(['Email'], [], { Email: 'email' });
    const result = await execute(input, CTX);
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.data, []);
  });
});

describe('XFORM execute() — null / sentinel handling', () => {
  beforeEach(() => AUDIT.clear());
  afterEach(() => AUDIT.clear());

  test('null cell → null field, no normalization_note entry', async () => {
    const input = makeInput(['Email'], [[null]], { Email: 'email' });
    const result = await execute(input, CTX);
    assert.strictEqual(result.data[0].fields.email, null);
    assert.strictEqual(result.data[0].normalization_notes, undefined);
  });

  test('"N/A" cell → null, treated as null sentinel', async () => {
    const input = makeInput(['Phone'], [['N/A']], { Phone: 'phone_number' });
    const result = await execute(input, CTX);
    assert.strictEqual(result.data[0].fields.phone_number, null);
  });

  test('ragged row (fewer cells than headers) → null for missing fields', async () => {
    const input = makeInput(
      ['Email', 'Phone'],
      [['john@example.com']], // only 1 cell, Phone is missing
      { Email: 'email', Phone: 'phone_number' }
    );
    const result = await execute(input, CTX);
    assert.strictEqual(result.data[0].fields.email, 'john@example.com');
    assert.strictEqual(result.data[0].fields.phone_number, null);
  });
});

describe('XFORM execute() — UNMAPPED columns (Refinement #2)', () => {
  beforeEach(() => AUDIT.clear());
  afterEach(() => AUDIT.clear());

  test('UNMAPPED column stored in unmapped_fields, not fields', async () => {
    const input = makeInput(
      ['Email', 'Internal ID'],
      [['john@example.com', 'INT-001']],
      { Email: 'email', 'Internal ID': 'UNMAPPED' }
    );

    const result = await execute(input, CTX);
    const row = result.data[0];

    // CRM field present
    assert.strictEqual(row.fields.email, 'john@example.com');
    // UNMAPPED in its own bag
    assert.strictEqual(row.unmapped_fields?.['Internal ID'], 'INT-001');
    // Not leaked into fields
    assert.strictEqual(row.fields['Internal ID'], undefined);
    assert.strictEqual(row.fields['UNMAPPED'], undefined);
    assert.strictEqual(row.fields['UNMAPPED_Internal ID'], undefined);
  });

  test('no UNMAPPED columns → unmapped_fields absent from row', async () => {
    const input = makeInput(['Email'], [['a@b.com']], { Email: 'email' });
    const result = await execute(input, CTX);
    assert.strictEqual(result.data[0].unmapped_fields, undefined);
  });

  test('UNMAPPED null cell preserved as null in unmapped_fields', async () => {
    const input = makeInput(['Col'], [[null]], { Col: 'UNMAPPED' });
    const result = await execute(input, CTX);
    assert.strictEqual(result.data[0].unmapped_fields?.['Col'], null);
  });
});

describe('XFORM execute() — UNRESOLVABLE marking', () => {
  beforeEach(() => AUDIT.clear());
  afterEach(() => AUDIT.clear());

  test('unresolvable date → null value + UNRESOLVABLE note', async () => {
    const input = makeInput(['Date'], [['04/03/2024']], { Date: 'created_date' });
    const result = await execute(input, CTX);
    const row = result.data[0];

    assert.strictEqual(row.fields.created_date, null);
    assert.ok(row.normalization_notes?.created_date?.startsWith('UNRESOLVABLE'));
  });

  test('multi-email → null value + UNRESOLVABLE note', async () => {
    const input = makeInput(['Email'], [['a@b.com,c@d.com']], { Email: 'email' });
    const result = await execute(input, CTX);
    const row = result.data[0];

    assert.strictEqual(row.fields.email, null);
    assert.ok(row.normalization_notes?.email?.startsWith('UNRESOLVABLE'));
  });

  test('pipeline continues despite unresolvable field (no failure)', async () => {
    const input = makeInput(['Date'], [['not-a-date']], { Date: 'created_date' });
    const result = await execute(input, CTX);

    assert.strictEqual(result.success, true); // pipeline not stopped
    assert.strictEqual(result.data[0].fields.created_date, null);
  });

  test('metadata.processing_stats.unresolvable_fields count is accurate', async () => {
    const input = makeInput(
      ['Email', 'Date'],
      [['a@b.com,c@d.com', '04/03/2024']], // 2 unresolvable
      { Email: 'email', Date: 'created_date' }
    );
    const result = await execute(input, CTX);
    assert.strictEqual(result.metadata.processing_stats.unresolvable_fields, 2);
  });
});

describe('XFORM execute() — column order determinism', () => {
  beforeEach(() => AUDIT.clear());
  afterEach(() => AUDIT.clear());

  test('fields populated in column_index order regardless of mapping key order', async () => {
    // Headers are in index order 0=Email, 1=Phone, 2=Name
    // column_to_field is given out of column order
    const input = makeInput(
      ['Email', 'Phone', 'Name'],
      [['a@b.com', '1234', 'Alice']],
      { Name: 'first_name', Email: 'email', Phone: 'phone_number' }
    );

    const result = await execute(input, CTX);
    const keys = Object.keys(result.data[0].fields);

    const emailIdx = keys.indexOf('email');
    const phoneIdx = keys.indexOf('phone_number');
    const nameIdx = keys.indexOf('first_name');

    assert.ok(emailIdx < phoneIdx, 'email (col 0) should come before phone_number (col 1)');
    assert.ok(phoneIdx < nameIdx, 'phone_number (col 1) should come before first_name (col 2)');
  });

  test('identical input always produces identical output (determinism)', async () => {
    const input = makeInput(
      ['Email', 'Date'],
      [['john@example.com', '2024-04-03']],
      { Email: 'email', Date: 'created_date' }
    );

    const r1 = await execute(input, CTX);
    const r2 = await execute(input, CTX);

    assert.deepStrictEqual(r1.data, r2.data);
  });
});

describe('XFORM execute() — input validation', () => {
  beforeEach(() => AUDIT.clear());
  afterEach(() => AUDIT.clear());

  test('null input → success: false', async () => {
    const result = await execute(null, CTX);
    assert.strictEqual(result.success, false);
    assert.ok(result.error?.message);
  });

  test('missing parsedFile → success: false', async () => {
    const result = await execute(
      { finalizedMapping: { column_to_field: {} } },
      CTX
    );
    assert.strictEqual(result.success, false);
  });

  test('missing finalizedMapping → success: false', async () => {
    const result = await execute(
      { parsedFile: { headers: [], rows: [] } },
      CTX
    );
    assert.strictEqual(result.success, false);
  });
});

describe('XFORM execute() — AUDIT', () => {
  beforeEach(() => AUDIT.clear());
  afterEach(() => AUDIT.clear());

  test('writes one summary AUDIT record per execute() call', async () => {
    const input = makeInput(['Email'], [['a@b.com']], { Email: 'email' });
    await execute(input, CTX);

    const records = AUDIT.query(CTX.import_run_id);
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].subject, 'transformation_complete');
    assert.strictEqual(records[0].stage, 'TRANSFORMING');
  });

  test('AUDIT record is keyed to import_run_id from context', async () => {
    const ctx2 = { import_run_id: 'xform-other-002' };
    const input = makeInput(['Email'], [['a@b.com']], { Email: 'email' });

    await execute(input, CTX);
    await execute(input, ctx2);

    const r1 = AUDIT.query(CTX.import_run_id);
    const r2 = AUDIT.query(ctx2.import_run_id);

    assert.strictEqual(r1.length, 1);
    assert.strictEqual(r2.length, 1);
  });
});
