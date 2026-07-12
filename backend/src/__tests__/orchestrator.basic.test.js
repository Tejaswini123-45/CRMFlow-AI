/**
 * Basic Orchestrator Tests
 * Using Node.js built-in test runner
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';

import { Orchestrator } from '../orchestrator/index.js';
import { InMemoryDataStore } from '../orchestrator/data-store.js';
import { PipelineStateEnum } from '../contracts/types.js';

// Import all pipeline components
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

describe('Orchestrator Basic Tests', () => {
  test('should create orchestrator with all components', () => {
    const dataStore = new InMemoryDataStore();
    const components = {
      INGEST,
      HDRX,
      AIMAP,
      MAPFIN,
      XFORM,
      VALID,
      DEDUPE,
      EXPORT,
    };

    const orchestrator = new Orchestrator(components, dataStore);
    assert.ok(orchestrator);
  });

  test('should create and track import', async () => {
    const dataStore = new InMemoryDataStore();
    const components = {
      INGEST,
      HDRX,
      AIMAP,
      MAPFIN,
      XFORM,
      VALID,
      DEDUPE,
      EXPORT,
    };

    const orchestrator = new Orchestrator(components, dataStore);
    const mockFile = Buffer.from('test,data\n1,2');

    const result = await orchestrator.createImport(mockFile, {
      filename: 'test.csv',
    });

    // Check response structure
    assert.ok(result.import_run_id);
    assert.strictEqual(result.state, PipelineStateEnum.UPLOADED);
    assert.ok(result.created_at instanceof Date);

    // Check status retrieval
    const status = await orchestrator.getStatus(result.import_run_id);
    assert.strictEqual(status.import_run_id, result.import_run_id);
    assert.ok(Object.values(PipelineStateEnum).includes(status.state));
  });

  test('should process through pipeline stages', async () => {
    const dataStore = new InMemoryDataStore();
    const components = {
      INGEST,
      HDRX,
      AIMAP,
      MAPFIN,
      XFORM,
      VALID,
      DEDUPE,
      EXPORT,
    };

    const orchestrator = new Orchestrator(components, dataStore);
    const mockFile = Buffer.from('name,email\nJohn,john@test.com');

    const result = await orchestrator.createImport(mockFile);

    // Give pipeline time to process
    await new Promise(resolve => setTimeout(resolve, 1000));

    const status = await orchestrator.getStatus(result.import_run_id);
    
    // Should have progressed from UPLOADED
    assert.notStrictEqual(status.state, PipelineStateEnum.UPLOADED);

    // Should be in a valid state
    assert.ok(Object.values(PipelineStateEnum).includes(status.state));

    // Check audit log exists
    const auditLog = await orchestrator.getAuditLog(result.import_run_id);
    assert.ok(auditLog.records.length > 0);
  });

  test('should handle DataStore operations', async () => {
    const dataStore = new InMemoryDataStore();

    // Test basic operations
    await dataStore.store('test-id', 'INGEST', { data: 'test' });
    
    const exists = await dataStore.exists('test-id', 'INGEST');
    assert.strictEqual(exists, true);

    const retrieved = await dataStore.retrieve('test-id', 'INGEST');
    assert.deepStrictEqual(retrieved, { data: 'test' });

    const stats = await dataStore.getStats('test-id');
    assert.ok(stats);
    assert.ok(stats.stages_stored.includes('INGEST'));

    // Test cleanup
    await dataStore.cleanup('test-id');
    const existsAfterCleanup = await dataStore.exists('test-id', 'INGEST');
    assert.strictEqual(existsAfterCleanup, false);
  });
});