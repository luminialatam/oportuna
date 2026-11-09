USE oportuna;

ALTER TABLE sync_runs
  ADD COLUMN job_id BIGINT UNSIGNED NULL AFTER id,
  ADD COLUMN source ENUM('manual','historical','daily','active_refresh') NOT NULL DEFAULT 'manual' AFTER estado,
  ADD INDEX idx_sync_job (job_id),
  ADD INDEX idx_sync_source_date (source, fecha_consultada);

CREATE TABLE sync_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tipo ENUM('historica','diaria') NOT NULL,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  estado ENUM('queued','running','paused','completed','completed_with_errors','failed') NOT NULL DEFAULT 'queued',
  active_refresh_status ENUM('not_required','pending','completed','failed') NOT NULL DEFAULT 'not_required',
  total_dias INT UNSIGNED NOT NULL DEFAULT 0,
  dias_completados INT UNSIGNED NOT NULL DEFAULT 0,
  dias_fallidos INT UNSIGNED NOT NULL DEFAULT 0,
  total_recibidos INT UNSIGNED NOT NULL DEFAULT 0,
  total_insertados INT UNSIGNED NOT NULL DEFAULT 0,
  total_actualizados INT UNSIGNED NOT NULL DEFAULT 0,
  mensaje_error TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME NULL,
  paused_at DATETIME NULL,
  finished_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_sync_jobs_estado (estado, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sync_job_days (
  job_id BIGINT UNSIGNED NOT NULL,
  fecha DATE NOT NULL,
  estado ENUM('pending','in_progress','completed','failed') NOT NULL DEFAULT 'pending',
  intentos INT UNSIGNED NOT NULL DEFAULT 0,
  total_recibidos INT UNSIGNED NOT NULL DEFAULT 0,
  total_insertados INT UNSIGNED NOT NULL DEFAULT 0,
  total_actualizados INT UNSIGNED NOT NULL DEFAULT 0,
  mensaje_error TEXT NULL,
  started_at DATETIME NULL,
  finished_at DATETIME NULL,
  last_successful_at DATETIME NULL,
  PRIMARY KEY (job_id, fecha),
  INDEX idx_sync_job_days_estado (job_id, estado, fecha),
  CONSTRAINT fk_sync_job_days_job FOREIGN KEY (job_id) REFERENCES sync_jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
