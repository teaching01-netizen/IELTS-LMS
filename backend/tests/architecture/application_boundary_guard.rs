//! Architecture boundary guard for the application crate.
//!
//! The declared architecture (AGENTS.md) is: application owns use cases and SQL;
//! infrastructure provides shared technical services. Cross-crate imports of
//! infrastructure from application are a legacy ratchet: the allowlist below
//! pins exactly which files may depend on which infrastructure root modules.
//! Shrinking an entry tightens the guard; any NEW dependency fails this test
//! and requires a deliberate, reviewed allowlist change.
//!
//! This test also bans the historical scheduling <-> delivery module cycle:
//! shared attempt transaction helpers live in `attempt_tx`, which must stay a
//! leaf module (no `crate::` dependencies).

use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;

/// file -> allowed infrastructure root modules.
const ALLOWED_INFRA_ROOTS: &[(&str, &[&str])] = &[
    (
        "auth.rs",
        &["auth", "config"], // crypto/session token helpers (shared technical service)
    ),
    ("builder.rs", &["authorization"]),
    (
        "delivery/mod.rs",
        &["auth", "config", "idempotency", "live_mode"],
    ),
    ("grading/mod.rs", &["authorization"]),
    ("media.rs", &["object_store"]),
    (
        "proctoring.rs",
        &["authorization", "live_mode", "live_update_bus", "outbox"],
    ),
    ("scheduling.rs", &["authorization"]),
];

/// Module imports that would recreate the scheduling/delivery cycle or break
/// the attempt_tx leaf invariant: (file, forbidden import prefix).
const FORBIDDEN_INTERNAL_IMPORTS: &[(&str, &str)] = &[
    ("scheduling.rs", "use crate::delivery"),
    // attempt_tx is the shared leaf; it must not depend on sibling modules.
    ("attempt_tx.rs", "use crate::"),
];

const INFRA: &str = "ielts_backend_infrastructure";

fn application_src() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src")
}

/// Extract the root module names referenced after `ielts_backend_infrastructure`
/// for both flat paths (`infra::auth::X`) and brace groups (`infra::{a::{..}, b}`).
fn infra_roots(source: &str) -> BTreeSet<String> {
    let mut roots = BTreeSet::new();
    let bytes = source.as_bytes();
    let mut i = 0;
    while let Some(pos) = source[i..].find(INFRA) {
        let start = i + pos + INFRA.len();
        i = start;
        if !source[start..].starts_with("::") {
            continue;
        }
        let mut cursor = start + 2;
        // skip whitespace/newlines
        while bytes.get(cursor).is_some_and(|b| b.is_ascii_whitespace()) {
            cursor += 1;
        }
        if bytes.get(cursor) == Some(&b'{') {
            // balanced-brace group: take the first ident of every top-level item
            let mut depth = 0usize;
            let mut item_start = cursor + 1;
            let mut j = cursor;
            while j < bytes.len() {
                match bytes[j] {
                    b'{' => depth += 1,
                    b'}' => {
                        depth -= 1;
                        if depth == 0 {
                            push_first_ident(source, item_start, j, &mut roots);
                            break;
                        }
                    }
                    b',' if depth == 1 => {
                        push_first_ident(source, item_start, j, &mut roots);
                        item_start = j + 1;
                    }
                    _ => {}
                }
                j += 1;
            }
            i = j;
        } else {
            // flat path: infra::root::...
            let end = source[cursor..]
                .find(|c: char| !(c.is_alphanumeric() || c == '_' || c == ':'))
                .map(|offset| cursor + offset)
                .unwrap_or(source.len());
            let path = &source[cursor..end];
            if let Some(root) = path.split("::").next() {
                if !root.is_empty() {
                    roots.insert(root.to_owned());
                }
            }
            i = end;
        }
    }
    roots
}

fn push_first_ident(source: &str, from: usize, to: usize, roots: &mut BTreeSet<String>) {
    let item = source[from..to].trim();
    if let Some(first) = item.split("::").next() {
        let ident = first.trim();
        if !ident.is_empty() && ident.chars().all(|c| c.is_alphanumeric() || c == '_') {
            roots.insert(ident.to_owned());
        }
    }
}

fn walk_rs_files(dir: &PathBuf) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut stack = vec![dir.clone()];
    while let Some(current) = stack.pop() {
        for entry in fs::read_dir(&current)
            .expect("readable application src directory")
            .flatten()
        {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().and_then(|e| e.to_str()) == Some("rs") {
                files.push(path);
            }
        }
    }
    files
}

fn expected_roots(file: &str) -> BTreeSet<String> {
    ALLOWED_INFRA_ROOTS
        .iter()
        .find(|(allowed_file, _)| *allowed_file == file)
        .map(|(_, roots)| roots.iter().map(|r| r.to_string()).collect())
        .unwrap_or_default()
}

#[test]
fn application_infrastructure_imports_match_ratchet() {
    let src = application_src();
    let mut checked = 0;
    let mut failures: Vec<String> = Vec::new();

    let entries = walk_rs_files(&src);
    for path in &entries {
        if path.extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }
        let rel = path
            .strip_prefix(&src)
            .unwrap()
            .to_string_lossy()
            .to_string();
        let source = fs::read_to_string(&path).expect("readable source file");
        let actual = infra_roots(&source);
        if actual.is_empty() {
            continue;
        }
        checked += 1;
        let expected = expected_roots(&rel);
        let unexpected: Vec<_> = actual.difference(&expected).cloned().collect();
        let removed: Vec<_> = expected.difference(&actual).cloned().collect();
        if !unexpected.is_empty() {
            failures.push(format!(
                "{rel}: NEW infrastructure dependency {:?} — not in the ratchet allowlist",
                unexpected
            ));
        }
        if !removed.is_empty() {
            failures.push(format!(
                "{rel}: infrastructure dependency removed {:?} — shrink the allowlist to tighten the ratchet",
                removed
            ));
        }
    }

    assert_eq!(
        checked,
        ALLOWED_INFRA_ROOTS.len(),
        "every file importing infrastructure must be in ALLOWED_INFRA_ROOTS; files checked: {checked}"
    );
    assert!(
        failures.is_empty(),
        "application -> infrastructure boundary violations:\n{}",
        failures.join("\n")
    );
}

#[test]
fn application_internal_module_imports_stay_acyclic() {
    let src = application_src();
    let mut failures: Vec<String> = Vec::new();

    for (file, forbidden) in FORBIDDEN_INTERNAL_IMPORTS {
        let path = src.join(file);
        let source = fs::read_to_string(&path)
            .unwrap_or_else(|_| panic!("{file} must exist in application/src"));
        if let Some(line) = source
            .lines()
            .find(|l| l.trim_start().starts_with(forbidden))
        {
            failures.push(format!(
                "{file}: forbidden import `{line}` recreates a module cycle"
            ));
        }
    }

    assert!(
        failures.is_empty(),
        "application internal module cycle violations:\n{}",
        failures.join("\n")
    );
}
