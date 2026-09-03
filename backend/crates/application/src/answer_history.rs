use chrono::{DateTime, Utc};
use ielts_backend_domain::answer_history::{
    AnswerHistoryCheckpoint, AnswerHistoryExport, AnswerHistoryExportFormat, AnswerHistoryOverview,
    AnswerHistoryQuestionSummary, AnswerHistorySectionStat, AnswerHistorySignal,
    AnswerHistoryTargetDetail, AnswerHistoryTargetType, AnswerHistoryTechnicalLogRow,
};
use serde_json::{json, Value};
use sqlx::{FromRow, MySqlPool};
use std::collections::{BTreeMap, HashMap, HashSet};
use thiserror::Error;
use uuid::Uuid;

#[derive(Error, Debug)]
pub enum AnswerHistoryError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Not found")]
    NotFound,
    #[error("Validation error: {0}")]
    Validation(String),
}

pub struct AnswerHistoryService {
    pool: MySqlPool,
}

#[derive(Debug, Clone, FromRow)]
struct SubmissionAttemptContextRow {
    submission_id: Option<String>,
    attempt_id: String,
    schedule_id: String,
    exam_id: String,
    exam_title: String,
    content_snapshot: Value,
    config_snapshot: Value,
    answers: Value,
    writing_answers: Value,
    final_submission: Option<Value>,
    candidate_id: String,
    candidate_name: String,
    candidate_email: String,
    started_at: DateTime<Utc>,
    submitted_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, FromRow)]
struct MutationRow {
    id: String,
    mutation_type: String,
    mutation_seq: i64,
    payload: Value,
    client_timestamp: DateTime<Utc>,
    server_received_at: DateTime<Utc>,
    applied_revision: Option<i32>,
}

#[derive(Debug, Clone, FromRow)]
struct AuditSignalRow {
    action_type: String,
    payload: Option<Value>,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
struct TargetMutation {
    module: String,
    target_id: String,
    target_type: AnswerHistoryTargetType,
    row: MutationRow,
}

#[derive(Debug, Clone)]
struct TargetCatalogEntry {
    module: String,
    target_id: String,
    target_type: AnswerHistoryTargetType,
    label: String,
}

#[derive(Debug, Clone)]
struct TargetCatalogIndex {
    objective_ids: HashSet<String>,
    writing_ids: HashSet<String>,
    objective_slot_targets: HashMap<(String, usize), String>,
}

impl AnswerHistoryService {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }

