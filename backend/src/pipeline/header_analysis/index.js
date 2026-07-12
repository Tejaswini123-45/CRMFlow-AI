/**
 * Header Analysis Component (HDRX)
 * LLD §2.3 - Header Analysis
 *
 * Phase 5: Real column profiling with representative sampling
 *
 * Responsibilities:
 * - Produce one ColumnProfile per column from ParsedFile
 * - Select representative (distinct, non-null) sample values per AES §12
 * - Represent all-null columns explicitly with empty sample_values (AES §16)
 * - Preserve original cell values exactly in sample_values
 * - All sampling is deterministic: same input → same output
 */

import { AUDIT } from '../../audit/index.js';
import { CONFIG } from '../../config/index.js';

/**
 * Analyze parsed file and produce column profiles
 * LLD §6: analyze(ParsedFile) → ColumnProfile[]
 *
 * @param {Object} parsedFile - ParsedFile from INGEST
 * @param {Object} context - State context containing import_run_id
 * @returns {Promise<{success: boolean, data?: Array, error?: Object, metadata?: Object}>}
 */
export async function execute(parsedFile, context) {
  const import_run_id = context?.import_run_id || 'unknown';

  try {
    // Validate input
    if (!parsedFile || !Array.isArray(parsedFile.headers) || !Array.isArray(parsedFile.rows)) {
      return {
        success: false,
        error: {
          type: 'UnclassifiedError',
          message: 'Invalid ParsedFile: missing headers or rows',
        },
      };
    }

    if (parsedFile.headers.length === 0) {
      return {
        success: false,
        error: {
          type: 'UnclassifiedError',
          message: 'ParsedFile has no headers',
        },
      };
    }

    const sampleSize = CONFIG.getSampleSize();
    const columnProfiles = [];

    for (let columnIndex = 0; columnIndex < parsedFile.headers.length; columnIndex++) {
      const header = parsedFile.headers[columnIndex];

      // Extract all raw values for this column across all rows
      const rawValues = parsedFile.rows.map(row => (Array.isArray(row) ? row[columnIndex] : undefined));

      // Select representative sample values
      // Normalization (trim/lower) is for comparison only; originals are returned
      const { sampleValues, totalCount, nullCount, distinctCount } =
        selectRepresentativeSamples(rawValues, sampleSize);

      columnProfiles.push({
        header,
        sample_values: sampleValues, // Original values, unmodified
        column_index: columnIndex,
      });

      // Record per-column audit decision
      AUDIT.record({
        import_run_id,
        stage: 'HEADERS_EXTRACTED',
        subject: header,
        decision: `${sampleValues.length} sample values selected`,
        rationale: `${distinctCount} distinct non-null values found from ${totalCount} total, ${nullCount} nulls`,
        timestamp: new Date(),
      });
    }

    // Record summary audit entry
    AUDIT.record({
      import_run_id,
      stage: 'HEADERS_EXTRACTED',
      subject: 'profiling_complete',
      decision: `${columnProfiles.length} columns profiled`,
      rationale: `sample_size=${sampleSize}, total_rows=${parsedFile.rows.length}`,
      timestamp: new Date(),
    });

    return {
      success: true,
      data: columnProfiles,
      metadata: {
        processing_stats: {
          columns_detected: columnProfiles.length,
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      error: {
        type: 'UnclassifiedError',
        message: `Header analysis failed: ${error.message}`,
      },
    };
  }
}

/**
 * Select representative sample values from a column's raw values.
 *
 * Strategy (AES §12):
 * - Favor distinct non-null values over literal row order
 * - Use trimmed value as the comparison key for deduplication only
 * - Return the original (untrimmed) value in the sample
 * - If all values are null/blank, return empty array (AES §16 explicit marker)
 *
 * @param {Array} rawValues - All raw values for a column (in row order)
 * @param {number} sampleSize - Maximum number of sample values to return
 * @returns {{ sampleValues: string[], totalCount: number, nullCount: number, distinctCount: number }}
 */
function selectRepresentativeSamples(rawValues, sampleSize) {
  const totalCount = rawValues.length;
  let nullCount = 0;

  // Map from normalized comparison key → original value (first occurrence wins)
  // Using Map to preserve insertion order deterministically
  const seen = new Map();

  for (const raw of rawValues) {
    // Classify as null/blank using normalized comparison value
    if (raw === null || raw === undefined) {
      nullCount++;
      continue;
    }

    const asString = String(raw);
    const normalized = asString.trim(); // Normalize for comparison only

    if (normalized === '') {
      nullCount++;
      continue;
    }

    // Only track up to sampleSize distinct values (early exit for performance)
    if (!seen.has(normalized) && seen.size < sampleSize) {
      seen.set(normalized, asString); // Store original string (not trimmed)
    } else if (!seen.has(normalized)) {
      // We've already found sampleSize distinct values; continue counting
      seen.set(normalized, null); // null sentinel = seen but not sampled
    }
  }

  // Collect sampled originals (entries where value is not the null sentinel)
  const sampleValues = [];
  for (const original of seen.values()) {
    if (original !== null) {
      sampleValues.push(original);
    }
  }

  const distinctCount = seen.size;

  return { sampleValues, totalCount, nullCount, distinctCount };
}

export default { execute };
