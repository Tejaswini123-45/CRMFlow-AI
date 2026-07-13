/**
 * Export Component (EXPORT) Tests
 * Phase 11 — LLD §2.9
 *
 * Tests:
 * - Input validation (null, missing arrays, non-arrays)
 * - Collection consistency check (hard failure on mismatch)
 * - Row classification: ACCEPTED, FLAGGED, SKIPPED, DUPLICATE
 * - DUPLICATE-over-INVALID precedence
 * - Arithmetic invariant: accepted + skipped + flagged + duplicate === total_rows
 * - StandardizedOutput shape and field ordering
 * - ImportSummary shape and counts
 * - summary_reasons (zero-count groups omitted)
 * - output_ref contains import_run_id
 * - AUDIT record written exactly once per execute()
 * - Edge cases: empty input, all-VALID, all-duplicate
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
// eslint-disable-next-line no-restricted-imports
import { execute } from '../pipeline/export/index.js';
import { AUDIT } from '../audit/index.js';
import { CONFIG } from '../config/index.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal NormalizedRow */
function makeRow(row_index, fields = {}) {
  return { row_index, fields };
}

/** Build a RowVerdict */
function makeVerdict(row_index, overall_verdict = 'VALID') {
  return { row_index, overall_verdict, field_verdicts: [] };
}

/** Build a DuplicateVerdict */
function makeDupe(row_index, is_duplicate = false) {
  return { row_index, is_duplicate, match_type: is_duplicate ? 'EXACT' : 'NONE', matched_fields: null, matched_against: null };
}

/** Build a consistent triple for N rows with controllable per-row options.
 *  opts[i] = { verdict: 'VALID'|'PARTIAL'|'INVALID', duplicate: true|false }
 */
function makeTriple(rowCount, opts = []) {
  const normalizedRows = [];
  const rowVerdicts = [];
  const duplicateVerdicts = [];
  for (let i = 0; i < rowCount; i++) {
    const o = opts[i] ?? {};
    normalizedRows.push(makeRow(i, { email: `row${i}@example.com` }));
    rowVerdicts.push(makeVerdict(i, o.verdict ?? 'VALID'));
    duplicateVerdicts.push(makeDupe(i, o.duplicate ?? false));
  }
  return { normalizedRows, rowVerdicts, duplicateVerdicts };
}

const CTX = { import_run_id: 'test-export-001' };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EXPORT — Input Validation', () => {
  beforeEach(() => {
    AUDIT._clearForTesting();
    CONFIG.reset();
  });

  it('null input → success: false', async () => {
    const result = await execute(null, CTX);
    assert.equal(result.success, false);
    assert.ok(result.error.message.includes('invalid input'));
  });

  it('non-object input → success: false', async () => {
    const result = await execute('string', CTX);
    assert.equal(result.success, false);
  });

  it('missing normalizedRows → success: false', async () => {
    const result = await execute({ rowVerdicts: [], duplicateVerdicts: [] }, CTX);
    assert.equal(result.success, false);
    assert.ok(result.error.message.includes('normalizedRows'));
  });

  it('missing rowVerdicts → success: false', async () => {
    const result = await execute({ normalizedRows: [], duplicateVerdicts: [] }, CTX);
    assert.equal(result.success, false);
    assert.ok(result.error.message.includes('rowVerdicts'));
  });

  it('missing duplicateVerdicts → success: false', async () => {
    const result = await execute({ normalizedRows: [], rowVerdicts: [] }, CTX);
    assert.equal(result.success, false);
    assert.ok(result.error.message.includes('duplicateVerdicts'));
  });

  it('non-array normalizedRows → success: false', async () => {
    const result = await execute({ normalizedRows: 'bad', rowVerdicts: [], duplicateVerdicts: [] }, CTX);
    assert.equal(result.success, false);
  });

  it('non-array rowVerdicts → success: false', async () => {
    const result = await execute({ normalizedRows: [], rowVerdicts: null, duplicateVerdicts: [] }, CTX);
    assert.equal(result.success, false);
  });
});

