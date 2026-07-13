/**
 * Express Application Factory
 * LLD §3: /api — Frontend-facing interface, talks only to /orchestrator.
 *
 * Exported as a factory function so tests can inject a stub orchestrator
 * without spawning a real server.
 *
 * @param {Object} orchestrator - Orchestrator instance
 * @param {Object} [meta] - Application metadata (version etc.)
 * @returns {import('express').Application}
 */

import express from 'express';
import importsRouter from './routes/imports.js';
import { errorHandler } from './middleware/error-handler.js';
import { healthCheck } from './controllers/imports.controller.js';

/**
 * Create and configure the Express app.
 *
 * @param {Object} orchestrator - Orchestrator instance to use for all requests
 * @param {{ version?: string }} [meta={}] - App metadata injected into health endpoint
 */
export function createApp(orchestrator, meta = {}) {
  const app = express();

  // ── Parse JSON request bodies (needed for POST /imports/:id/mapping)
  app.use(express.json());

  // ── Inject orchestrator and app meta onto every request
  // This keeps controllers free of module-level orchestrator references,
  // making them testable with stub orchestrators.
  app.use((req, _res, next) => {
    req.orchestrator = orchestrator;
    req.appMeta = meta;
    next();
  });

  // ── Development CORS — allow all origins so the frontend can connect
  // Note: tighten to specific origin(s) before production deployment.
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });

  // ── Request ID — correlate logs and responses
  app.use((req, res, next) => {
    const id = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    res.setHeader('X-Request-ID', id);
    next();
  });

  // ── Health check — no ORCH dependency
  app.get('/api/v1/health', healthCheck);

  // ── Versioned API routes
  app.use('/api/v1/imports', importsRouter);

  // ── 404 for unknown routes
  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  // ── Global error handler (must be last)
  app.use(errorHandler);

  return app;
}
