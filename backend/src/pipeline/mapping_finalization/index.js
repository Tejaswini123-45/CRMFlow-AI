/**
 * Mapping Finalization Component (MAPFIN)
 * LLD §2.5 - Mapping Finalization
 *
 * Phase 3: Placeholder implementation
 * Phase 4+: Real confidence routing and correction merging
 */

/**
 * Route mapping proposals based on confidence
 * LLD §6: route(MappingProposal[], threshold) → { auto_staged, requires_review }
 *
 * @param {Array} proposals - Mapping proposals from AIMAP
 * @param {number} threshold - Confidence threshold
 * @returns {Promise<{success: boolean, data?: Object, requires_review?: boolean, requires_review_columns?: Array}>}
 */
export async function route(proposals, threshold) {
  try {
    if (!proposals || !Array.isArray(proposals)) {
      return {
        success: false,
        error: {
          type: 'UnclassifiedError',
          message: 'Invalid proposals',
        },
      };
    }

    // Partition proposals by confidence
    const autoStaged = proposals.filter((p) => p.confidence >= threshold);
    const requiresReview = proposals.filter((p) => p.confidence < threshold);

    return {
      success: true,
      auto_staged: autoStaged,
      requires_review_columns: requiresReview.map((p) => p.column_header),
      requires_review: requiresReview.length > 0,
    };
  } catch (error) {
    return {
      success: false,
      error: {
        type: 'UnclassifiedError',
        message: `Routing failed: ${error.message}`,
      },
    };
  }
}

/**
 * Finalize mapping with optional human corrections
 * LLD §6: finalize(MappingProposal[], HumanCorrection[]) → FinalizedMapping
 *
 * @param {Array} proposals - Mapping proposals from AIMAP
 * @param {Array} corrections - Human corrections
 * @returns {Promise<{success: boolean, data?: Object, error?: Object, metadata?: Object}>}
 */
export async function finalize(proposals, corrections = []) {
  try {
    // Phase 3: Mock implementation
    await new Promise((resolve) => setTimeout(resolve, 50));

    if (!proposals || !Array.isArray(proposals)) {
      return {
        success: false,
        error: {
          type: 'UnclassifiedError',
          message: 'Invalid proposals',
        },
      };
    }

    // Start with AI proposals
    const columnToField = {};

    proposals.forEach((proposal) => {
      columnToField[proposal.column_header] = proposal.target_field;
    });

    // Apply human corrections
    let correctionCount = 0;
    if (corrections && Array.isArray(corrections)) {
      corrections.forEach((correction) => {
        if (correction.column_header && correction.corrected_field) {
          columnToField[correction.column_header] = correction.corrected_field;
          correctionCount++;
        }
      });
    }

    const finalizedMapping = {
      column_to_field: columnToField,
      finalized_at: new Date(),
      had_corrections: correctionCount > 0,
    };

    return {
      success: true,
      data: finalizedMapping,
      metadata: {
        processing_stats: {
          columns_mapped: Object.keys(columnToField).length,
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      error: {
        type: 'UnclassifiedError',
        message: `Finalization failed: ${error.message}`,
      },
    };
  }
}

export default { route, finalize };