describe('EXPORT — Collection Consistency (hard failure)', () => {
  beforeEach(() => {
    AUDIT._clearForTesting();
    CONFIG.reset();
  });

  it('rowVerdicts missing a row_index present in normalizedRows → success: false', async () => {
    const input = {
      normalizedRows: [makeRow(0), makeRow(1)],
      rowVerdicts: [makeVerdict(0)],          // missing row_index 1
      duplicateVerdicts: [makeDupe(0), makeDupe(1)],
    };
    const result = await execute(input, CTX);
    assert.equal(result.success, false);
    // Size mismatch fires first (2 vs 1); error mentions both counts
    assert.ok(result.error.message.includes('inconsistent') || result.error.message.includes('row_index 1'));
  });

  it('duplicateVerdicts missing a row_index present in normalizedRows → success: false', async () => {
    const input = {
      normalizedRows: [makeRow(0), makeRow(1)],
      rowVerdicts: [makeVerdict(0), makeVerdict(1)],
      duplicateVerdicts: [makeDupe(0)],       // missing row_index 1
    };
    const result = await execute(input, CTX);
    assert.equal(result.success, false);
    // Size mismatch fires first (2 vs 1); error mentions both counts
    assert.ok(result.error.message.includes('inconsistent') || result.error.message.includes('row_index 1'));
  });

  it('same-size arrays but mismatched row_index in rowVerdicts → success: false', async () => {
    const input = {
      normalizedRows: [makeRow(0), makeRow(1)],
      rowVerdicts: [makeVerdict(0), makeVerdict(99)],  // row_index 99 not in normalizedRows
      duplicateVerdicts: [makeDupe(0), makeDupe(1)],
    };
    const result = await execute(input, CTX);
    assert.equal(result.success, false);
    assert.ok(result.error.message.includes('row_index 1'));
    assert.ok(result.error.message.includes('rowVerdicts'));
  });

  it('same-size arrays but mismatched row_index in duplicateVerdicts → success: false', async () => {
    const input = {
      normalizedRows: [makeRow(0), makeRow(1)],
      rowVerdicts: [makeVerdict(0), makeVerdict(1)],
      duplicateVerdicts: [makeDupe(0), makeDupe(99)],  // row_index 99 not in normalizedRows
    };
    const result = await execute(input, CTX);
    assert.equal(result.success, false);
    assert.ok(result.error.message.includes('row_index 1'));
    assert.ok(result.error.message.includes('duplicateVerdicts'));
  });

  it('all three have different sizes → success: false with count details', async () => {
    const input = {
      normalizedRows: [makeRow(0), makeRow(1), makeRow(2)],
      rowVerdicts: [makeVerdict(0)],
      duplicateVerdicts: [makeDupe(0), makeDupe(1)],
    };
    const result = await execute(input, CTX);
    assert.equal(result.success, false);
    assert.ok(result.error.message.includes('inconsistent'));
  });

  it('consistent collections with matching row_index set → success: true', async () => {
    const input = makeTriple(2);
    const result = await execute(input, CTX);
    assert.equal(result.success, true);
  });
});

describe('EXPORT — Row Classification: ACCEPTED', () => {
  beforeEach(() => {
    AUDIT._clearForTesting();
    CONFIG.reset();
  });

  it('VALID, non-duplicate row → outcome: ACCEPTED, included in output', async () => {
    const input = makeTriple(1, [{ verdict: 'VALID', duplicate: false }]);
    const result = await execute(input, CTX);
    assert.equal(result.success, true);
    assert.equal(result.data.summary.accepted_count, 1);
    assert.equal(result.data.output.rows.length, 1);
    assert.equal(result.data.output.rows[0].outcome, 'ACCEPTED');
    assert.equal(result.data.output.rows[0].row_index, 0);
  });

  it('fields from NormalizedRow are present in output row', async () => {
    const input = {
      normalizedRows: [{ row_index: 0, fields: { email: 'alice@example.com', phone_number: '5551234567' } }],
      rowVerdicts: [makeVerdict(0, 'VALID')],
      duplicateVerdicts: [makeDupe(0, false)],
    };
    const result = await execute(input, CTX);
    assert.equal(result.success, true);
    assert.equal(result.data.output.rows[0].fields.email, 'alice@example.com');
  });
});

describe('EXPORT — Row Classification: FLAGGED', () => {
  beforeEach(() => {
    AUDIT._clearForTesting();
    CONFIG.reset();
  });

  it('PARTIAL, non-duplicate row → outcome: FLAGGED, included in output', async () => {
    const input = makeTriple(1, [{ verdict: 'PARTIAL', duplicate: false }]);
    const result = await execute(input, CTX);
    assert.equal(result.success, true);
    assert.equal(result.data.summary.flagged_count, 1);
    assert.equal(result.data.summary.accepted_count, 0);
    assert.equal(result.data.output.rows.length, 1);
    assert.equal(result.data.output.rows[0].outcome, 'FLAGGED');
  });
});

