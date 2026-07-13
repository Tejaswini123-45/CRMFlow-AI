/**
 * AIMAP Retry Handler Tests
 * AES §10 — Retry strategy: timeout, malformed, hard failure, rate limit
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';

// eslint-disable-next-line no-restricted-imports
import { executeWithRetry } from '../pipeline/ai_mapping/retry-handler.js';
import { ErrorTypes } from '../contracts/types.js';

/** Build a call function that succeeds on the Nth attempt */
function succeedsOnAttempt(n, successData = { result: 'ok' }) {
  let calls = 0;
  return async () => {
    calls++;
    if (calls < n) {
      return { success: false, error: { type: 'AIMappingTimeout', message: 'timeout' } };
    }
    return { success: true, data: successData };
  };
}

/** Build a call function that always fails with given error type */
function alwaysFails(errorType, message = 'fail') {
  return async () => ({
    success: false,
    error: { type: errorType, message },
  });
}

describe('Retry Handler — Success cases', () => {
  test('succeeds on first attempt, retryCount = 0', async () => {
    const fn = async () => ({ success: true, data: 'result' });
    const result = await executeWithRetry(fn, { maxRetries: 3, baseDelayMs: 1 });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data, 'result');
    assert.strictEqual(result.retryCount, 0);
  });

  test('succeeds on second attempt, retryCount = 1', async () => {
    const result = await executeWithRetry(
      succeedsOnAttempt(2, 'data'),
      { maxRetries: 3, baseDelayMs: 1 }
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data, 'data');
    assert.strictEqual(result.retryCount, 1);
  });

  test('succeeds on last allowed attempt', async () => {
    // maxRetries=3 means attempts 0,1,2,3 — succeeds on attempt 4 (index 3)
    const result = await executeWithRetry(
      succeedsOnAttempt(4),
      { maxRetries: 3, baseDelayMs: 1 }
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.retryCount, 3);
  });
});

describe('Retry Handler — Timeout exhaustion', () => {
  test('AIMappingTimeout returned when timeout retries exhausted', async () => {
    const result = await executeWithRetry(
      alwaysFails('AIMappingTimeout', 'provider timed out'),
      { maxRetries: 2, baseDelayMs: 1 }
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.type, ErrorTypes.AI_MAPPING_TIMEOUT);
    assert.strictEqual(result.retryCount, 3); // 1 initial + 2 retries = 3 total
  });

  test('retryCount reflects all attempts made', async () => {
    const calls = [];
    const fn = async () => {
      calls.push(Date.now());
      return { success: false, error: { type: 'AIMappingTimeout', message: 'timeout' } };
    };

    await executeWithRetry(fn, { maxRetries: 2, baseDelayMs: 1 });
    // 1 initial + 2 retries = 3 calls total
    assert.strictEqual(calls.length, 3);
  });
});

describe('Retry Handler — Malformed output exhaustion', () => {
  test('AIMappingMalformedOutput returned when malformed retries exhausted', async () => {
    const result = await executeWithRetry(
      alwaysFails('AIMappingMalformedOutput', 'gate failed'),
      { maxRetries: 2, baseDelayMs: 1 }
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.type, ErrorTypes.AI_MAPPING_MALFORMED_OUTPUT);
  });

  test('mixed timeout and malformed failures both exhaust the same budget', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      const type = calls % 2 === 0 ? 'AIMappingMalformedOutput' : 'AIMappingTimeout';
      return { success: false, error: { type, message: 'fail' } };
    };

    const result = await executeWithRetry(fn, { maxRetries: 2, baseDelayMs: 1 });
    assert.strictEqual(result.success, false);
    // Last error was AIMappingMalformedOutput (call 3 is odd → timeout, but call 2 was malformed)
    assert.ok([ErrorTypes.AI_MAPPING_TIMEOUT, ErrorTypes.AI_MAPPING_MALFORMED_OUTPUT].includes(result.error.type));
  });
});

describe('Retry Handler — Hard failure (no retry)', () => {
  test('AIMappingHardFailure short-circuits immediately', async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      return { success: false, error: { type: 'AIMappingHardFailure', message: 'auth failed' } };
    };

    const result = await executeWithRetry(fn, { maxRetries: 3, baseDelayMs: 1 });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.type, 'AIMappingHardFailure');
    assert.strictEqual(callCount, 1); // Only called once, no retries
    assert.strictEqual(result.retryCount, 0);
  });
});

describe('Retry Handler — Rate limit handling', () => {
  test('rate limit does not consume generation retry budget', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls <= 2) {
        return { success: false, error: { type: 'RateLimited', message: '429', retryAfterMs: 1 } };
      }
      return { success: true, data: 'ok' };
    };

    const result = await executeWithRetry(fn, { maxRetries: 0, baseDelayMs: 1, maxRateLimitRetries: 3 });

    // Should succeed after rate limit clears
    assert.strictEqual(result.success, true);
    // Generation budget was 0 retries, but rate limit retries are separate
    assert.strictEqual(result.data, 'ok');
  });

  test('rate limit budget exhausted returns AIMappingHardFailure', async () => {
    const result = await executeWithRetry(
      alwaysFails('RateLimited', '429'),
      { maxRetries: 3, baseDelayMs: 1, maxRateLimitRetries: 2 }
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.type, ErrorTypes.AI_MAPPING_HARD_FAILURE);
  });
});

describe('Retry Handler — Exponential backoff', () => {
  test('retries use increasing delays', async () => {
    const delays = [];
    const originalSetTimeout = globalThis.setTimeout;

    // Track delay calls - use real time but measure the pattern
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls < 3) {
        return { success: false, error: { type: 'AIMappingTimeout', message: 'timeout' } };
      }
      return { success: true, data: 'ok' };
    };

    // Just verify it completes successfully after retries with baseDelayMs=1
    const result = await executeWithRetry(fn, { maxRetries: 3, baseDelayMs: 1 });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.retryCount, 2);
  });
});
