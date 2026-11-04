# PathWise Phase 2 — Production Performance Benchmark

**Run date:** 2026-11-03
**Environment:** Local production build calling the configured Sarvam service
**Scope:** 24 live `/api/extract` requests: 1, 3, 5, and 10 pages, with three repetitions each for text-based and scanned PDFs. Fixtures were generated for this benchmark and contain only synthetic notice text.

## Executive summary

- **23/24** requests produced an extraction. The remaining scanned one-page request failed after both Stage A attempts were cut off at the 4,096-token completion limit.
- Stage A was the dominant latency source: model request median **30.21 s** (range **18.51–52.69 s**). Overall client-observed median was **30.34 s** (range **20.53–95.64 s**).
- Four initial Stage A responses were truncated and repaired; three repairs recovered. The failed request’s repair was also truncated, for **5 truncated responses among 28 model calls**.
- All successful outputs captured the expected classification, action, required documents, date, and consequence effect. However, the full conditional trigger was captured in only **19/23** outputs, and evidence was verified against source text in only **2/23**.
- All test documents fit in one Stage A section. The 10-page cases completed in one Stage A call each and did not truncate, but the fixtures were repetitive and do not establish reliability for representative 10-page documents.
- **This benchmark does not justify page-level extraction based on page count alone.** It does expose output-truncation and evidence-quality risks that need more representative validation before an architecture decision.

## Method

The test matrix used eight generated PDFs, each submitted three times in a shuffled order:

- Text PDFs exercised the embedded-text-layer path.
- Scanned PDFs exercised Sarvam OCR.
- All pages contained the same synthetic notice facts plus a unique page marker. This tests page ingestion and call scaling, but is not a representative multi-action or page-specific extraction corpus.
- Expected facts were manually defined from the fixture text: classify as a notice; submit the verification form; require proof of address and an identity card; deadline `2027-12-15`; and preserve the stated condition and possible consequence.
- Quality was assessed from the returned extraction and its evidence-validation status, not from HTTP status alone.
- The run used model `sarvam-105b`, configured `max_tokens=4096`, and made no explicit reasoning-effort setting. Token usage was available for all 28 model calls.

These are three observations per case. Reported ranges describe this run only; they are not stable latency percentiles or a broad reliability estimate. Benchmark API billing was not measured.

## Per-case results

Times are seconds. “Total, reps 1/2/3” and “Stage A, reps 1/2/3” preserve the observed run order. OCR values are median submission/polling/download durations for the three scanned runs. Token medians/ranges are per model call and include repairs.

| Input             | Total request, reps 1/2/3 | Stage A, reps 1/2/3   | OCR submit / poll / download | Model calls; repairs; `length` finishes | Input tokens median (range) | Output tokens median (range) | Extractions | Evidence verified |
| ----------------- | ------------------------- | --------------------- | ---------------------------- | --------------------------------------: | --------------------------: | ---------------------------: | ----------: | ----------------: |
| Text, 1 page      | 40.59 / 23.86 / 30.30     | 39.67 / 23.79 / 30.24 | —                            |                                 3; 0; 0 |               879 (879–879) |          3,554 (2,602–3,686) |         3/3 |               1/3 |
| Text, 3 pages     | 20.53 / 29.08 / 30.39     | 20.40 / 29.03 / 30.20 | —                            |                                 3; 0; 0 |         1,121 (1,121–1,121) |          3,217 (2,040–3,367) |         3/3 |               1/3 |
| Text, 5 pages     | 79.02 / 25.44 / 26.64     | 78.92 / 25.28 / 26.56 | —                            |                                 4; 1; 1 |         1,363 (1,363–1,380) |          3,748 (3,407–4,096) |         3/3 |               0/3 |
| Text, 10 pages    | 24.81 / 34.44 / 25.58     | 24.59 / 34.21 / 25.40 | —                            |                                 3; 0; 0 |         1,983 (1,983–1,983) |          3,419 (2,816–3,487) |         3/3 |               0/3 |
| Scanned, 1 page   | 86.16 / 34.47 / 30.50     | 83.05 / 31.70 / 27.66 | 0.63 / 1.64 / 0.62           |                                 4; 1; 2 |               875 (875–892) |          3,799 (2,870–4,096) |         2/3 |               0/2 |
| Scanned, 3 pages  | 30.80 / 29.53 / 71.83     | 27.53 / 26.40 / 68.98 | 0.56 / 1.65 / 0.82           |                                 4; 1; 1 |         1,111 (1,111–1,128) |          3,762 (3,143–4,096) |         3/3 |               0/3 |
| Scanned, 5 pages  | 36.64 / 28.00 / 95.64     | 33.13 / 24.83 / 92.12 | 1.01 / 1.61 / 0.68           |                                 4; 1; 1 |         1,342 (1,342–1,359) |          3,593 (3,356–4,096) |         3/3 |               0/3 |
| Scanned, 10 pages | 42.77 / 25.99 / 22.33     | 38.96 / 22.50 / 18.52 | 1.38 / 1.60 / 0.69           |                                 3; 0; 0 |         1,950 (1,950–1,950) |          2,930 (2,558–3,875) |         3/3 |               0/3 |

