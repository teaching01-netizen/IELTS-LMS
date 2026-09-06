# ADR-007 - frontend feature and ports architecture

Status - accepted.

Context - React components had absorbed distributed-systems logic (fencing, recovery, coalescing) that belongs in testable layers.

Decision - features slash student-attempt with domain, application, ports, infrastructure, react layers. UI renders through hooks through ports through adapters. Shared error taxonomy lives in shared so the layer direction stays shared-from-features. Components render product behavior, never protocol logic.

Consequences - the layer-dependency architecture test enforces the direction. New exam providers add adapters, not component branches.
