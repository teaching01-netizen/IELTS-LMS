package satscoring

// Real-MySQL coverage for the global score-conversion policy. Each test gets a
// scratch schema built from migration 0087 itself (so the triggers and CHECKs
// under test are the shipped ones) plus the one result table the impact report
// reads. Without TEST_MYSQL_DSN the tests skip.

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/satconvert"
)

func scratchService(t *testing.T) (*Service, *sql.DB) {
	t.Helper()
	raw := os.Getenv("TEST_MYSQL_DSN")
	if raw == "" {
		t.Skip("TEST_MYSQL_DSN not set; requires isolated MySQL")
	}
	cfg, err := mysql.ParseDSN(raw)
	if err != nil {
		t.Fatalf("parse TEST_MYSQL_DSN: %v", err)
	}
	cfg.ParseTime, cfg.MultiStatements, cfg.Loc = true, true, time.UTC
	root, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	if err := root.Ping(); err != nil {
		t.Skipf("TEST_MYSQL_DSN unreachable: %v", err)
	}
	name := fmt.Sprintf("satscoring_%d", time.Now().UnixNano())
	if _, err := root.Exec("CREATE DATABASE `" + name + "`"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = root.Exec("DROP DATABASE IF EXISTS `" + name + "`") })
	cfg.DBName = name
	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	db.SetMaxOpenConns(16)
	migration, err := os.ReadFile(filepath.Join("..", "..", "migrations", "0087_sat_score_conversion.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(migration)); err != nil {
		t.Fatalf("apply 0087: %v", err)
	}
	if _, err := db.Exec("CREATE TABLE assessment_results (id VARCHAR(36) PRIMARY KEY, provider_key VARCHAR(32) NOT NULL, release_status VARCHAR(32) NOT NULL, score_payload JSON NOT NULL)"); err != nil {
		t.Fatal(err)
	}
	ResetCacheForTest()
	t.Cleanup(ResetCacheForTest)
	return NewService(db, tx.NewRunner(db)), db
}

// matrix builds a (m1+1)x(m2+1) matrix whose cell is base + 10*(r+c) (capped).
func matrix(m1, m2, base int) *satconvert.PolicyTable {
	cells := make([][]*int, m1+1)
	for r := range cells {
		cells[r] = make([]*int, m2+1)
		for c := range cells[r] {
			v := min(base+10*(r+c), 800)
			cells[r][c] = &v
		}
	}
	return &satconvert.PolicyTable{Kind: satconvert.KindMatrix, M1Operational: m1, M2Operational: m2, Cells: cells}
}

// policy gives both subjects a shared full-route matrix; rwBase/mathBase make
// the two subjects distinguishable.
func policy(rwBase, mathBase int) *satconvert.Content {
	c := satconvert.EmptyContent()
	for section, base := range map[string]int{satconvert.SectionReadingWriting: rwBase, satconvert.SectionMath: mathBase} {
		c.Sections[section].Tables["t"] = matrix(3, 3, base)
		c.Sections[section].Assign["full_lower"] = []string{"t"}
		c.Sections[section].Assign["full_higher"] = []string{"t"}
	}
	return c
}

