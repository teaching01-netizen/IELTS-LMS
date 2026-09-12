package main

import (
	"context"
	"database/sql"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/liveupdates"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/httpx"
)

const liveWebSocketInstanceID = "api"

// Plan C3: staff-conn buffers raised 4K/8K -> 16K (fewer syscalls per
// frame at staff scale; the 64K read limit + same-host origin check stay).
// Per-conn ping/lease tickers stay: with students on the poll, remaining
// staff conns are few enough that a shared wheel buys nothing.
var liveWebSocketUpgrader = websocket.Upgrader{
	ReadBufferSize:  16 * 1024,
	WriteBufferSize: 16 * 1024,
	CheckOrigin: func(r *http.Request) bool {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if origin == "" {
			return true
		}
		u, err := url.Parse(origin)
		return err == nil && u.Host != "" && strings.EqualFold(u.Host, r.Host)
	},
}

type liveWebSocketQuery struct {
	scheduleID              string
	attemptID               string
	lastSeenRuntimeRevision *int64
}

// liveForwarderEnabled reports whether the cross-instance forwarder runs:
// db mode only. Direct mode has no peers and no bus rows, so the poll loop
// stays down (zero poll SQL). Pure predicate so the posture pins in tests.
func liveForwarderEnabled(cfg config.Config) bool {
	return !cfg.IsDirect()
}

// startLiveBusForwarder fans events written by another API process into this
// process's hub. Local writers already publish after commit, so the bus query
// excludes this process's unique origin and avoids duplicate local frames.
// Under the C1 direct posture there are no peers and no bus rows: the
// forwarder stays down (zero poll SQL). Never call with direct mode.
// stopLiveForwarder halts the bus poll loop started by
// startLiveBusForwarder (idempotent; nil-safe). main() defers it after
// BuildRouter so graceful shutdown stops the ticker instead of leaking it
// until process exit; test routers each own their App so stopping is local.
func (a *App) stopLiveForwarder() {
	if a == nil {
		return
	}
	a.LiveForwardMu.Lock()
	stop := a.stopLiveForward
	a.stopLiveForward = nil
	a.LiveForwardMu.Unlock()
	if stop != nil {
		stop()
	}
}

func startLiveBusForwarder(app *App) {
	if app == nil || app.LiveBus == nil || app.LiveHub == nil || app.DB == nil {
		return
	}
	if !liveForwarderEnabled(app.Config) {
		return
	}
	app.LiveForwardOnce.Do(func() {
		ctx, cancel := context.WithCancel(context.Background())
		app.LiveForwardMu.Lock()
		app.stopLiveForward = cancel
		app.LiveForwardMu.Unlock()
		go func() {
			defer cancel()
			cursor, err := app.LiveBus.LatestSequence(ctx)
			if err != nil {
				log.Printf("api: live-update cursor initialization failed: %v", err)
				cursor = 0
			}
			interval := time.Duration(app.Config.LiveUpdatePollIntervalMs) * time.Millisecond
			if interval <= 0 {
				interval = liveupdates.PollInterval
			}
			ticker := time.NewTicker(interval)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
				}
				events, err := app.LiveBus.PollNew(ctx, cursor, liveupdates.PollLimit)
				if err != nil {
					if ctx.Err() != nil {
						return
					}
					continue
				}
				for _, event := range events {
					if event.SequenceID > cursor {
						cursor = event.SequenceID
					}
					app.LiveHub.Publish(event)
				}
			}
		}()
	})
}

