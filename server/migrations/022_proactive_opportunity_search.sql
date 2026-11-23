USE oportuna;

CREATE TABLE IF NOT EXISTS company_proactive_search_preferences (
  company_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  frequency ENUM('hourly','daily','weekly') NOT NULL DEFAULT 'daily',
  last_checked_at DATETIME NULL,
  last_error_code VARCHAR(40) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_proactive_search_due(enabled,last_checked_at),
  CONSTRAINT fk_proactive_search_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS company_proactive_matches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  listing_code VARCHAR(100) NOT NULL,
  listing_name VARCHAR(255) NULL,
  match_level ENUM('high','medium','exploratory') NOT NULL,
  match_score TINYINT UNSIGNED NULL,
  match_reasons JSON NOT NULL,
  read_at DATETIME NULL,
  dismissed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_proactive_match_company_listing(company_id,listing_code),
  KEY idx_proactive_match_unread(company_id,dismissed_at,read_at,created_at),
  CONSTRAINT fk_proactive_match_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_proactive_match_listing FOREIGN KEY (listing_code) REFERENCES licitaciones(codigo_externo) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
