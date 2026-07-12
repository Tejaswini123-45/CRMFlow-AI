/**
 * DelimiterDetector Tests
 * Phase 4: Delimiter detection abstraction testing
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';

// eslint-disable-next-line no-restricted-imports
import { 
  DelimiterDetector, 
  HeuristicDelimiterDetector, 
  createDefaultDelimiterDetector 
} from '../pipeline/ingestion/delimiter-detector.js';

describe('DelimiterDetector Abstraction', () => {
  test('should have abstract interface', async () => {
    const detector = new DelimiterDetector();
    
    await assert.rejects(
      async () => await detector.detect('test'),
      /must be implemented by subclass/
    );
  });

  test('should create default detector', () => {
    const detector = createDefaultDelimiterDetector();
    assert.ok(detector instanceof HeuristicDelimiterDetector);
  });
});

describe('HeuristicDelimiterDetector', () => {
  let detector;

  beforeEach(() => {
    detector = new HeuristicDelimiterDetector();
  });

  test('should detect comma delimiter', async () => {
    const csvText = `Name,Email,Phone
John Doe,john@example.com,555-1234
Jane Smith,jane@example.com,555-5678`;

    const result = await detector.detect(csvText);
    
    assert.strictEqual(result.delimiter, ',');
    assert.ok(result.confidence > 0.5);
    assert.ok(result.rationale.includes('comma'));
  });

  test('should detect semicolon delimiter', async () => {
    const csvText = `Name;Email;Phone
John Doe;john@example.com;555-1234
Jane Smith;jane@example.com;555-5678`;

    const result = await detector.detect(csvText);
    
    assert.strictEqual(result.delimiter, ';');
    assert.ok(result.confidence > 0.5);
    assert.ok(result.rationale.includes('semicolon'));
  });

  test('should detect tab delimiter', async () => {
    const csvText = `Name\tEmail\tPhone
John Doe\tjohn@example.com\t555-1234
Jane Smith\tjane@example.com\t555-5678`;

    const result = await detector.detect(csvText);
    
    assert.strictEqual(result.delimiter, '\t');
    assert.ok(result.confidence > 0.5);
    assert.ok(result.rationale.includes('tab'));
  });

  test('should handle quoted fields with delimiters', async () => {
    const csvText = `Name,Description,Phone
"John, Jr.","Software, Engineer",555-1234
"Jane Smith","Manager, Senior",555-5678`;

    const result = await detector.detect(csvText);
    
    assert.strictEqual(result.delimiter, ',');
    assert.ok(result.confidence > 0.3); // Should still detect comma despite quotes
  });

  test('should default to comma for ambiguous cases', async () => {
    const csvText = `Name
John
Jane`;

    const result = await detector.detect(csvText);
    
    assert.strictEqual(result.delimiter, ',');
    assert.ok(result.confidence >= 0.1); // Minimum confidence
  });

  test('should handle empty input', async () => {
    const result = await detector.detect('');
    
    assert.strictEqual(result.delimiter, ',');
    assert.strictEqual(result.confidence, 0.5);
    assert.ok(result.rationale.includes('No data lines'));
  });

  test('should handle mixed delimiters by choosing best', async () => {
    const csvText = `Name,Email;Phone
John,john@example.com;555-1234
Jane,jane@example.com;555-5678`;

    const result = await detector.detect(csvText);
    
    // Should pick the most consistent delimiter
    assert.ok([',', ';'].includes(result.delimiter));
    assert.ok(result.confidence > 0);
  });

  test('should be deterministic', async () => {
    const csvText = `Name,Email,Phone
John,john@example.com,555-1234`;

    const result1 = await detector.detect(csvText);
    const result2 = await detector.detect(csvText);
    
    assert.deepStrictEqual(result1, result2);
  });

  test('should respect maxSampleLines option', async () => {
    const csvText = `Name,Email,Phone
John,john@example.com,555-1234
Jane,jane@example.com,555-5678
Bob,bob@example.com,555-9999
Alice,alice@example.com,555-0000`;

    const result = await detector.detect(csvText, { maxSampleLines: 2 });
    
    // Should still detect comma even with limited sample
    assert.strictEqual(result.delimiter, ',');
  });
});