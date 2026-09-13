package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"

	"example.com/ielts-proctoring/internal/authoringrealtime"
	"example.com/ielts-proctoring/internal/liveupdates"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
	"example.com/ielts-proctoring/internal/platform/telemetry"
)

// Phase 03: the SAT authoring realtime socket.
//
// It reuses the runtime socket's TRANSPORT (same upgrade lifecycle, same
// lease/admission gate, same ping/lease heartbeats, same 64K read limit and
// 1500ms write timeout) but has its own frame vocabulary and its own ACL.
// Nothing here mutates authoring state: HTTP stays authoritative, so a
// compromised or buggy socket cannot write.

// authoringRealtimeHandler authenticates and authorizes BEFORE upgrading.
// Every pre-upgrade failure renders the standard HTTP error envelope and
// never upgrades, so a denial cannot leave a half-open socket behind.
func authoringRealtimeHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireSession(w, r)
		if sess == nil {
			return
		}
		if app.DB == nil || app.LiveHub == nil || !app.wsGateReady() {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Live updates are unavailable."))
			return
		}
		examID := strings.TrimSpace(r.URL.Query().Get("examId"))
		if examID == "" {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeBadRequest, "examId is required."))
			return
		}
		binding, err := authoringrealtime.VerifySubscriptionRead(r.Context(), examAuthoringLoaderFor(app), sess.UserID, sess.Role, examID, authoringSubscriptionConfig(app))
		if err != nil {
			if denial, ok := authoringrealtime.Denied(err); ok {
				// Same log detail for "not yours" and "does not exist": the
				// response is already uniform, and the log must not reintroduce
				// the oracle the envelope carefully avoids.
				log.Printf("api: authoring ws denied request_id=%s user_id=%s role=%s exam_id=%s reason=%s", httpx.RequestIDFrom(r.Context(), r), sess.UserID, sess.Role, examID, denial.Code)
				httpx.WriteError(w, r, denial.AsAppError())
				return
			}
			log.Printf("api: authoring ws authorization failed request_id=%s user_id=%s exam_id=%s err=%v", httpx.RequestIDFrom(r.Context(), r), sess.UserID, examID, err)
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeInternal, "Authoring realtime is unavailable."))
			return
		}
		// Delivery is checked AFTER a successful ACL pass so a flag-off server
		// is indistinguishable from a forbidden one: neither reveals whether
		// the caller was authorized.
		if !binding.DeliveryEnabled {
			log.Printf("api: authoring ws refused request_id=%s user_id=%s exam_id=%s reason=delivery_disabled", httpx.RequestIDFrom(r.Context(), r), sess.UserID, examID)
			httpx.WriteError(w, r, authoringrealtime.Denial(authoringrealtime.CodeSubscriptionForbidden, "Authoring realtime is unavailable.").AsAppError())
			return
		}
		// Display-only collaborator name for presence frames. Resolved once per
		// connection, only when presence is actually negotiated, and a failure
		// is silent: the client shows a neutral label, never a raw user id.
		if binding.PresenceEnabled {
			binding.DisplayName = authoringDisplayNameFor(r.Context(), app, sess.UserID)
		}
		origin := liveWebSocketInstanceID
		if app.LiveBus != nil && app.LiveBus.Origin() != "" {
			origin = app.LiveBus.Origin()
		}
		// Authoring caps are per-user/per-org, not per-schedule: the lease
		// carries no schedule id (nil), so the schedule cap never applies.
		leaseToken, admitted, err := app.acquireWSLease(r.Context(), origin, sess.UserID, nil)
		if err != nil {
			log.Printf("api: authoring ws lease acquire failed request_id=%s user_id=%s exam_id=%s err=%v", httpx.RequestIDFrom(r.Context(), r), sess.UserID, examID, err)
			httpx.WriteError(w, r, err)
			return
		}
		if !admitted {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeLeaseAcquireFailed, "WebSocket capacity exceeded."))
			return
		}
		conn, err := liveWebSocketUpgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("api: authoring ws upgrade failed request_id=%s user_id=%s exam_id=%s err=%v", httpx.RequestIDFrom(r.Context(), r), sess.UserID, examID, err)
			app.releaseWSLease(context.Background(), leaseToken, origin, sess.UserID)
			return
		}
		defer func() {
			app.releaseWSLease(context.Background(), leaseToken, origin, sess.UserID)
			_ = conn.Close()
		}()
		authoringrealtime.EmitConnection(authoringrealtime.ConnAccepted)
		authoringrealtime.SetConnections(app.LiveHub.AuthoringSubscriberCount())
		// The gauge is sampled again on the way out, so it converges even if a
		// socket dies without an orderly unsubscribe.
		defer func() { authoringrealtime.SetConnections(app.LiveHub.AuthoringSubscriberCount()) }()
		serveAuthoringConn(r.Context(), app, conn, binding, leaseToken, origin, sess.UserID)
	}
}

