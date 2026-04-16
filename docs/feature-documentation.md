# IELTS Proctoring System - Feature Documentation

## Overview

The IELTS Proctoring System is a comprehensive frontend monolith for IELTS examination administration, content building, proctoring, and student delivery. The system provides four distinct user interfaces tailored to different roles in the examination lifecycle.

## System Architecture

### User Roles & Interfaces

1. **Admin** (`/admin/*`) - Examination management and administration
2. **Builder** (`/builder/:examId`) - Exam content creation and editing
3. **Proctor** (`/proctor`) - Live session monitoring and control
4. **Student** (`/student/:scheduleId`) - Exam delivery interface

### Key Design Principles

- **Route-driven architecture**: Route behavior is the source of truth
- **Service layer pattern**: Direct persistence access is contained in repositories/services
- **Immutable published versions**: Published exams remain immutable; edits create new drafts
- **Non-destructive operations**: Rollback creates new versions rather than modifying history
- **Comprehensive audit logging**: All lifecycle actions are tracked with actor, timestamp, and payload

---

## Admin Features

### Exam Management

#### Exam List View
- **Location**: `/admin/exams`
- **Capabilities**:
  - View all exams in the system
  - Filter and search exams by name, status, or metadata
  - Sort exams by various criteria (date, status, name)
  - Keyboard navigation support for accessibility
  - Virtualized list rendering for performance with large datasets

#### Exam Creation
- **Location**: Accessed from exam list
- **Capabilities**:
  - Create new exams from scratch
  - Create exams from templates with template-specific audit tracking
  - Clone existing exams (creates completely new exam entity with version 1)
  - Configure exam metadata (title, description, duration, module types)
  - Set initial draft status

#### Exam Versioning & Lifecycle
- **Location**: Version History modal from exam dropdown
- **Business Logic**:
  - **Version Numbering**: Sequential increment based on max existing version + 1. All versions (draft and published) share the same numbering sequence to maintain chronological order.
  - **Parent Version Tracking**: Every version except v1 has parentVersionId pointing to its immediate predecessor. This creates a tree structure for lineage tracing.
  - **Pointer-Based Versioning**: ExamEntity maintains currentDraftVersionId and currentPublishedVersionId pointers. These are the only mutable references to versions.
  - **Deep Cloning**: All version operations use JSON.parse(JSON.stringify()) to create deep copies, preventing reference sharing between versions.
  - **Atomic Operations**: Version creation, exam pointer updates, and audit event creation are atomic transactions. If any step fails, the entire operation rolls back.
- **Capabilities**:
  - **Save as New Version**: Creates explicit version checkpoints with version number increment
    - Creates a new draft version from current draft content
    - Increments version number automatically (max existing version + 1)
    - Sets parent version pointer to current version
    - Updates exam's currentDraftVersionId to new version
    - Creates audit event with notes and explicitSave flag
    - Does not affect published versions if exam is published
    - Validation snapshot is preserved from source version
  - **Clone Exam**: Creates new exam entity with cloned content and version 1
    - Creates completely new ExamEntity with unique ID and slug (generated from title)
    - Clones content from source exam's current version (prefers draft, falls back to published)
    - New exam starts at version 1 with no parent version (new lineage)
    - New exam status is always 'draft'
    - Inherits visibility from source exam
    - Creates audit event on source exam (cloned action with new exam ID and newTitle)
    - Creates audit event on new exam (created action with clonedFrom reference and sourceTitle)
    - Deep clones content and config snapshots to avoid reference sharing
    - Validation snapshot is refreshed with current timestamp
  - **Create from Template**: Creates exam from template with template-specific audit events
    - Uses same logic as cloneExam but overrides the audit event payload
    - Audit event payload includes createdFromTemplate field (template exam ID)
    - Distinguishes template usage from simple cloning in audit trail
    - Allows tracking of template usage patterns across the system
  - **Restore as Draft**: Non-destructive rollback that creates new draft from old version
    - Validates version belongs to the specified exam (prevents cross-exam restore)
    - Creates new draft version with incremented version number
    - Copies content and config from the restored version (deep clone)
    - Sets parent version pointer to the restored version (creates branch in version tree)
    - Updates exam's currentDraftVersionId to new draft
    - If exam was not published, status transitions to 'draft'
    - If exam was published, status remains 'published' (published version intact)
    - Validation snapshot is refreshed with current timestamp
    - Creates audit event with restoredFromVersion number and notes
    - Original version remains untouched (true non-destructive operation)
  - **Republish Version**: Creates new published version from existing version
    - Validates version belongs to the specified exam
    - Runs publish readiness validation before proceeding (same checks as initial publish)
    - Creates new published version with incremented version number
    - Copies content and config from the source version (deep clone)
    - Sets parent version pointer to the source version
    - Updates exam's currentPublishedVersionId to new version
    - Transitions exam status to 'published' (if not already)
    - Sets publishedAt timestamp to current time
    - Creates audit event with republishedFromVersion number and notes
    - Previous published version remains accessible in version history
  - **Version Comparison**: Detailed diff between two versions showing:
    - Metadata differences (version number, parent version, creator, timestamps, publish notes)
    - Configuration changes (general settings, section configs, progression, scoring, security)
      - Uses JSON.stringify for deep comparison of nested config objects
      - Per-module section change detection (listening, reading, writing, speaking)
    - Content count changes (reading passages/questions, listening parts/questions)
      - Question counts calculated via utility functions (getReadingTotalQuestions, getListeningTotalQuestions)
    - Overall hasChanges boolean for quick diff detection
    - Returns null if versions don't exist or belong to different exams
  - **Version History View**: 
    - Expandable version list with details
    - Content statistics per version (passages, parts, writing prompts, speaking topics)
    - Tree structure visualization with parent-child relationships and connector lines
    - Integrated audit timeline toggle (shows/hides audit log alongside versions)
    - Version comparison selection UI (select two versions to compare)
    - Status badges (current draft, live published, archived published)
    - Validation snapshot display (valid/invalid, error/warning counts)
    - Clone exam modal with focus trap for accessibility
    - Restore/republish action buttons with confirmation dialogs

#### Exam Publishing
- **Location**: Exam Settings Drawer → Publish tab
- **Capabilities**:
  - Publish draft exams to make them available for scheduling
  - View current published version
  - Track publishing history via audit log
  - Published versions are immutable
  - **Publish Process**:
    - Validates exam is ready for publication (see Publish Readiness Validation)
    - Creates immutable published version from current draft
    - Sets currentPublishedVersionId to new version
    - Transitions status from 'draft' or 'approved' to 'published'
    - Sets publishedAt timestamp
    - Creates audit event with fromState/toState and notes
  - **Unpublish Process**:
    - Validates exam is currently published
    - Transitions status from 'published' to 'unpublished'
    - Preserves published version pointer (not deleted)
    - Creates audit event with reason payload

#### Status Transition Rules
- **Guard System**: All status transitions are validated against allowed transition matrix
- **Allowed Transitions**:
  - `draft` → `draft` (auto-save, always allowed)
  - `draft` → `in_review` (requires owner role)
  - `draft` → `archived` (requires owner role)
  - `in_review` → `draft` (requires reviewer role)
  - `in_review` → `approved` (requires reviewer role)
  - `in_review` → `rejected` (requires reviewer role)
  - `approved` → `draft` (requires reviewer role)
  - `approved` → `scheduled` (requires admin role)
  - `approved` → `published` (requires admin role)
  - `scheduled` → `published` (requires admin role)
  - `scheduled` → `draft` (requires admin role)
  - `published` → `unpublished` (requires admin role)
  - `published` → `archived` (requires admin role)
  - `unpublished` → `draft` (requires admin role)
  - `unpublished` → `published` (requires admin role)
  - `unpublished` → `archived` (requires admin role)
  - `archived` → `draft` (requires admin role)
