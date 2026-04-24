//! Exam content validation module.
//!
//! This module provides comprehensive validation for exam content and configuration,
//! ensuring that exams meet all requirements before they can be published.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// A validation error with field path and message.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ValidationError {
    pub field: String,
    pub message: String,
}

/// A validation warning with field path and message.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ValidationWarning {
    pub field: String,
    pub message: String,
}

/// Result of validating exam content.
#[derive(Debug, Clone, Default)]
pub struct ValidationResult {
    pub errors: Vec<ValidationError>,
    pub warnings: Vec<ValidationWarning>,
}

impl ValidationResult {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_valid(&self) -> bool {
        self.errors.is_empty()
    }

    pub fn add_error(&mut self, field: impl Into<String>, message: impl Into<String>) {
        self.errors.push(ValidationError {
            field: field.into(),
            message: message.into(),
        });
    }

    pub fn add_warning(&mut self, field: impl Into<String>, message: impl Into<String>) {
        self.warnings.push(ValidationWarning {
            field: field.into(),
            message: message.into(),
        });
    }
}

/// Validates exam content snapshot and config snapshot.
pub fn validate_exam_content(
    content: &serde_json::Value,
    config: &serde_json::Value,
) -> ValidationResult {
    let mut result = ValidationResult::new();

    // Validate config structure
    validate_config(config, &mut result);

    // Validate content structure based on enabled modules
    validate_content(content, config, &mut result);

    result
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
    }
}

fn question_block_field_prefix(
    module: &str,
    container_field: &str,
    container_idx: usize,
    blocks_field: &str,
    block_idx: usize,
) -> String {
    format!(
        "content.{}.{}[{}].{}[{}]",
        module, container_field, container_idx, blocks_field, block_idx
    )
}

fn validate_config(config: &serde_json::Value, result: &mut ValidationResult) {
    let Some(config_obj) = config.as_object() else {
        result.add_error("config", "Configuration is missing or invalid");
        return;
    };

    // Validate sections configuration
    let sections = config_obj.get("sections").and_then(|s| s.as_object());
    if sections.is_none() {
        result.add_error("config.sections", "Sections configuration is missing");
        return;
    }
    let sections = sections.unwrap();

    // Check if at least one module is enabled
    let mut enabled_modules = Vec::new();
    for module in ["reading", "listening", "writing", "speaking"] {
        if let Some(module_config) = sections.get(module).and_then(|m| m.as_object()) {
            if module_config
                .get("enabled")
                .and_then(|e| e.as_bool())
                .unwrap_or(false)
            {
                enabled_modules.push(module);
            }
        }
    }

    if enabled_modules.is_empty() {
        result.add_error("config.sections", "At least one module must be enabled");
    }

    // Validate reading band score table if reading is enabled
    if enabled_modules.contains(&"reading") {
        if let Some(reading_config) = sections.get("reading").and_then(|r| r.as_object()) {
            validate_band_score_table(reading_config, "reading", result);
        }
    }

    // Validate listening band score table if listening is enabled
    if enabled_modules.contains(&"listening") {
        if let Some(listening_config) = sections.get("listening").and_then(|l| l.as_object()) {
            validate_band_score_table(listening_config, "listening", result);
        }
    }
}

fn validate_band_score_table(
    module_config: &serde_json::Map<String, serde_json::Value>,
    module_name: &str,
    result: &mut ValidationResult,
) {
    let band_table = module_config.get("bandScoreTable");
    match band_table {
        None => {
            result.add_error(
                format!("config.sections.{}.bandScoreTable", module_name),
                format!("{} band score table is missing", capitalize(module_name)),
            );
        }
        Some(table)
            if table.is_null() || (table.is_object() && table.as_object().unwrap().is_empty()) =>
        {
            result.add_error(
                format!("config.sections.{}.bandScoreTable", module_name),
                format!("{} band score table is empty", capitalize(module_name)),
            );
        }
        Some(table) if table.is_object() => {
            let table_obj = table.as_object().unwrap();
            if table_obj.len() < 10 {
                result.add_warning(
                    format!("config.sections.{}.bandScoreTable", module_name),
                    format!(
                        "{} band score table has few entries (expected ~40 for IELTS)",
                        capitalize(module_name)
                    ),
                );
            }
        }
        Some(_) => {
            result.add_error(
                format!("config.sections.{}.bandScoreTable", module_name),
                format!(
                    "{} band score table must be an object mapping raw score to band score",
                    capitalize(module_name)
                ),
            );
        }
    }
}