// errAuthoringBarrierUnavailable means the server watermark could not be
// resolved. Without it the replay/live split is undefined, so the handshake
// fails closed rather than guessing 0.
var errAuthoringBarrierUnavailable = errors.New("authoring realtime barrier is unavailable")

// serveAuthoringConn runs the handshake, the bounded replay, and then the two
// pumps. It owns the connection until it returns.
//
// Handoff invariant (the reason this is subtle): the hub subscription is
// created BEFORE the barrier is read, then replay covers (lastSeenCursor,
// barrier] and live delivery covers (barrier, ...]. Every event therefore has
// exactly one owner: a resume can neither duplicate an event (queued AND
// replayed) nor skip one (queued before the replay snapshot but excluded from
// both).
func serveAuthoringConn(ctx context.Context, app *App, conn *websocket.Conn, b authoringrealtime.Binding, leaseToken, origin, userID string) {
	maxFrame := app.Config.AuthoringWSMaxFrameSize
	if maxFrame <= 0 {
		maxFrame = 64 * 1024
	}
	conn.SetReadLimit(int64(maxFrame))
	_ = conn.SetReadDeadline(time.Now().Add(liveupdates.LeaseTTL))

	raw, err := readAuthoringFrame(conn)
	if err != nil {
		return
	}
	// The expected exam id is the one already authorized BEFORE the upgrade:
	// a socket authorized for exam A can never be rebound to exam B here.
	frame, err := authoringrealtime.ParseSubscribeFrame(raw, b.ExamID)
	if err != nil {
		_ = writeLiveJSON(conn, authoringrealtime.BadRequestFrame(err.Error()))
		return
	}

	// Subscribe BEFORE reading the barrier: an event landing in the gap then
	// belongs to exactly one side (queued live, or replayed) instead of falling
	// between them.
	sub := app.LiveHub.SubscribeAuthoring(b.ExamID, func(e liveupdates.Event) bool {
		return authoringEventMatchesBinding(e, b)
	})
	defer app.LiveHub.Unsubscribe(sub)

	// One writer for the connection, created before any frame is sent. Every
	// subsequent write (handshake, replay, live, control, ping) goes through it.
	writer := newAuthoringWriter(conn)

	resume := frame.LastSeenCursor != nil
	barrier, err := readAuthoringBarrier(ctx, app)
	if err != nil {
		// Never substitute 0 for an unknown barrier: the split would be
		// undefined and could silently skip or duplicate history.
		log.Printf("api: authoring ws barrier unavailable user_id=%s exam_id=%s err=%v", userID, b.ExamID, err)
		_ = writer.write(authoringrealtime.ErrorFrame(authoringrealtime.CodeSubscriptionForbidden, "Authoring realtime is unavailable."))
		authoringrealtime.EmitDisconnect(authoringrealtime.DisconnectBarrierUnavail)
		return
	}
	// Phase 05 presence. Joined BEFORE the ack so the ack can carry this
	// socket's presence identity, but the frames Join queues cannot reach the
	// wire until the write pump starts below — which is after the handshake and
	// the replay. So the client still sees authoring.subscribed + capabilities
	// (+ any replay) before any presence frame.
	//
	// A registry at capacity is not a subscription failure: presence is
	// advisory, so the connection simply continues without it.
	var presence *authoringrealtime.PresencePeer
	var presenceHub *authoringrealtime.PresenceHub
	if b.PresenceEnabled {
		if hub := app.authoringPresence(); hub != nil {
			peer, err := hub.Join(b.ExamID, b.OrganizationID, b.ActorID, b.DisplayName, b.DraftVersionID)
			if err != nil {
				telemetry.IncCounter(telemetry.MAuthoringPresenceRejectedTotal, "reason", "capacity")
				log.Printf("api: authoring presence unavailable user_id=%s exam_id=%s err=%v", userID, b.ExamID, err)
			} else {
				presence = peer
				presenceHub = hub
				// Deferred HERE so the peer is retired when the connection ends,
				// including the early returns below for replay/barrier failures.
				defer hub.Leave(peer)
				telemetry.IncCounter(telemetry.MAuthoringPresencePeersTotal)
				authoringrealtime.SetPresence(hub.PeerCount(b.ExamID))
			}
		}
	}

	ack := authoringrealtime.Subscribed(b, barrier)
	if presence != nil {
		ack.ConnectionID = presence.ConnectionID()
	}
	if err := writer.write(ack); err != nil {
		return
	}
	if err := writer.write(authoringrealtime.CapabilitiesFrameFor(b)); err != nil {
		return
	}

	// Bounded replay: never a partial stream. Truncation, an unreadable row, or
	// a cursor below the global retention floor all resolve to a snapshot, and
	// the connection stays open for NEW events either way.
	if resume {
		plan, err := authoringrealtime.PlanReplay(ctx, app.DB, b, *frame.LastSeenCursor, barrier, app.Config.AuthoringWSReplayBound)
		if err != nil {
			// Fail closed: a replay failure must never be read as "no events".
			log.Printf("api: authoring ws replay failed user_id=%s exam_id=%s draft_id=%s err=%v", userID, b.ExamID, b.DraftVersionID, err)
			_ = writer.write(authoringrealtime.ErrorFrame(authoringrealtime.CodeSubscriptionForbidden, "Authoring realtime is unavailable."))
			authoringrealtime.EmitDeliveryFailure(authoringrealtime.DeliveryStageForwarder)
			authoringrealtime.EmitReplay(authoringrealtime.ReplayFailed)
			authoringrealtime.EmitDisconnect(authoringrealtime.DisconnectReplayUnavail)
			return
		}
		if plan.SnapshotRequired {
			// The reason vocabulary is the protocol's own SnapshotReason, mapped
			// explicitly so a server reason can never emit an unlisted value.
			// This is the freshness SLI: a resync means we could not keep the
			// client fresh, and the reason says why.
			authoringrealtime.EmitResync(authoringrealtime.ResyncReasonFor(plan.Reason))
			authoringrealtime.EmitReplay(authoringrealtime.ReplaySnapshotRequired)
			authoringrealtime.EmitReconnect(authoringrealtime.ReconnectSnapshotRequired)
			_ = writer.write(authoringrealtime.SnapshotRequired(b, plan.Reason))
		} else {
			// Validate the ENTIRE set before sending any of it: a partial stream
			// that looks complete is exactly what this protocol forbids.
			frames := make([]authoringrealtime.EventFrameV1, 0, len(plan.Rows))
			valid := true
			for _, row := range plan.Rows {
				f, err := authoringrealtime.EventFrame(row.Cursor, row.Payload)
				if err != nil {
					valid = false
					break
				}
				frames = append(frames, f)
			}
			if !valid {
				authoringrealtime.EmitResync(authoringrealtime.ResyncUnsupported)
				authoringrealtime.EmitReplay(authoringrealtime.ReplaySnapshotRequired)
				authoringrealtime.EmitReconnect(authoringrealtime.ReconnectSnapshotRequired)
				_ = writer.write(authoringrealtime.SnapshotRequired(b, authoringrealtime.ReasonUnsupportedEvent))
			} else {
				// The cursor was honored AND the whole bounded history was sent:
				// this is the `resumed` outcome the reconnect series tracks, and
				// the happy path of the replay series.
				authoringrealtime.EmitReplay(authoringrealtime.ReplayServed)
				authoringrealtime.EmitReconnect(authoringrealtime.ReconnectResumed)
				for _, f := range frames {
					if err := writer.write(f); err != nil {
						return
					}
					telemetry.IncCounter(telemetry.MAuthoringWSEventsReceivedTotal, "path", "replay")
				}
			}
		}
	}

	// Barrier handoff: on resume the replay already owns everything at or below
	// the barrier, so the live pump must drop those queued events. A fresh
	// subscribe has no replay, so every queued event is new to the client.
	liveFloor := int64(-1)
	if resume {
		liveFloor = barrier
	}

	// A nil channel is never selected, so a presence-less connection simply
	// never takes the presence branch in the write pump.
	var presenceFrames <-chan authoringrealtime.PresenceFrameV1
	if presence != nil {
		presenceFrames = presence.Frames()
	}

	done := make(chan struct{})
	stop := make(chan struct{})
	control := make(chan authoringOutbound, 4)
	go authoringWritePump(writer, conn, sub, control, presenceFrames, liveFloor, app.wsHeartbeatFunc(), leaseToken, origin, userID, b, stop, done)
	authoringReadPump(conn, control, done, app, b, presenceHub, presence, userID)
	close(stop)
	<-done
}

