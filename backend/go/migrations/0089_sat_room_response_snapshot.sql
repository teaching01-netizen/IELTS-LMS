-- Exact same-key response replay, including after room edits/deletion.
-- Legacy receipts remain NULL: original response fields cannot be recovered.
SET @sat_room_response_exists := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'sat_room_operations'
      AND column_name = 'response_snapshot'
);
SET @sat_room_response_sql := IF(@sat_room_response_exists = 0,
    'ALTER TABLE sat_room_operations ADD COLUMN response_snapshot JSON NULL',
    'SELECT 1');
PREPARE sat_room_response_stmt FROM @sat_room_response_sql;
EXECUTE sat_room_response_stmt;
DEALLOCATE PREPARE sat_room_response_stmt;
