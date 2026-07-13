/**
 * Global Error-Handling Middleware
 * Translates thrown errors into consistent HTTP JSON responses.
 *
 * Error-to-status mapping:
 *   "not found"          → 404  NOT_FOUND
 *   "not in review"      → 409  WRONG_STATE
 *   "not complete"       → 409  WRONG_STATE
 *   MulterError LIMIT_*  → 413  FILE_TOO_LARGE
 *   validation errors    → 400  VALIDATION_ERROR  (set by controllers via err.status)
 *   everything else      → 500  INTERNAL_ERROR
 *
 * Internal error types (ErrorTypes enum) are never surfaced — they stay in the
 * AUDIT trail and are accessible via GET /imports/:id/audit.
 */

/**
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} _next
 */
export function errorHandler(err, req, res, _next) {
  // Multer file-size limit
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: { code: 'FILE_TOO_LARGE', message: 'File exceeds the maximum allowed size' },
    });
  }

  // Controller-set validation errors
  if (err.status === 400) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: err.message },
    });
  }

  const msg = err.message || '';

  if (/not found/i.test(msg)) {
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: msg },
    });
  }

  if (/not in review state|not complete/i.test(msg)) {
    return res.status(409).json({
      error: { code: 'WRONG_STATE', message: msg },
    });
  }

  // Unexpected errors — do not leak stack traces
  console.error('[API] Unhandled error:', err);
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
}
