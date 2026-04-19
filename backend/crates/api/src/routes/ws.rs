use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    http::{header::COOKIE, StatusCode},
    response::IntoResponse,
};
use serde::Deserialize;
use serde_json::json;

use crate::{
    http::{
        auth::parse_cookie,
        response::ApiError,
    },
    state::AppState,
};
use ielts_backend_application::auth::AuthService;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveUpdatesQuery {
    pub schedule_id: Option<String>,
}

pub async fn websocket_live(
    State(state): State<AppState>,
    Path(path): Path<String>,
    Query(query): Query<LiveUpdatesQuery>,
    headers: axum::http::HeaderMap,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    // Extract and validate session from cookie for WebSocket authentication
    let session_token = match extract_ws_session_token(&headers, &state.config.auth_session_cookie_name) {
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

    ws.on_upgrade(move |socket| handle_socket(socket, state, schedule_id, session.user.id))
}

fn extract_ws_session_token(headers: &axum::http::HeaderMap, cookie_name: &str) -> Option<String> {
    let cookie_header = headers.get(COOKIE)?;
    let _cookie_str = cookie_header.to_str().ok()?;
    parse_cookie(Some(cookie_header), cookie_name).map(|s| s.to_owned())
}

async fn handle_socket(
    mut socket: WebSocket,
    state: AppState,
    schedule_id: Option<String>,
    user_id: String,
) {
    let current_connections = state.live_updates.connection_opened(&user_id);
    state
        .telemetry
        .set_websocket_connections(current_connections);
    let mut subscription = state.live_updates.subscribe();

    // Check per-schedule subscription cap
    if let Some(ref sid) = schedule_id {
        if state.live_updates.is_schedule_at_capacity(sid) {
            let _ = socket
                .send(Message::Text(
                    json!({
                        "type": "error",
                        "code": "SCHEDULE_CAPACITY",
                        "message": "Maximum connections for this schedule exceeded."
                    })
                    .to_string(),
                ))
                .await;
            let remaining = state.live_updates.connection_closed(&user_id);
            state.telemetry.set_websocket_connections(remaining);
            return;
        }
        state.live_updates.subscribe_to_schedule(sid, &user_id);
    }

    let connected_message = json!({
        "type": "connected",
        "scheduleId": schedule_id,
    });
    if socket
        .send(Message::Text(connected_message.to_string()))
        .await
        .is_err()
    {
        let remaining = state.live_updates.connection_closed(&user_id);
        if let Some(ref sid) = schedule_id {
            state.live_updates.unsubscribe_from_schedule(sid, &user_id);
        }
        state.telemetry.set_websocket_connections(remaining);
        return;
    }

    loop {
        tokio::select! {
            update = subscription.recv() => {
                match update {
                    Ok(event) => {
                        if schedule_id.as_deref().is_some_and(|value| value != event.id) {
                            continue;
                        }

                        if socket
                            .send(Message::Text(
                                serde_json::to_string(&event).expect("serialize live update"),
                            ))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            inbound = socket.recv() => {
                match inbound {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Ping(payload))) => {
                        if socket.send(Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
        }
    }

    let remaining = state.live_updates.connection_closed(&user_id);
    if let Some(ref sid) = schedule_id {
        state.live_updates.unsubscribe_from_schedule(sid, &user_id);
    }
    state.telemetry.set_websocket_connections(remaining);
}