describe('EXPORT — Row Classification: SKIPPED', () => {
  beforeEach(() => {
    AUDIT._clearForTesting();
    CONFIG.reset();
  });

  it('INVALID, non-duplicate row → excluded from output, skipped_count increments', async () => {
    const input = makeTriple(1, [{ verdict: 'INVALID', duplicate: false }]);
    const result = await execute(input, CTX);
    assert.equal(result.success, true);
    assert.equal(result.data.summary.skipped_count, 1);
    assert.equal(result.data.output.rows.length, 0);
  });
});

describe('EXPORT — Row Classification: DUPLICATE', () => {
  beforeEach(() => {
    AUDIT._clearForTesting();
    CONFIG.reset();
  });

  it('VALID duplicate → excluded from output, duplicate_count increments', async () => {
    const input = makeTriple(1, [{ verdict: 'VALID', duplicate: true }]);
    const result = await execute(input, CTX);
    assert.equal(result.success, true);
    assert.equal(result.data.summary.duplicate_count, 1);
    assert.equal(result.data.output.rows.length, 0);
  });

  it('INVALID duplicate → classified as DUPLICATE, not SKIPPED (DUPLICATE precedence)', async () => {
    const input = makeTriple(1, [{ verdict: 'INVALID', duplicate: true }]);
    const result = await execute(input, CTX);
    assert.equal(result.success, true);
    assert.equal(result.data.summary.duplicate_count, 1);
    assert.equal(result.data.summary.skipped_count, 0);
  });

  it('PARTIAL duplicate → classified as DUPLICATE, not FLAGGED (DUPLICATE precedence)', async () => {
    const input = makeTriple(1, [{ verdict: 'PARTIAL', duplicate: true }]);
    const result = await execute(input, CTX);
    assert.equal(result.success, true);
    assert.equal(result.data.summary.duplicate_count, 1);
    assert.equal(result.data.summary.flagged_count, 0);
  });
});

describe('EXPORT — Arithmetic Invariant', () => {
  beforeEach(() => {
    AUDIT._clearForTesting();
    CONFIG.reset();
  });

  it('accepted + skipped + flagged + duplicate === total_rows for a mixed set', async () => {
    // 2 ACCEPTED, 1 FLAGGED, 2 SKIPPED, 1 DUPLICATE, 1 INVALID+DUPLICATE → 7 rows
    const input = makeTriple(7, [
      { verdict: 'VALID',   duplicate: false }, // ACCEPTED
      { verdict: 'VALID',   duplicate: false }, // ACCEPTED
      { verdict: 'PARTIAL', duplicate: false }, // FLAGGED
      { verdict: 'INVALID', duplicate: false }, // SKIPPED
      { verdict: 'INVALID', duplicate: false }, // SKIPPED
      { verdict: 'VALID',   duplicate: true  }, // DUPLICATE
      { verdict: 'INVALID', duplicate: true  }, // DUPLICATE (not SKIPPED)
    ]);
    const result = await execute(input, CTX);
    assert.equal(result.success, true);
    const { accepted_count, skipped_count, flagged_count, duplicate_count } = result.data.summary;
    assert.equal(accepted_count + skipped_count + flagged_count + duplicate_count, 7);
    assert.equal(accepted_count, 2);
    assert.equal(flagged_count, 1);
    assert.equal(skipped_count, 2);
    assert.equal(duplicate_count, 2);
  });

  it('metadata.processing_stats totals match summary counts', async () => {
    const input = makeTriple(3, [
      { verdict: 'VALID',   duplicate: false },
      { verdict: 'PARTIAL', duplicate: false },
      { verdict: 'INVALID', duplicate: true  },
    ]);
    const result = await execute(input, CTX);
    assert.equal(result.success, true);
    const stats = result.metadata.processing_stats;
    assert.equal(stats.total_rows, 3);
    assert.equal(stats.accepted_count, result.data.summary.accepted_count);
    assert.equal(stats.skipped_count, result.data.summary.skipped_count);
    assert.equal(stats.flagged_count, result.data.summary.flagged_count);
    assert.equal(stats.duplicate_count, result.data.summary.duplicate_count);
  });
});

