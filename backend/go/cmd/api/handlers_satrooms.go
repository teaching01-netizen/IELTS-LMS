package main

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/accesslinks"
	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
	"example.com/ielts-proctoring/internal/satrooms"
)

// satRoomBody is the room-level configuration of a one-action create. It is
// the access-link create body without publishedVersionId: the server, not the
// client, chooses (reuses or seals) the release a room is pinned to.
type satRoomBody struct {
	Name             string                       `json:"name"`
	EnabledSections  []string                     `json:"enabledSections"`
	AudienceType     accesslinks.AudienceType     `json:"audienceType"`
	AudienceLabel    *string                      `json:"audienceLabel"`
	AccessMode       accesslinks.Mode             `json:"accessMode"`
	AvailabilityType accesslinks.AvailabilityType `json:"availabilityType"`
	OpensAt          *time.Time                   `json:"opensAt"`
	ClosesAt         *time.Time                   `json:"closesAt"`
	SelectedStudents []accesslinks.MemberInput    `json:"selectedStudents"`
	SatRoutePolicy   string                       `json:"satRoutePolicy"`
	SatSessionMode   string                       `json:"satSessionMode"`
}

type satRoomCreateBody struct {
	OperationKey           string      `json:"operationKey"`
	ExpectedExamRevision   *int        `json:"expectedExamRevision"`
	ExpectedDraftVersionID *string     `json:"expectedDraftVersionId"`
	ExpectedDraftRevision  *int        `json:"expectedDraftRevision"`
	Room                   satRoomBody `json:"room"`
}

func requireSatRooms(w http.ResponseWriter, r *http.Request, app *App) bool {
	if app.SatRooms == nil || app.Exams == nil {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Room service is unavailable."))
		return false
	}
	return true
}

// satRoomCreate validates the room, resolves the immutable release it delivers
// and creates the room in one transaction (POST /sat/exams/{id}/rooms).
//
// Co-editing is frozen (the same coeditPublishGuard the publish route uses)
// only when the release decision will seal a working draft; reusing an
// existing release never disturbs the editors.
func satRoomCreate(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder)
		if sess == nil {
			return
		}
		if !requireSatRooms(w, r, app) {
			return
		}
		examID := strings.TrimSpace(chi.URLParam(r, "id"))
		// Tenant scope: the exam must be readable by this actor.
		if _, err := app.Exams.GetForActor(r.Context(), actorOf(r.Context()), examID); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		var body satRoomCreateBody
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		needsSeal, err := app.SatRooms.NeedsSeal(r.Context(), examID, body.Room.EnabledSections)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		run := func(w http.ResponseWriter, r *http.Request) {
			out, err := app.SatRooms.CreateRoom(r.Context(), sess.UserID, examID, satrooms.Request{
				OperationKey:           body.OperationKey,
				ExpectedExamRevision:   body.ExpectedExamRevision,
				ExpectedDraftVersionID: body.ExpectedDraftVersionID,
				ExpectedDraftRevision:  body.ExpectedDraftRevision,
				AllowSeal:              needsSeal,
				Room: accesslinks.CreateRequest{
					Name:             body.Room.Name,
					EnabledSections:  body.Room.EnabledSections,
					AudienceType:     body.Room.AudienceType,
					AudienceLabel:    body.Room.AudienceLabel,
					AccessMode:       body.Room.AccessMode,
					AvailabilityType: body.Room.AvailabilityType,
					OpensAt:          body.Room.OpensAt,
					ClosesAt:         body.Room.ClosesAt,
					SelectedStudents: body.Room.SelectedStudents,
					SatRoutePolicy:   body.Room.SatRoutePolicy,
					SatSessionMode:   body.Room.SatSessionMode,
				},
			})
			if err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			status := http.StatusCreated
			if out.Replayed {
				status = http.StatusOK
			}
			httpx.WriteJSON(w, status, out)
		}
		if needsSeal {
			coeditPublishGuard(app, run)(w, r)
			return
		}
		run(w, r)
	}
}

// satRoomOperationGet returns the committed outcome of the caller's own
// operation key, so a client that lost the POST response can recover the room
// without guessing from names or timestamps.
func satRoomOperationGet(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder)
		if sess == nil {
			return
		}
		if !requireSatRooms(w, r, app) {
			return
		}
		out, examID, err := app.SatRooms.GetOperation(r.Context(), sess.UserID, chi.URLParam(r, "operationKey"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if _, err := app.Exams.GetForActor(r.Context(), actorOf(r.Context()), examID); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// satExamConfigDefaults publishes the blueprint-derived defaults and limits, so
// the Create exam form never hardcodes a duration, break or threshold.
func satExamConfigDefaults(_ *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder) == nil {
			return
		}
		httpx.WriteJSON(w, http.StatusOK, exams.SATConfigDefaultsPayload())
	}
}
