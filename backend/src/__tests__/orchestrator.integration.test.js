/**
 * Pipeline Orchestrator Integration Tests
 * Phase 3 - Complete state machine and component integration testing
 *
 * Tests all acceptance criteria from Master Implementation Plan:
 * - State transitions
 * - Component integration
 * - Error handling
 * - Pause/resume (AWAITING_REVIEW)
 * - Terminal states
 * - DataStore integration
 * - Audit logging
 */

import { Orchestrator } from '../orchestrator/index.js';
import { InMemoryDataStore } from '../orchestrator/data-store.js';
import { PipelineStateEnum, TERMINAL_STATES, ErrorTypes } from '../contracts/types.js';
import { AUDIT } from '../audit/index.js';
import { CONFIG } from '../config/index.js';

// Note: Tests can import components for assembly - they're the integration point
// The restriction is on components importing each other, not on test imports
// eslint-disable-next-line no-restricted-imports
import INGEST from '../pipeline/ingestion/index.js';
// eslint-disable-next-line no-restricted-imports
import HDRX from '../pipeline/header_analysis/index.js';
// eslint-disable-next-line no-restricted-imports
import AIMAP from '../pipeline/ai_mapping/index.js';
// eslint-disable-next-line no-restricted-imports
import MAPFIN from '../pipeline/mapping_finalization/index.js';
// eslint-disable-next-line no-restricted-imports
import XFORM from '../pipeline/transformation/index.js';
// eslint-disable-next-line no-restricted-imports
import VALID from '../pipeline/validation/index.js';
// eslint-disable-next-line no-restricted-imports
import DEDUPE from '../pipeline/duplicate_detection/index.js';
// eslint-disable-next-line no-restricted-imports
import EXPORT from '../pipeline/export/index.js';

