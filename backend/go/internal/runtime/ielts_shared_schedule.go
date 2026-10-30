package runtime

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// IELTSSharedDeliveryLead is the room-wide gap between Start and the first
// section's clock. It is fixed per deployment (IELTS_SHARED_DELIVERY_LEAD_SECONDS,
// 2–60, default 10), never derived from the slowest device.
func IELTSSharedDeliveryLead() time.Duration {
	const defaultSeconds = 10
	seconds, err := strconv.Atoi(strings.TrimSpace(os.Getenv("IELTS_SHARED_DELIVERY_LEAD_SECONDS")))
	if err != nil || seconds < 2 || seconds > 60 {
		seconds = defaultSeconds
	}
	return time.Duration(seconds) * time.Second
}

const ieltsSharedScheduleSchema = 1

// Schedule statuses.
const (
	SharedScheduleActive = "active"
	SharedSchedulePaused = "paused"
	SharedScheduleEnded  = "ended"
)

// Resolved positions. The TypeScript resolver
// (src/features/student/domain/exam-session/ieltsSharedSchedule.ts) must
// return the same kind for the same vectors.
const (
	SharedBeforeStart = "before_start"
	SharedWorking     = "working"
	SharedSaveOnly    = "save_only"
	SharedGap         = "gap"
	SharedPaused      = "paused"
	SharedComplete    = "complete"
)

var ieltsSharedSections = map[string]bool{"listening": true, "reading": true, "writing": true}

// IELTSSharedWindow is one section's committed window: edits are allowed in
// [StartAt, DeadlineAt); [DeadlineAt, SaveUntil) only drains accepted writes.
type IELTSSharedWindow struct {
	SectionKey string    `json:"sectionKey"`
	Order      int       `json:"order"`
	StartAt    time.Time `json:"startAt"`
	DeadlineAt time.Time `json:"deadlineAt"`
	SaveUntil  time.Time `json:"saveUntil"`
}

// IELTSSharedSchedule is the room timetable persisted in
// exam_session_runtimes.ielts_shared_schedule. It is the timing authority for
// TimingModelIELTSSharedSchedule; section rows and attempt deadlines are
// projections of it. PausedAt is set only while Status is paused.
type IELTSSharedSchedule struct {
	SchemaVersion    int                 `json:"schemaVersion"`
	ScheduleRevision int64               `json:"scheduleRevision"`
	Status           string              `json:"status"`
	PausedAt         *time.Time          `json:"pausedAt,omitempty"`
	Windows          []IELTSSharedWindow `json:"windows"`
}

// IELTSSharedPosition is the resolver's discriminated result. Window is the
// relevant section (working/save-only: current; gap/before-start: next).
type IELTSSharedPosition struct {
	Kind   string
	Window *IELTSSharedWindow
}

// Editable reports whether a new answer may be written now.
func (p IELTSSharedPosition) Editable() bool { return p.Kind == SharedWorking }

// Accepts reports whether the server accepts a write for the section: the
// working window plus the save-only drain.
func (p IELTSSharedPosition) Accepts(sectionKey string) bool {
	return (p.Kind == SharedWorking || p.Kind == SharedSaveOnly) && p.Window != nil && p.Window.SectionKey == sectionKey
}

func invalidSchedule(format string, args ...any) error {
	return apperrors.New(apperrors.CodeValidation, "Invalid IELTS shared schedule: "+fmt.Sprintf(format, args...))
}

// BuildIELTSSharedSchedule lays the plan end to end from startAt: each
// section's save-only drain is followed by its authored gap.
func BuildIELTSSharedSchedule(startAt time.Time, plan []PlanEntry, saveGrace time.Duration) (IELTSSharedSchedule, error) {
	out := IELTSSharedSchedule{SchemaVersion: ieltsSharedScheduleSchema, ScheduleRevision: 1, Status: SharedScheduleActive}
	if saveGrace < 0 {
		return out, invalidSchedule("negative save grace")
	}
	start := startAt.UTC()
	for _, entry := range plan {
		if entry.DurationMinutes <= 0 {
			return out, invalidSchedule("section %q has no duration", entry.SectionKey)
		}
		if entry.GapAfterMinutes < 0 {
			return out, invalidSchedule("section %q has a negative gap", entry.SectionKey)
		}
		deadline := start.Add(time.Duration(entry.DurationMinutes) * time.Minute)
		w := IELTSSharedWindow{SectionKey: entry.SectionKey, Order: entry.Order, StartAt: start, DeadlineAt: deadline, SaveUntil: deadline.Add(saveGrace)}
		out.Windows = append(out.Windows, w)
		start = w.SaveUntil.Add(time.Duration(entry.GapAfterMinutes) * time.Minute)
	}
	return out, ValidateIELTSSharedSchedule(out)
}