- **Transition Actions**:
  - `submitted_for_review`: When transitioning draft → in_review
  - `approved`: When transitioning in_review → approved
  - `rejected`: When transitioning in_review → rejected
  - `published`: When transitioning to published state
  - `unpublished`: When transitioning published → unpublished
  - `scheduled`: When transitioning to scheduled state
  - `archived`: When transitioning to archived state
- **State Preservation**:
  - Published versions remain immutable regardless of status changes
  - Draft versions can be edited without affecting published versions
  - Status changes only affect the ExamEntity, not version snapshots

#### Bulk Operations
- **Location**: Exam list view (via ExamBulkActionBar component)
- **Business Logic**:
  - **Best-Effort Processing**: All bulk operations continue processing even if individual items fail. Failed items are reported in results but don't stop the batch.
  - **Per-Item Results**: Each operation returns an array of results with examId, examTitle, success boolean, and optional error message.
  - **Sequential Processing**: Items are processed sequentially (not in parallel) to maintain data consistency and avoid race conditions.
  - **Summary Statistics**: Results include total count, succeeded count, and failed count for quick overview.
  - **Atomic Per-Item**: Each individual exam operation is atomic (exam + version + events saved together), but the batch as a whole is not atomic.
- **Capabilities**:
  - Select multiple exams for bulk actions (checkbox selection in list/grid view)
  - Bulk delete (with confirmation dialog)
  - Bulk status changes (publish, unpublish, archive)
  - Bulk duplicate (clone)
  - Bulk export (JSON download)
- **Bulk Publish Workflow**:
  - Iterates through each exam ID in the provided array
  - For each exam: validates exam exists, has draft version, and passes publish readiness check
  - Calls publishExam for each valid exam (creates published version, updates status, sets publishedAt)
  - Creates audit event for each successful publish
  - Returns per-item results with success/failure and error messages
  - Continues processing even if some exams fail (best-effort)
  - Failed exams are skipped with error message recorded
- **Bulk Unpublish Workflow**:
  - Validates each exam exists and is currently published
  - Transitions status to 'unpublished' for each exam
  - Preserves published version pointers (versions are not deleted)
  - Creates audit event with reason payload for each unpublish
  - Returns per-item results with success/failure
- **Bulk Archive Workflow**:
  - Validates each exam exists and can be archived (not published or scheduled)
  - Transitions status to 'archived' for each exam
  - Sets archivedAt timestamp to current time
  - Creates audit event for each archive
  - Returns per-item results with success/failure
- **Bulk Duplicate Workflow**:
  - Clones each selected exam with "(Copy)" suffix appended to title
  - Creates new ExamEntity for each clone with unique ID and slug
  - Starts each clone at version 1 (new version lineage)
  - Creates audit events for source exam (cloned action) and cloned exam (created action)
  - Deep clones content and config to avoid reference sharing
  - Returns per-item results with success/failure
- **Bulk Export Workflow**:
  - Exports exam entity, all versions, and all audit events for each exam
  - Includes schema version (SCHEMA_VERSION constant) for import compatibility
  - Includes export metadata (exportedAt timestamp, exportedBy actor)
  - Deep clones data to avoid reference issues in exported JSON
  - Wraps each export in try-catch to handle individual failures
  - Returns per-item results with export data (on success) or error messages (on failure)
  - Failed exports return error message but don't prevent other exports from succeeding

#### Publish Readiness Validation
- **Purpose**: Comprehensive validation before allowing exam publication
- **Validation Categories**:
  1. **Title Validation**: Exam title must not be empty
  2. **General Config Validation**: Exam summary should not be empty (warning)
  3. **Module Completeness**: At least one module (Reading, Listening, Writing, Speaking) must be enabled
  4. **Reading Module Validation** (if enabled):
     - Must have at least one passage with valid content
     - Must have at least one question (error) or warning if less than 20
     - Band score table must be configured
     - Passages must have valid question blocks
  5. **Listening Module Validation** (if enabled):
     - Must have at least one part with valid content
     - Must have at least one question (error) or warning if less than 20
     - Band score table must be configured
     - Parts must have valid question blocks and audio pins
  6. **Writing Module Validation** (if enabled):
     - Task configuration must be present
     - Each task must have a non-empty prompt
     - Writing task content must be properly configured
  7. **Speaking Module Validation** (if enabled):
     - Part 1 topics must not be empty
     - Cue card prompt must not be empty
     - Part 3 discussion topics must not be empty
     - Speaking part configuration must be present
  8. **Visibility and Permissions**:
     - Warning if visibility is set to 'private'
     - Error if user does not have publish permission (canPublish = false)
  9. **Schedule Conflicts**:
     - Warning if exam has active scheduled sessions
     - Alerts that publishing new version may affect scheduled sessions
- **Validation Output**:
  - `canPublish`: Boolean indicating overall readiness
  - `errors`: Array of validation errors (blocking publication)
  - `warnings`: Array of non-blocking warnings
  - `missingFields`: List of field names that are missing or invalid
  - `questionCounts`: Summary of question counts by module

### Audit & Compliance

#### Audit Timeline
- **Location**: Integrated with version history and exam details
- **Capabilities**:
  - View chronological log of all exam changes
  - Track actor information for each action
  - View timestamps for all events
  - Access payload data for state transitions
  - Filter events by type or actor
- **Audit Event Structure**:
  - `id`: Unique event identifier
  - `examId`: Associated exam entity ID
  - `versionId`: Optional reference to version involved in event
  - `actor`: User or system that performed the action
  - `action`: Type of action performed (see Audit Action Types)
  - `fromState`: Previous status (for status transitions)
  - `toState`: New status (for status transitions)
  - `timestamp`: ISO timestamp of when event occurred
  - `payload`: Additional context data (varies by action type)
- **Audit Action Types**:
  - `created`: Exam entity created (payload: clonedFrom, createdFromTemplate)
  - `draft_saved`: Draft version saved (payload: editingPublished flag)
  - `version_created`: Explicit version checkpoint (payload: notes, explicitSave)
  - `submitted_for_review`: Exam submitted for review
  - `approved`: Exam approved during review (payload: notes)
  - `rejected`: Exam rejected during review (payload: reason)
  - `published`: Exam published (payload: notes, republishedFromVersion)
  - `unpublished`: Exam unpublished (payload: reason)
  - `scheduled`: Exam scheduled for publication (payload: scheduledTime)
  - `archived`: Exam archived
  - `cloned`: Exam cloned to new entity (payload: clonedTo, newTitle)
  - `version_restored`: Version restored as draft (payload: restoredFromVersion, notes)
  - `permissions_updated`: Permissions changed (payload: deleted flag)
- **Timeline Visualization**:
  - Vertical timeline with chronological event ordering
  - Color-coded event types for quick identification
  - Action icons for visual context
  - Status transition badges showing from/to states
  - Expandable payload details for each event
  - Relative time display (e.g., "2 hours ago")
  - Absolute timestamp on hover
- **Audit Retention**:
  - Events are stored indefinitely in localStorage
  - Events are sorted by timestamp (newest first)
  - Default limit of 100 events per exam (configurable)
  - Events persist even after exam deletion (for compliance)

---

## Builder Features

### Exam Content Creation

#### Question Builder
- **Location**: `/builder/:examId`
- **Capabilities**:
  - Add and configure question blocks
  - Support for multiple IELTS question types (Reading, Writing, Listening, Speaking)
  - Question bank integration for reusing questions
  - Stimulus material management (passages, audio, images)
  - Real-time preview of questions

#### Stimulus Management
- **Capabilities**:
  - **Passage Library**: Manage reading passages with metadata
  - **Image Editor**: Edit and optimize stimulus images
  - **Audio Support**: Upload and manage audio files for listening sections
  - Stimulus linking to questions

#### Workspace Management
- **Capabilities**:
  - Organize exam content by modules
  - Drag-and-drop question ordering
  - Section-based organization
  - Template library for common exam structures

