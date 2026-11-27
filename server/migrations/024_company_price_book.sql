USE oportuna;

CREATE TABLE IF NOT EXISTS company_price_book_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  nombre VARCHAR(255) NOT NULL,
  categoria VARCHAR(160) NOT NULL DEFAULT '',
  unidad VARCHAR(40) NOT NULL DEFAULT 'unidad',
  precio_base DECIMAL(15,2) NOT NULL DEFAULT 0,
  costo_base DECIMAL(15,2) NOT NULL DEFAULT 0,
  unidad_cobro ENUM('unidad','m2','hora','kg','servicio','km') NOT NULL DEFAULT 'unidad',
  ancho_m DECIMAL(10,3) NULL,
  alto_m DECIMAL(10,3) NULL,
  especificaciones TEXT NOT NULL,
  recargos_json JSON NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_company_price_book_name (company_id,nombre),
  KEY idx_company_price_book_active (company_id,activo,categoria),
  CONSTRAINT fk_company_price_book_company FOREIGN KEY (company_id)
    REFERENCES companies (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
