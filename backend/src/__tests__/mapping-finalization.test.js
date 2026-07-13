/**
 * Mapping Finalization (MAPFIN) Tests
 * Phase 7 — LLD §2.5, §6
 *
 * All tests are deterministic. No CONFIG dependency — threshold is a parameter.
 * No LLM calls. AUDIT is cleared before each test suite.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

// eslint-disable-next-line no-restricted-imports
import { route, finalize } from '../pipeline/mapping_finalization/index.js';
import { AUDIT } from '../audit/index.js';

const CTX = { import_run_id: 'mapfin-test-001' };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeProposal(header, targetField, confidence, idx = 0) {
  return {
    column_header: header,
    target_field: targetField,
    confidence,
    rationale: `test rationale for ${header}`,
    column_index: idx,
  };
}

function makeCorrection(header, correctedField) {
  return { column_header: header, corrected_field: correctedField };
}

// ─── route() ─────────────────────────────────────────────────────────────────

describe('MAPFIN route() — partitioning by confidence threshold', () => {
  test('all proposals above threshold → no review required', () => {
    const proposals = [
      makeProposal('Email', 'email', 0.95, 0),
      makeProposal('Phone', 'phone_number', 0.90, 1),
      makeProposal('Name', 'first_name', 0.80, 2),
    ];

    const result = route(proposals, 0.75);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.requires_review, false);
    assert.strictEqual(result.auto_staged.length, 3);
    assert.deepStrictEqual(result.requires_review_columns, []);
  });

  test('all proposals below threshold → all require review', () => {
    const proposals = [
      makeProposal('Email', 'email', 0.5, 0),
      makeProposal('Phone', 'phone_number', 0.6, 1),
    ];

    const result = route(proposals, 0.75);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.requires_review, true);
    assert.strictEqual(result.auto_staged.length, 0);
    assert.strictEqual(result.requires_review_columns.length, 2);
  });

  test('mixed — straddles threshold', () => {
    const proposals = [
      makeProposal('Email', 'email', 0.90, 0),   // above
      makeProposal('Phone', 'phone_number', 0.74, 1), // below
      makeProposal('Name', 'first_name', 0.75, 2),   // exactly at threshold → auto
    ];

    const result = route(proposals, 0.75);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.auto_staged.length, 2);
    assert.strictEqual(result.requires_review_columns.length, 1);
    assert.ok(result.requires_review_columns.includes('Phone'));
    assert.strictEqual(result.requires_review, true);
  });

  test('confidence exactly equal to threshold → auto_staged (not review)', () => {
    // Threshold is the minimum acceptable confidence; equal meets it.
    const proposals = [makeProposal('Email', 'email', 0.75, 0)];
    const result = route(proposals, 0.75);

    assert.strictEqual(result.auto_staged.length, 1);
    assert.strictEqual(result.requires_review, false);
  });

  test('UNMAPPED proposal routes purely by confidence — no content inspection', () => {
    // AES §7 and LLD §2.5 specify confidence-only routing.
    // An UNMAPPED proposal with confidence >= threshold is auto_staged.
    const proposals = [makeProposal('WeirdCol', 'UNMAPPED', 0.90, 0)];
    const result = route(proposals, 0.75);

    assert.strictEqual(result.requires_review, false);
    assert.strictEqual(result.auto_staged.length, 1);
    assert.strictEqual(result.auto_staged[0].target_field, 'UNMAPPED');
  });

  test('UNMAPPED proposal with low confidence routes to review', () => {
    const proposals = [makeProposal('WeirdCol', 'UNMAPPED', 0.10, 0)];
    const result = route(proposals, 0.75);

    assert.strictEqual(result.requires_review, true);
    assert.strictEqual(result.requires_review_columns.length, 1);
  });

  test('empty proposals → no review, empty auto_staged', () => {
    const result = route([], 0.75);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.requires_review, false);
    assert.deepStrictEqual(result.auto_staged, []);
    assert.deepStrictEqual(result.requires_review_columns, []);
  });

  test('null proposals → success: false', () => {
    const result = route(null, 0.75);
    assert.strictEqual(result.success, false);
    assert.ok(result.error?.message);
  });

  test('non-array proposals → success: false', () => {
    const result = route('not an array', 0.75);
    assert.strictEqual(result.success, false);
  });

  test('non-numeric threshold → success: false', () => {
    const proposals = [makeProposal('Email', 'email', 0.9, 0)];
    const result = route(proposals, 'high');
    assert.strictEqual(result.success, false);
    assert.ok(result.error?.message);
  });

  test('NaN threshold → success: false', () => {
    const proposals = [makeProposal('Email', 'email', 0.9, 0)];
    const result = route(proposals, NaN);
    assert.strictEqual(result.success, false);
  });
});

// ─── finalize() ──────────────────────────────────────────────────────────────

describe('MAPFIN finalize() — merge AI proposals with corrections', () => {
  beforeEach(() => { AUDIT.clear(); });
  afterEach(() => { AUDIT.clear(); });

  test('no corrections — AI proposals pass through exactly', async () => {
    const proposals = [
      makeProposal('Email', 'email', 0.95, 0),
      makeProposal('Phone', 'phone_number', 0.90, 1),
      makeProposal('Name', 'first_name', 0.80, 2),
    ];

    const result = await finalize(proposals, [], CTX);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.column_to_field['Email'], 'email');
    assert.strictEqual(result.data.column_to_field['Phone'], 'phone_number');
    assert.strictEqual(result.data.column_to_field['Name'], 'first_name');
    assert.strictEqual(result.data.had_corrections, false);
  });

  test('correction overrides AI proposal for its column', async () => {
    const proposals = [
      makeProposal('Full Name', 'first_name', 0.80, 0),
      makeProposal('Email', 'email', 0.95, 1),
    ];
    const corrections = [makeCorrection('Full Name', 'last_name')];

    const result = await finalize(proposals, corrections, CTX);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.column_to_field['Full Name'], 'last_name'); // corrected
    assert.strictEqual(result.data.column_to_field['Email'], 'email');          // unchanged
    assert.strictEqual(result.data.had_corrections, true);
  });

  test('multiple corrections all take effect', async () => {
    const proposals = [
      makeProposal('Col A', 'first_name', 0.80, 0),
      makeProposal('Col B', 'email', 0.90, 1),
      makeProposal('Col C', 'company', 0.70, 2),
    ];
    const corrections = [
      makeCorrection('Col A', 'last_name'),
      makeCorrection('Col C', 'status'),
    ];

    const result = await finalize(proposals, corrections, CTX);

    assert.strictEqual(result.data.column_to_field['Col A'], 'last_name');
    assert.strictEqual(result.data.column_to_field['Col B'], 'email');  // unchanged
    assert.strictEqual(result.data.column_to_field['Col C'], 'status');
    assert.strictEqual(result.data.had_corrections, true);
  });

  test('correcting to UNMAPPED is valid — user may exclude a column', async () => {
    const proposals = [makeProposal('Internal ID', 'company', 0.60, 0)];
    const corrections = [makeCorrection('Internal ID', 'UNMAPPED')];

    const result = await finalize(proposals, corrections, CTX);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.column_to_field['Internal ID'], 'UNMAPPED');
    assert.strictEqual(result.data.had_corrections, true);
  });

  test('column order follows column_index regardless of input order', async () => {
    const proposals = [
      makeProposal('Third', 'company', 0.90, 2),
      makeProposal('First', 'email', 0.95, 0),
      makeProposal('Second', 'phone_number', 0.85, 1),
    ];

    const result = await finalize(proposals, [], CTX);

    const keys = Object.keys(result.data.column_to_field);
    assert.deepStrictEqual(keys, ['First', 'Second', 'Third']);
  });

  test('empty proposals → empty column_to_field, success: true', async () => {
    const result = await finalize([], [], CTX);

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.data.column_to_field, {});
    assert.strictEqual(result.data.had_corrections, false);
  });

  test('null proposals → success: false', async () => {
    const result = await finalize(null, [], CTX);
    assert.strictEqual(result.success, false);
    assert.ok(result.error?.message);
  });

  test('null corrections treated as empty array', async () => {
    const proposals = [makeProposal('Email', 'email', 0.95, 0)];
    const result = await finalize(proposals, null, CTX);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.had_corrections, false);
  });

  test('finalized_at is a Date', async () => {
    const result = await finalize([makeProposal('Email', 'email', 0.9, 0)], [], CTX);
    assert.ok(result.data.finalized_at instanceof Date);
  });

  test('metadata includes columns_mapped count', async () => {
    const proposals = [
      makeProposal('Email', 'email', 0.9, 0),
      makeProposal('Phone', 'phone_number', 0.85, 1),
    ];
    const result = await finalize(proposals, [], CTX);

    assert.strictEqual(result.metadata.processing_stats.columns_mapped, 2);
  });

  test('metadata includes corrections_applied count', async () => {
    const proposals = [
      makeProposal('Email', 'email', 0.9, 0),
      makeProposal('Phone', 'phone_number', 0.85, 1),
    ];
    const corrections = [makeCorrection('Phone', 'company')];
    const result = await finalize(proposals, corrections, CTX);

    assert.strictEqual(result.metadata.processing_stats.corrections_applied, 1);
  });
});

// ─── AUDIT integration ───────────────────────────────────────────────────────

describe('MAPFIN finalize() — AUDIT records', () => {
  beforeEach(() => { AUDIT.clear(); });
  afterEach(() => { AUDIT.clear(); });

  test('writes one AUDIT record per column plus a summary', async () => {
    const proposals = [
      makeProposal('Email', 'email', 0.95, 0),
      makeProposal('Phone', 'phone_number', 0.80, 1),
    ];

    await finalize(proposals, [], CTX);

    const records = AUDIT.query(CTX.import_run_id);
    // 2 column records + 1 summary = 3
    assert.strictEqual(records.length, 3);
  });

  test('column records use MAPPING_FINALIZED stage', async () => {
    const proposals = [makeProposal('Email', 'email', 0.95, 0)];
    await finalize(proposals, [], CTX);

    const records = AUDIT.query(CTX.import_run_id);
    const colRecords = records.filter((r) => r.subject !== 'finalization_complete');
    assert.ok(colRecords.every((r) => r.stage === 'MAPPING_FINALIZED'));
  });

  test('column record decision is the final chosen field', async () => {
    const proposals = [makeProposal('Full Name', 'first_name', 0.80, 0)];
    const corrections = [makeCorrection('Full Name', 'last_name')];

    await finalize(proposals, corrections, CTX);

    const records = AUDIT.query(CTX.import_run_id);
    const colRecord = records.find((r) => r.subject === 'Full Name');
    assert.strictEqual(colRecord.decision, 'last_name'); // corrected value
  });

  test('corrected column rationale contains human_correction marker', async () => {
    const proposals = [makeProposal('Full Name', 'first_name', 0.80, 0)];
    const corrections = [makeCorrection('Full Name', 'last_name')];

    await finalize(proposals, corrections, CTX);

    const records = AUDIT.query(CTX.import_run_id);
    const colRecord = records.find((r) => r.subject === 'Full Name');
    assert.ok(colRecord.rationale.includes('human_correction'));
  });

  test('summary record is present', async () => {
    const proposals = [makeProposal('Email', 'email', 0.95, 0)];
    await finalize(proposals, [], CTX);

    const records = AUDIT.query(CTX.import_run_id);
    const summary = records.find((r) => r.subject === 'finalization_complete');
    assert.ok(summary);
    assert.ok(summary.decision.includes('1 columns finalized'));
  });

  test('duplicate target-field assignment records an AUDIT warning — no failure', async () => {
    const proposals = [
      makeProposal('First Name', 'email', 0.90, 0),
      makeProposal('Email Address', 'email', 0.95, 1),
    ];

    const result = await finalize(proposals, [], CTX);

    // Pipeline continues — not an error
    assert.strictEqual(result.success, true);

    // Duplicate recorded in AUDIT
    const records = AUDIT.query(CTX.import_run_id);
    const dupRecord = records.find((r) => r.subject === 'duplicate_target_fields');
    assert.ok(dupRecord, 'expected a duplicate_target_fields AUDIT record');
    assert.ok(dupRecord.rationale.includes('email'));
  });

  test('no duplicate AUDIT record when all target fields are unique', async () => {
    const proposals = [
      makeProposal('Email', 'email', 0.95, 0),
      makeProposal('Phone', 'phone_number', 0.85, 1),
    ];

    await finalize(proposals, [], CTX);

    const records = AUDIT.query(CTX.import_run_id);
    const dupRecord = records.find((r) => r.subject === 'duplicate_target_fields');
    assert.strictEqual(dupRecord, undefined);
  });

  test('two columns both UNMAPPED does NOT trigger duplicate warning', async () => {
    // UNMAPPED is explicitly excluded from the duplicate check
    const proposals = [
      makeProposal('ColA', 'UNMAPPED', 0.20, 0),
      makeProposal('ColB', 'UNMAPPED', 0.10, 1),
    ];

    await finalize(proposals, [], CTX);

    const records = AUDIT.query(CTX.import_run_id);
    const dupRecord = records.find((r) => r.subject === 'duplicate_target_fields');
    assert.strictEqual(dupRecord, undefined);
  });

  test('AUDIT records are keyed to import_run_id from context', async () => {
    const ctx2 = { import_run_id: 'other-run-999' };
    const proposals = [makeProposal('Email', 'email', 0.95, 0)];

    await finalize(proposals, [], CTX);
    await finalize(proposals, [], ctx2);

    const run1Records = AUDIT.query(CTX.import_run_id);
    const run2Records = AUDIT.query(ctx2.import_run_id);

    // Each run has its own records
    assert.ok(run1Records.length > 0);
    assert.ok(run2Records.length > 0);
    assert.ok(run1Records.every((r) => r.import_run_id === CTX.import_run_id));
    assert.ok(run2Records.every((r) => r.import_run_id === ctx2.import_run_id));
  });
});
