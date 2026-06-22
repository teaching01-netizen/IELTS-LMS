use axum::{
    extract::{
        ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    http::{header::COOKIE, StatusCode},
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::json;
use std::{
    borrow::Cow,
    future::pending,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::{mpsc, oneshot, watch, Notify};

use crate::{
    background::BackgroundRuntimeHandle,
    http::{auth::parse_cookie, response::ApiError},
    state::AppState,
};
use ielts_backend_application::auth::AuthService;
use ielts_backend_application::scheduling::SchedulingService;
use ielts_backend_domain::auth::UserRole;
use ielts_backend_domain::schedule::LiveUpdateEvent;
use ielts_backend_infrastructure::actor_context::{ActorContext, ActorRole};
use uuid::Uuid;

#[derive(Debug)]
enum OutboundItem {
    TextWithAck(String, oneshot::Sender<()>),
    RawText(String),
    Pong(Vec<u8>),
    Event(LiveUpdateEvent),
}

#[derive(Debug, Clone)]
struct DisconnectReason {
    code: u16,
    reason: String,
}

struct BackgroundWebsocketGuard(Option<BackgroundRuntimeHandle>);

impl BackgroundWebsocketGuard {
    fn new(background: Option<BackgroundRuntimeHandle>) -> Self {
        if let Some(handle) = &background {
            handle.websocket_opened();
        }
        Self(background)
    }
}

impl Drop for BackgroundWebsocketGuard {
    fn drop(&mut self) {
        if let Some(handle) = &self.0 {
            handle.websocket_closed();
        }
    }
}

async fn send_with_timeout<S>(sink: &mut S, msg: Message, timeout: Duration) -> Result<(), ()>
where
    S: futures_util::Sink<Message> + Unpin,
    <S as futures_util::Sink<Message>>::Error: std::fmt::Debug,
{
    let result = tokio::time::timeout(timeout, sink.send(msg)).await;
    match result {
        Ok(Ok(())) => Ok(()),
        Ok(Err(_)) | Err(_) => Err(()),
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveUpdatesQuery {
    pub schedule_id: Option<String>,
    pub attempt_id: Option<String>,
    pub last_seen_runtime_revision: Option<i64>,
}

pub async fn websocket_live(
    State(state): State<AppState>,
    Path(path): Path<String>,
    Query(query): Query<LiveUpdatesQuery>,
    headers: axum::http::HeaderMap,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    // Extract and validate session from cookie for WebSocket authentication
    let session_token =
        match extract_ws_session_token(&headers, &state.config.auth_session_cookie_name) {
            Some(token) => token,
            None => {
                return ApiError::new(
                    StatusCode::UNAUTHORIZED,
                    "UNAUTHORIZED",
                    "Authentication is required for WebSocket connections.",
                )
                .into_response();
            }
        };

    // Validate the session
    let service = AuthService::new(state.db_pool(), state.config.clone());
    let session = match service.current_session(&session_token).await {
        Ok(Some(session)) => session,
        Ok(None) | Err(_) => {
            return ApiError::new(
                StatusCode::UNAUTHORIZED,
                "UNAUTHORIZED",
                "Invalid or expired session.",
            )
            .into_response();
        }
    };

    let schedule_id = query.schedule_id.or_else(|| match path.as_str() {
        "" | "live" => None,
        other => Some(other.to_owned()),
    });
    let attempt_id = query.attempt_id;
    let user_role = session.user.role.clone();

    // Check per-user connection cap
    if !state.live_updates.can_user_connect(&session.user.id) {
        return ApiError::new(
            StatusCode::FORBIDDEN,
            "CONNECTION_LIMIT",
            "Maximum WebSocket connections for this user exceeded.",
        )
        .into_response();
    }

    // Check per-instance connection cap
    if state.live_updates.is_at_capacity() {
        return ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "INSTANCE_CAPACITY",
            "Server at maximum WebSocket capacity.",
        )
        .into_response();
    }

    ws.write_buffer_size(0)
        .max_write_buffer_size(64 * 1024)
        .on_upgrade(move |socket| {
            handle_socket(
                socket,
                state,
                schedule_id,
                attempt_id,
                query.last_seen_runtime_revision,
                session.user.id,
                user_role,
            )
        })
}

fn extract_ws_session_token(headers: &axum::http::HeaderMap, cookie_name: &str) -> Option<String> {
    let cookie_header = headers.get(COOKIE)?;
    let _cookie_str = cookie_header.to_str().ok()?;
    parse_cookie(Some(cookie_header), cookie_name).map(|s| s.to_owned())
}

fn should_forward_event(
    event: &LiveUpdateEvent,
    user_role: &UserRole,
    schedule_id: Option<&str>,
    attempt_id: Option<&str>,
) -> bool {
    if *user_role == UserRole::Student {
        return match event.kind.as_str() {
            "schedule_runtime" => schedule_id.is_some_and(|value| value == event.id),
            "attempt" => attempt_id.is_some_and(|value| value == event.id),
            _ => false,
        };
    }

    // By default, staff connections don't receive attempt-scoped events
    // unless they explicitly subscribe with attemptId.
    if event.kind == "attempt" && attempt_id.is_none() {
        return false;
    }

    let schedule_match = schedule_id.is_some_and(|value| value == event.id);
    let attempt_match = attempt_id.is_some_and(|value| value == event.id);
    if (schedule_id.is_some() || attempt_id.is_some()) && !(schedule_match || attempt_match) {
        return false;
    }

    true
}

async fn build_runtime_snapshot_frame(state: &AppState, schedule_id: &str) -> Option<String> {
    let schedule_uuid = Uuid::parse_str(schedule_id).ok()?;
    let actor = ActorContext::new(Uuid::nil().to_string(), ActorRole::Admin);
    let runtime = SchedulingService::new(state.db_pool())
        .get_runtime(&actor, schedule_uuid)
        .await
        .ok()?;
    Some(
        json!({
            "type": "runtime_snapshot",
            "scheduleId": schedule_id,
            "runtime": runtime,
        })
        .to_string(),
    )
}

async fn handle_socket(
    mut socket: WebSocket,
    state: AppState,
    schedule_id: Option<String>,
    attempt_id: Option<String>,
    last_seen_runtime_revision: Option<i64>,
    user_id: String,
    user_role: UserRole,
) {
    let _background_guard = BackgroundWebsocketGuard::new(state.background_runtime.clone());
    let queue_cap = state.config.websocket_outbound_queue_cap.max(1);
    let slow_client_disconnect =
        Duration::from_millis(state.config.websocket_slow_client_disconnect_ms.max(1));
    let write_timeout = Duration::from_millis(state.config.websocket_write_timeout_ms.max(1));

    let current_connections = state.live_updates.connection_opened(&user_id);
    state
        .telemetry
        .set_websocket_connections(current_connections);

    // Check per-schedule subscription cap
    if let Some(ref sid) = schedule_id {
        if state.live_updates.is_schedule_at_capacity(sid) {
            let payload = json!({
                "type": "error",
                "code": "SCHEDULE_CAPACITY",
                "message": "Maximum connections for this schedule exceeded."
            })
            .to_string();
            let _ = tokio::time::timeout(write_timeout, socket.send(Message::Text(payload))).await;
            let remaining = state.live_updates.connection_closed(&user_id);
            state.telemetry.set_websocket_connections(remaining);
            return;
        }
        state.live_updates.subscribe_to_schedule(sid, &user_id);
    }

    let mut all_subscription = if schedule_id.is_none() && attempt_id.is_none() {
        Some(state.live_updates.subscribe_all())
    } else {
        None
    };
    let mut schedule_subscription = schedule_id
        .as_ref()
        .map(|sid| state.live_updates.subscribe_schedule(sid));
    let mut attempt_subscription = attempt_id
        .as_ref()
        .map(|aid| state.live_updates.subscribe_attempt(aid));

    let connected_message = json!({
        "type": "connected",
        "scheduleId": schedule_id,
        "attemptId": attempt_id,
    });

    let (mut ws_sender, mut ws_receiver) = socket.split();
    let (outbound_tx, mut outbound_rx) = mpsc::channel::<OutboundItem>(queue_cap);
    let (writer_done_tx, mut writer_done_rx) = watch::channel(false);
    let notify = Arc::new(Notify::new());
    let latest_event: Arc<Mutex<Option<LiveUpdateEvent>>> = Arc::new(Mutex::new(None));
    let disconnect_reason: Arc<Mutex<Option<DisconnectReason>>> = Arc::new(Mutex::new(None));

    let writer_notify = notify.clone();
    let writer_latest_event = latest_event.clone();
    let writer_disconnect_reason = disconnect_reason.clone();

    tokio::spawn(async move {
        loop {
            tokio::select! {
                item = outbound_rx.recv() => {
                    match item {
                        Some(OutboundItem::TextWithAck(payload, ack)) => {
                            let disconnecting = writer_disconnect_reason.lock().unwrap().is_some();
                            if disconnecting {
                                continue;
                            }
                            if send_with_timeout(&mut ws_sender, Message::Text(payload), write_timeout)
                                .await
                                .is_err()
                            {
                                break;
                            }
                            let _ = ack.send(());
                        }
                        Some(OutboundItem::RawText(payload)) => {
                            let disconnecting = writer_disconnect_reason.lock().unwrap().is_some();
                            if disconnecting {
                                continue;
                            }
                            if send_with_timeout(&mut ws_sender, Message::Text(payload), write_timeout)
                                .await
                                .is_err()
                            {
                                break;
                            }
                        }
                        Some(OutboundItem::Pong(payload)) => {
                            let disconnecting = writer_disconnect_reason.lock().unwrap().is_some();
                            if disconnecting {
                                continue;
                            }
                            if send_with_timeout(&mut ws_sender, Message::Pong(payload), write_timeout)
                                .await
                                .is_err()
                            {
                                break;
                            }
                        }
                        Some(OutboundItem::Event(event)) => {
                            let serialized = match serde_json::to_string(&event) {
                                Ok(value) => value,
                                Err(_) => break,
                            };
                            let disconnecting = writer_disconnect_reason.lock().unwrap().is_some();
                            if disconnecting {
                                continue;
                            }
                            if send_with_timeout(&mut ws_sender, Message::Text(serialized), write_timeout)
                                .await
                                .is_err()
                            {
                                break;
                            }
                        }
                        None => break,
                    }
                }
                _ = writer_notify.notified() => {}
            }

            let maybe_reason = { writer_disconnect_reason.lock().unwrap().take() };
            if let Some(reason) = maybe_reason {
                let close_frame = CloseFrame {
                    code: reason.code,
                    reason: Cow::Owned(reason.reason),
                };
                let _ = send_with_timeout(
                    &mut ws_sender,
                    Message::Close(Some(close_frame)),
                    write_timeout,
                )
                .await;
                break;
            }

            let maybe_event = { writer_latest_event.lock().unwrap().take() };
            if let Some(event) = maybe_event {
                let serialized = match serde_json::to_string(&event) {
                    Ok(value) => value,
                    Err(_) => break,
                };
                if send_with_timeout(&mut ws_sender, Message::Text(serialized), write_timeout)
                    .await
                    .is_err()
                {
                    break;
                }
            }

            tokio::task::yield_now().await;
        }

        let _ = writer_done_tx.send(true);
    });

    let (connected_ack_tx, connected_ack_rx) = oneshot::channel::<()>();
    match outbound_tx.try_send(OutboundItem::TextWithAck(
        connected_message.to_string(),
        connected_ack_tx,
    )) {
        Ok(()) => {}
        Err(_) => {
            *disconnect_reason.lock().unwrap() = Some(DisconnectReason {
                code: 1008,
                reason: "slow client".to_owned(),
            });
            notify.notify_one();
            drop(all_subscription);
            drop(schedule_subscription);
            drop(attempt_subscription);
            if let Some(ref sid) = schedule_id {
                state.live_updates.cleanup_schedule_topic_if_idle(sid);
            }
            if let Some(ref aid) = attempt_id {
                state.live_updates.cleanup_attempt_topic_if_idle(aid);
            }
            let remaining = state.live_updates.connection_closed(&user_id);
            if let Some(ref sid) = schedule_id {
                state.live_updates.unsubscribe_from_schedule(sid, &user_id);
            }
            state.telemetry.set_websocket_connections(remaining);
            return;
        }
    }

    match tokio::time::timeout(write_timeout, connected_ack_rx).await {
        Ok(Ok(())) => {}
        _ => {
            *disconnect_reason.lock().unwrap() = Some(DisconnectReason {
                code: 1008,
                reason: "slow client".to_owned(),
            });
            notify.notify_one();
            drop(all_subscription);
            drop(schedule_subscription);
            drop(attempt_subscription);
            if let Some(ref sid) = schedule_id {
                state.live_updates.cleanup_schedule_topic_if_idle(sid);
            }
            if let Some(ref aid) = attempt_id {
                state.live_updates.cleanup_attempt_topic_if_idle(aid);
            }
            let remaining = state.live_updates.connection_closed(&user_id);
            if let Some(ref sid) = schedule_id {
                state.live_updates.unsubscribe_from_schedule(sid, &user_id);
            }
            state.telemetry.set_websocket_connections(remaining);
            return;
        }
    }

    if let Some(ref sid) = schedule_id {
        if let Some(frame) = build_runtime_snapshot_frame(&state, sid).await {
            let should_send = if let Some(last_seen) = last_seen_runtime_revision {
                serde_json::from_str::<serde_json::Value>(&frame)
                    .ok()
                    .and_then(|value| {
                        value
                            .get("runtime")
                            .and_then(|runtime| runtime.get("revision"))
                            .and_then(|revision| revision.as_i64())
                    })
                    .is_some_and(|revision| revision > last_seen)
            } else {
                true
            };
            if should_send {
                let _ = outbound_tx.try_send(OutboundItem::RawText(frame));
            }
        }
    }

    let mut saturation_since: Option<Instant> = None;

    loop {
        tokio::select! {
            all_update = async {
                if let Some(subscription) = all_subscription.as_mut() {
                    subscription.recv().await
                } else {
                    pending().await
                }
            } => {
                match all_update {
                    Ok(event) => {
                        if !should_forward_event(
                            &event,
                            &user_role,
                            schedule_id.as_deref(),
                            attempt_id.as_deref(),
                        ) {
                            continue;
                        }

                        match outbound_tx.try_send(OutboundItem::Event(event)) {
                            Ok(()) => {
                                saturation_since = None;
                            }
                            Err(mpsc::error::TrySendError::Full(event)) => {
                                if saturation_since.is_none() {
                                    saturation_since = Some(Instant::now());
                                }
                                *latest_event.lock().unwrap() = Some(match event {
                                    OutboundItem::Event(value) => value,
                                    _ => unreachable!("mpsc full returns original item"),
                                });
                                notify.notify_one();

                                if saturation_since.is_some_and(|since| since.elapsed() >= slow_client_disconnect) {
                                    *disconnect_reason.lock().unwrap() = Some(DisconnectReason {
                                        code: 1008,
                                        reason: "slow client".to_owned(),
                                    });
                                    notify.notify_one();
                                    break;
                                }
                            }
                            Err(mpsc::error::TrySendError::Closed(_)) => break,
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            schedule_update = async {
                if let Some(subscription) = schedule_subscription.as_mut() {
                    subscription.recv().await
                } else {
                    pending().await
                }
            } => {
                match schedule_update {
                    Ok(event) => {
                        if !should_forward_event(
                            &event,
                            &user_role,
                            schedule_id.as_deref(),
                            attempt_id.as_deref(),
                        ) {
                            continue;
                        }

                        if event.kind == "schedule_runtime" {
                            if let Some(frame) = build_runtime_snapshot_frame(&state, &event.id).await {
                                match outbound_tx.try_send(OutboundItem::RawText(frame)) {
                                    Ok(()) => {
                                        saturation_since = None;
                                    }
                                    Err(mpsc::error::TrySendError::Full(_)) => {
                                        if saturation_since.is_none() {
                                            saturation_since = Some(Instant::now());
                                        }
                                        notify.notify_one();

                                        if saturation_since.is_some_and(|since| since.elapsed() >= slow_client_disconnect) {
                                            *disconnect_reason.lock().unwrap() = Some(DisconnectReason {
                                                code: 1008,
                                                reason: "slow client".to_owned(),
                                            });
                                            notify.notify_one();
                                            break;
                                        }
                                    }
                                    Err(mpsc::error::TrySendError::Closed(_)) => break,
                                }
                            }
                        }

                        match outbound_tx.try_send(OutboundItem::Event(event)) {
                            Ok(()) => {
                                saturation_since = None;
                            }
                            Err(mpsc::error::TrySendError::Full(event)) => {
                                if saturation_since.is_none() {
                                    saturation_since = Some(Instant::now());
                                }
                                *latest_event.lock().unwrap() = Some(match event {
                                    OutboundItem::Event(value) => value,
                                    _ => unreachable!("mpsc full returns original item"),
                                });
                                notify.notify_one();

                                if saturation_since.is_some_and(|since| since.elapsed() >= slow_client_disconnect) {
                                    *disconnect_reason.lock().unwrap() = Some(DisconnectReason {
                                        code: 1008,
                                        reason: "slow client".to_owned(),
                                    });
                                    notify.notify_one();
                                    break;
                                }
                            }
                            Err(mpsc::error::TrySendError::Closed(_)) => break,
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            attempt_update = async {
                if let Some(subscription) = attempt_subscription.as_mut() {
                    subscription.recv().await
                } else {
                    pending().await
                }
            } => {
                match attempt_update {
                    Ok(event) => {
                        if !should_forward_event(
                            &event,
                            &user_role,
                            schedule_id.as_deref(),
                            attempt_id.as_deref(),
                        ) {
                            continue;
                        }

                        match outbound_tx.try_send(OutboundItem::Event(event)) {
                            Ok(()) => {
                                saturation_since = None;
                            }
                            Err(mpsc::error::TrySendError::Full(event)) => {
                                if saturation_since.is_none() {
                                    saturation_since = Some(Instant::now());
                                }
                                *latest_event.lock().unwrap() = Some(match event {
                                    OutboundItem::Event(value) => value,
                                    _ => unreachable!("mpsc full returns original item"),
                                });
                                notify.notify_one();

                                if saturation_since.is_some_and(|since| since.elapsed() >= slow_client_disconnect) {
                                    *disconnect_reason.lock().unwrap() = Some(DisconnectReason {
                                        code: 1008,
                                        reason: "slow client".to_owned(),
                                    });
                                    notify.notify_one();
                                    break;
                                }
                            }
                            Err(mpsc::error::TrySendError::Closed(_)) => break,
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            inbound = ws_receiver.next() => {
                match inbound {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Ping(payload))) => {
                        match outbound_tx.try_send(OutboundItem::Pong(payload)) {
                            Ok(()) => {}
                            Err(_) => {
                                *disconnect_reason.lock().unwrap() = Some(DisconnectReason {
                                    code: 1008,
                                    reason: "slow client".to_owned(),
                                });
                                notify.notify_one();
                                break;
                            }
                        }
                    }
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
            changed = writer_done_rx.changed() => {
                if changed.is_ok() && *writer_done_rx.borrow() {
                    break;
                }
            }
        }
    }

    drop(all_subscription);
    drop(schedule_subscription);
    drop(attempt_subscription);
    if let Some(ref sid) = schedule_id {
        state.live_updates.cleanup_schedule_topic_if_idle(sid);
    }
    if let Some(ref aid) = attempt_id {
        state.live_updates.cleanup_attempt_topic_if_idle(aid);
    }

    let remaining = state.live_updates.connection_closed(&user_id);
    if let Some(ref sid) = schedule_id {
        state.live_updates.unsubscribe_from_schedule(sid, &user_id);
    }
    state.telemetry.set_websocket_connections(remaining);
}

#[cfg(test)]
mod tests {
    use super::should_forward_event;
    use ielts_backend_domain::{auth::UserRole, schedule::LiveUpdateEvent};

    fn event(kind: &str, id: &str) -> LiveUpdateEvent {
        LiveUpdateEvent {
            kind: kind.to_owned(),
            id: id.to_owned(),
            revision: 1,
            event: "changed".to_owned(),
        }
    }

    #[test]
    fn student_schedule_subscriptions_only_receive_runtime_or_matching_attempt() {
        let role = UserRole::Student;

        assert!(should_forward_event(
            &event("schedule_runtime", "schedule-1"),
            &role,
            Some("schedule-1"),
            Some("attempt-1")
        ));
        assert!(should_forward_event(
            &event("attempt", "attempt-1"),
            &role,
            Some("schedule-1"),
            Some("attempt-1")
        ));
        assert!(!should_forward_event(
            &event("schedule_roster", "schedule-1"),
            &role,
            Some("schedule-1"),
            Some("attempt-1")
        ));
        assert!(!should_forward_event(
            &event("schedule_alert", "schedule-1"),
            &role,
            Some("schedule-1"),
            Some("attempt-1")
        ));
    }

    #[test]
    fn staff_attempt_events_require_attempt_subscription() {
        let role = UserRole::Proctor;

        assert!(!should_forward_event(
            &event("attempt", "attempt-1"),
            &role,
            Some("schedule-1"),
            None
        ));
        assert!(should_forward_event(
            &event("attempt", "attempt-1"),
            &role,
            None,
            Some("attempt-1")
        ));
    }
}
