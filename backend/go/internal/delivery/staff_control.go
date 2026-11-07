package delivery

import (
	"context"
	"database/sql"
	"encoding/json"
	"example.com/ielts-proctoring/internal/satpublish"
	"github.com/google/uuid"
	"log/slog"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/lifecycle"
	"example.com/ielts-proctoring/internal/liveupdates"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	examruntime "example.com/ielts-proctoring/internal/runtime"
)

// SATStaffControlRequest names the exact roster reviewed by staff. Presence is
// deliberately irrelevant: an offline browser adopts the committed state later.
type SATStaffControlRequest struct {
	OperationID      string            `json:"operationId"`
	AttemptIDs       []string          `json:"attemptIds"`
	Action           string            `json:"action"`
	RemainingSeconds *int              `json:"remainingSeconds"`
	ExpectedStages   map[string]string `json:"expectedStages,omitempty"`
	SectionKey       string            `json:"sectionKey,omitempty"`
	Destination      string            `json:"destination,omitempty"`
	Route            string            `json:"route,omitempty"`
}
type SATStaffControlOutcome struct {
	AttemptID string `json:"attemptId"`
	Applied   bool   `json:"applied"`
	Error     string `json:"error,omitempty"`
}
type SATStaffControlResult struct {
	Outcomes []SATStaffControlOutcome `json:"outcomes"`
}

// ApplySATStaffControl is called only after assignment and tenant authorization
// at the staff HTTP boundary. Each attempt commits independently; one failed
// student never rolls back the rest of a room action.
func (s *Service) ApplySATStaffControl(ctx context.Context, actorID, scheduleID string, req SATStaffControlRequest) (*SATStaffControlResult, error) {
	if req.OperationID == "" || len(req.OperationID) > 64 || len(req.AttemptIDs) == 0 || len(req.AttemptIDs) > 5000 || req.RemainingSeconds == nil || *req.RemainingSeconds < 0 || *req.RemainingSeconds > 86400 || (req.Action != "set_time" && req.Action != "move") {
		return nil, apperrors.New(apperrors.CodeValidation, "Choose students, an action, and remaining time between 00:00 and 1440:00.")
	}
	out := &SATStaffControlResult{Outcomes: []SATStaffControlOutcome{}}
	seen := map[string]bool{}
	for _, id := range req.AttemptIDs {
		if strings.TrimSpace(id) == "" || seen[id] {
			return nil, apperrors.New(apperrors.CodeValidation, "Student identities must be nonempty and unique.")
		}
		seen[id] = true
	}
	for _, id := range req.AttemptIDs {
		err := s.applySATStaffControl(ctx, actorID, scheduleID, id, req)
		result := SATStaffControlOutcome{AttemptID: id, Applied: err == nil}
		if err != nil {
			result.Error = "This student's change could not be applied. Refresh the room and retry."
			if e, ok := apperrors.As(err); ok {
				result.Error = e.Message
			} else {
				slog.ErrorContext(ctx, "SAT staff control failed", "attempt_id", id, "error", err)
			}
		}
		out.Outcomes = append(out.Outcomes, result)
	}
	return out, nil
}

