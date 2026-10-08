package main

import (
 "net/http"
 "strconv"

 "example.com/ielts-proctoring/internal/platform/apperrors"
 "example.com/ielts-proctoring/internal/platform/httpx"
 "example.com/ielts-proctoring/internal/proctor"
 "github.com/go-chi/chi/v5"
)

func proctorLateEvidenceHandler(app *App) http.HandlerFunc {
 return func(w http.ResponseWriter,r *http.Request) {
  _,actor:=requireProctorDeps(w,r,app);if actor==nil {return}
  limit:=0
  if raw:=r.URL.Query().Get("limit");raw!="" {
   parsed,err:=strconv.Atoi(raw)
   if err!=nil {httpx.WriteError(w,r,apperrors.New(apperrors.CodeValidation,"Evidence page size must be an integer."));return}
   limit=parsed
  }
  page,err:=app.Proctor.ListLateEvidence(r.Context(),*actor,chi.URLParam(r,"scheduleID"),chi.URLParam(r,"attemptID"),r.URL.Query().Get("cursor"),limit)
  if err!=nil {httpx.WriteError(w,r,MapDBError(err));return}
  httpx.WriteJSON(w,http.StatusOK,page)
 }
}

func proctorReviewLateEvidenceHandler(app *App) http.HandlerFunc {
 return func(w http.ResponseWriter,r *http.Request) {
  _,actor:=requireProctorDeps(w,r,app);if actor==nil {return}
  var req proctor.LateEvidenceReviewRequest
  if err:=httpx.DecodeLimited(r,httpx.MaxAdminBodyBytes,&req);err!=nil {httpx.WriteError(w,r,err);return}
  if err:=app.Proctor.ReviewLateEvidence(r.Context(),*actor,chi.URLParam(r,"scheduleID"),chi.URLParam(r,"attemptID"),req);err!=nil {httpx.WriteError(w,r,MapDBError(err));return}
  httpx.WriteJSON(w,http.StatusOK,map[string]any{"ok":true})
 }
}