fn validate_content(
    content: &serde_json::Value,
    config: &serde_json::Value,
    result: &mut ValidationResult,
) {
    let Some(content_obj) = content.as_object() else {
        result.add_error("content", "Content is missing or invalid");
        return;
    };

    let empty_map = serde_json::Map::new();
    let sections = config
        .get("sections")
        .and_then(|s| s.as_object())
        .unwrap_or(&empty_map);

    // Validate reading content if enabled
    if is_module_enabled(sections, "reading") {
        validate_reading_content(content_obj, result);
    }

    // Validate listening content if enabled
    if is_module_enabled(sections, "listening") {
        validate_listening_content(content_obj, result);
    }

    // Validate writing content if enabled
    if is_module_enabled(sections, "writing") {
        validate_writing_content(content_obj, result);
    }

    // Validate speaking content if enabled
    if is_module_enabled(sections, "speaking") {
        validate_speaking_content(content_obj, result);
    }

    // Check for ID collisions across the exam
    validate_id_integrity(content_obj, result);
}

fn is_module_enabled(sections: &serde_json::Map<String, serde_json::Value>, module: &str) -> bool {
    sections
        .get(module)
        .and_then(|m| m.as_object())
        .and_then(|m| m.get("enabled"))
        .and_then(|e| e.as_bool())
        .unwrap_or(false)
}

fn validate_id_integrity(
    content: &serde_json::Map<String, serde_json::Value>,
    result: &mut ValidationResult,
) {
    // Enforce ID uniqueness *within each array* of objects that carry an `id`.
    //
    // Rationale: some IDs (e.g. rubric criteria like "lexical" / "grammar") are
    // intentionally reused across different parts of the schema. A global
    // uniqueness constraint produces false positives. Arrays (siblings) are
    // where collisions actually break editing / lookups.
    let mut duplicates: HashSet<String> = HashSet::new();

    fn collect_array_duplicates(value: &serde_json::Value, duplicates: &mut HashSet<String>) {
        match value {
            serde_json::Value::Array(arr) => {
                let mut seen_in_array: HashSet<String> = HashSet::new();
                for child in arr {
                    if let Some(obj) = child.as_object() {
                        if let Some(id) = obj.get("id").and_then(|v| v.as_str()) {
                            let id = id.to_owned();
                            if !seen_in_array.insert(id.clone()) {
                                duplicates.insert(id);
                            }
                        }
                    }
                }

                for child in arr {
                    collect_array_duplicates(child, duplicates);
                }
            }
            serde_json::Value::Object(map) => {
                for child in map.values() {
                    collect_array_duplicates(child, duplicates);
                }
            }
            _ => {}
        }
    }

    for value in content.values() {
        collect_array_duplicates(value, &mut duplicates);
    }

    if !duplicates.is_empty() {
        let mut duplicates_sorted: Vec<String> = duplicates.into_iter().collect();
        duplicates_sorted.sort();
        result.add_error(
            "content.idIntegrity",
            format!("Duplicate IDs found: {}", duplicates_sorted.join(", ")),
        );
    }
}

fn validate_reading_content(
    content: &serde_json::Map<String, serde_json::Value>,
    result: &mut ValidationResult,
) {
    let passages = content
        .get("reading")
        .and_then(|r| r.as_object())
        .and_then(|r| r.get("passages"))
        .and_then(|p| p.as_array());

    match passages {
        None => {
            result.add_error("content.reading.passages", "Reading passages are missing");
        }
        Some(passages) if passages.is_empty() => {
            result.add_error(
                "content.reading.passages",
                "At least one reading passage is required",
            );
        }
        Some(passages) => {
            let mut total_questions = 0;
            for (idx, passage) in passages.iter().enumerate() {
                let passage_questions = validate_passage(passage, idx, result);
                total_questions += passage_questions;
            }

            if total_questions == 0 {
                result.add_error(
                    "content.reading.questions",
                    "Reading module has no questions",
                );
            } else if total_questions < 20 {
                result.add_warning(
                    "content.reading.questions",
                    format!(
                        "Reading has only {} questions (recommended: 40)",
                        total_questions
                    ),
                );
            }
        }
    }
}

fn validate_passage(passage: &serde_json::Value, idx: usize, result: &mut ValidationResult) -> i32 {
    let Some(passage_obj) = passage.as_object() else {
        result.add_error(
            format!("content.reading.passages[{}]", idx),
            "Invalid passage structure",
        );
        return 0;
    };

    if passage_obj
        .get("title")
        .and_then(|t| t.as_str())
        .map(|s| s.trim().is_empty())
        .unwrap_or(true)
    {
        result.add_error(
            format!("content.reading.passages[{}].title", idx),
            "Passage title is required",
        );
    }

    let (blocks, blocks_field) = passage_obj
        .get("blocks")
        .and_then(|b| b.as_array())
        .map(|blocks| (Some(blocks), "blocks"))
        .unwrap_or_else(|| {
            let blocks = passage_obj.get("questionBlocks").and_then(|b| b.as_array());
            (blocks, "questionBlocks")
        });
    match &blocks {
        None => {
            result.add_warning(
                format!("content.reading.passages[{}].{}", idx, blocks_field),
                "Passage has no question blocks",
            );
            0
        }
        Some(blocks) if blocks.is_empty() => {
            result.add_warning(
                format!("content.reading.passages[{}].{}", idx, blocks_field),
                "Passage has no question blocks",
            );
            0
        }
        Some(blocks) => {
            let mut question_count = 0;
            for (block_idx, block) in blocks.iter().enumerate() {
                let block_questions =
                    validate_question_block(block, idx, block_idx, "reading", "passages", blocks_field, result);
                question_count += block_questions;
            }
            question_count
        }
    }
}

