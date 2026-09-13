# Leapcell Load Runner Environment

Dedicated folder for running the prod load harness on Leapcell instances.

## 1) Setup

```bash
cp deploy/leapcell-load/.env.example deploy/leapcell-load/.env
```

Edit `deploy/leapcell-load/.env` with your schedule URL and desired shard.

## 2) Run (CLI)

```bash
./deploy/leapcell-load/run.sh
```

## 3) Run (Web UI)

```bash
bun run e2e:leapcell-ui
```

Open:

```txt
http://localhost:3366
```

The UI lets you:
- set test config (URL, users, shard offset, headed users, concurrency),
- choose explicit mode:
  - `headed test`
  - `headless test`
  - `hybrid (browser + k6)`
  - `k6 test (API only)`
- run Playwright only or Playwright + k6,
- view live logs,
- embed the live dashboard (1 second screenshots),
- auto-delete logs/artifacts after finish.

Cloud host notes:
- UI server binds `0.0.0.0`.
- It honors `PORT` (platform default) and falls back to `LEAPCELL_LOAD_UI_PORT`/`3366`.

## 4) Recommended multi-instance sharding

For 180 users across 3 Leapcell instances:

- Instance A: `USER_OFFSET=0`, `USER_COUNT=60`
- Instance B: `USER_OFFSET=60`, `USER_COUNT=60`
- Instance C: `USER_OFFSET=120`, `USER_COUNT=60`

Keep `MAX_CONCURRENT_USERS=10..20` per instance.

## 5) With k6

Set in `.env`:

```bash
RUN_WITH_K6=true
K6_CONFIRM_PROD=true
K6_SCRIPT=k6/prod-start-exam-200.js
K6_STUDENTS=60
```

`run.sh` will use `bun run e2e:live-with-k6`.

## 6) Logs

- Live runner events: `e2e/.generated/live-runner/live-runner-*.log`
- k6 logs: `e2e/.generated/live-runner/k6-*.log`
- JSON summary: `e2e/.generated/live-runner/live-run-summary-*.json`

## 7) Leapcell Docker Deploy

Build from repo root:

```bash
docker build -f deploy/leapcell-load/Dockerfile -t ielts-load-ui .
```

Run locally:

```bash
docker run --rm -p 3366:3366 ielts-load-ui
```

On Leapcell:
- deploy this repo using `deploy/leapcell-load/Dockerfile`
- expose the app port (`PORT`)
- start command is already in container (`bun run e2e:leapcell-ui`)
