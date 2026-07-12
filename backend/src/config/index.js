/**
 * Configuration Provider (CONFIG)
 * LLD §9 Configuration Strategy
 * 
 * Provides typed access to runtime-tunable configuration values.
 * Deployment-time values (endpoints, environment) are kept in .env, NOT here.
 */

import { DEFAULT_CONFIG } from './default.config.js';

// In-memory configuration store
let currentConfig = { ...DEFAULT_CONFIG };

/**
 * Get configuration value by key
 * 
 * @param {string} key - Configuration key (supports dot notation: 'validation.email_required')
 * @returns {any} Configuration value (deep clone to prevent mutation)
 * @throws {Error} If key is undefined
 */
export function get(key) {
  const keys = key.split('.');
  let value = currentConfig;

  for (const k of keys) {
    if (value === undefined || value === null) {
      throw new Error(`Configuration key '${key}' is undefined`);
    }
    value = value[k];
  }

  if (value === undefined) {
    throw new Error(`Configuration key '${key}' is undefined`);
  }

  // Return deep clone to prevent mutation
  return JSON.parse(JSON.stringify(value));
}

/**
 * Get all configuration (for debugging/testing)
 * @returns {Object} Full configuration object (deep clone)
 */
export function getAll() {
  return JSON.parse(JSON.stringify(currentConfig));
}

/**
 * Reset configuration to defaults (for testing)
 */
export function reset() {
  currentConfig = { ...DEFAULT_CONFIG };
}

/**
 * Update configuration value (for testing)
 * Not exposed in production - configuration should be static after init
 * 
 * @param {string} key - Configuration key
 * @param {any} value - New value
 */
export function _setForTesting(key, value) {
  const keys = key.split('.');
  let target = currentConfig;

  for (let i = 0; i < keys.length - 1; i++) {
    target = target[keys[i]];
  }

  target[keys[keys.length - 1]] = value;
}

// Convenience accessors for common config categories
export const CONFIG = {
  get,
  getAll,
  reset,

  // Typed accessors per LLD §9 categories
  getConfidenceThreshold: () => get('mapping_confidence_threshold'),
  getFileSizeCeiling: () => get('file_size_ceiling_rows'),
  getAIMappingTimeout: () => get('ai_mapping_timeout_ms'),
  getMaxRetries: () => get('ai_mapping_max_retries'),
  getSampleSize: () => get('header_analysis_sample_size'),
  getTargetSchema: () => get('target_schema'),
  getValidationRules: () => get('validation'),
};

export default CONFIG;
