/**
 * Audit Logger Tests
 * Phase 2 - Validates AUDIT record() and query() functionality
 */

import { AUDIT, count, clear } from '../audit/index.js';
import { PipelineStateEnum } from '../contracts/types.js';

describe('AUDIT Logger (LLD §11)', () => {
  beforeEach(() => {
    clear(); // Clear all records before each test
  });

  describe('record() - Write Operations', () => {
    it('should record a decision successfully', () => {
      const result = AUDIT.record({
        import_run_id: 'test-import-1',
        stage: PipelineStateEnum.MAPPING_IN_PROGRESS,
        subject: 'email_column',
        decision: 'mapped to email field',
        confidence: 0.95,
        rationale: 'Header matches known pattern',
      });

      expect(result.success).toBe(true);
    });

    it('should auto-generate timestamp if not provided', () => {
      const before = new Date();

      AUDIT.record({
        import_run_id: 'test-import-1',
        stage: PipelineStateEnum.MAPPING_IN_PROGRESS,
        subject: 'test',
        decision: 'test decision',
      });

      const after = new Date();
      const records = AUDIT.query('test-import-1');

      expect(records[0].timestamp).toBeDefined();
      expect(records[0].timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(records[0].timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should throw error for missing required fields', () => {
      expect(() =>
        AUDIT.record({
          import_run_id: 'test-import-1',
          // missing stage, subject, decision
        })
      ).toThrow('DecisionRecord missing required fields');
    });

    it('should accept nullable confidence and rationale', () => {
      const result = AUDIT.record({
        import_run_id: 'test-import-1',
        stage: PipelineStateEnum.VALIDATING,
        subject: 'row_42',
        decision: 'invalid',
        confidence: null,
        rationale: null,
      });

      expect(result.success).toBe(true);

      const records = AUDIT.query('test-import-1');
      expect(records[0].confidence).toBeNull();
      expect(records[0].rationale).toBeNull();
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

    it('should retrieve all records for an import_run_id', () => {
      const records = AUDIT.query('import-1');
      expect(records).toHaveLength(3);
    });

    it('should return empty array for non-existent import_run_id', () => {
      const records = AUDIT.query('nonexistent');
      expect(records).toEqual([]);
    });

    it('should return records in chronological order', () => {
      const records = AUDIT.query('import-1');

      expect(records[0].stage).toBe(PipelineStateEnum.PARSING);
      expect(records[1].stage).toBe(PipelineStateEnum.MAPPING_IN_PROGRESS);
      expect(records[2].stage).toBe(PipelineStateEnum.MAPPING_IN_PROGRESS);

      // Verify timestamps are in order
      expect(records[0].timestamp.getTime()).toBeLessThanOrEqual(
        records[1].timestamp.getTime()
      );
      expect(records[1].timestamp.getTime()).toBeLessThanOrEqual(
        records[2].timestamp.getTime()
      );
    });

    it('should isolate records between different import_run_ids', () => {
      const import1Records = AUDIT.query('import-1');
      const import2Records = AUDIT.query('import-2');

      expect(import1Records).toHaveLength(3);
      expect(import2Records).toHaveLength(1);

      // No cross-contamination
      expect(import1Records.every((r) => r.import_run_id === 'import-1')).toBe(true);
      expect(import2Records.every((r) => r.import_run_id === 'import-2')).toBe(true);
    });

    it('should throw error if import_run_id is missing', () => {
      expect(() => AUDIT.query()).toThrow('import_run_id is required');
      expect(() => AUDIT.query(null)).toThrow('import_run_id is required');
      expect(() => AUDIT.query('')).toThrow('import_run_id is required');
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

    it('should filter by stage', () => {
      const mappingRecords = AUDIT.query('import-1', {
        stage: PipelineStateEnum.MAPPING_IN_PROGRESS,
      });

      expect(mappingRecords).toHaveLength(2);
      expect(mappingRecords.every((r) => r.stage === PipelineStateEnum.MAPPING_IN_PROGRESS)).toBe(
        true
      );
    });

    it('should filter by subject', () => {
      const column1Records = AUDIT.query('import-1', { subject: 'column_1' });

      expect(column1Records).toHaveLength(1);
      expect(column1Records[0].subject).toBe('column_1');
    });

    it('should support multiple filters simultaneously', () => {
      const filtered = AUDIT.query('import-1', {
        stage: PipelineStateEnum.MAPPING_IN_PROGRESS,
        subject: 'column_2',
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].stage).toBe(PipelineStateEnum.MAPPING_IN_PROGRESS);
      expect(filtered[0].subject).toBe('column_2');
    });

    it('should return empty array when no records match filter', () => {
      const filtered = AUDIT.query('import-1', { stage: PipelineStateEnum.COMPLETE });
      expect(filtered).toEqual([]);
    });
  });

  describe('Round-Trip Test (Master Plan Acceptance Criteria)', () => {
    it('should correctly round-trip record() → query()', () => {
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

      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].import_run_id).toBe(originalRecord.import_run_id);
      expect(retrieved[0].stage).toBe(originalRecord.stage);
      expect(retrieved[0].subject).toBe(originalRecord.subject);
      expect(retrieved[0].decision).toBe(originalRecord.decision);
      expect(retrieved[0].confidence).toBe(originalRecord.confidence);
      expect(retrieved[0].rationale).toBe(originalRecord.rationale);
      expect(retrieved[0].timestamp).toEqual(originalRecord.timestamp);
    });

    it('should handle multiple records for same import_run_id', () => {
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
      expect(retrieved).toHaveLength(3);
    });
  });

  describe('Utility Functions', () => {
    it('should count records correctly', () => {
      expect(count('empty')).toBe(0);

      AUDIT.record({
        import_run_id: 'count-test',
        stage: PipelineStateEnum.PARSING,
        subject: 'test',
        decision: 'test',
      });

      expect(count('count-test')).toBe(1);

      AUDIT.record({
        import_run_id: 'count-test',
        stage: PipelineStateEnum.VALIDATING,
        subject: 'test2',
        decision: 'test2',
      });

      expect(count('count-test')).toBe(2);
    });

    it('should clear all records', () => {
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

      expect(count('test-1')).toBe(1);
      expect(count('test-2')).toBe(1);

      clear();

      expect(count('test-1')).toBe(0);
      expect(count('test-2')).toBe(0);
    });

    it('should clear records for specific import', () => {
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

      expect(count('keep')).toBe(1);
      expect(count('delete')).toBe(0);
    });
  });

  describe('Immutability', () => {
    it('should return clones to prevent mutation', () => {
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
      expect(records2[0].confidence).toBe(0.9); // Should still be original value
    });
  });
});