fn validate_question_block(
    block: &serde_json::Value,
    container_idx: usize,
    block_idx: usize,
    module: &str,
    container_field: &str,
    blocks_field: &str,
    result: &mut ValidationResult,
) -> i32 {
    let field_prefix = question_block_field_prefix(
        module,
        container_field,
        container_idx,
        blocks_field,
        block_idx,
    );
    let Some(block_obj) = block.as_object() else {
        result.add_error(field_prefix, "Invalid question block structure");
        return 0;
    };

    let block_type = block_obj
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or("unknown");

    match block_type {
        "SINGLE_MCQ" => validate_single_mcq(block_obj, &field_prefix, result),
        "SHORT_ANSWER" => validate_short_answer(block_obj, &field_prefix, result),
        "SENTENCE_COMPLETION" => {
            validate_sentence_completion(block_obj, &field_prefix, result)
        }
        "DIAGRAM_LABELING" => {
            validate_diagram_labeling(block_obj, &field_prefix, result)
        }
        "FLOW_CHART" => validate_flow_chart(block_obj, &field_prefix, result),
        "TABLE_COMPLETION" => {
            validate_table_completion(block_obj, &field_prefix, result)
        }
        "NOTE_COMPLETION" => {
            validate_note_completion(block_obj, &field_prefix, result)
        }
        "CLASSIFICATION" => {
            validate_classification(block_obj, &field_prefix, result)
        }
        "MATCHING_FEATURES" => {
            validate_matching_features(block_obj, &field_prefix, result)
        }
        "TFNG" | "CLOZE" | "MATCHING" | "MAP" | "MULTI_MCQ" => count_questions_in_block(block_obj),
        _ => {
            result.add_warning(
                format!("{}.type", field_prefix),
                format!("Unknown question type: {}", block_type),
            );
            0
        }
    }
}

fn validate_single_mcq(
    block: &serde_json::Map<String, serde_json::Value>,
    field_prefix: &str,
    result: &mut ValidationResult,
) -> i32 {
    if block
        .get("stem")
        .and_then(|s| s.as_str())
        .map(|s| s.trim().is_empty())
        .unwrap_or(true)
    {
        result.add_error(
            format!("{}.stem", field_prefix),
            "Question stem is required",
        );
    }

    let options = block.get("options").and_then(|o| o.as_array());
    match options {
        None => {
            result.add_error(
                format!("{}.options", field_prefix),
                "Options are required for MCQ",
            );
            0
        }
        Some(opts) if opts.len() < 2 => {
            result.add_error(
                format!("{}.options", field_prefix),
                "At least 2 options are required for MCQ",
            );
            0
        }
        Some(opts) => {
            let correct_count = opts
                .iter()
                .filter(|opt| {
                    opt.as_object()
                        .and_then(|o| o.get("isCorrect"))
                        .and_then(|c| c.as_bool())
                        .unwrap_or(false)
                })
                .count();

            if correct_count == 0 {
                result.add_error(
                    format!("{}.options", field_prefix),
                    "At least one option must be marked as correct",
                );
            } else if correct_count > 1 {
                result.add_error(
                    format!("{}.options", field_prefix),
                    "Exactly one option must be marked as correct for SINGLE_MCQ",
                );
            }

            for (opt_idx, opt) in opts.iter().enumerate() {
                if opt
                    .as_object()
                    .and_then(|o| o.get("text"))
                    .and_then(|t| t.as_str())
                    .map(|s| s.trim().is_empty())
                    .unwrap_or(true)
                {
                    result.add_error(
                        format!("{}.options[{}].text", field_prefix, opt_idx),
                        "Option text is required",
                    );
                }
            }

            1
        }
    }
}