// ValidateIELTSSharedSchedule rejects anything the resolver cannot interpret
// unambiguously. Stored JSON is re-validated on every read.
func ValidateIELTSSharedSchedule(s IELTSSharedSchedule) error {
	if s.SchemaVersion != ieltsSharedScheduleSchema {
		return invalidSchedule("unsupported schema %d", s.SchemaVersion)
	}
	if s.ScheduleRevision < 1 {
		return invalidSchedule("revision must be positive")
	}
	switch s.Status {
	case SharedScheduleActive, SharedScheduleEnded:
		if s.PausedAt != nil {
			return invalidSchedule("pausedAt set while %s", s.Status)
		}
	case SharedSchedulePaused:
		if s.PausedAt == nil {
			return invalidSchedule("paused without pausedAt")
		}
	default:
		return invalidSchedule("unknown status %q", s.Status)
	}
	if len(s.Windows) == 0 || len(s.Windows) > len(ieltsSharedSections) {
		return invalidSchedule("expected 1-%d windows", len(ieltsSharedSections))
	}
	seen := map[string]bool{}
	for i, w := range s.Windows {
		if !ieltsSharedSections[w.SectionKey] || seen[w.SectionKey] {
			return invalidSchedule("unsupported or duplicate section %q", w.SectionKey)
		}
		seen[w.SectionKey] = true
		if w.StartAt.IsZero() || !w.DeadlineAt.After(w.StartAt) || w.SaveUntil.Before(w.DeadlineAt) {
			return invalidSchedule("section %q has an empty or inverted window", w.SectionKey)
		}
		if i > 0 {
			prev := s.Windows[i-1]
			if w.Order <= prev.Order || w.StartAt.Before(prev.SaveUntil) {
				return invalidSchedule("section %q overlaps or is out of order", w.SectionKey)
			}
		}
	}
	return nil
}

// ResolveIELTSSharedWindow is the pure position function shared by the
// projector, the write gate and the student view.
func ResolveIELTSSharedWindow(s IELTSSharedSchedule, now time.Time) (IELTSSharedPosition, error) {
	if err := ValidateIELTSSharedSchedule(s); err != nil {
		return IELTSSharedPosition{}, err
	}
	if s.Status == SharedScheduleEnded {
		return IELTSSharedPosition{Kind: SharedComplete}, nil
	}
	if s.Status == SharedSchedulePaused {
		// A pause freezes the room at the instant it was committed.
		now = *s.PausedAt
	}
	pos := IELTSSharedPosition{Kind: SharedComplete}
	for i := range s.Windows {
		w := &s.Windows[i]
		if now.Before(w.SaveUntil) {
			switch {
			case now.Before(w.StartAt) && i == 0:
				pos = IELTSSharedPosition{Kind: SharedBeforeStart, Window: w}
			case now.Before(w.StartAt):
				pos = IELTSSharedPosition{Kind: SharedGap, Window: w}
			case now.Before(w.DeadlineAt):
				pos = IELTSSharedPosition{Kind: SharedWorking, Window: w}
			default:
				pos = IELTSSharedPosition{Kind: SharedSaveOnly, Window: w}
			}
			break
		}
	}
	if s.Status == SharedSchedulePaused && pos.Kind != SharedComplete {
		pos.Kind = SharedPaused
	}
	return pos, nil
}

// WindowFor returns the committed window of a section.
func (s IELTSSharedSchedule) WindowFor(sectionKey string) (IELTSSharedWindow, bool) {
	for _, w := range s.Windows {
		if w.SectionKey == sectionKey {
			return w, true
		}
	}
	return IELTSSharedWindow{}, false
}

func (s IELTSSharedSchedule) clone() IELTSSharedSchedule {
	out := s
	out.Windows = append([]IELTSSharedWindow(nil), s.Windows...)
	if s.PausedAt != nil {
		at := *s.PausedAt
		out.PausedAt = &at
	}
	return out
}

