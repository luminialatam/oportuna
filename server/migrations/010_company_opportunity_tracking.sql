USE oportuna;

CREATE TABLE IF NOT EXISTS company_opportunity_tracking (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  codigo_externo VARCHAR(100) NOT NULL,
  estado ENUM('saved','evaluating','preparing_offer','submitted','discarded') NOT NULL DEFAULT 'saved',
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_company_opportunity_code (company_id,codigo_externo),
  UNIQUE KEY uq_tracking_id_company (id,company_id),
  KEY idx_company_opportunity_status (company_id,estado,updated_at),
  CONSTRAINT fk_company_opportunity_company FOREIGN KEY (company_id)
    REFERENCES companies (id) ON DELETE CASCADE,
  CONSTRAINT fk_company_opportunity_listing FOREIGN KEY (codigo_externo)
    REFERENCES licitaciones (codigo_externo) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS company_opportunity_dates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tracking_id BIGINT UNSIGNED NOT NULL,
  company_id BIGINT UNSIGNED NOT NULL,
  label VARCHAR(160) NOT NULL,
  due_at DATETIME NOT NULL,
  notes VARCHAR(1000) NULL,
  completed TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_company_opportunity_date (company_id,due_at,completed),
  CONSTRAINT fk_company_opportunity_date_tracking FOREIGN KEY (tracking_id,company_id)
    REFERENCES company_opportunity_tracking (id,company_id) ON DELETE CASCADE,
  CONSTRAINT fk_company_opportunity_date_company FOREIGN KEY (company_id)
    REFERENCES companies (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
