package main

// WS-10a: alert-parity pin — every metric referenced in
// backend/monitoring/prometheus-alert-rules.yml must be a series the
// backend actually emits (telemetry.Names()). This kills the drift class
// where a rule points at a series nothing emits (previously:
// student_answer_loss_risk_total, backend_submit_replay_incomplete_total,
// backend_post_submit_grace_rejected_total). No YAML dep: the file is
// scanned as text (gopkg.in/yaml is intentionally not vendored).
import (
	"os"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

const alertRulesPath = "../../../monitoring/prometheus-alert-rules.yml"

func TestAlertRulesReferenceEmittedSeriesOnly(t *testing.T) {
	raw, err := os.ReadFile(alertRulesPath)
	if err != nil {
		t.Fatalf("read alert rules: %v", err)
	}
	body := string(raw)
	names := telemetry.Names()
	nameSet := map[string]bool{}
	for _, n := range names {
		if n == "" {
			t.Fatalf("telemetry.Names() must not contain empty names")
		}
		if nameSet[n] {
			t.Fatalf("telemetry.Names() must not duplicate %q", n)
		}
		nameSet[n] = true
	}
	var exprs []string
	for _, line := range strings.Split(body, "\n") {
		trimmed := strings.TrimSpace(line)
		if !strings.HasPrefix(trimmed, "expr:") {
			continue
		}
		expr := strings.TrimSpace(strings.TrimPrefix(trimmed, "expr:"))
		if expr == "" {
			t.Fatalf("alert rule has an empty expr")
		}
		exprs = append(exprs, expr)
	}
	if len(exprs) == 0 {
		t.Fatalf("no alert exprs found in %s", alertRulesPath)
	}
	for _, expr := range exprs {
		found := false
		for _, n := range names {
			if strings.Contains(expr, n) {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("alert expr references no emitted series (add the counter/gauge first, then extend telemetry.Names()): %q", expr)
		}
	}
}

// The three phantom series that motivated WS-10a must never return.
func TestAlertRulesContainNoKnownPhantoms(t *testing.T) {
	raw, err := os.ReadFile(alertRulesPath)
	if err != nil {
		t.Fatalf("read alert rules: %v", err)
	}
	body := string(raw)
	for _, phantom := range []string{
		"student_answer_loss_risk_total",
		"backend_submit_replay_incomplete_total",
		"backend_post_submit_grace_rejected_total",
	} {
		if strings.Contains(body, phantom) {
			t.Errorf("alert rules reference never-emitted series %q", phantom)
		}
	}
}

// Label-value pins: name-only matching cannot catch the Readyz class of
// drift (expr names an emitted series but filters a label value nothing
// emits). Alerted series with constrained labels pin their allowed values
// here; the access-log holder test pins the production side.
func TestAlertRulesLabelValuesAreEmitted(t *testing.T) {
	raw, err := os.ReadFile(alertRulesPath)
	if err != nil {
		t.Fatalf("read alert rules: %v", err)
	}
	body := string(raw)
	// SATMixedScoringFallbackDetected deliberately has NO source filter:
	// it pages on legacy gaps AND zero-answer silence (both sources).
	// Narrowing it to one source would blind the other class.
	for _, pin := range []struct{ alert, series, label, value string }{
		{"ReadyzProbeFailing", telemetry.MHTTPRequestsTotal, "route", "GET /readyz"},
		{"SATLegacyScoringFallbackDetected", telemetry.MSATScoreSource, "source", telemetry.SATScoreLegacy},
		{"SATMixedScoringFallbackDetected", telemetry.MSATScoreFallbackRows, "", ""},
		{"SATFinalizationRejectedSpike", telemetry.MSATFinalizeTotal, "outcome", telemetry.FinalizeRejected},
	} {
		blocks := strings.Split(body, "- alert: "+pin.alert)
		if len(blocks) < 2 {
			t.Errorf("alert %q not found in rules file", pin.alert)
			continue
		}
		// The expr lives on the lines right after the alert name; the
		// next "- alert:" starts a new block — only scan this alert's.
		segment := blocks[1]
		if i := strings.Index(segment, "- alert:"); i >= 0 {
			segment = segment[:i]
		}
		if pin.label == "" {
			// Unfiltered alert: the series must appear bare (a source
			// filter here would blind one gap class — see above).
			// Two-sided: the series must be present AND must not be
			// followed by a label matcher (which would silently
			// narrow it to one class).
				idx := strings.Index(segment, pin.series)
			if idx < 0 {
				t.Errorf("alert %q must reference %s", pin.alert, pin.series)
				continue
			}
			rest := strings.TrimSpace(segment[idx+len(pin.series):])
			if strings.HasPrefix(rest, "{") {
				t.Errorf("alert %q must reference bare %s (no label filter — it pages on both legacy and zero classes)", pin.alert, pin.series)
			}
			continue
		}
		wantPlain := pin.series + "{" + pin.label + "=\"" + pin.value + "\""
		if !strings.Contains(segment, wantPlain) {
			t.Errorf("alert %q must filter %s{%s=%q}", pin.alert, pin.series, pin.label, pin.value)
		}
	}
}

// Every alert must carry a runbook_url annotation (exam-day operability).
func TestAlertRulesHaveRunbookURLs(t *testing.T) {
	raw, err := os.ReadFile(alertRulesPath)
	if err != nil {
		t.Fatalf("read alert rules: %v", err)
	}
	blocks := strings.Split(string(raw), "- alert:")
	if len(blocks) < 2 {
		t.Fatalf("no alerts found in %s", alertRulesPath)
	}
	for _, b := range blocks[1:] {
		name := b
		if i := strings.Index(name, "\n"); i >= 0 {
			name = strings.TrimSpace(name[:i])
		}
		if !strings.Contains(b, "runbook_url:") {
			t.Errorf("alert %q is missing a runbook_url annotation", name)
		}
	}
}