fn validate_short_answer(
    block: &serde_json::Map<String, serde_json::Value>,
    field_prefix: &str,
    result: &mut ValidationResult,
) -> i32 {
    let questions = block.get("questions").and_then(|q| q.as_array());
    match questions {
        None => {
            result.add_error(
                format!("{}.questions", field_prefix),
                "Questions are required for short answer",
            );
            0
        }
        Some(qs) if qs.is_empty() => {
            result.add_error(
                format!("{}.questions", field_prefix),
                "At least one question is required",
            );
            0
        }
        Some(qs) => {
            for (q_idx, q) in qs.iter().enumerate() {
                let Some(q_obj) = q.as_object() else {
                    continue;
                };

                if q_obj
                    .get("prompt")
                    .and_then(|p| p.as_str())
                    .map(|s| s.trim().is_empty())
                    .unwrap_or(true)
                {
                    result.add_error(
                        format!("{}.questions[{}].prompt", field_prefix, q_idx),
                        "Question prompt is required",
                    );
                }

                if q_obj
                    .get("correctAnswer")
                    .and_then(|a| a.as_str())
                    .map(|s| s.trim().is_empty())
                    .unwrap_or(true)
                {
                    result.add_error(
                        format!("{}.questions[{}].correctAnswer", field_prefix, q_idx),
                        "Correct answer is required",
                    );
                }
            }
            qs.len() as i32
        }
    }
}

fn validate_sentence_completion(
    block: &serde_json::Map<String, serde_json::Value>,
    field_prefix: &str,
    result: &mut ValidationResult,
) -> i32 {
    let questions = block.get("questions").and_then(|q| q.as_array());
    match questions {
        None => {
            result.add_error(
                format!("{}.questions", field_prefix),
                "Sentences are required",
            );
            0
        }
        Some(qs) if qs.is_empty() => {
            result.add_error(
                format!("{}.questions", field_prefix),
                "At least one sentence is required",
            );
            0
        }
        Some(qs) => {
            let mut blank_count = 0;
            for (q_idx, q) in qs.iter().enumerate() {
                let Some(q_obj) = q.as_object() else {
                    continue;
                };

                if q_obj
                    .get("sentence")
                    .and_then(|s| s.as_str())
                    .map(|s| s.trim().is_empty())
                    .unwrap_or(true)
                {
                    result.add_error(
                        format!("{}.questions[{}].sentence", field_prefix, q_idx),
                        "Sentence text is required",
                    );
                }

                let blanks = q_obj.get("blanks").and_then(|b| b.as_array());
                match blanks {
                    None => {
                        result.add_error(
                            format!("{}.questions[{}].blanks", field_prefix, q_idx),
                            "Blanks are required",
                        );
                    }
                    Some(bs) if bs.is_empty() => {
                        result.add_error(
                            format!("{}.questions[{}].blanks", field_prefix, q_idx),
                            "At least one blank is required",
                        );
                    }
                    Some(bs) => {
                        for (blank_idx, blank) in bs.iter().enumerate() {
                            if blank
                                .as_object()
                                .and_then(|b| b.get("correctAnswer"))
                                .and_then(|a| a.as_str())
                                .map(|s| s.trim().is_empty())
                                .unwrap_or(true)
                            {
                                result.add_error(
                                    format!(
                                        "{}.questions[{}].blanks[{}].correctAnswer",
                                        field_prefix, q_idx, blank_idx
                                    ),
                                    "Blank answer is required",
                                );
                            }
                        }
                        blank_count += bs.len() as i32;
                    }
                }
            }
            blank_count
        }
    }
}

fn validate_diagram_labeling(
    block: &serde_json::Map<String, serde_json::Value>,
    field_prefix: &str,
    result: &mut ValidationResult,
) -> i32 {
    if block
        .get("imageUrl")
        .and_then(|u| u.as_str())
        .map(|s| s.trim().is_empty())
        .unwrap_or(true)
    {
        result.add_error(
            format!("{}.imageUrl", field_prefix),
            "Diagram image URL is required",
        );
    }

    let labels = block.get("labels").and_then(|l| l.as_array());
    match labels {
        None => {
            result.add_error(format!("{}.labels", field_prefix), "Labels are required");
            0
        }
        Some(ls) if ls.is_empty() => {
            result.add_error(
                format!("{}.labels", field_prefix),
                "At least one label is required",
            );
            0
        }
        Some(ls) => {
            for (label_idx, label) in ls.iter().enumerate() {
                let Some(label_obj) = label.as_object() else {
                    continue;
                };

                if label_obj
                    .get("correctAnswer")
                    .and_then(|a| a.as_str())
                    .map(|s| s.trim().is_empty())
                    .unwrap_or(true)
                {
                    result.add_error(
                        format!("{}.labels[{}].correctAnswer", field_prefix, label_idx),
                        "Label answer is required",
                    );
                }
            }
            ls.len() as i32
        }
    }
}