func raw(t *testing.T, c *satconvert.Content) json.RawMessage {
	t.Helper()
	b, err := c.Canonical()
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func publishPolicy(t *testing.T, s *Service, c *satconvert.Content, calibration string) *Revision {
	t.Helper()
	ctx := context.Background()
	d, err := s.CreateDraft(ctx, "admin-1", "req-1", nil)
	if err != nil {
		t.Fatal(err)
	}
	d, err = s.SaveDraft(ctx, "admin-1", "req-2", d.ID, d.Version, raw(t, c), calibration, "")
	if err != nil {
		t.Fatal(err)
	}
	res, err := s.Publish(ctx, "admin-1", "req-3", d.ID)
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	return res.Revision
}

func code(err error) apperrors.Code {
	if e, ok := apperrors.As(err); ok {
		return e.Code
	}
	return ""
}

func TestDraftOptimisticLockAndPartialSave(t *testing.T) {
	s, _ := scratchService(t)
	ctx := context.Background()
	d, err := s.CreateDraft(ctx, "a", "r", nil)
	if err != nil || d.Version != 1 || d.Status != StatusDraft || d.BaseRevisionID != nil {
		t.Fatalf("draft = %+v %v", d, err)
	}
	// An incomplete draft (null cell) saves.
	c := policy(200, 300)
	c.Sections[satconvert.SectionMath].Tables["t"].Cells[1][1] = nil
	saved, err := s.SaveDraft(ctx, "a", "r", d.ID, 1, raw(t, c), "src", "note")
	if err != nil || saved.Version != 2 {
		t.Fatalf("save = %+v %v", saved, err)
	}
	// A stale writer gets 412 and changes nothing.
	_, err = s.SaveDraft(ctx, "b", "r", d.ID, 1, raw(t, policy(500, 500)), "other", "")
	if code(err) != CodePreconditionFailed {
		t.Fatalf("stale save err = %v", err)
	}
	got, _ := s.GetRevision(ctx, d.ID)
	if got.CalibrationSource != "src" || got.Version != 2 {
		t.Fatalf("stale save modified the draft: %+v", got)
	}
	// Malformed structure is refused (422), not stored.
	if _, err := s.SaveDraft(ctx, "a", "r", d.ID, 2, json.RawMessage(`{"schemaVersion":9}`), "", ""); code(err) != apperrors.CodeValidation {
		t.Fatalf("malformed err = %v", err)
	}
	if _, err := s.SaveDraft(ctx, "a", "r", uuid.NewString(), 1, raw(t, c), "", ""); code(err) != apperrors.CodeNotFound {
		t.Fatalf("missing draft err = %v", err)
	}
}

func TestPublishRequiresCompleteContentAndCalibration(t *testing.T) {
	s, _ := scratchService(t)
	ctx := context.Background()
	d, _ := s.CreateDraft(ctx, "a", "r", nil)
	c := policy(200, 200)
	c.Sections[satconvert.SectionMath].Tables["t"].Cells[1][1] = nil
	d, _ = s.SaveDraft(ctx, "a", "r", d.ID, d.Version, raw(t, c), "src", "")
	_, err := s.Publish(ctx, "a", "r", d.ID)
	app, ok := apperrors.As(err)
	if !ok || app.Code != apperrors.CodeValidation || app.HTTPStatus != 422 {
		t.Fatalf("publish err = %v", err)
	}
	issues, _ := app.Details["errors"].([]satconvert.Issue)
	if len(issues) != 1 || issues[0].Path != "sections.math.tables.t.cells[1][1]" {
		t.Fatalf("details = %+v", app.Details)
	}
	// Complete content without a calibration source is also refused.
	d, _ = s.SaveDraft(ctx, "a", "r", d.ID, d.Version, raw(t, policy(200, 200)), " ", "")
	if _, err := s.Publish(ctx, "a", "r", d.ID); code(err) != apperrors.CodeValidation {
		t.Fatalf("no calibration err = %v", err)
	}
	if active, _ := s.ActiveRevision(ctx, s.db); active != nil {
		t.Fatal("a refused publish activated something")
	}
}

func TestPublishIdempotentMonotonicAndRestore(t *testing.T) {
	s, _ := scratchService(t)
	ctx := context.Background()
	v1 := publishPolicy(t, s, policy(200, 300), "College Board practice test")
	if v1.RevisionNumber == nil || *v1.RevisionNumber != 1 || !v1.Active || v1.ContentSHA256 == nil {
		t.Fatalf("v1 = %+v", v1)
	}
	// A retried publish (lost response) returns the same outcome, no new row.
	again, err := s.Publish(ctx, "admin-1", "retry", v1.ID)
	if err != nil || !again.AlreadyActive || *again.Revision.RevisionNumber != 1 {
		t.Fatalf("retry = %+v %v", again, err)
	}
	var count int
	_ = s.db.QueryRow("SELECT COUNT(*) FROM sat_score_conversion_audit WHERE action = 'published'").Scan(&count)
	if count != 1 {
		t.Fatalf("published audit rows = %d, want 1", count)
	}

	// v2 from the active revision, changing Math only.
	d, err := s.CreateDraft(ctx, "admin-1", "r", nil)
	if err != nil || d.BaseRevisionID == nil || *d.BaseRevisionID != v1.ID {
		t.Fatalf("draft = %+v %v", d, err)
	}
	c2 := policy(200, 400)
	d, _ = s.SaveDraft(ctx, "admin-1", "r", d.ID, d.Version, raw(t, c2), "src2", "")
	res, err := s.Publish(ctx, "admin-1", "r", d.ID)
	if err != nil || *res.Revision.RevisionNumber != 2 {
		t.Fatalf("v2 = %+v %v", res, err)
	}
	// The superseded revision cannot be re-published as-is.
	if _, err := s.Publish(ctx, "admin-1", "r", v1.ID); code(err) != CodeSuperseded {
		t.Fatalf("superseded publish err = %v", err)
	}

	// Restore v1 as a new draft and activate it: numbering keeps increasing and
	// the content (hence every converted score) is v1's again.
	d, err = s.CreateDraft(ctx, "admin-1", "r", &v1.ID)
	if err != nil || d.RestoredFromID == nil || *d.RestoredFromID != v1.ID {
		t.Fatalf("restore draft = %+v %v", d, err)
	}
	res, err = s.Publish(ctx, "admin-1", "r", d.ID)
	if err != nil || *res.Revision.RevisionNumber != 3 {
		t.Fatalf("v3 = %+v %v", res, err)
	}
	if *res.Revision.ContentSHA256 != *v1.ContentSHA256 {
		t.Fatal("restored content differs from v1")
	}
	active, _ := s.ActiveRevision(ctx, s.db)
	if active == nil || active.ID != res.Revision.ID {
		t.Fatalf("active = %+v", active)
	}
	list, _ := s.ListRevisions(ctx)
	if len(list) != 3 || *list[0].RevisionNumber != 3 || !list[0].Active || list[0].Content != nil {
		t.Fatalf("list = %+v", list)
	}
}

func TestPublishingOneSubjectKeepsTheOtherUnchanged(t *testing.T) {
	s, _ := scratchService(t)
	ctx := context.Background()
	v1 := publishPolicy(t, s, policy(200, 300), "src")
	d, _ := s.CreateDraft(ctx, "a", "r", nil)
	edited := clone(t, d.Content)
	edited.Sections[satconvert.SectionReadingWriting].Tables["t"].Cells[2][2] = new(790)
	d, _ = s.SaveDraft(ctx, "a", "r", d.ID, d.Version, raw(t, edited), "src", "")
	res, err := s.Publish(ctx, "a", "r", d.ID)
	if err != nil {
		t.Fatal(err)
	}
	mathBefore, _ := v1.Content.SectionChecksum(satconvert.SectionMath)
	mathAfter, _ := res.Revision.Content.SectionChecksum(satconvert.SectionMath)
	rwBefore, _ := v1.Content.SectionChecksum(satconvert.SectionReadingWriting)
	rwAfter, _ := res.Revision.Content.SectionChecksum(satconvert.SectionReadingWriting)
	if mathBefore != mathAfter || rwBefore == rwAfter {
		t.Fatalf("section checksums: math %v rw %v", mathBefore == mathAfter, rwBefore != rwAfter)
	}
}

// clone deep-copies a policy through its canonical encoding.
func clone(t *testing.T, c *satconvert.Content) *satconvert.Content {
	t.Helper()
	out, err := c.Clone()
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestConcurrentPublishOnSameBaseOneWins(t *testing.T) {
	s, _ := scratchService(t)
	ctx := context.Background()
	base := publishPolicy(t, s, policy(200, 200), "src")
	const n = 6
	ids := make([]string, n)
	for i := range ids {
		d, err := s.CreateDraft(ctx, fmt.Sprintf("admin-%d", i), "r", nil)
		if err != nil || *d.BaseRevisionID != base.ID {
			t.Fatalf("draft %d = %+v %v", i, d, err)
		}
		c := policy(200+10*(i+1), 200)
		d, err = s.SaveDraft(ctx, "a", "r", d.ID, d.Version, raw(t, c), "src", "")
		if err != nil {
			t.Fatal(err)
		}
		ids[i] = d.ID
	}
	var (
		wg      sync.WaitGroup
		start   = make(chan struct{})
		mu      sync.Mutex
		winners []string
		stale   int
	)
	for i, id := range ids {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			res, err := s.Publish(ctx, fmt.Sprintf("admin-%d", i), "r", id)
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				winners = append(winners, res.Revision.ID)
			case code(err) == CodeStaleBase:
				stale++
			default:
				t.Errorf("publish %d: %v", i, err)
			}
		}()
	}
	close(start)
	wg.Wait()
	if len(winners) != 1 || stale != n-1 {
		t.Fatalf("winners=%v stale=%d, want exactly one winner and %d STALE_BASE", winners, stale, n-1)
	}
	active, _ := s.ActiveRevision(ctx, s.db)
	if active.ID != winners[0] || *active.RevisionNumber != 2 {
		t.Fatalf("active = %+v, winner %s", active, winners[0])
	}
	var published int
	_ = s.db.QueryRow("SELECT COUNT(*) FROM sat_score_conversion_revisions WHERE status = 'published'").Scan(&published)
	if published != 2 {
		t.Fatalf("published rows = %d, want 2", published)
	}
}

