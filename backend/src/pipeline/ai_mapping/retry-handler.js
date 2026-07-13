/**
 * AIMAP Retry Handler
 * AES §10 — Retry strategy with exponential backoff
 *
 * Separates generation-quality retries from rate-limit retries.
 * Hard failures (auth, provider unreachable) short-circuit immediately.
 */

import { ErrorTypes } from '../../contracts/types.js';

/**
 * @typedef {Object} RetryResult
 * @property {boolean} success - Whether the call eventually succeeded
 * @property {any} [data] - Result data if success
 * @property {Object} [error] - Error if not success
 * @property {number} retryCount - How many retries were performed
 */

/**
 * Execute a call function with retry logic per AES §10
 *
 * Generation failures (timeout, malformed output) retry up to maxRetries.
 * Rate limit failures use a separate retry budget with Retry-After backoff.
 * Hard failures short-circuit immediately (no retry).
 *
 * @param {Function} callFn - Async function returning { success, error?, data? }
 * @param {Object} options
 * @param {number} options.maxRetries - Max retries for generation failures (from CONFIG)
 * @param {number} [options.baseDelayMs=1000] - Base delay for exponential backoff
 * @param {number} [options.maxRateLimitRetries=3] - Separate budget for 429s
 * @returns {Promise<RetryResult>}
 */
export async function executeWithRetry(callFn, options = {}) {
  const { maxRetries, baseDelayMs = 1000, maxRateLimitRetries = 3 } = options;

  let generationAttempts = 0;
  let rateLimitAttempts = 0;
  let lastError = null;

  while (generationAttempts <= maxRetries) {
    const result = await callFn();

    if (result.success) {
      return {
        success: true,
        data: result.data,
        retryCount: generationAttempts,
      };
    }

    const errorType = result.error?.type;

    // Hard failure — do not retry
    if (errorType === 'AIMappingHardFailure') {
      return {
        success: false,
        error: result.error,
        retryCount: generationAttempts,
      };
    }

    // Rate limit — separate retry budget with Retry-After backoff
    if (errorType === 'RateLimited') {
      if (rateLimitAttempts >= maxRateLimitRetries) {
        return {
          success: false,
          error: {
            type: ErrorTypes.AI_MAPPING_HARD_FAILURE,
            message: `Rate limit retry budget exhausted after ${rateLimitAttempts} attempts`,
          },
          retryCount: generationAttempts,
        };
      }
      const delayMs = result.error?.retryAfterMs || baseDelayMs * Math.pow(2, rateLimitAttempts);
      await sleep(delayMs);
      rateLimitAttempts++;
      continue; // Does not consume generation retry budget
    }

    // Generation failure (timeout or malformed) — consumes retry budget
    lastError = result.error;
    generationAttempts++;

    if (generationAttempts <= maxRetries) {
      const delayMs = baseDelayMs * Math.pow(2, generationAttempts - 1);
      await sleep(delayMs);
    }
  }

  // Budget exhausted — map to appropriate terminal error type
  const lastType = lastError?.type;
  const terminalType =
    lastType === 'AIMappingTimeout'
      ? ErrorTypes.AI_MAPPING_TIMEOUT
      : ErrorTypes.AI_MAPPING_MALFORMED_OUTPUT;

  return {
    success: false,
    error: {
      type: terminalType,
      message: lastError?.message || 'Retry budget exhausted',
    },
    retryCount: generationAttempts,
  };
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
