# AI Engineering Specification (AES)
## AI-Powered CRM Data Ingestion Engine — AI Mapping Engine

**Document Owner:** AI Engineering
**Status:** Phase 5 — Implementation-Ready Draft v1.0
**Inputs treated as immutable:** PRD v1.0, HLD v1.0, LLD v1.0, UX Design Spec v1.0
**Component in scope:** `AIMAP` (LLD §2.4, §6, §8) exclusively. No other component's design is revisited here.
**Purpose:** Fully specify the AI subsystem so it can be implemented without further product or architectural decisions.

---

## 1. AI Responsibilities vs. Deterministic Responsibilities

Restated precisely (not redefined — this is the load-bearing boundary from HLD §6 and LLD §2.4, stated here at the granularity AI engineering needs):

| In Scope for AI (`AIMAP`) | Explicitly Deterministic (outside `AIMAP`) |
|---|---|
| Given a column's header text + sample values, propose the most likely target schema field | Formatting/normalizing any value (`XFORM`) |
| Produce a confidence score for that proposal | Deciding whether a confidence score is high enough to auto-apply (`MAPFIN` — thresholding logic, not AI) |
| Produce a human-readable rationale for the proposal | Validating whether a mapped, normalized value is actually well-formed (`VALID`) |
| Recognize and flag genuine ambiguity (return low confidence rather than guess) | Merging AI proposals with human corrections (`MAPFIN`) |
| — | Detecting duplicates (`DEDUPE`) |
| — | Structural validation of the AI's own output shape (performed by `AIMAP`'s output-validation sub-stage, which is deterministic code *around* the AI call, not the AI call itself) |

**AI engineering implication:** the model is never asked to do anything except one narrow, well-specified classification-with-justification task, repeated per column. It never sees a full row, never sees the target CRM record being assembled, and never sees another column's mapping decision when making its own (see Section 4 for why cross-column context is still partially provided, and where the line is).

---

## 2. Prompt Architecture

This expands LLD §8's four-segment structure into a fully specified content architecture (still no literal prompt text — that is an implementation artifact, not a design artifact).

```
┌────────────────────────────────────────────────────────┐
│ SEGMENT A — Task Framing (static, versioned)              │
│  Defines the task, the boundary of what the model should   │
│  and should not do, and the output contract at a           │
│  structural level.                                          │
├────────────────────────────────────────────────────────┤
│ SEGMENT B — Schema Context (CONFIG-sourced, per-request)   │
│  The fixed target field enum, field business meaning,       │
│  and known alternative-name patterns (PRD §9).               │
├────────────────────────────────────────────────────────┤
│ SEGMENT C — Few-Shot Examples (versioned, curated)          │
│  A small, fixed set of worked examples spanning the          │
│  ambiguity spectrum (Section 5).                              │
├────────────────────────────────────────────────────────┤
│ SEGMENT D — Input Payload (per-request, batched)             │
│  All columns for the current file, each with header +        │
│  bounded sample values (Section 11 — batching).                │
├────────────────────────────────────────────────────────┤
│ SEGMENT E — Output Contract (static, versioned)               │
│  Structured-output schema declaration (Section 6).             │
└────────────────────────────────────────────────────────┘
```

**Design rule:** Segments A, C, and E are versioned together as a single **prompt version** (Section 14) — they are never changed independently of each other, because a change to task framing without a corresponding change to the few-shot examples (or vice versa) is exactly the kind of drift that silently degrades mapping quality without an obvious cause.

Segment B is **data, not prompt** — it is assembled at request time from `CONFIG` (LLD §9) and is not part of prompt versioning; it changes when the target schema changes, independent of prompt logic changes.

---

## 3. System Prompt Structure

The system/instruction content (Segment A) is structured into four ordered components, each with a specific job:

1. **Role and task statement** — establishes the narrow scope: classify each given column against a fixed target schema, nothing else.
2. **Explicit non-goals** — states directly what the model must not do: must not invent values, must not assume a column's meaning from field position/order, must not treat two columns as related to each other unless values plainly indicate it, must not force a mapping when evidence is weak.
3. **Uncertainty-handling instruction** — explicitly instructs that returning `UNMAPPED` with low confidence is a correct and preferred output when evidence is weak or conflicting, not a failure to avoid. This is the single most important sentence in the system prompt, because it directly counteracts the default LLM tendency to produce a confident-sounding answer regardless of actual certainty.
4. **Output discipline statement** — states that output must conform exactly to the declared structured output contract (Section 6), with no additional commentary outside the structured fields.

