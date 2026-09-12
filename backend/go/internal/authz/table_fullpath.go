package authz

// Full-path keys for registrations that bypass httpx.WithRoute (no
// CtxRouteTemplate): probes, the release-state .Get, and the chained
// authoring verbs (.Get/.Post/.Patch/.Delete). Resolved by path-match
// (LookupFullPath) when no template annotation is present.
func init() {
	for k, v := range map[string]Policy{
		"GET /healthz": {Public: true},
		"GET /readyz":  {Public: true},
		// /metrics has its own bearer/token gate inside metricsHandler
		// (METRICS_PUBLIC or METRICS_TOKEN); the authz layer passes through.
		"GET /metrics": {Public: true},
		// release-state GET (admin/observer/builder read).
		"GET /api/v1/assessment-release/exams/{examID}": {MinRoles: readStaff},
		// authoring reads (admin/observer/builder) vs writes
		// (admin/builder). authorValidateHandler gates READ
		// (requireAuthoringExamRead).
		"GET /api/v1/assessment-authoring/exams/{examID}/shell":                                    {MinRoles: readStaff},
		"POST /api/v1/assessment-authoring/exams/{examID}/shell":                                   {MinRoles: writeStaff},
		"GET /api/v1/assessment-authoring/exams/{examID}/preview":                                  {MinRoles: readStaff},
		"POST /api/v1/assessment-authoring/exams/{examID}/load-sample":                             {MinRoles: writeStaff},
		"GET /api/v1/assessment-authoring/exams/{examID}/sat-workbook-template":                    {MinRoles: readStaff},
		"POST /api/v1/assessment-authoring/exams/{examID}/sat-workbook-preview":                    {MinRoles: writeStaff},
		"POST /api/v1/assessment-authoring/exams/{examID}/sat-workbook-commit":                     {MinRoles: writeStaff},
		"GET /api/v1/assessment-authoring/exams/{examID}/sat-workbook-undo":                        {MinRoles: readStaff},
		"POST /api/v1/assessment-authoring/exams/{examID}/sat-workbook-imports/{importID}/undo":    {MinRoles: writeStaff},
		"GET /api/v1/assessment-authoring/modules/{moduleID}/questions":                            {MinRoles: readStaff},
		"POST /api/v1/assessment-authoring/modules/{moduleID}/questions":                           {MinRoles: writeStaff},
		"POST /api/v1/assessment-authoring/modules/{moduleID}/questions/batch":                     {MinRoles: writeStaff},
		"PATCH /api/v1/assessment-authoring/modules/{moduleID}/question-order":                     {MinRoles: writeStaff},
		"GET /api/v1/assessment-authoring/exam-questions/{examQuestionID}":                         {MinRoles: readStaff},
		"PATCH /api/v1/assessment-authoring/exam-questions/{examQuestionID}":                       {MinRoles: writeStaff},
		"DELETE /api/v1/assessment-authoring/exam-questions/{examQuestionID}":                      {MinRoles: writeStaff},
		"POST /api/v1/assessment-authoring/exam-questions/{examQuestionID}/duplicate":              {MinRoles: writeStaff},
		"POST /api/v1/assessment-authoring/questions/bulk":                                         {MinRoles: writeStaff},
		"PATCH /api/v1/assessment-authoring/question-revisions/{revisionID}":                       {MinRoles: writeStaff},
		"PATCH /api/v1/assessment-authoring/exams/{examID}/sections/{sectionID}/delivery-settings": {MinRoles: writeStaff},
		"POST /api/v1/assessment-authoring/exams/{examID}/validate":                                {MinRoles: readStaff},
	} {
		fullPathTable[k] = v
	}
}
