package main

// SAT Desmos outcome beacon (plan 2026-11-04 §4 Track B: backend burst +
// beacon). The frontend DesmosCalculator reports every bounded calculator
// load outcome here so the Math-window board and ready-rate alert observe
// real student experience instead of inferring it from 5xx rates.
//
// Contract (Track A→B, §4): POST /api/v1/sat/desmos-outcome with the
// attempt bearer; body
// {scheduleId,attemptId,moduleAttemptId,mode,outcome,durationMs,buildSHA};
// mode in scientific|graphing, outcome in ready|timeout|blocked|error.
// Errors: 400 invalid (client drops, never retries a malformed beacon),
// 429 shed from the route tier limiter (client drops, no retry storm —
// a beacon must never amplify a burst).
//
// The handler is telemetry-only and DB-free by design: it verifies the
// attempt bearer (HMAC + expiry + session touch, same read-verify as the
// other student-bearer endpoints, so a revoked/takeover-rotated bearer
// renders 401 instead of polluting the series), then records closed-
// vocabulary counters plus one structured log line. Metric labels never
// carry schedule/attempt/module ids (cardinality); those ride the log
// line, where attempt-level diagnosis is allowed. moduleAttemptId is an
// opaque log label: binding it would cost a DB read per beacon, which
// would couple telemetry availability to database health.
import (
	"log"
	"net/http"
	"strings"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
	"example.com/ielts-proctoring/internal/platform/telemetry"
)

// maxDesmosOutcomeBodyBytes bounds the beacon body: seven short fields
// fit in far less; anything larger is a malformed client.
const maxDesmosOutcomeBodyBytes = 2 << 10

// maxDesmosOutcomeDurationMs bounds durationMs: a mount that reports
// longer than one hour never resolved (stuck beacon clock), not a sample.
const maxDesmosOutcomeDurationMs = int64(3600 * 1000)

// desmosOutcomeRequest is the Track A→B beacon contract (§4). Field names
// are the exact JSON the frontend emits; DisallowUnknownFields keeps the
// contract pinned (a renamed frontend field fails loudly as 400 here,
// not silently as a dropped series).
type desmosOutcomeRequest struct {
	ScheduleID      string `json:"scheduleId"`
	AttemptID       string `json:"attemptId"`
	ModuleAttemptID string `json:"moduleAttemptId"`
	Mode            string `json:"mode"`
	Outcome         string `json:"outcome"`
	DurationMs      int64  `json:"durationMs"`
	BuildSHA        string `json:"buildSHA"`
}

// decodeDesmosOutcomeBody parses and validates one beacon (pure, unit-
// pinned): trims padding, enforces the closed mode/outcome vocabularies,
// bounds durationMs, and requires identity + build fields.
func decodeDesmosOutcomeBody(r *http.Request) (desmosOutcomeRequest, error) {
	var body desmosOutcomeRequest
	if err := httpx.DecodeLimited(r, maxDesmosOutcomeBodyBytes, &body); err != nil {
		return desmosOutcomeRequest{}, err
	}
	body.ScheduleID = strings.TrimSpace(body.ScheduleID)
	body.AttemptID = strings.TrimSpace(body.AttemptID)
	body.ModuleAttemptID = strings.TrimSpace(body.ModuleAttemptID)
	body.Mode = strings.TrimSpace(body.Mode)
	body.Outcome = strings.TrimSpace(body.Outcome)
	body.BuildSHA = strings.TrimSpace(body.BuildSHA)
	invalid := func() (desmosOutcomeRequest, error) {
		return desmosOutcomeRequest{}, apperrors.New(apperrors.CodeBadRequest, "Invalid Desmos outcome beacon.")
	}
	if body.ScheduleID == "" || body.AttemptID == "" || body.ModuleAttemptID == "" {
		return invalid()
	}
	switch body.Mode {
	case telemetry.DesmosModeScientific, telemetry.DesmosModeGraphing:
	default:
		return invalid()
	}
	switch body.Outcome {
	case telemetry.DesmosOutcomeReady, telemetry.DesmosOutcomeTimeout,
		telemetry.DesmosOutcomeBlocked, telemetry.DesmosOutcomeError:
	default:
		return invalid()
	}
	if body.DurationMs < 0 || body.DurationMs > maxDesmosOutcomeDurationMs {
		return invalid()
	}
	if body.BuildSHA == "" || len(body.BuildSHA) > 64 {
		return invalid()
	}
	return body, nil
}

// satDesmosOutcomeHandler serves POST /api/v1/sat/desmos-outcome.
func satDesmosOutcomeHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bearer, ok := requireBearer(w, r)
		if !ok {
			return
		}
		// Read-verify (HMAC + expiry + session touch): the beacon has no
		// in-tx fence, so a revoked bearer must fail closed here.
		claims, err := verifyAttemptReadBearer(app, r, bearer)
		if err != nil {
			writeAttemptVerificationError(w, r, err)
			return
		}
		body, err := decodeDesmosOutcomeBody(r)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		// Bind the beacon to its own credential: a cross-attempt body is
		// a client bug, reported as 400 (never attributed to another
		// attempt's series, never 500).
		if body.ScheduleID != claims.ScheduleID || body.AttemptID != claims.AttemptID {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeBadRequest, "Beacon identity does not match the attempt credential."))
			return
		}
		telemetry.IncCounter(telemetry.MSATDesmosOutcomeTotal, "outcome", body.Outcome, "mode", body.Mode)
		if body.Outcome == telemetry.DesmosOutcomeReady {
			telemetry.ObserveSeconds(telemetry.MSATDesmosReadySeconds, float64(body.DurationMs)/1000, "mode", body.Mode)
		}
		log.Printf(`{"level":"info","msg":"sat desmos outcome","schedule_id":%q,"attempt_id":%q,"module_attempt_id":%q,"mode":%q,"outcome":%q,"duration_ms":%d,"build_sha":%q}`,
			body.ScheduleID, body.AttemptID, body.ModuleAttemptID, body.Mode, body.Outcome, body.DurationMs, body.BuildSHA)
		w.Header().Set("Cache-Control", "no-store")
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}