    pub async fn resolve_submission_id_from_attempt(
        &self,
        attempt_id: Uuid,
    ) -> Result<String, AnswerHistoryError> {
        sqlx::query_scalar::<_, String>(
            "SELECT id FROM student_submissions WHERE attempt_id = ? LIMIT 1",
        )
        .bind(attempt_id.to_string())
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AnswerHistoryError::NotFound)
    }

    pub async fn get_overview(
        &self,
        submission_id: Uuid,
    ) -> Result<AnswerHistoryOverview, AnswerHistoryError> {
        let context = self.load_context(submission_id).await?;
        self.build_overview_from_context(context).await
    }

    pub async fn get_overview_by_attempt(
        &self,
        attempt_id: Uuid,
    ) -> Result<AnswerHistoryOverview, AnswerHistoryError> {
        let context = self.load_context_by_attempt(attempt_id).await?;
        self.build_overview_from_context(context).await
    }

    async fn build_overview_from_context(
        &self,
        context: SubmissionAttemptContextRow,
    ) -> Result<AnswerHistoryOverview, AnswerHistoryError> {
        let history_attempt_id = self.resolve_history_attempt_id(&context).await?;
        let target_catalog =
            build_target_catalog(&context.content_snapshot, &context.config_snapshot);
        let catalog_index = build_target_catalog_index(&target_catalog);
        let submitted_states = build_submitted_target_states(
            context.final_submission.as_ref(),
            &context.answers,
            &context.writing_answers,
        );
        let mutations = self.load_mutations(&history_attempt_id).await?;
        let target_mutations = mutations
            .iter()
            .filter_map(|row| classify_target_mutation(row, &catalog_index))
            .collect::<Vec<_>>();
        let catalog_by_key = build_target_catalog_lookup(&target_catalog);

        let mut revision_counts = HashMap::<(AnswerHistoryTargetType, String), i64>::new();
        let mut final_states = HashMap::<(AnswerHistoryTargetType, String), Value>::new();
        let mut mutation_modules = HashMap::<(AnswerHistoryTargetType, String), String>::new();

        for target in &target_mutations {
            let key = (target.target_type.clone(), target.target_id.clone());
            *revision_counts.entry(key.clone()).or_insert(0) += 1;
            mutation_modules
                .entry(key.clone())
                .or_insert_with(|| target.module.clone());

            let prev = final_states.remove(&key).unwrap_or(Value::Null);
            let next = apply_mutation_to_state(&prev, &target.row);
            final_states.insert(key, next);
        }

        let mut all_keys = HashSet::<(AnswerHistoryTargetType, String)>::new();
        for key in revision_counts.keys() {
            all_keys.insert(key.clone());
        }
        for key in final_states.keys() {
            all_keys.insert(key.clone());
        }
        for key in submitted_states.keys() {
            all_keys.insert(key.clone());
        }
        for catalog_entry in &target_catalog {
            all_keys.insert((
                catalog_entry.target_type.clone(),
                catalog_entry.target_id.clone(),
            ));
        }

        let mut section_revision_counts = HashMap::<String, i64>::new();
        let mut section_targets = HashMap::<String, HashSet<String>>::new();
        let mut question_summaries = Vec::<AnswerHistoryQuestionSummary>::new();
        let mut seen_keys = HashSet::<(AnswerHistoryTargetType, String)>::new();
        let mut ordered_keys = Vec::<(AnswerHistoryTargetType, String)>::new();

        for entry in &target_catalog {
            let key = (entry.target_type.clone(), entry.target_id.clone());
            if all_keys.contains(&key) && seen_keys.insert(key.clone()) {
                ordered_keys.push(key);
            }
        }

        let mut fallback_keys = all_keys
            .into_iter()
            .filter(|key| !seen_keys.contains(key))
            .collect::<Vec<_>>();
        fallback_keys.sort_by(|left, right| {
            let left_module = mutation_modules
                .get(&(left.0.clone(), left.1.clone()))
                .cloned()
                .unwrap_or_else(|| default_module_for_type(&left.0).to_string());
            let right_module = mutation_modules
                .get(&(right.0.clone(), right.1.clone()))
                .cloned()
                .unwrap_or_else(|| default_module_for_type(&right.0).to_string());
            left_module
                .cmp(&right_module)
                .then(left.1.cmp(&right.1))
                .then(target_type_rank(&left.0).cmp(&target_type_rank(&right.0)))
        });
        ordered_keys.extend(fallback_keys);

        let mut objective_label_index_by_module = HashMap::<String, usize>::new();
        let mut writing_label_index = 0usize;
        for (target_type, target_id) in &ordered_keys {
            if let Some(entry) = catalog_by_key.get(&(target_type.clone(), target_id.clone())) {
                if *target_type == AnswerHistoryTargetType::Writing {
                    writing_label_index += 1;
                } else {
                    *objective_label_index_by_module
                        .entry(entry.module.clone())
                        .or_insert(0) += 1;
                }
            }
        }

        for (target_type, target_id) in ordered_keys {
            let key = (target_type.clone(), target_id.clone());
            let catalog_entry = catalog_by_key.get(&key);
            let module = catalog_entry
                .map(|entry| entry.module.clone())
                .or_else(|| mutation_modules.get(&key).cloned())
                .unwrap_or_else(|| default_module_for_type(&target_type).to_string());
            let revision_count = *revision_counts
                .get(&(target_type.clone(), target_id.clone()))
                .unwrap_or(&0);
            let final_value = final_states
                .get(&(target_type.clone(), target_id.clone()))
                .cloned()
                .or_else(|| {
                    submitted_states
                        .get(&(target_type.clone(), target_id.clone()))
                        .cloned()
                })
                .unwrap_or(Value::Null);
            let answered = is_answered_value(&final_value);
            let label = if let Some(entry) = catalog_entry {
                entry.label.clone()
            } else if target_type == AnswerHistoryTargetType::Writing {
                writing_label_index += 1;
                format!("Task {} (Unmapped)", writing_label_index)
            } else {
                let next = objective_label_index_by_module
                    .entry(module.clone())
                    .and_modify(|index| *index += 1)
                    .or_insert(1);
                format!("Question {} (Unmapped)", next)
            };

            if revision_count > 0 {
                *section_revision_counts.entry(module.clone()).or_insert(0) += revision_count;
                section_targets
                    .entry(module.clone())
                    .or_default()
                    .insert(format!("{:?}:{target_id}", target_type));
            }

            question_summaries.push(AnswerHistoryQuestionSummary {
                target_id: target_id.clone(),
                label,
                module,
                target_type,
                revision_count,
                answered,
                final_value,
            });
        }

        let mut section_stats = section_revision_counts
            .into_iter()
            .map(|(module, total_revisions)| AnswerHistorySectionStat {
                edited_targets: section_targets
                    .get(&module)
                    .map(|items| items.len() as i64)
                    .unwrap_or(0),
                module,
                total_revisions,
            })
            .collect::<Vec<_>>();
        section_stats.sort_by(|left, right| left.module.cmp(&right.module));

        let signals = self
            .build_global_signals(
                &context.schedule_id,
                &history_attempt_id,
                &target_mutations,
                context.submitted_at,
            )
            .await?;

        Ok(AnswerHistoryOverview {
            submission_id: context.submission_id,
            attempt_id: history_attempt_id,
            schedule_id: context.schedule_id,
            exam_id: context.exam_id,
            exam_title: context.exam_title,
            candidate_id: context.candidate_id,
            candidate_name: context.candidate_name,
            candidate_email: context.candidate_email,
            started_at: Some(context.started_at),
            submitted_at: context.submitted_at,
            total_revisions: target_mutations.len() as i64,
            total_targets_edited: revision_counts.len() as i64,
            question_summaries,
            section_stats,
            signals,
        })
    }

    pub async fn get_target_detail(
        &self,
        submission_id: Uuid,
        target_type: AnswerHistoryTargetType,
        target_id: &str,
        cursor: Option<i64>,
        limit: usize,
    ) -> Result<AnswerHistoryTargetDetail, AnswerHistoryError> {
        let context = self.load_context(submission_id).await?;
        self.build_target_detail_from_context(context, target_type, target_id, cursor, limit)
            .await
    }

    pub async fn get_target_detail_by_attempt(
        &self,
        attempt_id: Uuid,
        target_type: AnswerHistoryTargetType,
        target_id: &str,
        cursor: Option<i64>,
        limit: usize,
    ) -> Result<AnswerHistoryTargetDetail, AnswerHistoryError> {
        let context = self.load_context_by_attempt(attempt_id).await?;
        self.build_target_detail_from_context(context, target_type, target_id, cursor, limit)
            .await
    }

    async fn build_target_detail_from_context(
        &self,
        context: SubmissionAttemptContextRow,
        target_type: AnswerHistoryTargetType,
        target_id: &str,
        cursor: Option<i64>,
        limit: usize,
    ) -> Result<AnswerHistoryTargetDetail, AnswerHistoryError> {
        let history_attempt_id = self.resolve_history_attempt_id(&context).await?;
        let target_catalog =
            build_target_catalog(&context.content_snapshot, &context.config_snapshot);
        let catalog_index = build_target_catalog_index(&target_catalog);
        let submitted_states = build_submitted_target_states(
            context.final_submission.as_ref(),
            &context.answers,
            &context.writing_answers,
        );
        let rows = self.load_mutations(&history_attempt_id).await?;
        let mut matching = rows
            .into_iter()
            .filter_map(|row| classify_target_mutation(&row, &catalog_index))
            .filter(|item| item.target_type == target_type && item.target_id == target_id)
            .collect::<Vec<_>>();

        matching.sort_by(|left, right| {
            left.row
                .server_received_at
                .cmp(&right.row.server_received_at)
                .then(left.row.mutation_seq.cmp(&right.row.mutation_seq))
                .then(left.row.id.cmp(&right.row.id))
        });

        let cursor_seq = cursor.unwrap_or(i64::MIN);
        let page_limit = limit.max(1);

        let mut checkpoints = Vec::<AnswerHistoryCheckpoint>::new();
        let mut technical_logs = Vec::<AnswerHistoryTechnicalLogRow>::new();
        let mut state = submitted_states
            .get(&(target_type.clone(), target_id.to_string()))
            .cloned()
            .unwrap_or(Value::Null);
        if !matching.is_empty() {
            state = Value::Null;
        }
        let mut previous_seen = BTreeMap::<String, usize>::new();
        let mut replay_signals = Vec::<AnswerHistorySignal>::new();
        let mut emitted = 0usize;

        for (index, item) in matching.iter().enumerate() {
            let prior_state = state.clone();
            state = apply_mutation_to_state(&state, &item.row);
            let delta_chars = value_char_len(&state) - value_char_len(&prior_state);
            let summary = describe_mutation(&item.row);

            let canonical = canonical_value(&state);
            if let Some(first_seen_index) = previous_seen.get(&canonical) {
                if *first_seen_index + 1 < index {
                    replay_signals.push(AnswerHistorySignal {
                        signal_type: "RESTORED_ANSWER".to_string(),
                        severity: "medium".to_string(),
                        message: "A previously used answer state was restored.".to_string(),
                        evidence: json!({
                            "checkpointIndex": index as i64 + 1,
                            "restoredFrom": *first_seen_index as i64 + 1,
                        }),
                    });
                }
            }
            previous_seen.insert(canonical, index);

            if item.row.mutation_seq <= cursor_seq || emitted >= page_limit {
                continue;
            }

            checkpoints.push(AnswerHistoryCheckpoint {
                id: format!("cp-{}", item.row.id),
                index: index as i64 + 1,
                mutation_id: item.row.id.clone(),
                mutation_type: item.row.mutation_type.clone(),
                timestamp: item.row.server_received_at,
                client_timestamp: item.row.client_timestamp,
                server_received_at: item.row.server_received_at,
                mutation_seq: item.row.mutation_seq,
                applied_revision: item.row.applied_revision,
                summary,
                delta_chars,
                state_snapshot: state.clone(),
            });

            technical_logs.push(AnswerHistoryTechnicalLogRow {
                mutation_id: item.row.id.clone(),
                mutation_type: item.row.mutation_type.clone(),
                mutation_seq: item.row.mutation_seq,
                payload: item.row.payload.clone(),
                client_timestamp: item.row.client_timestamp,
                server_received_at: item.row.server_received_at,
                applied_revision: item.row.applied_revision,
            });
            emitted += 1;
        }

        let mut signals = self
            .build_target_signals(&checkpoints, context.submitted_at, target_type.clone())
            .await?;
        signals.extend(replay_signals);

        let resolved_from_catalog = target_catalog
            .iter()
            .find(|entry| entry.target_type == target_type && entry.target_id == target_id)
            .cloned()
            .or_else(|| {
                target_catalog
                    .iter()
                    .find(|entry| entry.target_id == target_id)
                    .cloned()
            });
        let resolved_target_type = resolved_from_catalog
            .as_ref()
            .map(|entry| entry.target_type.clone())
            .unwrap_or_else(|| target_type.clone());

        let module = resolved_from_catalog
            .as_ref()
            .map(|entry| entry.module.clone())
            .or_else(|| matching.first().map(|item| item.module.clone()))
            .unwrap_or_else(|| default_module_for_type(&resolved_target_type).to_string());
        let target_label = resolved_from_catalog
            .as_ref()
            .map(|entry| entry.label.clone())
            .unwrap_or_else(|| target_id.to_string());
        if matching.is_empty() {
            state = submitted_states
                .get(&(resolved_target_type.clone(), target_id.to_string()))
                .cloned()
                .unwrap_or(Value::Null);
        }

        Ok(AnswerHistoryTargetDetail {
            submission_id: context.submission_id,
            attempt_id: history_attempt_id,
            schedule_id: context.schedule_id,
            target_id: target_id.to_string(),
            target_label,
            module,
            target_type: resolved_target_type,
            final_state: state,
            replay_steps: checkpoints.clone(),
            checkpoints,
            technical_logs,
            signals,
        })
    }

    pub async fn export_target(
        &self,
        submission_id: Uuid,
        target_type: AnswerHistoryTargetType,
        target_id: &str,
        format: AnswerHistoryExportFormat,
    ) -> Result<AnswerHistoryExport, AnswerHistoryError> {
        let detail = self
            .get_target_detail(submission_id, target_type, target_id, None, usize::MAX)
            .await?;

        match format {
            AnswerHistoryExportFormat::Json => Ok(AnswerHistoryExport {
                format,
                filename: format!("answer-history-{}.json", detail.target_id),
                content_type: "application/json".to_string(),
                content: serde_json::to_string_pretty(&detail)
                    .map_err(|err| AnswerHistoryError::Validation(err.to_string()))?,
            }),
            AnswerHistoryExportFormat::Csv => {
                let mut csv = String::from(
                    "checkpointIndex,mutationId,mutationType,mutationSeq,clientTimestamp,serverReceivedAt,deltaChars,summary,stateSnapshot\n",
                );
                for checkpoint in &detail.checkpoints {
                    let state_json = serde_json::to_string(&checkpoint.state_snapshot)
                        .unwrap_or_else(|_| "{}".to_string())
                        .replace('"', "\"\"");
                    let summary = checkpoint.summary.replace('"', "\"\"");
                    csv.push_str(&format!(
                        "{},\"{}\",\"{}\",{},\"{}\",\"{}\",{},\"{}\",\"{}\"\n",
                        checkpoint.index,
                        checkpoint.mutation_id,
                        checkpoint.mutation_type,
                        checkpoint.mutation_seq,
                        checkpoint.client_timestamp.to_rfc3339(),
                        checkpoint.server_received_at.to_rfc3339(),
                        checkpoint.delta_chars,
                        summary,
                        state_json,
                    ));
                }

                Ok(AnswerHistoryExport {
                    format,
                    filename: format!("answer-history-{}.csv", detail.target_id),
                    content_type: "text/csv".to_string(),
                    content: csv,
                })
            }
        }
    }

    async fn load_context(
        &self,
        submission_id: Uuid,
    ) -> Result<SubmissionAttemptContextRow, AnswerHistoryError> {
        sqlx::query_as::<_, SubmissionAttemptContextRow>(
            r#"
            SELECT
                submissions.id AS submission_id,
                submissions.attempt_id AS attempt_id,
                submissions.schedule_id AS schedule_id,
                submissions.exam_id AS exam_id,
                submissions.cohort_name AS exam_title,
                versions.content_snapshot AS content_snapshot,
                versions.config_snapshot AS config_snapshot,
                attempts.answers AS answers,
                attempts.writing_answers AS writing_answers,
                attempts.final_submission AS final_submission,
                attempts.candidate_id AS candidate_id,
                attempts.candidate_name AS candidate_name,
                attempts.candidate_email AS candidate_email,
                attempts.created_at AS started_at,
                submissions.submitted_at AS submitted_at
            FROM student_submissions submissions
            JOIN student_attempts attempts ON attempts.id = submissions.attempt_id
            JOIN exam_versions versions ON versions.id = submissions.published_version_id
            WHERE submissions.id = ?
            LIMIT 1
            "#,
        )
        .bind(submission_id.to_string())
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AnswerHistoryError::NotFound)
    }

    async fn load_context_by_attempt(
        &self,
        attempt_id: Uuid,
    ) -> Result<SubmissionAttemptContextRow, AnswerHistoryError> {
        sqlx::query_as::<_, SubmissionAttemptContextRow>(
            r#"
            SELECT
                NULL AS submission_id,
                attempts.id AS attempt_id,
                attempts.schedule_id AS schedule_id,
                attempts.exam_id AS exam_id,
                attempts.exam_title AS exam_title,
                versions.content_snapshot AS content_snapshot,
                versions.config_snapshot AS config_snapshot,
                attempts.answers AS answers,
                attempts.writing_answers AS writing_answers,
                attempts.final_submission AS final_submission,
                attempts.candidate_id AS candidate_id,
                attempts.candidate_name AS candidate_name,
                attempts.candidate_email AS candidate_email,
                attempts.created_at AS started_at,
                attempts.submitted_at AS submitted_at
            FROM student_attempts attempts
            JOIN exam_versions versions ON versions.id = attempts.published_version_id
            WHERE attempts.id = ?
            LIMIT 1
            "#,
        )
        .bind(attempt_id.to_string())
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AnswerHistoryError::NotFound)
    }

    async fn load_mutations(
        &self,
        attempt_id: &str,
    ) -> Result<Vec<MutationRow>, AnswerHistoryError> {
        Ok(sqlx::query_as::<_, MutationRow>(
            r#"
            SELECT
                id,
                mutation_type,
                mutation_seq,
                payload,
                client_timestamp,
                server_received_at,
                applied_revision
            FROM student_attempt_mutations
            WHERE attempt_id = ?
            ORDER BY server_received_at ASC, mutation_seq ASC, id ASC
            "#,
        )
        .bind(attempt_id)
        .fetch_all(&self.pool)
        .await?)
    }

    async fn resolve_history_attempt_id(
        &self,
        context: &SubmissionAttemptContextRow,
    ) -> Result<String, AnswerHistoryError> {
        let primary_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM student_attempt_mutations WHERE attempt_id = ?",
        )
        .bind(&context.attempt_id)
        .fetch_one(&self.pool)
        .await?;
        if primary_count > 0 {
            return Ok(context.attempt_id.clone());
        }

        let anchor_time = context.submitted_at.unwrap_or(context.started_at);
        let fallback_attempt_id = sqlx::query_scalar::<_, String>(
            r#"
            SELECT
                attempts.id
            FROM student_attempts attempts
            JOIN student_attempt_mutations mutations
                ON mutations.attempt_id = attempts.id
            WHERE attempts.schedule_id = ?
              AND attempts.candidate_id = ?
            GROUP BY attempts.id, attempts.submitted_at, attempts.updated_at
            ORDER BY
                CASE WHEN attempts.submitted_at IS NULL THEN 1 ELSE 0 END ASC,
                ABS(TIMESTAMPDIFF(SECOND, COALESCE(attempts.submitted_at, attempts.updated_at), ?)) ASC,
                COUNT(mutations.id) DESC,
                MAX(mutations.server_received_at) DESC
            LIMIT 1
            "#,
        )
        .bind(&context.schedule_id)
        .bind(&context.candidate_id)
        .bind(anchor_time)
        .fetch_optional(&self.pool)
        .await?;

        Ok(fallback_attempt_id.unwrap_or_else(|| context.attempt_id.clone()))
    }

    async fn build_global_signals(
        &self,
        schedule_id: &str,
        attempt_id: &str,
        target_mutations: &[TargetMutation],
        submitted_at: Option<DateTime<Utc>>,
    ) -> Result<Vec<AnswerHistorySignal>, AnswerHistoryError> {
        let mut signals = Vec::new();

        if let (Some(last), Some(submitted)) = (
            target_mutations
                .iter()
                .max_by_key(|item| item.row.server_received_at),
            submitted_at,
        ) {
            let diff = submitted.signed_duration_since(last.row.server_received_at);
            if diff.num_seconds() >= 0 && diff.num_seconds() <= 60 {
                signals.push(AnswerHistorySignal {
                    signal_type: "LATE_FINAL_EDIT".to_string(),
                    severity: "medium".to_string(),
                    message: "Final change happened shortly before submission.".to_string(),
                    evidence: json!({
                        "secondsBeforeSubmission": diff.num_seconds(),
                        "mutationId": last.row.id,
                    }),
                });
            }
        }

        let audit_rows = sqlx::query_as::<_, AuditSignalRow>(
            r#"
            SELECT action_type, payload, created_at
            FROM session_audit_logs
            WHERE schedule_id = ? AND target_student_id = ?
            ORDER BY created_at DESC
            LIMIT 100
            "#,
        )
        .bind(schedule_id)
        .bind(attempt_id)
        .fetch_all(&self.pool)
        .await?;

        for row in audit_rows {
            if matches!(
                row.action_type.as_str(),
                "NETWORK_DISCONNECTED" | "HEARTBEAT_LOST" | "DEVICE_CONTINUITY_FAILED"
            ) {
                signals.push(AnswerHistorySignal {
                    signal_type: row.action_type,
                    severity: "high".to_string(),
                    message: "Operational integrity signal recorded during session.".to_string(),
                    evidence: json!({
                        "at": row.created_at,
                        "payload": row.payload,
                    }),
                });
            }
        }

        Ok(signals)
    }

    async fn build_target_signals(
        &self,
        checkpoints: &[AnswerHistoryCheckpoint],
        submitted_at: Option<DateTime<Utc>>,
        target_type: AnswerHistoryTargetType,
    ) -> Result<Vec<AnswerHistorySignal>, AnswerHistoryError> {
        let mut signals = Vec::new();

        if checkpoints.len() >= 2 {
            for window in checkpoints.windows(2) {
                if let [left, right] = window {
                    let gap = right
                        .server_received_at
                        .signed_duration_since(left.server_received_at)
                        .num_seconds();
                    if gap >= 300 {
                        signals.push(AnswerHistorySignal {
                            signal_type: "LONG_PAUSE_BEFORE_EDIT".to_string(),
                            severity: "low".to_string(),
                            message: "Long pause observed before a subsequent edit.".to_string(),
                            evidence: json!({
                                "pauseSeconds": gap,
                                "fromMutationId": left.mutation_id,
                                "toMutationId": right.mutation_id,
                            }),
                        });
                    }
                }
            }
        }

        if target_type == AnswerHistoryTargetType::Writing {
            for checkpoint in checkpoints {
                if checkpoint.delta_chars >= 80 {
                    signals.push(AnswerHistorySignal {
                        signal_type: "LARGE_TEXT_INCREASE".to_string(),
                        severity: "medium".to_string(),
                        message: "Large text increase detected within a single checkpoint."
                            .to_string(),
                        evidence: json!({
                            "deltaChars": checkpoint.delta_chars,
                            "mutationId": checkpoint.mutation_id,
                        }),
                    });
                    break;
                }
            }
        }

        if let (Some(last), Some(submitted)) = (checkpoints.last(), submitted_at) {
            let diff = submitted
                .signed_duration_since(last.server_received_at)
                .num_seconds();
            if diff >= 0 && diff <= 60 {
                signals.push(AnswerHistorySignal {
                    signal_type: "LATE_FINAL_EDIT".to_string(),
                    severity: "medium".to_string(),
                    message: "Final target edit happened close to submission.".to_string(),
                    evidence: json!({
                        "secondsBeforeSubmission": diff,
                        "mutationId": last.mutation_id,
                    }),
                });
            }
        }

        Ok(signals)
    }
}

