# SigMap Query Context
Generated: 2026-08-16T08:49:45.951Z

## src/components/student/providers/StudentKeyboardProvider.tsx
```
component KeyboardProvider
props KeyboardProviderProps
hook useStudentRuntime
hook useStudentAttempt
hook useStudentUI
hook useProctoring
hook useRef
hook useEffect
hook useKeyboard
export KeyboardProvider
handler onId
handler onPolicy
handler onIndex
```

## src/components/student/StudentApp.tsx
```
component StudentApp
props StudentAppProps
hook useStudentRuntime
hook useStudentAttempt
hook useStudentUI
hook useStudentTabletMode
hook useZoomScrollAnchoring
hook useState
hook useMemo
hook useCallback
hook useRef
hook useEffect
export StudentApp
handler onReason
handler onRef
handler onVerified
handler onViolation
handler onWarning
handler onLocked
handler onKey
```

## backend/crates/domain/src/schedule.rs
```
pub struct ExamSchedule
pub struct ScheduleSectionPlanEntry
pub struct RuntimeSectionState
pub struct ExamSessionRuntime
pub struct CohortControlEvent
pub struct CreateScheduleRequest
pub struct UpdateScheduleRequest
pub struct RuntimeCommandRequest
pub struct ProctorPresence
pub struct SessionAuditLog
pub struct SessionNote
pub struct ViolationRule
pub struct StudentSessionSummary
pub struct ProctorAlert
pub struct ProctorSessionSummary
pub struct ProctorSessionDetail
pub struct ProctorPresenceRequest
pub struct ExtendSectionRequest
pub struct CompleteExamRequest
pub struct AttemptCommandRequest
```

## src/features/proctor/contracts/index.ts
```
export interface ProctorScheduleMetrics
studentCount: number
activeCount: number
joinReadyCount?: number | undefined
joinTotalCount?: number | undefined
alertCount: number
violationCount: number
degradedLiveMode: boolean
export interface ProctorData
schedules: ExamSchedule[]
runtimeSnapshots: ExamSessionRuntime[]
scheduleMetrics: Record<string, ProctorScheduleMetri
sessions: StudentSession[]
alerts: ProctorAlert[]
auditLogs: SessionAuditLog[]
notes: SessionNote[]
export interface ProctorOperationCallbacks
onExit: () => void
onUpdateSessions: (sessions: StudentSession[]) => voi
onUpdateAlerts: (alerts: ProctorAlert[]) => void
```

## src/components/student/providers/StudentRuntimeProvider.tsx
```
component StudentRuntimeProvider
props StudentRuntimeProviderProps
hook useMemo
hook useReducer
hook useState
hook useRef
hook useEffect
hook useCallback
hook useStudentRuntime
hook useContext
export ExamPhase
export StudentAnswer
export BlockingReason
export StudentRuntimeProvider
handler onKey
handler onId
handler onRuntimeSectionDurationMinutes
handler onRuntimeSectionDurationSeconds
handler onExtensionMinutes
handler onIncreased
```
