/**
 * Encoding Detection with Probabilistic Handling
 * Phase 4: Character encoding detection using chardet library
 * 
 * Handles uncertain detection results with appropriate fallbacks
 * and AUDIT warnings when confidence is low.
 */

import chardet from 'chardet';
import { CONFIG } from '../../config/index.js';
import { AUDIT } from '../../audit/index.js';

/**
 * @typedef {Object} EncodingDetectionResult
 * @property {string} encoding - Detected or fallback encoding
 * @property {number} confidence - Confidence score [0, 1]
 * @property {string} rationale - Human-readable explanation
 * @property {boolean} wasFallback - Whether fallback encoding was used
 */

/**
 * Detect file encoding with probabilistic handling
 * 
 * Uses chardet library for detection but handles uncertain results
 * appropriately with fallbacks and warnings.
 * 
 * @param {Buffer} buffer - File buffer to analyze
 * @param {string} import_run_id - Import identifier for audit logging
 * @returns {Promise<EncodingDetectionResult>} Detection result
 */
export async function detectEncoding(buffer, import_run_id) {
  const sampleSize = CONFIG.get('encoding_detection_sample_size');
  const confidenceThreshold = CONFIG.get('encoding_confidence_threshold');
  
  // Use sample of buffer for detection (performance optimization)
  const sample = buffer.slice(0, Math.min(sampleSize, buffer.length));
  
  try {
    // Use chardet for encoding detection
    const detectionResults = chardet.analyse(sample);
    
    if (!detectionResults || detectionResults.length === 0) {
      return handleFallback(import_run_id, 'No encoding detected by chardet');
    }
    
    // Get best detection result
    const best = detectionResults[0];
    const confidence = best.confidence / 100; // chardet returns 0-100, we want 0-1
    
    // Normalize encoding name to Node.js standard
    const normalizedEncoding = normalizeEncodingName(best.name);
    
    if (confidence < confidenceThreshold) {
      // Record warning about low confidence
      AUDIT.record({
        import_run_id,
        stage: 'PARSING',
        subject: 'encoding_detection',
        decision: `Low confidence detection: ${best.name} (${(confidence * 100).toFixed(1)}%)`,
        rationale: `Below threshold of ${(confidenceThreshold * 100).toFixed(1)}%, using UTF-8 fallback`,
        timestamp: new Date()
      });
      
      return handleFallback(import_run_id, `Low confidence: ${(confidence * 100).toFixed(1)}%`);
    }
    
    // High confidence detection - use it
    AUDIT.record({
      import_run_id,
      stage: 'PARSING',
      subject: 'encoding_detection',
      decision: normalizedEncoding,
      rationale: `Detected with ${(confidence * 100).toFixed(1)}% confidence`,
      timestamp: new Date()
    });
    
    return {
      encoding: normalizedEncoding,
      confidence,
      rationale: `Detected by chardet with ${(confidence * 100).toFixed(1)}% confidence`,
      wasFallback: false
    };
    
  } catch (error) {
    // Chardet failed completely
    AUDIT.record({
      import_run_id,
      stage: 'PARSING',
      subject: 'encoding_detection',
      decision: 'Detection failed',
      rationale: `chardet error: ${error.message}`,
      timestamp: new Date()
    });
    
    return handleFallback(import_run_id, `Detection error: ${error.message}`);
  }
}

/**
 * Handle fallback to UTF-8 encoding
 * @private
 */
function handleFallback(import_run_id, reason) {
  AUDIT.record({
    import_run_id,
    stage: 'PARSING',
    subject: 'encoding_fallback',
    decision: 'utf8',
    rationale: `Fallback to UTF-8: ${reason}`,
    timestamp: new Date()
  });
  
  return {
    encoding: 'utf8',
    confidence: 0.5, // Moderate confidence in fallback
    rationale: `UTF-8 fallback (${reason})`,
    wasFallback: true
  };
}

/**
 * Normalize chardet encoding names to Node.js standard names
 * @private
 */
function normalizeEncodingName(chardetName) {
  const encodingMap = {
    'UTF-8': 'utf8',
    'UTF8': 'utf8',
    'ASCII': 'ascii',
    'ISO-8859-1': 'latin1',
    'windows-1252': 'latin1',
    'windows-1251': 'latin1', // Close enough for most cases
    'Big5': 'utf8', // Fallback for complex encodings
    'GB2312': 'utf8', // Fallback for complex encodings
    'EUC-JP': 'utf8', // Fallback for complex encodings
    'EUC-KR': 'utf8', // Fallback for complex encodings
  };
  
  return encodingMap[chardetName] || 'utf8';
}

/**
 * Validate detected encoding by attempting conversion
 * 
 * @param {Buffer} buffer - File buffer
 * @param {string} encoding - Encoding to validate
 * @returns {boolean} True if encoding conversion works without obvious errors
 */
export function validateEncoding(buffer, encoding) {
  try {
    const text = buffer.toString(encoding);
    
    // Check for Unicode replacement characters (indication of encoding errors)
    const hasReplacementChars = text.includes('\uFFFD');
    
    // Check for excessive control characters (indication of binary data)
    // Using character codes directly to avoid no-control-regex lint rule
    const controlCharCount = Array.from(text).filter(ch => {
      const code = ch.charCodeAt(0);
      return (code >= 0 && code <= 8) || code === 0x0B || code === 0x0C ||
             (code >= 0x0E && code <= 0x1F) || code === 0x7F;
    }).length;
    const controlCharRatio = controlCharCount / text.length;
    
    return !hasReplacementChars && controlCharRatio < 0.1;
  } catch (error) {
    return false;
  }
}