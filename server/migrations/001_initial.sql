CREATE DATABASE IF NOT EXISTS oportuna CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE oportuna;

CREATE TABLE IF NOT EXISTS licitaciones (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo_externo VARCHAR(100) NOT NULL UNIQUE,
  nombre VARCHAR(255) NULL,
  codigo_estado INT NULL,
  fecha_cierre DATETIME NULL,
  fecha_publicacion DATETIME NULL,
  organismo VARCHAR(510) NULL,
  monto_estimado DECIMAL(20,4) NULL,
  moneda VARCHAR(20) NULL,
  payload_json JSON NOT NULL,
  last_synced_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_licitaciones_estado (codigo_estado),
  INDEX idx_licitaciones_cierre (fecha_cierre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS sync_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fecha_consultada DATE NOT NULL,
  estado ENUM('en_progreso','completada','fallida') NOT NULL,
  total_recibidos INT UNSIGNED NOT NULL DEFAULT 0,
  total_insertados INT UNSIGNED NOT NULL DEFAULT 0,
  total_actualizados INT UNSIGNED NOT NULL DEFAULT 0,
  mensaje_error TEXT NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  INDEX idx_sync_started_at (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
