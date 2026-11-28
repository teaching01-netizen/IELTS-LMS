package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/authoring"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
	"github.com/go-chi/chi/v5"
)

func wordVaultHandler(app *App, action string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "private, no-store")
		write := action == "preview" || action == "commit"
		roles := []string{auth.RoleAdmin, auth.RoleBuilder}
		if !write {
			roles = append(roles, auth.RoleAdminObserver)
		}
		sess := requireRole(w, r, roles...)
		if sess == nil {
			return
		}
		if app.Exams == nil || app.Authoring == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring service is unavailable."))
			return
		}
		examID := chi.URLParam(r, "examID")
		exam, err := app.Exams.GetForActor(r.Context(), actorOf(r.Context()), examID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if exam.ProviderKey != "sat" {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "SAT exam not found."))
			return
		}
		if write && !exam.CanEdit {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeForbidden, "You cannot edit this SAT exam."))
			return
		}
		switch action {
		case "status":
			result, err := app.Authoring.WordVaultStatus(r.Context(), examID)
			writeWordVaultResult(w, r, result, err)
		case "template":
			data, err := authoring.WordVaultTemplate()
			if err != nil {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeInternal, "Could not create the vocabulary template."))
				return
			}
			w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
			w.Header().Set("Content-Disposition", `attachment; filename="SAT-Vocabulary-Template.xlsx"`)
			_, _ = w.Write(data)
		default:
			r.Body = http.MaxBytesReader(w, r.Body, authoring.MaxWordVaultBytes+(64<<10))
			if err := r.ParseMultipartForm(authoring.MaxWordVaultBytes + (64 << 10)); err != nil {
				var maxErr *http.MaxBytesError
				if errors.As(err, &maxErr) {
					writeWordVaultResult(w, r, nil, &authoring.WorkbookError{TooLarge: true, Message: "Vocabulary workbooks must be 2 MB or smaller."})
					return
				}
				writeWordVaultResult(w, r, nil, &authoring.WorkbookError{Message: "Upload a readable vocabulary .xlsx workbook."})
				return
			}
			defer r.MultipartForm.RemoveAll()
			file, header, err := r.FormFile("file")
			if err != nil {
				writeWordVaultResult(w, r, nil, &authoring.WorkbookError{Message: "Choose a vocabulary .xlsx workbook."})
				return
			}
			defer file.Close()
			if !strings.HasSuffix(strings.ToLower(header.Filename), ".xlsx") {
				writeWordVaultResult(w, r, nil, &authoring.WorkbookError{Message: "Choose a vocabulary .xlsx workbook."})
				return
			}
			data, err := io.ReadAll(io.LimitReader(file, authoring.MaxWordVaultBytes+1))
			if err != nil {
				writeWordVaultResult(w, r, nil, &authoring.WorkbookError{Message: "The vocabulary workbook could not be read."})
				return
			}
			if len(data) > authoring.MaxWordVaultBytes {
				writeWordVaultResult(w, r, nil, &authoring.WorkbookError{TooLarge: true, Message: "Vocabulary workbooks must be 2 MB or smaller."})
				return
			}
			if action == "preview" {
				result, err := app.Authoring.PreviewWordVaultForVersion(r.Context(), examID, r.PostFormValue("versionId"), data)
				writeWordVaultResult(w, r, result, err)
				return
			}
			var request authoring.WordVaultCommit
			if err := json.Unmarshal([]byte(r.PostFormValue("commit")), &request); err != nil {
				writeWordVaultResult(w, r, nil, &authoring.WorkbookError{Message: "Check and confirm the workbook before importing."})
				return
			}
			result, err := app.Authoring.CommitWordVault(r.Context(), examID, sess.UserID, data, request)
			writeWordVaultResult(w, r, result, err)
		}
	}
}

func writeWordVaultResult(w http.ResponseWriter, r *http.Request, result any, err error) {
	if err == nil {
		httpx.WriteJSON(w, http.StatusOK, result)
		return
	}
	var workbookErr *authoring.WorkbookError
	if errors.As(err, &workbookErr) {
		code := apperrors.CodeValidation
		if workbookErr.TooLarge {
			code = apperrors.CodePayloadTooLarge
		}
		err = apperrors.New(code, workbookErr.Message)
	}
	httpx.WriteError(w, r, err)
}