fn classify_target_mutation(
    row: &MutationRow,
    catalog_index: &TargetCatalogIndex,
) -> Option<TargetMutation> {
    let payload = &row.payload;
    let normalized_type = row.mutation_type.as_str();
    let module = extract_payload_string(payload, &["module", "currentModule", "current_module"])
        .unwrap_or(
            if matches!(
                normalized_type,
                "SetEssayText" | "ClearEssayText" | "writing_answer"
            ) {
                "writing"
            } else {
                "objective"
            },
        )
        .to_string();
    let question_id =
        extract_payload_string(payload, &["questionId", "question_id", "currentQuestionId"]);
    let task_id = extract_payload_string(payload, &["taskId", "task_id", "currentTaskId"]);
    let slot_id = extract_payload_string(payload, &["slotId", "slot_id"]);
    let slot_index = extract_payload_usize(payload, &["slotIndex", "slot_index"]);

    if matches!(
        normalized_type,
        "SetEssayText" | "ClearEssayText" | "writing_answer"
    ) {
        let task_id = task_id?;
        return Some(TargetMutation {
            module,
            target_id: task_id.to_string(),
            target_type: AnswerHistoryTargetType::Writing,
            row: row.clone(),
        });
    }

    if let Some(question_id) = question_id {
        let target_id =
            resolve_objective_target_id(question_id, slot_id, slot_index, catalog_index);
        return Some(TargetMutation {
            module,
            target_id,
            target_type: AnswerHistoryTargetType::Objective,
            row: row.clone(),
        });
    }

    if let Some(task_id) = task_id {
        if catalog_index.writing_ids.contains(task_id)
            || module.eq_ignore_ascii_case("writing")
            || !catalog_index.objective_ids.contains(task_id)
        {
            return Some(TargetMutation {
                module,
                target_id: task_id.to_string(),
                target_type: AnswerHistoryTargetType::Writing,
                row: row.clone(),
            });
        }

        return Some(TargetMutation {
            module,
            target_id: task_id.to_string(),
            target_type: AnswerHistoryTargetType::Objective,
            row: row.clone(),
        });
    }

    None
}