func TestPublishedRevisionIsImmutableAndAuditAppendOnly(t *testing.T) {
	s, db := scratchService(t)
	v1 := publishPolicy(t, s, policy(200, 200), "src")
	for _, stmt := range []string{
		"UPDATE sat_score_conversion_revisions SET note = 'x' WHERE id = '" + v1.ID + "'",
		"UPDATE sat_score_conversion_revisions SET content = '{}' WHERE id = '" + v1.ID + "'",
		"DELETE FROM sat_score_conversion_revisions WHERE id = '" + v1.ID + "'",
		"UPDATE sat_score_conversion_audit SET actor_id = 'x'",
		"DELETE FROM sat_score_conversion_audit",
	} {
		if _, err := db.Exec(stmt); err == nil {
			t.Errorf("statement succeeded, want it refused: %s", stmt)
		}
	}
	// The application's own guard: a published row is not a draft.
	if _, err := s.SaveDraft(context.Background(), "a", "r", v1.ID, 2, raw(t, policy(300, 300)), "", ""); code(err) != CodeNotDraft {
		t.Fatalf("save on published err = %v", err)
	}
}

func TestCorruptedRevisionFailsClosedAndOverlayDegradesToRaw(t *testing.T) {
	s, db := scratchService(t)
	ctx := context.Background()
	v1 := publishPolicy(t, s, policy(200, 200), "src")
	ResetCacheForTest()
	// Bypass the trigger the way a restore-from-backup or a TiDB deployment could.
	if _, err := db.Exec("DROP TRIGGER sat_score_conversion_revisions_immutable_update"); err != nil {
		t.Fatal(err)
	}
	tampered := policy(200, 200)
	tampered.Sections[satconvert.SectionMath].Tables["t"].Cells[0][0] = new(800)
	if _, err := db.Exec("UPDATE sat_score_conversion_revisions SET content = ? WHERE id = ?", string(raw(t, tampered)), v1.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ActiveRevision(ctx, db); !errors.Is(err, ErrIntegrity) {
		t.Fatalf("ActiveRevision err = %v, want ErrIntegrity", err)
	}
	payload := releasedPayload(t, `[
	  {"sectionKey":"math","rawCorrect":2,"total":6,"scaled":{"low":999,"high":999},"conversionStatus":"converted","modules":[
	    {"moduleKey":"math-m1","rawCorrect":1,"total":3},{"moduleKey":"math-m2-higher","rawCorrect":1,"total":3}]}]`)
	Overlay(ctx, db, payload)
	section := firstSection(payload)
	if _, has := section["scaled"]; has || section["conversionStatus"] != nil {
		t.Fatalf("a corrupted policy must not leave a score behind: %+v", section)
	}
	if section["rawCorrect"] != float64(2) {
		t.Fatalf("raw score must survive: %+v", section)
	}
}

func releasedPayload(t *testing.T, sectionsJSON string) map[string]any {
	t.Helper()
	var payload map[string]any
	doc := `{"classroomRaw":{"rawCorrect":0,"total":0,"sections":` + sectionsJSON + `},"snapshot":{"answers":{}}}`
	if err := json.Unmarshal([]byte(doc), &payload); err != nil {
		t.Fatal(err)
	}
	return payload
}

func firstSection(payload map[string]any) map[string]any {
	return payload["classroomRaw"].(map[string]any)["sections"].([]any)[0].(map[string]any)
}

func section(payload map[string]any, key string) map[string]any {
	for _, s := range payload["classroomRaw"].(map[string]any)["sections"].([]any) {
		if m := s.(map[string]any); m["sectionKey"] == key {
			return m
		}
	}
	return nil
}

const twoSectionPayload = `[
  {"sectionKey":"reading-writing","rawCorrect":5,"total":6,"modules":[
    {"moduleKey":"rw-m1","rawCorrect":2,"total":3},{"moduleKey":"rw-m2-higher","rawCorrect":3,"total":3}]},
  {"sectionKey":"math","rawCorrect":3,"total":6,"modules":[
    {"moduleKey":"math-m1","rawCorrect":1,"total":3},{"moduleKey":"math-m2-lower","rawCorrect":2,"total":3}]}]`

func TestOverlayAppliesActivePolicyRetroactivelyAndFailsClosed(t *testing.T) {
	s, db := scratchService(t)
	ctx := context.Background()

	// No active revision: legacy stored conversion stays exactly as it was.
	legacy := releasedPayload(t, `[{"sectionKey":"math","rawCorrect":3,"total":6,"scaled":{"low":555,"high":555},"conversionStatus":"converted","topology":"full_lower","modules":[
	  {"moduleKey":"math-m1","rawCorrect":1,"total":3},{"moduleKey":"math-m2-lower","rawCorrect":2,"total":3}]}]`)
	before, _ := json.Marshal(legacy)
	Overlay(ctx, db, legacy)
	if after, _ := json.Marshal(legacy); string(after) != string(before) {
		t.Fatalf("overlay changed a payload while no policy is active:\n%s\n%s", before, after)
	}

	// First publish: the already-released payload now shows the new policy.
	// R&W (2,3) -> 200+10*(2+3)=250 ; Math (1,2) -> 300+30=330 ; total 580.
	publishPolicy(t, s, policy(200, 300), "src")
	payload := releasedPayload(t, twoSectionPayload)
	Overlay(ctx, db, payload)
	rw, math := section(payload, "reading-writing"), section(payload, "math")
	if rw["conversionStatus"] != "converted" || rw["topology"] != "full_higher" || rw["scaled"] != (satconvert.Score{Low: 250, High: 250}) {
		t.Fatalf("rw = %+v", rw)
	}
	if math["topology"] != "full_lower" || math["scaled"] != (satconvert.Score{Low: 330, High: 330}) {
		t.Fatalf("math = %+v", math)
	}
	rawObj := payload["classroomRaw"].(map[string]any)
	if rawObj["totalScaled"] != (satconvert.Score{Low: 580, High: 580}) {
		t.Fatalf("total = %+v", rawObj["totalScaled"])
	}
	if conv := rawObj["conversion"].(map[string]any); conv["converterVersion"] != "sat-global-v1" || conv["scoreType"] != "estimated_sat" || conv["calibrationSource"] != "src" {
		t.Fatalf("conversion = %+v", conv)
	}
	// Legacy stored values are replaced, not merged: the earlier 555 is gone.
	Overlay(ctx, db, legacy)
	if got := firstSection(legacy)["scaled"]; got != (satconvert.Score{Low: 330, High: 330}) {
		t.Fatalf("legacy payload after activation = %+v", got)
	}

	// A second publish moves the same payload again (no stale per-result score).
	d, _ := s.CreateDraft(ctx, "a", "r", nil)
	changed := clone(t, d.Content)
	changed.Sections[satconvert.SectionMath].Tables["t"].Cells[1][2] = new(790)
	d, _ = s.SaveDraft(ctx, "a", "r", d.ID, d.Version, raw(t, changed), "src2", "")
	if _, err := s.Publish(ctx, "a", "r", d.ID); err != nil {
		t.Fatal(err)
	}
	again := releasedPayload(t, twoSectionPayload)
	Overlay(ctx, db, again)
	if got := section(again, "math")["scaled"]; got != (satconvert.Score{Low: 790, High: 790}) {
		t.Fatalf("math after v2 = %+v", got)
	}
	if section(again, "reading-writing")["scaled"] != (satconvert.Score{Low: 250, High: 250}) {
		t.Fatal("publishing Math changed Reading & Writing")
	}
}

func TestOverlayNeverInventsAScore(t *testing.T) {
	s, db := scratchService(t)
	ctx := context.Background()
	c := policy(200, 200)
	// Math also has a standalone Module 2 table (lower route only).
	c.Sections[satconvert.SectionMath].Tables["s"] = &satconvert.PolicyTable{Kind: satconvert.KindModule2, Operational: 3, Scores: []*satconvert.ScoreCell{{Low: 200, High: 200}, {Low: 300, High: 300}, {Low: 400, High: 450}, {Low: 500, High: 500}}}
	c.Sections[satconvert.SectionMath].Assign["m2_lower_only"] = []string{"s"}
	publishPolicy(t, s, c, "src")

	cases := map[string]struct {
		sections string
		status   string
		total    bool
	}{
		"operational counts differ from the table": {`[{"sectionKey":"math","rawCorrect":4,"total":10,"modules":[{"moduleKey":"math-m1","rawCorrect":2,"total":5},{"moduleKey":"math-m2-higher","rawCorrect":2,"total":5}]}]`, "unavailable", false},
		"module one only":                          {`[{"sectionKey":"math","rawCorrect":2,"total":3,"modules":[{"moduleKey":"math-m1","rawCorrect":2,"total":3}]}]`, "unavailable", false},
		"both branches":                            {`[{"sectionKey":"math","rawCorrect":2,"total":6,"modules":[{"moduleKey":"math-m2-lower","rawCorrect":1,"total":3},{"moduleKey":"math-m2-higher","rawCorrect":1,"total":3}]}]`, "unavailable", false},
		"unknown module key":                       {`[{"sectionKey":"math","rawCorrect":2,"total":6,"modules":[{"moduleKey":"math-mystery","rawCorrect":1,"total":3},{"moduleKey":"math-m2-higher","rawCorrect":1,"total":3}]}]`, "unavailable", false},
		"standalone lower uses its own table":      {`[{"sectionKey":"math","rawCorrect":2,"total":3,"modules":[{"moduleKey":"math-m2-lower","rawCorrect":2,"total":3}]}]`, "converted", false},
		"standalone higher has no table":           {`[{"sectionKey":"math","rawCorrect":2,"total":3,"modules":[{"moduleKey":"math-m2-higher","rawCorrect":2,"total":3}]}]`, "unavailable", false},
		"modules missing from the payload":         {`[{"sectionKey":"math","rawCorrect":2,"total":3}]`, "unavailable", false},
		"fractional raw score":                     {`[{"sectionKey":"math","rawCorrect":2,"total":6,"modules":[{"moduleKey":"math-m1","rawCorrect":1.5,"total":3},{"moduleKey":"math-m2-higher","rawCorrect":1,"total":3}]}]`, "unavailable", false},
		"negative raw score":                       {`[{"sectionKey":"math","rawCorrect":0,"total":6,"modules":[{"moduleKey":"math-m1","rawCorrect":-1,"total":3},{"moduleKey":"math-m2-higher","rawCorrect":1,"total":3}]}]`, "unavailable", false},
		"raw score above the operational count":    {`[{"sectionKey":"math","rawCorrect":5,"total":6,"modules":[{"moduleKey":"math-m1","rawCorrect":4,"total":3},{"moduleKey":"math-m2-higher","rawCorrect":1,"total":3}]}]`, "unavailable", false},
		"subject without a policy":                 {`[{"sectionKey":"science","rawCorrect":2,"total":3,"modules":[{"moduleKey":"sci-m1","rawCorrect":2,"total":3}]}]`, "unavailable", false},
	}
	for name, tc := range cases {
		payload := releasedPayload(t, tc.sections)
		Overlay(ctx, db, payload)
		got := firstSection(payload)
		if got["conversionStatus"] != tc.status {
			t.Errorf("%s: status = %v, want %s (%+v)", name, got["conversionStatus"], tc.status, got)
		}
		if tc.status == "unavailable" && got["scaled"] != nil {
			t.Errorf("%s: invented a score %+v", name, got["scaled"])
		}
		if _, has := payload["classroomRaw"].(map[string]any)["totalScaled"]; has != tc.total {
			t.Errorf("%s: totalScaled present = %v, want %v", name, has, tc.total)
		}
	}
	// A range from a standalone table is preserved.
	payload := releasedPayload(t, `[{"sectionKey":"math","rawCorrect":2,"total":3,"modules":[{"moduleKey":"math-m2-lower","rawCorrect":2,"total":3}]}]`)
	Overlay(ctx, db, payload)
	if firstSection(payload)["scaled"] != (satconvert.Score{Low: 400, High: 450}) {
		t.Fatalf("standalone range = %+v", firstSection(payload)["scaled"])
	}
}

func TestOverlayLeavesWithheldResultsAlone(t *testing.T) {
	s, db := scratchService(t)
	publishPolicy(t, s, policy(200, 200), "src")
	// Pending / invalidated / practice results carry no classroomRaw: nothing is
	// added, so a withheld result can never gain a score from a policy change.
	for _, doc := range []string{`{"outcomeStatus":"pending","snapshot":{}}`, `{}`, `{"classroomRaw":null}`} {
		var payload map[string]any
		_ = json.Unmarshal([]byte(doc), &payload)
		want, _ := json.Marshal(payload)
		Overlay(context.Background(), db, payload)
		if got, _ := json.Marshal(payload); string(got) != string(want) {
			t.Errorf("payload %s changed to %s", want, got)
		}
	}
	Overlay(context.Background(), db, nil) // must not panic
}

func insertResult(t *testing.T, db *sql.DB, release, sections string) {
	t.Helper()
	doc := `{"classroomRaw":{"sections":` + sections + `}}`
	if _, err := db.Exec("INSERT INTO assessment_results (id, provider_key, release_status, score_payload) VALUES (?, 'sat', ?, ?)", uuid.NewString(), release, doc); err != nil {
		t.Fatal(err)
	}
}

func TestImpactReportIsBoundedAndMatchesTheOverlay(t *testing.T) {
	s, db := scratchService(t)
	ctx := context.Background()
	publishPolicy(t, s, policy(200, 300), "src") // active v1

	mathRow := func(m1, m2 int) string {
		return fmt.Sprintf(`[{"sectionKey":"math","rawCorrect":%d,"total":6,"modules":[{"moduleKey":"math-m1","rawCorrect":%d,"total":3},{"moduleKey":"math-m2-lower","rawCorrect":%d,"total":3}]}]`, m1+m2, m1, m2)
	}
	// 1500 identical releases (forces more than one keyset batch) plus others.
	for range 1500 {
		insertResult(t, db, "released", mathRow(1, 2))
	}
	for range 7 {
		insertResult(t, db, "released", mathRow(3, 3))
	}
	insertResult(t, db, "pending", mathRow(0, 0)) // withheld: not counted
	// A JSON-null report and an empty report are not results to compare.
	if _, err := db.Exec("INSERT INTO assessment_results (id, provider_key, release_status, score_payload) VALUES (?, 'sat', 'released', '{\"classroomRaw\":{\"sections\":null}}'), (?, 'sat', 'released', '{\"classroomRaw\":{\"sections\":[]}}')", uuid.NewString(), uuid.NewString()); err != nil {
		t.Fatal(err)
	}
	insertResult(t, db, "released", `[{"sectionKey":"math","rawCorrect":9,"total":10,"modules":[{"moduleKey":"math-m1","rawCorrect":4,"total":5},{"moduleKey":"math-m2-lower","rawCorrect":5,"total":5}]}]`)

	d, _ := s.CreateDraft(ctx, "a", "r", nil)
	next := clone(t, d.Content)
	next.Sections[satconvert.SectionMath].Tables["t"].Cells[1][2] = new(700) // 330 -> 700
	d, _ = s.SaveDraft(ctx, "a", "r", d.ID, d.Version, raw(t, next), "src", "")

	report, err := s.Impact(ctx, d.ID)
	if err != nil {
		t.Fatal(err)
	}
	if report.ResultsConsidered != 1508 {
		t.Fatalf("considered = %d, want 1508", report.ResultsConsidered)
	}
	m := report.Sections["math"]
	if m.Considered != 1508 || m.Changed != 1500 || m.Unchanged != 8 || m.BecomesUnavailable != 0 || m.BecomesAvailable != 0 {
		t.Fatalf("math impact = %+v", m)
	}
	if m.MinDelta == nil || *m.MinDelta != 370 || *m.MaxDelta != 370 {
		t.Fatalf("delta = %v..%v, want 370", m.MinDelta, m.MaxDelta)
	}
	if len(report.TopChanges) != 1 || report.TopChanges[0].Count != 1500 || *report.TopChanges[0].M2 != 2 ||
		*report.TopChanges[0].OldScore != (satconvert.Score{Low: 330, High: 330}) || *report.TopChanges[0].NewScore != (satconvert.Score{Low: 700, High: 700}) {
		t.Fatalf("top changes = %+v", report.TopChanges)
	}
	if report.ActiveRevisionID == nil {
		t.Fatal("active revision not reported")
	}
	// INV-6: the report only reads.
	var released int
	_ = db.QueryRow("SELECT COUNT(*) FROM assessment_results WHERE score_payload LIKE '%scaled%'").Scan(&released)
	if released != 0 {
		t.Fatal("impact wrote conversion fields into results")
	}
}

func TestImpactWithNoActivePolicyComparesAgainstStoredScores(t *testing.T) {
	s, db := scratchService(t)
	ctx := context.Background()
	insertResult(t, db, "released", `[{"sectionKey":"math","rawCorrect":3,"total":6,"conversionStatus":"converted","scaled":{"low":555,"high":555},"modules":[{"moduleKey":"math-m1","rawCorrect":1,"total":3},{"moduleKey":"math-m2-lower","rawCorrect":2,"total":3}]}]`)
	d, _ := s.CreateDraft(ctx, "a", "r", nil)
	d, _ = s.SaveDraft(ctx, "a", "r", d.ID, d.Version, raw(t, policy(200, 300)), "src", "")
	report, err := s.Impact(ctx, d.ID)
	if err != nil {
		t.Fatal(err)
	}
	m := report.Sections["math"]
	if report.ActiveRevisionID != nil || m.Changed != 1 || *m.MinDelta != -225 { // 330 - 555
		t.Fatalf("report = %+v math = %+v", report, m)
	}
}

func TestLookupPreview(t *testing.T) {
	s, _ := scratchService(t)
	ctx := context.Background()
	v1 := publishPolicy(t, s, policy(200, 300), "src")
	m2 := 2
	got, err := s.Lookup(ctx, v1.ID, "math", satconvert.FullLower, 1, &m2, nil, nil)
	if err != nil || got.Status != "converted" || got.Scaled.Low != 330 {
		t.Fatalf("lookup = %+v %v", got, err)
	}
	bad := 7
	if got, _ := s.Lookup(ctx, v1.ID, "math", satconvert.FullLower, 1, &m2, &bad, nil); got.Status != "unavailable" || got.Scaled != nil {
		t.Fatalf("mismatched counts = %+v", got)
	}
	if got, _ := s.Lookup(ctx, v1.ID, "math", satconvert.M2HigherOnly, 0, &m2, nil, nil); got.Status != "unavailable" {
		t.Fatalf("unassigned route = %+v", got)
	}
	if _, err := s.Lookup(ctx, uuid.NewString(), "math", satconvert.FullLower, 1, &m2, nil, nil); code(err) != apperrors.CodeNotFound {
		t.Fatalf("missing revision err = %v", err)
	}
}

func TestMigrationIsRerunnable(t *testing.T) {
	_, db := scratchService(t)
	migration, err := os.ReadFile(filepath.Join("..", "..", "migrations", "0087_sat_score_conversion.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(migration)); err != nil {
		t.Fatalf("second apply: %v", err)
	}
	var rows int
	_ = db.QueryRow("SELECT COUNT(*) FROM sat_score_conversion_active").Scan(&rows)
	if rows != 1 {
		t.Fatalf("pointer rows = %d, want the singleton only", rows)
	}
	if _, err := db.Exec("INSERT INTO sat_score_conversion_active (id) VALUES (2)"); err == nil || !strings.Contains(err.Error(), "chk_sat_score_conversion_active_singleton") {
		t.Fatalf("second pointer row err = %v", err)
	}
}
