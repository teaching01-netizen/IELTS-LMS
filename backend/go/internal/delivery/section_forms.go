package delivery

import (
	"context"

	"example.com/ielts-proctoring/internal/assessmentforms/definition"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// The owning module CAS also enforces the form gate. Correlation uses fixed
// internal SQL aliases, never request input. A legacy successful activation
// needs no additional round trip; a response cannot be removed/replaced while
// its owning attempt lock is held.
func sectionEntryActivationSQL(target string) string {
	return ` AND NOT EXISTS (
 SELECT 1 FROM student_attempts fa
 JOIN exam_versions fv ON fv.id=fa.published_version_id
 JOIN assessment_modules fm ON fm.id=` + target + `.module_id
 JOIN assessment_sections fs ON fs.id=fm.section_id AND fs.exam_version_id=fv.id
 JOIN exam_schedules fsch ON fsch.id=fa.schedule_id
 WHERE fa.id=` + target + `.attempt_id
 AND JSON_EXTRACT(fv.config_snapshot,'$.forms.schemaVersion')=2
 AND NOT (JSON_EXTRACT(fv.config_snapshot,CONCAT('$.forms.sectionEntry."',fs.section_key,'".enabled')) <=> CAST('false' AS JSON))
 AND COALESCE(JSON_LENGTH(fv.config_snapshot,CONCAT('$.forms.sectionEntry."',fs.section_key,'".fields')),0)>0
 AND (COALESCE(fsch.sat_timing_model,'')<>'sat_personal_v1' OR NOT EXISTS (
 SELECT 1 FROM assessment_form_responses fr WHERE fr.attempt_id=fa.id
 AND fr.form_key=CASE fs.section_key WHEN 'math' THEN 'math_entry' WHEN 'reading-writing' THEN 'verbal_entry' ELSE '' END)))`
}

func hasSectionEntryFormTx(ctx context.Context, q tx.Tx, attemptID, section string) (bool, error) {
	var raw []byte
	if err := q.QueryRowContext(ctx, "SELECT CAST(v.config_snapshot AS CHAR) FROM student_attempts a JOIN exam_versions v ON v.id=a.published_version_id WHERE a.id=?", attemptID).Scan(&raw); err != nil {
		return false, err
	}
	f, err := definition.FromSnapshot(raw)
	if err != nil {
		return false, err
	}
	return len(f.SectionFields(section)) > 0, nil
}
