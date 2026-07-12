/**
 * Config Provider Tests
 * Phase 2 - Validates CONFIG.get() for all LLD §9 categories
 */

import { CONFIG, reset, _setForTesting } from '../config/index.js';

describe('CONFIG Provider (LLD §9)', () => {
  beforeEach(() => {
    reset(); // Reset to defaults before each test
  });

  describe('CONFIG.get() - Basic Functionality', () => {
    it('should return value for valid key', () => {
      const threshold = CONFIG.get('mapping_confidence_threshold');
      expect(threshold).toBe(0.75);
    });

    it('should support dot notation for nested keys', () => {
      const emailRequired = CONFIG.get('validation.email_required');
      expect(emailRequired).toBe(true);
    });

    it('should throw error for undefined key', () => {
      expect(() => CONFIG.get('nonexistent_key')).toThrow(
        "Configuration key 'nonexistent_key' is undefined"
      );
    });

    it('should throw error for nested undefined key', () => {
      expect(() => CONFIG.get('validation.nonexistent')).toThrow(
        "Configuration key 'validation.nonexistent' is undefined"
      );
    });

    it('should return deep clone to prevent mutation', () => {
      const schema1 = CONFIG.get('target_schema');
      schema1.fields.push({ id: 'test' });

      const schema2 = CONFIG.get('target_schema');
      expect(schema2.fields).not.toContainEqual({ id: 'test' });
    });
  });

  describe('CONFIG.get() - All LLD §9 Categories', () => {
    it('should return pipeline thresholds', () => {
      expect(CONFIG.get('mapping_confidence_threshold')).toBe(0.75);
      expect(CONFIG.get('file_size_ceiling_rows')).toBe(10000);
    });

    it('should return retry/timeout policy', () => {
      expect(CONFIG.get('ai_mapping_timeout_ms')).toBe(30000);
      expect(CONFIG.get('ai_mapping_max_retries')).toBe(3);
    });

    it('should return sampling configuration', () => {
      expect(CONFIG.get('header_analysis_sample_size')).toBe(10);
    });

    it('should return target schema definition', () => {
      const schema = CONFIG.get('target_schema');
      expect(schema.fields).toBeDefined();
      expect(Array.isArray(schema.fields)).toBe(true);
      expect(schema.fields.length).toBeGreaterThan(0);
    });

    it('should return validation rules', () => {
      const rules = CONFIG.get('validation');
      expect(rules.email_required).toBe(true);
      expect(rules.phone_required).toBe(false);
      expect(rules.min_phone_digits).toBe(7);
    });
  });

  describe('Target Schema (PRD §9)', () => {
    it('should have all required CRM fields from PRD §9', () => {
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
        expect(fieldIds).toContain(field);
      });
    });

    it('should have complete field structure per PRD §9', () => {
      const schema = CONFIG.get('target_schema');
      const emailField = schema.fields.find((f) => f.id === 'email');

      expect(emailField).toBeDefined();
      expect(emailField.business_meaning).toBeDefined();
      expect(emailField.alternative_names).toBeDefined();
      expect(Array.isArray(emailField.alternative_names)).toBe(true);
      expect(emailField.required).toBeDefined();
      expect(emailField.data_type).toBeDefined();
    });

    it('should have alternative names for semantic mapping', () => {
      const schema = CONFIG.get('target_schema');
      const phoneField = schema.fields.find((f) => f.id === 'phone_number');

      expect(phoneField.alternative_names).toContain('Mobile');
      expect(phoneField.alternative_names).toContain('Contact No.');
      expect(phoneField.alternative_names.length).toBeGreaterThan(0);
    });
  });

  describe('Typed Accessors', () => {
    it('should provide convenience accessors for common categories', () => {
      expect(CONFIG.getConfidenceThreshold()).toBe(0.75);
      expect(CONFIG.getFileSizeCeiling()).toBe(10000);
      expect(CONFIG.getAIMappingTimeout()).toBe(30000);
      expect(CONFIG.getMaxRetries()).toBe(3);
      expect(CONFIG.getSampleSize()).toBe(10);
      expect(CONFIG.getTargetSchema()).toBeDefined();
      expect(CONFIG.getValidationRules()).toBeDefined();
    });
  });

  describe('Design Constraints (LLD §9)', () => {
    it('should NOT contain deployment-time values', () => {
      // CONFIG should not have endpoints, environment names, credentials
      // These belong in .env, not CONFIG
      const allConfig = CONFIG.getAll();

      expect(allConfig.llm_provider_endpoint).toBeUndefined();
      expect(allConfig.database_url).toBeUndefined();
      expect(allConfig.environment).toBeUndefined();
      expect(allConfig.api_key).toBeUndefined();
    });

    it('should only contain runtime-tunable values', () => {
      const allConfig = CONFIG.getAll();

      // All top-level keys should be runtime-tunable per LLD §9
      const validCategories = [
        'mapping_confidence_threshold',
        'file_size_ceiling_rows',
        'ai_mapping_timeout_ms',
        'ai_mapping_max_retries',
        'header_analysis_sample_size',
        'target_schema',
        'validation',
      ];

      Object.keys(allConfig).forEach((key) => {
        expect(validCategories).toContain(key);
      });
    });
  });

  describe('Testing Utilities', () => {
    it('should support reset() for test isolation', () => {
      _setForTesting('mapping_confidence_threshold', 0.5);
      expect(CONFIG.get('mapping_confidence_threshold')).toBe(0.5);

      reset();
      expect(CONFIG.get('mapping_confidence_threshold')).toBe(0.75);
    });

    it('should support _setForTesting() for test scenarios', () => {
      _setForTesting('file_size_ceiling_rows', 5000);
      expect(CONFIG.get('file_size_ceiling_rows')).toBe(5000);

      reset();
      expect(CONFIG.get('file_size_ceiling_rows')).toBe(10000);
    });
  });
});