fn apply_mutation_to_state(state: &Value, row: &MutationRow) -> Value {
    match row.mutation_type.as_str() {
        "answer" => extract_payload_value(&row.payload, &["value"])
            .cloned()
            .unwrap_or(Value::Null),
        "writing_answer" => extract_payload_value(&row.payload, &["value"])
            .cloned()
            .unwrap_or(Value::Null),
        "SetSlot" => {
            let mut slots = state.as_array().cloned().unwrap_or_default();
            let slot_index =
                extract_payload_usize(&row.payload, &["slotIndex", "slot_index"]).unwrap_or(0);
            while slots.len() <= slot_index {
                slots.push(Value::String(String::new()));
            }
            let value = extract_payload_string(&row.payload, &["value"])
                .unwrap_or("")
                .to_string();
            slots[slot_index] = Value::String(value);
            Value::Array(slots)
        }
        "ClearSlot" => {
            let mut slots = state.as_array().cloned().unwrap_or_default();
            let slot_index =
                extract_payload_usize(&row.payload, &["slotIndex", "slot_index"]).unwrap_or(0);
            while slots.len() <= slot_index {
                slots.push(Value::String(String::new()));
            }
            slots[slot_index] = Value::String(String::new());
            Value::Array(slots)
        }
        "SetScalar" => Value::String(
            extract_payload_string(&row.payload, &["value"])
                .unwrap_or("")
                .to_string(),
        ),
        "ClearScalar" => Value::String(String::new()),
        "SetChoice" => extract_payload_value(&row.payload, &["value"])
            .cloned()
            .unwrap_or(Value::Array(vec![])),
        "ClearChoice" => Value::Array(vec![]),
        "SetEssayText" => Value::String(
            extract_payload_string(&row.payload, &["value"])
                .unwrap_or("")
                .to_string(),
        ),
        "ClearEssayText" => Value::String(String::new()),
        "flag" => state.clone(),
        "position" => state.clone(),
        _ => state.clone(),
    }
}

