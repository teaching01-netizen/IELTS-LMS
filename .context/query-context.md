# SigMap Query Context
Generated: 2026-10-10T06:42:01.976Z

## backend/crates/infrastructure/src/authorization.rs
```
pub struct AuthorizationService
impl AuthorizationService
pub fn can_access_organization_exams(actor: &ActorContext, organization_id: String) → bool
pub fn can_access_schedule(actor: &ActorContext, schedule_id: String, organization_id: String,) → bool
pub fn can_access_student_data(actor: &ActorContext, schedule_id: String, student_key: &str, organization_id: String,) → bool
pub fn can_modify_exam_content(actor: &ActorContext, organization_id: String) → bool
pub fn can_grade_submissions(actor: &ActorContext, schedule_id: String, organization_id: String,) → bool
pub fn can_proctor_schedule(actor: &ActorContext, schedule_id: String, organization_id: String,) → bool
```

## backend/crates/api/src/routes/schedules.rs
```
pub async fn list_schedules(State(state) → Result<ApiResponse<Vec<Exam...
pub async fn create_schedule(State(state) → Result<ApiResponse<ExamSche...
pub async fn get_schedule(State(state) → Result<ApiResponse<ExamSche...
pub async fn update_schedule(State(state) → Result<ApiResponse<ExamSche...
pub async fn delete_schedule(State(state) → Result<StatusCode, ApiError>
pub async fn get_runtime(State(state) → Result<ApiResponse<ExamSess...
pub async fn apply_runtime_command(State(state) → Result<ApiResponse<ExamSess...
pub async fn create_student_registration(State(state) → Result<ApiResponse<ielts_ba...
```

## backend/migrations/0005_scheduling_and_access.sql
```
TABLE exam_schedules
TABLE schedule_registrations
TABLE schedule_staff_assignments
TABLE exam_session_runtimes
TABLE exam_session_runtime_sections
TABLE cohort_control_events
INDEX idx_exam_schedules_org_status_start ON exam_schedules
INDEX idx_exam_schedules_exam_start ON exam_schedules
INDEX idx_exam_schedules_version ON exam_schedules
INDEX idx_schedule_registrations_schedule_actor_active ON schedule_registrations
INDEX idx_schedule_registrations_schedule_access_updated ON schedule_registrations
INDEX idx_schedule_registrations_actor_updated ON schedule_registrations
INDEX idx_schedule_registrations_student_updated ON schedule_registrations
INDEX idx_schedule_registrations_schedule_user_active ON schedule_registrations
INDEX idx_schedule_registrations_wcode ON schedule_registrations
INDEX idx_schedule_staff_assignments_active ON schedule_staff_assignments
INDEX idx_schedule_staff_assignments_actor_role_created ON schedule_staff_assignments
INDEX idx_schedule_staff_assignments_user_role_created ON schedule_staff_assignments
INDEX idx_runtime_sections_runtime_order ON exam_session_runtime_sections
INDEX idx_cohort_control_events_schedule_created ON cohort_control_events
```

## backend/crates/application/src/delivery.rs
```
pub struct DeliveryService
pub enum DeliveryConflictReason
pub enum MutationBatchResponseMode
pub enum DeliveryError
impl DeliveryConflictReason
pub fn as_str(self) → &'static str
impl DeliveryError
pub fn conflict_reason_code(&self) → Option<&'static str>
impl DeliveryService
pub fn new(pool: MySqlPool) → Self
pub fn with_auth(pool: MySqlPool, config: AppConfig) → Self
pub fn with_runtime_tuning(pool: MySqlPool, _idempotency_usable_hours: i64, _submit_idempotency_usable_hours: i64, _violation_idempotency_usable_hours: i64, _heartbeat_min_write_interval_secs: u64,) → Self
pub fn with_auth_runtime_tuning(pool: MySqlPool, config: AppConfig, _idempotency_usable_hours: i64, _submit_idempotency_usable_hours: i64, _violation_idempotency_usable_hours: i64, _heartbeat_min_write_interval_secs: u64,) → Self
pub async fn get_session_context(&self, schedule_id: Uuid, wcode: Option<String>, student_key: Option<String>, candidate_id: Option<String>,) → Result<StudentSessionContex...
pub async fn get_session_context_with_attempt_credential(&self, schedule_id: Uuid, wcode: Option<String>, student_key: Option<String>, candidate_id: Option<String>, principal: &AuthenticatedSession, client_session_id: Option<String>,) → Result<StudentSessionContex...
pub async fn get_static_session_context(&self, schedule_id: Uuid,) → Result<ielts_backend_domain...
pub async fn get_live_session_context(&self, schedule_id: Uuid, wcode: Option<String>, student_key: Option<String>, candidate_id: Option<String>,) → Result<ielts_backend_domain...
impl ObjectiveMutationGate
pub async fn finalize_pending_schedule_attempts(pool: &MySqlPool, schedule_id: Uuid, completion_reason: &str, _batch_size: i64,) → Result<(), DeliveryError>
```

## src/services/backendBridge.ts
```
export function isBackendBuilderEnabled() → boolean
export function isBackendLibraryEnabled() → boolean
export function isBackendSchedulingEnabled() → boolean
export function isBackendDeliveryEnabled() → boolean
export function isBackendProctoringEnabled() → boolean
export function isBackendGradingEnabled() → boolean
export function hasBackendStatusCode(error, statusCode) → boolean
export function isBackendNotFound(error) → boolean
export function rememberExamRevision(id, revision) → void
export function getExamRevision(id) → number | undefined
export function clearExamRevision(id) → void
export function rememberScheduleRevision(id, revision) → void
export function getScheduleRevision(id) → number | undefined
export function clearScheduleRevision(id) → void
export function rememberAttemptSchedule(attemptId, scheduleId) → void
export function getAttemptSchedule(attemptId) → string | undefined
export async function backendGet(endpoint, config?) → Promise<T>
export async function backendPost(endpoint, body?, config?,) → Promise<T>
export async function backendPut(endpoint, body?, config?,) → Promise<T>
export async function backendPatch(endpoint, body, config?,) → Promise<T>
```