fn validate_flow_chart(
    block: &serde_json::Map<String, serde_json::Value>,
    field_prefix: &str,
    result: &mut ValidationResult,
) -> i32 {
    let steps = block.get("steps").and_then(|s| s.as_array());
    match steps {
        None => {
            result.add_error(format!("{}.steps", field_prefix), "Steps are required");
            0
        }
        Some(ss) if ss.is_empty() => {
            result.add_error(
                format!("{}.steps", field_prefix),
                "At least one step is required",
            );
            0
        }
        Some(ss) => {
            for (step_idx, step) in ss.iter().enumerate() {
                let Some(step_obj) = step.as_object() else {
                    continue;
                };

                if step_obj
                    .get("label")
                    .and_then(|l| l.as_str())
                    .map(|s| s.trim().is_empty())
                    .unwrap_or(true)
                {
                    result.add_error(
                        format!("{}.steps[{}].label", field_prefix, step_idx),
                        "Step label is required",
                    );
                }

                if step_obj
                    .get("correctAnswer")
                    .and_then(|a| a.as_str())
                    .map(|s| s.trim().is_empty())
                    .unwrap_or(true)
                {
                    result.add_error(
                        format!("{}.steps[{}].correctAnswer", field_prefix, step_idx),
                        "Step answer is required",
                    );
                }
            }
            ss.len() as i32
        }
    }
}

fn validate_table_completion(
    block: &serde_json::Map<String, serde_json::Value>,
    field_prefix: &str,
    result: &mut ValidationResult,
) -> i32 {
    let headers = block.get("headers").and_then(|h| h.as_array());
    match headers {
        None => {
            result.add_error(
                format!("{}.headers", field_prefix),
                "Table headers are required",
            );
        }
        Some(hs) if hs.len() < 2 => {
            result.add_error(
                format!("{}.headers", field_prefix),
                "At least 2 table headers are required",
            );
        }
        Some(hs) => {
            for (h_idx, header) in hs.iter().enumerate() {
                if header.as_str().map(|s| s.trim().is_empty()).unwrap_or(true) {
                    result.add_error(
                        format!("{}.headers[{}]", field_prefix, h_idx),
                        "Header text is required",
                    );
                }
            }
        }
    }

    let rows = block.get("rows").and_then(|r| r.as_array());
    if rows.map(|r| r.is_empty()).unwrap_or(true) {
        result.add_error(
            format!("{}.rows", field_prefix),
            "At least one table row is required",
        );
        return 0;
    }

    let cells = block.get("cells").and_then(|c| c.as_array());
    match cells {
        None => {
            result.add_error(
                format!("{}.cells", field_prefix),
                "Table cells are required",
            );
            0
        }
        Some(cs) if cs.is_empty() => {
            result.add_error(
                format!("{}.cells", field_prefix),
                "At least one cell is required",
            );
            0
        }
        Some(cs) => {
            for (cell_idx, cell) in cs.iter().enumerate() {
                let Some(cell_obj) = cell.as_object() else {
                    continue;
                };

                if cell_obj
                    .get("correctAnswer")
                    .and_then(|a| a.as_str())
                    .map(|s| s.trim().is_empty())
                    .unwrap_or(true)
                {
                    result.add_error(
                        format!("{}.cells[{}].correctAnswer", field_prefix, cell_idx),
                        "Cell answer is required",
                    );
                }
            }
            cs.len() as i32
        }
    }
}

fn validate_note_completion(
    block: &serde_json::Map<String, serde_json::Value>,
    field_prefix: &str,
    result: &mut ValidationResult,
) -> i32 {
    let questions = block.get("questions").and_then(|q| q.as_array());
    match questions {
        None => {
            result.add_error(format!("{}.questions", field_prefix), "Notes are required");
            0
        }
        Some(qs) if qs.is_empty() => {
            result.add_error(
                format!("{}.questions", field_prefix),
                "At least one note is required",
            );
            0
        }
        Some(qs) => {
            let mut blank_count = 0;
            for (q_idx, q) in qs.iter().enumerate() {
                let Some(q_obj) = q.as_object() else {
                    continue;
                };

                if q_obj
                    .get("noteText")
                    .and_then(|n| n.as_str())
                    .map(|s| s.trim().is_empty())
                    .unwrap_or(true)
                {
                    result.add_error(
                        format!("{}.questions[{}].noteText", field_prefix, q_idx),
                        "Note text is required",
                    );
                }

                let blanks = q_obj.get("blanks").and_then(|b| b.as_array());
                match blanks {
                    None => {
                        result.add_error(
                            format!("{}.questions[{}].blanks", field_prefix, q_idx),
                            "Blanks are required",
                        );
                    }
                    Some(bs) if bs.is_empty() => {
                        result.add_error(
                            format!("{}.questions[{}].blanks", field_prefix, q_idx),
                            "At least one blank is required",
                        );
                    }
                    Some(bs) => {
                        for (blank_idx, blank) in bs.iter().enumerate() {
                            if blank
                                .as_object()
                                .and_then(|b| b.get("correctAnswer"))
                                .and_then(|a| a.as_str())
                                .map(|s| s.trim().is_empty())
                                .unwrap_or(true)
                            {
                                result.add_error(
                                    format!(
                                        "{}.questions[{}].blanks[{}].correctAnswer",
                                        field_prefix, q_idx, blank_idx
                                    ),
                                    "Blank answer is required",
                                );
                            }
                        }
                        blank_count += bs.len() as i32;
                    }
                }
            }
            blank_count
        }
    }
}

