package authz

// Exams, access-links, versions, schedules, proctor, library, settings,
// grading, results, media, answer-history, ws-live, delivery, student
// sessions, V2 (all annotated via route(), mount-relative keys).
func init() {
	proctorRW := []string{RoleAdmin, RoleProctor}
	proctorRead := []string{RoleAdmin, RoleAdminObserver, RoleProctor}
	graderRW := []string{RoleAdmin, RoleGrader}
	graderRead := []string{RoleAdmin, RoleAdminObserver, RoleGrader}
	resultsRW := []string{RoleAdmin, RoleGrader, RoleProctor}
	resultsRead := []string{RoleAdmin, RoleAdminObserver, RoleGrader, RoleProctor}
	mediaWrite := []string{RoleAdmin, RoleBuilder, RoleProctor, RoleGrader, RoleStudent}
	for k, v := range map[string]Policy{
		// "GET /" is shared by exams-list (readStaff), schedules-list
		// (admin/builder) and results-list (admin/grader/proctor): the
		// middleware admits the UNION; each handler enforces its own
		// narrower gate second (behavior preserved, deny-closed).
		"GET /": {
			MinRoles: []string{RoleAdmin, RoleAdminObserver, RoleBuilder, RoleGrader, RoleProctor},
		},
		// "POST /" is shared by exams-create and schedules-create
		// (both admin/builder).
		"POST /":    {MinRoles: writeStaff},
		"GET /{id}": {MinRoles: readStaff},
		// "PATCH /{id}" is shared by exams-update (admin/builder) and
		// schedules-update (admin ONLY in-handler): the middleware
		// admits admin+builder and the schedules handler narrows.
		"PATCH /{id}":  {MinRoles: writeStaff},
		"DELETE /{id}": {MinRoles: writeStaff},
		// exams draft/publish lifecycle (admin/builder write).
		"PATCH /{id}/draft":          {MinRoles: writeStaff},
		"POST /{id}/draft/reopen":    {MinRoles: writeStaff},
		"POST /{id}/publish":         {MinRoles: writeStaff},
		"GET /{id}/events":           {MinRoles: readStaff},
		"GET /{id}/validation":       {MinRoles: readStaff},
		"GET /{id}/versions":         {MinRoles: readStaff},
		"GET /{id}/versions/summary": {MinRoles: readStaff},
		// schedules runtime: proctor/grader collapse to assignment
		// scope in-handler (proctorHasLiveAssignment /
		// authorizeScheduleForActor + requireGraderSchedule).
		"GET /{id}/runtime": {
			MinRoles: []string{RoleAdmin, RoleAdminObserver, RoleBuilder, RoleProctor, RoleGrader},
			Scope:    ScopeAssignedSchedule,
		},
		"POST /{id}/runtime/commands": {
			MinRoles: []string{RoleAdmin, RoleBuilder, RoleProctor},
			Scope:    ScopeAssignedSchedule,
		},
		// schedules register: any authenticated session (requireSession).
		// schedules GET /{id}: admin/builder + preview-scope narrowing
		// in-handler (authorizeScheduleForActor).
		// schedules GET /{id} shares the "GET /{id}" key above
		// (admin/builder + preview-scope narrowing in-handler via
		// authorizeScheduleForActor); exams readers are a superset so
		// the union key above is exact for both.
		"POST /{id}/register": {MinRoles: []string{}},
		// assessment-access overview/links.
		"GET /exams/{examID}/overview":   {MinRoles: readStaff},
		"GET /exams/{examID}/links":      {MinRoles: readStaff},
		"POST /exams/{examID}/links":     {MinRoles: writeStaff},
		"GET /links/{linkID}":            {MinRoles: readStaff},
		"PATCH /links/{linkID}":          {MinRoles: writeStaff},
		"POST /links/{linkID}/lifecycle": {MinRoles: writeStaff},
		"DELETE /links/{linkID}":         {MinRoles: writeStaff},
		"POST /links/{linkID}/duplicate": {MinRoles: writeStaff},
		"GET /links/{linkID}/members":    {MinRoles: readStaff},
		"GET /links/{linkID}/activity":   {MinRoles: readStaff},
		"GET /versions/{versionID}":      {MinRoles: readStaff},
		// assessment-delivery: attempt bearer credential (handler).
		"POST /schedules/{scheduleID}/bootstrap":                   {Bearer: true, Scope: ScopeAttemptOwner},
		"PATCH /schedules/{scheduleID}/responses/{examQuestionID}": {Bearer: true, Scope: ScopeAttemptOwner},
		"POST /schedules/{scheduleID}/modules/start":               {Bearer: true, Scope: ScopeAttemptOwner},
		"POST /schedules/{scheduleID}/modules/enter":               {Bearer: true, Scope: ScopeAttemptOwner},
		"POST /schedules/{scheduleID}/modules/visible":             {Bearer: true, Scope: ScopeAttemptOwner},
		"POST /schedules/{scheduleID}/breaks/{breakID}/start":      {Bearer: true, Scope: ScopeAttemptOwner},
		"POST /schedules/{scheduleID}/breaks/enter":                {Bearer: true, Scope: ScopeAttemptOwner},
		"POST /schedules/{scheduleID}/breaks/visible":              {Bearer: true, Scope: ScopeAttemptOwner},
		"POST /schedules/{scheduleID}/modules/submit":              {Bearer: true, Scope: ScopeAttemptOwner},
		"POST /schedules/{scheduleID}/submit":                      {Bearer: true, Scope: ScopeAttemptOwner},
		// student sessions: session-or-bearer STUDENT paths (handler:
		// requireV1StudentIdentity / requireStudentDeps + resolve check).
		"GET /{scheduleID}":            {Bearer: true, Scope: ScopeAttemptOwner},
		"GET /{scheduleID}/static":     {Bearer: true, Scope: ScopeAttemptOwner},
		"POST /{scheduleID}/precheck":  {Bearer: true, Scope: ScopeAttemptOwner},
		"POST /{scheduleID}/bootstrap": {Bearer: true, Scope: ScopeAttemptOwner},
		"GET /{scheduleID}/live":       {Bearer: true, Scope: ScopeAttemptOwner},
		"GET /{scheduleID}/runtime":    {Bearer: true, Scope: ScopeAttemptOwner},
		"POST /{scheduleID}/heartbeat": {Bearer: true, Scope: ScopeAttemptOwner},
		// mutations:batch + submit are registered via r.Method with an
		// absolute-ish annotated template ("POST /{scheduleID}/..."):
		// these verbatim keys let CtxRouteTemplate resolve.
		"POST /{scheduleID}/mutations:batch": {Bearer: true, Scope: ScopeAttemptOwner},
		"POST /{scheduleID}/audit":           {Bearer: true, Scope: ScopeAttemptOwner},
		"POST /{scheduleID}/submit":          {Bearer: true, Scope: ScopeAttemptOwner},
		// proctor sessions/notes/rules/controls. NOTE: "GET /sessions"
		// is shared by proctor-sessions (admin/observer/proctor) and
		// grading-sessions (admin/observer/grader): this single entry
		// admits the UNION; each handler collapses its own role to
		// assignment scope second (behavior preserved, deny-closed).
		"GET /sessions": {
			MinRoles: []string{RoleAdmin, RoleAdminObserver, RoleProctor, RoleGrader},
			Scope:    ScopeAssignedSchedule,
		},
		"GET /sessions/{scheduleID}": {
			MinRoles: proctorRead, Scope: ScopeAssignedSchedule,
		},
		"GET /sessions/{scheduleID}/roster": {
			MinRoles: proctorRead, Scope: ScopeAssignedSchedule,
		},
		"GET /notes":                                             {MinRoles: proctorRead},
		"DELETE /notes/{noteID}":                                 {MinRoles: proctorRW},
		"GET /sessions/{scheduleID}/notes":                       {MinRoles: proctorRW},
		"POST /sessions/{scheduleID}/notes":                      {MinRoles: proctorRW},
		"PUT /sessions/{scheduleID}/notes/{noteID}":              {MinRoles: proctorRW},
		"PATCH /sessions/{scheduleID}/notes/{noteID}":            {MinRoles: proctorRW},
		"DELETE /sessions/{scheduleID}/notes/{noteID}":           {MinRoles: proctorRW},
		"GET /sessions/{scheduleID}/violation-rules":             {MinRoles: proctorRW},
		"DELETE /violation-rules/{ruleID}":                       {MinRoles: proctorRW},
		"POST /sessions/{scheduleID}/violation-rules":            {MinRoles: proctorRW},
		"PUT /sessions/{scheduleID}/violation-rules/{ruleID}":    {MinRoles: proctorRW},
		"PATCH /sessions/{scheduleID}/violation-rules/{ruleID}":  {MinRoles: proctorRW},
		"DELETE /sessions/{scheduleID}/violation-rules/{ruleID}": {MinRoles: proctorRW},
		"POST /sessions/{scheduleID}/presence":                   {MinRoles: proctorRW},
		// end-section admits builders for the isolated preview schedule
		// (handler: requirePreviewSectionDeps).
		"POST /sessions/{scheduleID}/control/end-section-now": {MinRoles: []string{RoleAdmin, RoleBuilder, RoleProctor}},
		"POST /sessions/{scheduleID}/control/extend-section":  {MinRoles: proctorRW},
		"POST /sessions/{scheduleID}/control/complete-exam":   {MinRoles: proctorRW},
		// Per-attempt commands: handler second layer checks
		// proctorHasLiveAssignment for RoleProctor (404-collapse).
		"POST /sessions/{scheduleID}/attempts/{attemptID}/warn":      {MinRoles: proctorRW, Scope: ScopeAssignedSchedule},
		"POST /sessions/{scheduleID}/attempts/{attemptID}/pause":     {MinRoles: proctorRW, Scope: ScopeAssignedSchedule},
		"POST /sessions/{scheduleID}/attempts/{attemptID}/resume":    {MinRoles: proctorRW, Scope: ScopeAssignedSchedule},
		"POST /sessions/{scheduleID}/attempts/{attemptID}/extend":    {MinRoles: proctorRW, Scope: ScopeAssignedSchedule},
		"POST /sessions/{scheduleID}/attempts/{attemptID}/rearm":     {MinRoles: proctorRW, Scope: ScopeAssignedSchedule},
		"POST /sessions/{scheduleID}/attempts/{attemptID}/terminate": {MinRoles: proctorRW, Scope: ScopeAssignedSchedule},
		"POST /alerts/{alertID}/ack":                                 {MinRoles: proctorRW},
		"GET /live-mode":                                             {MinRoles: proctorRead},
		// library passages/questions.
		"GET /passages":                         {MinRoles: readStaff},
		"POST /passages":                        {MinRoles: writeStaff},
		"GET /passages/{id}":                    {MinRoles: readStaff},
		"PATCH /passages/{id}":                  {MinRoles: writeStaff},
		"DELETE /passages/{id}":                 {MinRoles: writeStaff},
		"POST /passages/{id}/increment-usage":   {MinRoles: writeStaff},
		"PATCH /passages/{id}/increment-usage":  {MinRoles: writeStaff},
		"GET /questions":                        {MinRoles: readStaff},
		"POST /questions":                       {MinRoles: writeStaff},
		"GET /questions/{id}":                   {MinRoles: readStaff},
		"PATCH /questions/{id}":                 {MinRoles: writeStaff},
		"DELETE /questions/{id}":                {MinRoles: writeStaff},
		"POST /questions/{id}/increment-usage":  {MinRoles: writeStaff},
		"PATCH /questions/{id}/increment-usage": {MinRoles: writeStaff},
		// settings.
		"GET /exam-defaults": {MinRoles: readStaff},
		"PUT /exam-defaults": {MinRoles: writeStaff},
		"GET /export-profiles": {
			MinRoles: []string{RoleAdmin, RoleAdminObserver, RoleBuilder, RoleGrader},
		},
		"POST /export-profiles": {
			MinRoles: []string{RoleAdmin, RoleBuilder, RoleGrader},
		},
		// grading session detail: graders collapse to assignment scope
		// in-handler (gradingAssignedScheduleIDs).
		"GET /sessions/{sessionID}": {
			MinRoles: graderRead, Scope: ScopeAssignedSchedule,
		},
		"GET /schedules/{scheduleID}/objective-overrides":                 {MinRoles: graderRW, Scope: ScopeAssignedSchedule},
		"GET /schedules/{scheduleID}/objective-grading-source":            {MinRoles: graderRW, Scope: ScopeAssignedSchedule},
		"GET /schedules/{scheduleID}/objective-integrity":                 {MinRoles: graderRW, Scope: ScopeAssignedSchedule},
		"PUT /schedules/{scheduleID}/objective-overrides/{questionID}":    {MinRoles: graderRW, Scope: ScopeAssignedSchedule},
		"DELETE /schedules/{scheduleID}/objective-overrides/{questionID}": {MinRoles: graderRW, Scope: ScopeAssignedSchedule},
		"POST /schedules/{scheduleID}/objective-regrade-latest-draft":     {MinRoles: graderRW, Scope: ScopeAssignedSchedule},
		"GET /submissions/{submissionID}":                                 {MinRoles: graderRW, Scope: ScopeAssignedSchedule},
		"GET /submissions/{submissionID}/sections":                        {MinRoles: graderRW, Scope: ScopeAssignedSchedule},
		"PUT /submissions/{submissionID}/sections/{section}/questions/{questionID}/override": {
			MinRoles: graderRW, Scope: ScopeAssignedSchedule,
		},
		"GET /submissions/{submissionID}/writing-tasks": {MinRoles: graderRW, Scope: ScopeAssignedSchedule},
		"POST /submissions/{submissionID}/start-review": {MinRoles: graderRW, Scope: ScopeAssignedSchedule},
		"GET /submissions/{submissionID}/review-draft":  {MinRoles: graderRW, Scope: ScopeAssignedSchedule},
		// Draft writes + release lifecycle are admin ONLY (verified).
		"PUT /submissions/{submissionID}/review-draft":           {MinRoles: []string{RoleAdmin}},
		"POST /submissions/{submissionID}/mark-grading-complete": {MinRoles: []string{RoleAdmin}},
		"POST /submissions/{submissionID}/mark-ready-to-release": {MinRoles: []string{RoleAdmin}},
		"POST /submissions/{submissionID}/release-now":           {MinRoles: []string{RoleAdmin}},
		"POST /submissions/{submissionID}/schedule-release":      {MinRoles: []string{RoleAdmin}},
		"POST /submissions/{submissionID}/reopen-review":         {MinRoles: []string{RoleAdmin}},
		"GET /results/{resultID}/events":                         {MinRoles: graderRW},
		// results. NOTE: authoring sat-workbook preview/commit go through
		// route() (annotated, mount-relative) — see BuildRouter lines
		// 414-415 — so they need annotated keys here IN ADDITION to the
		// full-path keys in table_fullpath.go.
		"POST /exams/{examID}/sat-workbook-preview": {MinRoles: writeStaff},
		"POST /exams/{examID}/sat-workbook-commit":  {MinRoles: writeStaff},
		"GET /dashboard":               {MinRoles: resultsRead},
		"GET /analytics":               {MinRoles: resultsRead},
		"POST /export":                 {MinRoles: resultsRW},
		"GET /sat":                     {MinRoles: resultsRW},
		"GET /sat/{resultID}":          {MinRoles: resultsRW},
		"GET /act-science":             {MinRoles: resultsRW},
		"GET /act-science/{attemptID}": {MinRoles: resultsRW},
		"GET /{resultID}/events":       {MinRoles: resultsRW},
		// resultsGetHandler: any authenticated session may call;
		// students see only their own result (handler SelfOnly-ish
		// switch denies observer/builder there).
		"GET /{resultID}": {MinRoles: AllRoles, Scope: ScopeSelfOnly},
		// media.
		"POST /uploads":                    {MinRoles: mediaWrite},
		"POST /import-url":                 {MinRoles: mediaWrite},
		"PUT /uploads/{assetID}":           {MinRoles: mediaWrite},
		"POST /uploads/{assetID}/complete": {MinRoles: mediaWrite},
		"GET /assets/{assetID}":            {MinRoles: AllRoles},
		"GET /{assetID}/content":           {MinRoles: AllRoles},
		"GET /{assetID}":                   {MinRoles: AllRoles},
		// answer-history.
		"GET /submissions/{submissionID}/overview":           {MinRoles: resultsRead},
		"GET /submissions/{submissionID}/targets/{targetID}": {MinRoles: resultsRead},
		"GET /submissions/{submissionID}/export":             {MinRoles: resultsRead},
		"GET /attempts/{attemptID}/overview":                 {MinRoles: resultsRead},
		"GET /attempts/{attemptID}/targets/{targetID}":       {MinRoles: resultsRead},
		// ws-live: any authenticated session (topic checks in-handler).
		"GET /ws/live": {MinRoles: []string{}},
		// ws-authoring: the authoring read set may subscribe; the handler
		// re-verifies tenant scope + the current draft before upgrading.
		// Registered through authzRoute, so the key is the STRIPPED pattern:
		// a full-path key here silently denies every handshake (403).
		"GET /ws/authoring": {MinRoles: readStaff},
		// V2: attempt bearer credential (handler).
		"POST /{attemptID}/responses:batch": {Bearer: true, Scope: ScopeAttemptOwner},
		"POST /{attemptID}/submit":          {Bearer: true, Scope: ScopeAttemptOwner},
		"POST /{attemptID}/takeover":        {Bearer: true, Scope: ScopeAttemptOwner},
		"GET /{attemptID}/responses":        {Bearer: true, Scope: ScopeAttemptOwner},
	} {
		Table[k] = v
	}
}