// shiftFrom moves every unfinished window by d. A window already working at
// `at` keeps its start; windows not yet started move whole.
func (s *IELTSSharedSchedule) shiftFrom(at time.Time, d time.Duration) {
	for i := range s.Windows {
		w := &s.Windows[i]
		if !at.Before(w.DeadlineAt) {
			continue
		}
		if at.Before(w.StartAt) {
			w.StartAt = w.StartAt.Add(d)
		}
		w.DeadlineAt = w.DeadlineAt.Add(d)
		w.SaveUntil = w.SaveUntil.Add(d)
	}
}

// PauseIELTSSharedSchedule freezes the room at now.
func PauseIELTSSharedSchedule(s IELTSSharedSchedule, now time.Time) (IELTSSharedSchedule, error) {
	if s.Status != SharedScheduleActive {
		return s, apperrors.New(apperrors.CodeConflict, "The IELTS room schedule is not active.")
	}
	out := s.clone()
	at := now.UTC()
	out.Status, out.PausedAt = SharedSchedulePaused, &at
	out.ScheduleRevision++
	return out, ValidateIELTSSharedSchedule(out)
}

// ResumeIELTSSharedSchedule credits the paused interval to every unfinished
// window. credited is the server-measured pause, the same value the section
// row accumulates, so projections and the timetable cannot drift.
func ResumeIELTSSharedSchedule(s IELTSSharedSchedule, credited time.Duration) (IELTSSharedSchedule, error) {
	if s.Status != SharedSchedulePaused || s.PausedAt == nil {
		return s, apperrors.New(apperrors.CodeConflict, "The IELTS room schedule is not paused.")
	}
	if credited < 0 {
		credited = 0
	}
	out := s.clone()
	out.shiftFrom(*s.PausedAt, credited)
	out.Status, out.PausedAt = SharedScheduleActive, nil
	out.ScheduleRevision++
	return out, ValidateIELTSSharedSchedule(out)
}

// ExtendIELTSSharedSection adds extra working time to the section that is
// working at now and shifts every successor by the same amount.
func ExtendIELTSSharedSection(s IELTSSharedSchedule, sectionKey string, extra time.Duration, now time.Time) (IELTSSharedSchedule, error) {
	if extra <= 0 {
		return s, apperrors.New(apperrors.CodeValidation, "Extension must be positive.")
	}
	at := now.UTC()
	if s.PausedAt != nil {
		at = *s.PausedAt
	}
	w, ok := s.WindowFor(sectionKey)
	if s.Status == SharedScheduleEnded || !ok || at.Before(w.StartAt) || !at.Before(w.DeadlineAt) {
		return s, apperrors.New(apperrors.CodeConflict, "Only the working IELTS section can be extended.")
	}
	out := s.clone()
	out.shiftFrom(at, extra)
	out.ScheduleRevision++
	return out, ValidateIELTSSharedSchedule(out)
}

// EndIELTSSharedSection closes sectionKey at endAt and moves the successor to
// nextStartAt, keeping every later duration and authored gap. A nil
// nextStartAt ends the schedule.
func EndIELTSSharedSection(s IELTSSharedSchedule, sectionKey string, endAt time.Time, nextStartAt *time.Time) (IELTSSharedSchedule, error) {
	out := s.clone()
	idx := -1
	for i, w := range out.Windows {
		if w.SectionKey == sectionKey {
			idx = i
		}
	}
	if idx < 0 {
		return s, invalidSchedule("unknown section %q", sectionKey)
	}
	endAt = endAt.UTC()
	cur := &out.Windows[idx]
	if endAt.Before(cur.DeadlineAt) {
		if !endAt.After(cur.StartAt) {
			endAt = cur.StartAt.Add(time.Microsecond)
		}
		cur.DeadlineAt, cur.SaveUntil = endAt, endAt
	}
	out.ScheduleRevision++
	if nextStartAt == nil || idx == len(out.Windows)-1 {
		out.Windows = out.Windows[:idx+1]
		out.Status, out.PausedAt = SharedScheduleEnded, nil
		return out, ValidateIELTSSharedSchedule(out)
	}
	start := nextStartAt.UTC()
	if start.Before(cur.SaveUntil) {
		start = cur.SaveUntil
	}
	for i := idx + 1; i < len(out.Windows); i++ {
		w := &out.Windows[i]
		gap := w.StartAt.Sub(s.Windows[i-1].SaveUntil)
		if i == idx+1 {
			gap = 0
		}
		start = start.Add(gap)
		work, drain := w.DeadlineAt.Sub(w.StartAt), w.SaveUntil.Sub(w.DeadlineAt)
		w.StartAt, w.DeadlineAt, w.SaveUntil = start, start.Add(work), start.Add(work+drain)
		start = w.SaveUntil
	}
	return out, ValidateIELTSSharedSchedule(out)
}

