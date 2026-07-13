/**
 * LLM Provider Client
 * LLD §3, §14 — Sole outbound AI integration point
 *
 * This is the only file in the codebase that may import from the OpenAI SDK
 * or make network calls to the LLM provider. AIMAP calls this abstraction;
 * all other components remain unaware of the provider.
 *
 * Architecture boundary: swap the provider by changing this file only.
 * The LLMProviderClient interface is what AIMAP depends on.
 */

import OpenAI from 'openai';

/**
 * @typedef {Object} LLMRequest
 * @property {string} systemPrompt - Segments A, C, E (static per prompt version)
 * @property {string} userPrompt - Segments B, D (dynamic per request)
 * @property {number} timeoutMs - Request timeout in milliseconds
 */

/**
 * @typedef {Object} LLMResponse
 * @property {boolean} success - Whether the call succeeded
 * @property {string} [content] - Raw response content (JSON string) if success
 * @property {Object} [error] - Error details if not success
 * @property {string} [error.type] - Error type from LLD §10
 * @property {string} [error.message] - Human-readable error
 */

/**
 * LLM Provider Client
 *
 * Wraps the OpenAI SDK with the interface AIMAP needs.
 * Handles timeout enforcement, rate-limit detection, and error classification.
 */
export class LLMProviderClient {
  /**
   * @param {Object} [options]
   * @param {string} [options.apiKey] - Override API key (defaults to LLM_API_KEY env var)
   * @param {string} [options.baseURL] - Override base URL (defaults to LLM_API_BASE_URL env var)
   * @param {string} [options.model] - Override model (defaults to LLM_MODEL env var)
   */
  constructor(options = {}) {
    this.model = options.model || process.env.LLM_MODEL || 'gpt-4o-mini';

    this.client = new OpenAI({
      apiKey: options.apiKey || process.env.LLM_API_KEY,
      baseURL: options.baseURL || process.env.LLM_API_BASE_URL || undefined,
    });
  }

  /**
   * Send a prompt and receive a structured JSON response
   *
   * @param {LLMRequest} request
   * @returns {Promise<LLMResponse>}
   */
  async complete(request) {
    const { systemPrompt, userPrompt, timeoutMs } = request;

    // Build AbortController for timeout enforcement
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.client.chat.completions.create(
        {
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          // Request JSON output mode — primary enforcement mechanism (AES §6)
          response_format: { type: 'json_object' },
          temperature: 0, // Maximise determinism for classification tasks
        },
        { signal: controller.signal }
      );

      const content = response.choices?.[0]?.message?.content;

      if (!content) {
        return {
          success: false,
          error: {
            type: 'AIMappingMalformedOutput',
            message: 'Provider returned empty content',
          },
        };
      }

      return { success: true, content };
    } catch (error) {
      // AbortError means our timeout fired
      if (error.name === 'AbortError' || error.code === 'ETIMEDOUT') {
        return {
          success: false,
          error: {
            type: 'AIMappingTimeout',
            message: `Provider timed out after ${timeoutMs}ms`,
          },
        };
      }

      // Rate limiting
      if (error.status === 429) {
        return {
          success: false,
          error: {
            type: 'RateLimited',
            message: 'Provider returned 429 rate limit',
            retryAfterMs: this._parseRetryAfter(error),
          },
        };
      }

      // Auth / unreachable / hard failures
      if (error.status === 401 || error.status === 403) {
        return {
          success: false,
          error: {
            type: 'AIMappingHardFailure',
            message: `Provider authentication failed: ${error.message}`,
          },
        };
      }

      // All other errors treated as hard failures
      return {
        success: false,
        error: {
          type: 'AIMappingHardFailure',
          message: `Provider error: ${error.message}`,
        },
      };
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  /**
   * Parse Retry-After header from rate-limit response
   * @private
   */
  _parseRetryAfter(error) {
    const retryAfter = error.headers?.['retry-after'];
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      return isNaN(seconds) ? 5000 : seconds * 1000;
    }
    return 5000; // Default 5s backoff
  }
}
