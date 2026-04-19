-- Add wcode support for exam registration
-- Note: wcode columns already added to schedule_registrations and student_attempts in 0005_scheduling_and_access.sql and 0006_delivery.sql
-- Note: wcode indexes already created in those migrations
-- Note: student_email already set to NOT NULL with default empty string in those migrations

-- Add wcode format constraint for schedule_registrations
ALTER TABLE schedule_registrations 
ADD CONSTRAINT schedule_registrations_wcode_format 
CHECK (wcode REGEXP '^W[0-9]{6}$' OR wcode = '');

-- Add unique constraint on wcode per schedule
ALTER TABLE schedule_registrations 
ADD CONSTRAINT schedule_registrations_wcode_unique 
UNIQUE (schedule_id, wcode);

-- Add wcode format constraint for student_attempts
ALTER TABLE student_attempts 
ADD CONSTRAINT student_attempts_wcode_format 
CHECK (wcode REGEXP '^W[0-9]{6}$' OR wcode = '');

-- Note: GRANT statements removed - using MySQL user management instead
