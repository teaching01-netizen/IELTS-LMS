package authz

// Auth + public routes (all annotated via route()).
// readStaff/writeStaff are defined once in authz.go and shared with
// table_staff.go and table_fullpath.go.
func init() {
	for k, v := range map[string]Policy{
		"GET /session":                  {MinRoles: []string{}},
		"POST /logout":                  {MinRoles: []string{}},
		"POST /logout-all":              {MinRoles: []string{}},
		"POST /login":                   {Public: true},
		"POST /student/entry":           {Public: true},
		"GET /student/schedules/{id}":   {Public: true},
		"POST /activate":                {Public: true},
		"POST /password/reset-request":  {Public: true},
		"POST /password/reset-complete": {Public: true},
		"POST /public/access-links/{linkID}/resolve-entry": {Public: true},
		"GET /public/access-links/{linkID}":                {Public: true},
	} {
		Table[k] = v
	}
}
