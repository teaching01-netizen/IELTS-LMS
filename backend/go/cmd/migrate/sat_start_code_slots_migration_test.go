package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSATStartCodeReservationSlotsMigrationIsAdditiveAndRetryable(t *testing.T) {
	path := filepath.Join(migDir(t), "0081_sat_start_code_reservation_slots.sql")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read slot migration: %v", err)
	}
	sqlText := strings.ToLower(string(raw))
	for _, contract := range []string{
		"create table if not exists sat_start_code_reservation_slots",
		"check (slot_no between 0 and 199)",
		"unique key uq_sat_start_code_slots_active_attempt (schedule_id, attempt_id)",
		"set state = 'failed', settled_at = utc_timestamp(6)",
		"row_number() over",
		"insert ignore into sat_start_code_reservation_slots",
		"update sat_start_code_reservation_slots",
	} {
		if !strings.Contains(sqlText, contract) {
			t.Errorf("slot migration is missing contract %q", contract)
		}
	}
	for _, statement := range splitStatements(string(raw)) {
		upper := strings.ToUpper(strings.TrimSpace(stripSQLComments(statement)))
		for _, forbidden := range []string{"DROP TABLE ", "DROP COLUMN ", "TRUNCATE ", "DELETE FROM "} {
			if strings.HasPrefix(upper, forbidden) {
				t.Errorf("slot migration contains non-additive statement %q", statement)
			}
		}
	}
}
