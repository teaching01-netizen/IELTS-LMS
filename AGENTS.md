# IELTS Proctoring System

Frontend monolith for IELTS administration, builder, proctoring, and student delivery.

## Package Manager: Bun

This repo uses **Bun** for dependency installs, scripts, and one-off tool runs.
`bun.lock` is the single source of truth. The old `package-lock.json`,
`pnpm-lock.yaml`, and `pnpm-workspace.yaml` have been removed.

### Install

```bash
bun install --frozen-lockfile   # CI / reproducible install
bun install                     # local; updates bun.lock
```

### Scripts

Every script in `package.json` runs through Bun:

```bash
bun run dev          # vite dev server on http://localhost:3000
bun run build        # production build
bun run typecheck    # tsc --noEmit
bun run lint         # eslint .
bun run test:run     # vitest run
bun run test:coverage
bun run storybook
bun run e2e:sat-a11y
```

### One-off tools (`bunx` instead of `npx`)

```bash
bunx vitest run src/shared/durability
bunx tsc --noEmit
bunx eslint src/
bunx playwright test
bunx prettier --check .
```

`bunx` replaces `npx`. Use `bunx` so tools resolve from Bun's cache rather than
npm's `~/.npm/_npx`.

### Node is still required

Bun is the **package manager, not the runtime**. The toolchain binaries (`vite`,
`vitest`, `tsc`, `playwright`) declare a `#!/usr/bin/env node` shebang, so
**Node 20+ must be on PATH**. Running `bun run vitest` without Node fails with
exit code 127.

- **CI**: `actions/setup-node` (Node 20) + `oven-sh/setup-bun` (Bun 1.3.14)
- **Docker**: Node-based base images with the Bun binary copied in from
  `oven/bun:1.3.14-debian`

### Requirements

- Bun >= 1.3.14
- Node >= 20
- Go (for the backend under `backend/go`)
