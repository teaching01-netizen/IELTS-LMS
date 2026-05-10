# SigMap Query Context
Generated: 2026-05-10T06:27:19.105Z

## src/features/builder/routes/BuilderRoot.tsx
```
component ScoringAside
component BuilderRoot
hook useParams
hook useNavigate
hook useLocation
hook useBuilderRouteController
hook useUndoRedo
hook useState
hook useRef
hook useEffect
hook useMemo
hook useKeyboardShortcuts
export BuilderRoot
handler onThreshold
handler onChange
handler onSubmitGrade
handler onIndex
handler onAction
handler onUpdateState
handler onReturnToAdmin
```

## src/features/builder/hooks/useBuilderRouteController.ts
```
export interface BuilderRouteController
error: string | null
exam: ExamEntity | undefined
isLoading: boolean
state: ExamState | null
handleArchive: () => Promise<void>
handleOpenScheduling: () => void
handlePublish: (notes?: string) => Promise<void>
handleReturnToAdmin: () => void
export function useBuilderRouteController(examId?,) → BuilderRouteController
```

## src/features/admin/contracts/index.ts
```
export interface AdminRootProps
onNavigate: (mode: 'builder' | 'student' | 'adm
exams: Exam[]
examEntities: ExamEntity[]
schedules: ExamSchedule[]
defaults: ExamConfig
setDefaults: (config: ExamConfig) => void
export interface ExamOperationCallbacks
onEditExam: (id: string) => void
onCreateExam: ( title: string, type: 'Academic' |
onCloneExam?: (examId: string, newTitle: string)
onCreateFromTemplate?: (templateId: string, newTitle: stri
export interface VersionManagementCallbacks
onGetVersions: (examId: string) => Promise<ExamVer
onGetEvents: (examId: string) => Promise<ExamEve
onRestoreVersion: (versionId: string) => Promise<void
onRepublishVersion: (versionId: string) => Promise<void
onCompareVersions: (versionIdA: string, versionIdB: st
export interface ScheduleManagementCallbacks
onCreateSchedule: (schedule: ExamSchedule) => Promise
```

## src/features/builder/routes/ExamPreviewRoute.tsx
```
component ExamPreviewRoute
component RuntimePreviewSurface
hook useParams
hook useNavigate
hook useSearchParams
hook useAuthSession
hook useBuilderRouteController
hook useState
hook useMemo
hook useEffect
hook useStudentSessionRouteData
export ExamPreviewRoute
handler onModuleChange
handler onChange
handler onExit
handler onRuntimeRefresh
```

## src/features/builder/routes/ExamReviewRoute.tsx
```
component ExamReviewRoute
hook useParams
hook useReviewRouteController
hook useState
export ExamReviewRoute
handler onNavigateToBuilder
handler onPublish
handler onSchedulePublish
handler onUnpublish
handler onNumber
handler onRestoreVersion
handler onRepublishVersion
handler onCompareVersions
handler onCreateSchedule
handler onClick
```
