USE oportuna;
ALTER TABLE sync_jobs ADD COLUMN pause_requested TINYINT(1) NOT NULL DEFAULT 0 AFTER active_refresh_status;