#### Writing Task Panel
- **Capabilities**:
  - Configure writing task prompts
  - Set word count limits
  - Define scoring criteria
  - Add stimulus materials (images, passages)

### Exam Configuration

#### Settings Drawer
- **Capabilities**:
  - **General Settings**: Title, description, duration
  - **Module Configuration**: Enable/disable IELTS modules
  - **Timing Settings**: Per-section time limits
  - **Accessibility Settings**: Font size, contrast options
  - **Publishing**: Version management and publishing controls
## Proctor Features

#### Monitoring Dashboard
- **Location**: `/proctor`
- **Implementation**: ProctorDashboard component with useProctorRouteController hook
- **Real-Time Updates**:
  - **Async Polling**: Uses useAsyncPolling hook with 1s base interval, max 4s
  - **Runtime Snapshots**: Syncs ExamSessionRuntime for all schedules every poll
  - **Schedule Refresh**: Reloads schedules and runtimes together to maintain consistency
  - **Auto-Enable**: Polling only when not loading and no errors
- **Session Overview**:
  - **Capabilities**:
    - View all active exam sessions
    - Monitor student status in real-time
    - See session metadata (start time, progress, flags)
    - Filter sessions by exam, status, or student
  - **Schedule Groups**: Sessions grouped by exam schedule (ExamGroupCard components)
    - Displays: exam title, cohort name, scheduled time, runtime status
    - Shows: student count, active count, violation count
    - Indicates: isReadyToStart flag for scheduled sessions
    - Sorted by scheduled start time (chronological)
- **Student Monitoring**:
  - **Capabilities**:
    - Individual student view with:
      - Current question being answered
      - Time remaining
      - Integrity flags (if any)
      - Browser/tab activity monitoring
    - Alert panel for integrity violations
    - Real-time progress updates
  - **Enriched Sessions**: Student sessions merged with runtime snapshots
    - runtimeStatus: From runtime or session fallback
    - runtimeCurrentSection: Current active section
    - runtimeTimeRemainingSeconds: Time left in current section
    - runtimeSectionStatus: Status of current section
    - runtimeWaiting: Waiting for next section flag
  - **Filtering and Sorting**:
    - **useStudentFilters Hook**: Advanced filtering with saved filter presets
    - Filter criteria: status, exam, violations, time range
    - Search: By student name or student ID (case-insensitive)
    - Sort options: name, violations, status (asc/desc)
    - Schedule scoping: Filter to specific exam group
  - **Selection Mode**: Multi-select for bulk student operations
    - Toggle individual student selection
    - Selection-aware UI (checkboxes, bulk actions)
- **Cohort-Level Controls**:
  - **Start Scheduled Session**: Initializes runtime for scheduled exam
    - Validates schedule is ready (within time window)
    - Calls examDeliveryService.startRuntime()
    - Refreshes schedules after start
  - **Pause Cohort**: Pauses all students in a schedule
    - Pauses current section for entire cohort
    - Calls examDeliveryService.pauseRuntime()
    - Students see pause notification
  - **Resume Cohort**: Resumes paused session
    - Resumes current section for entire cohort
    - Calls examDeliveryService.resumeRuntime()
    - Accumulated pause time is tracked
  - **End Section Now**: Forces current section to end
    - All students move to next section or complete exam
    - Calls examDeliveryService.endCurrentSectionNow()
    - Creates control event for audit trail
  - **Extend Section**: Adds time to current section
    - Validates extension amount is allowed by policy
    - Calls examDeliveryService.extendCurrentSection()
    - All students receive additional time
  - **Complete Exam**: Ends entire exam session
    - All sections marked as completed
    - Calls examDeliveryService.completeRuntime()
    - Students cannot continue after completion
- **Proctor Presence**:
  - **Presence Tracking**: Multiple proctors can monitor same session
  - **Heartbeat**: Proctors send heartbeat every 1s via sendHeartbeat()
  - **Cleanup**: Stale presences (>5s) automatically removed
  - **Presence Indicator**: UI shows which proctors are active
- **Violation Rule Evaluation**:
  - **evaluateViolationRules()**: Checks student sessions against configured rules
  - Loads enabled rules for schedule via repository
  - Evaluates each rule against each student session
  - Triggers alerts when rule conditions are met
  - Rules can be customized per schedule

### Session Controls

#### Live Intervention
- **Capabilities**:
  - **Pause Session**: Temporarily pause student's exam
  - **Resume Session**: Resume paused exam
  - **End Session**: Terminate exam early
  - **Extend Time**: Add time to student's session
  - **Send Message**: Communicate with student during exam

#### Integrity Monitoring
- **Capabilities**:
  - Detect browser tab switching
  - Monitor for screen capture attempts
  - Track unusual activity patterns
  - Flag suspicious behavior for review
  - Integrity violation logging

### Accessibility
- **Capabilities**:
  - Keyboard navigation support
  - High contrast mode
  - Screen reader compatibility
  - Focus management for controls

---

## Student Features

### Exam Delivery Flow

#### Pre-Check Phase
- **Location**: `/student/:scheduleId` (initial phase)
- **Capabilities**:
  - System compatibility check
  - Browser requirements validation
  - Camera/microphone permissions check (for speaking sections)
  - Network connectivity test
  - Display requirements verification

#### Lobby Phase
- **Location**: `/student/:scheduleId` (after pre-check)
- **Capabilities**:
  - Exam instructions display
  - Rules and guidelines review
  - Identity verification (if required)
  - Wait for proctor approval
  - Start exam button (enabled when approved)

#### Exam Phase
- **Location**: `/student/:scheduleId` (active exam)
- **Implementation**: StudentApp with provider-based architecture (7 context providers)
- **Data Loading**:
  - **useStudentSessionRouteData Hook**: Orchestrates student session data loading
  - **Load Sequence**:
    1. Fetch schedule by scheduleId from repository
    2. Fetch exam entity by schedule.examId
    3. Convert exam entity to ExamState via adapter service
    4. Fetch runtime snapshot via examDeliveryService.getRuntimeSnapshot()
    5. Fetch or create StudentAttempt via studentAttemptRepository
  - **Error Handling**: Catches errors, sets error state, stops loading
  - **Async Polling**: Refreshes runtime snapshot every 1s (max 4s) when active
- **Provider Architecture**:
  - **StudentSessionProvider**: Manages session state and phase transitions
  - **StudentRuntimeProvider**: Syncs runtime state from delivery service
  - **StudentAttemptProvider**: Manages answer persistence and submission
  - **StudentNetworkProvider**: Monitors connectivity and handles offline state
  - **StudentProctoringProvider**: Integrity monitoring and heartbeat sending
  - **StudentKeyboardProvider**: Keyboard shortcuts and accessibility
  - **StudentNavigationProvider**: Question navigation and module switching
  - **StudentUIProvider**: UI state (modals, toasts, accessibility settings)
- **Runtime State Sync**:
  - **Runtime Snapshot**: Fetched from examDeliveryService.getRuntimeSnapshot()
  - **Section Status**: Tracks locked/live/paused/completed per section
  - **Time Remaining**: currentSectionRemainingSeconds from runtime
  - **Active Section**: currentSectionKey indicates current module
  - **Waiting State**: waitingForNextSection flag between sections
  - **Auto-Advance**: Runtime service advances sections automatically based on time
