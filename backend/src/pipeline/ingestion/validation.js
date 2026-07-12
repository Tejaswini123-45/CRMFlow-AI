/**
 * CSV Ingestion Validation
 * Phase 4: File and content validation with CONFIG-driven limits
 * 
 * All validation limits come from CONFIG - no hardcoded constants.
 * Never silently truncate data - always error when limits exceeded.
 */

import { CONFIG } from '../../config/index.js';
import { ErrorTypes } from '../../contracts/types.js';

/**
 * Validate raw file before processing
 * 
 * @param {Buffer} buffer - Raw file buffer
 * @returns {void}
 * @throws {Error} If validation fails
 */
export function validateRawFile(buffer) {
  if (!buffer || buffer.length === 0) {
    throw createValidationError(
      ErrorTypes.EMPTY_OR_UNREADABLE_FILE,
      'File is empty or unreadable'
    );
  }
  
  const maxFileSize = CONFIG.get('max_file_size_bytes');
  if (buffer.length > maxFileSize) {
    throw createValidationError(
      ErrorTypes.STRUCTURAL_PARSE_ERROR,
      `File size ${buffer.length} bytes exceeds limit of ${maxFileSize} bytes`
    );
  }
  
  // Basic check for binary content in the first part of file
  const sample = buffer.slice(0, Math.min(1024, buffer.length));
  const nullBytes = sample.filter(byte => byte === 0).length;
  const nullRatio = nullBytes / sample.length;
  
  if (nullRatio > 0.1) {
    throw createValidationError(
      ErrorTypes.STRUCTURAL_PARSE_ERROR,
      'File appears to be binary, not text'
    );
  }
}

/**
 * Validate parsed CSV rows
 * 
 * @param {Array<Array<string>>} rows - Parsed CSV rows (including header)
 * @returns {void}
 * @throws {Error} If validation fails
 */
export function validateParsedRows(rows) {
  if (!Array.isArray(rows)) {
    throw createValidationError(
      ErrorTypes.STRUCTURAL_PARSE_ERROR,
      'Invalid CSV parsing result - not an array'
    );
  }
  
  if (rows.length === 0) {
    throw createValidationError(
      ErrorTypes.EMPTY_OR_UNREADABLE_FILE,
      'CSV contains no rows'
    );
  }
  
  const maxRows = CONFIG.get('file_size_ceiling_rows');
  const totalRows = rows.length - 1; // Subtract header row
  
  if (totalRows > maxRows) {
    throw createValidationError(
      ErrorTypes.STRUCTURAL_PARSE_ERROR,
      `File contains ${totalRows} data rows, limit is ${maxRows}`
    );
  }
  
  // Validate cell content sizes
  const maxCellSize = CONFIG.get('max_cell_size_bytes');
  
  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    
    if (!Array.isArray(row)) {
      throw createValidationError(
        ErrorTypes.STRUCTURAL_PARSE_ERROR,
        `Row ${rowIdx} is not an array`
      );
    }
    
    for (let cellIdx = 0; cellIdx < row.length; cellIdx++) {
      const cell = row[cellIdx];
      if (cell && typeof cell === 'string') {
        const cellSize = Buffer.byteLength(cell, 'utf8');
        if (cellSize > maxCellSize) {
          throw createValidationError(
            ErrorTypes.STRUCTURAL_PARSE_ERROR,
            `Cell at row ${rowIdx}, column ${cellIdx} is ${cellSize} bytes, limit is ${maxCellSize} bytes`
          );
        }
      }
    }
  }
}

/**
 * Validate and process headers
 * 
 * @param {Array<string>} headers - Header row
 * @returns {Array<string>} Processed headers with duplicates resolved
 * @throws {Error} If validation fails
 */
export function validateAndProcessHeaders(headers) {
  if (!Array.isArray(headers)) {
    throw createValidationError(
      ErrorTypes.STRUCTURAL_PARSE_ERROR,
      'Headers must be an array'
    );
  }
  
  if (headers.length === 0) {
    throw createValidationError(
      ErrorTypes.STRUCTURAL_PARSE_ERROR,
      'CSV must have at least one header column'
    );
  }
  
  const maxHeaderLength = CONFIG.get('max_header_length');
  
  // Process headers: resolve duplicates and validate lengths
  const processedHeaders = [];
  const seen = new Map();
  
  for (let i = 0; i < headers.length; i++) {
    let header = String(headers[i] || ''); // Convert to string, handle null/undefined
    
    // Validate header length (before duplicate resolution)
    if (header.length > maxHeaderLength) {
      throw createValidationError(
        ErrorTypes.STRUCTURAL_PARSE_ERROR,
        `Header "${header.substring(0, 50)}..." is ${header.length} characters, limit is ${maxHeaderLength}`
      );
    }
    
    // Resolve duplicates - only for non-empty headers
    const originalHeader = header;
    if (originalHeader !== '' && seen.has(originalHeader)) {
      let counter = seen.get(originalHeader) + 1;
      seen.set(originalHeader, counter);
      header = `${originalHeader}_${counter}`;
    } else if (originalHeader !== '') {
      seen.set(originalHeader, 0);
    }
    
    processedHeaders.push(header);
  }
  
  return processedHeaders;
}

/**
 * Filter empty rows from data
 * 
 * An empty row is one where all cells are null, undefined, empty string, or whitespace only.
 * 
 * @param {Array<Array<string>>} dataRows - Data rows (excluding header)
 * @returns {Array<Array<string>>} Filtered rows
 */
export function filterEmptyRows(dataRows) {
  if (!Array.isArray(dataRows)) {
    return [];
  }
  
  return dataRows.filter(row => {
    if (!Array.isArray(row)) {
      return false;
    }
    
    // Row is empty if all cells are empty/whitespace
    return row.some(cell => {
      if (cell === null || cell === undefined) {
        return false;
      }
      return String(cell).trim() !== '';
    });
  });
}

/**
 * Create validation error with proper structure
 * @private
 */
function createValidationError(type, message) {
  const error = new Error(message);
  error.type = type;
  return error;
}