// EndedIELTSSharedSchedule marks the room finished (proctor Complete).
func EndedIELTSSharedSchedule(s IELTSSharedSchedule) IELTSSharedSchedule {
	if s.Status == SharedScheduleEnded {
		return s
	}
	out := s.clone()
	out.Status, out.PausedAt = SharedScheduleEnded, nil
	out.ScheduleRevision++
	return out
}

// ParseIELTSSharedSchedule decodes and validates stored JSON.
func ParseIELTSSharedSchedule(raw []byte) (IELTSSharedSchedule, error) {
	var s IELTSSharedSchedule
	if err := json.Unmarshal(raw, &s); err != nil {
		return s, invalidSchedule("malformed JSON")
	}
	return s, ValidateIELTSSharedSchedule(s)
}

// LoadIELTSSharedScheduleInTx reads the timetable on the caller's
// transaction; lock is "", " FOR SHARE" or " FOR UPDATE". ok is false for a
// runtime that has none (every other timing model).
func LoadIELTSSharedScheduleInTx(ctx context.Context, q tx.Tx, runtimeID, lock string) (IELTSSharedSchedule, bool, error) {
	var raw sql.NullString
	if err := q.QueryRowContext(ctx, "SELECT ielts_shared_schedule FROM exam_session_runtimes WHERE id = ?"+lock, runtimeID).Scan(&raw); err != nil {
		if err == sql.ErrNoRows {
			return IELTSSharedSchedule{}, false, nil
		}
		return IELTSSharedSchedule{}, false, err
	}
	if !raw.Valid || raw.String == "" {
		return IELTSSharedSchedule{}, false, nil
	}
	s, err := ParseIELTSSharedSchedule([]byte(raw.String))
	return s, err == nil, err
}

// StoreIELTSSharedScheduleInTx writes a validated timetable in the caller's
// control transaction.
func StoreIELTSSharedScheduleInTx(ctx context.Context, q tx.Tx, runtimeID string, s IELTSSharedSchedule) error {
	if err := ValidateIELTSSharedSchedule(s); err != nil {
		return err
	}
	raw, err := json.Marshal(s)
	if err != nil {
		return err
	}
	if _, err := q.ExecContext(ctx, "UPDATE exam_session_runtimes SET ielts_shared_schedule = ? WHERE id = ?", string(raw), runtimeID); err != nil {
		return err
	}
	// Mirror each window onto its section row: the reconciler's due scan and
	// the session projections read these, so they must equal the timetable.
	for _, w := range s.Windows {
		if _, err := q.ExecContext(ctx, "UPDATE exam_session_runtime_sections SET projected_start_at = ?, projected_end_at = ? WHERE runtime_id = ? AND section_key = ?", w.StartAt, w.SaveUntil, runtimeID, w.SectionKey); err != nil {
			return err
		}
	}
	return nil
}

// amendIELTSSharedScheduleInTx applies fn to the stored timetable of a shared
// runtime; other models are a no-op.
func amendIELTSSharedScheduleInTx(ctx context.Context, q tx.Tx, rt *RuntimeRow, fn func(IELTSSharedSchedule) (IELTSSharedSchedule, error)) error {
	if !IsIELTSSharedSchedule(rt.TimingModel) {
		return nil
	}
	s, ok, err := LoadIELTSSharedScheduleInTx(ctx, q, rt.ID, " FOR UPDATE")
	if err != nil {
		return err
	}
	if !ok {
		return apperrors.New(apperrors.CodeConflict, "The IELTS room schedule is missing.")
	}
	next, err := fn(s)
	if err != nil {
		return err
	}
	return StoreIELTSSharedScheduleInTx(ctx, q, rt.ID, next)
}

// AmendIELTSSharedScheduleInTx is the exported form for proctor commands that
// hold the runtime row lock.
func AmendIELTSSharedScheduleInTx(ctx context.Context, q tx.Tx, runtimeID, timingModel string, fn func(IELTSSharedSchedule) (IELTSSharedSchedule, error)) error {
	return amendIELTSSharedScheduleInTx(ctx, q, &RuntimeRow{ID: runtimeID, TimingModel: timingModel}, fn)
}