- **Capabilities**:
  - **Timer Display**: Countdown timer for exam and per-section
    - Displays currentSectionRemainingSeconds from runtime
    - Format: HH:MM:SS (hours shown only if >0)
    - Auto-updates via runtime polling
  - **Question Navigation**: 
    - Module tabs (Reading, Writing, Listening, Speaking)
    - Question navigator with status indicators (answered, unanswered, flagged)
    - Jump to specific questions
    - Keyboard navigation (arrow keys, number keys)
  - **Question Interface**:
    - Display stimulus materials (passages, images, audio)
    - Input methods appropriate to question type (MCQ, TFNG, cloze, etc.)
    - Save answers automatically via StudentAttemptProvider
    - Mark questions for review (flagged state)
    - QuestionRenderer component handles different block types
  - **Section Transitions**:
    - Automatic: Runtime service advances when time expires
    - Manual: Proctor can end section early
    - Gap handling: Waiting state between sections with countdown
    - Pause handling: Timer stops, shows pause message
  - **Accessibility Settings**:
    - Font size adjustment (small, normal, large, extra-large)
    - High contrast mode toggle
    - Screen reader support (ARIA labels, semantic HTML)
    - Focus management (focus trap in modals, logical tab order)
  - **Integrity Monitoring**:
    - Tab switch detection via Visibility API
    - Full-screen mode enforcement via Fullscreen API
    - Activity tracking via heartbeat system
    - Clipboard blocking via Clipboard API
    - Context menu blocking
    - Device continuity checking on reconnect
- **Answer Persistence**:
  - **Auto-Save**: Answers saved immediately on change via StudentAttemptProvider
  - **LocalStorage**: Attempt data persisted to localStorage
  - **Offline Buffering**: Answers buffered when offline, synced on reconnect
  - **Submission**: Final submission sends all answers to repository
- **Keyboard Shortcuts**:
  - Arrow keys: Navigate between questions
  - Number keys: Jump to specific question
  - Escape: Close modals, exit fullscreen
  - F11: Toggle fullscreen (browser default)
  - Custom shortcuts configured via StudentKeyboardProvider

#### Complete Phase
- **Location**: `/student/:scheduleId` (after exam submission)
- **Capabilities**:
  - Exam completion confirmation
  - Review submitted answers (if allowed)
  - Submission receipt
  - Exit exam interface

### Accessibility Features

#### Visual Adjustments
- **Capabilities**:
  - Font size scaling (small, normal, large, extra-large)
  - High contrast mode toggle
  - Colorblind-friendly options
  - Dyslexia-friendly font option

#### Keyboard Navigation
- **Capabilities**:
  - Full keyboard navigation support
  - Tab order follows logical flow
  - Skip links for main content
  - Keyboard shortcuts for common actions

#### Screen Reader Support
- **Capabilities**:
  - ARIA labels on all interactive elements
  - Semantic HTML structure
  - Alt text for images
  - Live regions for dynamic content

---

## Shared Features

### Authentication & Authorization
- **Location**: Auth feature module
- **Capabilities**:
  - Role-based access control (Admin, Proctor, Student)
  - Secure session management
  - Login/logout functionality
  - Permission validation for all routes

### Command Palette
- **Location**: Global UI component
- **Capabilities**:
  - Quick navigation to any route
  - Search for exams, students, sessions
  - Keyboard shortcut activation
  - Context-aware suggestions

### Global Toast Notifications
- **Location**: Global UI component
- **Capabilities**:
  - Success/error/information messages
  - Auto-dismiss after timeout
  - Manual dismiss option
  - Stack multiple notifications

### Confirm Modals
- **Location**: Global UI component
- **Capabilities**:
  - Destructive action confirmation
  - Customizable messages
  - Cancel/confirm actions
  - Keyboard support (Escape to cancel, Enter to confirm)

---

## Data Services

### Service Layer Architecture
- **Design Pattern**: Repository pattern with service layer orchestration
- **Separation of Concerns**:
  - **Repository Layer**: Direct data access (localStorage currently, API abstraction ready)
  - **Service Layer**: Business logic, validation, orchestration
  - **Route/Feature Layer**: Domain orchestration and data fetching
  - **UI Components**: Presentational, receive data via props
- **Data Flow**: Route → Feature Hook → Service → Repository → Storage
- **Immutable Operations**: All data operations create new objects, never mutate existing state
- **Transaction Safety**: Related operations are atomic (exam + version + event saved together)

### Exam Repository
- **Purpose**: Data access abstraction for exam persistence
- **Storage Backend**: LocalStorage (with API abstraction layer ready for backend migration)
- **Storage Keys**:
  - `ielts_exams_v2`: Exam entities
  - `ielts_exam_versions`: Version snapshots
  - `ielts_exam_events`: Audit events
  - `ielts_schedules_v2`: Exam schedules
  - `ielts_exam_runtimes_v1`: Session runtime data
  - `ielts_exam_control_events_v1`: Proctor control events
  - `ielts_session_audit_logs_v1`: Student session audit logs
- **Capabilities**:
  - CRUD operations for exams with automatic updatedAt timestamp
  - Version storage and retrieval with normalization
  - Metadata management with schema version tracking
  - Search and filtering via service layer
  - Legacy data migration support
  - Automatic config normalization on read/write
- **Migration Support**:
  - Schema version tracking (current: SCHEMA_VERSION = 3)
  - Automatic migration from legacy Exam format to domain model
  - Legacy schedule migration to new format
  - One-time migration that clears old data after successful conversion

### Exam Lifecycle Service
- **Purpose**: Business logic layer for exam lifecycle operations
- **Implementation**: ExamLifecycleService class (singleton export: examLifecycleService)
- **Core Responsibilities**:
  - Status transition validation and enforcement
  - Version management with immutability guarantees
  - Clone and template operations with audit tracking
  - Restore and republish workflows (non-destructive)
  - Comprehensive validation before state changes
  - Audit event generation for all operations
  - Bulk operations with best-effort processing
- **Key Behaviors**:
  - **Published Version Immutability**: Once published, versions never change. Edits create new drafts.
  - **Non-Destructive Rollback**: Restore creates new version from old content, never modifies history.
  - **Parent Version Tracking**: Every version (except v1) has parentVersionId for lineage tracking.
  - **Pointer Updates**: Exam entity maintains currentDraftVersionId and currentPublishedVersionId pointers.
  - **Validation Gates**: Publish readiness checked before allowing publication.
  - **Audit Trail**: Every operation creates at least one audit event with full context.
  - **Deep Cloning**: All content/config copies use JSON.parse(JSON.stringify()) to prevent reference sharing.
- **Status Transition Guard System**:
  - **STATUS_TRANSITIONS Array**: Defines all allowed transitions with role requirements
  - **canTransition() Function**: Checks if a transition is allowed based on the guard matrix
  - **Role-Based Guards**: Some transitions require specific actor roles (owner, reviewer, admin)
  - **Transition Actions**: Maps target status to audit action type (submitted_for_review, approved, rejected, published, etc.)
- **ID Generation**:
  - **generateId(prefix)**: Creates unique IDs using timestamp + random string (format: `{prefix}-{timestamp}-{random}`)
  - **generateSlug(title)**: Creates URL-friendly slugs from titles (lowercase, hyphens, no special chars)
- **Error Handling**:
  - Returns TransitionResult with success/failure, error message, and affected objects
  - Validates preconditions before making changes (exam exists, version exists, belongs to exam)
  - Provides specific error messages for each failure scenario
  - Early returns on validation failures to prevent partial state updates
- **Bulk Operations**:
  - Best-effort processing (continues even if some items fail)
  - Per-item results with success/failure and error messages
  - Summary statistics (total, succeeded, failed)
  - Used for publish, unpublish, archive, duplicate, and export operations
  - Sequential processing to maintain consistency

### Exam Delivery Service
- **Purpose**: Manages exam content delivery to students and runtime session state
- **Implementation**: ExamDeliveryService class with repository dependency injection
- **Capabilities**:
  - Exam content delivery to students
  - Session state management and advancement
  - Answer submission handling
  - Progress tracking
  - Proctor intervention handling
  - Runtime snapshot generation
