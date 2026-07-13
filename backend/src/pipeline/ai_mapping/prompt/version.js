/**
 * Prompt Version
 * AES §14 — Prompt versioning
 *
 * Segments A, C, E are versioned together as a single atomic identifier.
 * Changing any of these requires incrementing PROMPT_VERSION.
 * Segment B (schema context) is data-driven from CONFIG and is not versioned here.
 */

/**
 * Current prompt version identifier.
 * Every MappingProposal produced references this version in AUDIT.
 * @type {string}
 */
export const PROMPT_VERSION = 'v1';
