# SigMap Query Context
Generated: 2026-08-04T14:32:45.471Z

## src/features/student/hooks/studentSessionStateMachine.ts
```
export interface StudentAnswerInvariantRolloutState
enabled: boolean
killSwitch: boolean
cohort: string | null
configFingerprint: string | null
source: 'default' | 'runtime'
export interface StudentSessionMachineEventContext
applyEpoch: number
currentEpoch: number
scheduleId: string | null
attemptId: string | null
syncState: string
source: 'refresh' | 'load'
rollout: StudentAnswerInvariantRolloutState
incomingFreshness: LiveSnapshotFreshness
export interface StudentSessionMachineDecision
discardAll: boolean
applyAttempt: boolean
applyRuntime: boolean
export interface StudentSessionMetricCommand
```

## backend/crates/domain/src/attempt.rs
```
pub struct QuestionValueMutationPayload
pub struct QuestionIdMutationPayload
pub struct QuestionSlotValueMutationPayload
pub struct QuestionSlotIdMutationPayload
pub struct TaskValueMutationPayload
pub struct TaskIdMutationPayload
pub struct PositionMutationPayload
pub struct ViolationMutationPayload
pub struct TelemetryMutationPayload
pub struct ObjectiveAnswers
pub struct WritingAnswers
pub struct QuestionFlags
pub struct StudentIntegrity
pub struct StudentClientPosition
pub struct StudentRecovery
pub struct ViolationSnapshotEntry
pub struct ViolationsSnapshot
pub struct StudentAttempt
pub struct StudentAttemptMutation
pub struct StudentHeartbeatEvent
```

## k6/prod-submit-storm-200.js
```
export function setup()
export function controlFlow(data)
export function studentFlow(data)
export function handleSummary(data)
function progressiveValues(finalValue, steps)
function looksLikeRuntimeAlreadyExistsError(resp)
function normalizeText(value)
function canonicalObjective(value)
function canonicalWriting(value)
function hash12(value)
function findByKeyDeep(root, key)
function objectiveTargetKey(target)
function collectObjectiveTargets(contentSnapshot)
function collectWritingTargets(contentSnapshot)
function buildExpectedAnswerMaps(localRunId, student, objectiveTargets, writingIds)
function buildMutationBatch(stepIndex, stepCount, objectiveTargets, writingIds, expectedObjective, expectedWriting)
function collectMismatches(attempt, objectiveTargets, expectedObjective, writingTargets, expectedWriting)
```

## backend/crates/api/src/runtime_auto_advance.rs
```
pub fn spawn_runtime_auto_advance(state: AppState) → Option<tokio::task::JoinHan...
```

## src/components/admin/StudentReviewWorkspace.tsx
```
component StudentReviewWorkspace
props StudentReviewWorkspaceProps
hook useState
hook useRef
hook useEffect
hook useCallback
hook useMemo
export StudentReviewWorkspaceProps
export StudentReviewWorkspace
handler onLoadSeq
handler onId
handler onAdd
handler onDelete
handler onSubmission
handler onAnswers
handler onCount
handler onTaskBySlot
handler onBands
handler onClick
handler onSub
```
