/**
 * Pipeline State Persistence
 * LLD §2.1 (ORCH)
 *
 * Manages storage and retrieval of PipelineState records.
 * Phase 3: In-memory implementation
 * Phase 4+: Database-backed implementation
 */

// In-memory state storage: Map<import_run_id, PipelineState>
const stateStore = new Map();

/**
 * Save pipeline state
 * LLD §2.1: "Persists a state transition on every stage completion"
 *
 * @param {import('../contracts/types.js').PipelineState} state - State to persist
 * @returns {Promise<void>}
 * @throws {Error} If state is invalid
 */
export async function saveState(state) {
  if (!state || !state.import_run_id) {
    throw new Error('Invalid state: import_run_id is required');
  }

  if (!state.state) {
    throw new Error('Invalid state: state field is required');
  }

  // Deep clone to prevent mutations
  const clonedState = JSON.parse(JSON.stringify(state));
  stateStore.set(state.import_run_id, clonedState);
}

/**
 * Load pipeline state
 *
 * @param {string} import_run_id - Import identifier
 * @returns {Promise<import('../contracts/types.js').PipelineState|null>} State or null if not found
 */
export async function loadState(import_run_id) {
  if (!import_run_id) {
    throw new Error('import_run_id is required');
  }

  const state = stateStore.get(import_run_id);
  if (!state) {
    return null;
  }

  // Return deep clone to prevent mutations
  return JSON.parse(JSON.stringify(state));
}

/**
 * Check if state exists
 *
 * @param {string} import_run_id - Import identifier
 * @returns {Promise<boolean>} True if state exists
 */
export async function stateExists(import_run_id) {
  if (!import_run_id) {
    return false;
  }

  return stateStore.has(import_run_id);
}

/**
 * Delete pipeline state
 * Used for cleanup after terminal states
 *
 * @param {string} import_run_id - Import identifier
 * @returns {Promise<void>}
 */
export async function deleteState(import_run_id) {
  if (!import_run_id) {
    throw new Error('import_run_id is required');
  }

  stateStore.delete(import_run_id);
}

/**
 * List all active import IDs (for testing/debugging)
 *
 * @returns {Promise<string[]>} Array of import_run_ids
 */
export async function listAllImportIds() {
  return Array.from(stateStore.keys());
}

/**
 * Clear all states (for testing)
 *
 * @returns {Promise<void>}
 */
export async function clearAll() {
  stateStore.clear();
}

/**
 * Get state store size (for monitoring/debugging)
 *
 * @returns {Promise<number>} Number of stored states
 */
export async function getStoreSize() {
  return stateStore.size;
}
