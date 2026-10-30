package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"regexp"
	"strings"
	"time"

	examdomain "example.com/ielts-proctoring/internal/exams"
	examruntime "example.com/ielts-proctoring/internal/runtime"
)

// ieltsOfflineManifestMaxMedia bounds the package a browser is asked to hold.
const ieltsOfflineManifestMaxMedia = 256

// ieltsOfflineMedia is one resource the browser must hold before it may report
// the exam prepared. SHA256/Bytes are nil: published IELTS media are
// arbitrary URLs and delivery renditions, so no trusted digest exists server
// side. The browser hashes the bytes it verified and re-checks them on read.
type ieltsOfflineMedia struct {
	ResourceID    string  `json:"resourceId"`
	Kind          string  `json:"kind"`
	PartID        *string `json:"partId"`
	MediaRevision string  `json:"mediaRevision"`
	URL           string  `json:"url"`
	SHA256        *string `json:"sha256"`
	Bytes         *int64  `json:"bytes"`
}

// ieltsOfflineManifest is a descriptor delivered under the session's existing
// authentication; it is not a credential and authorizes nothing server side.
type ieltsOfflineManifest struct {
	SchemaVersion         int                             `json:"schemaVersion"`
	RuntimeID             string                          `json:"runtimeId"`
	ScheduleID            string                          `json:"scheduleId"`
	AttemptID             string                          `json:"attemptId"`
	PublishedVersionID    string                          `json:"publishedVersionId"`
	ClientSessionID       string                          `json:"clientSessionId"`
	LeaseEpoch            uint64                          `json:"leaseEpoch"`
	ControlEpoch          uint64                          `json:"controlEpoch"`
	RecoveryRunGeneration *uint64                         `json:"recoveryRunGeneration"`
	Schedule              examruntime.IELTSSharedSchedule `json:"schedule"`
	ServerNow             time.Time                       `json:"serverNow"`
	ContentDigest         string                          `json:"contentDigest"`
	Media                 []ieltsOfflineMedia             `json:"media"`
}

var htmlImageSource = regexp.MustCompile(`(?i)<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']`)

func mediaRevisionFor(url string) string {
	sum := sha256.Sum256([]byte(url))
	return hex.EncodeToString(sum[:])
}

func offlineMediaURL(raw string) (string, bool) {
	url := strings.TrimSpace(raw)
	if len(url) == 0 || len(url) > 2048 {
		return "", false
	}
	lower := strings.ToLower(url)
	return url, strings.HasPrefix(lower, "https://") || strings.HasPrefix(lower, "http://") || (strings.HasPrefix(url, "/") && !strings.HasPrefix(url, "//"))
}

// collectIELTSOfflineMedia lists the listening audio and every image the
// student-filtered content references, including images inside rich text.
// The revision rule for audio matches delivery.publishedAudioRevision so
// cached audio binds to the same checkpoint identity.
func collectIELTSOfflineMedia(content map[string]any, audioEnabled bool) []ieltsOfflineMedia {
	out := []ieltsOfflineMedia{}
	seen := map[string]bool{}
	add := func(kind, raw string, partID *string) {
		url, ok := offlineMediaURL(raw)
		if !ok || len(out) >= ieltsOfflineManifestMaxMedia {
			return
		}
		scope := ""
		if partID != nil {
			scope = *partID
		}
		// Per part: each listening part binds its own checkpoint identity.
		id := mediaRevisionFor(kind + "\x00" + scope + "\x00" + url)[:32]
		if seen[id] {
			return
		}
		seen[id] = true
		out = append(out, ieltsOfflineMedia{ResourceID: id, Kind: kind, PartID: partID, MediaRevision: mediaRevisionFor(url), URL: url})
	}
	if listening, ok := content["listening"].(map[string]any); ok && audioEnabled {
		parts, _ := listening["parts"].([]any)
		for _, raw := range parts {
			part, _ := raw.(map[string]any)
			id, _ := part["id"].(string)
			audio, _ := part["audioUrl"].(string)
			if id != "" && audio != "" {
				partID := id
				add("audio", audio, &partID)
			}
		}
	}
	var walk func(key string, node any)
	walk = func(key string, node any) {
		switch v := node.(type) {
		case map[string]any:
			for k, child := range v {
				if k == "audioUrl" {
					continue
				}
				walk(k, child)
			}
		case []any:
			for _, child := range v {
				walk(key, child)
			}
		case string:
			lower := strings.ToLower(key)
			if strings.HasSuffix(lower, "imageurl") || lower == "src" || lower == "imagesrc" {
				add("image", v, nil)
			}
			if strings.Contains(v, "<img") {
				for _, m := range htmlImageSource.FindAllStringSubmatch(v, -1) {
					add("image", m[1], nil)
				}
			}
		}
	}
	walk("", content)
	return out
}

func ieltsAudioPlaybackEnabled(config map[string]any) bool {
	sections, _ := config["sections"].(map[string]any)
	listening, _ := sections["listening"].(map[string]any)
	enabled, ok := listening["audioPlaybackEnabled"].(bool)
	return !ok || enabled
}

// buildIELTSOfflineManifest returns nil for every room that is not on the
// shared timetable.
func buildIELTSOfflineManifest(ctx context.Context, db *sql.DB, runtime map[string]any, version map[string]any, attemptID, clientSessionID string, leaseEpoch uint64) (*ieltsOfflineManifest, error) {
	if runtime == nil || version == nil || runtime["timingModel"] != examruntime.TimingModelIELTSSharedSchedule {
		return nil, nil
	}
	raw, err := json.Marshal(runtime["ieltsSharedSchedule"])
	if err != nil {
		return nil, err
	}
	schedule, err := examruntime.ParseIELTSSharedSchedule(raw)
	if err != nil {
		return nil, nil
	}
	var scheduleID, versionID, recoveryRaw string
	var controlEpoch uint64
	var serverNow time.Time
	if err := db.QueryRowContext(ctx, `SELECT schedule_id, published_version_id, control_epoch, COALESCE(recovery_control, ''), UTC_TIMESTAMP(6) FROM student_attempts WHERE id = ?`, attemptID).
		Scan(&scheduleID, &versionID, &controlEpoch, &recoveryRaw, &serverNow); err != nil {
		return nil, err
	}
	var generation *uint64
	if recovery, err := examdomain.ParseRecoveryControl([]byte(recoveryRaw)); err != nil {
		return nil, err
	} else if recovery != nil {
		g := recovery.FocusRunGeneration
		generation = &g
	}
	encoded, err := json.Marshal(version)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(encoded)
	content, _ := version["contentSnapshot"].(map[string]any)
	config, _ := version["configSnapshot"].(map[string]any)
	runtimeID, _ := runtime["id"].(string)
	return &ieltsOfflineManifest{
		SchemaVersion: 1, RuntimeID: runtimeID, ScheduleID: scheduleID, AttemptID: attemptID,
		PublishedVersionID: versionID, ClientSessionID: clientSessionID, LeaseEpoch: leaseEpoch,
		ControlEpoch: controlEpoch, RecoveryRunGeneration: generation, Schedule: schedule,
		ServerNow: serverNow.UTC(), ContentDigest: hex.EncodeToString(digest[:]),
		Media: collectIELTSOfflineMedia(content, ieltsAudioPlaybackEnabled(config)),
	}, nil
}
