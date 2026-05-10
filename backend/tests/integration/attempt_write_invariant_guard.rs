use std::fs;
use std::path::{Path, PathBuf};

fn collect_rs_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_rs_files(&path, out);
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) == Some("rs") {
            out.push(path);
        }
    }
}

fn has_protected_attempt_write(sqlish: &str) -> bool {
    let s = sqlish.to_lowercase();
    if !s.contains("update student_attempts") {
        return false;
    }
    s.contains("answers =")
        || s.contains("writing_answers =")
        || s.contains("flags =")
        || s.contains("final_submission =")
        || s.contains("submitted_at =")
}

fn has_attempt_row_lock(sqlish: &str) -> bool {
    let s = sqlish.to_lowercase();
    s.contains("select * from student_attempts where id = ? for update")
}

fn workspace_root() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .join("../..")
        .canonicalize()
        .expect("workspace root must resolve")
}

#[test]
fn protected_attempt_columns_are_only_written_by_delivery_writer() {
    let root = workspace_root();
    let allowed_files = [
        root.join("crates/application/src/delivery.rs"),
        root.join("crates/application/src/delivery/mod.rs"),
    ];

    let mut files = Vec::new();
    collect_rs_files(&root.join("crates"), &mut files);

    let mut violations = Vec::new();
    for file in files {
        if allowed_files.iter().any(|allowed| file == *allowed) {
            continue;
        }
        let Ok(content) = fs::read_to_string(&file) else {
            continue;
        };
        if has_protected_attempt_write(&content) {
            violations.push(file);
        }
    }

    assert!(
        violations.is_empty(),
        "Protected student_attempts columns must only be written in delivery writer (delivery.rs or delivery/mod.rs). Violations: {:?}",
        violations
    );
}

#[test]
fn delivery_writer_declares_attempt_row_lock_for_protected_writes() {
    let root = workspace_root();
    let candidates = [
        root.join("crates/application/src/delivery.rs"),
        root.join("crates/application/src/delivery/mod.rs"),
    ];
    let delivery = candidates
        .iter()
        .find(|path| path.exists())
        .cloned()
        .expect("delivery writer file must exist");
    let content = fs::read_to_string(&delivery).expect("delivery writer must be readable");

    assert!(
        has_protected_attempt_write(&content),
        "delivery writer no longer contains protected student_attempts writes; update guard expectations"
    );
    assert!(
        has_attempt_row_lock(&content),
        "delivery writer must include an explicit attempt-row FOR UPDATE lock query"
    );
}