// readAuthoringBarrier resolves the server watermark that splits replay from
// live delivery, preferring an injected source (tests) over the live bus. A
// missing source and a query failure are the same answer: unavailable.
func readAuthoringBarrier(ctx context.Context, app *App) (int64, error) {
	if app == nil {
		return 0, errAuthoringBarrierUnavailable
	}
	if app.AuthoringBarrier != nil {
		return app.AuthoringBarrier.LatestSequence(ctx)
	}
	if app.LiveBus == nil {
		return 0, errAuthoringBarrierUnavailable
	}
	return app.LiveBus.LatestSequence(ctx)
}

// readAuthoringFrame reads exactly one bounded text/binary frame.
func readAuthoringFrame(conn *websocket.Conn) ([]byte, error) {
	_, payload, err := conn.ReadMessage()
	if err != nil {
		return nil, err
	}
	return payload, nil
}

// authoringEventMatchesBinding is the fan-out predicate. Routing is
// ORGANIZATION + EXAM scoped, never draft-scoped: a draft is replaceable
// state, so the event announcing a replacement must reach subscribers still
// bound to the old draft. The payload must parse; an unparseable payload
// returns false (a reader must never crash on history it cannot interpret).
func authoringEventMatchesBinding(e liveupdates.Event, b authoringrealtime.Binding) bool {
	if e.Kind != liveupdates.KindAuthoring {
		return false
	}
	if strings.TrimSpace(e.ID) != b.ExamID {
		return false
	}
	evt, err := authoringrealtime.Parse(e.Payload)
	if err != nil {
		return false
	}
	return b.MatchesExamScope(evt)
}

