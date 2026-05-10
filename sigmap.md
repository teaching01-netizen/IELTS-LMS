````md
# Skill: SigMap Context Optimizer for Codebase AI Agents

## Purpose
Use SigMap to give the AI agent the smallest useful code context before answering codebase questions, debugging, reviewing, or refactoring. The goal is to reduce hallucination, avoid reading the whole repo, and keep answers grounded in the files that matter.

## Core Rule
Never answer a codebase-specific question from memory alone when SigMap is available. Always prefer a focused SigMap context first.

---

## Tool Workflow

### 1. Ask: Always start here for codebase tasks

Use:

```bash
sigmap ask "<task-shaped query>"
````

Examples:

```bash
sigmap ask "explain the auth flow"
sigmap ask "fix the login token refresh bug"
sigmap ask "review the retry logic in the queue worker"
sigmap ask "where is the middleware stack configured"
```

Use `--json` when the agent needs structured output:

```bash
sigmap ask "fix the login bug" --json
```

After running `ask`, read:

```bash
.context/query-context.md
```

The agent should base its answer mainly on this context.

### Frequency

Run `sigmap ask`:

* Every time the user asks a new codebase question.
* Every time the topic changes to a different subsystem.
* Every time the agent is about to modify, review, or explain code.
* Again if the first answer feels under-contextualized or the ranked files look wrong.

Do not reuse old context for a new task unless the query is clearly the same.

---

## 2. Validate: Check whether the context is trustworthy

Use:

```bash
sigmap validate --query "<important symbols or concepts>"
```

Examples:

```bash
sigmap validate --query "authenticate user session token"
sigmap validate --query "student attempt mutation batch"
sigmap validate --query "runtime command pause resume complete"
```

Use basic health check:

```bash
sigmap validate
```

Use JSON for automation:

```bash
sigmap validate --query "loginUser validateToken" --json
```

### Frequency

Run `validate`:

* After `ask` when the task is high risk.
* When coverage is low.
* When the agent suspects missing files.
* Before giving architectural or production-safety advice.
* Before making a code change that touches auth, payment, exam state, persistence, permissions, migrations, or concurrency.
* In CI with:

```bash
sigmap --ci --min-coverage 80
```

### Agent behavior if validation is weak

If validation fails or important symbols are missing:

1. Do not confidently answer.
2. Re-run `sigmap ask` with a more specific query.
3. Mention uncertainty if still weak.
4. Ask for missing files only if SigMap cannot find them.

---

## 3. Judge: Verify answer groundedness

After generating an answer, save it:

```bash
cat > response.txt
```

Then run:

```bash
sigmap judge --response response.txt --context .context/query-context.md
```

Use JSON for automation:

```bash
sigmap judge --response response.txt --context .context/query-context.md --json
```

### Frequency

Run `judge`:

* For important answers.
* For bug fixes.
* For system design reviews.
* For security-sensitive topics.
* For production incident analysis.
* For explanations that mention specific files, functions, or behavior.
* Before submitting an answer that claims “this is where the bug is.”

Do not judge every tiny question if the answer is simple and directly visible in context.

### Agent behavior based on judge result

#### HIGH support

Proceed with the answer.

#### MEDIUM support

Proceed, but soften claims:

* “Based on the provided context…”
* “The likely path is…”
* “I would verify this file next…”

#### LOW support

Do not present the answer as fact. Re-run `ask` with a sharper query or request more context.

---

## 4. Learn: Improve ranking over time

Use positive learning when a file is truly helpful:

```bash
sigmap learn --good src/auth/service.js
```

Use negative learning when a file repeatedly appears but misleads:

```bash
sigmap learn --bad src/legacy/old-api.js
```

Use both:

```bash
sigmap learn --good src/auth/service.js --bad src/legacy/old-api.js
```

Inspect weights:

```bash
sigmap weights
sigmap weights --json
```

Reset if ranking becomes polluted:

```bash
sigmap learn --reset
```

Use judge learning only when the answer is clearly good or bad:

```bash
sigmap judge --response response.txt --context .context/query-context.md --learn
```

### Frequency

Use `learn`:

* After repeated successful answers from the same files.
* After finding that certain ranked files are consistently noise.
* After `judge` gives clearly high or clearly low groundedness.
* During long-running projects where the same subsystems are queried often.

Do not use `learn`:

* On one-off tasks.
* When the agent is unsure.
* When the user’s query was vague.
* When the context was incomplete.
* When a file was merely mentioned but not actually useful.

Inspect `sigmap weights` weekly or after a large project phase.

Reset weights when:

* The repo structure changes significantly.
* A major refactor moves responsibilities.
* The agent starts over-favoring old files.
* Ranking quality gets worse.

---

## Optimized Command Frequency Table

| Situation                                           |                            Command | Frequency                              |
| --------------------------------------------------- | ---------------------------------: | -------------------------------------- |
| New codebase question                               |                       `sigmap ask` | Always                                 |
| Same subsystem, follow-up question                  |                       `sigmap ask` | Usually, unless context is still exact |
| High-risk code path                                 |          `sigmap validate --query` | Always                                 |
| Low coverage / wrong files                          | `sigmap validate` then rerun `ask` | Always                                 |
| Final answer for bug/security/concurrency/data loss |                     `sigmap judge` | Always                                 |
| Simple explanation from obvious context             |                     `sigmap judge` | Optional                               |
| Helpful file discovered repeatedly                  |              `sigmap learn --good` | After repeated confirmation            |
| Misleading file repeatedly appears                  |               `sigmap learn --bad` | After repeated confirmation            |
| Ranking feels stale                                 |                   `sigmap weights` | Weekly / per project phase             |
| Ranking polluted                                    |             `sigmap learn --reset` | As needed                              |
| CI context health gate                              |    `sigmap --ci --min-coverage 80` | Every PR / pipeline                    |

---

## Agent Decision Policy

### For debugging

```bash
sigmap ask "debug <symptom> <module> <error>"
sigmap validate --query "<key symbols from bug>"
```

Then:

1. Read `.context/query-context.md`.
2. Identify the smallest failing path.
3. Propose fix.
4. Save answer to `response.txt`.
5. Run `sigmap judge`.
6. If groundedness is low, rerun `ask` with better query.

### For explaining architecture

```bash
sigmap ask "explain <feature/subsystem> flow"
sigmap validate --query "<entrypoint service route model>"
```

Then explain:

* Entry points.
* Main files.
* Data flow.
* State changes.
* Failure paths.
* Unknowns.

### For code review

```bash
sigmap ask "review <feature> for correctness race conditions edge cases"
sigmap validate --query "<critical functions/classes>"
```

Then review with:

* correctness risks
* data integrity risks
* concurrency risks
* security risks
* test gaps

Always run `judge` before finalizing serious review output.

### For refactor planning

```bash
sigmap ask "refactor <area> to <goal>"
sigmap validate --query "<old path new path shared dependency>"
```

Then produce:

* current coupling map
* safe migration plan
* compatibility risks
* test plan
* rollback plan

Do not apply `learn` until the refactor files prove repeatedly useful.

---

## Prompt Quality Rules

Good SigMap queries are task-shaped.

Prefer:

```bash
sigmap ask "fix race condition in StudentAttemptRepository mutation batching"
```

Instead of:

```bash
sigmap ask "student"
```

Prefer:

```bash
sigmap ask "explain how auth token is issued and validated"
```

Instead of:

```bash
sigmap ask "auth"
```

A good query includes:

* action: explain, fix, debug, review, refactor
* subsystem: auth, runtime, grading, autosave
* symptom or goal
* important symbols if known

---

## Anti-Hallucination Rules

The agent must not:

* invent files not present in SigMap context
* claim exact behavior without source context
* over-trust old context after the query changes
* use `learn` on uncertain answers
* ignore low coverage or high risk
* treat `judge` as absolute truth; it is a groundedness signal, not a correctness oracle

The agent must:

* re-run `ask` when context does not match the task
* run `validate` for high-risk answers
* run `judge` for serious final answers
* clearly label uncertainty
* keep answers tied to the ranked context

---

## Best Default Loop

For normal coding tasks:

```bash
sigmap ask "<task>"
# read .context/query-context.md
# answer or draft fix
```

For serious production tasks:

```bash
sigmap ask "<task>"
sigmap validate --query "<critical symbols>"
# read .context/query-context.md
# draft answer
sigmap judge --response response.txt --context .context/query-context.md
```

For long-running projects:

```bash
sigmap ask "<task>"
sigmap validate --query "<critical symbols>"
sigmap judge --response response.txt --context .context/query-context.md --learn
sigmap weights
```

---

## Final Operating Principle

Use `ask` frequently, `validate` when correctness matters, `judge` before serious claims, and `learn` slowly.

Optimization does not mean running fewer commands. It means running the right command at the right risk level.

```
```