- **Section Planning**:
  - **buildSectionPlan(config)**: Calculates section timing based on enabled modules
  - **Section Ordering**: Sorts by config.order, falls back to MODULE_ORDER (listening, reading, writing, speaking)
  - **Offset Calculation**: Tracks startOffsetMinutes and endOffsetMinutes for each section
  - **Gap Handling**: Includes gapAfterMinutes between sections (except last section)
  - **Total Duration**: Sums section durations plus gaps for plannedDurationMinutes
- **Schedule Window Validation**:
  - **validateScheduleWindow()**: Ensures scheduled time window can accommodate exam duration
  - **Validation Checks**:
    - At least one enabled section required
    - All section durations must be > 0
    - All gapAfterMinutes must be >= 0
    - No duplicate section orders
    - End time must be after start time
    - Window must be >= planned duration
  - Returns ScheduleWindowValidationResult with isValid flag and error array
- **Runtime State Management**:
  - **startRuntime()**: Initializes a new exam session
    - Validates schedule is ready (within time window, not already started)
    - Validates schedule window against planned duration
    - Creates ExamSessionRuntime with section states
    - First section set to 'live', others set to 'locked'
    - Creates control event (start_runtime) for audit trail
  - **getRuntimeSnapshot()**: Returns current runtime state with automatic advancement
    - Loads schedule context (schedule, version, config, plan)
    - If no runtime exists, builds not-started snapshot
    - If runtime exists, calls advanceRuntime() to process time-based transitions
    - Decorates snapshot with calculated fields (projected times, remaining seconds)
    - Persists changes if advancement occurred
  - **pauseRuntime()**: Pauses the current active section
    - Validates runtime is live and has active section
    - Sets section status to 'paused', records pausedAt timestamp
    - Sets runtime status to 'paused'
    - Creates control event (pause_runtime) with reason
  - **resumeRuntime()**: Resumes a paused section
    - Validates runtime is paused and has active section
    - Calculates accumulated paused time and adds to section.accumulatedPausedSeconds
    - Clears section.pausedAt, sets status to 'live'
    - Sets runtime status to 'live'
    - Creates control event (resume_runtime)
  - **extendCurrentSection()**: Adds time to current section
    - Validates extension minutes is positive and allowed by delivery policy
    - Adds minutes to section.extensionMinutes
    - Creates control event (extend_section) with minutes and sectionKey
  - **endCurrentSectionNow()**: Forces current section to end immediately
    - Completes current section with proctor_end reason
    - Activates next section (if exists) or completes runtime
    - Creates control event (end_section_now) with sectionKey
  - **completeRuntime()**: Ends the entire exam session
    - Completes all remaining sections with proctor_complete reason
    - Sets runtime status to 'completed', clears active section
    - Creates control event (complete_runtime)
- **Runtime Advancement Logic**:
  - **advanceRuntime()**: Processes time-based state transitions
    - While runtime is 'live':
      - Find active section (status = 'live' or 'paused')
      - If section time has elapsed: complete section, create auto_timeout event
      - If no next section: mark runtime as completed
      - If gap between sections: set waitingForNextSection flag
      - If next section is ready: activate it, set status to 'live'
    - Returns changed flag and array of generated control events
  - **Time Calculation**:
    - **calculateLiveSectionEnd()**: Computes section end time considering:
      - Planned duration (plannedDurationMinutes)
      - Extensions (extensionMinutes)
      - Accumulated paused time (accumulatedPausedSeconds)
      - Actual start time (actualStartAt)
  - **Section Completion**:
    - Sets status to 'completed'
    - Records actualEndAt timestamp
    - Stores completionReason (auto_timeout, proctor_end, proctor_complete)
- **Proctor Presence Tracking**:
  - **sendHeartbeat()**: Updates proctor presence in runtime
    - Adds new proctor if not present (records joinedAt)
    - Updates lastHeartbeat for existing proctor
    - Cleans up stale presences (older than 5 minutes)
  - **removeProctorPresence()**: Removes proctor from presence list
- **Session Lifecycle**:
  - Pre-check phase validation (via student route)
  - Lobby phase waiting for proctor approval
  - Active exam phase with section transitions
  - Post-exam submission handling
- **State Management**:
  - Runtime status tracking (not_started, live, paused, completed, cancelled)
  - Section-level status tracking (locked, live, paused, completed)
  - Time management with extensions and pauses
  - Progress tracking across modules
  - Waiting state between sections (waitingForNextSection)

### Grading Service
- **Purpose**: Automated scoring and grading workflow management
- **Capabilities**:
  - Automated scoring for objective questions (TFNG, MCQ, etc.)
  - Grading rubric application for subjective questions
  - Score calculation with band score tables
  - Grading workflow management
- **Scoring Logic**:
  - Reading/Listening: Automatic scoring based on correct answers
  - Writing/Speaking: Rubric-based scoring by human assessors
  - Overall band score calculation with rounding rules
  - Module-specific band score tables

### Student Integrity Service
- **Purpose**: Detect and flag integrity violations during exams via heartbeat-based monitoring
- **Implementation**: Functional service with security policy configuration
- **Security Policy Configuration**:
  - **StudentIntegritySecurityPolicy Interface**:
    - heartbeatIntervalSeconds: Frequency of heartbeat checks (default: 15s)
    - heartbeatMissThreshold: Number of missed heartbeats before timeout (default: 3)
    - pauseOnOffline: Whether to pause exam when offline (default: true)
    - bufferAnswersOffline: Whether to buffer answers when offline (default: true)
    - requireDeviceContinuityOnReconnect: Enforce same device on reconnect (default: true)
    - allowSafariWithAcknowledgement: Allow Safari with user acknowledgment (default: true)
  - **getStudentIntegritySecurityPolicy()**: Merges provided config with defaults
  - **getHeartbeatIntervalMs()**: Returns heartbeat interval in milliseconds
  - **getHeartbeatLossTimeoutMs()**: Calculates timeout (interval * threshold)
- **Device Continuity**:
  - **hasDeviceContinuityMismatch()**: Compares device fingerprints between sessions
  - Returns true if both hashes exist and don't match (indicates device change)
- **Heartbeat Event Building**:
  - **buildStudentHeartbeatEvent()**: Creates StudentHeartbeatEvent objects
  - Includes: attemptId, scheduleId, timestamp, type, payload
  - Auto-generates ID with 'heartbeat' prefix
- **Violation Detection**:
  - Based on heartbeat patterns from StudentProctoringProvider
  - Monitors for missed heartbeats (network issues, tab switching)
  - Detects device continuity violations on reconnect
  - Triggers alerts when thresholds are exceeded
- **Integration Points**:
  - StudentProctoringProvider: Sends heartbeats via this service
  - StudentAuditService: Logs integrity violations
  - ProctorDashboard: Displays violation alerts

### Student Audit Service
- **Purpose**: Log all student actions during exam sessions for compliance and debugging
- **Implementation**: Functional service with repository persistence
- **Audit Action Types**:
  - **Standardized Actions** (auditActions Set):
    - PRECHECK_COMPLETED: System compatibility check passed
    - PRECHECK_WARNING_ACKNOWLEDGED: User acknowledged pre-check warnings
    - NETWORK_DISCONNECTED: Network connection lost
    - NETWORK_RECONNECTED: Network connection restored
    - HEARTBEAT_MISSED: Single heartbeat missed
    - HEARTBEAT_LOST: Heartbeat threshold exceeded (connection lost)
    - DEVICE_CONTINUITY_FAILED: Device fingerprint changed
    - CLIPBOARD_BLOCKED: Clipboard access attempt blocked
    - CONTEXT_MENU_BLOCKED: Context menu attempt blocked
  - **resolveActionType()**: Maps event strings to AuditActionType, defaults to AUTO_ACTION
- **Audit Logging**:
  - **saveStudentAuditEvent()**: Persists audit events to repository
  - Validates sessionId is provided (no-op if missing)
  - Creates SessionAuditLog with:
    - Auto-generated ID (prefix: 'audit')
    - Current timestamp
    - Actor: 'student-system'
    - ActionType: Resolved from event string
    - SessionId: Provided session identifier
    - Payload: Includes original event string and additional context
  - Persists via examRepository.saveAuditLog()