// authoringOutbound is one frame the read pump wants the write pump to send.
// The read pump NEVER writes to the socket itself: after the handshake every
// outgoing frame passes through the single writer goroutine, so gorilla's
// one-concurrent-writer rule holds by construction and control responses queue
// in order behind any in-flight data frame.
type authoringOutbound struct {
	frame      any
	closeAfter bool
}

// sendAuthoringOutbound hands a frame to the write pump, abandoning the send if
// the pump has already exited (otherwise a read pump blocked on a full control
// channel would leak).
func sendAuthoringOutbound(control chan<- authoringOutbound, done <-chan struct{}, out authoringOutbound) bool {
	select {
	case control <- out:
		return true
	case <-done:
		return false
	}
}

// authoringWritePump is the connection's ONLY writer. It forwards hub events,
// answers control frames from the read pump, keeps the lease alive, and applies
// drop-or-snapshot to slow clients. Writers, the DB, and other subscribers are
// never stalled by one slow socket.
func authoringWritePump(writer *authoringWriter, conn *websocket.Conn, sub *liveupdates.Subscription, control <-chan authoringOutbound, presenceFrames <-chan authoringrealtime.PresenceFrameV1, liveFloor int64, heartbeat wsHeartbeatFunc, token, instanceID, userID string, b authoringrealtime.Binding, stop <-chan struct{}, done chan<- struct{}) {
	defer close(done)
	defer conn.Close()
	pingTicker := time.NewTicker(25 * time.Second)
	leaseTicker := time.NewTicker(liveupdates.LeaseHeartbeat)
	defer pingTicker.Stop()
	defer leaseTicker.Stop()
	for {
		// Slow-consumer detection must not depend on another event arriving: a
		// queue overflow that is followed by silence would otherwise leave a
		// connection that has already missed data alive indefinitely.
		if sub.Dropped() > 0 {
			authoringSlowClient(writer, b)
			return
		}
		select {
		case <-stop:
			return
		case out, ok := <-control:
			if !ok {
				return
			}
			if err := writer.write(out.frame); err != nil {
				return
			}
			if out.closeAfter {
				return
			}
		case frame, ok := <-presenceFrames:
			if !ok {
				return
			}
			// Presence is advisory: a failed write is the socket's problem, not
			// the channel's, so it is counted and the pump returns (the socket
			// is unusable either way).
			if err := writer.write(frame); err != nil {
				return
			}
			telemetry.IncCounter(telemetry.MAuthoringPresencePublishedTotal)
		case event, ok := <-sub.Channel():
			if !ok {
				return
			}
			// Barrier handoff: on resume the replay already owns every event at
			// or below the barrier; forwarding it live would duplicate it.
			if event.SequenceID <= liveFloor {
				continue
			}
			frame, err := authoringrealtime.EventFrame(event.SequenceID, event.Payload)
			if err != nil {
				// Unparseable frame: drop it, keep the connection. The client
				// still converges because HTTP is authoritative.
				authoringrealtime.EmitDropped(authoringrealtime.DropUnparseable)
				continue
			}
			if err := writer.write(frame); err != nil {
				return
			}
			telemetry.IncCounter(telemetry.MAuthoringWSEventsPublishedTotal)
			// Lifecycle: forward ONCE, then close. The client distinguishes
			// draft.replaced (rebind may succeed) from exam.published (the
			// working draft ENDED; do not assume a successor draft exists).
			if authoringrealtime.IsLifecycleRebind(frame.Event) {
				authoringLogLifecycle(userID, b, frame.Event)
				return
			}
		case <-pingTicker.C:
			if sub.Dropped() > 0 {
				authoringSlowClient(writer, b)
				return
			}
			if err := writer.ping(); err != nil {
				return
			}
		case <-leaseTicker.C:
			if sub.Dropped() > 0 {
				authoringSlowClient(writer, b)
				return
			}
			if err := heartbeat(context.Background(), token, instanceID, userID); err != nil {
				authoringrealtime.EmitDisconnect(authoringrealtime.DisconnectLeaseExpired)
				return
			}
		}
	}
}

