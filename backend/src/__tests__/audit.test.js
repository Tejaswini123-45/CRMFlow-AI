/**
 * Audit Logger Tests
 * Phase 2 - Validates AUDIT record() and query() functionality
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { AUDIT, count, clear } from '../audit/index.js';
import { PipelineStateEnum } from '../contracts/types.js';

describe('AUDIT Logger (LLD §11)', () => {
  beforeEach(() => {
    clear(); // Clear all records before each test
  });

  describe('record() - Write Operations', () => {
    test('should record a decision successfully', () => {
      const result = AUDIT.record({
        import_run_id: 'test-import-1',
        stage: PipelineStateEnum.MAPPING_IN_PROGRESS,
        subject: 'email_column',
        decision: 'mapped to email field',
        confidence: 0.95,
        rationale: 'Header matches known pattern',
      });

      assert.strictEqual(result.success, true);
    });

    test('should auto-generate timestamp if not provided', () => {
      const before = new Date();

      AUDIT.record({
        import_run_id: 'test-import-1',
        stage: PipelineStateEnum.MAPPING_IN_PROGRESS,
        subject: 'test',
        decision: 'test decision',
      });

      const after = new Date();
      const records = AUDIT.query('test-import-1');

      assert.ok(records[0].timestamp !== undefined);
      assert.ok(records[0].timestamp.getTime() >= before.getTime());
      assert.ok(records[0].timestamp.getTime() <= after.getTime());
    });

    test('should throw error for missing required fields', () => {
      assert.throws(
        () =>
          AUDIT.record({
            import_run_id: 'test-import-1',
            // missing stage, subject, decision
          }),
        /DecisionRecord missing required fields/
      );
    });

    test('should accept nullable confidence and rationale', () => {
      const result = AUDIT.record({
        import_run_id: 'test-import-1',
        stage: PipelineStateEnum.VALIDATING,
        subject: 'row_42',
        decision: 'invalid',
        confidence: null,
        rationale: null,
      });

      assert.strictEqual(result.success, true);

      const records = AUDIT.query('test-import-1');
      assert.strictEqual(records[0].confidence, null);
      assert.strictEqual(records[0].rationale, null);
    });
  });

  describe('query() - Read Operations', () => {
    beforeEach(() => {
      // Seed test data
      AUDIT.record({
        import_run_id: 'import-1',
        stage: PipelineStateEnum.PARSING,
        subject: 'file',
        decision: 'parsed successfully',
      });

      AUDIT.record({
        import_run_id: 'import-1',
        stage: PipelineStateEnum.MAPPING_IN_PROGRESS,
        subject: 'column_1',
        decision: 'mapped to email',
        confidence: 0.9,
      });

      AUDIT.record({
        import_run_id: 'import-1',
        stage: PipelineStateEnum.MAPPING_IN_PROGRESS,
        subject: 'column_2',
        decision: 'mapped to phone',
        confidence: 0.85,
      });

      AUDIT.record({
        import_run_id: 'import-2',
        stage: PipelineStateEnum.VALIDATING,
        subject: 'row_1',
        decision: 'valid',
      });
    });

    test('should retrieve all records for an import_run_id', () => {
      const records = AUDIT.query('import-1');
      assert.strictEqual(records.length, 3);
    });

    test('should return empty array for non-existent import_run_id', () => {
      const records = AUDIT.query('nonexistent');
      assert.deepStrictEqual(records, []);
    });

    test('should return records in chronological order', () => {
      const records = AUDIT.query('import-1');

      assert.strictEqual(records[0].stage, PipelineStateEnum.PARSING);
      assert.strictEqual(records[1].stage, PipelineStateEnum.MAPPING_IN_PROGRESS);
      assert.strictEqual(records[2].stage, PipelineStateEnum.MAPPING_IN_PROGRESS);

      // Verify timestamps are in order
      assert.ok(records[0].timestamp.getTime() <= records[1].timestamp.getTime());
      assert.ok(records[1].timestamp.getTime() <= records[2].timestamp.getTime());
    });

    test('should isolate records between different import_run_ids', () => {
      const import1Records = AUDIT.query('import-1');
      const import2Records = AUDIT.query('import-2');

      assert.strictEqual(import1Records.length, 3);
      assert.strictEqual(import2Records.length, 1);

      // No cross-contamination
      assert.strictEqual(
        import1Records.every((r) => r.import_run_id === 'import-1'),
        true
      );
      assert.strictEqual(
        import2Records.every((r) => r.import_run_id === 'import-2'),
        true
      );
    });

    test('should throw error if import_run_id is missing', () => {
      assert.throws(() => AUDIT.query(), /import_run_id is required/);
      assert.throws(() => AUDIT.query(null), /import_run_id is required/);
      assert.throws(() => AUDIT.query(''), /import_run_id is required/);
    });
  });

  describe('query() - Filtering (LLD §11 Design Constraint)', () => {
    beforeEach(() => {
      // Seed test data with multiple stages
      AUDIT.record({
        import_run_id: 'import-1',
        stage: PipelineStateEnum.PARSING,
        subject: 'file',
        decision: 'parsed',
      });

      AUDIT.record({
        import_run_id: 'import-1',
        stage: PipelineStateEnum.MAPPING_IN_PROGRESS,
        subject: 'column_1',
        decision: 'mapped',
      });

      AUDIT.record({
        import_run_id: 'import-1',
        stage: PipelineStateEnum.MAPPING_IN_PROGRESS,
        subject: 'column_2',
        decision: 'mapped',
      });

      AUDIT.record({
        import_run_id: 'import-1',
        stage: PipelineStateEnum.VALIDATING,
        subject: 'row_1',
        decision: 'valid',
      });
    });

    test('should filter by stage', () => {
      const mappingRecords = AUDIT.query('import-1', {
        stage: PipelineStateEnum.MAPPING_IN_PROGRESS,
      });

      assert.strictEqual(mappingRecords.length, 2);
      assert.strictEqual(
        mappingRecords.every((r) => r.stage === PipelineStateEnum.MAPPING_IN_PROGRESS),
        true
      );
    });

    test('should filter by subject', () => {
      const column1Records = AUDIT.query('import-1', { subject: 'column_1' });

      assert.strictEqual(column1Records.length, 1);
      assert.strictEqual(column1Records[0].subject, 'column_1');
    });

    test('should support multiple filters simultaneously', () => {
      const filtered = AUDIT.query('import-1', {
        stage: PipelineStateEnum.MAPPING_IN_PROGRESS,
        subject: 'column_2',
      });

      assert.strictEqual(filtered.length, 1);
      assert.strictEqual(filtered[0].stage, PipelineStateEnum.MAPPING_IN_PROGRESS);
      assert.strictEqual(filtered[0].subject, 'column_2');
    });

    test('should return empty array when no records match filter', () => {
      const filtered = AUDIT.query('import-1', { stage: PipelineStateEnum.COMPLETE });
      assert.deepStrictEqual(filtered, []);
    });
  });

  describe('Round-Trip Test (Master Plan Acceptance Criteria)', () => {
    test('should correctly round-trip record() → query()', () => {
      const originalRecord = {
        import_run_id: 'test-roundtrip',
        stage: PipelineStateEnum.MAPPING_IN_PROGRESS,
        subject: 'test_column',
        decision: 'mapped to test_field',
        confidence: 0.88,
        rationale: 'High confidence match',
        timestamp: new Date('2024-01-01T12:00:00Z'),
      };

      AUDIT.record(originalRecord);
      const retrieved = AUDIT.query('test-roundtrip');

      assert.strictEqual(retrieved.length, 1);
      assert.strictEqual(retrieved[0].import_run_id, originalRecord.import_run_id);
      assert.strictEqual(retrieved[0].stage, originalRecord.stage);
      assert.strictEqual(retrieved[0].subject, originalRecord.subject);
      assert.strictEqual(retrieved[0].decision, originalRecord.decision);
      assert.strictEqual(retrieved[0].confidence, originalRecord.confidence);
      assert.strictEqual(retrieved[0].rationale, originalRecord.rationale);
      assert.deepStrictEqual(retrieved[0].timestamp, originalRecord.timestamp);
    });

    test('should handle multiple records for same import_run_id', () => {
      const records = [
        {
          import_run_id: 'multi-test',
          stage: PipelineStateEnum.PARSING,
          subject: 'file',
          decision: 'parsed',
        },
        {
          import_run_id: 'multi-test',
          stage: PipelineStateEnum.MAPPING_IN_PROGRESS,
          subject: 'col1',
          decision: 'mapped',
        },
        {
          import_run_id: 'multi-test',
          stage: PipelineStateEnum.MAPPING_IN_PROGRESS,
          subject: 'col2',
          decision: 'mapped',
        },
      ];

      records.forEach((r) => AUDIT.record(r));

      const retrieved = AUDIT.query('multi-test');
      assert.strictEqual(retrieved.length, 3);
    });
  });

  describe('Utility Functions', () => {
    test('should count records correctly', () => {
      assert.strictEqual(count('empty'), 0);

      AUDIT.record({
        import_run_id: 'count-test',
        stage: PipelineStateEnum.PARSING,
        subject: 'test',
        decision: 'test',
      });

      assert.strictEqual(count('count-test'), 1);

      AUDIT.record({
        import_run_id: 'count-test',
        stage: PipelineStateEnum.VALIDATING,
        subject: 'test2',
        decision: 'test2',
      });

      assert.strictEqual(count('count-test'), 2);
    });

    test('should clear all records', () => {
      AUDIT.record({
        import_run_id: 'test-1',
        stage: PipelineStateEnum.PARSING,
        subject: 'test',
        decision: 'test',
      });

      AUDIT.record({
        import_run_id: 'test-2',
        stage: PipelineStateEnum.PARSING,
        subject: 'test',
        decision: 'test',
      });

      assert.strictEqual(count('test-1'), 1);
      assert.strictEqual(count('test-2'), 1);

      clear();

      assert.strictEqual(count('test-1'), 0);
      assert.strictEqual(count('test-2'), 0);
    });

    test('should clear records for specific import', () => {
      AUDIT.record({
        import_run_id: 'keep',
        stage: PipelineStateEnum.PARSING,
        subject: 'test',
        decision: 'test',
      });

      AUDIT.record({
        import_run_id: 'delete',
        stage: PipelineStateEnum.PARSING,
        subject: 'test',
        decision: 'test',
      });

      AUDIT.clearImport('delete');

      assert.strictEqual(count('keep'), 1);
      assert.strictEqual(count('delete'), 0);
    });
  });

  describe('Immutability', () => {
    test('should return clones to prevent mutation', () => {
      AUDIT.record({
        import_run_id: 'immutable-test',
        stage: PipelineStateEnum.MAPPING_IN_PROGRESS,
        subject: 'test',
        decision: 'test',
        confidence: 0.9,
      });

      const records1 = AUDIT.query('immutable-test');
      records1[0].confidence = 0.5; // Try to mutate

      const records2 = AUDIT.query('immutable-test');
      assert.strictEqual(records2[0].confidence, 0.9); // Should still be original value
    });
  });
});
