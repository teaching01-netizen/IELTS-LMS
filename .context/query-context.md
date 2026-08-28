# SigMap Query Context
Generated: 2026-08-28T09:31:22.754Z

## src/services/gradingRepository.ts
```
export interface IGradingRepository
sectionSubmissionId: string, ): Promise<WritingTaskSubmi
getAllSessions()
getSessionById(id)
getSessionsBySchedule(scheduleId)
saveSession(session)
deleteSession(id)
getAllSubmissions()
getSubmissionById(id)
class BackendGradingRepository
export function rememberReviewDraftRevision(id, revision) → void
export function getReviewDraftRevision(id) → number | undefined
```

## backend/crates/api/src/routes/grading.rs
```
pub struct SessionDetailQuery
pub struct SessionListQuery
pub async fn list_sessions(State(state) → Result<ApiResponse<Vec<Grad...
pub async fn get_session(State(state) → Result<ApiResponse<GradingS...
pub async fn get_submission(State(state) → Result<ApiResponse<Submissi...
pub async fn get_submission_sections(State(state) → Result<ApiResponse<Vec<Sect...
pub async fn get_submission_writing_tasks(State(state) → Result<ApiResponse<Vec<Writ...
pub async fn start_review(State(state) → Result<ApiResponse<ReviewDr...
pub async fn get_review_draft(State(state) → Result<ApiResponse<ReviewDr...
pub async fn save_review_draft(State(state) → Result<ApiResponse<ReviewDr...
pub async fn mark_grading_complete(State(state) → Result<ApiResponse<ReviewDr...
pub async fn mark_ready_to_release(State(state) → Result<ApiResponse<ReviewDr...
pub async fn release_now(State(state) → Result<ApiResponse<StudentR...
pub async fn schedule_release(State(state) → Result<ApiResponse<ReviewDr...
pub async fn reopen_review(State(state) → Result<ApiResponse<ReviewDr...
pub async fn get_result_events(State(state) → Result<ApiResponse<Vec<Rele...
```

## backend/crates/domain/src/exam.rs
```
pub struct ExamEntity
pub struct ExamVersion
pub struct ExamVersionSummary
pub struct ExamEvent
pub struct ExamMembership
pub struct CreateExamRequest
pub struct UpdateExamRequest
pub struct SaveDraftRequest
pub struct PublishExamRequest
pub struct CloneExamRequest
pub struct ValidationIssue
pub struct ExamValidationSummary
pub enum ExamType
pub enum ExamStatus
pub enum Visibility
pub enum ExamEventAction
pub enum MembershipRole
impl ExamEntity
pub fn get_exam_type(&self) → Result<ExamType, String>
pub fn get_status(&self) → Result<ExamStatus, String>
```

## backend/crates/domain/src/grading.rs
```
pub struct GradingSession
pub struct StudentSubmission
pub struct SectionSubmission
pub struct WritingTaskSubmission
pub struct ReviewDraft
pub struct ReviewEvent
pub struct StudentResult
pub struct ReleaseEvent
pub struct MediaAsset
pub struct UploadIntent
pub struct GradingSessionDetail
pub struct SubmissionReviewBundle
pub struct GradingSessionPagination
pub struct ReviewDraftSummary
pub struct SubmissionReviewSummary
pub struct ResultsAnalytics
pub struct SaveReviewDraftRequest
pub struct StartReviewRequest
pub struct ActorActionRequest
pub struct ReleaseNowRequest
```

## src/features/builder/hooks/useReviewRouteController.ts
```
export interface ReviewRouteController
error: string | null
exam: ExamEntity | undefined
isLoading: boolean
state: ExamState | null
versions: ExamVersionSummary[]
schedules: ExamSchedule[]
publishReadiness: PublishReadiness | undefined
handlePublish: (notes?: string) => Promise<void>
export function useReviewRouteController(examId?,) → ReviewRouteController
```
