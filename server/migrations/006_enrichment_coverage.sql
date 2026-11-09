USE oportuna;

CREATE TABLE IF NOT EXISTS licitacion_search_interest (
  codigo_externo VARCHAR(100) NOT NULL PRIMARY KEY,
  search_count INT UNSIGNED NOT NULL DEFAULT 0,
  first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_search_interest_recent (last_seen_at),
  CONSTRAINT fk_search_interest_listing FOREIGN KEY (codigo_externo)
    REFERENCES licitaciones (codigo_externo) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mercado_publico_metrics (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  detail_requests BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO mercado_publico_metrics (id,detail_requests)
SELECT 1,COALESCE(SUM(intentos),0) FROM licitacion_enrichment
ON DUPLICATE KEY UPDATE id=VALUES(id);
