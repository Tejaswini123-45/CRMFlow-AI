/**
 * Duplicate Detection (DEDUPE) Component Tests
 * Phase 10/13 — LLD §2.8, LLD §13 (Extension Points)
 *
 * Tests:
 * - In-file exact-match duplicate detection
 * - Against-existing-data duplicate detection
 * - Matcher interface swappability (LLD §13 extension point)
 * - INVALID row handling (skipped)
 * - Key field configuration
 * - Audit trail generation
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
// eslint-disable-next-line no-restricted-imports
import DEDUPE, { noopExistingRecordIndex } from '../pipeline/duplicate_detection/index.js';
import { AUDIT } from '../audit/index.js';
import { CONFIG } from '../config/index.js';

describe('DEDUPE — Duplicate Detection Component', () => {
  beforeEach(() => {
    AUDIT._clearForTesting();
    CONFIG._setForTesting('dedupe_key_fields', ['email', 'phone_number']);
  });

  describe('Input Validation', () => {
    it('should reject invalid input', async () => {
      const result = await DEDUPE.execute(null, { import_run_id: 'test-001' });
      assert.equal(result.success, false);
      assert.ok(result.error.message.includes('invalid input'));
    });

    it('should reject missing rowVerdicts', async () => {
      const result = await DEDUPE.execute(
        { normalizedRows: [] },
        { import_run_id: 'test-001' }
      );
      assert.equal(result.success, false);
      assert.ok(result.error.message.includes('invalid rowVerdicts'));
    });

    it('should reject missing normalizedRows', async () => {
      const result = await DEDUPE.execute(
        { rowVerdicts: [] },
        { import_run_id: 'test-001' }
      );
      assert.equal(result.success, false);
      assert.ok(result.error.message.includes('invalid normalizedRows'));
    });
  });

  describe('In-File Duplicate Detection', () => {
    it('should detect email duplicates within file', async () => {
      const rowVerdicts = [
        { row_index: 0, overall_verdict: 'VALID' },
        { row_index: 1, overall_verdict: 'VALID' },
        { row_index: 2, overall_verdict: 'VALID' },
      ];

      const normalizedRows = [
        { row_index: 0, fields: { email: 'alice@example.com', phone_number: '5551234567' } },
        { row_index: 1, fields: { email: 'bob@example.com', phone_number: '5559876543' } },
        { row_index: 2, fields: { email: 'alice@example.com', phone_number: '5551111111' } }, // Duplicate email
      ];

      const result = await DEDUPE.execute(
        { rowVerdicts, normalizedRows },
        { import_run_id: 'test-001' }
      );

      assert.equal(result.success, true);
      assert.equal(result.data.length, 3);

      // Row 0: anchor (first occurrence)
      assert.equal(result.data[0].is_duplicate, false);
      assert.equal(result.data[0].match_type, 'NONE');

      // Row 1: unique
      assert.equal(result.data[1].is_duplicate, false);

      // Row 2: duplicate of row 0 (same email)
      assert.equal(result.data[2].is_duplicate, true);
      assert.equal(result.data[2].match_type, 'EXACT');
      assert.deepEqual(result.data[2].matched_fields, ['email']);
      assert.equal(result.data[2].matched_against, 'row_0');
    });

    it('should detect phone number duplicates within file', async () => {
      const rowVerdicts = [
        { row_index: 0, overall_verdict: 'VALID' },
        { row_index: 1, overall_verdict: 'VALID' },
      ];

      const normalizedRows = [
        { row_index: 0, fields: { email: 'alice@example.com', phone_number: '5551234567' } },
        { row_index: 1, fields: { email: 'bob@example.com', phone_number: '5551234567' } }, // Duplicate phone
      ];

      const result = await DEDUPE.execute(
        { rowVerdicts, normalizedRows },
        { import_run_id: 'test-001' }
      );

      assert.equal(result.success, true);
      assert.equal(result.data[1].is_duplicate, true);
      assert.deepEqual(result.data[1].matched_fields, ['phone_number']);
      assert.equal(result.data[1].matched_against, 'row_0');
    });

    it('should use OR semantics (any key field match triggers duplicate)', async () => {
      const rowVerdicts = [
        { row_index: 0, overall_verdict: 'VALID' },
        { row_index: 1, overall_verdict: 'VALID' },
      ];

      const normalizedRows = [
        { row_index: 0, fields: { email: 'alice@example.com', phone_number: '5551234567' } },
        { row_index: 1, fields: { email: 'alice@example.com', phone_number: '9999999999' } }, // Same email, different phone
      ];

      const result = await DEDUPE.execute(
        { rowVerdicts, normalizedRows },
        { import_run_id: 'test-001' }
      );

      assert.equal(result.success, true);
      assert.equal(result.data[1].is_duplicate, true);
      assert.deepEqual(result.data[1].matched_fields, ['email']);
    });

    it('should handle null/undefined key field values (not matchable)', async () => {
      const rowVerdicts = [
        { row_index: 0, overall_verdict: 'VALID' },
        { row_index: 1, overall_verdict: 'VALID' },
      ];

      const normalizedRows = [
        { row_index: 0, fields: { email: null, phone_number: '5551234567' } },
        { row_index: 1, fields: { email: null, phone_number: '5559876543' } },
      ];

      const result = await DEDUPE.execute(
        { rowVerdicts, normalizedRows },
        { import_run_id: 'test-001' }
      );

      assert.equal(result.success, true);
      // Both rows have null emails, but null is not matchable
      assert.equal(result.data[0].is_duplicate, false);
      assert.equal(result.data[1].is_duplicate, false);
    });

    it('should anchor on first occurrence (first wins)', async () => {
      const rowVerdicts = [
        { row_index: 0, overall_verdict: 'VALID' },
        { row_index: 1, overall_verdict: 'VALID' },
        { row_index: 2, overall_verdict: 'VALID' },
      ];

      const normalizedRows = [
        { row_index: 0, fields: { email: 'alice@example.com', phone_number: null } },
        { row_index: 1, fields: { email: 'alice@example.com', phone_number: null } },
        { row_index: 2, fields: { email: 'alice@example.com', phone_number: null } },
      ];

      const result = await DEDUPE.execute(
        { rowVerdicts, normalizedRows },
        { import_run_id: 'test-001' }
      );

      assert.equal(result.success, true);
      // Row 0 is anchor
      assert.equal(result.data[0].is_duplicate, false);
      // Rows 1 and 2 are duplicates of row 0
      assert.equal(result.data[1].is_duplicate, true);
      assert.equal(result.data[1].matched_against, 'row_0');
      assert.equal(result.data[2].is_duplicate, true);
      assert.equal(result.data[2].matched_against, 'row_0');
    });
  });

  describe('Against-Existing-Data Duplicate Detection', () => {
    it('should detect duplicates against existing records', async () => {
      const rowVerdicts = [
        { row_index: 0, overall_verdict: 'VALID' },
      ];

      const normalizedRows = [
        { row_index: 0, fields: { email: 'existing@example.com', phone_number: '5551234567' } },
      ];

      // Mock existing record index
      const mockExistingIndex = {
        lookup: (field, value) => {
          if (field === 'email' && value === 'existing@example.com') {
            return 'existing_record_12345';
          }
          return null;
        },
      };

      const result = await DEDUPE.execute(
        { rowVerdicts, normalizedRows, existingRecordIndex: mockExistingIndex },
        { import_run_id: 'test-001' }
      );

      assert.equal(result.success, true);
      assert.equal(result.data[0].is_duplicate, true);
      assert.equal(result.data[0].match_type, 'EXACT');
      assert.deepEqual(result.data[0].matched_fields, ['email']);
      assert.equal(result.data[0].matched_against, 'existing_record_12345');
    });

    it('should prioritize existing records over in-file matches', async () => {
      const rowVerdicts = [
        { row_index: 0, overall_verdict: 'VALID' },
        { row_index: 1, overall_verdict: 'VALID' },
      ];

      const normalizedRows = [
        { row_index: 0, fields: { email: 'duplicate@example.com', phone_number: null } },
        { row_index: 1, fields: { email: 'duplicate@example.com', phone_number: null } },
      ];

      // Mock existing record index
      const mockExistingIndex = {
        lookup: (field, value) => {
          if (field === 'email' && value === 'duplicate@example.com') {
            return 'existing_record_999';
          }
          return null;
        },
      };

      const result = await DEDUPE.execute(
        { rowVerdicts, normalizedRows, existingRecordIndex: mockExistingIndex },
        { import_run_id: 'test-001' }
      );

      assert.equal(result.success, true);
      // Both rows match existing record
      assert.equal(result.data[0].is_duplicate, true);
      assert.equal(result.data[0].matched_against, 'existing_record_999');
      assert.equal(result.data[1].is_duplicate, true);
      assert.equal(result.data[1].matched_against, 'existing_record_999');
    });
  });

  describe('INVALID Row Handling', () => {
    it('should skip INVALID rows (not check for duplication)', async () => {
      const rowVerdicts = [
        { row_index: 0, overall_verdict: 'VALID' },
        { row_index: 1, overall_verdict: 'INVALID' },
        { row_index: 2, overall_verdict: 'VALID' },
      ];

      const normalizedRows = [
        { row_index: 0, fields: { email: 'alice@example.com', phone_number: null } },
        { row_index: 1, fields: { email: 'alice@example.com', phone_number: null } }, // INVALID but same email
        { row_index: 2, fields: { email: 'alice@example.com', phone_number: null } }, // Duplicate
      ];

      const result = await DEDUPE.execute(
        { rowVerdicts, normalizedRows },
        { import_run_id: 'test-001' }
      );

      assert.equal(result.success, true);

      // Row 0: anchor
      assert.equal(result.data[0].is_duplicate, false);

      // Row 1: INVALID - not checked, marked as not duplicate
      assert.equal(result.data[1].is_duplicate, false);
      assert.equal(result.data[1].match_type, 'NONE');

      // Row 2: duplicate of row 0 (row 1 was skipped)
      assert.equal(result.data[2].is_duplicate, true);
      assert.equal(result.data[2].matched_against, 'row_0');

      // Metadata should reflect skipped count
      assert.equal(result.metadata.processing_stats.skipped_invalid, 1);
      assert.equal(result.metadata.processing_stats.rows_checked, 2);
    });
  });

  describe('Matcher Interface Swappability (LLD §13 Extension Point)', () => {
    it('should accept custom matcher implementation', async () => {
      const rowVerdicts = [
        { row_index: 0, overall_verdict: 'VALID' },
        { row_index: 1, overall_verdict: 'VALID' },
      ];

      const normalizedRows = [
        { row_index: 0, fields: { email: 'alice@example.com', phone_number: null } },
        { row_index: 1, fields: { email: 'bob@example.com', phone_number: null } },
      ];

      // Fake test matcher: marks all rows as duplicates
      const fakeMatcherThatMarksAllAsDuplicates = {
        match: (_fields, _keyFields, _seenIndex, _existingIndex) => ({
          isDuplicate: true,
          matchedFields: ['fake_field'],
          matchedAgainst: 'fake_match',
        }),
      };

      const result = await DEDUPE.execute(
        {
          rowVerdicts,
          normalizedRows,
          matcher: fakeMatcherThatMarksAllAsDuplicates,
        },
        { import_run_id: 'test-001' }
      );

      assert.equal(result.success, true);
      // Both rows marked as duplicates by fake matcher
      assert.equal(result.data[0].is_duplicate, true);
      assert.deepEqual(result.data[0].matched_fields, ['fake_field']);
      assert.equal(result.data[0].matched_against, 'fake_match');
      assert.equal(result.data[1].is_duplicate, true);
    });

    it('should use exact-match matcher by default', async () => {
      const rowVerdicts = [
        { row_index: 0, overall_verdict: 'VALID' },
        { row_index: 1, overall_verdict: 'VALID' },
      ];

      const normalizedRows = [
        { row_index: 0, fields: { email: 'alice@example.com', phone_number: null } },
        { row_index: 1, fields: { email: 'alice@example.com', phone_number: null } },
      ];

      // No matcher specified - should use default exact-match
      const result = await DEDUPE.execute(
        { rowVerdicts, normalizedRows },
        { import_run_id: 'test-001' }
      );

      assert.equal(result.success, true);
      assert.equal(result.data[1].is_duplicate, true);
      assert.equal(result.data[1].match_type, 'EXACT');
    });
  });

  describe('Configuration Integration', () => {
    it('should read key fields from CONFIG', async () => {
      CONFIG._setForTesting('dedupe_key_fields', ['email']); // Only email, not phone

      const rowVerdicts = [
        { row_index: 0, overall_verdict: 'VALID' },
        { row_index: 1, overall_verdict: 'VALID' },
      ];

      const normalizedRows = [
        { row_index: 0, fields: { email: 'alice@example.com', phone_number: '5551234567' } },
        { row_index: 1, fields: { email: 'bob@example.com', phone_number: '5551234567' } }, // Same phone, different email
      ];

      const result = await DEDUPE.execute(
        { rowVerdicts, normalizedRows },
        { import_run_id: 'test-001' }
      );

      assert.equal(result.success, true);
      // Row 1 is NOT a duplicate because we only check email (CONFIG)
      assert.equal(result.data[1].is_duplicate, false);
    });
  });

  describe('Audit Trail', () => {
    it('should record deduplication summary in AUDIT', async () => {
      const rowVerdicts = [
        { row_index: 0, overall_verdict: 'VALID' },
        { row_index: 1, overall_verdict: 'VALID' },
        { row_index: 2, overall_verdict: 'INVALID' },
      ];

      const normalizedRows = [
        { row_index: 0, fields: { email: 'alice@example.com', phone_number: null } },
        { row_index: 1, fields: { email: 'alice@example.com', phone_number: null } }, // Duplicate
        { row_index: 2, fields: { email: 'bob@example.com', phone_number: null } }, // INVALID
      ];

      const result = await DEDUPE.execute(
        { rowVerdicts, normalizedRows },
        { import_run_id: 'test-audit-001' }
      );

      assert.equal(result.success, true);

      // Query AUDIT
      const auditRecords = AUDIT.query('test-audit-001', { stage: 'DEDUPING' });
      assert.equal(auditRecords.length, 1);

      const record = auditRecords[0];
      assert.equal(record.stage, 'DEDUPING');
      assert.equal(record.subject, 'deduplication_complete');
      assert.ok(record.decision.includes('2 rows checked'));
      assert.ok(record.decision.includes('1 duplicates found'));
      assert.ok(record.rationale.includes('skipped_invalid=1'));
    });
  });

  describe('Metadata', () => {
    it('should return processing statistics', async () => {
      const rowVerdicts = [
        { row_index: 0, overall_verdict: 'VALID' },
        { row_index: 1, overall_verdict: 'VALID' },
        { row_index: 2, overall_verdict: 'INVALID' },
        { row_index: 3, overall_verdict: 'VALID' },
      ];

      const normalizedRows = [
        { row_index: 0, fields: { email: 'alice@example.com', phone_number: null } },
        { row_index: 1, fields: { email: 'alice@example.com', phone_number: null } }, // Duplicate
        { row_index: 2, fields: { email: 'invalid@example.com', phone_number: null } }, // INVALID
        { row_index: 3, fields: { email: 'bob@example.com', phone_number: null } }, // Unique
      ];

      const result = await DEDUPE.execute(
        { rowVerdicts, normalizedRows },
        { import_run_id: 'test-001' }
      );

      assert.equal(result.success, true);
      assert.deepEqual(result.metadata.processing_stats, {
        rows_checked: 3,
        duplicate_count: 1,
        skipped_invalid: 1,
      });
    });
  });

  describe('NoopExistingRecordIndex', () => {
    it('should return null for all lookups', () => {
      const result = noopExistingRecordIndex.lookup('email', 'test@example.com');
      assert.equal(result, null);

      const result2 = noopExistingRecordIndex.lookup('phone_number', '5551234567');
      assert.equal(result2, null);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty input arrays', async () => {
      const result = await DEDUPE.execute(
        { rowVerdicts: [], normalizedRows: [] },
        { import_run_id: 'test-001' }
      );

      assert.equal(result.success, true);
      assert.equal(result.data.length, 0);
      assert.equal(result.metadata.processing_stats.rows_checked, 0);
    });

    it('should handle rows with missing fields object', async () => {
      const rowVerdicts = [
        { row_index: 0, overall_verdict: 'VALID' },
        { row_index: 1, overall_verdict: 'VALID' },
      ];

      const normalizedRows = [
        { row_index: 0, fields: { email: 'alice@example.com' } },
        { row_index: 1 }, // Missing fields object
      ];

      const result = await DEDUPE.execute(
        { rowVerdicts, normalizedRows },
        { import_run_id: 'test-001' }
      );

      assert.equal(result.success, true);
      assert.equal(result.data[0].is_duplicate, false);
      assert.equal(result.data[1].is_duplicate, false); // No fields to match
    });

    it('should maintain row_index order in output', async () => {
      const rowVerdicts = [
        { row_index: 5, overall_verdict: 'VALID' },
        { row_index: 10, overall_verdict: 'VALID' },
        { row_index: 2, overall_verdict: 'VALID' },
      ];

      const normalizedRows = [
        { row_index: 5, fields: { email: 'alice@example.com' } },
        { row_index: 10, fields: { email: 'bob@example.com' } },
        { row_index: 2, fields: { email: 'charlie@example.com' } },
      ];

      const result = await DEDUPE.execute(
        { rowVerdicts, normalizedRows },
        { import_run_id: 'test-001' }
      );

      assert.equal(result.success, true);
      assert.equal(result.data[0].row_index, 5);
      assert.equal(result.data[1].row_index, 10);
      assert.equal(result.data[2].row_index, 2);
    });
  });
});
