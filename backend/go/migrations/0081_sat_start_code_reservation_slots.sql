-- 0081_sat_start_code_reservation_slots.sql
-- Replace the generation-wide start-code guard lock with a fixed, durable
-- inventory of independently claimable slots. Keep 0080's reservation ledger
-- and guard table for audit and rollback; the new writer uses the slot table.
--
-- The API must be drained while this migration/backfill runs. The staging table
-- fails closed if legacy pending + current-window failed reservations exceed
-- 200, or if one attempt has more than one live reservation.

CREATE TABLE IF NOT EXISTS sat_start_code_reservation_slots (
    schedule_id VARCHAR(36) NOT NULL,
    generation INT NOT NULL,
    slot_no SMALLINT UNSIGNED NOT NULL,
    state VARCHAR(16) NOT NULL DEFAULT 'free',
    reservation_id VARCHAR(36) NULL,
    attempt_id VARCHAR(36) NULL,
    window_start TIMESTAMP(6) NULL,
    lease_expires_at TIMESTAMP(6) NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (schedule_id, generation, slot_no),
    UNIQUE KEY uq_sat_start_code_slots_reservation (reservation_id),
    UNIQUE KEY uq_sat_start_code_slots_active_attempt (schedule_id, attempt_id),
    KEY idx_sat_start_code_slots_budget (schedule_id, generation, state, window_start),
    KEY idx_sat_start_code_slots_lease (schedule_id, generation, state, lease_expires_at),
    CONSTRAINT chk_sat_start_code_slots_generation CHECK (generation > 0),
    CONSTRAINT chk_sat_start_code_slots_number CHECK (slot_no BETWEEN 0 AND 199),
    CONSTRAINT chk_sat_start_code_slots_state CHECK (state IN ('free', 'pending', 'failed')),
    CONSTRAINT chk_sat_start_code_slots_fields CHECK (
        (state = 'free' AND reservation_id IS NULL AND attempt_id IS NULL AND window_start IS NULL AND lease_expires_at IS NULL)
        OR (state = 'pending' AND reservation_id IS NOT NULL AND attempt_id IS NOT NULL AND window_start IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR (state = 'failed' AND reservation_id IS NULL AND attempt_id IS NULL AND window_start IS NOT NULL AND lease_expires_at IS NULL)
    ),
    CONSTRAINT fk_sat_start_code_slots_schedule FOREIGN KEY (schedule_id) REFERENCES exam_schedules(id) ON DELETE CASCADE
);

-- A temporary staging table makes the legacy backfill deterministic and
-- bounded. Its CHECK and UNIQUE constraints reject dirty data before slots
-- become authoritative. DROP TEMPORARY is scoped to this migration session.
DROP TEMPORARY TABLE IF EXISTS sat_start_code_reservation_slot_backfill;
CREATE TEMPORARY TABLE sat_start_code_reservation_slot_backfill (
    schedule_id VARCHAR(36) NOT NULL,
    generation INT NOT NULL,
    slot_no SMALLINT UNSIGNED NOT NULL,
    reservation_id VARCHAR(36) NOT NULL,
    attempt_id VARCHAR(36) NULL,
    window_start TIMESTAMP(6) NOT NULL,
    lease_expires_at TIMESTAMP(6) NULL,
    state VARCHAR(16) NOT NULL,
    PRIMARY KEY (schedule_id, generation, slot_no),
    UNIQUE KEY uq_sat_start_code_slot_backfill_reservation (reservation_id),
    UNIQUE KEY uq_sat_start_code_slot_backfill_attempt (schedule_id, attempt_id),
    CONSTRAINT chk_sat_start_code_slot_backfill_number CHECK (slot_no BETWEEN 0 AND 199),
    CONSTRAINT chk_sat_start_code_slot_backfill_state CHECK (state IN ('pending', 'failed'))
) ENGINE=InnoDB;

-- Expired legacy reservations cannot still be active and the old implementation
-- could leave an expired reservation from a rotated generation beside a newer
-- one for the same attempt. Fail those leases conservatively before applying
-- the active-attempt uniqueness constraint.
UPDATE sat_start_code_reservations
SET state = 'failed', settled_at = UTC_TIMESTAMP(6)
WHERE state = 'pending' AND lease_expires_at <= UTC_TIMESTAMP(6);

INSERT INTO sat_start_code_reservation_slot_backfill
    (schedule_id, generation, slot_no, reservation_id, attempt_id, window_start, lease_expires_at, state)
SELECT schedule_id, generation,
       CAST(ROW_NUMBER() OVER (PARTITION BY schedule_id, generation ORDER BY created_at, id) - 1 AS UNSIGNED),
       id,
       CASE WHEN state = 'pending' THEN attempt_id ELSE NULL END,
       window_start,
       CASE WHEN state = 'pending' THEN lease_expires_at ELSE NULL END,
       state
FROM sat_start_code_reservations
WHERE state = 'pending'
   OR (state = 'failed' AND window_start = TIMESTAMP(
       DATE(UTC_TIMESTAMP(6)),
       MAKETIME(HOUR(UTC_TIMESTAMP(6)), MINUTE(UTC_TIMESTAMP(6)) - MOD(MINUTE(UTC_TIMESTAMP(6)), 10), 0)
   ));

-- Seed all current code generations and every generation with live or
-- current-window reservations, including pending work from a rotated code.
INSERT IGNORE INTO sat_start_code_reservation_slots (schedule_id, generation, slot_no, state)
WITH RECURSIVE slot_numbers (slot_no) AS (
    SELECT 0
    UNION ALL
    SELECT slot_no + 1 FROM slot_numbers WHERE slot_no < 199
), generations AS (
    SELECT schedule_id, generation FROM sat_session_start_codes
    UNION
    SELECT schedule_id, generation FROM sat_start_code_reservation_slot_backfill
)
SELECT generations.schedule_id, generations.generation, slot_numbers.slot_no, 'free'
FROM generations CROSS JOIN slot_numbers;

UPDATE sat_start_code_reservation_slots AS slots
JOIN sat_start_code_reservation_slot_backfill AS backfill
  ON backfill.schedule_id = slots.schedule_id
 AND backfill.generation = slots.generation
 AND backfill.slot_no = slots.slot_no
SET slots.state = backfill.state,
    slots.reservation_id = CASE WHEN backfill.state = 'pending' THEN backfill.reservation_id ELSE NULL END,
    slots.attempt_id = CASE WHEN backfill.state = 'pending' THEN backfill.attempt_id ELSE NULL END,
    slots.window_start = backfill.window_start,
    slots.lease_expires_at = CASE WHEN backfill.state = 'pending' THEN backfill.lease_expires_at ELSE NULL END;

DROP TEMPORARY TABLE IF EXISTS sat_start_code_reservation_slot_backfill;
