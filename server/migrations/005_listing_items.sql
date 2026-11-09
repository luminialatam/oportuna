USE oportuna;

CREATE TABLE IF NOT EXISTS licitacion_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo_externo VARCHAR(100) NOT NULL,
  item_index INT UNSIGNED NOT NULL,
  nombre VARCHAR(1000) NULL,
  descripcion TEXT NULL,
  categoria VARCHAR(255) NULL,
  cantidad DECIMAL(20,4) NULL,
  unidad_medida VARCHAR(120) NULL,
  search_text TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_licitacion_item (codigo_externo, item_index),
  KEY idx_licitacion_items_codigo (codigo_externo),
  FULLTEXT KEY ft_licitacion_items_search (search_text),
  CONSTRAINT fk_licitacion_items_listing FOREIGN KEY (codigo_externo)
    REFERENCES licitaciones (codigo_externo) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS licitacion_enrichment (
  codigo_externo VARCHAR(100) NOT NULL PRIMARY KEY,
  estado ENUM('pending','running','completed','empty','failed') NOT NULL DEFAULT 'pending',
  intentos TINYINT UNSIGNED NOT NULL DEFAULT 0,
  total_partidas INT UNSIGNED NOT NULL DEFAULT 0,
  ultimo_error VARCHAR(80) NULL,
  proximo_reintento DATETIME NULL,
  started_at DATETIME NULL,
  finished_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_licitacion_enrichment_queue (estado, proximo_reintento),
  CONSTRAINT fk_licitacion_enrichment_listing FOREIGN KEY (codigo_externo)
    REFERENCES licitaciones (codigo_externo) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