describe('EXPORT — StandardizedOutput Shape', () => {
  beforeEach(() => {
    AUDIT._clearForTesting();
    CONFIG.reset();
  });

  it('output has rows, format, generated_at', async () => {
    const input = makeTriple(1);
    const result = await execute(input, CTX);
    assert.equal(result.success, true);
    const output = result.data.output;
    assert.ok(Array.isArray(output.rows));
    assert.equal(output.format, 'JSON');
    assert.ok(output.generated_at instanceof Date);
  });

  it('output row has row_index, fields, outcome', async () => {
    const input = makeTriple(1);
    const result = await execute(input, CTX);
    const row = result.data.output.rows[0];
    assert.ok(Object.prototype.hasOwnProperty.call(row, 'row_index'));
    assert.ok(Object.prototype.hasOwnProperty.call(row, 'fields'));
    assert.ok(Object.prototype.hasOwnProperty.call(row, 'outcome'));
  });

  it('output rows are ordered by schema field order, not raw fields order', async () => {
    // Schema defines email before phone_number
    const input = {
      normalizedRows: [{ row_index: 0, fields: { phone_number: '555', email: 'a@b.com' } }],
      rowVerdicts: [makeVerdict(0, 'VALID')],
      duplicateVerdicts: [makeDupe(0, false)],
    };
    const result = await execute(input, CTX);
    assert.equal(result.success, true);
    const keys = Object.keys(result.data.output.rows[0].fields);
    const emailIdx = keys.indexOf('email');
    const phoneIdx = keys.indexOf('phone_number');
    // Both present
    assert.ok(emailIdx !== -1);
    assert.ok(phoneIdx !== -1);
    // email appears before phone_number in schema order
    assert.ok(emailIdx < phoneIdx);
  });
});

describe('EXPORT — ImportSummary Shape', () => {
  beforeEach(() => {
    AUDIT._clearForTesting();
    CONFIG.reset();
  });

  it('summary has all required fields', async () => {
    const input = makeTriple(1);
    const result = await execute(input, CTX);
    const summary = result.data.summary;
    assert.ok(Object.prototype.hasOwnProperty.call(summary, 'import_run_id'));
    assert.ok(Object.prototype.hasOwnProperty.call(summary, 'accepted_count'));
    assert.ok(Object.prototype.hasOwnProperty.call(summary, 'skipped_count'));
    assert.ok(Object.prototype.hasOwnProperty.call(summary, 'flagged_count'));
    assert.ok(Object.prototype.hasOwnProperty.call(summary, 'duplicate_count'));
    assert.ok(Object.prototype.hasOwnProperty.call(summary, 'summary_reasons'));
    assert.equal(summary.import_run_id, CTX.import_run_id);
  });

  it('summary_reasons entries have reason (string) and count (integer)', async () => {
    const input = makeTriple(2, [
      { verdict: 'VALID', duplicate: false },
      { verdict: 'INVALID', duplicate: false },
    ]);
    const result = await execute(input, CTX);
    for (const entry of result.data.summary.summary_reasons) {
      assert.equal(typeof entry.reason, 'string');
      assert.equal(typeof entry.count, 'number');
      assert.ok(Number.isInteger(entry.count));
      assert.ok(entry.count > 0);
    }
  });

  it('zero-count outcome groups are omitted from summary_reasons', async () => {
    // All rows VALID and unique → only "Valid and unique" reason should appear
    const input = makeTriple(3);
    const result = await execute(input, CTX);
    assert.equal(result.data.summary.summary_reasons.length, 1);
    assert.equal(result.data.summary.summary_reasons[0].reason, 'Valid and unique');
  });

  it('all four reason types present when all four outcomes occur', async () => {
    const input = makeTriple(4, [
      { verdict: 'VALID',   duplicate: false },
      { verdict: 'PARTIAL', duplicate: false },
      { verdict: 'INVALID', duplicate: false },
      { verdict: 'VALID',   duplicate: true  },
    ]);
    const result = await execute(input, CTX);
    assert.equal(result.data.summary.summary_reasons.length, 4);
  });
});

describe('EXPORT — output_ref', () => {
  beforeEach(() => {
    AUDIT._clearForTesting();
    CONFIG.reset();
  });

  it('output_ref contains import_run_id', async () => {
    const input = makeTriple(1);
    const result = await execute(input, CTX);
    assert.ok(result.data.output_ref.includes(CTX.import_run_id));
  });
});

