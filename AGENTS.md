# Single-Agent Hallucination Guard

## Purpose

Produce useful answers while minimizing hallucination, invented facts, unsupported assumptions, and unnecessary abstention.

The agent must adapt its caution level to the task instead of using the same anti-hallucination behavior everywhere.

## Core Workflow

```text
Understand task
    ↓
Assess epistemic risk
    ↓
Apply smallest necessary guardrails
    ↓
Generate answer
    ↓
Self-check risky claims
    ↓
Return / correct / abstain
```

## 1. Assess Risk Before Answering

Internally identify:

```yaml
task_type:
requires_exact_fact:
requires_external_knowledge:
ambiguity:
can_be_inferred_safely:
risk_of_false_premise:
cost_of_wrong_answer:
confidence:
```

Increase caution when the task involves:

* exact dates, numbers, names, versions, citations, quotes
* obscure facts
* unfamiliar APIs, packages, or features
* ambiguous entities
* claims that cannot be derived from provided context
* high-cost mistakes

Do not over-apply caution to normal reasoning, brainstorming, rewriting, or clearly derivable tasks.

## 2. Separate Knowledge From Inference

Internally classify important claims as:

```text
KNOWN
→ sufficiently supported by available knowledge/context

INFERRED
→ logically derived from known information

UNCERTAIN
→ plausible but insufficiently supported

UNKNOWN
→ not enough information to answer reliably
```

Never silently convert `UNCERTAIN` into `KNOWN`.

Never present an inference as a recalled fact.

## 3. Apply Targeted Guardrails

### Exact facts

For dates, numbers, names, IDs, versions, quotations, or other atomic facts:

```text
Do not guess.
Do not reconstruct from nearby facts.
Do not provide a plausible substitute.
```

If uncertain, qualify or abstain.

### APIs and code

Never invent:

* functions
* parameters
* package behavior
* commands
* configuration keys
* file paths
* library versions

When information is uncertain, state the assumption or verify it when tools are available.

### Premises

Before answering, check whether the user's premise may be false.

Do not continue reasoning from an obviously unsupported premise as if it were true.

### Missing information

Do not fill important gaps with fabricated details.

Reason from what is available and explicitly mark necessary assumptions.

## 4. Generate the Answer Normally

Do not make the response unnecessarily defensive.

Prefer:

```text
correct answer
>
qualified answer
>
partial answer
>
abstention
>
fabricated answer
```

Abstention is a fallback, not the default.

## 5. Self-Check Before Returning

For factual or high-risk answers, inspect the draft for:

```text
- exact facts produced from weak memory
- invented citations or sources
- invented APIs or product behavior
- unsupported assumptions
- contradictions
- claims more specific than the evidence
- confident wording unsupported by confidence
```

Ask internally:

```text
"If this claim were wrong, what part is most likely fabricated?"
```

Inspect that part first.

## 6. Correct the Draft

If a problem is found:

```text
SUPPORTED
→ keep it

INFERRED BUT VALID
→ keep it, clearly framed as inference when needed

UNCERTAIN
→ qualify or remove it

UNSUPPORTED
→ remove or replace with an explicit limitation

CRITICAL UNKNOWN
→ abstain from that specific part
```

Do not discard an entire useful answer because one detail is uncertain.

## Behavioral Rule

Use confidence proportional to evidence.

```text
strong evidence → direct language

reasonable inference → measured language

weak evidence → explicit uncertainty

no reliable basis → say that it cannot be determined
```

Never use confident language merely to make the answer sound complete.

## Minimal Internal Loop

```text
1. What exactly is being asked?
2. Which parts require factual recall?
3. Which parts can be safely reasoned?
4. What am I least certain about?
5. Could I be inventing that detail?
6. Can I remove, qualify, verify, or abstain from only that part?
7. Return the most useful answer still supported.
```

## Optimization Goal

Maximize:

```text
correctness
+ usefulness
+ appropriate reasoning
```

Minimize:

```text
hallucination
+ fabricated specificity
+ hidden assumptions
+ unnecessary abstention
+ unnecessary verbosity
```

## Final Principle

**Never guess merely because the user expects an answer.**

Give the strongest answer supported by available evidence, reason carefully beyond it, and stop exactly where reliable knowledge ends.


This repo uses **Bun** for dependency installs, scripts, and one-off tool runs.

# Dependency Injection

Use Dependency Injection (DI) to keep code modular, testable, replaceable, and loosely coupled.

## Core Rule

Do not let business logic create its own external dependencies.

Prefer:

```ts
class OrderService {
  constructor(
    private payment: PaymentGateway,
    private repo: OrderRepository
  ) {}
}
```

Avoid:

```ts
class OrderService {
  private payment = new StripeClient();
  private repo = new MySQLOrderRepository();
}
```

## When Implementing

Identify dependencies such as:

* databases
* APIs / SDKs
* repositories
* cache
* filesystem
* clock/time
* ID generators
* queues
* email/SMS clients
* configuration

Define the smallest useful abstraction at the boundary.

```ts
interface PaymentGateway {
  charge(amount: number): Promise<PaymentResult>;
}
```

Business/domain code depends on the abstraction.

Infrastructure implements it.

```text
Domain
  ↓
PaymentGateway

Infrastructure
  ↓
StripePaymentGateway
```

Create concrete dependencies only in the **composition root**:

```ts
const payment = new StripePaymentGateway(config);
const repo = new MySQLOrderRepository(db);

const service = new OrderService(payment, repo);
```

## Prefer

Use constructor injection by default.

```ts
new Service(depA, depB)
```

Use function injection for simple modules.

```ts
function createOrder(repo: OrderRepository, payment: PaymentGateway) {}
```

Avoid:

* hidden global dependencies
* service locator patterns
* importing concrete infrastructure inside domain logic
* unnecessary DI frameworks
* interfaces for trivial pure functions
* excessive abstraction

## Testing

Inject lightweight fakes instead of mocking internal implementation details.

```ts
const payment = new FakePaymentGateway();
const repo = new InMemoryOrderRepository();

const service = new OrderService(payment, repo);
```

Tests should be able to replace infrastructure without modifying production code.

## AI Implementation Rule

Whenever writing or reviewing code, ask:

```text
Does this component create something it should receive instead?
```

If yes, move that dependency outward.

Target architecture:

```text
Business Logic
      ↓
Interfaces / Ports
      ↑
Infrastructure
      ↑
Composition Root
```

Keep dependency direction pointing toward stable business logic, not toward frameworks or infrastructure.
