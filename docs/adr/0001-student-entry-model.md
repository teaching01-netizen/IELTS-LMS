# ADR 0001: Invite-code-required student entry (closed-by-default)

Status: accepted · Date: 2026-09-09 · Scope: `POST /api/v1/auth/student/entry`

## Decision

Direct (link-less) schedule entry requires a **live invite code by
default**. The `wcode` must be a selected-student code on **any active
access link for the schedule**; bound name/email rows additionally bind
identity case-insensitively. The check runs **before any mint** (before
the email user lookup/mint and before `CreateRegistration`), so a
rejected check-in writes zero rows: no user, no registration, no attempt.

The **only** open-entry path is the existing link branch
(`accessLinkId != ""` → `AccessLinks.ResolveEntry`): `ModeOpen` links
admit without a per-student code, gated by link lifecycle/window. There
is no per-schedule open flag and no schema change in this round.

Wrong code, unknown schedule, and unknown/expired/paused link all render
the identical collapse envelope — `404 NOT_FOUND` / `"Resource not
found."` (same message as the proctor live-assignment miss) — so
probes cannot distinguish them.

## Why closed-by-default

- **Unauthenticated minting.** Entry mints a user row (on new email), a
  registration, an attempt + bearer token, and a student session, all
  pre-auth. With any-non-empty-code accepted, anyone could mint rows for
  any schedule.
- **Unchecked `wcode`.** Any non-empty code worked; an empty code fell
  back to a synthetic `OPEN-<userhash>` registration key, so the code
  field gated nothing.
- **Enumerable `scheduleId`s.** The public `GET
  /auth/student/schedules/{id}` metadata handler is unauthenticated, so
  schedule IDs are discoverable (left unchanged this round; see Round
  2). Combined with unchecked codes, discovery implied entry.
- **`isStudentEntryAccountAllowed` ignores role** — deliberately kept:
  the passwordless flow only ever mints a **student-scoped** session, so
a staff email gains exam access, never staff privileges. The fix is not
  a role gate but gating the auto-mint behind the code check, which the
  pre-mint gate does.

## What the link branch does

`accessLinkId != ""` resolves via the existing access-links service
(`ResolveEntry`: locked link + schedule read — lifecycle, roster /
identity, backing-schedule window). `ResolveEntry` errors now collapse
to the same 404 envelope instead of propagating the underlying reason
(which oracled link roster state). The pre-existing `ModeStudentCode`
empty-code `400` stays: emptiness is client-visible request shape (kept
for UX), while wrong-vs-unknown stays 404-collapsed.

## Known gaps (explicitly out of scope)

- **`captchaToken` is accepted but never verified.** A bot can still
  drive the 30/min/email+IP bucket + tier limits at machine speed.
  Verification is deferred to Round 2.
- **Schedule metadata enumeration** (`GET /auth/student/schedules/{id}`)
  is unchanged; non-live vs missing schedules may still differ. With
  entry closed-by-default, enumeration no longer implies entry, but
  hardening the metadata handler is still Round-2 work.
- **No per-schedule open-entry flag.** Schedules without any access
  link admit nobody on the direct path (fail-closed). Teachers open a
  schedule by issuing a link (open or selected-student).

## Round 2 (planned, requires schema change)

1. `allow_open_entry` flag migration per schedule (explicit opt-in open
direct entry) + handler branch honoring it.
2. Schedule metadata enumeration hardening (collapse non-live to 404).
3. Captcha verification for `captchaToken`.

## No-schema-change note

This round reads only existing issuance tables (`assessment_access_links`
+ `assessment_access_link_members`, single `SELECT ... LIMIT 1`) and
touches no migrations, no main.go wiring, no outbox/telemetry, and no
frontend. Behavior preserved except where unsafe: any-non-empty-code
entry and the direct-path `OPEN-` synthetic fallback are removed;
limits (30/min email+IP bucket, anon-auth tier, optional entry gate)
and the mint chain after a passing gate are untouched.
