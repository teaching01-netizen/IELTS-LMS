# Runbook: frontend asset rollback

Signals: post-deploy spike in client errors, blank screens, or
chunk-load failures; bundle size gate passed but runtime breaks.

## Triage
1. Confirm asset vs API: API `/healthz` + `/readyz` green and V2
   routes serving means the bundle is suspect.
2. Check the deployed `dist/` hash vs the previous known-good hash;
   chunk 404s = CDN/cache serving a mixed manifest.
3. Student impact first: exam-taking clients must never be force-
   reloaded mid-attempt — the IndexedDB outbox preserves answers
   across reloads, but an involuntary reload still disrupts timing.

## Mitigation
1. Roll the static asset pointer back to the previous manifest
   (atomic manifest swap, not file-by-file).
2. In-flight exam clients finish on cached assets; new loads get the
   rolled-back bundle. Do NOT push a forced reload to exam rooms.
3. Verify: fresh load smokes login → bootstrap → V2 batch → submit
   against staging before re-rolling forward.