// authoringSlowClient is the drop-or-snapshot rule: this socket may have missed
// events and a partial stream would look complete, so it is told to refetch and
// then closed. Closing matters more than the frame arriving — a congested
// socket may not receive it at all.
func authoringSlowClient(writer *authoringWriter, b authoringrealtime.Binding) {
	_ = writer.write(authoringrealtime.SnapshotRequired(b, authoringrealtime.ReasonDeliveryGap))
	authoringrealtime.EmitDisconnect(authoringrealtime.DisconnectSlowClient)
	// A shed frame is the coverage hole that forced the disconnect: count the
	// DROP as well, so the drop series moves even when the client is gone.
	authoringrealtime.EmitDropped(authoringrealtime.DropHubQueueFull)
	telemetry.IncCounter(telemetry.MWSSlowDisconnect)
}

// authoringLogLifecycle records which lifecycle ended the connection. Both
// kinds close the socket (the client must refetch the shell), but the reasons
// stay distinct so telemetry and Phase 04 can tell a rebindable draft swap from
// a published exam that may have no successor draft.
func authoringLogLifecycle(userID string, b authoringrealtime.Binding, evt authoringrealtime.Event) {
	switch evt.Kind {
	case authoringrealtime.KindExamPublished:
		log.Printf("api: authoring ws working draft ended user_id=%s exam_id=%s draft_id=%s kind=%s", userID, b.ExamID, b.DraftVersionID, string(evt.Kind))
		// A published draft rebinds the client: the lifecycle signal is the
		// reason for the resync, not a sequence anomaly.
		authoringrealtime.EmitResync(authoringrealtime.ResyncLifecycleRebind)
		authoringrealtime.EmitDisconnect(authoringrealtime.DisconnectPublished)
	default:
		log.Printf("api: authoring ws draft rebind required user_id=%s exam_id=%s draft_id=%s kind=%s", userID, b.ExamID, b.DraftVersionID, string(evt.Kind))
		authoringrealtime.EmitDisconnect(authoringrealtime.DisconnectDraftReplaced)
	}
}

