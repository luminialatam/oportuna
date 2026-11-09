USE oportuna;

ALTER TABLE licitacion_enrichment_pilot_batches
  ADD COLUMN estrategia ENUM('general','thematic') NOT NULL DEFAULT 'general' AFTER estado;

ALTER TABLE licitacion_enrichment_pilot_items
  ADD COLUMN puntaje_interno SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER estado,
  ADD COLUMN nivel_evidencia ENUM('exact','semantic','exploratory') NOT NULL DEFAULT 'exploratory' AFTER puntaje_interno,
  ADD COLUMN motivos_json JSON NULL AFTER nivel_evidencia,
  ADD COLUMN consultas_json JSON NULL AFTER motivos_json;

CREATE TABLE IF NOT EXISTS licitacion_enrichment_previews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estado ENUM('ready','used','expired') NOT NULL DEFAULT 'ready',
  consultas_json JSON NOT NULL,
  candidatos_tematicos INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  KEY idx_enrichment_preview_expiry (expires_at,estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS licitacion_enrichment_preview_items (
  preview_id BIGINT UNSIGNED NOT NULL,
  estrategia ENUM('general','thematic') NOT NULL,
  posicion SMALLINT UNSIGNED NOT NULL,
  codigo_externo VARCHAR(100) NOT NULL,
  puntaje_interno SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  nivel_evidencia ENUM('exact','semantic','exploratory') NOT NULL DEFAULT 'exploratory',
  motivos_json JSON NOT NULL,
  consultas_json JSON NOT NULL,
  PRIMARY KEY (preview_id,estrategia,posicion),
  UNIQUE KEY uq_enrichment_preview_candidate (preview_id,estrategia,codigo_externo),
  CONSTRAINT fk_enrichment_preview_ref FOREIGN KEY (preview_id)
    REFERENCES licitacion_enrichment_previews (id) ON DELETE CASCADE,
  CONSTRAINT fk_enrichment_preview_listing FOREIGN KEY (codigo_externo)
    REFERENCES licitaciones (codigo_externo) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
