/**
 * DataStore Abstraction
 * LLD §2.1 (ORCH), Phase 3 Implementation
 *
 * Abstracts storage of pipeline stage outputs to enable scalability.
 * Phase 3: In-memory Map implementation
 * Phase 4+: Can be Redis, PostgreSQL, S3, filesystem, etc.
 */

/**
 * @typedef {Object} StorageStats
 * @property {string[]} stages_stored - List of stages that have stored data
 * @property {number} total_size_bytes - Approximate total size in bytes
 * @property {Date} created_at - When first data was stored
 * @property {Date} last_accessed - Last access time
 */

/**
 * DataStore Interface
 * All implementations must provide these methods
 */
export class DataStore {
  /**
   * Store stage output
   * @param {string} _import_run_id - Import identifier
   * @param {string} _stage - Pipeline stage name
   * @param {any} _data - Stage output data
   * @returns {Promise<string>} Storage key (format: import_run_id:stage)
   */
  async store(_import_run_id, _stage, _data) {
    throw new Error('store() must be implemented by subclass');
  }

  /**
   * Retrieve stage output
   * @param {string} _import_run_id - Import identifier
   * @param {string} _stage - Pipeline stage name
   * @returns {Promise<any>} Retrieved data
   * @throws {Error} If data not found
   */
  async retrieve(_import_run_id, _stage) {
    throw new Error('retrieve() must be implemented by subclass');
  }

  /**
   * Check if data exists for a stage
   * @param {string} _import_run_id - Import identifier
   * @param {string} _stage - Pipeline stage name
   * @returns {Promise<boolean>} True if data exists
   */
  async exists(_import_run_id, _stage) {
    throw new Error('exists() must be implemented by subclass');
  }

  /**
   * Clean up all data for an import (terminal states)
   * @param {string} _import_run_id - Import identifier
   * @returns {Promise<void>}
   */
  async cleanup(_import_run_id) {
    throw new Error('cleanup() must be implemented by subclass');
  }

  /**
   * Get storage statistics for an import
   * @param {string} _import_run_id - Import identifier
   * @returns {Promise<StorageStats|null>} Storage stats or null if not found
   */
  async getStats(_import_run_id) {
    throw new Error('getStats() must be implemented by subclass');
  }
}

/**
 * In-Memory DataStore Implementation
 * Phase 3: Development/testing implementation
 *
 * Storage structure:
 * - storage: Map<import_run_id, Map<stage, data>>
 * - metadata: Map<import_run_id, StorageStats>
 */
export class InMemoryDataStore extends DataStore {
  constructor() {
    super();
    // Map<import_run_id, Map<stage, data>>
    this.storage = new Map();
    // Map<import_run_id, StorageStats>
    this.metadata = new Map();
  }

  /**
   * Store stage output
   * Deep clones data to prevent mutations
   */
  async store(import_run_id, stage, data) {
    if (!import_run_id || !stage) {
      throw new Error('import_run_id and stage are required');
    }

    // Initialize storage for this import if needed
    if (!this.storage.has(import_run_id)) {
      this.storage.set(import_run_id, new Map());
      this.metadata.set(import_run_id, {
        stages_stored: [],
        total_size_bytes: 0,
        created_at: new Date(),
        last_accessed: new Date(),
      });
    }

    // Store data (deep clone to prevent mutations)
    const importData = this.storage.get(import_run_id);
    const clonedData = JSON.parse(JSON.stringify(data));
    importData.set(stage, clonedData);

    // Update metadata
    const meta = this.metadata.get(import_run_id);
    if (!meta.stages_stored.includes(stage)) {
      meta.stages_stored.push(stage);
    }
    meta.last_accessed = new Date();

    // Estimate size (rough approximation)
    try {
      const dataSize = JSON.stringify(clonedData).length;
      meta.total_size_bytes += dataSize;
    } catch (e) {
      // If data can't be stringified, ignore size calculation
    }

    return `${import_run_id}:${stage}`;
  }

  /**
   * Retrieve stage output
   * Returns deep clone to prevent mutations
   */
  async retrieve(import_run_id, stage) {
    if (!import_run_id || !stage) {
      throw new Error('import_run_id and stage are required');
    }

    const importData = this.storage.get(import_run_id);
    if (!importData || !importData.has(stage)) {
      throw new Error(`No data found for ${import_run_id}:${stage}`);
    }

    // Update access time
    const meta = this.metadata.get(import_run_id);
    if (meta) {
      meta.last_accessed = new Date();
    }

    // Return deep clone
    const data = importData.get(stage);
    return JSON.parse(JSON.stringify(data));
  }

  /**
   * Check if data exists
   */
  async exists(import_run_id, stage) {
    if (!import_run_id || !stage) {
      return false;
    }

    const importData = this.storage.get(import_run_id);
    return importData ? importData.has(stage) : false;
  }

  /**
   * Clean up import data
   */
  async cleanup(import_run_id) {
    if (!import_run_id) {
      throw new Error('import_run_id is required');
    }

    this.storage.delete(import_run_id);
    this.metadata.delete(import_run_id);
  }

  /**
   * Get storage statistics
   */
  async getStats(import_run_id) {
    if (!import_run_id) {
      throw new Error('import_run_id is required');
    }

    const meta = this.metadata.get(import_run_id);
    if (!meta) {
      return null;
    }

    // Return deep clone
    return JSON.parse(JSON.stringify(meta));
  }

  /**
   * Get all stored import IDs (for testing)
   * @returns {string[]} List of import_run_ids
   */
  getAllImportIds() {
    return Array.from(this.storage.keys());
  }

  /**
   * Clear all storage (for testing)
   */
  clearAll() {
    this.storage.clear();
    this.metadata.clear();
  }
}