// liveWebSocketHandler authenticates and authorizes the requested topic
// before upgrading, then keeps one reader and one writer on the connection.
// Topic names never grant access: schedule registrations/assignments and
// attempt ownership are checked against the session actor first.
func liveWebSocketHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireSession(w, r)
		if sess == nil {
			return
		}
		// Plan C3: retired student sockets get 410 + {use: runtime-poll}.
		// Staff WS is unaffected (proctors keep sockets). allow (default)
		// keeps dual-serve while clients migrate; ROLLBACK = allow.
		if sess.Role == auth.RoleStudent && app.Config.StudentWSGone() {
			httpx.WriteError(w, r, &apperrors.Error{
				Code:       apperrors.CodeStudentWSRetired,
				Message:    "Student WebSocket is retired; poll the versioned runtime endpoint.",
				HTTPStatus: http.StatusGone,
				Details:    map[string]any{"use": "runtime-poll"},
			})
			return
		}
		if app.DB == nil || app.LiveHub == nil || !app.wsGateReady() {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Live updates are unavailable."))
			return
		}
		query, err := parseLiveWebSocketQuery(r)
		if err != nil {
			log.Printf("api: live websocket parse failed request_id=%s err=%v", httpx.RequestIDFrom(r.Context(), r), err)
			httpx.WriteError(w, r, err)
			return
		}
		allowed, err := liveAllowedScheduleIDs(r.Context(), app.DB, sess, query)
		if err != nil {
			log.Printf("api: live websocket authorization lookup failed request_id=%s user_id=%s schedule_id=%s attempt_id=%s err=%v", httpx.RequestIDFrom(r.Context(), r), sess.UserID, query.scheduleID, query.attemptID, err)
			httpx.WriteError(w, r, err)
			return
		}
		origin := liveWebSocketInstanceID
		if app.LiveBus != nil && app.LiveBus.Origin() != "" {
			origin = app.LiveBus.Origin()
		}
		var schedulePtr *string
		if query.scheduleID != "" {
			schedulePtr = &query.scheduleID
		}
		leaseToken, admitted, err := app.acquireWSLease(r.Context(), origin, sess.UserID, schedulePtr)
		if err != nil {
			log.Printf("api: live websocket lease acquire failed request_id=%s user_id=%s schedule_id=%s err=%v", httpx.RequestIDFrom(r.Context(), r), sess.UserID, query.scheduleID, err)
			httpx.WriteError(w, r, err)
			return
		}
		if !admitted {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeLeaseAcquireFailed, "WebSocket capacity exceeded."))
			return
		}

		conn, err := liveWebSocketUpgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("api: live websocket upgrade failed request_id=%s user_id=%s schedule_id=%s err=%v", httpx.RequestIDFrom(r.Context(), r), sess.UserID, query.scheduleID, err)
			app.releaseWSLease(context.Background(), leaseToken, origin, sess.UserID)
			return
		}
		defer func() {
			app.releaseWSLease(context.Background(), leaseToken, origin, sess.UserID)
			_ = conn.Close()
		}()

		role := liveupdates.RoleProctor
		if sess.Role == auth.RoleStudent {
			role = liveupdates.RoleStudent
		} else if sess.Role == auth.RoleAdmin || sess.Role == auth.RoleAdminObserver {
			role = liveupdates.RoleAdmin
		}
		var subscribedSchedule, subscribedAttempt *string
		if query.scheduleID != "" {
			subscribedSchedule = &query.scheduleID
		}
		if query.attemptID != "" {
			subscribedAttempt = &query.attemptID
		}
		sub := app.LiveHub.Subscribe(role, subscribedSchedule, subscribedAttempt, allowed)
		defer app.LiveHub.Unsubscribe(sub)

		if err := writeLiveJSON(conn, map[string]any{
			"type":       "connected",
			"scheduleId": nullableString(query.scheduleID),
			"attemptId":  nullableString(query.attemptID),
		}); err != nil {
			return
		}
		if query.scheduleID != "" && app.Schedules != nil {
			runtime, err := app.Schedules.GetRuntime(r.Context(), query.scheduleID)
			if err == nil && runtime.Revision > runtimeRevision(query.lastSeenRuntimeRevision) {
				payload, payloadErr := loadStudentRuntimeContext(r.Context(), app.DB, query.scheduleID)
				if payloadErr != nil {
					return
				}
				if payload == nil {
					return
				}
				if err := writeLiveJSON(conn, map[string]any{
					"type":       "runtime_snapshot",
					"scheduleId": query.scheduleID,
					"runtime":    payload,
				}); err != nil {
					return
				}
			}
		}

		done := make(chan struct{})
		stop := make(chan struct{})
		go liveWebSocketWritePump(conn, sub, app.wsHeartbeatFunc(), leaseToken, origin, sess.UserID, stop, done)
		liveWebSocketReadPump(conn)
		close(stop)
		<-done
	}
}

