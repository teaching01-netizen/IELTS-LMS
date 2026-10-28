package delivery

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"strings"

	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/tx"
)

type AudioCheckpointRequest struct {
	SectionKey    string `json:"sectionKey"`
	PartID        string `json:"partId"`
	MediaRevision string `json:"mediaRevision"`
	PositionMS    int64  `json:"positionMs"`
	Sequence      uint64 `json:"sequence"`
	LeaseEpoch    uint64 `json:"leaseEpoch"`
	RunGeneration uint64 `json:"runGeneration"`
}

type AudioCheckpointView struct {
	SectionKey    string                   `json:"sectionKey"`
	PartID        string                   `json:"partId"`
	MediaRevision string                   `json:"mediaRevision"`
	LeaseEpoch    uint64                   `json:"leaseEpoch"`
	RunGeneration uint64                   `json:"runGeneration"`
	Checkpoint    *RecoveryAudioCheckpoint `json:"checkpoint"`
}

func (s *Service) ReadAudioCheckpoint(ctx context.Context, claims crypto.AttemptClaims, partID string) (*AudioCheckpointView, error) {
	var out *AudioCheckpointView
	err := s.runner.WithTxRCRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		view, err := authorizeAudioCheckpoint(ctx, q, claims, partID)
		if err != nil {
			return err
		}
		view.Checkpoint, err = loadAudioCheckpoint(ctx, q, claims.AttemptID, view.PartID, view.MediaRevision)
		if err != nil {
			return err
		}
		out = view
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Service) SaveAudioCheckpoint(ctx context.Context, claims crypto.AttemptClaims, req AudioCheckpointRequest) (*AudioCheckpointView, error) {
	if req.SectionKey != "listening" || req.Sequence == 0 || req.PositionMS < 0 || req.PositionMS > 86400000 {
		return nil, apperrors.New(apperrors.CodeValidation, "Invalid audio checkpoint.")
	}
	var out *AudioCheckpointView
	err := s.runner.WithTxRCRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		view, err := authorizeAudioCheckpoint(ctx, q, claims, req.PartID)
		if err != nil {
			return err
		}
		if view.MediaRevision != req.MediaRevision || view.LeaseEpoch != req.LeaseEpoch || view.RunGeneration != req.RunGeneration {
			return recoveryConflict("RECOVERY_STALE", "The audio checkpoint belongs to a superseded media or exam run.", nil)
		}
		previous, err := loadAudioCheckpoint(ctx, q, claims.AttemptID, view.PartID, view.MediaRevision)
		if err != nil {
			return err
		}
		if previous != nil && previous.RunGeneration == req.RunGeneration {
			var priorLease uint64
			if err := q.QueryRowContext(ctx, `SELECT lease_epoch FROM attempt_audio_checkpoints WHERE attempt_id=? AND section_key='listening' AND part_id=? AND media_revision=?`, claims.AttemptID, req.PartID, req.MediaRevision).Scan(&priorLease); err != nil {
				return err
			}
			if priorLease == req.LeaseEpoch && previous.ClientSequence >= req.Sequence {
				if previous.ClientSequence == req.Sequence && previous.PositionMS != uint64(req.PositionMS) {
					return recoveryConflict("OPERATION_ID_CONFLICT", "An audio checkpoint sequence was reused with a different position.", nil)
				}
				view.Checkpoint = previous
				out = view
				return nil
			}
		}
		_, err = q.ExecContext(ctx, `INSERT INTO attempt_audio_checkpoints (attempt_id,section_key,part_id,media_revision,position_ms,client_sequence,lease_epoch,run_generation) VALUES (?,'listening',?,?,?,?,?,?) ON DUPLICATE KEY UPDATE position_ms=VALUES(position_ms),client_sequence=VALUES(client_sequence),lease_epoch=VALUES(lease_epoch),run_generation=VALUES(run_generation),updated_at=UTC_TIMESTAMP(6)`, claims.AttemptID, req.PartID, req.MediaRevision, req.PositionMS, req.Sequence, req.LeaseEpoch, req.RunGeneration)
		if err != nil {
			return err
		}
		view.Checkpoint, err = loadAudioCheckpoint(ctx, q, claims.AttemptID, req.PartID, req.MediaRevision)
		if err != nil {
			return err
		}
		out = view
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func authorizeAudioCheckpoint(ctx context.Context, q tx.Tx, claims crypto.AttemptClaims, partID string) (*AudioCheckpointView, error) {
	partID = strings.TrimSpace(partID)
	if len(partID) == 0 || len(partID) > 64 {
		return nil, apperrors.New(apperrors.CodeValidation, "A published audio part is required.")
	}
	var owner, controlRaw, contentRaw, configRaw, provider, examType, proctor, currentModule string
	var lease uint64
	var submitted sql.NullTime
	err := q.QueryRowContext(ctx, `SELECT COALESCE(a.active_client_session_id,''),a.lease_epoch,COALESCE(a.recovery_control,''),CAST(v.content_snapshot AS CHAR),CAST(v.config_snapshot AS CHAR),COALESCE(e.provider_key,''),COALESCE(e.exam_type,''),COALESCE(a.proctor_status,'active'),a.submitted_at,a.current_module FROM student_attempts a JOIN exam_versions v ON v.id=a.published_version_id JOIN exam_entities e ON e.id=a.exam_id WHERE a.id=? AND a.schedule_id=? AND a.user_id=? FOR UPDATE OF a`, claims.AttemptID, claims.ScheduleID, claims.UserID).Scan(&owner, &lease, &controlRaw, &contentRaw, &configRaw, &provider, &examType, &proctor, &submitted, &currentModule)
	if err != nil {
		return nil, err
	}
	if owner != claims.ClientSessionID || claims.LeaseEpoch == nil || *claims.LeaseEpoch != lease || submitted.Valid || proctor == "terminated" || proctor == "paused" {
		return nil, recoveryConflict("LEASE_FENCED", "This browser cannot update listening progress.", nil)
	}
	var valid int
	if err := q.QueryRowContext(ctx, `SELECT 1 FROM attempt_sessions WHERE token_id=? AND attempt_id=? AND client_session_id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP(6)`, claims.TokenID, claims.AttemptID, claims.ClientSessionID).Scan(&valid); err != nil {
		return nil, err
	}
	if examdomain.EffectiveProviderKey(provider, examType) != examdomain.ProviderIELTS {
		return nil, apperrors.New(apperrors.CodeForbidden, "Personal IELTS audio is required.")
	}
	control, err := examdomain.ParseRecoveryControl([]byte(controlRaw))
	if err != nil {
		return nil, err
	}
	if control == nil && currentModule != "listening" {
		return nil, recoveryConflict("RECOVERY_FOCUS", "Listening is not the current section.", nil)
	}
	generation := uint64(0)
	if control != nil {
		if control.Phase != examdomain.RecoveryPhaseWorking || control.Target.SectionKey != "listening" {
			return nil, recoveryConflict("RECOVERY_FOCUS", "Listening is not the focused recovery section.", nil)
		}
		generation = control.FocusRunGeneration
	}
	revision, err := publishedAudioRevision(contentRaw, configRaw, partID)
	if err != nil {
		return nil, err
	}
	return &AudioCheckpointView{SectionKey: "listening", PartID: partID, MediaRevision: revision, LeaseEpoch: lease, RunGeneration: generation}, nil
}

func publishedAudioRevision(contentRaw, configRaw, partID string) (string, error) {
	var content struct {
		Listening struct {
			Parts []struct {
				ID       string `json:"id"`
				AudioURL string `json:"audioUrl"`
			} `json:"parts"`
		} `json:"listening"`
	}
	var config struct {
		Sections struct {
			Listening struct {
				Playback *bool `json:"audioPlaybackEnabled"`
			} `json:"listening"`
		} `json:"sections"`
	}
	if err := json.Unmarshal([]byte(contentRaw), &content); err != nil {
		return "", err
	}
	if err := json.Unmarshal([]byte(configRaw), &config); err != nil {
		return "", err
	}
	if config.Sections.Listening.Playback != nil && !*config.Sections.Listening.Playback {
		return "", apperrors.New(apperrors.CodeForbidden, "Shared classroom audio does not support personal checkpoints.")
	}
	for _, part := range content.Listening.Parts {
		if part.ID == partID && strings.TrimSpace(part.AudioURL) != "" {
			sum := sha256.Sum256([]byte(part.AudioURL))
			return hex.EncodeToString(sum[:]), nil
		}
	}
	return "", apperrors.New(apperrors.CodeNotFound, "Published listening audio not found.")
}

func loadAudioCheckpoint(ctx context.Context, q tx.Tx, attemptID, partID, revision string) (*RecoveryAudioCheckpoint, error) {
	var out RecoveryAudioCheckpoint
	err := q.QueryRowContext(ctx, `SELECT section_key,part_id,media_revision,position_ms,client_sequence,run_generation,updated_at FROM attempt_audio_checkpoints WHERE attempt_id=? AND section_key='listening' AND part_id=? AND media_revision=?`, attemptID, partID, revision).Scan(&out.SectionKey, &out.PartID, &out.MediaRevision, &out.PositionMS, &out.ClientSequence, &out.RunGeneration, &out.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &out, nil
}