Every document required **one Stage A section**. Stage B was not invoked because every request contained one document.

### Stage A model-call duration by attempt

These are individual model request durations (seconds), separate from the per-request Stage A totals above. Repairs are shown with the repetition that invoked them.

| Input             | Initial call durations, reps 1/2/3 | Repair call duration |
| ----------------- | ---------------------------------- | -------------------: |
| Text, 1 page      | 39.59 / 23.79 / 30.23              |                    — |
| Text, 3 pages     | 20.39 / 29.03 / 30.19              |                    — |
| Text, 5 pages     | 38.29 / 25.27 / 26.56              |         Rep 1: 40.62 |
| Text, 10 pages    | 24.59 / 34.19 / 25.39              |                    — |
| Scanned, 1 page   | 40.54 / 31.70 / 27.65              |         Rep 1: 42.49 |
| Scanned, 3 pages  | 27.52 / 26.39 / 36.30              |         Rep 3: 32.67 |
| Scanned, 5 pages  | 33.13 / 24.82 / 52.69              |         Rep 3: 39.43 |
| Scanned, 10 pages | 38.95 / 22.49 / 18.51              |                    — |

## Per-stage timing

| Stage or metric                          |        Sample count |         Median |          Range |
| ---------------------------------------- | ------------------: | -------------: | -------------: |
| Upload body parsing                      |                  24 |           5 ms |        0–20 ms |
| Validation                               |                  24 |         0.5 ms |        0–40 ms |
| Digitisation                             |                  24 |         1.58 s |   17 ms–3.78 s |
| OCR submission                           |                  12 |         0.76 s |    0.34–1.58 s |
| OCR polling, including polling waits     |                  12 |         1.61 s |    1.58–1.75 s |
| OCR download, parsing, and text assembly |                  12 |         0.69 s |    0.53–0.96 s |
| OCR total                                |                  12 |         3.13 s |    2.71–3.73 s |
| Stage A, including any repair            |                  24 |        28.34 s |  18.52–92.12 s |
| Stage A JSON parsing                     |                  24 |           0 ms |         0–1 ms |
| Stage A schema validation                |                  24 |         0.5 ms |        0–12 ms |
| Stage A repair                           |                  24 |           0 ms |      0–42.50 s |
| Stage B                                  |                   0 | Not applicable | Not applicable |
| Dependency resolution                    | 23 successful plans |           0 ms |         0–2 ms |
| Priority calculation                     | 23 successful plans |           0 ms |         0–3 ms |
| Server request total                     |                  24 |        30.31 s |  20.50–95.60 s |
| Client-observed request total            |                  24 |        30.34 s |  20.53–95.64 s |
| Model request duration                   |            28 calls |        30.21 s |  18.51–52.69 s |

