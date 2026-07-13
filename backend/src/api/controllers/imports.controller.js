/**
 * Imports Controller
 * LLD §4 — thin HTTP translation layer over ORCH.
 *
 * Rules:
 *   - Each function calls exactly one ORCH method.
 *   - No business logic.
 *   - No DataStore access.
 *   - No pipeline imports.
 *   - Structural validation only (field presence / type); semantic validation is ORCH's job.
 */

import { CONFIG } from '../../config/index.js';

/**
 * Validate that corrections is a well-formed array.
 * @param {any} corrections
 * @returns {string|null} error message or null if valid
 */
function validateCorrections(corrections) {
  if (!Array.isArray(corrections)) {
    return 'corrections must be an array';
  }
  for (let i = 0; i < corrections.length; i++) {
    const c = corrections[i];
    if (!c || typeof c !== 'object') {
      return `corrections[${i}] must be an object`;
    }
    if (typeof c.column_header !== 'string' || c.column_header.trim() === '') {
      return `corrections[${i}].column_header must be a non-empty string`;
    }
    if (typeof c.corrected_field !== 'string' || c.corrected_field.trim() === '') {
      return `corrections[${i}].corrected_field must be a non-empty string`;
    }
  }
  return null;
}

/**
 * POST /api/v1/imports
 * Accept a CSV file upload and start the pipeline.
 * Returns 202 Accepted + ImportRunSummaryDTO.
 */
export async function createImport(req, res, next) {
  try {
    if (!req.file) {
      const err = new Error('A CSV file is required');
      err.status = 400;
      return next(err);
    }

    const result = await req.orchestrator.createImport(req.file.buffer, {
      filename: req.file.originalname || 'upload.csv',
    });

    return res.status(202).json(result);
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/v1/imports/:id
 * Returns current ImportStatusDTO.
 */
export async function getStatus(req, res, next) {
  try {
    const result = await req.orchestrator.getStatus(req.params.id);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/v1/imports/:id/mapping
 * Returns MappingReviewDTO (only valid when state === AWAITING_REVIEW).
 */
export async function getMappingProposals(req, res, next) {
  try {
    const result = await req.orchestrator.getMappingProposals(req.params.id);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/v1/imports/:id/mapping
 * Submit human corrections (or empty array to approve as-is) and resume pipeline.
 * Returns updated ImportStatusDTO.
 */
export async function submitCorrections(req, res, next) {
  try {
    const { corrections } = req.body || {};
    const validationError = validateCorrections(corrections);
    if (validationError) {
      const err = new Error(validationError);
      err.status = 400;
      return next(err);
    }

    const result = await req.orchestrator.submitMappingCorrections(
      req.params.id,
      corrections
    );
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/v1/imports/:id/result
 * Returns ImportResultDTO (only valid when state === COMPLETE).
 */
export async function getResult(req, res, next) {
  try {
    const result = await req.orchestrator.getImportResult(req.params.id);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/v1/imports/:id/audit
 * Returns AuditLogDTO.
 */
export async function getAuditLog(req, res, next) {
  try {
    const result = await req.orchestrator.getAuditLog(req.params.id);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/v1/imports/:id/download
 * Returns the standardized output file as a JSON attachment.
 * Uses orchestrator.getDownloadOutput() — no direct DataStore access here.
 */
export async function downloadOutput(req, res, next) {
  try {
    const result = await req.orchestrator.getDownloadOutput(req.params.id);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`
    );
    return res.status(200).json(result.output);
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/v1/health
 * Returns service health + version. No ORCH dependency.
 */
export function healthCheck(req, res) {
  const pkg = req.appMeta;
  return res.status(200).json({
    status: 'ok',
    version: pkg?.version ?? 'unknown',
    timestamp: new Date().toISOString(),
  });
}

// Re-export CONFIG for use in upload middleware (file size limit)
export { CONFIG };
