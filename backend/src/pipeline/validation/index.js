/**
 * Validation Component (VALID)
 * LLD §2.7 - Validation
 *
 * Phase 3: Placeholder implementation with basic validation
 * Phase 4+: Real schema and business validation rules
 */

import { ErrorTypes } from '../../contracts/types.js';

/**
 * Validate normalized rows
 * LLD §6: validate(NormalizedRow[], rules) → RowVerdict[]
 *
 * @param {Array} normalizedRows - Normalized rows from XFORM
 * @param {Object} _context - State context (unused in Phase 3)
 * @returns {Promise<{success: boolean, data?: Array, error?: Object, metadata?: Object}>}
 */
export async function execute(normalizedRows, _context) {
  try {
    // Phase 3: Mock implementation
    await new Promise((resolve) => setTimeout(resolve, 100));

    if (!normalizedRows || !Array.isArray(normalizedRows)) {
      return {
        success: false,
        error: {
          type: ErrorTypes.FIELD_VALIDATION_FAILURE,
          message: 'Invalid normalized rows',
        },
      };
    }

    // Mock validation - all rows pass
    const rowVerdicts = normalizedRows.map((row) => {
      // Validate each field
      const fieldVerdicts = [];

      Object.entries(row.fields).forEach(([fieldName, value]) => {
        let isValid = true;
        let reason = null;

        // Basic validation rules
        if (fieldName === 'email') {
          // Simple email check
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          isValid = emailRegex.test(value);
          reason = isValid ? null : 'Invalid email format';
        } else if (fieldName === 'phone') {
          // Simple phone check
          isValid = value && value.length >= 10;
          reason = isValid ? null : 'Invalid phone format';
        } else if (fieldName === 'full_name') {
          // Name should not be empty
          isValid = value && value.trim().length > 0;
          reason = isValid ? null : 'Name cannot be empty';
        }

        fieldVerdicts.push({
          field_name: fieldName,
          is_valid: isValid,
          reason,
        });
      });

      // Determine overall verdict
      const hasInvalid = fieldVerdicts.some((v) => !v.is_valid);
      const overallVerdict = hasInvalid ? 'INVALID' : 'VALID';

      return {
        row_index: row.row_index,
        overall_verdict: overallVerdict,
        field_verdicts: fieldVerdicts,
      };
    });

    // Count failures
    const validationFailures = rowVerdicts.filter((v) => v.overall_verdict !== 'VALID')
      .length;

    return {
      success: true,
      data: rowVerdicts,
      metadata: {
        processing_stats: {
          validation_failures: validationFailures,
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      error: {
        type: ErrorTypes.FIELD_VALIDATION_FAILURE,
        message: `Validation failed: ${error.message}`,
      },
    };
  }
}

export default { execute };