- **Integration Points**:
  - StudentNetworkProvider: Logs network events
  - StudentProctoringProvider: Logs integrity violations
  - StudentKeyboardProvider: Logs keyboard events
  - StudentRuntimeProvider: Logs session state changes
- **Audit Trail Usage**:
  - Compliance reporting for exam integrity
  - Debugging student session issues
  - Investigating integrity violations
  - Analyzing system behavior patterns

---

## Quality & Testing

### Automated Testing
- **E2E Tests**: Playwright tests for admin, proctor, and student workflows
- **Unit Tests**: Vitest tests for services and repositories
- **Type Checking**: TypeScript strict mode enabled
- **Linting**: ESLint configuration (in progress)

### Quality Gates
- `npm run typecheck` must pass
- E2E tests must remain green
- Unit tests must pass
- Linting should pass (work in progress)

---

## Development Guidelines

### Route Behavior as Source of Truth
- All application behavior should be defined and tested at the route level
- Routes should contain domain orchestration logic
- UI components should be presentational and receive data via props

### Service Layer Pattern
- Direct persistence access must be inside repositories/services
- Routes and UI components should not access storage directly
- Services encapsulate business logic and data operations

### Legacy and In-Progress Marking
- Inactive shells should be marked as legacy
- Unfinished surfaces should be marked as in-progress
- Do not imply incomplete features are live

### Import Boundaries
- Respect architectural import boundaries
- Features should not import from other features directly
- Shared code should be in appropriate common directories

---

## Technical Architecture

### Component Organization

```
src/
├── app/                    # Application-level code
│   ├── api/               # API client abstraction
│   ├── data/              # React Query hooks
│   ├── error/             # Error handling system
│   ├── forms/             # Form handling utilities
│   ├── hooks/             # Custom app hooks
│   ├── monitoring/        # Performance monitoring
│   ├── performance/       # Performance utilities
│   ├── router/            # Route definitions
│   ├── store/             # Zustand global state
│   └── validation/        # API validation schemas
├── components/            # Reusable UI components
│   ├── admin/            # Admin-specific components
│   ├── blocks/           # Question block components
│   ├── builder/          # Builder-specific components
│   ├── passage/          # Passage management
│   ├── proctor/          # Proctor-specific components
│   ├── questionbank/     # Question bank UI
│   ├── scoring/          # Scoring components
│   ├── student/          # Student-specific components
│   ├── ui/               # Shared UI components
│   └── workspaces/       # Workspace management
├── features/             # Feature modules
│   ├── admin/           # Admin feature contracts/hooks
│   ├── builder/         # Builder feature contracts/hooks
│   ├── proctor/         # Proctor feature contracts/hooks
│   └── student/         # Student feature contracts/hooks
├── constants/           # Application constants
├── hooks/               # Global custom hooks
├── store/               # Legacy stores (being migrated)
├── types/               # TypeScript type definitions
└── App.tsx              # Application root
```

### State Management

#### Global State (Zustand)
- **userStore**: User authentication and profile data
- **uiStore**: UI state (theme, sidebar, modals)
- **notificationStore**: Toast notifications management

#### Local State
- Component-level `useState` for UI-specific state
- React Query (`@tanstack/react-query`) for server state
- Form state via `react-hook-form`

#### State Flow Pattern
```
Route → Feature Hook → Service/Repository → API → React Query Cache → Component
```

### API Client Architecture

#### ApiClient Features
- Centralized HTTP communication via `src/app/api/apiClient.ts`
- Request/response interceptors for auth and logging
- Automatic retry logic for transient failures
- Timeout handling (default 30s)
- Abort signal support for request cancellation
- Standardized error handling with typed responses

#### API Response Structure
```typescript
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  metadata?: {
    timestamp: string;
    requestId?: string;
  };
}
```

### Type System

#### Domain Models (`src/types/domain.ts`)
- **ExamEntity**: Authoritative exam metadata entity
- **ExamVersion**: Versioned exam content
- **ExamStatus**: Lifecycle states (draft, published, archived, etc.)
- **ExamAction**: Audit log action types
- **StudentAttempt**: Student exam session data

#### Type Safety
- Strict TypeScript mode enabled
- Zod schemas for runtime validation
- API response validation via `validateApiResponse`
- Domain types separate from legacy types

### Routing Structure

#### Route Manifest (`src/app/router/route-manifest.ts`)
```typescript
/admin              # Admin dashboard
  /exams           # Exam list and management
  /library         # Content library
  /scheduling      # Exam scheduling
  /grading         # Grading interface
  /results         # Results viewing
  /settings        # Admin settings

/builder/:examId    # Exam builder (single route, internal phases)

/proctor            # Proctor dashboard (single route)

/student/:scheduleId # Student session (single route, internal phases)
```

#### Internal Phases
- Student route uses internal state phases: pre-check → lobby → exam → complete
- Builder route uses internal state phases: content → config → review

---

## Implementation Details

### Domain Model
- **Purpose**: Authoritative business entities that replace legacy data structures
- **Core Entities**:
  - **ExamEntity**: Single source of truth for exam metadata
    - Contains: id, slug, title, type, status, visibility, owner
    - Timestamps: createdAt, updatedAt, publishedAt, archivedAt
    - Version pointers: currentDraftVersionId, currentPublishedVersionId
    - Permissions: canEdit, canPublish, canDelete
    - Denormalized counts: totalQuestions, totalReadingQuestions, totalListeningQuestions
    - Schema version for migration support
  - **ExamVersion**: Immutable snapshot of exam content at a point in time
    - Contains: id, examId, versionNumber, parentVersionId
    - Snapshots: contentSnapshot (ExamState), configSnapshot (ExamConfig)
    - Validation: validationSnapshot (isValid, errorCount, warningCount, lastValidatedAt)
    - Metadata: createdBy, createdAt, publishNotes
    - State flags: isDraft, isPublished
    - **Immutability**: Once created, versions never change
  - **ExamEvent**: Audit log entry for lifecycle tracking
    - Contains: id, examId, versionId, actor, action
    - State transition: fromState, toState
    - Context: timestamp, payload (action-specific data)
  - **ExamSchedule**: Planned exam session linked to published version
    - Contains: id, examId, examTitle, publishedVersionId (always immutable)
    - Schedule: cohortName, startTime, endTime, plannedDurationMinutes
    - Delivery: deliveryMode (proctor_start), autoStart, autoStop
    - Status: scheduled, live, completed, cancelled
    - Recurrence: optional recurrence settings
  - **ExamSessionRuntime**: Live session state tracking
    - Contains: id, scheduleId, examId, cohortName
    - Status: RuntimeStatus (not_started, live, paused, completed, cancelled)
    - Active section: activeSectionKey, currentSectionKey, currentSectionRemainingSeconds
    - Sections: array of SectionRuntimeState with detailed tracking
    - Proctor presence: array of proctors in session
- **Entity Relationships**:
  - ExamEntity 1:N ExamVersion (one exam has many versions)
  - ExamEntity 1:N ExamEvent (one exam has many audit events)
  - ExamEntity 1:N ExamSchedule (one exam can be scheduled multiple times)
  - ExamSchedule 1:1 ExamSessionRuntime (one schedule has one runtime)
  - ExamVersion N:1 ExamVersion (parent-child via parentVersionId)
- **Design Principles**:
  - Single source of truth: ExamEntity is authoritative for metadata
  - Immutability: Published versions never change
  - Pointer-based: Exam entity points to current versions via IDs
  - Audit trail: All changes logged as events
  - Schema versioning: Supports data migration across versions

### Service Layer Pattern

#### Principles
- All persistence access contained in repositories/services
- Routes orchestrate domain logic
- UI components are presentational, receive data via props
- No direct storage access from UI components

