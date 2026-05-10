use std::{env, time::Duration};

use ielts_backend_application::grading::{GradingService, ObjectiveAutoGradingBackfillRequest};
use sqlx::mysql::MySqlPoolOptions;

#[derive(Debug, Clone, Default)]
struct Args {
    apply: bool,
    schedule_id: Option<String>,
    exam_id: Option<String>,
    published_version_id: Option<String>,
    attempt_id: Option<String>,
    submission_id: Option<String>,
    limit: Option<u64>,
}

fn usage() -> String {
    [
        "Usage: cargo run -p ielts-backend-api --bin backfill_objective_auto_grading -- [options]",
        "",
        "Options:",
        "  --apply                        Persist backfill updates (default is dry-run)",
        "  --schedule-id <id>            Limit to one schedule id",
        "  --exam-id <id>                Limit to one exam id",
        "  --published-version-id <id>   Limit to one published version id",
        "  --attempt-id <id>             Limit to one attempt id",
        "  --submission-id <id>          Limit to one submission id",
        "  --limit <n>                   Max attempts to scan",
        "  --help, -h                    Show this help",
        "",
        "Examples:",
        "  cargo run -p ielts-backend-api --bin backfill_objective_auto_grading -- --schedule-id <schedule-id>",
        "  cargo run -p ielts-backend-api --bin backfill_objective_auto_grading -- --schedule-id <schedule-id> --apply",
    ]
    .join("\n")
}

fn parse_non_empty(
    args: &mut impl Iterator<Item = String>,
    flag: &str,
) -> Result<Option<String>, String> {
    let Some(value) = args.next() else {
        return Err(format!("Missing value for {flag}\n\n{}", usage()));
    };
    let trimmed = value.trim().to_owned();
    if trimmed.is_empty() {
        return Err(format!("Value for {flag} cannot be blank\n\n{}", usage()));
    }
    Ok(Some(trimmed))
}

fn parse_u64(args: &mut impl Iterator<Item = String>, flag: &str) -> Result<Option<u64>, String> {
    let Some(value) = args.next() else {
        return Err(format!("Missing value for {flag}\n\n{}", usage()));
    };
    let parsed = value
        .parse::<u64>()
        .map_err(|_| format!("Invalid value for {flag}: {value}\n\n{}", usage()))?;
    if parsed == 0 {
        return Err(format!(
            "Value for {flag} must be greater than 0\n\n{}",
            usage()
        ));
    }
    Ok(Some(parsed))
}

fn parse_args() -> Result<Args, String> {
    let mut args = env::args().skip(1);
    let mut parsed = Args::default();

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--apply" => parsed.apply = true,
            "--schedule-id" => parsed.schedule_id = parse_non_empty(&mut args, "--schedule-id")?,
            "--exam-id" => parsed.exam_id = parse_non_empty(&mut args, "--exam-id")?,
            "--published-version-id" => {
                parsed.published_version_id = parse_non_empty(&mut args, "--published-version-id")?
            }
            "--attempt-id" => parsed.attempt_id = parse_non_empty(&mut args, "--attempt-id")?,
            "--submission-id" => {
                parsed.submission_id = parse_non_empty(&mut args, "--submission-id")?
            }
            "--limit" => parsed.limit = parse_u64(&mut args, "--limit")?,
            "--help" | "-h" => return Err(usage()),
            unknown => return Err(format!("Unknown argument: {unknown}\n\n{}", usage())),
        }
    }

    Ok(parsed)
}

fn database_url_from_env() -> Result<String, String> {
    env::var("DATABASE_MIGRATOR_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            env::var("DATABASE_DIRECT_URL")
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
        .or_else(|| {
            env::var("DATABASE_URL")
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
        .ok_or_else(|| {
            "DATABASE_MIGRATOR_URL, DATABASE_DIRECT_URL, or DATABASE_URL must be set".to_owned()
        })
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let args = match parse_args() {
        Ok(value) => value,
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(1);
        }
    };

    let database_url = database_url_from_env()?;
    let pool = MySqlPoolOptions::new()
        .max_connections(4)
        .acquire_timeout(Duration::from_secs(20))
        .connect(&database_url)
        .await?;

    let service = GradingService::new(pool);
    let report = service
        .backfill_objective_auto_grading(ObjectiveAutoGradingBackfillRequest {
            apply: args.apply,
            schedule_id: args.schedule_id,
            exam_id: args.exam_id,
            published_version_id: args.published_version_id,
            attempt_id: args.attempt_id,
            submission_id: args.submission_id,
            limit: args.limit,
        })
        .await?;

    println!(
        "Objective auto-grading backfill complete (apply={})",
        args.apply
    );
    println!("attempts_scanned={}", report.attempts_scanned);
    println!("submissions_matched={}", report.submissions_matched);
    println!("submissions_missing={}", report.submissions_missing);
    println!("sections_checked={}", report.sections_checked);
    println!("sections_needing_update={}", report.sections_needing_update);
    println!("sections_updated={}", report.sections_updated);
    println!("submissions_updated={}", report.submissions_updated);

    if !args.apply {
        println!("Dry-run only. Re-run with --apply to persist updates.");
    }

    Ok(())
}
