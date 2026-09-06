# ADR-009 - V1 retirement policy

Status - accepted.

Context - V1 must die without stranding live exams or rewriting history.

Decision - six stages - new attempts V2-only, frontend V2-only, legacy serves in-flight V1, drain query to zero, safety window, then delete handlers, transport, repository paths, flags, and conflict-only code. Never convert a running V1 exam mid-attempt. Historical data stays on immutable snapshots.

Consequences - deletion needs evidenced gates per item (drain count, traffic, observation, rollback independence). Tables may outlive code for historical reads.
