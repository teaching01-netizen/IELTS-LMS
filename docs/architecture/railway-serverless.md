# Railway Serverless: one application deployment

The existing backend Docker image serves the SPA, Go API, all background jobs,
and the Node authoring collaboration runtime. Keep the existing MySQL and
durable media storage. No worker service, scheduler, Redis, or frontend host is
needed.

## Enable on the existing service

1. Deploy this image with `BACKGROUND_RUNTIME_MODE=activity_driven` and
   `IDLE_GRACE_SECS=60` (the Docker defaults). An existing Railway variable
   overrides the image default, so update any old `continuous` value.
2. Keep one application replica. Keep `/healthz` as the deployment healthcheck.
   Preserve the existing co-edit secrets, public proxy URL, database pool
   limits, and media storage configuration. Co-edit's control listener defaults
   to container loopback; its public socket remains `/authoring-coedit`.
3. Enable **Settings → Deploy → Serverless**, then redeploy. The setting applies
   when Railway creates the container. [Railway Serverless documentation](https://docs.railway.com/deployments/serverless)
4. Close browser tabs and disable recurring uptime checks or metric scrapes.
   Their responses generate traffic even though they do not extend the app's
   activity timer. Railway's deployment healthcheck stops after deployment.
   [Railway healthcheck documentation](https://docs.railway.com/deployments/healthchecks)

## Runtime behavior

Application API requests reserve activity before authentication. Proctor,
authoring-events, and collaboration sockets retain that reservation until
closed. Health, metrics, SPA assets, and private persistence calls do not extend
user activity. Private calls and readiness checks still count as in-flight work.

After the grace period, the API stops scheduling jobs, joins running work,
persists its actual presence map, reconciles required work, and parks co-edit.
Live or paused exams, unfinished attempts, unpublished non-terminal outbox
events (including future retries), SAT provisional completion, and eligible
automatic grading projection all prevent idling. SQL, flush, or park failures
also prevent it. Human grading and routine cleanup can wait for another visit.

Idle has no polling timer. Both Go pools retain their configured maximum-open
limits but release all idle connections. Co-edit stays alive with its lock
session and confirmation timer closed. Requests share one activation operation;
activation restores pool settings, reconciles deadlines/outbox/grading, recovers
expired freezes, and performs bounded maintenance. Token issuance and socket
reconnects activate co-edit before admission.

Observe transitions in application logs and the existing metrics endpoint:
`background_runtime_state{state="active|draining|idle"}`,
`background_idle_blocked_total`, and `db_pool_open{role="api|worker"}`.
Logs name the blocking condition. Avoid scheduled scrapes during the sleep test.

The application grace period is separate from Railway's sleep window: Railway
normally sleeps 5–10 minutes after the last outbound packet. The first wake-up
request can return 502. Reads retry transient gateway/network failures at most
three times within 60 seconds. Writes have no default retry; `retrySafe` requires
an existing backend idempotency guarantee and an unchanged operation identifier.
The student durability engine continues to own answer replay.

A 502 on the initial HTML navigation requires browser reload because the SPA
has not loaded yet. Once loaded, it shows connection recovery and a retry action.

## Verification and rollback

Run Go tests and race checks, frontend typechecking/API/architecture/durability
tests and build, plus `bun run coedit:typecheck` and `bun run coedit:test`.
`cmd/worker` tests execute the Docker entrypoint's two modes with local children.
Use a migrated disposable MySQL database for `TEST_MYSQL_DSN` integration tests.

Before enabling production sleep, exercise the existing Railway service: close
clients, confirm idle and zero database sessions, wait for Railway's sleeping
state, then verify login, exam delivery/submission, and collaboration after wake.
Disconnect all candidates during live/paused IELTS, SAT, and ACT exams and
verify server deadlines and automatic processing continue. Confirm future
outbox retries block sleep, and clean co-edit disconnects release the lock.

Roll back with `BACKGROUND_RUNTIME_MODE=continuous`, disable Railway Serverless,
and redeploy. Continuous runs the original worker child in the same image.

## Implementation verification (2026-10-01)

- Passed `go test ./...`, `go test -race ./...`, and the MySQL integration suite
  against an isolated local database.
  Presence tests cover first-heartbeat identity, failed-flush retention, metadata
  merging, superseded client ownership, and duplicate flush recovery.
- Passed frontend and co-edit typechecks, 147 focused frontend API,
  architecture, and durability tests, 119 co-edit tests, and the production build.
  Go API, migration, and worker binaries also build for production Linux with
  `CGO_ENABLED=0 GOOS=linux GOARCH=amd64`.
- Executed the Docker entrypoint locally with the real Go API and Node runtime:
  repeated idle/wake cycles, authenticated session recovery, token issuance,
  collaboration through the public API port, and reload of a persisted edit.
- Observed both Go pools at zero connections, zero application MySQL sessions,
  and zero recurring SQL over an eight-second idle sample. Verified SIGTERM
  shuts down co-edit before the API. The disposable database was stopped.
- The existing [Railway application](https://ielts-warwick-institute.up.railway.app/)
  returned 200 for `/healthz` and the SPA. These changes have not been deployed;
  Railway's actual sleep/wake and production exam checks remain pending.
  Docker image execution also remains pending because this environment has no
  Docker daemon; the entrypoint and native processes were exercised directly.
