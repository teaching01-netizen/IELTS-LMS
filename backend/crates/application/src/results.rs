use serde_json::Value;
use sqlx::MySqlPool;
use uuid::Uuid;

use ielts_backend_domain::grading::{
    ActScienceScoreReport, ReleaseEvent, ResultsAnalytics, StudentResult,
};
use ielts_backend_infrastructure::actor_context::ActorContext;

use crate::grading::{GradingError, GradingService};

pub struct ResultsService {
    grading: GradingService,
}

impl ResultsService {
    pub fn new(pool: MySqlPool) -> Self {
        Self {
            grading: GradingService::new(pool),
        }
    }

    pub fn with_sync_on_read_fallback(pool: MySqlPool, enabled: bool) -> Self {
        Self {
            grading: GradingService::with_sync_on_read_fallback(pool, enabled),
        }
    }

    pub async fn list_results(
        &self,
        ctx: &ActorContext,
    ) -> Result<Vec<StudentResult>, GradingError> {
        self.grading.list_results(ctx).await
    }

    pub async fn get_result(&self, result_id: Uuid) -> Result<StudentResult, GradingError> {
        self.grading.get_result(result_id).await
    }

    pub async fn analytics(&self) -> Result<ResultsAnalytics, GradingError> {
        self.grading.analytics().await
    }

    pub async fn export_results(&self, ctx: &ActorContext) -> Result<Value, GradingError> {
        self.grading.export_results(ctx).await
    }

    pub async fn list_act_science_reports(
        &self,
        ctx: &ActorContext,
    ) -> Result<Vec<ActScienceScoreReport>, GradingError> {
        self.grading.list_act_science_reports(ctx).await
    }

    pub async fn get_events(&self, result_id: Uuid) -> Result<Vec<ReleaseEvent>, GradingError> {
        self.grading.get_result_events(result_id).await
    }
}