fn describe_mutation(row: &MutationRow) -> String {
    match row.mutation_type.as_str() {
        "answer" => "Updated answer".to_string(),
        "writing_answer" => "Edited essay text".to_string(),
        "flag" => "Toggled flag".to_string(),
        "position" => "Moved cursor position".to_string(),
        "SetSlot" => format!(
            "Updated slot {}",
            extract_payload_usize(&row.payload, &["slotIndex", "slot_index"]).unwrap_or(0) + 1
        ),
        "ClearSlot" => format!(
            "Cleared slot {}",
            extract_payload_usize(&row.payload, &["slotIndex", "slot_index"]).unwrap_or(0) + 1
        ),
        "SetScalar" => "Updated answer".to_string(),
        "ClearScalar" => "Cleared answer".to_string(),
        "SetChoice" => "Updated choice selection".to_string(),
        "ClearChoice" => "Cleared choice selection".to_string(),
        "SetEssayText" => "Edited essay text".to_string(),
        "ClearEssayText" => "Cleared essay text".to_string(),
        _ => "Mutation applied".to_string(),
    }
}

fn value_char_len(value: &Value) -> i64 {
    match value {
        Value::String(text) => text.chars().count() as i64,
        Value::Array(items) => items.iter().map(value_char_len).sum::<i64>(),
        Value::Null => 0,
        _ => value.to_string().chars().count() as i64,
    }
}