fn validate_classification(
    block: &serde_json::Map<String, serde_json::Value>,
    field_prefix: &str,
    result: &mut ValidationResult,
) -> i32 {
    let categories = block.get("categories").and_then(|c| c.as_array());
    let category_set: HashSet<String> = categories
        .map(|cs| {
            cs.iter()
                .filter_map(|c| c.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    match categories {
        None => {
            result.add_error(
                format!("{}.categories", field_prefix),
                "Categories are required",
            );
        }
        Some(cs) if cs.len() < 2 => {
            result.add_error(
                format!("{}.categories", field_prefix),
                "At least 2 categories are required",
            );
        }
        Some(cs) => {
            for (cat_idx, cat) in cs.iter().enumerate() {
                if cat.as_str().map(|s| s.trim().is_empty()).unwrap_or(true) {
                    result.add_error(
                        format!("{}.categories[{}]", field_prefix, cat_idx),
                        "Category text is required",
                    );
                }
            }
        }
    }

    let items = block.get("items").and_then(|i| i.as_array());
    match items {
        None => {
            result.add_error(format!("{}.items", field_prefix), "Items are required");
            0
        }
        Some(is) if is.is_empty() => {
            result.add_error(
                format!("{}.items", field_prefix),
                "At least one item is required",
            );
            0
        }
        Some(is) => {
            for (item_idx, item) in is.iter().enumerate() {
                let Some(item_obj) = item.as_object() else {
                    continue;
                };

                if item_obj
                    .get("text")
                    .and_then(|t| t.as_str())
                    .map(|s| s.trim().is_empty())
                    .unwrap_or(true)
                {
                    result.add_error(
                        format!("{}.items[{}].text", field_prefix, item_idx),
                        "Item text is required",
                    );
                }

                let correct_category = item_obj.get("correctCategory").and_then(|c| c.as_str());
                if correct_category
                    .map(|c| c.trim().is_empty())
                    .unwrap_or(true)
                {
                    result.add_error(
                        format!("{}.items[{}].correctCategory", field_prefix, item_idx),
                        "Item must be assigned to a category",
                    );
                } else if let Some(cat) = correct_category {
                    if !category_set.contains(cat) {
                        result.add_error(
                            format!("{}.items[{}].correctCategory", field_prefix, item_idx),
                            "Item must be assigned to a valid category",
                        );
                    }
                }
            }
            is.len() as i32
        }
    }
}

fn validate_matching_features(
    block: &serde_json::Map<String, serde_json::Value>,
    field_prefix: &str,
    result: &mut ValidationResult,
) -> i32 {
    let options = block.get("options").and_then(|o| o.as_array());
    let option_set: HashSet<String> = options
        .map(|os| {
            os.iter()
                .filter_map(|o| o.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    match options {
        None => {
            result.add_error(format!("{}.options", field_prefix), "Options are required");
        }
        Some(os) if os.len() < 2 => {
            result.add_error(
                format!("{}.options", field_prefix),
                "At least 2 options are required",
            );
        }
        Some(os) => {
            for (opt_idx, opt) in os.iter().enumerate() {
                if opt.as_str().map(|s| s.trim().is_empty()).unwrap_or(true) {
                    result.add_error(
                        format!("{}.options[{}]", field_prefix, opt_idx),
                        "Option text is required",
                    );
                }
            }
        }
    }

    let features = block.get("features").and_then(|f| f.as_array());
    match features {
        None => {
            result.add_error(
                format!("{}.features", field_prefix),
                "Features are required",
            );
            0
        }
        Some(fs) if fs.is_empty() => {
            result.add_error(
                format!("{}.features", field_prefix),
                "At least one feature is required",
            );
            0
        }
        Some(fs) => {
            for (feat_idx, feat) in fs.iter().enumerate() {
                let Some(feat_obj) = feat.as_object() else {
                    continue;
                };

                if feat_obj
                    .get("text")
                    .and_then(|t| t.as_str())
                    .map(|s| s.trim().is_empty())
                    .unwrap_or(true)
                {
                    result.add_error(
                        format!("{}.features[{}].text", field_prefix, feat_idx),
                        "Feature text is required",
                    );
                }

                let correct_match = feat_obj.get("correctMatch").and_then(|m| m.as_str());
                if correct_match.map(|m| m.trim().is_empty()).unwrap_or(true) {
                    result.add_error(
                        format!("{}.features[{}].correctMatch", field_prefix, feat_idx),
                        "Feature must have a match",
                    );
                } else if let Some(m) = correct_match {
                    if !option_set.contains(m) {
                        result.add_error(
                            format!("{}.features[{}].correctMatch", field_prefix, feat_idx),
                            "Feature must match a valid option",
                        );
                    }
                }
            }
            fs.len() as i32
        }
    }
}

fn count_questions_in_block(block: &serde_json::Map<String, serde_json::Value>) -> i32 {
    if let Some(questions) = block.get("questions").and_then(|q| q.as_array()) {
        return questions.len() as i32;
    }
    if let Some(items) = block.get("items").and_then(|i| i.as_array()) {
        return items.len() as i32;
    }
    if let Some(features) = block.get("features").and_then(|f| f.as_array()) {
        return features.len() as i32;
    }
    if let Some(steps) = block.get("steps").and_then(|s| s.as_array()) {
        return steps.len() as i32;
    }
    if let Some(labels) = block.get("labels").and_then(|l| l.as_array()) {
        return labels.len() as i32;
    }
    if let Some(cells) = block.get("cells").and_then(|c| c.as_array()) {
        return cells.len() as i32;
    }
    if block
        .get("type")
        .and_then(|t| t.as_str())
        .map(|t| t.contains("MCQ"))
        .unwrap_or(false)
    {
        return 1;
    }
    0
}

fn validate_listening_content(
    content: &serde_json::Map<String, serde_json::Value>,
    result: &mut ValidationResult,
) {
    let parts = content
        .get("listening")
        .and_then(|l| l.as_object())
        .and_then(|l| l.get("parts"))
        .and_then(|p| p.as_array());

    match parts {
        None => {
            result.add_error("content.listening.parts", "Listening parts are missing");
        }
        Some(parts) if parts.is_empty() => {
            result.add_error(
                "content.listening.parts",
                "At least one listening part is required",
            );
        }
        Some(parts) => {
            let mut total_questions = 0;
            for (idx, part) in parts.iter().enumerate() {
                let part_questions = validate_listening_part(part, idx, result);
                total_questions += part_questions;
            }

            if total_questions == 0 {
                result.add_error(
                    "content.listening.questions",
                    "Listening module has no questions",
                );
            } else if total_questions < 20 {
                result.add_warning(
                    "content.listening.questions",
                    format!(
                        "Listening has only {} questions (recommended: 40)",
                        total_questions
                    ),
                );
            }
        }
    }
}

fn validate_listening_part(
    part: &serde_json::Value,
    idx: usize,
    result: &mut ValidationResult,
) -> i32 {
    let Some(part_obj) = part.as_object() else {
        result.add_error(
            format!("content.listening.parts[{}]", idx),
            "Invalid part structure",
        );
        return 0;
    };

    if part_obj
        .get("title")
        .and_then(|t| t.as_str())
        .map(|s| s.trim().is_empty())
        .unwrap_or(true)
    {
        result.add_error(
            format!("content.listening.parts[{}].title", idx),
            "Part title is required",
        );
    }

    let (blocks, blocks_field) = part_obj
        .get("blocks")
        .and_then(|b| b.as_array())
        .map(|blocks| (Some(blocks), "blocks"))
        .unwrap_or_else(|| {
            let blocks = part_obj.get("questionBlocks").and_then(|b| b.as_array());
            (blocks, "questionBlocks")
        });
    match &blocks {
        None => {
            result.add_warning(
                format!("content.listening.parts[{}].{}", idx, blocks_field),
                "Part has no question blocks",
            );
            0
        }
        Some(blocks) if blocks.is_empty() => {
            result.add_warning(
                format!("content.listening.parts[{}].{}", idx, blocks_field),
                "Part has no question blocks",
            );
            0
        }
        Some(blocks) => {
            let mut question_count = 0;
            for (block_idx, block) in blocks.iter().enumerate() {
                let block_questions =
                    validate_question_block(block, idx, block_idx, "listening", "parts", blocks_field, result);
                question_count += block_questions;
            }
            question_count
        }
    }
}

fn validate_writing_content(
    content: &serde_json::Map<String, serde_json::Value>,
    result: &mut ValidationResult,
) {
    let writing = content.get("writing").and_then(|w| w.as_object());

    let Some(writing) = writing else {
        result.add_error("content.writing", "Writing content is missing");
        return;
    };

    let task1_prompt = writing.get("task1Prompt").and_then(|p| p.as_str());
    let task2_prompt = writing.get("task2Prompt").and_then(|p| p.as_str());

    if task1_prompt.map(|s| s.trim().is_empty()).unwrap_or(true) {
        result.add_error(
            "content.writing.task1Prompt",
            "Writing Task 1 prompt is required",
        );
    }

    if task2_prompt.map(|s| s.trim().is_empty()).unwrap_or(true) {
        result.add_error(
            "content.writing.task2Prompt",
            "Writing Task 2 prompt is required",
        );
    }
}

fn validate_speaking_content(
    content: &serde_json::Map<String, serde_json::Value>,
    result: &mut ValidationResult,
) {
    let speaking = content.get("speaking").and_then(|s| s.as_object());

    let Some(speaking) = speaking else {
        result.add_error("content.speaking", "Speaking content is missing");
        return;
    };

    let part1_topics = speaking.get("part1Topics").and_then(|t| t.as_array());
    if part1_topics.map(|t| t.is_empty()).unwrap_or(true) {
        result.add_error(
            "content.speaking.part1Topics",
            "Speaking Part 1 topics are required",
        );
    }

    let cue_card = speaking.get("cueCard").and_then(|c| c.as_str());
    if cue_card.map(|s| s.trim().is_empty()).unwrap_or(true) {
        result.add_error(
            "content.speaking.cueCard",
            "Speaking cue card prompt is required",
        );
    }

    let part3_discussion = speaking.get("part3Discussion").and_then(|d| d.as_array());
    if part3_discussion.map(|d| d.is_empty()).unwrap_or(true) {
        result.add_error(
            "content.speaking.part3Discussion",
            "Speaking Part 3 discussion topics are required",
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn listening_blocks_empty_instruction_reports_parts_blocks_path() {
        let content = json!({
            "listening": {
                "parts": [{
                    "id": "part-1",
                    "title": "Part 1",
                    "blocks": [{
                        "id": "block-1",
                        "type": "TFNG",
                        "instruction": "",
                        "questions": [{"id": "q-1"}]
                    }]
                }]
            }
        });

        let config = json!({
            "sections": {
                "listening": {
                    "enabled": true,
                    "bandScoreTable": {
                        "1": 1.0, "2": 2.0, "3": 3.0, "4": 4.0, "5": 5.0,
                        "6": 6.0, "7": 7.0, "8": 8.0, "9": 9.0, "10": 10.0
                    }
                },
                "reading": {"enabled": false},
                "writing": {"enabled": false},
                "speaking": {"enabled": false}
            }
        });

        let result = validate_exam_content(&content, &config);

        assert!(
            result.errors.is_empty(),
            "expected empty-instruction to be allowed for listening blocks, got errors: {:?}",
            result.errors
        );
    }

    #[test]
    fn listening_question_blocks_empty_instruction_is_allowed() {
        let content = json!({
            "listening": {
                "parts": [{
                    "id": "part-1",
                    "title": "Part 1",
                    "questionBlocks": [{
                        "id": "block-1",
                        "type": "TFNG",
                        "instruction": "",
                        "questions": [{"id": "q-1"}]
                    }]
                }]
            }
        });

        let config = json!({
            "sections": {
                "listening": {
                    "enabled": true,
                    "bandScoreTable": {
                        "1": 1.0, "2": 2.0, "3": 3.0, "4": 4.0, "5": 5.0,
                        "6": 6.0, "7": 7.0, "8": 8.0, "9": 9.0, "10": 10.0
                    }
                },
                "reading": {"enabled": false},
                "writing": {"enabled": false},
                "speaking": {"enabled": false}
            }
        });

        let result = validate_exam_content(&content, &config);

        assert!(
            result.errors.is_empty(),
            "expected empty-instruction to be allowed for listening questionBlocks, got errors: {:?}",
            result.errors
        );
    }

    #[test]
    fn reading_blocks_empty_instruction_is_allowed() {
        let content = json!({
            "reading": {
                "passages": [{
                    "id": "passage-1",
                    "title": "Passage 1",
                    "blocks": [{
                        "id": "block-1",
                        "type": "TFNG",
                        "instruction": "",
                        "questions": [{"id": "q-1"}]
                    }]
                }]
            }
        });

        let config = json!({
            "sections": {
                "reading": {
                    "enabled": true,
                    "bandScoreTable": {
                        "1": 1.0, "2": 2.0, "3": 3.0, "4": 4.0, "5": 5.0,
                        "6": 6.0, "7": 7.0, "8": 8.0, "9": 9.0, "10": 10.0
                    }
                },
                "listening": {"enabled": false},
                "writing": {"enabled": false},
                "speaking": {"enabled": false}
            }
        });

        let result = validate_exam_content(&content, &config);

        assert!(
            result.errors.is_empty(),
            "expected empty-instruction to be allowed for reading blocks, got errors: {:?}",
            result.errors
        );
    }
}
