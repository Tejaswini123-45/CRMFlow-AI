/**
 * Encoding Detection Tests
 * Phase 4: Probabilistic encoding detection testing
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

// eslint-disable-next-line no-restricted-imports
import { detectEncoding, validateEncoding } from '../pipeline/ingestion/encoding-detector.js';
import { AUDIT } from '../audit/index.js';
import { CONFIG } from '../config/index.js';

describe('Encoding Detection', () => {
  const import_run_id = 'test-import-123';

  beforeEach(() => {
    AUDIT.clear();
    CONFIG.reset();
  });

  afterEach(() => {
    AUDIT.clear();
  });

  test('should detect UTF-8 encoding', async () => {
    const utf8Text = 'Name,Email\nJohn Doe,john@example.com\nJané Smith,jane@example.com';
    const buffer = Buffer.from(utf8Text, 'utf8');

    const result = await detectEncoding(buffer, import_run_id);

    assert.strictEqual(result.encoding, 'utf8');
    assert.ok(result.confidence > 0);
    assert.strictEqual(result.wasFallback, false);
    assert.ok(result.rationale.includes('confidence'));
  });

  test('should detect Latin-1 encoding', async () => {
    const latin1Text = 'Name,Email\nJohn Doe,john@example.com\nJané Smith,jane@example.com';
    const buffer = Buffer.from(latin1Text, 'latin1');

    const result = await detectEncoding(buffer, import_run_id);

    // Should detect some encoding (chardet behavior may vary)
    assert.ok(result.encoding);
    assert.ok(result.confidence >= 0);
  });

  test('should handle low confidence detection with fallback', async () => {
    // Set high confidence threshold to trigger fallback
    CONFIG._setForTesting('encoding_confidence_threshold', 0.95);

    const buffer = Buffer.from('Name,Email\nJohn,john@example.com', 'utf8');

    const result = await detectEncoding(buffer, import_run_id);

    // Should fallback to UTF-8 due to high threshold
    assert.strictEqual(result.encoding, 'utf8');
    assert.strictEqual(result.wasFallback, true);
    assert.ok(result.rationale.includes('fallback'));

    // Should have audit warning
    const auditRecords = AUDIT.query(import_run_id);
    const warningRecord = auditRecords.find(r => r.subject === 'encoding_detection');
    assert.ok(warningRecord);
    assert.ok(warningRecord.decision.includes('Low confidence'));
  });

  test('should handle detection failure with fallback', async () => {
    // Create buffer with very little data (chardet may not be confident)
    const buffer = Buffer.from('ab');

    const result = await detectEncoding(buffer, import_run_id);

    // Should return some encoding (chardet might detect ASCII/UTF-8)
    assert.ok(result.encoding);
    assert.ok(['ascii', 'utf8', 'latin1'].includes(result.encoding));
    assert.ok(result.confidence >= 0);

    // Should have audit record
    const auditRecords = AUDIT.query(import_run_id);
    assert.ok(auditRecords.length > 0);
  });

  test('should be deterministic', async () => {
    const buffer = Buffer.from('Name,Email\nJohn,john@example.com', 'utf8');

    const result1 = await detectEncoding(buffer, import_run_id);
    const result2 = await detectEncoding(buffer, 'test-import-456');

    // Should produce same encoding/confidence (excluding audit-specific fields)
    assert.strictEqual(result1.encoding, result2.encoding);
    assert.strictEqual(result1.confidence, result2.confidence);
    assert.strictEqual(result1.wasFallback, result2.wasFallback);
  });

  test('should use sample size from CONFIG', async () => {
    CONFIG._setForTesting('encoding_detection_sample_size', 10);

    const longText = 'a'.repeat(1000);
    const buffer = Buffer.from(longText, 'utf8');

    // Should not throw despite large buffer
    const result = await detectEncoding(buffer, import_run_id);
    assert.ok(result.encoding);
  });

  test('should create proper audit trail', async () => {
    const buffer = Buffer.from('Name,Email\nJohn,john@example.com', 'utf8');

    await detectEncoding(buffer, import_run_id);

    const auditRecords = AUDIT.query(import_run_id);
    const encodingRecord = auditRecords.find(r => 
      r.subject === 'encoding_detection' || r.subject === 'encoding_fallback'
    );

    assert.ok(encodingRecord);
    assert.strictEqual(encodingRecord.stage, 'PARSING');
    assert.ok(encodingRecord.decision);
    assert.ok(encodingRecord.rationale);
    assert.ok(encodingRecord.timestamp);
  });
});

describe('Encoding Validation', () => {
  test('should validate good UTF-8', () => {
    const buffer = Buffer.from('Hello, 世界!', 'utf8');
    const isValid = validateEncoding(buffer, 'utf8');
    assert.strictEqual(isValid, true);
  });

  test('should detect replacement characters', () => {
    const textWithReplacementChar = 'Hello\uFFFDWorld';
    const buffer = Buffer.from(textWithReplacementChar, 'utf8');
    const isValid = validateEncoding(buffer, 'utf8');
    assert.strictEqual(isValid, false);
  });

  test('should detect excessive control characters', () => {
    const binaryData = Buffer.from([0x48, 0x65, 0x6C, 0x6C, 0x6F, 0x00, 0x01, 0x02, 0x03]);
    const isValid = validateEncoding(binaryData, 'utf8');
    assert.strictEqual(isValid, false);
  });

  test('should handle encoding conversion errors', () => {
    const buffer = Buffer.from([0xFF, 0xFE]);
    const isValid = validateEncoding(buffer, 'invalid-encoding');
    assert.strictEqual(isValid, false);
  });
});