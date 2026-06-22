# Exam version projection contracts

The version endpoint supports `full`, `metadata`, `builder`, and `grading`
projections. Access remains restricted by the endpoint's role and organization
authorization checks.

- `full` is the backward-compatible complete version response.
- `metadata` excludes content and configuration snapshots and supplies payload
  size hints for lazy-loading decisions.
- `builder` is lossless editable state for builder and admin consumers. It must
  preserve answer keys, answer rules, answer trees, and every other field that
  can be saved by the builder.
- `grading` currently uses the complete version response required for grading.

Redaction must not be added to `builder`. Any future student-facing or
read-only redacted representation requires a dedicated projection and contract
tests proving that it cannot be used as editable state.

Builder projection ETags are schema-versioned. Any change to the projection's
field set or semantics must bump the ETag namespace so cached responses from an
older representation cannot validate against the new representation.

Clients loading `builder` must merge `configSnapshot` into `contentSnapshot`
before hydration. When a selected version changes, clients must discard prior
state and ignore responses from older requests.