describe('EXPORT — AUDIT Integration', () => {
  beforeEach(() => {
    AUDIT._clearForTesting();
    CONFIG.reset();
  });

  it('writes exactly one AUDIT record per execute() call', async () => {
    const input = makeTriple(2);
    await execute(input, CTX);
    const records = AUDIT.query(CTX.import_run_id, { stage: 'EXPORTING' });
    assert.equal(records.length, 1);
  });

  it('AUDIT record has stage=EXPORTING and subject=export_complete', async () => {
    const input = makeTriple(1);
    await execute(input, CTX);
    const records = AUDIT.query(CTX.import_run_id, { stage: 'EXPORTING' });
    assert.equal(records[0].stage, 'EXPORTING');
    assert.equal(records[0].subject, 'export_complete');
  });

  it('AUDIT decision string contains all four counts', async () => {
    const input = makeTriple(4, [
      { verdict: 'VALID',   duplicate: false },
      { verdict: 'PARTIAL', duplicate: false },
      { verdict: 'INVALID', duplicate: false },
      { verdict: 'VALID',   duplicate: true  },
    ]);
    await execute(input, CTX);
    const record = AUDIT.query(CTX.import_run_id, { stage: 'EXPORTING' })[0];
    assert.ok(record.decision.includes('accepted'));
    assert.ok(record.decision.includes('skipped'));
    assert.ok(record.decision.includes('flagged'));
    assert.ok(record.decision.includes('duplicates'));
  });

  it('AUDIT record is keyed to import_run_id from context', async () => {
    const input = makeTriple(1);
    const ctx = { import_run_id: 'unique-export-run-99' };
    await execute(input, ctx);
    const records = AUDIT.query('unique-export-run-99', { stage: 'EXPORTING' });
    assert.equal(records.length, 1);
  });
});

describe('EXPORT — Edge Cases', () => {
  beforeEach(() => {
    AUDIT._clearForTesting();
    CONFIG.reset();
  });

  it('empty input arrays → all counts zero, success: true', async () => {
    const result = await execute({ normalizedRows: [], rowVerdicts: [], duplicateVerdicts: [] }, CTX);
    assert.equal(result.success, true);
    assert.equal(result.data.summary.accepted_count, 0);
    assert.equal(result.data.summary.skipped_count, 0);
    assert.equal(result.data.summary.flagged_count, 0);
    assert.equal(result.data.summary.duplicate_count, 0);
    assert.equal(result.data.output.rows.length, 0);
    assert.equal(result.data.summary.summary_reasons.length, 0);
    assert.equal(result.metadata.processing_stats.total_rows, 0);
  });

  it('all rows VALID and unique → accepted_count = total, output.rows.length = total', async () => {
    const input = makeTriple(5);
    const result = await execute(input, CTX);
    assert.equal(result.success, true);
    assert.equal(result.data.summary.accepted_count, 5);
    assert.equal(result.data.output.rows.length, 5);
  });

  it('all rows are duplicates → accepted_count = 0, output.rows empty', async () => {
    const input = makeTriple(3, [
      { verdict: 'VALID', duplicate: true },
      { verdict: 'VALID', duplicate: true },
      { verdict: 'VALID', duplicate: true },
    ]);
    const result = await execute(input, CTX);
    assert.equal(result.success, true);
    assert.equal(result.data.summary.duplicate_count, 3);
    assert.equal(result.data.output.rows.length, 0);
  });

  it('row with empty fields object → does not crash, outputs empty fields', async () => {
    const input = {
      normalizedRows: [{ row_index: 0, fields: {} }],
      rowVerdicts: [makeVerdict(0, 'VALID')],
      duplicateVerdicts: [makeDupe(0, false)],
    };
    const result = await execute(input, CTX);
    assert.equal(result.success, true);
    assert.deepEqual(result.data.output.rows[0].fields, {});
  });

  it('row with no fields property → does not crash', async () => {
    const input = {
      normalizedRows: [{ row_index: 0 }],  // no fields property
      rowVerdicts: [makeVerdict(0, 'VALID')],
      duplicateVerdicts: [makeDupe(0, false)],
    };
    const result = await execute(input, CTX);
    assert.equal(result.success, true);
    assert.equal(result.data.summary.accepted_count, 1);
  });

  it('non-sequential row_index values handled correctly', async () => {
    // row_index values need not be 0-based or sequential
    const input = {
      normalizedRows: [makeRow(5), makeRow(10), makeRow(2)],
      rowVerdicts: [makeVerdict(5), makeVerdict(10), makeVerdict(2)],
      duplicateVerdicts: [makeDupe(5), makeDupe(10), makeDupe(2)],
    };
    const result = await execute(input, CTX);
    assert.equal(result.success, true);
    assert.equal(result.data.summary.accepted_count, 3);
    // Output preserves the original row_index values
    const indices = result.data.output.rows.map((r) => r.row_index);
    assert.ok(indices.includes(5));
    assert.ok(indices.includes(10));
    assert.ok(indices.includes(2));
  });
});
