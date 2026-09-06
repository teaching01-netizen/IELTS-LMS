# ADR-008 - generated OpenAPI client

Status - accepted.

Context - hand-written fetch calls drift from the wire contract, especially error codes and V2 envelope shapes.

Decision - api openapi openapi.yaml is the wire authority. The TS client is shaped like generated output (typed paths, envelope decoding, request-id propagation). CI lints the spec and checks client freshness.

Consequences - contract changes start in the spec, then the client, then handlers. Breaking wire changes need versioned paths.
