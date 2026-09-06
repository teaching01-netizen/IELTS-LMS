package main

import (
	"database/sql"
	"net/http"
	"strings"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
)

// Authoring routes mirror the Rust resource policy: staff readers may inspect
// an exam, while only admins/builders may mutate content. Every helper also
// resolves the resource back to its exam so builder tenant scope is enforced
// before the underlying authoring service runs.
func requireAuthoringExamRead(app *App, w http.ResponseWriter, r *http.Request, examID string) *auth.Session {
	return requireAuthoringExam(app, w, r, examID, false)
}

func requireAuthoringExamWrite(app *App, w http.ResponseWriter, r *http.Request, examID string) *auth.Session {
	return requireAuthoringExam(app, w, r, examID, true)
}

func requireAuthoringExam(app *App, w http.ResponseWriter, r *http.Request, examID string, write bool) *auth.Session {
	roles := []string{auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleBuilder}
	if write {
		roles = []string{auth.RoleAdmin, auth.RoleBuilder}
	}
	sess := requireRole(w, r, roles...)
	if sess == nil {
		return nil
	}
	if app.Exams == nil {
		httpxWriteAuthoringError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Exam service is unavailable."))
		return nil
	}
	if _, err := app.Exams.GetForActor(r.Context(), actorOf(r.Context()), strings.TrimSpace(examID)); err != nil {
		httpxWriteAuthoringError(w, r, err)
		return nil
	}
	return sess
}

func requireAuthoringModuleRead(app *App, w http.ResponseWriter, r *http.Request, moduleID string) *auth.Session {
	return requireAuthoringResource(app, w, r, moduleID, false, "Assessment module not found.", `SELECT v.exam_id FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id JOIN exam_versions v ON v.id = s.exam_version_id WHERE m.id = ?`)
}

func requireAuthoringModuleWrite(app *App, w http.ResponseWriter, r *http.Request, moduleID string) *auth.Session {
	return requireAuthoringResource(app, w, r, moduleID, true, "Assessment module not found.", `SELECT v.exam_id FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id JOIN exam_versions v ON v.id = s.exam_version_id WHERE m.id = ?`)
}

func requireAuthoringQuestionRead(app *App, w http.ResponseWriter, r *http.Request, questionID string) *auth.Session {
	return requireAuthoringResource(app, w, r, questionID, false, "Assessment question not found.", `SELECT v.exam_id FROM assessment_exam_questions eq JOIN assessment_modules m ON m.id = eq.module_id JOIN assessment_sections s ON s.id = m.section_id JOIN exam_versions v ON v.id = s.exam_version_id WHERE eq.id = ?`)
}

func requireAuthoringQuestionWrite(app *App, w http.ResponseWriter, r *http.Request, questionID string) *auth.Session {
	return requireAuthoringResource(app, w, r, questionID, true, "Assessment question not found.", `SELECT v.exam_id FROM assessment_exam_questions eq JOIN assessment_modules m ON m.id = eq.module_id JOIN assessment_sections s ON s.id = m.section_id JOIN exam_versions v ON v.id = s.exam_version_id WHERE eq.id = ?`)
}

func requireAuthoringRevisionWrite(app *App, w http.ResponseWriter, r *http.Request, revisionID string) *auth.Session {
	return requireAuthoringResource(app, w, r, revisionID, true, "Question revision not found.", `SELECT v.exam_id FROM assessment_question_revisions qr JOIN assessment_exam_questions eq ON eq.question_revision_id = qr.id JOIN assessment_modules m ON m.id = eq.module_id JOIN assessment_sections s ON s.id = m.section_id JOIN exam_versions v ON v.id = s.exam_version_id WHERE qr.id = ?`)
}

func requireAuthoringSectionWrite(app *App, w http.ResponseWriter, r *http.Request, examID, sectionID string) *auth.Session {
	sess := requireAuthoringExamWrite(app, w, r, examID)
	if sess == nil {
		return nil
	}
	var foundExamID string
	err := app.DB.QueryRowContext(r.Context(), `SELECT v.exam_id FROM assessment_sections s JOIN exam_versions v ON v.id = s.exam_version_id WHERE s.id = ? AND v.exam_id = ?`, sectionID, examID).Scan(&foundExamID)
	if err == sql.ErrNoRows {
		httpxWriteAuthoringError(w, r, apperrors.New(apperrors.CodeNotFound, "Assessment section not found."))
		return nil
	}
	if err != nil {
		httpxWriteAuthoringError(w, r, err)
		return nil
	}
	return sess
}

func requireAuthoringResource(app *App, w http.ResponseWriter, r *http.Request, resourceID string, write bool, notFoundMessage, query string) *auth.Session {
	roles := []string{auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleBuilder}
	if write {
		roles = []string{auth.RoleAdmin, auth.RoleBuilder}
	}
	sess := requireRole(w, r, roles...)
	if sess == nil {
		return nil
	}
	if app.DB == nil || app.Exams == nil {
		httpxWriteAuthoringError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring dependencies are unavailable."))
		return nil
	}
	var examID string
	if err := app.DB.QueryRowContext(r.Context(), query, strings.TrimSpace(resourceID)).Scan(&examID); err != nil {
		if err == sql.ErrNoRows {
			httpxWriteAuthoringError(w, r, apperrors.New(apperrors.CodeNotFound, notFoundMessage))
		} else {
			httpxWriteAuthoringError(w, r, err)
		}
		return nil
	}
	if _, err := app.Exams.GetForActor(r.Context(), actorOf(r.Context()), examID); err != nil {
		httpxWriteAuthoringError(w, r, err)
		return nil
	}
	return sess
}

// httpxWriteAuthoringError is kept as a tiny indirection so all helpers use
// the same stable API error envelope without importing handler details into
// the authoring service package.
func httpxWriteAuthoringError(w http.ResponseWriter, r *http.Request, err error) {
	// This function is replaced below by the package's normal response writer;
	// keeping the call site uniform makes authorization helpers easy to audit.
	httpx.WriteError(w, r, err)
}
