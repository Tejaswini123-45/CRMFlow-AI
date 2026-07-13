/**
 * Prompt Segment Builders
 * AES §2–§5 — Five-segment prompt architecture
 *
 * Segments A, C, E: static per prompt version (versioned together)
 * Segment B: CONFIG-sourced schema context (not part of prompt versioning)
 * Segment D: per-request input payload (assembled from ColumnProfile[])
 */

// ============================================================================
// SEGMENT A — Task Framing (static, versioned)
// AES §3: four ordered components
// ============================================================================

export function buildSegmentA() {
  return `You are a data mapping assistant. Your ONLY task is to classify each given CSV column against a fixed set of target CRM schema fields.

## Your Task
For each input column, determine which target schema field it most likely represents, based on the column header text and the provided sample values.

## Non-Goals (do NOT do these)
- Do NOT invent, generate, or assume any data values
- Do NOT use a column's position in the file as a signal for its meaning
- Do NOT treat two columns as related to each other when making a mapping decision
- Do NOT force a mapping when the evidence is weak or conflicting

## Uncertainty Handling (MOST IMPORTANT)
Returning UNMAPPED with a low confidence score is the CORRECT and PREFERRED answer when:
- The column header is ambiguous and sample values do not clearly indicate a specific field
- Multiple fields are plausible with similar confidence
- The header and sample values contradict each other
A confident-sounding guess that might be wrong is worse than an honest UNMAPPED response.

## Output Discipline
Your response MUST be a valid JSON array. Each element must exactly follow the output contract specified at the end of the prompt. No additional commentary, no markdown, no explanation outside the JSON array.`;
}

// ============================================================================
// SEGMENT C — Few-Shot Examples (static, versioned with A and E)
// AES §5: spans full ambiguity spectrum
// ============================================================================

export function buildSegmentC() {
  return `## Examples

### Example 1 — Unambiguous, canonical
Input: column_header="Email Address", sample_values=["john@example.com","mary@acme.org"]
Output: {"column_header":"Email Address","target_field":"email","confidence":0.98,"rationale":"Header and values both clearly indicate an email field."}

### Example 2 — Synonym / alternate naming
Input: column_header="Mobile No.", sample_values=["+91-9876543210","555-0100"]
Output: {"column_header":"Mobile No.","target_field":"phone_number","confidence":0.94,"rationale":"Mobile No. is a common alternate name for a phone number field."}

### Example 3 — Ambiguous, resolved by sample values
Input: column_header="Info", sample_values=["priya@gmail.com","raj@corp.in","test@example.com"]
Output: {"column_header":"Info","target_field":"email","confidence":0.87,"rationale":"Header is generic but all sample values are email addresses."}

### Example 4 — Genuinely ambiguous — UNMAPPED is correct
Input: column_header="Data", sample_values=["12","5","8","100"]
Output: {"column_header":"Data","target_field":"UNMAPPED","confidence":0.15,"rationale":"Header is non-descriptive and sample values are ambiguous numbers without clear CRM field meaning."}

### Example 5 — Low confidence / two plausible fields
Input: column_header="Contact", sample_values=["John Smith","Mary Jones","Bob Lee"]
Output: {"column_header":"Contact","target_field":"first_name","confidence":0.55,"rationale":"Values look like full names; could be first_name but might represent a combined full name field. Confidence is low — recommend review."}

### Example 6 — All null samples — UNMAPPED, low confidence
Input: column_header="Ext", sample_values=[]
Output: {"column_header":"Ext","target_field":"UNMAPPED","confidence":0.1,"rationale":"No sample values available. Cannot determine field meaning from header alone."}

### Example 7 — Company context
Input: column_header="Organization", sample_values=["Acme Corp","TechCo Ltd","StartupXYZ"]
Output: {"column_header":"Organization","target_field":"company","confidence":0.93,"rationale":"Organization is a well-known synonym for company in CRM contexts."}`;
}

// ============================================================================
// SEGMENT E — Output Contract (static, versioned)
// AES §6: defines the required JSON schema for the response
// ============================================================================

export function buildSegmentE(schemaFieldIds) {
  const validFieldsStr = [...schemaFieldIds, 'UNMAPPED'].join(', ');
  return `## Output Contract
Respond with ONLY a JSON array. No other text. No markdown code fences.

The array must contain exactly one object per input column, in the same order as the input.

Each object must have these exact fields:
- "column_header": string — must exactly echo the input column_header
- "target_field": string — must be one of: ${validFieldsStr}
- "confidence": number — must be a decimal between 0.0 and 1.0
- "rationale": string — a single concise sentence explaining the mapping decision`;
}

// ============================================================================
// SEGMENT B — Schema Context (CONFIG-sourced, not versioned with A/C/E)
// AES §2, §4: assembled at runtime from CONFIG
// ============================================================================

/**
 * Build schema context from CONFIG target schema fields
 * @param {Array<{id: string, business_meaning: string, alternative_names: string[]}>} schemaFields
 * @returns {string}
 */
export function buildSegmentB(schemaFields) {
  const fieldDescriptions = schemaFields.map(field => {
    const alts = field.alternative_names.length > 0
      ? ` Common alternatives: ${field.alternative_names.join(', ')}.`
      : '';
    return `- "${field.id}": ${field.business_meaning}.${alts}`;
  }).join('\n');

  return `## Target Schema Fields
The following are the only valid target fields. Map each column to one of these, or to UNMAPPED.

${fieldDescriptions}

Additionally: "UNMAPPED" — use this when no field is a good match or evidence is insufficient.`;
}

// ============================================================================
// SEGMENT D — Input Payload (per-request, assembled from ColumnProfile[])
// AES §4: column header + samples + sibling context
// ============================================================================

/**
 * Build per-request input payload from ColumnProfile[]
 * @param {Array<{header: string, sample_values: string[], column_index: number}>} columnProfiles
 * @returns {string}
 */
export function buildSegmentD(columnProfiles) {
  const siblingHeaders = columnProfiles.map(p => p.header);

  const columnEntries = columnProfiles.map(profile => {
    const sampleStr = profile.sample_values.length > 0
      ? profile.sample_values.map(v => `"${v}"`).join(', ')
      : '(no sample values available — column may be empty)';

    return `Column ${profile.column_index + 1}: column_header="${profile.header}", sample_values=[${sampleStr}]`;
  }).join('\n');

  // Include sibling headers as lightweight cross-column context (AES §4)
  const siblingContext = `Sibling column headers in this file (for context only): ${siblingHeaders.map(h => `"${h}"`).join(', ')}`;

  return `## Input Columns to Map

${siblingContext}

${columnEntries}`;
}