func (s *Service) applySATStaffControl(ctx context.Context, actorID, scheduleID, attemptID string, req SATStaffControlRequest) error {
	hash, err := lifecycle.Hash("sat_staff_control", struct {
		Actor   string
		Request SATStaffControlRequest
	}{actorID, req})
	if err != nil {
		return err
	}
	scope := lifecycle.Scope{ScheduleID: scheduleID, AttemptID: attemptID}
	var events []liveupdates.Event
	err = s.runner.WithTxRCRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		events = nil
		var terminal, waitingForCode, started bool
		var provider, proctorStatus, versionID, rawRecovery string
		err := q.QueryRowContext(ctx, `SELECT (a.submitted_at IS NOT NULL OR a.phase='post-exam' OR COALESCE(a.delivery_status,'running') IN ('submitted','terminated','locked','cancelled') OR COALESCE(a.proctor_status,'active')='terminated'), e.provider_key, COALESCE(a.proctor_status,'active'),a.published_version_id,COALESCE(a.recovery_control,''),(a.sat_start_code_required AND a.sat_start_code_accepted_at IS NULL),EXISTS(SELECT 1 FROM assessment_module_attempts ma WHERE ma.attempt_id=a.id AND (ma.started_at IS NOT NULL OR ma.submitted_at IS NOT NULL)) FROM student_attempts a JOIN exam_entities e ON e.id=a.exam_id WHERE a.id=? AND a.schedule_id=? FOR UPDATE OF a`, attemptID, scheduleID).Scan(&terminal, &provider, &proctorStatus, &versionID, &rawRecovery, &waitingForCode, &started)
		if err == sql.ErrNoRows {
			return apperrors.New(apperrors.CodeNotFound, "Student not found in this room.")
		}
		if err != nil {
			return err
		}
		if provider != "sat" {
			return apperrors.New(apperrors.CodeValidation, "These controls are available for SAT rooms only.")
		}
		receipt, err := lifecycle.Load(ctx, q, scope, req.OperationID, "sat_staff_control", hash)
		if err != nil {
			return err
		}
		if receipt != nil {
			return nil
		}
		if waitingForCode || !started {
			return apperrors.New(apperrors.CodeConflict, "The student has not started their exam.")
		}
		if terminal {
			return apperrors.New(apperrors.CodeConflict, "Finished attempts cannot be edited.")
		}
		var status string
		if err := q.QueryRowContext(ctx, "SELECT status FROM exam_session_runtimes WHERE schedule_id=? FOR SHARE", scheduleID).Scan(&status); err != nil {
			return err
		}
		if status != "live" && status != "paused" {
			return apperrors.New(apperrors.CodeConflict, "This room is not running.")
		}
		if rawRecovery != "" {
			return apperrors.New(apperrors.CodeConflict, "Finish the active device recovery before changing exam controls.")
		}
		now, err := dbTimeTx(ctx, q)
		if err != nil {
			return err
		}
		if req.Action == "move" {
			if err := s.moveSATStudentTx(ctx, q, scheduleID, attemptID, versionID, req, now, proctorStatus == "paused" || status == "paused"); err != nil {
				return err
			}
		} else {
			if expected := req.ExpectedStages[attemptID]; expected != "" {
				var current string
				if err := q.QueryRowContext(ctx, `SELECT COALESCE((SELECT CONCAT('break:',id) FROM assessment_attempt_breaks WHERE attempt_id=? AND state='active' LIMIT 1),(SELECT CONCAT('module:',module_id) FROM assessment_module_attempts WHERE attempt_id=? AND state IN ('active','review') LIMIT 1),'')`, attemptID, attemptID).Scan(&current); err != nil {
					return err
				}
				if current != expected {
					return apperrors.New(apperrors.CodeConflict, "This student's stage changed. Refresh the room and review the new stage.")
				}
			}
			if err := setSATStaffTimeTx(ctx, q, attemptID, *req.RemainingSeconds, now, proctorStatus == "paused" || status == "paused"); err != nil {
				return err
			}
		}

		if err := examruntime.RealignSATRecoveryBoundariesInTx(ctx, q, scheduleID, attemptID); err != nil {
			return err
		}
		if _, err := q.ExecContext(ctx, `UPDATE student_attempts SET sat_staff_control=JSON_OBJECT('revision',control_epoch+1,'action',?,'changedAt',?,'remainingSeconds',?,'destination',?,'sectionKey',?), deadline_at=TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP(6)),closing_grace_until=NULL,control_epoch=control_epoch+1,revision=revision+1 WHERE id=?`, req.Action, now.Format(time.RFC3339Nano), *req.RemainingSeconds, req.Destination, req.SectionKey, *req.RemainingSeconds, attemptID); err != nil {
			return err
		}
		rev, err := s.appendModuleEventsTx(ctx, q, scheduleID, attemptID, liveEventModuleSubmitted)
		if err != nil {
			return err
		}
		events = dualModuleEvents(scheduleID, attemptID, rev, liveEventModuleSubmitted)
		return lifecycle.Store(ctx, q, scope, req.OperationID, "sat_staff_control", hash, json.RawMessage(`{"ok":true}`))
	})
	if err == nil {
		s.publishHubEvents(events)
	}
	return err
}

