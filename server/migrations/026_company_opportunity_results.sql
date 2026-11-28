USE oportuna;

CREATE TABLE IF NOT EXISTS company_opportunity_results (
  tracking_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  outcome ENUM('awarded','not_awarded','deserted','revoked','withdrawn','not_submitted') NOT NULL,
  offer_amount DECIMAL(18,2) NULL,
  awarded_amount DECIMAL(18,2) NULL,
  actual_cost DECIMAL(18,2) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'CLP',
  source_url VARCHAR(2048) NULL,
  decided_at DATE NULL,
  notes VARCHAR(2000) NULL,
  recorded_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_company_opportunity_results_company (company_id,outcome,decided_at),
  CONSTRAINT fk_company_opportunity_result_tracking FOREIGN KEY (tracking_id,company_id)
    REFERENCES company_opportunity_tracking (id,company_id) ON DELETE CASCADE,
  CONSTRAINT fk_company_opportunity_result_company FOREIGN KEY (company_id)
    REFERENCES companies (id) ON DELETE CASCADE,
  CONSTRAINT fk_company_opportunity_result_user FOREIGN KEY (recorded_by)
    REFERENCES app_users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