fn canonical_value(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "null".to_string())
}

fn default_module_for_type(target_type: &AnswerHistoryTargetType) -> &'static str {
    match target_type {
        AnswerHistoryTargetType::Objective => "objective",
        AnswerHistoryTargetType::Writing => "writing",
    }
}

fn target_type_rank(target_type: &AnswerHistoryTargetType) -> u8 {
    match target_type {
        AnswerHistoryTargetType::Objective => 0,
        AnswerHistoryTargetType::Writing => 1,
    }
}

fn is_answered_value(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::String(text) => !text.trim().is_empty(),
        Value::Array(items) => items.iter().any(is_answered_value),
        _ => true,
    }
}

fn build_submitted_target_states(
    final_submission: Option<&Value>,
    answers_snapshot: &Value,
    writing_answers_snapshot: &Value,
) -> HashMap<(AnswerHistoryTargetType, String), Value> {
    let mut states = HashMap::new();
    if let Some(final_submission) = final_submission.and_then(Value::as_object) {
        if let Some(answers) = final_submission.get("answers").and_then(Value::as_object) {
            for (question_id, value) in answers {
                states.insert(
                    (AnswerHistoryTargetType::Objective, question_id.to_owned()),
                    value.clone(),
                );
            }
        }

        if let Some(writing_answers) = final_submission
            .get("writingAnswers")
            .and_then(Value::as_object)
        {
            for (task_id, value) in writing_answers {
                states.insert(
                    (AnswerHistoryTargetType::Writing, task_id.to_owned()),
                    value.clone(),
                );
            }
        }
    }

    if states.is_empty() {
        if let Some(answers) = answers_snapshot.as_object() {
            for (question_id, value) in answers {
                states.insert(
                    (AnswerHistoryTargetType::Objective, question_id.to_owned()),
                    value.clone(),
                );
            }
        }
    }

    if states
        .keys()
        .all(|(target_type, _)| *target_type == AnswerHistoryTargetType::Objective)
    {
        if let Some(writing_answers) = writing_answers_snapshot.as_object() {
            for (task_id, value) in writing_answers {
                states.insert(
                    (AnswerHistoryTargetType::Writing, task_id.to_owned()),
                    value.clone(),
                );
            }
        }
    }

    if states.is_empty() {
        return states;
    }

    if let Some(answers) = answers_snapshot.as_object() {
        for (question_id, value) in answers {
            states
                .entry((AnswerHistoryTargetType::Objective, question_id.to_owned()))
                .or_insert_with(|| value.clone());
        }
    }

    if let Some(writing_answers) = writing_answers_snapshot.as_object() {
        for (task_id, value) in writing_answers {
            states
                .entry((AnswerHistoryTargetType::Writing, task_id.to_owned()))
                .or_insert_with(|| value.clone());
        }
    }

    states
}

fn build_target_catalog(
    content_snapshot: &Value,
    config_snapshot: &Value,
) -> Vec<TargetCatalogEntry> {
    let objective_modules = build_objective_module_order(config_snapshot);
    let mut seen = HashSet::<(AnswerHistoryTargetType, String)>::new();
    let mut entries = Vec::<TargetCatalogEntry>::new();
    let mut objective_count_by_module = HashMap::<String, usize>::new();
    let mut writing_count = 0usize;

    for module in objective_modules {
        let targets = build_objective_targets_for_section(content_snapshot, &module);
        for target_id in targets {
            let key = (AnswerHistoryTargetType::Objective, target_id.clone());
            if !seen.insert(key) {
                continue;
            }
            let next = objective_count_by_module
                .entry(module.clone())
                .and_modify(|index| *index += 1)
                .or_insert(1);
            entries.push(TargetCatalogEntry {
                module: module.clone(),
                target_id,
                target_type: AnswerHistoryTargetType::Objective,
                label: format!("Question {}", next),
            });
        }
    }

    for task_id in build_writing_task_ids(config_snapshot, content_snapshot) {
        let key = (AnswerHistoryTargetType::Writing, task_id.clone());
        if !seen.insert(key) {
            continue;
        }
        writing_count += 1;
        entries.push(TargetCatalogEntry {
            module: "writing".to_string(),
            target_id: task_id,
            target_type: AnswerHistoryTargetType::Writing,
            label: format!("Task {}", writing_count),
        });
    }

    entries
}

