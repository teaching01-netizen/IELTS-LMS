# SigMap Query Context
Generated: 2026-05-10T05:52:16.562Z

## backend/crates/api/src/frontend.rs
```
pub async fn serve_frontend(State(state) → Response
```

## src/services/authService.ts
```
export interface AuthSessionUser
id: string
email: string
displayName?: string | null | undefined
role: AuthUserRole
state: AuthUserState
export interface AuthSession
user: AuthSessionUser
csrfToken: string
expiresAt: string
idleTimeoutAt?: string | undefined
export interface StudentQueuedAdmission
state: 'queued'
ticketId: string
scheduleId: string
wcode: string
position: number
pollAfterMs: number
queuedAt: string
export type AuthUserRole
```

## src/services/examLifecycleService.ts
```
export class ExamLifecycleService
constructor(private repository)
async createExam(title, type, initialState, owner) → Promise<TransitionRe
```

## src/services/gradingService.ts
```
export interface GradingServiceResult
success: boolean
data?: T
error?: string
export interface SessionQueueSummary
totalSessions: number
totalStudents: number
pendingManualReviews: number
inProgressReviews: number
finalizedReviews: number
overdueReviews: number
export class GradingService
async buildGradingSessions() → Promise<GradingServi
async getSessionQueue(filters?) → Promise<GradingServi
async getSessionQueueSummary() → Promise<GradingServi
async getSessionStudentSubmissions(sessionId, filters?) → Promise<GradingServi
```

## backend/crates/application/src/answer_history.rs
```
pub struct AnswerHistoryService
pub enum AnswerHistoryError
impl AnswerHistoryService
pub fn new(pool: MySqlPool) → Self
pub async fn resolve_submission_id_from_attempt(&self, attempt_id: Uuid,) → Result<String, AnswerHistor...
pub async fn get_overview(&self, submission_id: Uuid,) → Result<AnswerHistoryOvervie...
pub async fn get_overview_by_attempt(&self, attempt_id: Uuid,) → Result<AnswerHistoryOvervie...
```