**Design constraint:** the system prompt content itself contains **no schema-specific detail** (no field names, no examples referencing actual field names) — all of that lives in Segments B and C. This keeps Segment A stable even as the target schema evolves, which matters because Segment A is the most expensive part of the prompt to re-validate (it affects model behavior globally, not just for one field).

---

## 4. Context Injection Strategy

| Context Element | Source | Injection Point | Scope |
|---|---|---|---|
| Column header text | `HDRX` output (`ColumnProfile`) | Segment D | Per column |
| Sample values | `HDRX` output, bounded count (`CONFIG`: `header_analysis_sample_size`) | Segment D | Per column |
| Target field enum + business meaning + alt-name patterns | `CONFIG` | Segment B | Per request (whole file) |
| Other columns' headers (context-only, not for mapping them) | `HDRX` output | Segment D, as lightweight sibling context | Per request |
| Few-shot examples | Curated example set (Section 5) | Segment C | Per request (static per prompt version) |

**Why other columns' headers are included as context:** a column header like `"Amount"` is ambiguous in isolation, but far less ambiguous next to `"Deal Stage"` and `"Close Date"` (suggesting a sales-pipeline context) versus next to `"Monthly Budget"` and `"Campaign Name"` (suggesting an ad-spend context). Providing the full header list as lightweight surrounding context — without asking the model to reason about relationships between columns as a task — captures this signal cheaply.

**What is deliberately excluded from context:**
- Full column values (only a bounded sample) — including the full column would blow up token cost for no proportional accuracy gain, since a representative sample is sufficient for a header-meaning classification task.
- Any data from other files or other organizations' past imports — mapping memory (PRD Category B) is explicitly out of scope for this version of `AIMAP` (Section 18).
- Row-level relationships between columns (e.g., "does column X's value ever exceed column Y's value") — this would require row-level reasoning, which is outside `AIMAP`'s column-level task scope (Section 1).

---

## 5. Few-Shot Example Strategy

**Selection principle:** examples are chosen to span the ambiguity spectrum, not to maximize coverage of "easy" cases.

| Example Category | Purpose | Approximate Count |
|---|---|---|
| **Unambiguous, canonical** (e.g., header exactly matches a known pattern) | Anchors baseline behavior | 2–3 |
| **Synonym/alternate naming** (e.g., non-obvious but decodable header) | Demonstrates semantic reasoning beyond literal string match | 3–4 |
| **Ambiguous, resolved by sample values** (header alone is unclear, values disambiguate) | Demonstrates that sample values are a first-class signal, not a tiebreaker | 2–3 |
| **Genuinely ambiguous — correct answer is `UNMAPPED`, low confidence** | Demonstrates and reinforces Segment A's uncertainty-handling instruction with a concrete worked example, not just an abstract rule | 2–3 |
| **Multiple plausible target fields, model must pick most likely and note the alternative in rationale** | Demonstrates handling of the "two phone columns" class of case from PRD §10 | 1–2 |