// SATStaffControl is the latest server intervention. Its monotonic revision
// distinguishes a deliberate reopen from a stale pre-finalization payload.
type SATStaffMoveSource struct {
	ModuleAttemptID     string   `json:"moduleAttemptId"`
	ModuleID            string   `json:"moduleId"`
	ThroughControlEpoch uint64   `json:"throughControlEpoch"`
	QuestionIDs         []string `json:"questionIds"`
}

type SATStaffControl struct {
	RemainingSeconds *int                 `json:"remainingSeconds,omitempty"`
	Destination      string               `json:"destination,omitempty"`
	SectionKey       string               `json:"sectionKey,omitempty"`
	Sources          []SATStaffMoveSource `json:"sources,omitempty"`
	Revision         uint64               `json:"revision"`
	Action           string               `json:"action"`
	ChangedAt        string               `json:"changedAt"`
}

func decodeSATStaffControl(raw sql.NullString) (*SATStaffControl, error) {
	if !raw.Valid {
		return nil, nil
	}
	var c SATStaffControl
	err := json.Unmarshal([]byte(raw.String), &c)
	return &c, err
}
func (s *Service) loadStaffMoveSources(ctx context.Context, attemptID string, c *SATStaffControl) error {
	if c == nil {
		return nil
	}
	rows, err := s.db.QueryContext(ctx, `SELECT ma.id,ma.module_id,src.last_epoch,CAST(JSON_ARRAYAGG(eq.id) AS CHAR) FROM assessment_module_attempts ma JOIN (SELECT module_id,MAX(control_epoch) last_epoch FROM assessment_staff_move_sources WHERE attempt_id=? GROUP BY module_id) src ON src.module_id=ma.module_id JOIN assessment_exam_questions eq ON eq.module_id=ma.module_id WHERE ma.attempt_id=? GROUP BY ma.id,ma.module_id,src.last_epoch`, attemptID, attemptID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var row SATStaffMoveSource
		var questions []byte
		if err := rows.Scan(&row.ModuleAttemptID, &row.ModuleID, &row.ThroughControlEpoch, &questions); err != nil {
			return err
		}
		if err := json.Unmarshal(questions, &row.QuestionIDs); err != nil {
			return err
		}
		c.Sources = append(c.Sources, row)
	}
	return rows.Err()
}

func applySATStaffTiming(c *SATStaffControl, timing *TimingSnapshot) {
	if c == nil {
		return
	}
	timing.TimingModel = examruntime.TimingModelPersonal
	timing.Authority = "staff_attempt"
	timing.WaitingForNextSection = false
	timing.NextSectionStartAt = nil
}

func setSATStaffTimeTx(ctx context.Context, q tx.Tx, attemptID string, seconds int, now time.Time, paused bool) error {
	result, err := q.ExecContext(ctx, `UPDATE assessment_attempt_breaks SET duration_seconds=?,starts_at=?,deadline_at=TIMESTAMPADD(SECOND,?,?),paused_at=IF(paused_at IS NULL,NULL,?),accumulated_paused_seconds=0,revision=revision+1 WHERE attempt_id=? AND state='active'`, seconds, now, seconds, now, now, attemptID)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n == 1 {
		return nil
	}
	var moduleID string
	var boundary sql.NullString
	err = q.QueryRowContext(ctx, `SELECT ma.module_id,b.phase FROM assessment_module_attempts ma LEFT JOIN assessment_module_boundaries b ON b.module_attempt_id=ma.id AND b.run_generation=ma.run_generation WHERE ma.attempt_id=? AND ma.state IN ('active','review') AND ma.started_at IS NOT NULL`, attemptID).Scan(&moduleID, &boundary)
	if err == sql.ErrNoRows {
		return apperrors.New(apperrors.CodeConflict, "The student has no active module or break to edit.")
	}
	if err != nil {
		return err
	}
	if boundary.Valid && boundary.String != "working" {
		if err := recordStaffMoveSourcesTx(ctx, q, attemptID); err != nil {
			return err
		}
		return activateStaffModuleTx(ctx, q, attemptID, DeliveryModule{ID: moduleID}, seconds, now, paused)
	}
	result, err = q.ExecContext(ctx, `UPDATE assessment_module_attempts SET extension_seconds=TIMESTAMPDIFF(SECOND,started_at,COALESCE(paused_at,?))-allocated_seconds-accumulated_paused_seconds+?,revision=revision+1 WHERE attempt_id=? AND state IN ('active','review') AND started_at IS NOT NULL`, now, seconds, attemptID)
	if err != nil {
		return err
	}
	n, err = result.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return apperrors.New(apperrors.CodeConflict, "The student has no active module or break to edit.")
	}
	return nil
}