#### Service Architecture
```
Route Controller
  ↓
Feature Hook (useAdminRootController, useBuilderRouteController, etc.)
  ↓
Service (ExamLifecycleService, ExamDeliveryService, etc.)
  ↓
Repository (ExamRepository, StudentRepository, etc.)
  ↓
API Client
```

### Error Handling Strategy

#### Error Types (`src/app/error/errorTypes.ts`)
- **NetworkError**: Connection failures
- **ServiceUnavailableError**: Backend unavailable
- **ValidationError**: Invalid input data
- **AuthenticationError**: Auth failures
- **AuthorizationError**: Permission issues

#### Error Handling Flow
1. API client catches and classifies errors
2. Error logger records context (`src/app/error/errorLogger.ts`)
3. `useErrorHandler` hook provides UI error boundaries
4. `withErrorHandling` HOC wraps components for error isolation
5. Toast notifications display user-friendly messages

### Performance Optimization

#### Virtualization
- **AdminExams**: React Virtuoso for large exam lists
- **ProctorDashboard**: Virtualized student list (planned)
- **AlertPanel**: Virtualized alerts (planned)

#### Memoization
- React.memo on list items (AdminExams - in progress)
- Custom memoization utilities (`src/app/performance/memoize.ts`)
- Performance tracker for monitoring (`src/app/performance/performanceTracker.ts`)

#### Code Splitting
- Route-based code splitting via React Router
- Lazy loading of feature modules
- Dynamic imports for heavy components

#### React Query Optimization
- Automatic caching and stale-while-revalidate
- Optimistic updates for better UX
- Background refetching
- Query invalidation strategies

### Security Measures

#### Authentication
- Role-based access control (Admin, Proctor, Student)
- Secure session management
- JWT token handling (via API client interceptors)
- Permission validation at route level

#### Integrity Monitoring
- Browser tab switching detection
- Screen capture attempt detection
- Full-screen mode enforcement
- Activity pattern analysis
- Integrity violation logging

#### Data Protection
- Audit trail for all lifecycle actions
- Actor and timestamp tracking
- Payload data logging for state transitions
- Non-destructive operations (rollback creates new versions)

---

## Development Setup

### Prerequisites
- Node.js 18+ 
- npm or yarn
- Git

### Installation
```bash
# Clone repository
git clone <repository-url>
cd remix_-ielts-proctoring-system

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your configuration
```

### Development Scripts
```bash
# Start development server
npm run dev

# Type checking
npm run typecheck

# Linting
npm run lint
npm run lint:fix

# Testing
npm test              # Unit tests (Vitest)
npm run test:ui       # Vitest UI
npm run test:run      # Run tests once

# E2E Testing
npm run playwright        # Run Playwright tests
npm run playwright:ui     # Playwright UI mode
npm run playwright:debug  # Debug Playwright tests

# Storybook
npm run storybook         # Start Storybook
npm run build-storybook   # Build Storybook

# Build
npm run build
npm run preview
```

### Environment Variables
Create `.env` file based on `.env.example`:
- API base URL
- Authentication endpoints
- Feature flags
- Monitoring configuration

### IDE Configuration
- TypeScript strict mode enabled
- ESLint configuration for code quality
- Prettier for code formatting
- VS Code settings recommended (see .vscode if available)

---

## Component Library

### UI Components (`src/components/ui/`)

#### Form Components
- Input fields with validation
- Select dropdowns
- Checkboxes and radio buttons
- Date/time pickers
- Form validation integration

#### Layout Components
- Card containers
- Grid layouts
- Flex containers
- Divider components
- Spacer utilities

#### Feedback Components
- Toast notifications (global)
- Confirm modals (global)
- Progress indicators
- Loading spinners
- Alert banners

#### Navigation Components
- Breadcrumbs
- Tabs
- Pagination
- Menu items
- Command palette

### Feature Components

#### Admin Components (`src/components/admin/`)
- **AdminExams**: Exam list with filtering, search, bulk actions
- **ExamVersionHistory**: Version timeline and comparison
- **VersionCompareView**: Side-by-side version diff
- **ExamAuditTimeline**: Audit log visualization
- **ExamFiltersPanel**: Search and filter controls
- **ExamBulkActionBar**: Bulk operation controls

#### Builder Components (`src/components/builder/`)
- **QuestionBuilder**: Question creation interface
- **StimulusManager**: Passage/image/audio management
- **WorkspaceManager**: Module organization
- **WritingTaskPanel**: Writing task configuration
- **ExamSettingsDrawer**: Exam configuration panel

#### Proctor Components (`src/components/proctor/`)
- **ProctorDashboard**: Session monitoring overview
- **StudentList**: Student session list
- **AlertPanel**: Integrity violation alerts
- **SessionControls**: Live intervention controls
- **StudentDetailView**: Individual student monitoring

#### Student Components (`src/components/student/`)
- **PreCheckPhase**: System compatibility check
- **LobbyPhase**: Instructions and waiting room
- **ExamPhase**: Question delivery interface
- **CompletePhase**: Submission confirmation
- **QuestionNavigator**: Question navigation panel
- **TimerDisplay**: Exam countdown timer

### Custom Hooks

#### Global Hooks (`src/hooks/`)
- **useFilters**: Generic filtering logic
- **useFocusTrap**: Accessibility focus management

#### Feature Hooks (`src/features/*/hooks/`)
- **useAdminRootController**: Admin route orchestration
- **useBuilderRouteController**: Builder route orchestration
- **useProctorRouteController**: Proctor route orchestration
- **useStudentSessionRouteData**: Student session data

#### Component Hooks (`src/components/*/hooks/`)
- **useVersionHistory**: Version history state management
- **useStudentFilters**: Student filtering logic

---

## Integration Points

### External Dependencies

#### Core Framework
- **React 19**: UI framework
- **React Router 7**: Client-side routing
- **Vite 6**: Build tool and dev server

#### State & Data
- **Zustand 5**: Global state management
- **TanStack Query 5**: Server state management
- **React Hook Form 7**: Form state management
- **Zod 4**: Schema validation

#### UI Libraries
- **TailwindCSS 4**: Utility-first styling
- **Lucide React**: Icon library
- **Motion 12**: Animation library
- **React Virtuoso 4**: List virtualization

#### Development Tools
- **TypeScript 5.8**: Type system
- **ESLint 9**: Code linting
- **Vitest 2**: Unit testing
- **Playwright 1.59**: E2E testing
- **Storybook 10.3**: Component documentation

### API Endpoints

#### Admin API
- `GET /api/exams` - List exams
- `POST /api/exams` - Create exam
- `PUT /api/exams/:id` - Update exam
- `DELETE /api/exams/:id` - Delete exam
- `POST /api/exams/:id/publish` - Publish exam
- `POST /api/exams/:id/clone` - Clone exam
- `GET /api/exams/:id/versions` - Get version history
- `POST /api/exams/:id/versions/:versionId/restore` - Restore version

#### Builder API
- `GET /api/exams/:id` - Get exam content
- `PUT /api/exams/:id/content` - Update exam content
- `POST /api/exams/:id/version` - Create new version
- `GET /api/questions` - Get question bank
- `POST /api/questions` - Create question

#### Proctor API
- `GET /api/sessions` - List active sessions
- `GET /api/sessions/:id` - Get session details
- `POST /api/sessions/:id/pause` - Pause session
- `POST /api/sessions/:id/resume` - Resume session
- `POST /api/sessions/:id/extend` - Extend time
- `POST /api/sessions/:id/message` - Send message

#### Student API
- `GET /api/schedules/:id` - Get schedule details
- `POST /api/schedules/:id/precheck` - Run pre-check
- `POST /api/schedules/:id/start` - Start exam
- `POST /api/schedules/:id/submit` - Submit exam
- `POST /api/schedules/:id/heartbeat` - Session heartbeat
- `PUT /api/attempts/:id` - Save answer