**Design rule:** the `UNMAPPED`/low-confidence example category is treated as equally important as the canonical-match category, not a minor addendum — its absence or under-representation is the most likely root cause if the model is later observed to be overconfident in production (Section 15's calibration testing is designed specifically to catch this).

**Example set governance:** the few-shot set is versioned as part of the prompt version (Section 14), sourced from real (anonymized) column headers observed in testing/production over time — not invented in the abstract — so that the examples reflect actual messiness rather than a designer's idealized guess at what messy data looks like.

---

## 6. Structured Output Schema

Defined at the field/constraint level (not as literal code):

**Per-request output = array of one object per input column, in the same order as Segment D's input.**

| Field | Type | Constraint |
|---|---|---|
| `column_header` | string | Must exactly echo the input header (used by `AIMAP`'s output validation to confirm response alignment — see Section 9) |
| `target_field` | enum | Must be one of the values in the Segment B schema enum, or the literal `UNMAPPED` |
| `confidence` | number | Range [0.0, 1.0] |
| `rationale` | string | Bounded length (short — a sentence, not a paragraph; enforced to control both cost and to keep Mapping Review UI rationale text scannable per UX Spec §3.3) |

**Enforcement mechanism:** output is required via the model provider's structured-output/schema-constrained generation capability where available, so that `target_field` cannot syntactically be a value outside the enum. This is the primary defense; `AIMAP`'s deterministic output-validation step (LLD §2.4) is the secondary, mandatory defense regardless of whether structural enforcement is available or perfect (never assume the primary defense is sufficient on its own — see Section 8).

**Order-and-count invariant:** the output array must contain exactly one entry per input column, in input order. A response with a mismatched count or reordered/missing `column_header` echoes is treated as `AIMappingMalformedOutput` (LLD §10), not partially accepted.

---

## 7. Confidence Scoring Strategy

**What confidence represents:** the model's self-assessed certainty that `target_field` is the correct mapping for this specific column, given the evidence it was shown. It is explicitly *not* calibrated to any external ground-truth accuracy rate at launch — see Section 15 for how that gap is monitored and closed over time.

**How confidence is produced:** requested directly as part of the structured output (Section 6), guided by the few-shot examples (Section 5) that demonstrate the target range of scores across the ambiguity spectrum — not derived post-hoc from token probabilities or a separate scoring pass, since that would add a second inference cost for a signal the model can reasonably self-report given well-designed examples.

**How confidence is consumed:** exclusively by `MAPFIN`'s threshold routing (LLD §2.5) — `AIMAP` itself makes no decision based on the confidence value it produces; it is a pass-through output, not an internal control signal.

**Confidence tiering for UX (UX Spec §4 Confidence Badge):** the raw float is bucketed into high/medium/low tiers at the presentation layer, not by `AIMAP` — `AIMAP`'s contract only ever returns the raw float, keeping the tiering logic (and its thresholds, which are a UX/product tuning concern) out of the AI component entirely.

**Guardrail against confidence inflation:** the system prompt (Section 3) and few-shot set (Section 5) both explicitly reward appropriate low confidence — this is a prompt-engineering-level guardrail, reinforced structurally by Section 15's calibration testing rather than relied upon alone.

---

## 8. Hallucination Prevention

Layered defenses, each independent (no single point of failure):

1. **Grounded input only** — the model is only ever given real header text and real sample values extracted directly from the file (Section 4); it is never asked to infer or assume data it wasn't shown.
2. **Enum-constrained output** — `target_field` cannot be a fabricated field name; it is constrained to the known schema enum plus `UNMAPPED` (Section 6), both structurally (where supported) and by mandatory post-hoc validation.
3. **Echo-based alignment check** — requiring `column_header` to be echoed back per entry (Section 6) lets `AIMAP`'s output validation catch a response that has silently drifted from the actual input (e.g., hallucinated an extra column, or dropped one), not just a response with an invalid field name.
4. **Explicit permission to abstain** — Section 3's uncertainty-handling instruction and Section 5's worked `UNMAPPED` examples directly reduce the model's incentive to produce a confident-sounding fabrication when the honest answer is "unclear."
5. **No open-ended generation surface** — rationale (Section 6) is the only free-text field, and it is bounded and non-actionable (it is never parsed or acted on programmatically — only displayed), so even a hallucinated rationale sentence cannot corrupt downstream pipeline behavior, only (at worst) mildly mislead a human reviewer who can independently see the header and sample values right next to it in the UX Spec's Mapping Review screen.

---

## 9. Validation Pipeline (AI Output Validation — internal to `AIMAP`)

This is distinct from and upstream of `VALID` (LLD's deterministic row validation component) — this section covers only the validation `AIMAP` performs on the LLM's raw response before returning `MappingProposal[]` to `MAPFIN`.

```
Raw LLM response
      │
      ▼
[1] Is it well-formed structured output matching Section 6's shape?  ──fail──▶ AIMappingMalformedOutput
      │ pass
      ▼
[2] Does entry count match input column count, in order?             ──fail──▶ AIMappingMalformedOutput
      │ pass
      ▼
[3] Does every column_header echo match its corresponding input?      ──fail──▶ AIMappingMalformedOutput
      │ pass
      ▼
[4] Is every target_field either in the schema enum or UNMAPPED?      ──fail──▶ AIMappingMalformedOutput
      │ pass
      ▼
[5] Is every confidence within [0.0, 1.0]?                             ──fail──▶ AIMappingMalformedOutput
      │ pass
      ▼
Valid MappingProposal[] returned to MAPFIN
```

**Design rule:** this is an all-or-nothing gate at the level of a single LLM response — a response that fails any check is treated as a full failure of that call (feeding into Section 10's retry strategy), not partially salvaged. Partial salvage (accepting the valid entries, discarding the invalid ones) was considered and rejected: silently dropping a malformed entry would mean a real column silently receives no mapping proposal at all, which is a worse outcome than an explicit retry or an explicit `UNMAPPED` from the fallback path (LLD §10).

---

## 10. Retry Strategy

| Failure Type | Retry Behavior |
|---|---|
| Provider timeout | Retry up to `CONFIG`-defined `ai_mapping_max_retries`, with exponential backoff between attempts |
| Malformed/invalid structured output (Section 9 gate failure) | Retry once with an unmodified prompt (transient generation issue is the working assumption for a first retry) before escalating |
| Repeated malformed output across all retries | Escalate to `AIMappingHardFailure` (LLD §10) — not silently converted to blanket `UNMAPPED` for the whole file, since that would be a materially worse and more confusing outcome than a clear "mapping failed, please retry the import" signal |
| Partial-batch timeout (some columns' worth of reasoning returned, request cut off) | Treated identically to a full timeout — no partial-response parsing is attempted, consistent with Section 9's all-or-nothing gate |
| Provider-side rate limiting | Distinguished from a generic timeout at the client level (LLD's `/llm_provider_client`) and retried with provider-appropriate backoff, separate from the `ai_mapping_max_retries` budget used for generation-quality retries — this keeps "the provider is busy" from consuming the same retry budget as "the model produced bad output" |

**Retry budget is per-request (per file's mapping call), not per-column** — because columns are batched into a single call (Section 11), there is no meaningful per-column retry; a retry re-runs the entire batch.

---

## 11. Batch Processing Strategy

**Unit of batching: all columns of a single file, in one request.** This is a direct continuation of HLD Decision #2 and LLD §8's design constraint — restated here with the AI-engineering-level reasoning:

- Keeps inference cost and latency a function of column count (small, bounded) rather than row count (potentially large) — the core performance guarantee (PRD §7).
- Preserves the cross-column context benefit described in Section 4 — batching columns together is not just a cost optimization, it is also what makes the "other headers as lightweight context" signal available at all.

**Upper bound on batch size:** if a file has an unusually large number of columns (rare, but possible with heavily merged/legacy exports), the batch is capped at a `CONFIG`-defined maximum columns-per-request; columns beyond the cap are processed in a second sequential request rather than silently truncated or dropped. This is a deliberate, documented exception to "always one request per file," bounded and rare rather than a general multi-request pattern.

**No row-level batching exists in this design** — reiterated from Section 1: `AIMAP` never processes rows, only column metadata, so "batch size" here refers exclusively to column count, not row count.

---

## 12. Token Optimization

| Lever | Strategy |
|---|---|
| Sample value count per column | Bounded via `CONFIG` (`header_analysis_sample_size`) — enough values to disambiguate typical cases (Section 5), not the full column |
| Sample value selection | Representative, not exhaustive — favor distinct/non-null values over the literal first N rows, since the first N rows of a real export are disproportionately likely to be near-duplicates or blank |
| Segment B (schema context) size | Field business-meaning text kept concise (a phrase, not a paragraph) per field; alt-name pattern lists capped per field to the most common variants rather than an ever-growing exhaustive list |
| Few-shot example count/length (Section 5) | Deliberately small and curated rather than large and comprehensive — the design bets on a few well-chosen examples generalizing, re-validated via Section 15's testing rather than defaulting to "more examples = safer" |
| Rationale field length (Section 6) | Explicitly bounded — this is both a UX requirement (UX Spec §3.3) and a token-cost lever, since rationale is generated once per column per request |
| Sibling-header context (Section 4) | Headers only, not sample values, for non-target columns in the cross-column context — full context richness is reserved for the column actually being classified in a given entry |

**Governing principle:** every context element included in the prompt must trace to a specific, named reason it improves mapping quality (Sections 4–5); nothing is included by default "just in case" — this keeps token cost aligned with actual accuracy contribution rather than growing unchecked over time.

---

## 13. Cost Optimization

- **Batching (Section 11)** is the primary cost lever — it is what keeps per-file cost proportional to column count rather than row count, which is the single largest cost-driving decision in this specification.
- **Prompt caching** (where the provider supports it): Segments A, C, and E (Section 2) are static per prompt version and identical across every request regardless of file — these are the natural candidates for provider-level prompt caching, since only Segments B and D vary per request.
- **Retry budget ceilings (Section 10)** double as a cost control — unbounded retries would be both a reliability and a cost risk; the same `CONFIG` value serves both concerns.
- **No speculative/exploratory calls** — `AIMAP` makes exactly one (or, in the rare capped-batch-overflow case from Section 11, at most a small bounded number of) calls per import; there is no design pattern here of calling the model multiple times to "vote" or self-consistency-check, since Section 9's deterministic output validation is the chosen mechanism for catching bad output, not redundant sampling.
- **Mapping-memory as a future cost lever (Category B, Section 18):** explicitly noted here because it is as much a cost optimization as a UX one — a cache hit on a previously-seen source format could bypass the AI call entirely. Not built now, but the architecture (LLD §13 extension point) already anticipates it.

---

## 14. Prompt Versioning

- **Unit of versioning:** the full combination of Segments A, C, and E (Section 2) is versioned as a single atomic **prompt version identifier** — never versioned piecemeal (e.g., "just update the examples") without incrementing the whole version, because Section 5 established that instructions and examples are interdependent.
- **Segment B (schema context) is not part of prompt versioning** — it changes independently, driven by `CONFIG`/schema changes, and is expected to change more frequently than the reasoning instructions themselves.
- **Every `MappingProposal` output is tagged with the prompt version that produced it** (flows into `DecisionRecord`, LLD §11), so that a later accuracy regression can be correlated to a specific prompt version change, not just to "some point in time."
- **New prompt versions are validated against the full golden-file test suite (Section 15) before replacing the active version** — no prompt version reaches production by direct edit-and-deploy.
- **Rollback is a version-pointer change, not a content restoration exercise** — because versions are immutable, retired versions remain available to roll back to instantly if a new version regresses in production.

---

## 15. AI Testing Strategy

Extends LLD §12's testing layers with AI-specific detail:

| Test Type | What It Covers | How It's Run |
|---|---|---|
| **Structural/contract tests** (LLD §12) | `AIMAP`'s output validation (Section 9) against adversarial fake responses — malformed JSON, wrong enum values, mismatched counts, out-of-range confidence | Fully deterministic, no live model calls, runs on every commit |
| **Golden-file mapping accuracy tests** | A fixed, versioned set of real-shaped (synthetic) CSVs — spanning the source types named in the PRD (Facebook Lead Ads-style, Google Ads-style, agency exports, legacy CRM exports) — each with a pinned expected mapping outcome | Run against live (or recorded) model responses whenever a prompt version changes; not run on every commit due to cost/latency, but mandatory before any prompt version promotion (Section 14) |
| **Confidence calibration tests** | Statistical check: among mappings the golden-file set marks as "should be low confidence" (ambiguous cases), does the model actually score them lower than the "should be high confidence" cases? | Run alongside golden-file tests; this is the mechanism that catches the confidence-inflation risk named in Section 7 |
| **Regression tests** | Re-run the full golden-file set against the *previous* prompt version whenever the golden-file set itself is updated, to confirm the golden-file change didn't silently redefine "correct" out from under the existing baseline | Run when the golden-file set changes, independent of prompt changes |
| **Adversarial/edge-case tests** | Deliberately hostile inputs: headers in non-English languages, headers that are themselves nonsensical/random strings, columns with entirely null samples, columns whose values plainly contradict their header | Part of the golden-file suite, explicitly labeled as an edge-case subset so pass/fail on this subset can be tracked separately from "normal" accuracy |
| **Live-provider drift monitoring** (LLD §12's "manual/exploratory" layer, made concrete here) | Periodic (e.g., scheduled, not per-commit) re-run of the golden-file suite against the live provider/model, even with no prompt version change, to catch provider-side model updates that silently change behavior | Scheduled job, alerts on any accuracy or calibration regression versus the last known-good baseline |

---

## 16. Edge Cases

| Edge Case | Handling Within `AIMAP`'s Design |
|---|---|
| Column with entirely null/blank sample values | Segment D still includes the header with an explicit "no sample values available" marker rather than omitting the column; the model is instructed (Segment A) that header-only evidence is weaker and should generally lower confidence |
| Column header in a non-English language | No special-casing required by design — the model's general language capability is relied upon, but this exact scenario is represented in the golden-file edge-case suite (Section 15) to confirm it in practice rather than assume it |
| Column header that is itself meaningless (e.g., `"Column12"`, auto-generated) | Expected to resolve via sample values alone (Section 4); if sample values are also unhelpful, expected to resolve to `UNMAPPED`, low confidence — this is exactly the case the Section 5 `UNMAPPED` examples exist to reinforce |
| Two columns that are near-duplicates of each other (e.g., both plausibly "phone") | Handled by the cross-column context (Section 4) — the model has visibility into both headers when reasoning about each, allowing it to note the alternative in rationale (Section 5's "multiple plausible target fields" example category); final primary/alternate resolution remains `MAPFIN`'s job (Section 1), not `AIMAP`'s |
| Extremely wide file (very large column count) | Handled by Section 11's batch-size cap, not by asking the model to reason about more columns per call than tested |
| Column values that look like they belong to the schema but the header actively contradicts it (e.g., header `"Notes"` containing only well-formed email addresses) | Segment A's instruction to weigh both header and values (not header alone) governs this; represented in the golden-file suite as its own case, since header-value conflict is a meaningfully different scenario than header-value agreement or header-alone ambiguity |
| Duplicate headers in the same file (e.g., two columns both literally named `"Phone"`) | `AIMAP` treats each by its column position, not by header text alone — the echo-based alignment check (Section 6/9) is what keeps two same-named columns from being conflated in the response |

---

## 17. Failure Handling

Restated at the `AIMAP`-internal level, cross-referenced to LLD §10's system-wide taxonomy (no new error categories introduced — this section maps AI-specific failure causes onto the already-approved taxonomy):

| Internal Cause | Maps To (LLD §10) | Downstream Behavior |
|---|---|---|
| Network/provider timeout, retries exhausted (Section 10) | `AIMappingTimeout` | Affected request's columns marked `UNMAPPED`, routed to human review (not a hard pipeline failure) |
| Section 9 validation gate failure, retries exhausted | `AIMappingMalformedOutput` | Same as above |
| Provider unreachable / auth failure / retry budget exhausted at the connectivity level | `AIMappingHardFailure` | Terminal for the import run — the only case where `AIMAP`-originated failure is *not* absorbed into human review, because there is no valid AI output to review at all |
| Batch-size-cap overflow request itself fails (Section 11's second request) | `AIMappingTimeout` or `AIMappingMalformedOutput`, whichever applies | Only the overflow columns are affected — the first (successful) batch's proposals are not discarded |

**Design rule preserved from HLD §6:** a timeout and a malformed response are always handled identically at the pipeline level — `AIMAP` does not attempt to communicate a distinction between "the model was slow" and "the model was wrong" to the rest of the system, because neither is actionable by `MAPFIN` or the user; both simply mean "no trustworthy AI proposal exists for this column, ask a human."

---

## 18. Future Extensibility

Explicitly deferred capabilities, noted here so `AIMAP`'s current design doesn't foreclose them (mirrors LLD §13's extension points, made concrete for the AI subsystem specifically):

| Future Capability | How Today's Design Accommodates It |
|---|---|
| **Per-organization mapping memory** (PRD Category B) | Positioned as a lookup *before* `AIMAP` is called at all (LLD §13) — `AIMAP`'s contract doesn't change; it simply gets called less often (cache hit → skip) or with a biasing hint injected into Segment D (cache partial-match → still call, but with a steer). Either integration mode is possible without altering Sections 1–17 of this spec. |
| **Confidence calibration feedback loop** (using human corrections to systematically improve confidence accuracy over time, not just monitor it — Section 15) | `MappingProposal` and the corresponding `HumanCorrection` (LLD §5) are already both captured in `AUDIT` — a future calibration-improvement process can be built entirely on querying existing decision records, without new instrumentation |
| **Multi-schema support** (mapping to more than one fixed target schema, e.g., per-CRM schemas) | Segment B is already fully data-driven from `CONFIG` (Section 2, Section 4) — supporting a second schema is a configuration change, not a prompt architecture change |
| **Free-text field extraction** (structured info from the `notes`/free-text field, PRD Category D) | Explicitly out of scope for `AIMAP` as specified — this would be a materially different task (extraction, not classification) and, if built, should be a separate component with its own AES, not an extension of this one |
| **Self-hosted/alternate model provider swap** | The client boundary (LLD's `/llm_provider_client`) is already the sole integration point (LLD §14) — this spec's prompt architecture (Section 2) is provider-agnostic by design (relies on a general structured-output capability, not a provider-specific feature), so a provider swap is expected to require prompt-version re-validation (Section 15) but not a redesign of this document |

---

*End of AI Engineering Specification — ready to guide implementation of the AI Mapping Engine (`AIMAP`) without further product or architectural decisions.*