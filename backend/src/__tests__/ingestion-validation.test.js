/**
 * Ingestion Validation Tests
 * Phase 4: File and content validation testing
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';

// eslint-disable-next-line no-restricted-imports
import { 
  validateRawFile, 
  validateParsedRows, 
  validateAndProcessHeaders, 
  filterEmptyRows
} from '../pipeline/ingestion/validation.js';
import { CONFIG } from '../config/index.js';

describe('Raw File Validation', () => {
  beforeEach(() => {
    CONFIG.reset();
  });

  test('should validate normal file', () => {
    const buffer = Buffer.from('Name,Email\nJohn,john@example.com', 'utf8');
    
    // Should not throw
    assert.doesNotThrow(() => validateRawFile(buffer));
  });

  test('should reject empty file', () => {
    const buffer = Buffer.alloc(0);
    
    assert.throws(() => validateRawFile(buffer), {
      message: /empty or unreadable/i
    });
  });

  test('should reject null/undefined', () => {
    assert.throws(() => validateRawFile(null));
    assert.throws(() => validateRawFile(undefined));
  });

  test('should enforce file size limit from CONFIG', () => {
    CONFIG._setForTesting('max_file_size_bytes', 100);
    
    const largeBuffer = Buffer.alloc(200, 'a');
    
    assert.throws(() => validateRawFile(largeBuffer), {
      message: /exceeds limit/i
    });
  });

  test('should detect binary content', () => {
    // Create buffer with many null bytes (binary indicator)
    const binaryBuffer = Buffer.alloc(100, 0);
    
    assert.throws(() => validateRawFile(binaryBuffer), {
      message: /binary/i
    });
  });
});

describe('Parsed Rows Validation', () => {
  beforeEach(() => {
    CONFIG.reset();
  });

  test('should validate normal parsed rows', () => {
    const rows = [
      ['Name', 'Email'],
      ['John', 'john@example.com']
    ];
    
    assert.doesNotThrow(() => validateParsedRows(rows));
  });

  test('should reject non-array input', () => {
    assert.throws(() => validateParsedRows('not an array'));
    assert.throws(() => validateParsedRows(null));
  });

  test('should reject empty rows array', () => {
    assert.throws(() => validateParsedRows([]), {
      message: /no rows/i
    });
  });

  test('should enforce row count limit from CONFIG', () => {
    CONFIG._setForTesting('file_size_ceiling_rows', 2);
    
    const rows = [
      ['Name', 'Email'],  // header
      ['John', 'john@example.com'],  // row 1
      ['Jane', 'jane@example.com'],  // row 2
      ['Bob', 'bob@example.com']     // row 3 - exceeds limit
    ];
    
    assert.throws(() => validateParsedRows(rows), {
      message: /limit is 2/i
    });
  });

  test('should enforce cell size limit from CONFIG', () => {
    CONFIG._setForTesting('max_cell_size_bytes', 10);
    
    const rows = [
      ['Name', 'Email'],
      ['John', 'a'.repeat(20)] // Cell too large
    ];
    
    assert.throws(() => validateParsedRows(rows), {
      message: /limit is 10 bytes/i
    });
  });

  test('should reject invalid row structure', () => {
    const rows = [
      ['Name', 'Email'],
      'not an array'  // Invalid row
    ];
    
    assert.throws(() => validateParsedRows(rows), {
      message: /not an array/i
    });
  });

  test('should handle null/undefined cells gracefully', () => {
    const rows = [
      ['Name', 'Email'],
      [null, undefined],
      ['John', '']
    ];
    
    // Should not throw for null/undefined cells
    assert.doesNotThrow(() => validateParsedRows(rows));
  });
});

describe('Header Validation and Processing', () => {
  beforeEach(() => {
    CONFIG.reset();
  });

  test('should process normal headers', () => {
    const headers = ['Name', 'Email', 'Phone'];
    
    const result = validateAndProcessHeaders(headers);
    
    assert.deepStrictEqual(result, ['Name', 'Email', 'Phone']);
  });

  test('should resolve duplicate headers', () => {
    const headers = ['Name', 'Name', 'Email', 'Name'];
    
    const result = validateAndProcessHeaders(headers);
    
    assert.deepStrictEqual(result, ['Name', 'Name_1', 'Email', 'Name_2']);
  });

  test('should handle empty headers', () => {
    const headers = ['Name', '', null, undefined];
    
    const result = validateAndProcessHeaders(headers);
    
    assert.deepStrictEqual(result, ['Name', '', '', '']);
  });

  test('should reject empty header array', () => {
    assert.throws(() => validateAndProcessHeaders([]), {
      message: /at least one header/i
    });
  });

  test('should reject non-array input', () => {
    assert.throws(() => validateAndProcessHeaders('not array'));
  });

  test('should enforce header length limit from CONFIG', () => {
    CONFIG._setForTesting('max_header_length', 10);
    
    const headers = ['Name', 'a'.repeat(20)]; // Second header too long
    
    assert.throws(() => validateAndProcessHeaders(headers), {
      message: /limit is 10/i
    });
  });

  test('should convert non-string headers to strings', () => {
    const headers = [123, true, null, undefined];
    
    const result = validateAndProcessHeaders(headers);
    
    assert.deepStrictEqual(result, ['123', 'true', '', '']);
  });
});

describe('Empty Row Filtering', () => {
  test('should filter empty rows', () => {
    const rows = [
      ['John', 'john@example.com'],
      ['', ''],                    // Empty row
      [null, null],               // Empty row  
      [undefined, undefined],     // Empty row
      ['   ', '  '],              // Whitespace only - empty
      ['Jane', 'jane@example.com'],
      ['', 'bob@example.com'],    // Partially empty - keep
    ];
    
    const result = filterEmptyRows(rows);
    
    assert.strictEqual(result.length, 3);
    assert.deepStrictEqual(result, [
      ['John', 'john@example.com'],
      ['Jane', 'jane@example.com'],
      ['', 'bob@example.com']
    ]);
  });

  test('should handle non-array input gracefully', () => {
    assert.deepStrictEqual(filterEmptyRows(null), []);
    assert.deepStrictEqual(filterEmptyRows('not array'), []);
  });

  test('should handle invalid row structures', () => {
    const rows = [
      ['John', 'john@example.com'],
      'not an array',  // Invalid row - filter out
      ['Jane', 'jane@example.com']
    ];
    
    const result = filterEmptyRows(rows);
    
    assert.strictEqual(result.length, 2);
    assert.deepStrictEqual(result, [
      ['John', 'john@example.com'],
      ['Jane', 'jane@example.com']
    ]);
  });

  test('should preserve rows with some content', () => {
    const rows = [
      ['', '', 'some content'],  // Has content
      ['', '', ''],             // No content - filter
      [null, undefined, 0],     // Has content (0 is falsy but valid)
    ];
    
    const result = filterEmptyRows(rows);
    
    assert.strictEqual(result.length, 2);
  });
});