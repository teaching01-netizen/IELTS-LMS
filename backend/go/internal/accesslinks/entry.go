package accesslinks

import (
	"context"
	"database/sql"
	"time"

	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/schedules"
)

// ResolveEntryTx is the admission boundary, not an earlier eligibility hint.
// Shared locks let check-ins run concurrently, while revocation/window edits
// must serialize before or after the credential-issuance commit.
func ResolveEntryTx(ctx context.Context, q tx.Tx, linkID, studentCode, studentName, studentEmail string) (ResolvedEntry, error) {
	var zero ResolvedEntry
	var lifecycle, availability, scheduleID, providerKey, accessMode, audienceType string
	var opensAt, closesAt sql.NullTime
	var enabledSections, publishScope sql.NullString
	if err := q.QueryRowContext(ctx, `SELECT l.schedule_id, e.provider_key, l.access_mode, l.audience_type, l.lifecycle_state, l.availability_type, l.opens_at, l.closes_at, l.enabled_sections, v.sat_publish_scope FROM assessment_access_links l JOIN exam_entities e ON e.id = l.exam_id JOIN exam_versions v ON v.id = l.published_version_id WHERE l.id = ? FOR SHARE`, linkID).Scan(&scheduleID, &providerKey, &accessMode, &audienceType, &lifecycle, &availability, &opensAt, &closesAt, &enabledSections, &publishScope); err != nil {
		if err == sql.ErrNoRows {
			return zero, notFound("Access link was not found.")
		}
		return zero, err
	}
	state, err := ParseLifecycleState(lifecycle)
	if err != nil {
		return zero, err
	}
	audience, err := ParseAudienceType(audienceType)
	if err != nil {
		return zero, err
	}
	mode, err := ParseMode(accessMode)
	if err != nil {
		return zero, err
	}
	avail, err := ParseAvailabilityType(availability)
	if err != nil {
		return zero, err
	}
	if !hasEffectiveSections(providerKey, normalizeScopeValue(publishScope.String), parseEnabledSections(enabledSections)) {
		return zero, unavailable("This Student Link has no sections enabled in its published release.")
	}
	var now time.Time
	if err := q.QueryRowContext(ctx, "SELECT UTC_TIMESTAMP(6)").Scan(&now); err != nil {
		return zero, err
	}
	var opens, closes *time.Time
	if opensAt.Valid {
		v := opensAt.Time.UTC()
		opens = &v
	}
	if closesAt.Valid {
		v := closesAt.Time.UTC()
		closes = &v
	}
	switch deriveStatus(state, avail, opens, closes, now.UTC()) {
	case StatusLive:
	case StatusUpcoming:
		return zero, unavailable("This Student Link is not open yet.")
	case StatusEnded:
		return zero, unavailable("This Student Link has ended.")
	case StatusPaused:
		return zero, unavailable("This Student Link is paused.")
	case StatusRevoked:
		return zero, unavailable("This Student Link has been revoked.")
	default:
		return zero, unavailable("This Student Link is not available.")
	}
	var start, end time.Time
	var scheduleStatus string
	if err := q.QueryRowContext(ctx, "SELECT start_time, end_time, status FROM exam_schedules WHERE id = ? FOR SHARE", scheduleID).Scan(&start, &end, &scheduleStatus); err != nil {
		if err == sql.ErrNoRows {
			return zero, notFound("Schedule not found.")
		}
		return zero, err
	}
	if scheduleStatus != schedules.StatusScheduled && scheduleStatus != schedules.StatusLive {
		return zero, unavailable("This Student Link is closed to new admissions.")
	}
	if now.Before(start) {
		return zero, unavailable("This Student Link is not open yet.")
	}
	if !now.Before(end) {
		return zero, unavailable("This Student Link has ended.")
	}
	if audience == AudienceSelectedStudents {
		code := NormalizeAccessCode(studentCode)
		if code == "" {
			return zero, unavailable("A Student ID/WCODE is required for this Student Link.")
		}
		var expectedName, expectedEmail sql.NullString
		if err := q.QueryRowContext(ctx, "SELECT student_name, student_email FROM assessment_access_link_members WHERE link_id = ? AND student_code = ? LIMIT 1 FOR SHARE", linkID, code).Scan(&expectedName, &expectedEmail); err != nil {
			if err == sql.ErrNoRows {
				return zero, unavailable("This Student ID/WCODE is not included in this Student Link.")
			}
			return zero, err
		}
		if err := validateSelectedStudentIdentity(expectedName, expectedEmail, studentName, studentEmail); err != nil {
			return zero, err
		}
	}
	return ResolvedEntry{ScheduleID: scheduleID, ProviderKey: providerKey, AccessMode: mode, AudienceType: audience, EnabledSections: parseEnabledSections(enabledSections)}, nil
}
