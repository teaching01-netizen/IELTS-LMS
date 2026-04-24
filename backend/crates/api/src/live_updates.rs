use std::{
    collections::HashMap,
    fmt,
    sync::{
        atomic::{AtomicI64, Ordering},
        Arc, Mutex,
    },
};

use ielts_backend_domain::schedule::LiveUpdateEvent;
use ielts_backend_infrastructure::config::AppConfig;
// MySQL doesn't support LISTEN/NOTIFY like PostgreSQL, so PgListener is not available
// use sqlx::postgres::PgListener;
use tokio::sync::broadcast;

#[derive(Clone)]
pub struct LiveUpdateHub {
    sender: broadcast::Sender<LiveUpdateEvent>,
    connection_count: Arc<AtomicI64>,
    connection_cap: i64,
    user_connections: Arc<Mutex<HashMap<String, usize>>>,
    connections_per_user_cap: usize,
    connections_per_schedule_cap: usize,
    schedule_connections: Arc<Mutex<HashMap<String, usize>>>,
}

impl fmt::Debug for LiveUpdateHub {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("LiveUpdateHub")
            .finish_non_exhaustive()
    }
}

impl Default for LiveUpdateHub {
    fn default() -> Self {
        Self::new()
    }
}

impl LiveUpdateHub {
    pub fn new() -> Self {
        Self::with_config(&AppConfig::default())
    }

    pub fn with_config(config: &AppConfig) -> Self {
        let (sender, _) = broadcast::channel(256);
        Self {
            sender,
            connection_count: Arc::new(AtomicI64::new(0)),
            connection_cap: i64::try_from(config.websocket_connection_cap).unwrap_or(i64::MAX),
            user_connections: Arc::new(Mutex::new(HashMap::new())),
            connections_per_user_cap: config.websocket_connections_per_user_cap,
            connections_per_schedule_cap: config.websocket_connections_per_schedule_cap,
            schedule_connections: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<LiveUpdateEvent> {
        self.sender.subscribe()
    }

    pub fn publish(&self, event: LiveUpdateEvent) {
        let _ = self.sender.send(event);
    }

    pub fn connection_opened(&self, user_id: &str) -> i64 {
        let mut users = self.user_connections.lock().unwrap();
        let count = users.entry(user_id.to_owned()).or_insert(0);
        *count += 1;
        drop(users);
        self.connection_count.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn connection_closed(&self, user_id: &str) -> i64 {
        let mut users = self.user_connections.lock().unwrap();
        if let Some(count) = users.get_mut(user_id) {
            if *count > 0 {
                *count -= 1;
            }
            if *count == 0 {
                users.remove(user_id);
            }
        }
        drop(users);

        let next = self.connection_count.fetch_sub(1, Ordering::SeqCst) - 1;
        if next < 0 {
            self.connection_count.store(0, Ordering::SeqCst);
            0
        } else {
            next
        }
    }

    pub fn can_user_connect(&self, user_id: &str) -> bool {
        let users = self.user_connections.lock().unwrap();
        users
            .get(user_id)
            .map(|c| *c)
            .unwrap_or(0)
            < self.connections_per_user_cap
    }

    pub fn is_at_capacity(&self) -> bool {
        self.connection_count.load(Ordering::SeqCst) >= self.connection_cap
    }

    pub fn is_schedule_at_capacity(&self, schedule_id: &str) -> bool {
        let schedules = self.schedule_connections.lock().unwrap();
        schedules.get(schedule_id).copied().unwrap_or(0) >= self.connections_per_schedule_cap
    }

    pub fn subscribe_to_schedule(&self, schedule_id: &str, user_id: &str) {
        let _ = user_id;
        let mut schedules = self.schedule_connections.lock().unwrap();
        let count = schedules.entry(schedule_id.to_owned()).or_insert(0);
        *count = count.saturating_add(1);
    }

    pub fn unsubscribe_from_schedule(&self, schedule_id: &str, user_id: &str) {
        let _ = user_id;
        let mut schedules = self.schedule_connections.lock().unwrap();
        if let Some(count) = schedules.get_mut(schedule_id) {
            if *count > 0 {
                *count -= 1;
            }
            if *count == 0 {
                schedules.remove(schedule_id);
            }
        }
    }
}

pub fn spawn_postgres_listener(
    _config: AppConfig,
    _hub: LiveUpdateHub,
) -> Option<tokio::task::JoinHandle<()>> {
    // MySQL doesn't support LISTEN/NOTIFY like PostgreSQL
    // Live updates would need to be implemented using a different mechanism (e.g., Redis pub/sub)
    // For now, return None to disable this feature in MySQL mode
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schedule_capacity_counts_connections_not_unique_users() {
        let mut config = AppConfig::default();
        config.websocket_connections_per_schedule_cap = 2;
        let hub = LiveUpdateHub::with_config(&config);

        assert!(!hub.is_schedule_at_capacity("schedule-1"));
        hub.subscribe_to_schedule("schedule-1", "user-1");
        assert!(!hub.is_schedule_at_capacity("schedule-1"));
        hub.subscribe_to_schedule("schedule-1", "user-1");
        assert!(hub.is_schedule_at_capacity("schedule-1"));

        hub.unsubscribe_from_schedule("schedule-1", "user-1");
        assert!(!hub.is_schedule_at_capacity("schedule-1"));
    }

    #[test]
    fn default_schedule_capacity_supports_six_hundred_connections() {
        let hub = LiveUpdateHub::new();

        assert!(!hub.is_schedule_at_capacity("schedule-1"));
        for index in 0..599 {
            hub.subscribe_to_schedule("schedule-1", &format!("user-{index}"));
        }
        assert!(!hub.is_schedule_at_capacity("schedule-1"));

        hub.subscribe_to_schedule("schedule-1", "user-599");
        assert!(hub.is_schedule_at_capacity("schedule-1"));
    }

    #[test]
    fn connection_caps_respect_config() {
        let mut config = AppConfig::default();
        config.websocket_connection_cap = 1;
        config.websocket_connections_per_user_cap = 1;
        let hub = LiveUpdateHub::with_config(&config);

        assert!(!hub.is_at_capacity());
        assert!(hub.can_user_connect("user-1"));
        hub.connection_opened("user-1");
        assert!(hub.is_at_capacity());
        assert!(!hub.can_user_connect("user-1"));
    }
}
