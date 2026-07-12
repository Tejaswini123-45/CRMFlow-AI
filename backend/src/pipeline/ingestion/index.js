/**
 * CSV Ingestion Component (INGEST)
 * LLD §2.2 - CSV Ingestion
 *
 * Phase 4: Real CSV parsing implementation
 * - Encoding detection using chardet library with probabilistic handling
 * - Delimiter detection using DelimiterDetector abstraction  
 * - CSV parsing using csv-parse library
 * - All limits from CONFIG, never truncate data
 * - Deterministic behavior for identical inputs
 */

import { parse } from 'csv-parse/sync';
import { ErrorTypes } from '../../contracts/types.js';
import { AUDIT } from '../../audit/index.js';
import { CONFIG } from '../../config/index.js';
import { detectEncoding, validateEncoding } from './encoding-detector.js';
import { createDefaultDelimiterDetector } from './delimiter-detector.js';
import { 
  validateRawFile, 
  validateParsedRows, 
  validateAndProcessHeaders, 
  filterEmptyRows 
} from './validation.js';

/**
 * Ingest and parse CSV file
 * LLD §6: ingest(raw_file) → ParsedFile | IngestionError
 *
 * @param {Buffer|File} rawFile - Raw CSV file
 * @param {Object} context - State context (contains import_run_id)
 * @returns {Promise<{success: boolean, data?: Object, error?: Object, metadata?: Object}>}
 */
export async function execute(rawFile, context) {
  const import_run_id = context?.import_run_id || 'unknown';
  
  try {
    // 1. Validate raw file
    validateRawFile(rawFile);
    
    // 2. Detect encoding with probabilistic handling
    const encodingResult = await detectEncoding(rawFile, import_run_id);
    
    // 3. Convert buffer to text
    let text;
    try {
      text = rawFile.toString(encodingResult.encoding);
    } catch (error) {
      return createError(
        ErrorTypes.STRUCTURAL_PARSE_ERROR,
        `Text conversion failed with encoding ${encodingResult.encoding}: ${error.message}`
      );
    }
    
    // 4. Validate encoding result
    if (!validateEncoding(rawFile, encodingResult.encoding)) {
      // Try UTF-8 fallback
      try {
        text = rawFile.toString('utf8');
        AUDIT.record({
          import_run_id,
          stage: 'PARSING',
          subject: 'encoding_correction',
          decision: 'utf8',
          rationale: `Original encoding ${encodingResult.encoding} produced invalid text, switched to UTF-8`,
          timestamp: new Date()
        });
      } catch (fallbackError) {
        return createError(
          ErrorTypes.STRUCTURAL_PARSE_ERROR,
          `Both detected encoding and UTF-8 fallback failed`
        );
      }
    }
    
    // 5. Detect delimiter using abstraction
    const delimiterDetector = createDefaultDelimiterDetector();
    const maxSampleLines = CONFIG.get('delimiter_detection_sample_lines');
    const delimiterResult = await delimiterDetector.detect(text, { maxSampleLines });
    
    // 6. Record delimiter detection
    AUDIT.record({
      import_run_id,
      stage: 'PARSING',
      subject: 'delimiter_detection',
      decision: delimiterResult.delimiter,
      rationale: delimiterResult.rationale,
      confidence: delimiterResult.confidence,
      timestamp: new Date()
    });
    
    // 7. Parse CSV with detected parameters
    let records;
    try {
      records = parse(text, {
        delimiter: delimiterResult.delimiter,
        quote: '"',
        escape: '"',
        columns: false, // We handle headers manually
        skip_records_with_error: false, // Fail on errors, don't skip
        relaxColumnCount: true, // Allow variable column counts
        skip_empty_lines: false, // We filter empty rows ourselves
      });
    } catch (parseError) {
      return createError(
        ErrorTypes.STRUCTURAL_PARSE_ERROR,
        `CSV parsing failed: ${parseError.message}`
      );
    }
    
    // 8. Validate parsed rows
    validateParsedRows(records);
    
    // 9. Process headers and data
    const [headerRow, ...dataRows] = records;
    const processedHeaders = validateAndProcessHeaders(headerRow);
    const filteredRows = filterEmptyRows(dataRows);
    
    // 10. Record parsing success
    AUDIT.record({
      import_run_id,
      stage: 'PARSING', 
      subject: 'parsing_complete',
      decision: `${filteredRows.length} rows processed`,
      rationale: `Successfully parsed CSV with ${processedHeaders.length} columns`,
      timestamp: new Date()
    });
    
    // 11. Assemble ParsedFile result
    const parsedFile = {
      rows: filteredRows,
      headers: processedHeaders,
      encoding: encodingResult.encoding,
      delimiter: delimiterResult.delimiter,
      row_count: filteredRows.length
    };
    
    return {
      success: true,
      data: parsedFile,
      metadata: {
        file_info: {
          encoding: encodingResult.encoding,
          delimiter: delimiterResult.delimiter,
          row_count: filteredRows.length,
          encoding_confidence: encodingResult.confidence,
          delimiter_confidence: delimiterResult.confidence,
          used_encoding_fallback: encodingResult.wasFallback
        },
      },
    };
    
  } catch (error) {
    // Handle validation and other errors
    if (error.type) {
      return createError(error.type, error.message);
    } else {
      return createError(
        ErrorTypes.STRUCTURAL_PARSE_ERROR,
        `Ingestion failed: ${error.message}`
      );
    }
  }
}

/**
 * Create standardized error response
 * @private
 */
function createError(type, message) {
  return {
    success: false,
    error: {
      type,
      message,
    },
  };
}

export default { execute };
