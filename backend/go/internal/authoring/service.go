// Package authoring owns SAT/IELTS assessment authoring reads and writes.
//
// It mirrors backend/crates/application/src/assessment_authoring.rs: shell,
// preview, open_shell (clone-published-to-draft), sample-template fill,
// workbook import preview/commit/undo, question CRUD +
// batch/bulk/order/duplicate, revision save, delivery-settings update, and
// exam validation. All state flows through explicit SQL with row locks; the
// service holds no package-level state.
//
// SAT adaptive role checks: adaptive_role is one of none|base|lower_branch|
// higher_branch (migration 0032 CHECK). Every section needs exactly one base
// module plus lower_branch + higher_branch modules, and the routing policy
// (base/lower/higher module ids + minimum_correct_for_higher within
// 1..operational) must match those roles. IELTS providers skip adaptive
// checks; only SAT drafts enforce the blueprint gate in ValidateExam.
package authoring

import (
	"database/sql"
	"encoding/json"
	"strings"

	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// Adaptive roles (migration 0032 CHECK vocabulary).
const (
	RoleNone         = "none"
	RoleBase         = "base"
	RoleLowerBranch  = "lower_branch"
	RoleHigherBranch = "higher_branch"
)

// SAT blueprint section keys (see exam_provider/sat.rs).
const (
	SectionReadingWriting = "reading-writing"
	SectionMath           = "math"
)

// Workbook import states (migration 0040).
const (
	ImportPreviewed = "previewed"
	ImportCommitted = "committed"
	ImportUndone    = "undone"
	ImportExpired   = "expired"
)

// Service wires authoring transitions explicitly.
type Service struct {
	db     *sql.DB
	runner *tx.Runner
	// deliverySvc builds Preview's candidate-facing projection. Nil keeps the
	// historical posture (derived per call from db/runner); production injects
	// the shared graph service so Preview never mints a bare per-request
	// service without the cache.
	deliverySvc *delivery.Service
	// previewCache is the revision-keyed delivery-tree cache Preview serves
	// through (the shared delivery VersionCache; key is (versionID, revision)).
	// Nil disables caching: Preview bulk-loads directly. No globals: tests
	// inject a fresh cache or leave it nil.
	previewCache *delivery.VersionCache
	// liveOrigin is this instance's bus origin id (mirrors delivery.Service).
	// Empty = no bus (tests, or a nil deps.LiveBus): eventsOn() stays false.
	liveOrigin string
	// eventsEnabled is the AUTHORING_REALTIME_EVENTS gate (Phase 02). Off by
	// default: byte-identical legacy behavior with no bus INSERT.
	eventsEnabled bool
	// coeditEnabled gates the prompt co-editing guard (coedit.go): the guard
	// refuses a prompt write through a room when it is off. It is wired once at
	// startup from cfg.AuthoringRealtimeCoediting (cmd/api/main.go), which the
	// application build defaults to on.
	coeditEnabled bool
}

// NewService wires dependencies explicitly.
func NewService(db *sql.DB, runner *tx.Runner) *Service {
	return &Service{db: db, runner: runner}
}

// SetDeliveryService injects the shared delivery service Preview builds its
// projection with (chainable, nil-safe: nil restores the derived default).
// A setter — not a constructor change — so the existing NewService call sites
// (app graph plus in-package tests) stay untouched.
func (s *Service) SetDeliveryService(d *delivery.Service) *Service {
	if s != nil {
		s.deliverySvc = d
	}
	return s
}

// SetPreviewCache wires the revision-keyed delivery-tree cache Preview serves
// through (chainable, nil-safe: nil disables caching and Preview bulk-loads
// directly, which is also the VERSION_CACHE=off kill-switch posture).
func (s *Service) SetPreviewCache(c *delivery.VersionCache) *Service {
	if s != nil {
		s.previewCache = c
	}
	return s
}

// PreviewCached reports whether Preview serves through the revision-keyed
// cache (assertable without a pool).
func (s *Service) PreviewCached() bool { return s != nil && s.previewCache != nil }

// previewDelivery returns the injected delivery service, deriving one from
// (db, runner) when none was injected (tests, worker, cache-off).
func (s *Service) previewDelivery() *delivery.Service {
	if s != nil && s.deliverySvc != nil {
		return s.deliverySvc
	}
	var db *sql.DB
	var runner *tx.Runner
	if s != nil {
		db, runner = s.db, s.runner
	}
	return delivery.NewService(db, runner)
}

func nonEmptyJSON(b json.RawMessage) json.RawMessage {
	if len(b) == 0 || strings.TrimSpace(string(b)) == "" {
		return json.RawMessage("{}")
	}
	return b
}

func orDefault(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}

func sameSet(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	seen := map[string]int{}
	for _, v := range a {
		seen[v]++
	}
	for _, v := range b {
		seen[v]--
		if seen[v] < 0 {
			return false
		}
	}
	return true
}

func rawScanner(dst *json.RawMessage) sql.Scanner {
	return &rawScan{dst: dst}
}

type rawScan struct {
	dst *json.RawMessage
}

func (r *rawScan) Scan(src any) error {
	switch v := src.(type) {
	case nil:
		*r.dst = json.RawMessage("{}")
	case string:
		if strings.TrimSpace(v) == "" {
			*r.dst = json.RawMessage("{}")
		} else {
			*r.dst = json.RawMessage(v)
		}
	case []byte:
		if len(v) == 0 {
			*r.dst = json.RawMessage("{}")
		} else {
			*r.dst = append(json.RawMessage(nil), v...)
		}
	default:
		*r.dst = json.RawMessage("{}")
	}
	return nil
}

func isMissingTable(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "doesn't exist") || strings.Contains(s, "table") && strings.Contains(s, "not exist") || strings.Contains(s, "no such table")
}