OCR stage values are null/not applicable for text-layer PDFs. The single extraction failure occurred after OCR had completed and reached Stage A; the error response did not include the normal `processing` summary.

## Token use, truncation, and retries

- **28 model calls:** 24 initial Stage A calls and 4 serial Stage A repairs.
- **Model calls:** all used `sarvam-105b`, `max_tokens=4096`; no reasoning-effort parameter was supplied.
- **Token telemetry:** prompt and completion usage were present on **28/28** calls. Aggregate usage was **36,631 input tokens** and **96,514 completion tokens**.
- **Finish reasons:** 23 `stop`, 5 `length`, 0 unavailable.
- **Initial truncation:** 4/24 initial requests (16.7%) reached `length`. Three repaired successfully; one did not.
- **Repairs:** 4/24 requests (16.7%) used the repair attempt. Three recovered; one repair also reached `length` and the extraction failed.
- **Sections:** all 24 documents were below the sectioning threshold and used one Stage A section. A ten-page document was one request, not ten page requests.

Failed request: scanned one-page fixture, request ID `0b890ddc-d805-4d8e-bac9-b61df6e5ae6d`. The initial Stage A call took 40.54 s and returned `length` at 4,096 completion tokens; the repair took 42.49 s and also returned `length`. The request returned HTTP 502 after 86.16 s.

## Extraction quality against fixture truth

The 23 successful extraction outputs were evaluated individually:

| Check                                                            | Result |
| ---------------------------------------------------------------- | -----: |
| Broad document classification as a notice                        |  23/23 |
| Required action captured                                         |  23/23 |
| Both required-document concepts captured                         |  23/23 |
| Deadline normalized to `2027-12-15`                              |  23/23 |
| Consequence effect captured                                      |  23/23 |
| Full conditional trigger and effect captured                     |  19/23 |
| Evidence text included expected action/deadline concepts         |  23/23 |
| Evidence accepted by source-text validation                      |   2/23 |
| One plan action with no duplicate for the single expected action |  23/23 |
| Correct source page (`1`) for the repeated page-1 facts          |  23/23 |

In most runs, the evidence snippet combined the action and deadline while omitting intervening source text (often the required-documents statement). It was therefore not a contiguous quote, and the existing validator correctly rejected it. Two outputs provided evidence that validated. This is a material evidence-quality limitation despite the extracted fields often matching the expected values.

Four successful outputs retained the consequence effect but omitted its explicit “if not received by the deadline” trigger. The fixture did not contain multiple distinct tasks, so the no-duplicate result applies only to its single expected action.

All pages were included in the text-layer/OCR input: successful responses reported the expected page count, and all 12 scanned requests reached Stage A after OCR. However, every successful extraction cited only `source_page: 1`; the output does not establish per-page citation coverage. Because the same facts were repeated on every page, this fixture cannot validate extraction of unique page-specific facts.

## Bottleneck and recommendation

Upload parsing, validation, JSON parsing, schema validation, dependency resolution, and priority calculation were negligible compared with model response time. OCR added roughly 3.1 s median for scanned files. Stage A dominated latency; retries explain the longest 79–96 s runs. Latency varied substantially between repetitions, including in the small single-page cases.

The 10-page synthetic cases all completed with one Stage A call and no truncation, but their short, repeated content is not enough to claim ten-page scalability. The benchmark gives no basis to assume page count alone predicts output size or latency.

**Recommendation: do not introduce page-level extraction solely because documents have 10 pages.** It would multiply model calls and add consolidation, duplication, and evidence-reconciliation risks, while the tested ten-page requests did not truncate. The observed truncation rate still warrants follow-up, but it appears tied to completion size/response variability rather than page count in this small sample. Before redesigning, benchmark more diverse sanitized documents with page-specific actions, multi-item tables, conditional rules, and longer expected outputs; use at least five repetitions per case. Prioritize investigating contiguous evidence generation and conditional-trigger retention as separate quality issues.

No extraction architecture or code was changed during this benchmark.