fn build_target_catalog_index(entries: &[TargetCatalogEntry]) -> TargetCatalogIndex {
    let mut objective_ids = HashSet::new();
    let mut writing_ids = HashSet::new();
    let mut grouped_slot_targets = HashMap::<String, Vec<String>>::new();

    for entry in entries {
        match entry.target_type {
            AnswerHistoryTargetType::Objective => {
                objective_ids.insert(entry.target_id.clone());
                if let Some((root_id, _)) = entry.target_id.split_once(':') {
                    grouped_slot_targets
                        .entry(root_id.to_owned())
                        .or_default()
                        .push(entry.target_id.clone());
                }
            }
            AnswerHistoryTargetType::Writing => {
                writing_ids.insert(entry.target_id.clone());
            }
        }
    }

    let mut objective_slot_targets = HashMap::<(String, usize), String>::new();
    for (root_id, mut slot_targets) in grouped_slot_targets {
        if !objective_ids.contains(&root_id) {
            continue;
        }
        slot_targets.sort();
        for (index, target_id) in slot_targets.into_iter().enumerate() {
            objective_slot_targets.insert((root_id.clone(), index), target_id);
        }
    }

    TargetCatalogIndex {
        objective_ids,
        writing_ids,
        objective_slot_targets,
    }
}

fn build_target_catalog_lookup(
    entries: &[TargetCatalogEntry],
) -> HashMap<(AnswerHistoryTargetType, String), TargetCatalogEntry> {
    entries
        .iter()
        .map(|entry| {
            (
                (entry.target_type.clone(), entry.target_id.clone()),
                entry.clone(),
            )
        })
        .collect::<HashMap<_, _>>()
}

fn resolve_objective_target_id(
    question_id: &str,
    slot_id: Option<&str>,
    slot_index: Option<usize>,
    catalog_index: &TargetCatalogIndex,
) -> String {
    if let Some(slot_id) = slot_id {
        let composed = format!("{question_id}:{slot_id}");
        if catalog_index.objective_ids.contains(&composed) {
            return composed;
        }
    }

    if let Some(slot_index) = slot_index {
        if let Some(mapped) = catalog_index
            .objective_slot_targets
            .get(&(question_id.to_owned(), slot_index))
        {
            return mapped.clone();
        }

        let numbered = format!("{question_id}:slot:{}", slot_index + 1);
        if catalog_index.objective_ids.contains(&numbered) {
            return numbered;
        }
    }

    question_id.to_owned()
}

fn extract_payload_value<'a>(payload: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    let object = payload.as_object()?;

    for key in keys {
        if let Some(value) = object.get(*key) {
            return Some(value);
        }
    }

    for container_key in ["command", "payload", "mutation", "data"] {
        if let Some(nested) = object.get(container_key) {
            if let Some(value) = extract_payload_value(nested, keys) {
                return Some(value);
            }
        }
    }

    None
}

fn extract_payload_string<'a>(payload: &'a Value, keys: &[&str]) -> Option<&'a str> {
    extract_payload_value(payload, keys)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn extract_payload_usize(payload: &Value, keys: &[&str]) -> Option<usize> {
    extract_payload_value(payload, keys)
        .and_then(Value::as_i64)
        .and_then(|value| usize::try_from(value).ok())
}

fn build_writing_task_ids(config_snapshot: &Value, content_snapshot: &Value) -> Vec<String> {
    let mut ids = Vec::new();
    let mut seen = HashSet::new();
    if let Some(tasks) = config_snapshot
        .get("sections")
        .and_then(|sections| sections.get("writing"))
        .and_then(|writing| writing.get("tasks"))
        .and_then(Value::as_array)
    {
        for task in tasks {
            if let Some(id) = task.get("id").and_then(Value::as_str) {
                let value = id.to_owned();
                if seen.insert(value.clone()) {
                    ids.push(value);
                }
            }
        }
    }
    if let Some(tasks) = content_snapshot
        .get("writing")
        .and_then(|writing| writing.get("tasks"))
        .and_then(Value::as_array)
    {
        for task in tasks {
            if let Some(id) = task.get("id").and_then(Value::as_str) {
                let value = id.to_owned();
                if seen.insert(value.clone()) {
                    ids.push(value);
                }
            }
        }
    }
    ids
}

fn build_objective_module_order(config_snapshot: &Value) -> Vec<String> {
    let mut enabled = Vec::<(String, i64)>::new();
    let is_act = config_snapshot
        .get("general")
        .and_then(|general| general.get("type"))
        .and_then(Value::as_str)
        == Some("ACT");
    let section_keys = if is_act {
        vec!["science"]
    } else {
        vec!["listening", "reading"]
    };

    for section_key in section_keys {
        let section_config = config_snapshot
            .get("sections")
            .and_then(|sections| sections.get(section_key));
        let is_enabled = section_config
            .and_then(|section| section.get("enabled"))
            .and_then(Value::as_bool)
            .unwrap_or(section_key != "science");
        if !is_enabled {
            continue;
        }
        let order = section_config
            .and_then(|section| section.get("order"))
            .and_then(Value::as_i64)
            .unwrap_or(i64::MAX);
        enabled.push((section_key.to_string(), order));
    }

    enabled.sort_by(|left, right| left.1.cmp(&right.1).then(left.0.cmp(&right.0)));
    let mut ordered = enabled
        .into_iter()
        .map(|(section, _)| section)
        .collect::<Vec<_>>();

    if !is_act {
        for fallback in ["listening", "reading"] {
            if !ordered.iter().any(|section| section == fallback) {
                ordered.push(fallback.to_string());
            }
        }
    }
    ordered
}

fn build_objective_targets_for_section(content_snapshot: &Value, section_key: &str) -> Vec<String> {
    let mut targets = Vec::new();
    let mut seen = HashSet::<String>::new();

    match section_key {
        "reading" => {
            if let Some(passages) = content_snapshot
                .get("reading")
                .and_then(|reading| reading.get("passages"))
                .and_then(Value::as_array)
            {
                for passage in passages {
                    if let Some(blocks) = passage.get("blocks").and_then(Value::as_array) {
                        for block in blocks {
                            index_objective_block_targets(block, &mut targets, &mut seen);
                        }
                    }
                }
            }
        }
        "listening" => {
            if let Some(parts) = content_snapshot
                .get("listening")
                .and_then(|listening| listening.get("parts"))
                .and_then(Value::as_array)
            {
                for part in parts {
                    if let Some(blocks) = part.get("blocks").and_then(Value::as_array) {
                        for block in blocks {
                            index_objective_block_targets(block, &mut targets, &mut seen);
                        }
                    }
                }
            }
        }
        "science" => {
            if let Some(stimuli) = content_snapshot
                .get("science")
                .and_then(|science| science.get("stimuli"))
                .and_then(Value::as_array)
            {
                for stimulus in stimuli {
                    if let Some(blocks) = stimulus.get("blocks").and_then(Value::as_array) {
                        for block in blocks {
                            index_act_science_block_targets(block, &mut targets, &mut seen);
                        }
                    }
                }
            }
        }
        _ => {}
    }

    if let Some(questions) = content_snapshot
        .get(section_key)
        .and_then(|section| section.get("questions"))
        .and_then(Value::as_array)
    {
        for question in questions {
            if let Some(id) = question.get("id").and_then(Value::as_str) {
                register_target_id(&mut targets, &mut seen, id);
            }
        }
    }

    targets
}

