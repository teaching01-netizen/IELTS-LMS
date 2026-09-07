# Rate-Limit Tiers Runbook

One IP bucket no longer exists. Every `/api/*` route belongs to exactly one
tier (see `TestTierCoverageBuildRouterWiring`), each with an independent
per-minute quota:

| Tier | Key | Default/min | Routes |
|---|---|---|---|
| `auth-critical` | user, else IP | 120 | `GET /auth/session`, logout |
| `anon-auth` | IP | 30 | login, student/entry, activate, password reset, public link reads |
| `authed-reads` | user / attempt / IP | 300 | all other authenticated GETs, WS upgrade, V2 snapshot |
| `polling` | user / attempt / IP | 240 | student `live` view |
| `heartbeat` | user / attempt / IP | 120 | student heartbeat, proctor presence |
| `writes` | user / attempt / IP | 120 | mutations, submits, authoring, admin writes, media upload |
| `backstop` | IP, local-only | 3000 | abuse floor across everything (no DB counters) |

## Diagnose

1. `http_ratelimit_denied_total{tier,key_class}` names the hot tier.
   `key_class` is `user` | `attempt` | `ip` — raw IDs never appear.
2. Deny log lines (`msg: "rate limit denied"`) carry tier + route + retry.
   429s bypass AccessLog by design; the deny line is their access log.
3. `distributed_rate_limit_counters` rows are namespaced by tier
   (`route_key` = tier name). Legacy `global` rows age out via retention.

## Respond

- Hot `polling`/`heartbeat`: look for a client stuck in a tight loop or a
  degraded-live-mode storm (proctor floors: summary 10s, detail 15s).
- Hot `writes`: check for a submit storm or runaway authoring import.
- Hot `anon-auth`: possible credential stuffing — correlate with login 4xx.
- Hot `auth-critical`: page-worthy. Sessions are cheap reads; denials here
  mean a misconfigured budget or an abusive client, not normal load.

## Tune

Set the tier's `RATE_LIMIT_*_PER_MIN` env (see `backend/.env.example`).
Do NOT raise `RATE_LIMIT_GLOBAL` to fix a hot tier — the global knob no
longer governs per-tier quotas (it only seeds defaults at first boot).