func staffModuleAttemptTx(ctx context.Context, q tx.Tx, attemptID string, m DeliveryModule) (string, error) {
	if _, err := q.ExecContext(ctx, `INSERT INTO assessment_module_attempts(id,attempt_id,module_id,state,allocated_seconds,tool_state) VALUES(?,?,?,'not_started',?,'{}') ON DUPLICATE KEY UPDATE id=id`, uuid.NewString(), attemptID, m.ID, m.DurationSeconds); err != nil {
		return "", err
	}
	var id string
	err := q.QueryRowContext(ctx, "SELECT id FROM assessment_module_attempts WHERE attempt_id=? AND module_id=? FOR UPDATE", attemptID, m.ID).Scan(&id)
	return id, err
}
func (s *Service) closeStaffModuleTx(ctx context.Context, q tx.Tx, attemptID, moduleAttemptID, moduleID string) error {
	if _, err := ensureSatModuleBoundaryTx(ctx, q, attemptID, moduleAttemptID); err != nil {
		return err
	}
	if _, err := q.ExecContext(ctx, `UPDATE assessment_module_boundaries b JOIN assessment_module_attempts ma ON ma.id=b.module_attempt_id AND ma.run_generation=b.run_generation SET b.phase='ended',b.resolution='ended',b.next_action_at=NULL,b.revision=b.revision+1 WHERE ma.id=?`, moduleAttemptID); err != nil {
		return err
	}
	rows, err := loadScoringRowsTx(ctx, q, moduleAttemptID, moduleID)
	if err != nil {
		return err
	}
	correct, total := scoreScoringRows(rows)
	_, err = q.ExecContext(ctx, `UPDATE assessment_module_attempts SET state='locked',submitted_at=UTC_TIMESTAMP(6),locked_at=UTC_TIMESTAMP(6),paused_at=NULL,completion_reason='proctor_end',raw_correct=?,operational_question_count=?,revision=revision+1 WHERE id=?`, correct, total, moduleAttemptID)
	return err
}