fn index_act_science_block_targets(
    block: &Value,
    targets: &mut Vec<String>,
    seen: &mut HashSet<String>,
) {
    match block.get("type").and_then(Value::as_str) {
        Some("SINGLE_MCQ") | Some("MULTI_MCQ") => {
            register_question_array_targets(block, targets, seen);
        }
        _ => index_objective_block_targets(block, targets, seen),
    }
}

fn index_objective_block_targets(
    block: &Value,
    targets: &mut Vec<String>,
    seen: &mut HashSet<String>,
) {
    if register_sub_answer_tree_targets(block, targets, seen) {
        return;
    }

    let Some(block_type) = block.get("type").and_then(Value::as_str) else {
        return;
    };
    let block_id = block.get("id").and_then(Value::as_str);

    match block_type {
        "TFNG" | "CLOZE" | "MATCHING" | "MAP" | "SHORT_ANSWER" => {
            register_question_array_targets(block, targets, seen);
        }
        "SENTENCE_COMPLETION" | "NOTE_COMPLETION" => {
            if let Some(questions) = block.get("questions").and_then(Value::as_array) {
                for question in questions {
                    let Some(question_id) = question.get("id").and_then(Value::as_str) else {
                        continue;
                    };
                    register_target_id(targets, seen, question_id);
                    if let Some(blanks) = question.get("blanks").and_then(Value::as_array) {
                        for blank in blanks {
                            if let Some(blank_id) = blank.get("id").and_then(Value::as_str) {
                                register_target_id(
                                    targets,
                                    seen,
                                    &format!("{question_id}:{blank_id}"),
                                );
                            }
                        }
                    }
                }
            }
        }
        "MULTI_MCQ" | "SINGLE_MCQ" => {
            if let Some(block_id) = block_id {
                register_target_id(targets, seen, block_id);
            }
        }
        "DIAGRAM_LABELING" => {
            register_block_slot_targets(block, block_id, "labels", targets, seen);
        }
        "FLOW_CHART" => {
            register_block_slot_targets(block, block_id, "steps", targets, seen);
        }
        "TABLE_COMPLETION" => {
            register_block_slot_targets(block, block_id, "cells", targets, seen);
        }
        "CLASSIFICATION" => {
            register_block_slot_targets(block, block_id, "items", targets, seen);
        }
        "MATCHING_FEATURES" => {
            register_block_slot_targets(block, block_id, "features", targets, seen);
        }
        _ => {}
    }
}

fn register_sub_answer_tree_targets(
    block: &Value,
    targets: &mut Vec<String>,
    seen: &mut HashSet<String>,
) -> bool {
    let enabled = block
        .get("subAnswerModeEnabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !enabled {
        return false;
    }

    let Some(block_id) = block.get("id").and_then(Value::as_str) else {
        return false;
    };
    let Some(roots) = block.get("answerTree").and_then(Value::as_array) else {
        return false;
    };
    if roots.is_empty() {
        return false;
    }

    for root in roots {
        let Some(root_id) = root.get("id").and_then(Value::as_str) else {
            continue;
        };
        let mut stack: Vec<&Value> = vec![root];
        while let Some(node) = stack.pop() {
            let children = node.get("children").and_then(Value::as_array);
            let is_leaf = children.map(|items| items.is_empty()).unwrap_or(true);
            if is_leaf {
                if let Some(node_id) = node.get("id").and_then(Value::as_str) {
                    register_target_id(
                        targets,
                        seen,
                        &format!("{block_id}::tree::{root_id}::{node_id}"),
                    );
                }
                continue;
            }
            if let Some(children) = children {
                for child in children {
                    stack.push(child);
                }
            }
        }
    }

    true
}

fn register_question_array_targets(
    block: &Value,
    targets: &mut Vec<String>,
    seen: &mut HashSet<String>,
) {
    if let Some(questions) = block.get("questions").and_then(Value::as_array) {
        for question in questions {
            if let Some(question_id) = question.get("id").and_then(Value::as_str) {
                register_target_id(targets, seen, question_id);
            }
        }
    }
}

fn register_block_slot_targets(
    block: &Value,
    block_id: Option<&str>,
    slot_key: &str,
    targets: &mut Vec<String>,
    seen: &mut HashSet<String>,
) {
    let Some(block_id) = block_id else {
        return;
    };
    register_target_id(targets, seen, block_id);
    if let Some(slots) = block.get(slot_key).and_then(Value::as_array) {
        for slot in slots {
            if let Some(slot_id) = slot.get("id").and_then(Value::as_str) {
                register_target_id(targets, seen, &format!("{block_id}:{slot_id}"));
            }
        }
    }
}

fn register_target_id(targets: &mut Vec<String>, seen: &mut HashSet<String>, target_id: &str) {
    let target = target_id.to_owned();
    if seen.insert(target.clone()) {
        targets.push(target);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn act_science_answer_history_indexes_each_question_inside_stimulus() {
        let config_snapshot = json!({
            "general": {"type": "ACT"},
            "sections": {
                "science": {"enabled": true, "order": 1},
                "reading": {"enabled": false},
                "listening": {"enabled": false}
            }
        });
        let content_snapshot = json!({
            "science": {
                "stimuli": [{
                    "id": "stimulus-1",
                    "blocks": [{
                        "id": "science-block-1",
                        "type": "SINGLE_MCQ",
                        "questions": [
                            {"id": "science-q-1"},
                            {"id": "science-q-2"}
                        ]
                    }]
                }]
            }
        });

        assert_eq!(
            build_objective_module_order(&config_snapshot),
            vec!["science"]
        );
        assert_eq!(
            build_objective_targets_for_section(&content_snapshot, "science"),
            vec!["science-q-1", "science-q-2"]
        );
    }
}
