/**
 * INGEST Integration Tests
 * Phase 4: End-to-end ingestion testing with real CSV parsing
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

// eslint-disable-next-line no-restricted-imports
import { execute } from '../pipeline/ingestion/index.js';
import { AUDIT } from '../audit/index.js';
import { CONFIG } from '../config/index.js';
import { ErrorTypes } from '../contracts/types.js';

describe('INGEST Integration Tests', () => {
  const import_run_id = 'test-integration-123';
  const context = { import_run_id };

  beforeEach(() => {
    AUDIT.clear();
    CONFIG.reset();
  });

  afterEach(() => {
    AUDIT.clear();
  });

  test('should process standard CSV successfully', async () => {
    const csvContent = `Name,Email,Phone
John Doe,john@example.com,555-1234
Jane Smith,jane@example.com,555-5678`;
    
    const buffer = Buffer.from(csvContent, 'utf8');
    const result = await execute(buffer, context);

    assert.strictEqual(result.success, true);
    assert.ok(result.data);
    
    // Verify ParsedFile structure
    const parsedFile = result.data;
    assert.deepStrictEqual(parsedFile.headers, ['Name', 'Email', 'Phone']);
    assert.strictEqual(parsedFile.row_count, 2);
    assert.strictEqual(parsedFile.rows.length, 2);
    assert.deepStrictEqual(parsedFile.rows[0], ['John Doe', 'john@example.com', '555-1234']);
    assert.strictEqual(parsedFile.encoding, 'utf8');
    assert.strictEqual(parsedFile.delimiter, ',');

    // Verify metadata
    assert.ok(result.metadata.file_info);
    assert.strictEqual(result.metadata.file_info.row_count, 2);
    assert.ok(typeof result.metadata.file_info.encoding_confidence === 'number');
  });

  test('should handle semicolon-delimited CSV', async () => {
    const csvContent = `Name;Email;Phone
John Doe;john@example.com;555-1234
Jane Smith;jane@example.com;555-5678`;
    
    const buffer = Buffer.from(csvContent, 'utf8');
    const result = await execute(buffer, context);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.delimiter, ';');
    assert.deepStrictEqual(result.data.headers, ['Name', 'Email', 'Phone']);
  });

  test('should handle tab-delimited CSV', async () => {
    const csvContent = `Name\tEmail\tPhone
John Doe\tjohn@example.com\t555-1234`;
    
    const buffer = Buffer.from(csvContent, 'utf8');
    const result = await execute(buffer, context);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.delimiter, '\t');
  });

  test('should handle quoted fields with embedded delimiters', async () => {
    const csvContent = `Name,Description,Phone
"John, Jr.","Software, Engineer",555-1234
"Jane Smith","Manager, Senior",555-5678`;
    
    const buffer = Buffer.from(csvContent, 'utf8');
    const result = await execute(buffer, context);

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.data.rows[0], ['John, Jr.', 'Software, Engineer', '555-1234']);
  });

  test('should filter empty rows', async () => {
    const csvContent = `Name,Email

John Doe,john@example.com

Jane Smith,jane@example.com
   ,   `;
    
    const buffer = Buffer.from(csvContent, 'utf8');
    const result = await execute(buffer, context);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.row_count, 2); // Empty rows filtered
    assert.strictEqual(result.data.rows.length, 2);
  });

  test('should resolve duplicate headers', async () => {
    const csvContent = `Name,Name,Email,Name
John,Doe,john@example.com,Jr`;
    
    const buffer = Buffer.from(csvContent, 'utf8');
    const result = await execute(buffer, context);

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.data.headers, ['Name', 'Name_1', 'Email', 'Name_2']);
  });

  test('should create complete audit trail', async () => {
    const csvContent = `Name,Email
John,john@example.com`;
    
    const buffer = Buffer.from(csvContent, 'utf8');
    await execute(buffer, context);

    const auditRecords = AUDIT.query(import_run_id);
    
    // Should have multiple audit entries
    assert.ok(auditRecords.length >= 3);
    
    // Check for expected audit subjects
    const subjects = auditRecords.map(r => r.subject);
    assert.ok(subjects.includes('encoding_detection') || subjects.includes('encoding_fallback'));
    assert.ok(subjects.includes('delimiter_detection'));
    assert.ok(subjects.includes('parsing_complete'));

    // Verify audit structure
    auditRecords.forEach(record => {
      assert.strictEqual(record.import_run_id, import_run_id);
      assert.strictEqual(record.stage, 'PARSING');
      assert.ok(record.subject);
      assert.ok(record.decision);
      assert.ok(record.rationale);
      assert.ok(record.timestamp instanceof Date);
    });
  });

  test('should handle empty file error', async () => {
    const buffer = Buffer.alloc(0);
    const result = await execute(buffer, context);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.type, ErrorTypes.EMPTY_OR_UNREADABLE_FILE);
  });

  test('should handle file size limit', async () => {
    CONFIG._setForTesting('max_file_size_bytes', 50);
    
    const largeCsv = 'Name,Email\n' + 'a'.repeat(100);
    const buffer = Buffer.from(largeCsv, 'utf8');
    const result = await execute(buffer, context);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.type, ErrorTypes.STRUCTURAL_PARSE_ERROR);
    assert.ok(result.error.message.includes('exceeds limit'));
  });

  test('should handle row count limit', async () => {
    CONFIG._setForTesting('file_size_ceiling_rows', 1);
    
    const csvContent = `Name,Email
John,john@example.com
Jane,jane@example.com`;
    
    const buffer = Buffer.from(csvContent, 'utf8');
    const result = await execute(buffer, context);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.type, ErrorTypes.STRUCTURAL_PARSE_ERROR);
    assert.ok(result.error.message.includes('limit is 1'));
  });

  test('should handle malformed CSV', async () => {
    const malformedCsv = `Name,Email
John,"unclosed quote
Jane,jane@example.com`;
    
    const buffer = Buffer.from(malformedCsv, 'utf8');
    const result = await execute(buffer, context);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.type, ErrorTypes.STRUCTURAL_PARSE_ERROR);
    assert.ok(result.error.message.includes('CSV parsing failed'));
  });

  test('should be deterministic for identical inputs', async () => {
    const csvContent = `Name,Email
John,john@example.com`;
    
    const buffer1 = Buffer.from(csvContent, 'utf8');
    const buffer2 = Buffer.from(csvContent, 'utf8');
    
    const result1 = await execute(buffer1, { import_run_id: 'test1' });
    const result2 = await execute(buffer2, { import_run_id: 'test2' });

    // Results should be identical (excluding import_run_id specific data)
    assert.strictEqual(result1.success, result2.success);
    assert.deepStrictEqual(result1.data.headers, result2.data.headers);
    assert.deepStrictEqual(result1.data.rows, result2.data.rows);
    assert.strictEqual(result1.data.encoding, result2.data.encoding);
    assert.strictEqual(result1.data.delimiter, result2.data.delimiter);
  });

  test('should handle variable column counts gracefully', async () => {
    const csvContent = `Name,Email,Phone
John,john@example.com,555-1234
Jane,jane@example.com
Bob,bob@example.com,555-9999,extra`;
    
    const buffer = Buffer.from(csvContent, 'utf8');
    const result = await execute(buffer, context);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.rows.length, 3);
    
    // Should handle short and long rows
    assert.deepStrictEqual(result.data.rows[1], ['Jane', 'jane@example.com']);
    assert.deepStrictEqual(result.data.rows[2], ['Bob', 'bob@example.com', '555-9999', 'extra']);
  });

  test('should handle Latin-1 encoded files', async () => {
    const csvContent = `Name,Email
José,jose@example.com`;
    
    const buffer = Buffer.from(csvContent, 'latin1');
    const result = await execute(buffer, context);

    // Should succeed (may detect as latin1 or fallback to utf8)
    assert.strictEqual(result.success, true);
    assert.ok(result.data.rows[0][0]); // Should have some name
  });

  test('should handle files with only headers', async () => {
    const csvContent = `Name,Email,Phone`;
    
    const buffer = Buffer.from(csvContent, 'utf8');
    const result = await execute(buffer, context);

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.data.headers, ['Name', 'Email', 'Phone']);
    assert.strictEqual(result.data.row_count, 0);
    assert.deepStrictEqual(result.data.rows, []);
  });

  test('should handle context without import_run_id', async () => {
    const csvContent = `Name,Email
John,john@example.com`;
    
    const buffer = Buffer.from(csvContent, 'utf8');
    
    // Should not crash even without proper context
    const result = await execute(buffer, {});
    assert.strictEqual(result.success, true);
  });

  test('should enforce cell size limits', async () => {
    CONFIG._setForTesting('max_cell_size_bytes', 10);
    
    const csvContent = `Name,Email
John,${'a'.repeat(20)}`; // Second cell too large
    
    const buffer = Buffer.from(csvContent, 'utf8');
    const result = await execute(buffer, context);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.type, ErrorTypes.STRUCTURAL_PARSE_ERROR);
    assert.ok(result.error.message.includes('limit is 10 bytes'));
  });
});