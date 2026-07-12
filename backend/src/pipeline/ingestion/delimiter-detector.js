/**
 * DelimiterDetector Abstraction
 * Phase 4: CSV delimiter detection with pluggable implementations
 * 
 * Provides abstraction for INGEST component to detect CSV delimiters
 * without embedding detection logic directly in the component.
 */

/**
 * @typedef {Object} DelimiterDetectionResult
 * @property {string} delimiter - Detected delimiter character
 * @property {number} confidence - Confidence score [0, 1]
 * @property {string} rationale - Human-readable explanation of detection
 */

/**
 * DelimiterDetector interface
 * Abstract base class for delimiter detection implementations
 */
export class DelimiterDetector {
  /**
   * Detect delimiter in text sample
   * @param {string} textSample - Sample text to analyze
   * @param {Object} _options - Detection options (reserved for future use)
   * @returns {Promise<DelimiterDetectionResult>} Detection result
   */
  async detect(textSample, _options = {}) {
    throw new Error('detect() must be implemented by subclass');
  }
}

/**
 * HeuristicDelimiterDetector
 * First implementation using deterministic heuristics
 * 
 * Analyzes delimiter frequency and consistency across sample lines
 * to determine the most likely CSV delimiter.
 */
export class HeuristicDelimiterDetector extends DelimiterDetector {
  constructor() {
    super();
    this.candidateDelimiters = [',', ';', '\t', '|'];
  }

  /**
   * Detect delimiter using frequency and consistency analysis
   */
  async detect(textSample, options = {}) {
    const maxLines = options.maxSampleLines || 10;
    const lines = textSample.split(/\r?\n/).slice(0, maxLines).filter(line => line.trim());

    if (lines.length === 0) {
      return {
        delimiter: ',',
        confidence: 0.5,
        rationale: 'No data lines found, defaulting to comma'
      };
    }

    let bestDelimiter = ',';
    let bestScore = -1;
    let bestRationale = 'Default comma delimiter';

    for (const delimiter of this.candidateDelimiters) {
      const analysis = this._analyzeDelimiter(lines, delimiter);
      
      if (analysis.score > bestScore) {
        bestScore = analysis.score;
        bestDelimiter = delimiter;
        bestRationale = analysis.rationale;
      }
    }

    // Convert score to confidence (0-1)
    const confidence = Math.min(bestScore / 10, 1.0); // Normalize to reasonable confidence

    return {
      delimiter: bestDelimiter,
      confidence: Math.max(confidence, 0.1), // Minimum confidence
      rationale: bestRationale
    };
  }

  /**
   * Analyze delimiter frequency and consistency
   * @private
   */
  _analyzeDelimiter(lines, delimiter) {
    if (lines.length === 0) {
      return { score: 0, rationale: 'No lines to analyze' };
    }

    // Count delimiter occurrences per line
    const counts = lines.map(line => {
      // Handle escaped delimiters by temporarily replacing quoted sections
      const quotedSections = line.match(/"[^"]*"/g) || [];
      let cleanLine = line;
      
      // Replace quoted sections with placeholders to avoid counting delimiters inside quotes
      quotedSections.forEach((section, idx) => {
        cleanLine = cleanLine.replace(section, `__QUOTED_${idx}__`);
      });
      
      // Create regex for the delimiter
      const delimiterRegex = delimiter === '\t' 
        ? /\t/g 
        : new RegExp(`\\${delimiter}`, 'g');
      
      return (cleanLine.match(delimiterRegex) || []).length;
    });

    if (counts.every(count => count === 0)) {
      return { score: 0, rationale: `No ${this._getDelimiterName(delimiter)} found` };
    }

    // Calculate statistics
    const total = counts.reduce((sum, count) => sum + count, 0);
    const avg = total / counts.length;
    const nonZeroLines = counts.filter(count => count > 0).length;
    
    // Calculate consistency (inverse of variance)
    const variance = counts.reduce((acc, count) => acc + Math.pow(count - avg, 2), 0) / counts.length;
    const consistency = avg > 0 ? 1 / (1 + variance) : 0;

    // Score combines frequency and consistency
    const frequencyScore = avg * 2; // Higher average count is better
    const consistencyScore = consistency * 5; // Lower variance is better  
    const coverageScore = (nonZeroLines / lines.length) * 3; // More lines with delimiter is better
    
    const score = frequencyScore + consistencyScore + coverageScore;

    const rationale = `${this._getDelimiterName(delimiter)}: avg=${avg.toFixed(1)}, consistency=${consistency.toFixed(2)}, coverage=${(coverageScore/3).toFixed(2)}`;

    return { score, rationale };
  }

  /**
   * Get human-readable delimiter name
   * @private
   */
  _getDelimiterName(delimiter) {
    const names = {
      ',': 'comma',
      ';': 'semicolon', 
      '\t': 'tab',
      '|': 'pipe'
    };
    return names[delimiter] || 'unknown';
  }
}

/**
 * Create default delimiter detector instance
 * @returns {DelimiterDetector} Default detector implementation
 */
export function createDefaultDelimiterDetector() {
  return new HeuristicDelimiterDetector();
}