func (s *Service) staffBranchTx(ctx context.Context, q tx.Tx, attemptID string, section DeliverySection, route string, plan satpublish.Plan) (DeliveryModule, error) {
	var base, lower, higher DeliveryModule
	for _, m := range section.Modules {
		switch m.AdaptiveRole {
		case "base":
			base = m
		case "lower_branch":
			lower = m
		case "higher_branch":
			higher = m
		}
	}
	if route != "automatic" && route != "lower" && route != "higher" {
		return DeliveryModule{}, apperrors.New(apperrors.CodeValidation, "Choose automatic, easier, or harder Module 2.")
	}
	if plan.ShapeFor(section.SectionKey).EntryRole() != "base" {
		target := staffEntryModule(section, plan)
		if target.ID == "" || (route != "automatic" && route+"_branch" != target.AdaptiveRole) {
			return DeliveryModule{}, apperrors.New(apperrors.CodeValidation, "This Module 2 is not available in the room's published plan.")
		}
		return target, nil
	}
	if base.ID == "" {
		return DeliveryModule{}, apperrors.New(apperrors.CodeValidation, "The selected section has no Module 1.")
	}
	baseAttemptID, err := staffModuleAttemptTx(ctx, q, attemptID, base)
	if err != nil {
		return DeliveryModule{}, err
	}
	scoring, err := loadScoringRowsTx(ctx, q, baseAttemptID, base.ID)
	if err != nil {
		return DeliveryModule{}, err
	}
	correct, total := scoreScoringRows(scoring)
	var config, key string
	var revision int
	if err := q.QueryRowContext(ctx, "SELECT policy_config,policy_key,revision FROM assessment_routing_policies WHERE section_id=?", section.ID).Scan(&config, &key, &revision); err != nil {
		return DeliveryModule{}, err
	}
	if route == "automatic" {
		route, err = chooseAdaptiveRoute(correct, total, config)
		if err != nil {
			return DeliveryModule{}, err
		}
		if forced := plan.ShapeFor(section.SectionKey).ForcedBranch(); forced != "" {
			route = strings.TrimSuffix(forced, "_branch")
		}
	}
	chosen := lower
	if route == "higher" {
		chosen = higher
	}
	if chosen.ID == "" || !plan.Uses(section.SectionKey, chosen.AdaptiveRole) {
		return DeliveryModule{}, apperrors.New(apperrors.CodeValidation, "This Module 2 is not available in the room's published plan.")
	}
	if _, err := q.ExecContext(ctx, `INSERT INTO assessment_route_decisions(id,attempt_id,section_id,base_module_attempt_id,base_module_id,selected_module_id,selected_route,raw_correct,operational_question_count,policy_key,policy_revision,policy_config,route_basis) VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'proctor_end') ON DUPLICATE KEY UPDATE selected_module_id=VALUES(selected_module_id),selected_route=VALUES(selected_route),raw_correct=VALUES(raw_correct),operational_question_count=VALUES(operational_question_count),policy_key=VALUES(policy_key),policy_revision=VALUES(policy_revision),policy_config=VALUES(policy_config)`, uuid.NewString(), attemptID, section.ID, baseAttemptID, base.ID, chosen.ID, route, correct, total, "staff_control_"+key, revision, config); err != nil {
		return DeliveryModule{}, err
	}
	return chosen, nil
}

func activateStaffModuleTx(ctx context.Context, q tx.Tx, attemptID string, m DeliveryModule, seconds int, now time.Time, paused bool) error {
	id, err := staffModuleAttemptTx(ctx, q, attemptID, m)
	if err != nil {
		return err
	}
	if _, err := q.ExecContext(ctx, `UPDATE assessment_module_attempts SET run_generation=run_generation+1,revision=revision+1 WHERE id=?`, id); err != nil {
		return err
	}
	policy, err := satRecoveryPolicyTx(ctx, q, attemptID)
	if err != nil {
		return err
	}
	if policy != nil {
		if _, err := q.ExecContext(ctx, `INSERT INTO assessment_module_boundaries(module_attempt_id,attempt_id,run_generation,phase,policy_version,work_deadline_at,recovery_deadline_at,next_action_at) SELECT id,attempt_id,run_generation,'working',?,TIMESTAMPADD(SECOND,?,?),TIMESTAMPADD(SECOND,?,?),IF(?,NULL,TIMESTAMPADD(SECOND,?,?)) FROM assessment_module_attempts WHERE id=?`, policy.Version, seconds, now, seconds+policy.RecoverySeconds, now, paused, seconds, now, id); err != nil {
			return err
		}
	}
	var pause any
	if paused {
		pause = now
	}
	_, err = q.ExecContext(ctx, `UPDATE assessment_module_attempts SET state='active',allocated_seconds=?,extension_seconds=0,accumulated_paused_seconds=0,started_at=?,available_at=?,paused_at=?,submitted_at=NULL,locked_at=NULL,completion_reason=NULL,raw_correct=NULL,operational_question_count=NULL,auto_start_at=NULL,entry_starts_at=NULL,entry_confirmed_at=NULL,entry_entered_at=?,entry_generation=entry_generation+1,revision=revision+1 WHERE id=?`, seconds, now, now, pause, now, id)
	return err
}

