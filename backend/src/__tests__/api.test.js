/**
 * REST API Layer Tests — Phase 12
 *
 * Tests the HTTP translation layer only.
 * A stub Orchestrator is injected via createApp(); no real pipeline runs.
 *
 * Covers:
 * - Health endpoint
 * - POST /imports (file upload, validation)
 * - GET  /imports/:id (status)
 * - GET  /imports/:id/mapping (proposals)
 * - POST /imports/:id/mapping (corrections)
 * - GET  /imports/:id/result
 * - GET  /imports/:id/audit
 * - GET  /imports/:id/download
 * - Error mapping (404, 409, 400, 413, 500)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../api/app.js';

// ── Stub Orchestrator ────────────────────────────────────────────────────────

const MOCK_RUN_ID = 'test-import-run-001';

/**
 * Build a stub orchestrator where every method can be overridden per-test.
 * Defaults return minimal valid responses.
 */
function makeOrchestrator(overrides = {}) {
  return {
    createImport: async (_file, _opts) => ({
      import_run_id: MOCK_RUN_ID,
      state: 'UPLOADED',
      created_at: new Date(),
    }),
    getStatus: async (id) => {
      if (id === 'missing') throw new Error(`Import ${id} not found`);
      return {
        import_run_id: id,
        state: 'PARSING',
        current_stage: 'Parsing CSV...',
        requires_action: false,
        progress_summary: 'Parsing...',
        created_at: new Date(),
        updated_at: new Date(),
        error: null,
      };
    },
    getMappingProposals: async (id) => {
      if (id === 'missing') throw new Error(`Import ${id} not found`);
      throw new Error(`Import is not in review state: PARSING`);
    },
    submitMappingCorrections: async (id, _corrections) => {
      if (id === 'missing') throw new Error(`Import ${id} not found`);
      return { import_run_id: id, state: 'TRANSFORMING', requires_action: false, progress_summary: 'Transforming...' };
    },
    getImportResult: async (id) => {
      if (id === 'missing') throw new Error(`Import ${id} not found`);
      throw new Error(`Import is not complete: PARSING`);
    },
    getAuditLog: async (id) => {
      if (id === 'missing') throw new Error(`Import ${id} not found`);
      return { import_run_id: id, records: [] };
    },
    getDownloadOutput: async (id) => {
      if (id === 'missing') throw new Error(`Import ${id} not found`);
      throw new Error(`Import is not complete: PARSING`);
    },
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/v1/health', () => {
  it('returns 200 with status, version, and timestamp', async () => {
    const app = createApp(makeOrchestrator(), { version: '1.2.3' });
    const res = await request(app).get('/api/v1/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.version, '1.2.3');
    assert.ok(typeof res.body.timestamp === 'string');
    // timestamp must be a valid ISO string
    assert.ok(!isNaN(Date.parse(res.body.timestamp)));
  });

  it('uses "unknown" when no meta provided', async () => {
    const app = createApp(makeOrchestrator());
    const res = await request(app).get('/api/v1/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.version, 'unknown');
  });
});

describe('POST /api/v1/imports', () => {
  it('returns 202 and ImportRunSummaryDTO on valid CSV upload', async () => {
    const app = createApp(makeOrchestrator());
    const res = await request(app)
      .post('/api/v1/imports')
      .attach('file', Buffer.from('name,email\nAlice,alice@test.com'), 'leads.csv');

    assert.equal(res.status, 202);
    assert.ok(typeof res.body.import_run_id === 'string');
    assert.ok(typeof res.body.state === 'string');
    assert.ok(res.body.created_at !== undefined);
  });

  it('returns 400 when no file is attached', async () => {
    const app = createApp(makeOrchestrator());
    const res = await request(app).post('/api/v1/imports');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('returns 413 when file exceeds size limit', async () => {
    const express = (await import('express')).default;
    const { default: multer } = await import('multer');
    const { errorHandler } = await import('../api/middleware/error-handler.js');

    // Build a minimal app with a 10-byte file size limit to trigger 413
    const tinyApp = express();
    tinyApp.use(express.json());
    const tinyUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 } });
    tinyApp.post('/upload', tinyUpload.single('file'), (_req, res) => res.json({ ok: true }));
    tinyApp.use(errorHandler);

    const res = await request(tinyApp)
      .post('/upload')
      .attach('file', Buffer.from('x'.repeat(100)), 'big.csv');

    assert.equal(res.status, 413);
    assert.equal(res.body.error.code, 'FILE_TOO_LARGE');
  });

  it('passes orchestrator error to error handler', async () => {
    const orch = makeOrchestrator({
      createImport: async () => { throw new Error('Unexpected failure'); },
    });
    const app = createApp(orch);
    const res = await request(app)
      .post('/api/v1/imports')
      .attach('file', Buffer.from('a,b\n1,2'), 'test.csv');

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

describe('GET /api/v1/imports/:id', () => {
  it('returns 200 with ImportStatusDTO for a known id', async () => {
    const app = createApp(makeOrchestrator());
    const res = await request(app).get(`/api/v1/imports/${MOCK_RUN_ID}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.import_run_id, MOCK_RUN_ID);
    assert.ok(typeof res.body.state === 'string');
    assert.ok(typeof res.body.requires_action === 'boolean');
    assert.ok(typeof res.body.progress_summary === 'string');
  });

  it('returns 404 for unknown id', async () => {
    const app = createApp(makeOrchestrator());
    const res = await request(app).get('/api/v1/imports/missing');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });
});

describe('GET /api/v1/imports/:id/mapping', () => {
  it('returns 200 with MappingReviewDTO in review state', async () => {
    const orch = makeOrchestrator({
      getMappingProposals: async (id) => ({
        import_run_id: id,
        proposals: [
          { column_header: 'Email', sample_values: ['a@b.com'], proposed_field: 'email', confidence: 0.95, rationale: 'looks like email', requires_review: false },
        ],
      }),
    });
    const app = createApp(orch);
    const res = await request(app).get(`/api/v1/imports/${MOCK_RUN_ID}/mapping`);
    assert.equal(res.status, 200);
    assert.equal(res.body.import_run_id, MOCK_RUN_ID);
    assert.ok(Array.isArray(res.body.proposals));
  });

  it('returns 404 for unknown id', async () => {
    const app = createApp(makeOrchestrator());
    const res = await request(app).get('/api/v1/imports/missing/mapping');
    assert.equal(res.status, 404);
  });

  it('returns 409 when import is not in review state', async () => {
    const app = createApp(makeOrchestrator()); // default stub throws "not in review state"
    const res = await request(app).get(`/api/v1/imports/${MOCK_RUN_ID}/mapping`);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'WRONG_STATE');
  });
});

describe('POST /api/v1/imports/:id/mapping', () => {
  it('returns 200 with ImportStatusDTO on valid corrections', async () => {
    const orch = makeOrchestrator({
      submitMappingCorrections: async (id, _c) => ({
        import_run_id: id,
        state: 'MAPPING_FINALIZED',
        requires_action: false,
        progress_summary: 'Continuing...',
      }),
    });
    const app = createApp(orch);
    const res = await request(app)
      .post(`/api/v1/imports/${MOCK_RUN_ID}/mapping`)
      .send({ corrections: [{ column_header: 'Phone', corrected_field: 'phone_number' }] });

    assert.equal(res.status, 200);
    assert.equal(res.body.import_run_id, MOCK_RUN_ID);
  });

  it('returns 200 with empty corrections array (approve as-is)', async () => {
    const orch = makeOrchestrator({
      submitMappingCorrections: async (id, _c) => ({ import_run_id: id, state: 'MAPPING_FINALIZED', requires_action: false, progress_summary: '' }),
    });
    const app = createApp(orch);
    const res = await request(app)
      .post(`/api/v1/imports/${MOCK_RUN_ID}/mapping`)
      .send({ corrections: [] });

    assert.equal(res.status, 200);
  });

  it('returns 400 when corrections is missing', async () => {
    const app = createApp(makeOrchestrator());
    const res = await request(app)
      .post(`/api/v1/imports/${MOCK_RUN_ID}/mapping`)
      .send({});
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('returns 400 when corrections is not an array', async () => {
    const app = createApp(makeOrchestrator());
    const res = await request(app)
      .post(`/api/v1/imports/${MOCK_RUN_ID}/mapping`)
      .send({ corrections: 'bad' });
    assert.equal(res.status, 400);
  });

  it('returns 400 when a correction entry is missing column_header', async () => {
    const app = createApp(makeOrchestrator());
    const res = await request(app)
      .post(`/api/v1/imports/${MOCK_RUN_ID}/mapping`)
      .send({ corrections: [{ corrected_field: 'email' }] });
    assert.equal(res.status, 400);
  });

  it('returns 400 when a correction entry is missing corrected_field', async () => {
    const app = createApp(makeOrchestrator());
    const res = await request(app)
      .post(`/api/v1/imports/${MOCK_RUN_ID}/mapping`)
      .send({ corrections: [{ column_header: 'Email' }] });
    assert.equal(res.status, 400);
  });

  it('returns 404 for unknown id', async () => {
    const app = createApp(makeOrchestrator());
    const res = await request(app)
      .post('/api/v1/imports/missing/mapping')
      .send({ corrections: [] });
    assert.equal(res.status, 404);
  });

  it('returns 409 when import is not in review state', async () => {
    const orch = makeOrchestrator({
      submitMappingCorrections: async () => { throw new Error('Import is not in review state: COMPLETE'); },
    });
    const app = createApp(orch);
    const res = await request(app)
      .post(`/api/v1/imports/${MOCK_RUN_ID}/mapping`)
      .send({ corrections: [] });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'WRONG_STATE');
  });
});

describe('GET /api/v1/imports/:id/result', () => {
  it('returns 200 with ImportResultDTO when complete', async () => {
    const orch = makeOrchestrator({
      getImportResult: async (id) => ({
        import_run_id: id,
        accepted_count: 10,
        skipped_count: 2,
        flagged_count: 1,
        duplicate_count: 0,
        output_download_ref: `output_${id}.json`,
        summary_reasons: [{ reason: 'Valid and unique', count: 10 }],
      }),
    });
    const app = createApp(orch);
    const res = await request(app).get(`/api/v1/imports/${MOCK_RUN_ID}/result`);
    assert.equal(res.status, 200);
    assert.equal(res.body.accepted_count, 10);
    assert.ok(typeof res.body.output_download_ref === 'string');
  });

  it('returns 404 for unknown id', async () => {
    const app = createApp(makeOrchestrator());
    const res = await request(app).get('/api/v1/imports/missing/result');
    assert.equal(res.status, 404);
  });

  it('returns 409 when import is not complete', async () => {
    const app = createApp(makeOrchestrator()); // default stub throws "not complete"
    const res = await request(app).get(`/api/v1/imports/${MOCK_RUN_ID}/result`);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'WRONG_STATE');
  });
});

describe('GET /api/v1/imports/:id/audit', () => {
  it('returns 200 with AuditLogDTO', async () => {
    const app = createApp(makeOrchestrator());
    const res = await request(app).get(`/api/v1/imports/${MOCK_RUN_ID}/audit`);
    assert.equal(res.status, 200);
    assert.equal(res.body.import_run_id, MOCK_RUN_ID);
    assert.ok(Array.isArray(res.body.records));
  });

  it('returns 404 for unknown id', async () => {
    const app = createApp(makeOrchestrator());
    const res = await request(app).get('/api/v1/imports/missing/audit');
    assert.equal(res.status, 404);
  });
});

describe('GET /api/v1/imports/:id/download', () => {
  it('returns 200 with Content-Disposition attachment when complete', async () => {
    const orch = makeOrchestrator({
      getDownloadOutput: async (id) => ({
        filename: `output_${id}.json`,
        output: { rows: [], format: 'JSON', generated_at: new Date().toISOString() },
      }),
    });
    const app = createApp(orch);
    const res = await request(app).get(`/api/v1/imports/${MOCK_RUN_ID}/download`);
    assert.equal(res.status, 200);
    assert.ok(res.headers['content-disposition']?.includes('attachment'));
    assert.ok(res.headers['content-disposition']?.includes('.json'));
    assert.ok(Array.isArray(res.body.rows));
  });

  it('returns 404 for unknown id', async () => {
    const app = createApp(makeOrchestrator());
    const res = await request(app).get('/api/v1/imports/missing/download');
    assert.equal(res.status, 404);
  });

  it('returns 409 when import is not complete', async () => {
    const app = createApp(makeOrchestrator()); // default stub throws "not complete"
    const res = await request(app).get(`/api/v1/imports/${MOCK_RUN_ID}/download`);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'WRONG_STATE');
  });
});

describe('Unknown routes', () => {
  it('returns 404 for unregistered path', async () => {
    const app = createApp(makeOrchestrator());
    const res = await request(app).get('/api/v1/nonexistent');
    assert.equal(res.status, 404);
  });
});
