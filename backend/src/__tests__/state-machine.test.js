/**
 * State Machine Unit Tests
 * Verifies all transitions from LLD §7
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';

import {
  isValidTransition,
  isTerminalState,
  determineNextState,
  createInitialState,
  transitionState,
} from '../orchestrator/state-machine.js';
import { PipelineStateEnum, ErrorTypes } from '../contracts/types.js';

describe('State Machine Unit Tests', () => {
  test('should validate all expected transitions', () => {
    // Valid transitions from LLD §7
    assert.ok(isValidTransition(PipelineStateEnum.UPLOADED, PipelineStateEnum.PARSING));
    assert.ok(isValidTransition(PipelineStateEnum.PARSING, PipelineStateEnum.HEADERS_EXTRACTED));
    assert.ok(isValidTransition(PipelineStateEnum.PARSING, PipelineStateEnum.PARSE_FAILED));
    assert.ok(isValidTransition(PipelineStateEnum.HEADERS_EXTRACTED, PipelineStateEnum.MAPPING_IN_PROGRESS));
    assert.ok(isValidTransition(PipelineStateEnum.MAPPING_IN_PROGRESS, PipelineStateEnum.AWAITING_REVIEW));
    assert.ok(isValidTransition(PipelineStateEnum.MAPPING_IN_PROGRESS, PipelineStateEnum.MAPPING_FINALIZED));
    assert.ok(isValidTransition(PipelineStateEnum.AWAITING_REVIEW, PipelineStateEnum.MAPPING_FINALIZED));
    assert.ok(isValidTransition(PipelineStateEnum.MAPPING_FINALIZED, PipelineStateEnum.TRANSFORMING));
    assert.ok(isValidTransition(PipelineStateEnum.TRANSFORMING, PipelineStateEnum.VALIDATING));
    assert.ok(isValidTransition(PipelineStateEnum.VALIDATING, PipelineStateEnum.DEDUPING));
    assert.ok(isValidTransition(PipelineStateEnum.DEDUPING, PipelineStateEnum.EXPORTING));
    assert.ok(isValidTransition(PipelineStateEnum.EXPORTING, PipelineStateEnum.COMPLETE));

    // Invalid transitions
    assert.ok(!isValidTransition(PipelineStateEnum.COMPLETE, PipelineStateEnum.PARSING));
    assert.ok(!isValidTransition(PipelineStateEnum.PARSE_FAILED, PipelineStateEnum.HEADERS_EXTRACTED));
  });

  test('should identify terminal states correctly', () => {
    assert.ok(isTerminalState(PipelineStateEnum.PARSE_FAILED));
    assert.ok(isTerminalState(PipelineStateEnum.MAPPING_FAILED));
    assert.ok(isTerminalState(PipelineStateEnum.COMPLETE));
    assert.ok(isTerminalState(PipelineStateEnum.FAILED));

    assert.ok(!isTerminalState(PipelineStateEnum.UPLOADED));
    assert.ok(!isTerminalState(PipelineStateEnum.AWAITING_REVIEW));
  });

  test('should determine correct next state for success path', () => {
    const successResult = { success: true };

    assert.strictEqual(
      determineNextState(PipelineStateEnum.UPLOADED, successResult),
      PipelineStateEnum.PARSING
    );
    assert.strictEqual(
      determineNextState(PipelineStateEnum.PARSING, successResult),
      PipelineStateEnum.HEADERS_EXTRACTED
    );
    assert.strictEqual(
      determineNextState(PipelineStateEnum.HEADERS_EXTRACTED, successResult),
      PipelineStateEnum.MAPPING_IN_PROGRESS
    );
  });

  test('should determine correct next state for errors', () => {
    const parseError = {
      success: false,
      error: { type: ErrorTypes.STRUCTURAL_PARSE_ERROR, message: 'Bad CSV' }
    };

    assert.strictEqual(
      determineNextState(PipelineStateEnum.PARSING, parseError),
      PipelineStateEnum.PARSE_FAILED
    );

    const mappingError = {
      success: false,
      error: { type: ErrorTypes.AI_MAPPING_HARD_FAILURE, message: 'LLM unreachable' }
    };

    assert.strictEqual(
      determineNextState(PipelineStateEnum.MAPPING_IN_PROGRESS, mappingError),
      PipelineStateEnum.MAPPING_FAILED
    );
  });

  test('should handle review-required routing', () => {
    const reviewRequired = { success: true, requires_review: true };
    const reviewNotRequired = { success: true, requires_review: false };

    assert.strictEqual(
      determineNextState(PipelineStateEnum.MAPPING_IN_PROGRESS, reviewRequired),
      PipelineStateEnum.AWAITING_REVIEW
    );

    assert.strictEqual(
      determineNextState(PipelineStateEnum.MAPPING_IN_PROGRESS, reviewNotRequired),
      PipelineStateEnum.MAPPING_FINALIZED
    );
  });

  test('should create valid initial state', () => {
    const importId = 'test-import-123';
    const fileInfo = { filename: 'test.csv', size_bytes: 1024 };

    const state = createInitialState(importId, fileInfo);

    assert.strictEqual(state.import_run_id, importId);
    assert.strictEqual(state.state, PipelineStateEnum.UPLOADED);
    assert.strictEqual(state.context.file_info.filename, 'test.csv');
    assert.strictEqual(state.context.file_info.size_bytes, 1024);
    assert.ok(state.created_at instanceof Date);
    assert.ok(state.updated_at instanceof Date);
  });

  test('should transition state correctly', async () => {
    const initialState = createInitialState('test-123', { filename: 'test.csv' });
    const successResult = { success: true };

    // Add small delay to ensure time difference
    await new Promise(resolve => setTimeout(resolve, 10));

    const newState = transitionState(initialState, successResult);

    assert.strictEqual(newState.import_run_id, 'test-123');
    assert.strictEqual(newState.state, PipelineStateEnum.PARSING);
    assert.ok(newState.updated_at >= initialState.updated_at);
    assert.ok(newState.context.completed_stages.includes(PipelineStateEnum.UPLOADED));
    assert.strictEqual(newState.context.last_completed_stage, PipelineStateEnum.UPLOADED);
  });

  test('should prevent invalid transitions', () => {
    const terminalState = createInitialState('test-123');
    terminalState.state = PipelineStateEnum.COMPLETE;

    const successResult = { success: true };

    // Should throw error when trying to transition from terminal state
    assert.throws(() => {
      transitionState(terminalState, successResult);
    }, /Cannot determine next state from COMPLETE/);
  });
});