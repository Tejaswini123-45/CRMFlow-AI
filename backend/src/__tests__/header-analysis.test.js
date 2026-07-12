/**
 * Header Analysis (HDRX) Tests
 * Phase 5: Representative sampling, null handling, determinism, AUDIT integration
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

// eslint-disable-next-line no-restricted-imports
import { execute } from '../pipeline/header_analysis/index.js';
import { AUDIT } from '../audit/index.js';
import { CONFIG } from '../config/index.js';

// Helpers
function makeParsedFile(headers, rows) {
  return { headers, rows, row_count: rows.length, encoding: 'utf8', delimiter: ',' };
}

const CONTEXT = { import_run_id: 'test-hdrx-001' };

describe('HDRX — Input Validation', () => {
  beforeEach(() => { AUDIT.clear(); CONFIG.reset(); });
  afterEach(() => { AUDIT.clear(); });

  test('should return error for null input', async () => {
    const result = await execute(null, CONTEXT);
    assert.strictEqual(result.success, false);
    assert.ok(result.error.message);
  });

  test('should return error when headers is missing', async () => {
    const result = await execute({ rows: [] }, CONTEXT);
    assert.strictEqual(result.success, false);
  });

  test('should return error when rows is missing', async () => {
    const result = await execute({ headers: ['Name'] }, CONTEXT);
    assert.strictEqual(result.success, false);
  });

  test('should return error when headers array is empty', async () => {
    const result = await execute(makeParsedFile([], []), CONTEXT);
    assert.strictEqual(result.success, false);
    assert.ok(result.error.message.includes('no headers'));
  });
});

describe('HDRX — Profile completeness', () => {
  beforeEach(() => { AUDIT.clear(); CONFIG.reset(); });
  afterEach(() => { AUDIT.clear(); });

  test('should produce one profile per column', async () => {
    const file = makeParsedFile(
      ['Name', 'Email', 'Phone'],
      [
        ['Alice', 'alice@example.com', '111'],
        ['Bob', 'bob@example.com', '222'],
      ]
    );
    const result = await execute(file, CONTEXT);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.length, 3);
  });

  test('should preserve column_index matching header position', async () => {
    const file = makeParsedFile(['A', 'B', 'C'], [['1', '2', '3']]);
    const result = await execute(file, CONTEXT);
    assert.strictEqual(result.success, true);
    result.data.forEach((profile, i) => {
      assert.strictEqual(profile.column_index, i);
      assert.strictEqual(profile.header, ['A', 'B', 'C'][i]);
    });
  });

  test('should preserve header value exactly — no normalization', async () => {
    const headers = ['  First Name  ', 'EMAIL', ' Phone # '];
    const file = makeParsedFile(headers, [['Alice', 'alice@x.com', '111']]);
    const result = await execute(file, CONTEXT);
    assert.strictEqual(result.success, true);
    result.data.forEach((profile, i) => {
      assert.strictEqual(profile.header, headers[i]);
    });
  });

  test('should handle single-column file', async () => {
    const file = makeParsedFile(['Name'], [['Alice'], ['Bob'], ['Carol']]);
    const result = await execute(file, CONTEXT);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.length, 1);
    assert.strictEqual(result.data[0].column_index, 0);
  });

  test('should handle file with headers only and zero data rows', async () => {
    const file = makeParsedFile(['Name', 'Email'], []);
    const result = await execute(file, CONTEXT);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.length, 2);
    result.data.forEach(profile => {
      assert.deepStrictEqual(profile.sample_values, []);
    });
  });
});

describe('HDRX — Representative sampling (AES §12)', () => {
  beforeEach(() => { AUDIT.clear(); CONFIG.reset(); });
  afterEach(() => { AUDIT.clear(); });

  test('should favor distinct values over first-N rows', async () => {
    // First 10 rows are all 'foo'; rows 11+ have distinct values
    const rows = [];
    for (let i = 0; i < 10; i++) rows.push(['foo']);
    rows.push(['alpha']);
    rows.push(['beta']);
    rows.push(['gamma']);

    CONFIG._setForTesting('header_analysis_sample_size', 3);
    const file = makeParsedFile(['Col'], rows);
    const result = await execute(file, CONTEXT);

    assert.strictEqual(result.success, true);
    const samples = result.data[0].sample_values;
    // Should pick 3 distinct values: foo, alpha, beta (first 3 distinct in order)
    assert.strictEqual(samples.length, 3);
    assert.ok(samples.includes('foo'));
    assert.ok(samples.includes('alpha'));
    assert.ok(samples.includes('beta'));
    // gamma should NOT be in the sample (already have 3 distinct)
    assert.ok(!samples.includes('gamma'));
  });

  test('should cap sample at CONFIG.getSampleSize()', async () => {
    CONFIG._setForTesting('header_analysis_sample_size', 3);
    const rows = [['a'], ['b'], ['c'], ['d'], ['e'], ['f'], ['g']];
    const file = makeParsedFile(['Col'], rows);
    const result = await execute(file, CONTEXT);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data[0].sample_values.length, 3);
  });

  test('should return all distinct values when fewer than sample size', async () => {
    CONFIG._setForTesting('header_analysis_sample_size', 10);
    const rows = [['a'], ['b'], ['c']]; // only 3 distinct
    const file = makeParsedFile(['Col'], rows);
    const result = await execute(file, CONTEXT);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data[0].sample_values.length, 3);
  });

  test('should skip null values in sampling', async () => {
    CONFIG._setForTesting('header_analysis_sample_size', 5);
    const rows = [[null], [null], ['alpha'], [null], ['beta']];
    const file = makeParsedFile(['Col'], rows);
    const result = await execute(file, CONTEXT);
    assert.strictEqual(result.success, true);
    const samples = result.data[0].sample_values;
    assert.ok(!samples.includes(null));
    assert.ok(samples.includes('alpha'));
    assert.ok(samples.includes('beta'));
  });

  test('should skip undefined values in sampling', async () => {
    const rows = [[undefined], ['alpha'], [undefined]];
    const file = makeParsedFile(['Col'], rows);
    const result = await execute(file, CONTEXT);
    assert.strictEqual(result.success, true);
    const samples = result.data[0].sample_values;
    assert.ok(!samples.includes(undefined));
  });

  test('should skip blank/whitespace-only values in sampling', async () => {
    const rows = [['  '], [''], ['\t'], ['alpha']];
    const file = makeParsedFile(['Col'], rows);
    const result = await execute(file, CONTEXT);
    assert.strictEqual(result.success, true);
    const samples = result.data[0].sample_values;
    assert.ok(samples.includes('alpha'));
    assert.ok(!samples.includes(''));
    assert.ok(!samples.includes('  '));
  });

  test('should deduplicate using trimmed comparison but preserve original value', async () => {
    // 'alice' and ' alice' are the same after trim — only first should appear
    const rows = [['alice'], [' alice'], ['  alice  '], ['bob']];
    CONFIG._setForTesting('header_analysis_sample_size', 10);
    const file = makeParsedFile(['Col'], rows);
    const result = await execute(file, CONTEXT);
    assert.strictEqual(result.success, true);
    const samples = result.data[0].sample_values;

    // 'alice' (first occurrence) and 'bob' — duplicates trimmed out
    assert.strictEqual(samples.length, 2);
    assert.strictEqual(samples[0], 'alice'); // original value preserved
    assert.ok(samples.includes('bob'));
    // ' alice' and '  alice  ' should NOT appear
    assert.ok(!samples.includes(' alice'));
    assert.ok(!samples.includes('  alice  '));
  });

  test('should return original value with internal spaces preserved', async () => {
    // 'New York' has internal space — must not be changed
    const rows = [['New York'], ['Los Angeles'], ['Chicago']];
    const file = makeParsedFile(['City'], rows);
    const result = await execute(file, CONTEXT);
    assert.strictEqual(result.success, true);
    const samples = result.data[0].sample_values;
    assert.ok(samples.includes('New York'));   // not 'New York' trimmed differently
    assert.ok(samples.includes('Los Angeles'));
  });

  test('should preserve insertion order within distinct set', async () => {
    CONFIG._setForTesting('header_analysis_sample_size', 3);
    const rows = [['charlie'], ['alice'], ['bob'], ['alice'], ['delta']];
    const file = makeParsedFile(['Col'], rows);
    const result = await execute(file, CONTEXT);
    assert.strictEqual(result.success, true);
    // First 3 distinct in row order: charlie, alice, bob
    assert.deepStrictEqual(result.data[0].sample_values, ['charlie', 'alice', 'bob']);
  });
});

describe('HDRX — Null column handling (AES §16)', () => {
  beforeEach(() => { AUDIT.clear(); CONFIG.reset(); });
  afterEach(() => { AUDIT.clear(); });

  test('all-null column produces profile with empty sample_values', async () => {
    const file = makeParsedFile(
      ['Name', 'NullCol'],
      [
        ['Alice', null],
        ['Bob', null],
        ['Carol', null],
      ]
    );
    const result = await execute(file, CONTEXT);
    assert.strictEqual(result.success, true);
    // NullCol profile must exist
    const nullProfile = result.data.find(p => p.header === 'NullCol');
    assert.ok(nullProfile, 'Profile for all-null column must exist');
    assert.deepStrictEqual(nullProfile.sample_values, []);
    assert.strictEqual(nullProfile.column_index, 1);
  });

  test('all-blank-string column treated same as all-null', async () => {
    const file = makeParsedFile(['Col'], [[''], ['  '], ['\t'], ['']]);
    const result = await execute(file, CONTEXT);
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.data[0].sample_values, []);
  });

  test('column count is unchanged even when some columns are all-null', async () => {
    const file = makeParsedFile(
      ['A', 'B', 'C'],
      [
        ['val', null, 'other'],
        ['val2', null, 'other2'],
      ]
    );
    const result = await execute(file, CONTEXT);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.length, 3); // All 3 columns present
  });
});

describe('HDRX — Determinism', () => {
  beforeEach(() => { AUDIT.clear(); CONFIG.reset(); });
  afterEach(() => { AUDIT.clear(); });

  test('identical ParsedFile produces identical ColumnProfile[]', async () => {
    const file = makeParsedFile(
      ['Name', 'Email', 'Phone'],
      [
        ['Alice', 'alice@x.com', '111'],
        ['Bob', 'bob@x.com', '222'],
        ['Alice', 'alice@x.com', '333'],
      ]
    );

    AUDIT.clear();
    const result1 = await execute(file, { import_run_id: 'run-a' });
    AUDIT.clear();
    const result2 = await execute(file, { import_run_id: 'run-b' });

    assert.strictEqual(result1.success, true);
    assert.strictEqual(result2.success, true);
    assert.deepStrictEqual(result1.data, result2.data);
  });

  test('same values in different row order produce different (but still deterministic) samples', async () => {
    // Ordering is based on first-occurrence in row order — so row order matters
    const file1 = makeParsedFile(['Col'], [['alpha'], ['beta'], ['gamma']]);
    const file2 = makeParsedFile(['Col'], [['gamma'], ['alpha'], ['beta']]);

    CONFIG._setForTesting('header_analysis_sample_size', 2);

    AUDIT.clear();
    const r1 = await execute(file1, { import_run_id: 'run-a' });
    AUDIT.clear();
    const r2 = await execute(file2, { import_run_id: 'run-b' });

    // Each should be deterministic within itself, but order differs
    assert.deepStrictEqual(r1.data[0].sample_values, ['alpha', 'beta']);
    assert.deepStrictEqual(r2.data[0].sample_values, ['gamma', 'alpha']);
  });
});

describe('HDRX — AUDIT integration', () => {
  beforeEach(() => { AUDIT.clear(); CONFIG.reset(); });
  afterEach(() => { AUDIT.clear(); });

  test('records one entry per column plus a summary entry', async () => {
    const file = makeParsedFile(
      ['Name', 'Email'],
      [['Alice', 'alice@x.com'], ['Bob', 'bob@x.com']]
    );
    await execute(file, CONTEXT);

    const records = AUDIT.query(CONTEXT.import_run_id);
    // 2 column records + 1 summary = 3
    assert.strictEqual(records.length, 3);
  });

  test('each column record has correct stage and subject', async () => {
    const file = makeParsedFile(['Name', 'Email'], [['Alice', 'alice@x.com']]);
    await execute(file, CONTEXT);

    const records = AUDIT.query(CONTEXT.import_run_id);
    const columnRecords = records.filter(r => r.subject !== 'profiling_complete');

    assert.strictEqual(columnRecords.length, 2);
    columnRecords.forEach(r => {
      assert.strictEqual(r.stage, 'HEADERS_EXTRACTED');
      assert.ok(['Name', 'Email'].includes(r.subject));
      assert.ok(r.decision);
      assert.ok(r.rationale);
      assert.ok(r.timestamp instanceof Date);
    });
  });

  test('summary record reports correct column count', async () => {
    const file = makeParsedFile(['A', 'B', 'C'], [['1', '2', '3']]);
    await execute(file, CONTEXT);

    const records = AUDIT.query(CONTEXT.import_run_id);
    const summary = records.find(r => r.subject === 'profiling_complete');

    assert.ok(summary);
    assert.ok(summary.decision.includes('3 columns'));
    assert.ok(summary.rationale.includes('sample_size='));
  });
});

describe('HDRX — Metadata', () => {
  beforeEach(() => { AUDIT.clear(); CONFIG.reset(); });
  afterEach(() => { AUDIT.clear(); });

  test('returns correct columns_detected in metadata', async () => {
    const file = makeParsedFile(['A', 'B', 'C'], [['1', '2', '3']]);
    const result = await execute(file, CONTEXT);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.metadata.processing_stats.columns_detected, 3);
  });
});

describe('HDRX — Integration with INGEST output', () => {
  beforeEach(() => { AUDIT.clear(); CONFIG.reset(); });
  afterEach(() => { AUDIT.clear(); });

  test('correctly profiles a realistic CSV-shaped ParsedFile', async () => {
    // Simulate the shape that Phase 4 INGEST produces
    const parsedFile = {
      headers: ['Full Name', 'Email Address', 'Phone', 'Company Name', 'Job Title'],
      rows: [
        ['John Doe', 'john@acme.com', '+1-555-0100', 'Acme Corp', 'Manager'],
        ['Jane Smith', 'jane@techco.com', '+1-555-0101', 'TechCo', 'Director'],
        ['Bob Johnson', 'bob@startup.io', '+1-555-0102', 'StartupXYZ', 'CEO'],
        ['Alice Williams', 'alice@ent.com', '+1-555-0103', 'Enterprise Inc', 'VP'],
        ['John Doe', 'john2@acme.com', '+1-555-0104', 'Acme Corp', 'Engineer'],
      ],
      row_count: 5,
      encoding: 'utf8',
      delimiter: ',',
    };

    const result = await execute(parsedFile, CONTEXT);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.length, 5);

    // Headers preserved exactly
    assert.strictEqual(result.data[0].header, 'Full Name');
    assert.strictEqual(result.data[1].header, 'Email Address');

    // Sample values are present (non-empty columns)
    assert.ok(result.data[0].sample_values.length > 0);
    assert.ok(result.data[1].sample_values.length > 0);

    // Duplicate 'John Doe' only counted once
    const nameSamples = result.data[0].sample_values;
    const johnCount = nameSamples.filter(v => v === 'John Doe').length;
    assert.strictEqual(johnCount, 1);

    // Column indices correct
    result.data.forEach((profile, i) => {
      assert.strictEqual(profile.column_index, i);
    });
  });
});
