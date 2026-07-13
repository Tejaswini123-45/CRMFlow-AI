/**
 * Basic Setup Test
 * Phase 1 — Verifies test infrastructure is working
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';

describe('Test Setup', () => {
  test('should run tests successfully', () => {
    assert.strictEqual(true, true);
  });
  
  test('should have basic JavaScript working', () => {
    const testObject = {
      name: 'test',
      value: 42,
    };
    
    assert.strictEqual(testObject.name, 'test');
    assert.strictEqual(testObject.value, 42);
  });
});
