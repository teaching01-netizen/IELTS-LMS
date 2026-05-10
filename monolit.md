````md
# Skill: TDD Modular Monolith Codebase Architect

## Purpose

Use this skill whenever the user asks to design, implement, refactor, review, or extend a software codebase.

The AI must always guide the codebase toward a **Test-Driven Development modular monolith architecture** unless the user explicitly asks for another architecture.

The goal is to build software that is:

- Easy to test
- Easy to change
- Easy to reason about
- Safe to refactor
- Production-friendly
- Not over-engineered into microservices too early

---

# Core Rule

Always design the system as a **modular monolith first**.

Do not recommend microservices unless there is strong evidence that the system truly needs independent deployment, independent scaling, or separate organizational ownership.

Default architecture:

```txt
One deployable application
Multiple internal modules
Clear domain boundaries
Strong tests around behavior
Minimal coupling between modules
Explicit interfaces between modules
Shared database allowed, but controlled by module ownership rules
````

---

# Architecture Philosophy

A modular monolith means:

```txt
The system runs as one application,
but the codebase is divided into strong internal modules.
```

Each module should behave like a small internal product with its own:

* Domain logic
* Application services
* Data access
* Tests
* Public interface
* Private implementation details

Modules should not freely reach into each other’s internals.

---

# TDD Rule

For every meaningful feature, follow this order:

```txt
1. Write or describe the failing test first
2. Implement the smallest code to pass the test
3. Refactor while keeping tests green
```

Use this loop:

```txt
Red → Green → Refactor
```

Do not jump straight into implementation unless the user explicitly asks for prototype-only code.

---

# Preferred Development Flow

When building a feature, always think in this order:

```txt
1. What behavior should the system guarantee?
2. What test proves that behavior?
3. Which module owns this behavior?
4. What public interface should expose it?
5. What internal implementation is needed?
6. What failure cases must be tested?
7. What refactoring can simplify it?
```

---

# Codebase Structure

Prefer a structure like this:

```txt
src/
  modules/
    exam/
      domain/
      application/
      infrastructure/
      interface/
      tests/
    user/
      domain/
      application/
      infrastructure/
      interface/
      tests/
    payment/
      domain/
      application/
      infrastructure/
      interface/
      tests/

  shared/
    kernel/
    database/
    config/
    errors/
    observability/

  main.ts
```

Or for Rust:

```txt
src/
  modules/
    exam/
      mod.rs
      domain/
      application/
      infrastructure/
      interface/
      tests/
    user/
      mod.rs
      domain/
      application/
      infrastructure/
      interface/
      tests/

  shared/
    mod.rs
    kernel/
    errors/
    config/

  main.rs
```

---

# Module Boundary Rules

Each module must have a clear owner.

A module may expose:

```txt
Public API / service / interface
Events
DTOs
Commands
Queries
```

A module must hide:

```txt
Database tables
ORM models
Internal helper functions
Private domain rules
Implementation details
```

Bad:

```txt
exam module directly imports user database model
```

Good:

```txt
exam module calls UserAccessService or UserReader interface
```

---

# Dependency Rule

Dependencies should point inward:

```txt
interface → application → domain
infrastructure → application/domain
```

Domain logic should not depend on:

```txt
HTTP
Database
ORM
Framework
Queue
External API
UI
```

Domain logic should be testable without infrastructure.

---

# Layer Responsibilities

## Domain Layer

Contains pure business rules.

Examples:

```txt
ExamSession
Answer
Score
SubmissionPolicy
TimeLimit
RetakeRule
```

Should contain:

```txt
Entities
Value objects
Domain services
Domain errors
Business invariants
```

Should not contain:

```txt
SQL
HTTP requests
JSON parsing
Framework decorators
```

---

## Application Layer

Coordinates use cases.

Examples:

```txt
StartExamUseCase
SubmitAnswerUseCase
GradeWritingUseCase
PublishScoreUseCase
```

Application services should:

```txt
Validate command intent
Load domain objects
Call domain behavior
Save state
Return result
```

They should not contain deep business logic if that logic belongs in the domain.

---

## Infrastructure Layer

Handles external systems.

Examples:

```txt
PostgresExamRepository
RedisLockProvider
S3AudioStorage
EmailGateway
PaymentGateway
```

Infrastructure must implement interfaces defined by the application or domain layer.

---

## Interface Layer

Handles input/output.

Examples:

```txt
REST controller
GraphQL resolver
WebSocket handler
CLI command
Admin dashboard route
```

Interface layer should be thin.

Bad:

```txt
Controller contains business rules
```

Good:

```txt
Controller parses request → calls use case → returns response
```

---

# Testing Strategy

Use a test pyramid.

```txt
Many unit tests
Some integration tests
Few end-to-end tests
```

## Unit Tests

Use for:

```txt
Domain rules
Value objects
Pure services
Policy decisions
Edge cases
```

Should be fast and isolated.

## Integration Tests

Use for:

```txt
Database repositories
External service adapters
Module interaction
Transaction behavior
```

## End-to-End Tests

Use for:

```txt
Critical user journeys
Exam submission
Payment confirmation
Login flow
Admin workflow
```

Do not depend only on E2E tests.

---

# TDD Feature Template

For every feature, answer:

```md
## Feature

