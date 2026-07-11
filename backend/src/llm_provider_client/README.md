# LLM Provider Client

**Purpose:** AIMAP's sole outbound integration point.

## Responsibility
- Abstracts LLM provider API calls
- Handles authentication, request formatting, response parsing
- Provides timeout and retry infrastructure
- Only accessed by AIMAP — no other component has LLM access

## Design Rules
- Provider-agnostic interface where possible
- Structured output support required
- Timeout and rate-limit handling built-in

## Placeholder
This client will be implemented in Phase 8 alongside AIMAP.
