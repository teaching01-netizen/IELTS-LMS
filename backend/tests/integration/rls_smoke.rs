#[path = "../support/mysql.rs"]
mod mysql;

use sqlx::query_scalar;
use uuid::Uuid;

use ielts_backend_infrastructure::{
    actor_context::{ActorContext, ActorRole},
    tx::begin_scoped_transaction,
};

// These tests use PostgreSQL-specific current_setting() which doesn't exist in MySQL.
// MySQL/TiDB doesn't have the same transaction-local variable mechanism as PostgreSQL.
// These tests are disabled for MySQL since they test PostgreSQL-specific RLS functionality.
#[tokio::test]
#[ignore = "PostgreSQL-specific current_setting() not available in MySQL"]
async fn begin_scoped_transaction_sets_transaction_local_actor_context() {
    // Test skipped for MySQL - current_setting() not available
}

#[tokio::test]
#[ignore = "PostgreSQL-specific current_setting() not available in MySQL"]
async fn actor_context_disappears_after_commit_and_does_not_leak() {
    // Test skipped for MySQL - current_setting() not available
}