### Browser Capabilities

#### APIs Used
- **Fullscreen API**: Exam integrity enforcement
- **Visibility API**: Tab switching detection
- **Clipboard API**: Copy/paste control
- **MediaDevices API**: Camera/microphone access (speaking)
- **Screen Orientation API**: Device orientation lock
- **Network Information API**: Connectivity monitoring

#### Browser Storage
- **localStorage**: User preferences, UI state
- **sessionStorage**: Temporary session data
- **IndexedDB**: Large data caching (planned)

---

## Monitoring & Debugging

### Error Tracking

#### Error Logger (`src/app/error/errorLogger.ts`)
- Centralized error logging
- Contextual information capture
- Error classification
- Integration with monitoring service (planned)

#### Error Types (`src/app/error/errorTypes.ts`)
- Typed error classes
- Error code standardization
- User-friendly error messages

### Performance Monitoring

#### Performance Monitor (`src/app/monitoring/performanceMonitor.ts`)
- Component render timing
- API request duration
- Memory usage tracking
- Performance bottleneck detection

#### Performance Tracker (`src/app/performance/performanceTracker.ts`)
- Custom performance metrics
- Benchmark utilities
- Performance regression detection

### Logging Strategy

#### Log Levels
- **Error**: Critical failures
- **Warn**: Potential issues
- **Info**: Important events
- **Debug**: Detailed diagnostics

#### Log Destinations
- Console (development)
- Error tracking service (production - planned)
- Audit log (compliance events)

---

## Accessibility Compliance

### WCAG 2.1 AA Compliance

#### Visual Adjustments
- Font size scaling (small, normal, large, extra-large)
- High contrast mode toggle
- Colorblind-friendly color schemes
- Dyslexia-friendly font option
- Sufficient color contrast ratios (4.5:1 for text)

#### Keyboard Navigation
- Full keyboard navigation support
- Logical tab order
- Skip links for main content
- Keyboard shortcuts for common actions
- Focus indicators visible
- No keyboard traps

#### Screen Reader Support
- ARIA labels on all interactive elements
- Semantic HTML structure
- Alt text for all images
- Live regions for dynamic content
- Proper heading hierarchy
- Landmark regions for navigation

#### Focus Management
- Programmatic focus control
- Focus restoration after modal close
- Focus trapping in modals
- Visible focus indicators

### Testing Tools
- Storybook a11y addon (@storybook/addon-a11y)
- ESLint jsx-a11y plugin
- Manual keyboard testing
- Screen reader testing (NVDA, JAWS)

---

## Browser & Device Support

### Supported Browsers

#### Desktop
- **Chrome/Edge**: Latest 2 versions
- **Firefox**: Latest 2 versions
- **Safari**: Latest 2 versions

#### Mobile (Planned)
- **iOS Safari**: Latest 2 versions
- **Chrome Mobile**: Latest 2 versions
- **Samsung Internet**: Latest 2 versions

### Browser Requirements
- JavaScript enabled
- Cookies enabled
- Fullscreen API support
- WebSockets support (for real-time features)
- LocalStorage support

### Device Requirements
- Minimum screen size: 768px width (tablet)
- Recommended: 1024px width (desktop)
- Touch support for mobile (planned)
- Camera/microphone for speaking sections

### Responsive Design Strategy
- Mobile-first approach (planned)
- Breakpoints: 640px, 768px, 1024px, 1280px
- Fluid typography using Tailwind
- Adaptive layouts
- Touch-friendly target sizes (44px minimum)

---

## Troubleshooting Guide

### Common Issues

#### Development Server Won't Start
**Problem**: `npm run dev` fails
**Solutions**:
- Check if port 3000 is available
- Clear node_modules and reinstall: `rm -rf node_modules && npm install`
- Check Node.js version: `node --version` (requires 18+)
- Check for syntax errors in configuration files

#### Type Checking Errors
**Problem**: `npm run typecheck` fails
**Solutions**:
- Run `npm run lint:fix` to auto-fix issues
- Check for missing type definitions
- Verify imports are correct
- Check for circular dependencies

#### Test Failures
**Problem**: Unit or E2E tests failing
**Solutions**:
- Check if dependencies are installed
- Clear test cache: `rm -rf vitest cache`
- Run tests in debug mode: `npm run test:ui` or `npm run playwright:debug`
- Check for flaky tests (timing issues)
- Verify test environment configuration

#### Build Errors
**Problem**: `npm run build` fails
**Solutions**:
- Run typecheck first: `npm run typecheck`
- Check for missing dependencies
- Verify environment variables
- Check for circular imports
- Review build logs for specific errors

#### API Connection Issues
**Problem**: API requests failing
**Solutions**:
- Check API base URL in .env
- Verify backend server is running
- Check network connectivity
- Review browser console for CORS errors
- Check API client configuration

### Debugging Tips

#### Browser DevTools
- Use React DevTools for component inspection
- Use Redux DevTools for Zustand state
- Check Network tab for API requests
- Use Performance tab for profiling
- Console logging with proper levels

#### VS Code Debugging
- Set breakpoints in TypeScript files
- Use launch configuration for debugging
- Check variables in debug panel
- Step through code execution

#### Logging
- Add console.log for temporary debugging
- Use error logger for production issues
- Check audit logs for compliance events
- Review performance metrics

---

## Glossary

### Domain Terms

- **Exam Entity**: The authoritative metadata record for an exam (title, status, owner, version pointers)
- **Exam Version**: A snapshot of exam content at a point in time (immutable once published)
- **Draft**: Unpublished version of an exam that can be edited
- **Published**: Immutable version available for scheduling and delivery
- **Clone**: Creating a new exam entity from an existing one (starts at version 1)
- **Restore**: Creating a new draft from an old version (non-destructive rollback)
- **Republish**: Creating a new published version from an existing version
- **Audit Timeline**: Chronological log of all changes to an exam
- **Integrity Flag**: Marker for suspicious student behavior during exam
- **Session**: Active student exam instance with state tracking
- **Schedule**: Planned exam session with assigned students
- **Attempt**: Student's answers and progress for a specific exam
- **Stimulus**: Content material for questions (passages, images, audio)
- **Module**: IELTS test section (Reading, Writing, Listening, Speaking)
- **Question Block**: Container for one or more related questions

### Technical Terms

- **Route-driven architecture**: Application behavior defined at route level
- **Service layer pattern**: Business logic encapsulated in services
- **Repository**: Data access layer for persistence operations
- **Feature hook**: Custom hook that orchestrates route behavior
- **Zustand**: Lightweight state management library
- **React Query**: Server state management and caching
- **Virtualization**: Rendering only visible items in large lists
- **Code splitting**: Loading code chunks on demand
- **Optimistic update**: Updating UI before server confirmation
- **Stale-while-revalidate**: Serving cached data while refreshing
- **Abort signal**: Mechanism to cancel async operations
- **Interceptor**: Middleware for request/response processing
- **Audit log**: Immutable record of system events
- **Non-destructive**: Operations that don't modify existing data

### Role Definitions

- **Admin**: User who creates and manages exams
- **Builder**: Admin role focused on exam content creation
- **Proctor**: User who monitors live exam sessions
- **Student**: User who takes exams
- **Reviewer**: User who reviews and approves exam content
- **Owner**: User who created an exam (has special permissions)

---

## Future Enhancements

### Planned Features
- Enhanced analytics dashboard for admins
- Advanced proctoring with AI-powered integrity monitoring
- Mobile-responsive student interface
- Offline mode support for student exams
- Collaborative exam building for multiple admins
- Advanced reporting and export capabilities

### Technical Improvements
- Complete lint compliance
- Comprehensive component test coverage
- Performance optimization for large exam datasets
- Enhanced error handling and recovery
- Improved accessibility compliance (WCAG 2.1 AA)