What are we building?

## Expected Behavior

What should happen?

## Module Owner

Which module owns this behavior?

## Test Cases

### Happy Path

- Given...
- When...
- Then...

### Edge Cases

- Given...
- When...
- Then...

### Failure Cases

- Given...
- When...
- Then...

## First Failing Test

Write the first test before implementation.

## Minimal Implementation

Write only enough code to pass.

## Refactor

Improve structure without changing behavior.
```

---

# Code Review Checklist

When reviewing code, always check:

```txt
Is the behavior tested?
Is the module boundary clear?
Is business logic inside the domain/application layer?
Is the controller too fat?
Is database logic leaking across modules?
Is the code easy to refactor?
Are failure cases tested?
Are names clear?
Are dependencies pointing in the right direction?
Can this feature be tested without starting the whole app?
```

---

# Anti-Patterns to Reject

Avoid:

```txt
Big ball of mud
God service
Fat controller
Shared global utils dumping ground
Direct cross-module database access
Business logic in routes
Business logic in SQL only
No tests before implementation
Mocking everything blindly
Microservices too early
One giant shared model folder
Circular dependencies between modules
```

---

# Modular Monolith Database Rule

A shared database is allowed, but each table must have a clear module owner.

Example:

```txt
exam_sessions → owned by exam module
users → owned by user module
payments → owned by payment module
```

Other modules should not freely write to tables they do not own.

Preferred access:

```txt
Through module service
Through query interface
Through domain event
Through read model
```

---

# Transaction Rule

For workflows inside one module, use normal database transactions.

For workflows across modules, prefer:

```txt
Application service orchestration
Domain events
Outbox pattern
Explicit consistency boundaries
```

Do not hide distributed-style complexity inside random function calls.

---

# Event Rule

Use internal events when one module needs to notify another module.

Example:

```txt
ExamSubmitted
PaymentCompleted
UserRegistered
ScorePublished
```

Events should describe facts that already happened.

Good:

```txt
ExamSubmitted
```

Bad:

```txt
PleaseGradeThisExamNow
```

---

# Error Handling Rule

Errors should be explicit.

Prefer domain-specific errors:

```txt
ExamAlreadySubmitted
ExamTimeExpired
UserNotAllowedToAccessExam
PaymentNotConfirmed
```

Avoid generic errors like:

```txt
SomethingWentWrong
InvalidRequest
ErrorCode123
```

Each error should be testable.

---

# API Design Rule

External API should not expose internal domain models directly.

Use DTOs:

```txt
SubmitAnswerRequest
SubmitAnswerResponse
ExamSessionView
ScoreReportView
```

Keep internal model changes from breaking public API contracts.

---

# Refactoring Rule

When refactoring:

```txt
1. Make sure tests exist first
2. Add missing tests around current behavior
3. Refactor in small steps
4. Keep tests green
5. Avoid changing behavior and structure at the same time
```

Never perform large blind refactors without characterization tests.

---

# AI Behavior Rules

When the user asks for code, the AI should usually respond with:

```txt
1. Module placement
2. First failing test
3. Implementation
4. Explanation of boundary decisions
5. Additional test cases
```

When the user asks for architecture, the AI should usually respond with:

```txt
1. Suggested modules
2. Module responsibilities
3. Dependency direction
4. Data ownership
5. Testing strategy
6. Migration path
```

When the user asks for refactoring, the AI should usually respond with:

```txt
1. Current problem
2. Safer target structure
3. Characterization tests
4. Step-by-step refactor
5. Final modular design
```

---

# Default Answer Shape

Use this structure whenever useful:

```md
## Recommended Modular Monolith Design

## Module Ownership

## First Tests to Write

## Implementation Sketch

## Boundary Rules

## Failure Cases

## Refactor Notes
```

---

# Strong Default Opinion

Prefer:

```txt
Simple module boundary over clever abstraction
Explicit use case over magic framework behavior
Domain test over controller-only test
Clear interface over direct import
One deployable app over premature microservices
```

---

# Final Principle

The codebase should feel like this:

```txt
Easy to test like a small app.
Easy to reason about like a monolith.
Easy to evolve like separate services.
But deployed as one system until there is a real reason not to.
```

```
```
