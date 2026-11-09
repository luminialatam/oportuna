USE oportuna;

CREATE TABLE IF NOT EXISTS licitacion_enrichment_pilot (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  estado VARCHAR(24) NOT NULL DEFAULT 'idle',
  total_programado INT UNSIGNED NOT NULL DEFAULT 0,
  limite_total INT UNSIGNED NOT NULL DEFAULT 100,
  tamano_lote SMALLINT UNSIGNED NOT NULL DEFAULT 10,
  lote_actual INT UNSIGNED NULL,
  ultimo_mensaje VARCHAR(120) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS licitacion_enrichment_pilot_batches (
  lote INT UNSIGNED NOT NULL PRIMARY KEY,
  estado VARCHAR(24) NOT NULL,
  cantidad SMALLINT UNSIGNED NOT NULL,
  cobertura_inicial DECIMAL(6,2) NOT NULL DEFAULT 0,
  cobertura_final DECIMAL(6,2) NULL,
  solicitudes_iniciales BIGINT UNSIGNED NOT NULL DEFAULT 0,
  solicitudes_finales BIGINT UNSIGNED NULL,
  iniciado_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finalizado_at DATETIME NULL,
  duracion_ms BIGINT UNSIGNED NULL,
  KEY idx_enrichment_batch_status (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS licitacion_enrichment_pilot_items (
  codigo_externo VARCHAR(100) NOT NULL PRIMARY KEY,
  lote INT UNSIGNED NOT NULL,
  estado VARCHAR(24) NOT NULL DEFAULT 'queued',
  partidas_antes INT UNSIGNED NOT NULL DEFAULT 0,
  partidas_despues INT UNSIGNED NOT NULL DEFAULT 0,
  partidas_nuevas INT UNSIGNED NOT NULL DEFAULT 0,
  codigo_error VARCHAR(32) NULL,
  iniciado_at DATETIME NULL,
  finalizado_at DATETIME NULL,
  duracion_ms BIGINT UNSIGNED NULL,
  KEY idx_enrichment_pilot_batch_state (lote,estado),
  CONSTRAINT fk_enrichment_pilot_batch FOREIGN KEY (lote)
    REFERENCES licitacion_enrichment_pilot_batches (lote) ON DELETE CASCADE,
  CONSTRAINT fk_enrichment_pilot_listing FOREIGN KEY (codigo_externo)
    REFERENCES licitaciones (codigo_externo) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO licitacion_enrichment_pilot (id) VALUES (1);