// IELTSSharedScheduleEndedAssign is a SET fragment that marks a stored
// timetable ended inside the same statement that completes the runtime, so
// every completion writer ends it atomically. NULL (other models) stays NULL.
const IELTSSharedScheduleEndedAssign = "ielts_shared_schedule = IF(ielts_shared_schedule IS NULL OR JSON_UNQUOTE(JSON_EXTRACT(ielts_shared_schedule, '$.status')) = 'ended', ielts_shared_schedule, JSON_REMOVE(JSON_SET(ielts_shared_schedule, '$.status', 'ended', '$.scheduleRevision', CAST(JSON_EXTRACT(ielts_shared_schedule, '$.scheduleRevision') AS UNSIGNED) + 1), '$.pausedAt'))"

func dbNowInTx(ctx context.Context, q tx.Tx) (time.Time, error) {
	var now time.Time
	err := q.QueryRowContext(ctx, "SELECT UTC_TIMESTAMP(6)").Scan(&now)
	return now.UTC(), err
}

// pauseIELTSSharedInTx commits the paused timetable and reports whether the
// active section row's clock is running (working or pre-start) and must be
// paused too. A save-only drain or authored gap has no running row clock.
func pauseIELTSSharedInTx(ctx context.Context, q tx.Tx, rt *RuntimeRow) (bool, error) {
	now, err := dbNowInTx(ctx, q)
	if err != nil {
		return false, err
	}
	pauseRow := false
	err = amendIELTSSharedScheduleInTx(ctx, q, rt, func(s IELTSSharedSchedule) (IELTSSharedSchedule, error) {
		pos, err := ResolveIELTSSharedWindow(s, now)
		if err != nil {
			return s, err
		}
		pauseRow = pos.Window != nil && rt.ActiveSectionKey != nil && pos.Window.SectionKey == *rt.ActiveSectionKey &&
			(pos.Kind == SharedWorking || pos.Kind == SharedBeforeStart)
		return PauseIELTSSharedSchedule(s, now)
	})
	return pauseRow, err
}

type sharedRowEffect int

const (
	sharedRowAccumulate sharedRowEffect = iota // working: accumulate paused seconds
	sharedRowShiftStart                        // before start: move the start
	sharedRowUntouched                         // drain/gap: no running row clock
)

// resumeIELTSSharedInTx credits the whole-second pause to the timetable and
// tells Resume how to mirror it on the active row, so the row-derived
// deadline equals the timetable deadline.
func resumeIELTSSharedInTx(ctx context.Context, q tx.Tx, rt *RuntimeRow, serverNow time.Time) (int64, sharedRowEffect, error) {
	var secs int64
	effect := sharedRowUntouched
	err := amendIELTSSharedScheduleInTx(ctx, q, rt, func(s IELTSSharedSchedule) (IELTSSharedSchedule, error) {
		if s.PausedAt == nil {
			return s, apperrors.New(apperrors.CodeConflict, "The IELTS room schedule is not paused.")
		}
		if d := serverNow.Sub(*s.PausedAt); d > 0 {
			secs = int64(d / time.Second)
		}
		pos, err := ResolveIELTSSharedWindow(s, *s.PausedAt)
		if err != nil {
			return s, err
		}
		if pos.Window != nil && rt.ActiveSectionKey != nil && pos.Window.SectionKey == *rt.ActiveSectionKey {
			if pos.Window.StartAt.After(*s.PausedAt) {
				effect = sharedRowShiftStart
			} else if s.PausedAt.Before(pos.Window.DeadlineAt) {
				effect = sharedRowAccumulate
			}
		}
		return ResumeIELTSSharedSchedule(s, time.Duration(secs)*time.Second)
	})
	return secs, effect, err
}

// ExtendIELTSSharedInTx amends a shared timetable for a room time grant; it
// is a no-op for other models and refuses anything but the working section.
func ExtendIELTSSharedInTx(ctx context.Context, q tx.Tx, runtimeID, timingModel, sectionKey string, minutes int64) error {
	if !IsIELTSSharedSchedule(timingModel) {
		return nil
	}
	now, err := dbNowInTx(ctx, q)
	if err != nil {
		return err
	}
	return AmendIELTSSharedScheduleInTx(ctx, q, runtimeID, timingModel, func(s IELTSSharedSchedule) (IELTSSharedSchedule, error) {
		return ExtendIELTSSharedSection(s, sectionKey, time.Duration(minutes)*time.Minute, now)
	})
}
