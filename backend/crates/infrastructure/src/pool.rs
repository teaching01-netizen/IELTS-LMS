use sqlx::MySqlPool;

#[derive(Clone, Debug)]
pub struct DatabasePool {
    inner: Option<MySqlPool>,
}

impl DatabasePool {
    pub fn new(pool: MySqlPool) -> Self {
        Self { inner: Some(pool) }
    }

    pub fn placeholder() -> Self {
        Self { inner: None }
    }

    pub fn inner(&self) -> Option<&MySqlPool> {
        self.inner.as_ref()
    }

    pub fn readiness_label(&self) -> &'static str {
        match self.inner {
            Some(_) => "ready",
            None => "pending",
        }
    }
}
