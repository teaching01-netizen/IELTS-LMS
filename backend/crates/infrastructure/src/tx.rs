use sqlx::{MySql, MySqlPool, Transaction};
use uuid::Uuid;

use crate::actor_context::ActorContext;

pub async fn begin_scoped_transaction<'a>(
    pool: &'a MySqlPool,
    _actor_context: &ActorContext,
) -> Result<Transaction<'a, MySql>, sqlx::Error> {
    let tx = pool.begin().await?;
    // Note: RLS context setting removed - authorization is now handled at application level
    Ok(tx)
}

fn optional_uuid(value: Option<Uuid>) -> String {
    value.map(|uuid| uuid.to_string()).unwrap_or_default()
}
