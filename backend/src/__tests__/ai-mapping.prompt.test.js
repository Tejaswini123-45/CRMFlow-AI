/**
 * AIMAP Prompt Assembly Tests
 * Phase 6 (AIMAP): Segment construction, deterministic output, schema injection
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';

// eslint-disable-next-line no-restricted-imports
import {
  buildSegmentA,
  buildSegmentB,
  buildSegmentC,
  buildSegmentD,
  buildSegmentE,
} from '../pipeline/ai_mapping/prompt/segments.js';
// eslint-disable-next-line no-restricted-imports
import { PROMPT_VERSION } from '../pipeline/ai_mapping/prompt/version.js';

describe('Prompt Segments — Individual segments', () => {
  test('Segment A contains uncertainty instruction', () => {
    const segA = buildSegmentA();
    assert.ok(segA.length > 0);
    // Check for AES §3 "most important sentence" about UNMAPPED preference
    assert.ok(segA.toLowerCase().includes('unmapped'));
    assert.ok(segA.toLowerCase().includes('uncertain') || segA.toLowerCase().includes('confidence'));
  });

  test('Segment A is task framing (not schema-specific)', () => {
    const segA = buildSegmentA();
    // Should not contain specific field names from schema
    assert.ok(!segA.includes('first_name'));
    assert.ok(!segA.includes('email'));
    assert.ok(!segA.includes('company'));
  });

  test('Segment B assembles schema from provided schema fields', () => {
    const mockSchema = [
      { id: 'first_name', business_meaning: 'Person first name', alternative_names: ['given_name'] },
      { id: 'email', business_meaning: 'Email address', alternative_names: [] },
      { id: 'company', business_meaning: 'Company name', alternative_names: ['organization'] },
    ];

    const segB = buildSegmentB(mockSchema);
    assert.ok(segB.includes('first_name'));
    assert.ok(segB.includes('Person first name'));
    assert.ok(segB.includes('email'));
    assert.ok(segB.includes('Email address'));
    assert.ok(segB.includes('company'));
    assert.ok(segB.includes('Company name'));
    assert.ok(segB.includes('UNMAPPED'));
  });

  test('Segment B includes alternative names when present', () => {
    const mockSchema = [
      { id: 'phone_number', business_meaning: 'Phone number', alternative_names: ['mobile', 'tel'] },
    ];

    const segB = buildSegmentB(mockSchema);
    assert.ok(segB.includes('mobile'));
    assert.ok(segB.includes('tel'));
  });

  test('Segment C contains few-shot examples', () => {
    const segC = buildSegmentC();
    assert.ok(segC.length > 0);
    // Should contain examples with UNMAPPED (AES §5)
    assert.ok(segC.includes('UNMAPPED'));
    // Should contain example column headers and rationales
    assert.ok(segC.includes('column_header'));
    assert.ok(segC.includes('rationale'));
  });

  test('Segment D assembles column profiles correctly', () => {
    const mockProfiles = [
      {
        header: 'Full Name',
        sample_values: ['John Doe', 'Jane Smith'],
        column_index: 0,
      },
      {
        header: 'Email',
        sample_values: ['john@example.com', 'jane@example.com'],
        column_index: 1,
      },
      {
        header: 'Empty Column',
        sample_values: [], // All-null column
        column_index: 2,
      },
    ];

    const segD = buildSegmentD(mockProfiles);

    // Check column headers included
    assert.ok(segD.includes('Full Name'));
    assert.ok(segD.includes('Email'));
    assert.ok(segD.includes('Empty Column'));

    // Check sample values included
    assert.ok(segD.includes('John Doe'));
    assert.ok(segD.includes('jane@example.com'));

    // Check all-null column marked explicitly (AES §16)
    assert.ok(segD.includes('no sample values') || segD.includes('empty'));

    // Check sibling headers as context (AES §4)
    assert.ok(segD.includes('Sibling') || segD.includes('sibling'));
  });

  test('Segment E contains output contract', () => {
    const schemaFieldIds = ['first_name', 'email', 'phone_number'];
    const segE = buildSegmentE(schemaFieldIds);
    assert.ok(segE.length > 0);
    // Should define JSON structure
    assert.ok(segE.includes('column_header'));
    assert.ok(segE.includes('target_field'));
    assert.ok(segE.includes('confidence'));
    assert.ok(segE.includes('rationale'));
    // Should mention UNMAPPED as valid option
    assert.ok(segE.includes('UNMAPPED'));
    // Should list the schema fields
    assert.ok(segE.includes('first_name'));
    assert.ok(segE.includes('email'));
    assert.ok(segE.includes('phone_number'));
  });
});

describe('Prompt Segments — Determinism', () => {
  test('same profiles produce same Segment D (deterministic)', () => {
    const profiles = [
      { header: 'Email', sample_values: ['a@b.com', 'c@d.com'], column_index: 0 },
    ];

    const segD1 = buildSegmentD(profiles);
    const segD2 = buildSegmentD(profiles);

    assert.strictEqual(segD1, segD2);
  });

  test('Segment D processes profiles in input order', () => {
    const profiles = [
      { header: 'Third', sample_values: ['C'], column_index: 2 },
      { header: 'First', sample_values: ['A'], column_index: 0 },
      { header: 'Second', sample_values: ['B'], column_index: 1 },
    ];

    const segD = buildSegmentD(profiles);

    // Processes in input order, using column_index for labeling
    // Column 3, Column 1, Column 2 should appear in that order
    assert.ok(segD.includes('Column 3:'));
    assert.ok(segD.includes('Column 1:'));
    assert.ok(segD.includes('Column 2:'));
    
    // Third appears first in output (input order)
    const thirdPos = segD.indexOf('Third');
    const firstPos = segD.indexOf('First');
    const secondPos = segD.indexOf('Second');
    
    assert.ok(thirdPos < firstPos);
    assert.ok(firstPos < secondPos);
  });

  test('same schema produces same Segment B', () => {
    const schema = [
      { id: 'email', business_meaning: 'Email address', alternative_names: [] },
    ];

    const segB1 = buildSegmentB(schema);
    const segB2 = buildSegmentB(schema);

    assert.strictEqual(segB1, segB2);
  });
});

describe('Prompt Segments — Schema integration', () => {
  test('Segment B changes when schema changes', () => {
    const schema1 = [{ id: 'field_a', business_meaning: 'A field', alternative_names: [] }];
    const schema2 = [{ id: 'field_b', business_meaning: 'B field', alternative_names: [] }];

    const segB1 = buildSegmentB(schema1);
    const segB2 = buildSegmentB(schema2);

    assert.notStrictEqual(segB1, segB2);
    assert.ok(segB1.includes('field_a'));
    assert.ok(segB2.includes('field_b'));
  });
});

describe('Prompt Version', () => {
  test('PROMPT_VERSION is a non-empty string', () => {
    assert.ok(typeof PROMPT_VERSION === 'string');
    assert.ok(PROMPT_VERSION.length > 0);
  });

  test('PROMPT_VERSION has expected format', () => {
    // Should be something like 'v1' or 'v1.0'
    assert.ok(/^v\d+(\.\d+)?$/i.test(PROMPT_VERSION));
  });
});