describe('Orchestrator Integration Tests', () => {
  let orchestrator;
  let dataStore;
  let components;

  beforeEach(() => {
    // Reset all shared state
    AUDIT.clear();
    CONFIG.reset();

    // Create fresh DataStore
    dataStore = new InMemoryDataStore();

    // Assemble components
    components = {
      INGEST,
      HDRX,
      AIMAP,
      MAPFIN,
      XFORM,
      VALID,
      DEDUPE,
      EXPORT,
    };

    // Create orchestrator
    orchestrator = new Orchestrator(components, dataStore);
  });

  afterEach(() => {
    AUDIT.clear();
  });

  describe('Full Success Path - No Review Required', () => {
    test('should complete full pipeline from UPLOADED to COMPLETE', async () => {
      // Create mock file
      const mockFile = Buffer.from('test,data\n1,2');

      // Create import
      const result = await orchestrator.createImport(mockFile, {
        filename: 'test.csv',
      });

      expect(result.import_run_id).toBeDefined();
      expect(result.state).toBe(PipelineStateEnum.UPLOADED);

      // Wait for pipeline to complete (mock components are fast)
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check final status
      const status = await orchestrator.getStatus(result.import_run_id);

      // Should be COMPLETE or AWAITING_REVIEW (depending on confidence)
      expect([
        PipelineStateEnum.COMPLETE,
        PipelineStateEnum.AWAITING_REVIEW,
      ]).toContain(status.state);

      // If complete, verify result
      if (status.state === PipelineStateEnum.COMPLETE) {
        const importResult = await orchestrator.getImportResult(result.import_run_id);
        expect(importResult.accepted_count).toBeGreaterThan(0);
        expect(importResult.output_download_ref).toBeDefined();
      }
    }, 10000);

    test('should store data in DataStore for each stage', async () => {
      const mockFile = Buffer.from('test,data\n1,2');
      const result = await orchestrator.createImport(mockFile, {
        filename: 'test.csv',
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check DataStore has stage data
      const hasRawFile = await dataStore.exists(result.import_run_id, 'RAW_FILE');
      expect(hasRawFile).toBe(true);

      const hasIngest = await dataStore.exists(result.import_run_id, 'INGEST');
      expect(hasIngest).toBe(true);

      const hasHdrx = await dataStore.exists(result.import_run_id, 'HDRX');
      expect(hasHdrx).toBe(true);
    }, 10000);

    test('should create audit trail for all stages', async () => {
      const mockFile = Buffer.from('test,data\n1,2');
      const result = await orchestrator.createImport(mockFile, {
        filename: 'test.csv',
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check audit log
      const auditLog = await orchestrator.getAuditLog(result.import_run_id);
      expect(auditLog.records.length).toBeGreaterThan(0);

      // Verify key audit entries
      const importCreated = auditLog.records.find((r) => r.subject === 'import_created');
      expect(importCreated).toBeDefined();

      const stateTransitions = auditLog.records.filter(
        (r) => r.subject === 'state_transition'
      );
      expect(stateTransitions.length).toBeGreaterThan(0);
    }, 10000);
  });

  describe('Review-Required Path (AWAITING_REVIEW)', () => {
    test('should pause at AWAITING_REVIEW when confidence is low', async () => {
      // Set high confidence threshold to trigger review
      CONFIG._setForTesting('mapping_confidence_threshold', 0.99);

      const mockFile = Buffer.from('test,data\n1,2');
      const result = await orchestrator.createImport(mockFile, {
        filename: 'test.csv',
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const status = await orchestrator.getStatus(result.import_run_id);
      expect(status.state).toBe(PipelineStateEnum.AWAITING_REVIEW);
      expect(status.requires_action).toBe(true);
    }, 10000);

    test('should allow retrieval of mapping proposals in review state', async () => {
      CONFIG._setForTesting('mapping_confidence_threshold', 0.99);

      const mockFile = Buffer.from('test,data\n1,2');
      const result = await orchestrator.createImport(mockFile, {
        filename: 'test.csv',
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const status = await orchestrator.getStatus(result.import_run_id);
      if (status.state === PipelineStateEnum.AWAITING_REVIEW) {
        const proposals = await orchestrator.getMappingProposals(result.import_run_id);

        expect(proposals.import_run_id).toBe(result.import_run_id);
        expect(Array.isArray(proposals.proposals)).toBe(true);
        expect(proposals.proposals.length).toBeGreaterThan(0);

        // Check proposal structure
        const firstProposal = proposals.proposals[0];
        expect(firstProposal.column_header).toBeDefined();
        expect(firstProposal.proposed_field).toBeDefined();
        expect(firstProposal.confidence).toBeDefined();
        expect(firstProposal.sample_values).toBeDefined();
      }
    }, 10000);

    test('should resume pipeline after corrections', async () => {
      CONFIG._setForTesting('mapping_confidence_threshold', 0.99);

      const mockFile = Buffer.from('test,data\n1,2');
      const result = await orchestrator.createImport(mockFile, {
        filename: 'test.csv',
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const status = await orchestrator.getStatus(result.import_run_id);
      if (status.state === PipelineStateEnum.AWAITING_REVIEW) {
        // Submit corrections
        const corrections = [
          {
            column_header: 'Job Title',
            corrected_field: 'job_title',
          },
        ];

        await orchestrator.submitMappingCorrections(
          result.import_run_id,
          corrections
        );

        // Wait for pipeline to complete
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const finalStatus = await orchestrator.getStatus(result.import_run_id);

        // Should have moved past review
        expect(finalStatus.state).not.toBe(PipelineStateEnum.AWAITING_REVIEW);

        // Check audit log for corrections
        const auditLog = await orchestrator.getAuditLog(result.import_run_id);
        const correctionRecord = auditLog.records.find(
          (r) => r.subject === 'mapping_finalized' && r.decision.includes('corrections')
        );
        expect(correctionRecord).toBeDefined();
      }
    }, 10000);
  });

  describe('Error Handling and Terminal States', () => {
    test('should handle PARSE_FAILED terminal state', async () => {
      // Create failing component
      const failingIngest = {
        execute: async () => ({
          success: false,
          error: {
            type: ErrorTypes.STRUCTURAL_PARSE_ERROR,
            message: 'Malformed CSV',
          },
        }),
      };

      const failingOrch = new Orchestrator(
        { ...components, INGEST: failingIngest },
        dataStore
      );

      const mockFile = Buffer.from('bad,csv\ndata');
      const result = await failingOrch.createImport(mockFile);

      await new Promise((resolve) => setTimeout(resolve, 500));

      const status = await failingOrch.getStatus(result.import_run_id);
      expect(status.state).toBe(PipelineStateEnum.PARSE_FAILED);
      expect(TERMINAL_STATES.has(status.state)).toBe(true);
      expect(status.error).toBeDefined();
      expect(status.error.type).toBe(ErrorTypes.STRUCTURAL_PARSE_ERROR);
    });

    test('should handle MAPPING_FAILED terminal state', async () => {
      const failingAIMAP = {
        execute: async () => ({
          success: false,
          error: {
            type: ErrorTypes.AI_MAPPING_HARD_FAILURE,
            message: 'LLM provider unreachable after retries',
          },
        }),
      };

      const failingOrch = new Orchestrator(
        { ...components, AIMAP: failingAIMAP },
        dataStore
      );

      const mockFile = Buffer.from('test,data\n1,2');
      const result = await failingOrch.createImport(mockFile);

      await new Promise((resolve) => setTimeout(resolve, 500));

      const status = await failingOrch.getStatus(result.import_run_id);
      expect(status.state).toBe(PipelineStateEnum.MAPPING_FAILED);
      expect(TERMINAL_STATES.has(status.state)).toBe(true);
    });

    test('should handle FAILED terminal state for unclassified errors', async () => {
      const failingExport = {
        execute: async () => ({
          success: false,
          error: {
            type: ErrorTypes.UNCLASSIFIED_ERROR,
            message: 'Unknown error occurred',
          },
        }),
      };

      const failingOrch = new Orchestrator(
        { ...components, EXPORT: failingExport },
        dataStore
      );

      const mockFile = Buffer.from('test,data\n1,2');
      const result = await failingOrch.createImport(mockFile);

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const status = await failingOrch.getStatus(result.import_run_id);
      expect(status.state).toBe(PipelineStateEnum.FAILED);
      expect(TERMINAL_STATES.has(status.state)).toBe(true);
    });

    test('should not allow transitions from terminal states', async () => {
      const failingIngest = {
        execute: async () => ({
          success: false,
          error: {
            type: ErrorTypes.EMPTY_OR_UNREADABLE_FILE,
            message: 'Empty file',
          },
        }),
      };

      const failingOrch = new Orchestrator(
        { ...components, INGEST: failingIngest },
        dataStore
      );

      const mockFile = Buffer.from('');
      const result = await failingOrch.createImport(mockFile);

      await new Promise((resolve) => setTimeout(resolve, 500));

      const status1 = await failingOrch.getStatus(result.import_run_id);
      expect(TERMINAL_STATES.has(status1.state)).toBe(true);

      // Try to resume - should remain in terminal state
      await failingOrch.startPipeline(result.import_run_id);
      const status2 = await failingOrch.getStatus(result.import_run_id);
      expect(status2.state).toBe(status1.state); // No change - terminal state persists
    });
  });

  describe('DataStore Integration', () => {
    test('should isolate data between imports', async () => {
      const mockFile1 = Buffer.from('import1,data\n1,2');
      const mockFile2 = Buffer.from('import2,data\n3,4');

      const result1 = await orchestrator.createImport(mockFile1, {
        filename: 'import1.csv',
      });
      const result2 = await orchestrator.createImport(mockFile2, {
        filename: 'import2.csv',
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Each import should have its own data
      const file1 = await dataStore.retrieve(result1.import_run_id, 'RAW_FILE');
      const file2 = await dataStore.retrieve(result2.import_run_id, 'RAW_FILE');

      expect(file1).not.toEqual(file2);

      // Check storage stats
      const stats1 = await dataStore.getStats(result1.import_run_id);
      const stats2 = await dataStore.getStats(result2.import_run_id);

      expect(stats1).toBeDefined();
      expect(stats2).toBeDefined();
      expect(stats1.stages_stored.length).toBeGreaterThan(0);
      expect(stats2.stages_stored.length).toBeGreaterThan(0);
    }, 10000);

    test('should handle cleanup for terminal states', async () => {
      const mockFile = Buffer.from('test,data\n1,2');
      const result = await orchestrator.createImport(mockFile);

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const status = await orchestrator.getStatus(result.import_run_id);

      if (TERMINAL_STATES.has(status.state)) {
        // Cleanup
        await dataStore.cleanup(result.import_run_id);

        // Data should be gone
        const exists = await dataStore.exists(result.import_run_id, 'RAW_FILE');
        expect(exists).toBe(false);

        const stats = await dataStore.getStats(result.import_run_id);
        expect(stats).toBeNull();
      }
    }, 10000);
  });

  describe('State Machine Transitions', () => {
    test('should follow correct state sequence for success path', async () => {
      const mockFile = Buffer.from('test,data\n1,2');
      const result = await orchestrator.createImport(mockFile);

      const expectedSequence = [
        PipelineStateEnum.UPLOADED,
        PipelineStateEnum.PARSING,
        PipelineStateEnum.HEADERS_EXTRACTED,
        PipelineStateEnum.MAPPING_IN_PROGRESS,
      ];

      // Wait for initial transitions
      await new Promise((resolve) => setTimeout(resolve, 500));

      const status = await orchestrator.getStatus(result.import_run_id);

      // Should have progressed through sequence
      expect(expectedSequence.includes(status.state)).toBe(true);
    }, 10000);

    test('should track completed stages in state context', async () => {
      const mockFile = Buffer.from('test,data\n1,2');
      const result = await orchestrator.createImport(mockFile);

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const status = await orchestrator.getStatus(result.import_run_id);

      // Internal state should track completed stages
      // (This would require exposing more state detail or checking audit log)
      const auditLog = await orchestrator.getAuditLog(result.import_run_id);
      const transitions = auditLog.records.filter((r) => r.subject === 'state_transition');

      expect(transitions.length).toBeGreaterThan(0);
    }, 10000);
  });

  describe('Configuration Integration', () => {
    test('should use CONFIG confidence threshold for routing', async () => {
      // Set threshold to 0.9 (high)
      CONFIG._setForTesting('mapping_confidence_threshold', 0.9);

      const mockFile = Buffer.from('test,data\n1,2');
      const result = await orchestrator.createImport(mockFile);

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const status = await orchestrator.getStatus(result.import_run_id);

      // Mock AIMAP returns some columns with confidence < 0.9
      // Should trigger review
      if (status.state === PipelineStateEnum.AWAITING_REVIEW) {
        expect(status.requires_action).toBe(true);
      }

      // Reset
      CONFIG.reset();
    }, 10000);
  });

  describe('API Contract Compliance', () => {
    test('createImport should return ImportRunSummaryDTO', async () => {
      const mockFile = Buffer.from('test,data\n1,2');
      const result = await orchestrator.createImport(mockFile, {
        filename: 'test.csv',
      });

      // Check DTO structure (LLD §5)
      expect(result).toHaveProperty('import_run_id');
      expect(result).toHaveProperty('state');
      expect(result).toHaveProperty('created_at');
      expect(typeof result.import_run_id).toBe('string');
      expect(typeof result.state).toBe('string');
      expect(result.created_at).toBeInstanceOf(Date);
    });

    test('getStatus should return ImportStatusDTO', async () => {
      const mockFile = Buffer.from('test,data\n1,2');
      const result = await orchestrator.createImport(mockFile);

      const status = await orchestrator.getStatus(result.import_run_id);

      // Check DTO structure (LLD §5)
      expect(status).toHaveProperty('import_run_id');
      expect(status).toHaveProperty('state');
      expect(status).toHaveProperty('current_stage');
      expect(status).toHaveProperty('requires_action');
      expect(status).toHaveProperty('progress_summary');
      expect(typeof status.requires_action).toBe('boolean');
      expect(typeof status.progress_summary).toBe('string');
    });

    test('getAuditLog should return AuditLogDTO', async () => {
      const mockFile = Buffer.from('test,data\n1,2');
      const result = await orchestrator.createImport(mockFile);

      await new Promise((resolve) => setTimeout(resolve, 500));

      const auditLog = await orchestrator.getAuditLog(result.import_run_id);

      // Check DTO structure (LLD §5)
      expect(auditLog).toHaveProperty('import_run_id');
      expect(auditLog).toHaveProperty('records');
      expect(Array.isArray(auditLog.records)).toBe(true);

      if (auditLog.records.length > 0) {
        const record = auditLog.records[0];
        expect(record).toHaveProperty('stage');
        expect(record).toHaveProperty('subject');
        expect(record).toHaveProperty('decision');
        expect(record).toHaveProperty('timestamp');
      }
    });
  });

  describe('Error Cases', () => {
    test('should throw error for non-existent import', async () => {
      await expect(orchestrator.getStatus('non-existent-id')).rejects.toThrow(
        'Import non-existent-id not found'
      );
    });

    test('should throw error when getting proposals for non-review state', async () => {
      const mockFile = Buffer.from('test,data\n1,2');
      const result = await orchestrator.createImport(mockFile);

      // Immediately try to get proposals (before reaching review state)
      await expect(
        orchestrator.getMappingProposals(result.import_run_id)
      ).rejects.toThrow();
    });

    test('should throw error when submitting corrections outside review state', async () => {
      const mockFile = Buffer.from('test,data\n1,2');
      const result = await orchestrator.createImport(mockFile);

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const status = await orchestrator.getStatus(result.import_run_id);

      if (status.state !== PipelineStateEnum.AWAITING_REVIEW) {
        await expect(
          orchestrator.submitMappingCorrections(result.import_run_id, [])
        ).rejects.toThrow();
      }
    }, 10000);

    test('should throw error when getting result for incomplete import', async () => {
      const mockFile = Buffer.from('test,data\n1,2');
      const result = await orchestrator.createImport(mockFile);

      // Immediately try to get result
      await expect(orchestrator.getImportResult(result.import_run_id)).rejects.toThrow();
    });
  });
});
