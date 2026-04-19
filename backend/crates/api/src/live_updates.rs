use std::{
    collections::{HashMap, HashSet},
    fmt,
    sync::{
        atomic::{AtomicI64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use ielts_backend_domain::schedule::LiveUpdateEvent;
use ielts_backend_infrastructure::config::AppConfig;
// MySQL doesn't support LISTEN/NOTIFY like PostgreSQL, so PgListener is not available
// use sqlx::postgres::PgListener;
use tokio::sync::broadcast;

const MAX_CONNECTIONS_PER_USER: usize = 5;
const MAX_CONNECTIONS_INSTANCE: i64 = 1000;
const MAX_CONNECTIONS_PER_SCHEDULE: usize = 100;

#[derive(Clone)]
pub struct LiveUpdateHub {
    sender: broadcast::Sender<LiveUpdateEvent>,
    connection_count: Arc<AtomicI64>,
    user_connections: Arc<Mutex<HashMap<String, usize>>>,
    schedule_subscribers: Arc<Mutex<HashMap<String, HashSet<String>>>>,
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
        let (sender, _) = broadcast::channel(256);
        Self {
            sender,
            connection_count: Arc::new(AtomicI64::new(0)),
            user_connections: Arc::new(Mutex::new(HashMap::new())),
            schedule_subscribers: Arc::new(Mutex::new(HashMap::new())),
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
        users.get(user_id).map(|c| *c).unwrap_or(0) < MAX_CONNECTIONS_PER_USER
    }

    pub fn is_at_capacity(&self) -> bool {
        self.connection_count.load(Ordering::SeqCst) >= MAX_CONNECTIONS_INSTANCE
    }

    pub fn is_schedule_at_capacity(&self, schedule_id: &str) -> bool {
        let schedules = self.schedule_subscribers.lock().unwrap();
        schedules
            .get(schedule_id)
            .map(|s| s.len())
            .unwrap_or(0)
            >= MAX_CONNECTIONS_PER_SCHEDULE
    }

    pub fn subscribe_to_schedule(&self, schedule_id: &str, user_id: &str) {
        let mut schedules = self.schedule_subscribers.lock().unwrap();
        schedules
            .entry(schedule_id.to_owned())
            .or_insert_with(HashSet::new)
            .insert(user_id.to_owned());
    }

    pub fn unsubscribe_from_schedule(&self, schedule_id: &str, user_id: &str) {
        let mut schedules = self.schedule_subscribers.lock().unwrap();
        if let Some(users) = schedules.get_mut(schedule_id) {
            users.remove(user_id);
            if users.is_empty() {
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
