/**
 * CSV Ingestion Component (INGEST)
 * LLD §2.2 - CSV Ingestion
 *
 * Phase 3: Placeholder implementation with mock data
 * Phase 4+: Real CSV parsing with encoding/delimiter detection
 */

import { ErrorTypes } from '../../contracts/types.js';

/**
 * Ingest and parse CSV file
 * LLD §6: ingest(raw_file) → ParsedFile | IngestionError
 *
 * @param {Buffer|File} rawFile - Raw CSV file
 * @param {Object} _context - State context (unused in Phase 3)
 * @returns {Promise<{success: boolean, data?: Object, error?: Object, metadata?: Object}>}
 */
export async function execute(rawFile, _context) {
  try {
    // Phase 3: Mock implementation
    // Simulate parsing delay
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Check for empty file
    if (!rawFile || rawFile.length === 0) {
      return {
        success: false,
        error: {
          type: ErrorTypes.EMPTY_OR_UNREADABLE_FILE,
          message: 'File is empty or unreadable',
        },
      };
    }

    // Mock parsed data structure
    const mockParsedFile = {
      rows: [
        ['John Doe', 'john@example.com', '+1-555-0100', 'Acme Corp', 'Manager'],
        ['Jane Smith', 'jane@example.com', '+1-555-0101', 'TechCo', 'Director'],
        ['Bob Johnson', 'bob@example.com', '+1-555-0102', 'StartupXYZ', 'CEO'],
        ['Alice Williams', 'alice@example.com', '+1-555-0103', 'Enterprise Inc', 'VP'],
        ['Charlie Brown', 'charlie@example.com', '+1-555-0104', 'Global Ltd', 'Analyst'],
      ],
      headers: ['Full Name', 'Email Address', 'Phone', 'Company Name', 'Job Title'],
      encoding: 'utf-8',
      delimiter: ',',
      row_count: 5,
    };

    return {
      success: true,
      data: mockParsedFile,
      metadata: {
        file_info: {
          encoding: mockParsedFile.encoding,
          delimiter: mockParsedFile.delimiter,
          row_count: mockParsedFile.row_count,
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      error: {
        type: ErrorTypes.STRUCTURAL_PARSE_ERROR,
        message: `Parsing failed: ${error.message}`,
        details: { originalError: error.message },
      },
    };
  }
}

export default { execute };
