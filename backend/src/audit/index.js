/**
 * Audit Logger (AUDIT)
 * LLD §11 Logging Strategy
 * 
 * Decision record storage and querying.
 * Cross-cutting component - called by all pipeline components.
 */

// In-memory storage: Map<import_run_id, DecisionRecord[]>
const auditStore = new Map();

/**
 * Record a decision
 * 
 * @param {import('../contracts/types.js').DecisionRecord} record - Decision record to store
 * @returns {{success: boolean}} Acknowledgment
 */
export function record(record) {
  // Validate required fields
  if (!record.import_run_id || !record.stage || !record.subject || !record.decision) {
    throw new Error('DecisionRecord missing required fields');
  }

  // Ensure timestamp exists
  const completeRecord = {
    ...record,
    timestamp: record.timestamp || new Date(),
  };

  // Get or create records array for this import_run_id
  if (!auditStore.has(record.import_run_id)) {
    auditStore.set(record.import_run_id, []);
  }

  const records = auditStore.get(record.import_run_id);
  records.push(completeRecord);

  return { success: true };
}

/**
 * Query decision records for an import run
 * 
 * @param {string} import_run_id - Import identifier
 * @param {Object} [filters] - Optional filters
 * @param {string} [filters.stage] - Filter by pipeline stage
 * @param {string} [filters.subject] - Filter by subject
 * @returns {import('../contracts/types.js').DecisionRecord[]} Records in chronological order
 */
export function query(import_run_id, filters = {}) {
  if (!import_run_id) {
    throw new Error('import_run_id is required');
  }

  // Get records for this import (returns empty array if not found)
  let records = auditStore.get(import_run_id) || [];

  // Apply filters
  if (filters.stage) {
    records = records.filter((r) => r.stage === filters.stage);
  }

  if (filters.subject) {
    records = records.filter((r) => r.subject === filters.subject);
  }

  // Return deep clones in chronological order (already sorted by insertion)
  return records.map((r) => ({ ...r }));
}

/**
 * Get record count for an import run (for testing/debugging)
 * 
 * @param {string} import_run_id - Import identifier
 * @returns {number} Number of records
 */
export function count(import_run_id) {
  const records = auditStore.get(import_run_id);
  return records ? records.length : 0;
}

/**
 * Clear all records (for testing)
 */
export function clear() {
  auditStore.clear();
}

/**
 * Clear records for a specific import (for testing)
 * 
 * @param {string} import_run_id - Import identifier
 */
export function clearImport(import_run_id) {
  auditStore.delete(import_run_id);
}

export const AUDIT = {
  record,
  query,
  count,
  clear,
  clearImport,
};

export default AUDIT;