func parseLiveWebSocketQuery(r *http.Request) (liveWebSocketQuery, error) {
	query := liveWebSocketQuery{
		scheduleID: strings.TrimSpace(r.URL.Query().Get("scheduleId")),
		attemptID:  strings.TrimSpace(r.URL.Query().Get("attemptId")),
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("lastSeenRuntimeRevision")); raw != "" {
		revision, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || revision < 0 {
			return liveWebSocketQuery{}, apperrors.New(apperrors.CodeBadRequest, "lastSeenRuntimeRevision must be a non-negative integer.")
		}
		query.lastSeenRuntimeRevision = &revision
	}
	return query, nil
}

func liveAllowedScheduleIDs(ctx context.Context, db interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, sess *auth.Session, query liveWebSocketQuery) ([]string, error) {
	if sess.Role == auth.RoleAdmin || sess.Role == auth.RoleAdminObserver {
		return nil, nil
	}
	rows, err := db.QueryContext(ctx, "SELECT DISTINCT schedule_id FROM schedule_staff_assignments WHERE revoked_at IS NULL AND role = ? AND (user_id = ? OR (user_id IS NULL AND actor_id = ?))", sess.Role, sess.UserID, sess.UserID)
	if sess.Role == auth.RoleStudent {
		rows, err = db.QueryContext(ctx, "SELECT DISTINCT schedule_id FROM schedule_registrations WHERE access_state <> 'withdrawn' AND (user_id = ? OR actor_id = ?)", sess.UserID, sess.UserID)
	}
	if err != nil {
		return nil, err
	}
	allowed := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		allowed = append(allowed, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	if query.attemptID != "" {
		var attemptSchedule, ownerID string
		err := db.QueryRowContext(ctx, "SELECT schedule_id, user_id FROM student_attempts WHERE id = ?", query.attemptID).Scan(&attemptSchedule, &ownerID)
		if err == sql.ErrNoRows {
			return nil, apperrors.New(apperrors.CodeNotFound, "Live resource not found.")
		}
		if err != nil {
			return nil, err
		}
		if sess.Role == auth.RoleStudent && ownerID != sess.UserID {
			return nil, apperrors.New(apperrors.CodeNotFound, "Live resource not found.")
		}
		if query.scheduleID != "" && query.scheduleID != attemptSchedule {
			return nil, apperrors.New(apperrors.CodeNotFound, "Live resource not found.")
		}
		if !containsString(allowed, attemptSchedule) {
			return nil, apperrors.New(apperrors.CodeNotFound, "Live resource not found.")
		}
	}
	if query.scheduleID != "" && !containsString(allowed, query.scheduleID) {
		return nil, apperrors.New(apperrors.CodeNotFound, "Live resource not found.")
	}
	return allowed, nil
}

// wsHeartbeatFunc is the write-pump lease tick: it closes over the active
// gate (memory or db) so the pump body stays gate-agnostic.
func liveWebSocketWritePump(conn *websocket.Conn, sub *liveupdates.Subscription, heartbeat wsHeartbeatFunc, token, instanceID, userID string, stop <-chan struct{}, done chan<- struct{}) {
	defer close(done)
	defer conn.Close()
	pingTicker := time.NewTicker(25 * time.Second)
	leaseTicker := time.NewTicker(liveupdates.LeaseHeartbeat)
	defer pingTicker.Stop()
	defer leaseTicker.Stop()
	for {
		select {
		case <-stop:
			return
		case event, ok := <-sub.Channel():
			if !ok {
				return
			}
			if err := writeLiveJSON(conn, event); err != nil {
				return
			}
		case <-pingTicker.C:
			if err := conn.SetWriteDeadline(time.Now().Add(liveupdates.WriteTimeout)); err != nil {
				return
			}
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		case <-leaseTicker.C:
			if err := heartbeat(context.Background(), token, instanceID, userID); err != nil {
				return
			}
		}
	}
}

func liveWebSocketReadPump(conn *websocket.Conn) {
	conn.SetReadLimit(64 * 1024)
	_ = conn.SetReadDeadline(time.Now().Add(liveupdates.LeaseTTL))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(liveupdates.LeaseTTL))
	})
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
	}
}

func writeLiveJSON(conn *websocket.Conn, value any) error {
	if err := conn.SetWriteDeadline(time.Now().Add(liveupdates.WriteTimeout)); err != nil {
		return err
	}
	return conn.WriteJSON(value)
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func runtimeRevision(value *int64) int64 {
	if value == nil {
		return -1
	}
	return *value
}

func containsString(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}