func (s *Service) moveSATStudentTx(ctx context.Context, q tx.Tx, scheduleID, attemptID, versionID string, req SATStaffControlRequest, now time.Time, paused bool) error {
	snapshot := s.withTxDatabase(q)
	sectionRows, err := loadBulkDeliverySections(ctx, q, versionID)
	if err != nil {
		return err
	}
	moduleRows, err := loadBulkDeliveryModules(ctx, q, versionID)
	if err != nil {
		return err
	}
	sections := assembleDeliveryTree(sectionRows, moduleRows, nil)
	scope, err := snapshot.effectiveSectionScope(ctx, scheduleID, versionID)
	if err != nil {
		return err
	}
	sections = deliverySectionsForScope(sections, scope)
	plan, err := satpublish.LoadPlan(ctx, q, versionID)
	if err != nil {
		return err
	}
	var section *DeliverySection
	for i := range sections {
		if sections[i].SectionKey == req.SectionKey {
			section = &sections[i]
			break
		}
	}
	if section == nil {
		return apperrors.New(apperrors.CodeValidation, "Choose a section configured for this room.")
	}
	if req.Destination != "module_1" && req.Destination != "module_2" && req.Destination != "break" {
		return apperrors.New(apperrors.CodeValidation, "Choose Module 1, Module 2, or Break.")
	}
	var target DeliveryModule
	if req.Destination == "break" {
		if section.BreakAfterSeconds <= 0 {
			return apperrors.New(apperrors.CodeValidation, "This section has no configured break.")
		}
	} else if req.Destination == "module_2" {
		target, err = s.staffBranchTx(ctx, q, attemptID, *section, req.Route, plan)
		if err != nil {
			return err
		}
	} else {
		for _, m := range section.Modules {
			if m.AdaptiveRole == "base" && plan.Uses(section.SectionKey, "base") {
				target = m
				break
			}
		}
		if target.ID == "" {
			return apperrors.New(apperrors.CodeValidation, "Module 1 is not available in this room.")
		}
	}
	for _, prior := range sections {
		if prior.DisplayOrder > section.DisplayOrder || (prior.DisplayOrder == section.DisplayOrder && req.Destination != "break") {
			continue
		}
		if err := s.seedStaffSkippedSectionTx(ctx, q, attemptID, prior, plan); err != nil {
			return err
		}
	}
	if err := recordStaffMoveSourcesTx(ctx, q, attemptID); err != nil {
		return err
	}

	rows, err := q.QueryContext(ctx, "SELECT id,module_id FROM assessment_module_attempts WHERE attempt_id=? AND state IN ('active','review','not_started') ORDER BY id FOR UPDATE", attemptID)
	if err != nil {
		return err
	}
	type pending struct{ id, moduleID string }
	var pendingRows []pending
	for rows.Next() {
		var r pending
		if err := rows.Scan(&r.id, &r.moduleID); err != nil {
			rows.Close()
			return err
		}
		pendingRows = append(pendingRows, r)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, m := range pendingRows {
		if err := s.closeStaffModuleTx(ctx, q, attemptID, m.id, m.moduleID); err != nil {
			return err
		}
	}
	if _, err := q.ExecContext(ctx, `UPDATE assessment_attempt_breaks SET state='completed',revision=revision+1 WHERE attempt_id=? AND state<>'completed'`, attemptID); err != nil {
		return err
	}
	if req.Destination == "break" {
		if err := createPersonalBreakTx(ctx, q, attemptID, section.ID, section.BreakAfterSeconds); err != nil {
			return err
		}
		var pause any
		if paused {
			pause = now
		}
		if _, err := q.ExecContext(ctx, `UPDATE assessment_attempt_breaks SET state='active',duration_seconds=?,starts_at=?,deadline_at=TIMESTAMPADD(SECOND,?,?),entered_at=?,paused_at=?,accumulated_paused_seconds=0,entry_generation=entry_generation+1,revision=revision+1 WHERE attempt_id=? AND after_section_id=?`, *req.RemainingSeconds, now, *req.RemainingSeconds, now, now, pause, attemptID, section.ID); err != nil {
			return err
		}
		for _, next := range sections {
			if next.DisplayOrder <= section.DisplayOrder {
				continue
			}
			m := staffEntryModule(next, plan)
			if m.ID != "" {
				return prepareStaffModuleTx(ctx, q, attemptID, m, nil, nil)
			}
			break
		}
		return nil
	}
	return activateStaffModuleTx(ctx, q, attemptID, target, *req.RemainingSeconds, now, paused)
}

func staffEntryModule(section DeliverySection, plan satpublish.Plan) DeliveryModule {
	for _, m := range section.Modules {
		if m.AdaptiveRole == plan.ShapeFor(section.SectionKey).EntryRole() {
			return m
		}
	}
	return DeliveryModule{}
}
func (s *Service) seedStaffSkippedSectionTx(ctx context.Context, q tx.Tx, attemptID string, section DeliverySection, plan satpublish.Plan) error {
	entry := staffEntryModule(section, plan)
	if entry.ID == "" {
		return apperrors.New(apperrors.CodeValidation, "A configured section has no entry module.")
	}
	if _, err := staffModuleAttemptTx(ctx, q, attemptID, entry); err != nil {
		return err
	}
	if entry.AdaptiveRole != "base" || plan.ShapeFor(section.SectionKey) == satpublish.ShapeM1Only {
		return nil
	}
	var chosen string
	err := q.QueryRowContext(ctx, "SELECT selected_module_id FROM assessment_route_decisions WHERE attempt_id=? AND section_id=?", attemptID, section.ID).Scan(&chosen)
	if err == sql.ErrNoRows {
		m, err := s.staffBranchTx(ctx, q, attemptID, section, "automatic", plan)
		if err != nil {
			return err
		}
		chosen = m.ID
	} else if err != nil {
		return err
	}
	for _, m := range section.Modules {
		if m.ID == chosen {
			_, err := staffModuleAttemptTx(ctx, q, attemptID, m)
			return err
		}
	}
	return apperrors.New(apperrors.CodeConflict, "The recorded Module 2 choice is unavailable.")
}

func prepareStaffModuleTx(ctx context.Context, q tx.Tx, attemptID string, m DeliveryModule, availableAt, autoStartAt *time.Time) error {
	id, err := staffModuleAttemptTx(ctx, q, attemptID, m)
	if err != nil {
		return err
	}
	if _, err = q.ExecContext(ctx, `UPDATE assessment_module_attempts SET state='not_started',allocated_seconds=?,extension_seconds=0,accumulated_paused_seconds=0,started_at=NULL,available_at=?,paused_at=NULL,submitted_at=NULL,locked_at=NULL,completion_reason=NULL,raw_correct=NULL,operational_question_count=NULL,auto_start_at=?,entry_starts_at=NULL,entry_confirmed_at=NULL,entry_entered_at=NULL,entry_generation=entry_generation+1,run_generation=run_generation+1,revision=revision+1 WHERE id=?`, m.DurationSeconds, availableAt, autoStartAt, id); err != nil {
		return err
	}
	_, err = ensureSatModuleBoundaryTx(ctx, q, attemptID, id)
	return err
}

func staffFollowupWasClosed(ctx context.Context, q tx.Tx, attemptID, moduleID string) (bool, error) {
	var reopen bool
	err := q.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM assessment_module_attempts ma JOIN student_attempts a ON a.id=ma.attempt_id WHERE ma.attempt_id=? AND ma.module_id=? AND ma.state IN ('locked','submitted') AND a.sat_staff_control IS NOT NULL)`, attemptID, moduleID).Scan(&reopen)
	return reopen, err
}

func recordStaffMoveSourcesTx(ctx context.Context, q tx.Tx, attemptID string) error {
	_, err := q.ExecContext(ctx, `INSERT INTO assessment_staff_move_sources(attempt_id,module_id,control_epoch,lease_epoch,response_revision) SELECT a.id,ma.module_id,a.control_epoch,a.lease_epoch,a.response_revision FROM student_attempts a JOIN assessment_module_attempts ma ON ma.attempt_id=a.id WHERE a.id=? AND ma.state IN ('active','review') ON DUPLICATE KEY UPDATE response_revision=assessment_staff_move_sources.response_revision`, attemptID)
	return err
}
