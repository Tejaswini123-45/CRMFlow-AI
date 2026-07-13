/**
 * Config Provider Tests
 * Phase 2 - Validates CONFIG.get() for all LLD §9 categories
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { CONFIG, reset, _setForTesting } from '../config/index.js';

describe('CONFIG Provider (LLD §9)', () => {
  beforeEach(() => {
    reset(); // Reset to defaults before each test
  });

  describe('CONFIG.get() - Basic Functionality', () => {
    test('should return value for valid key', () => {
      const threshold = CONFIG.get('mapping_confidence_threshold');
      assert.strictEqual(threshold, 0.75);
    });

    test('should support dot notation for nested keys', () => {
      const emailRequired = CONFIG.get('validation.email_required');
      assert.strictEqual(emailRequired, true);
    });

    test('should throw error for undefined key', () => {
      assert.throws(
        () => CONFIG.get('nonexistent_key'),
        /Configuration key 'nonexistent_key' is undefined/
      );
    });

    test('should throw error for nested undefined key', () => {
      assert.throws(
        () => CONFIG.get('validation.nonexistent'),
        /Configuration key 'validation.nonexistent' is undefined/
      );
    });

    test('should return deep clone to prevent mutation', () => {
      const schema1 = CONFIG.get('target_schema');
      schema1.fields.push({ id: 'test' });

      const schema2 = CONFIG.get('target_schema');
      assert.ok(!schema2.fields.some((f) => f.id === 'test'));
    });
  });

  describe('CONFIG.get() - All LLD §9 Categories', () => {
    test('should return pipeline thresholds', () => {
      assert.strictEqual(CONFIG.get('mapping_confidence_threshold'), 0.75);
      assert.strictEqual(CONFIG.get('file_size_ceiling_rows'), 10000);
    });

    test('should return retry/timeout policy', () => {
      assert.strictEqual(CONFIG.get('ai_mapping_timeout_ms'), 30000);
      assert.strictEqual(CONFIG.get('ai_mapping_max_retries'), 3);
    });

    test('should return sampling configuration', () => {
      assert.strictEqual(CONFIG.get('header_analysis_sample_size'), 10);
    });

    test('should return target schema definition', () => {
      const schema = CONFIG.get('target_schema');
      assert.ok(schema.fields !== undefined);
      assert.strictEqual(Array.isArray(schema.fields), true);
      assert.ok(schema.fields.length > 0);
    });

    test('should return validation rules', () => {
      const rules = CONFIG.get('validation');
      assert.strictEqual(rules.email_required, true);
      assert.strictEqual(rules.phone_required, false);
      assert.strictEqual(rules.min_phone_digits, 7);
    });
  });

  describe('Target Schema (PRD §9)', () => {
    test('should have all required CRM fields from PRD §9', () => {
      const schema = CONFIG.get('target_schema');
      const fieldIds = schema.fields.map((f) => f.id);

      const requiredFields = [
        'first_name',
        'last_name',
        'email',
        'phone_number',
        'source',
        'created_date',
        'notes',
        'company',
        'status',
      ];

      requiredFields.forEach((field) => {
        assert.ok(fieldIds.includes(field), `Missing field: ${field}`);
      });
    });

    test('should have complete field structure per PRD §9', () => {
      const schema = CONFIG.get('target_schema');
      const emailField = schema.fields.find((f) => f.id === 'email');

      assert.ok(emailField !== undefined);
      assert.ok(emailField.business_meaning !== undefined);
      assert.ok(emailField.alternative_names !== undefined);
      assert.strictEqual(Array.isArray(emailField.alternative_names), true);
      assert.ok(emailField.required !== undefined);
      assert.ok(emailField.data_type !== undefined);
    });

    test('should have alternative names for semantic mapping', () => {
      const schema = CONFIG.get('target_schema');
      const phoneField = schema.fields.find((f) => f.id === 'phone_number');

      assert.ok(phoneField.alternative_names.includes('Mobile'));
      assert.ok(phoneField.alternative_names.includes('Contact No.'));
      assert.ok(phoneField.alternative_names.length > 0);
    });
  });

  describe('Typed Accessors', () => {
    test('should provide convenience accessors for common categories', () => {
      assert.strictEqual(CONFIG.getConfidenceThreshold(), 0.75);
      assert.strictEqual(CONFIG.getFileSizeCeiling(), 10000);
      assert.strictEqual(CONFIG.getAIMappingTimeout(), 30000);
      assert.strictEqual(CONFIG.getMaxRetries(), 3);
      assert.strictEqual(CONFIG.getSampleSize(), 10);
      assert.ok(CONFIG.getTargetSchema() !== undefined);
      assert.ok(CONFIG.getValidationRules() !== undefined);
    });
  });

  describe('Design Constraints (LLD §9)', () => {
    test('should NOT contain deployment-time values', () => {
      // CONFIG should not have endpoints, environment names, credentials
      // These belong in .env, not CONFIG
      const allConfig = CONFIG.getAll();

      assert.strictEqual(allConfig.llm_provider_endpoint, undefined);
      assert.strictEqual(allConfig.database_url, undefined);
      assert.strictEqual(allConfig.environment, undefined);
      assert.strictEqual(allConfig.api_key, undefined);
    });

    test('should only contain runtime-tunable values', () => {
      const allConfig = CONFIG.getAll();

      // Deployment-time values that must NOT appear in CONFIG (LLD §9)
      const forbiddenKeys = [
        'llm_provider_endpoint', 'database_url', 'environment',
        'api_key', 'secret', 'password', 'token',
      ];

      forbiddenKeys.forEach((key) => {
        assert.strictEqual(
          allConfig[key],
          undefined,
          `Deployment-time key '${key}' must not be in CONFIG`
        );
      });

      // CONFIG must be non-empty and contain known categories
      assert.ok(Object.keys(allConfig).length > 0);
    });
  });

  describe('Testing Utilities', () => {
    test('should support reset() for test isolation', () => {
      _setForTesting('mapping_confidence_threshold', 0.5);
      assert.strictEqual(CONFIG.get('mapping_confidence_threshold'), 0.5);

      reset();
      assert.strictEqual(CONFIG.get('mapping_confidence_threshold'), 0.75);
    });

    test('should support _setForTesting() for test scenarios', () => {
      _setForTesting('file_size_ceiling_rows', 5000);
      assert.strictEqual(CONFIG.get('file_size_ceiling_rows'), 5000);

      reset();
      assert.strictEqual(CONFIG.get('file_size_ceiling_rows'), 10000);
    });
  });
});