// authoringReadPump keeps the read deadline fresh, honors a re-subscribe, and
// fails the protocol on any other client frame.
//
// Mixed-version compatibility covers unknown OPTIONAL FIELDS, not arbitrary
// commands: tolerating unlimited junk would let a broken or hostile client burn
// the server. An unsupported frame is answered with a typed error through the
// write pump and closes the socket. Re-subscribe revalidates against the
// CURRENT draft (same draft = re-acked, replaced draft = typed close); a fresh
// replay still requires a new connection.
func authoringReadPump(conn *websocket.Conn, control chan<- authoringOutbound, done <-chan struct{}, app *App, b authoringrealtime.Binding, presenceHub *authoringrealtime.PresenceHub, presence *authoringrealtime.PresencePeer, userID string) {
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(liveupdates.LeaseTTL))
	})
	for {
		if err := conn.SetReadDeadline(time.Now().Add(liveupdates.LeaseTTL)); err != nil {
			return
		}
		_, payload, err := conn.ReadMessage()
		if err != nil {
			return
		}
		// Presence is tried FIRST because it is the high-frequency frame and
		// carries no authority: it can never re-bind the connection.
		if envelope, err := authoringrealtime.ParsePresenceFrame(payload); err == nil {
			if presence == nil || presenceHub == nil {
				// Presence was not negotiated for this socket. A compliant client
				// cannot reach this (the capabilities frame told it presence was
				// off), so treat it exactly like any other unsupported frame
				// rather than silently tolerating unlimited junk.
				telemetry.IncCounter(telemetry.MAuthoringPresenceRejectedTotal, "reason", "not_negotiated")
				telemetry.IncCounter(telemetry.MAuthoringWSFramesIgnoredTotal)
				_ = sendAuthoringOutbound(control, done, authoringOutbound{
					frame:      authoringrealtime.BadRequestFrame("unsupported client frame."),
					closeAfter: true,
				})
				return
			}
			presenceHub.Publish(presence, envelope.SelectedQuestionID, envelope.State, time.Now())
			continue
		}
		if _, err := authoringrealtime.ParseSubscribeFrame(payload, b.ExamID); err != nil {
			telemetry.IncCounter(telemetry.MAuthoringWSFramesIgnoredTotal)
			_ = sendAuthoringOutbound(control, done, authoringOutbound{
				frame:      authoringrealtime.BadRequestFrame("unsupported client frame."),
				closeAfter: true,
			})
			return
		}
		current, err := authoringrealtime.CurrentDraftID(context.Background(), app.DB, b.ExamID)
		if err != nil {
			_ = sendAuthoringOutbound(control, done, authoringOutbound{
				frame:      authoringrealtime.ErrorFrame(authoringrealtime.CodeSubscriptionForbidden, "Authoring realtime is unavailable."),
				closeAfter: true,
			})
			return
		}
		if err := b.Revalidate(current); err != nil {
			code := authoringrealtime.CodeSubscriptionForbidden
			message := "Authoring realtime is unavailable."
			if denial, ok := authoringrealtime.Denied(err); ok {
				code = denial.Code
				message = denial.Message
			}
			authoringrealtime.EmitDisconnect(authoringrealtime.DisconnectDraftReplaced)
			_ = sendAuthoringOutbound(control, done, authoringOutbound{
				frame:      authoringrealtime.ErrorFrame(code, message),
				closeAfter: true,
			})
			return
		}
		barrier, err := readAuthoringBarrier(context.Background(), app)
		if err != nil {
			_ = sendAuthoringOutbound(control, done, authoringOutbound{
				frame:      authoringrealtime.ErrorFrame(authoringrealtime.CodeSubscriptionForbidden, "Authoring realtime is unavailable."),
				closeAfter: true,
			})
			return
		}
		if !sendAuthoringOutbound(control, done, authoringOutbound{frame: authoringrealtime.Subscribed(b, barrier)}) {
			return
		}
	}
}
