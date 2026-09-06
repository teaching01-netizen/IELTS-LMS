# ADR-003 - V2-only student durability

Status - accepted.

Context - two response protocols double every fencing, replay, and recovery argument. The rewrite converges on one canonical protocol while in-flight V1 attempts drain.

Decision - V2 is canonical - mutation ledger plus response projection plus per-question monotonic lease and version rule. New attempts mint protocol_version 2. V1 is migration-only reads, removed after the drain query hits zero plus the safety window.

Consequences - no new V1 mutation logic ever. Final tree has no V2 product switch (plan 127).
